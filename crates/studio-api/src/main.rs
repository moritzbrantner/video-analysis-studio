use std::fs;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

use clap::Parser;
use serde::Deserialize;
use studio_api::{build_app_with_options, ApiOptions};
use studio_core::RunManager;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

const DEFAULT_API_HOST: &str = "127.0.0.1";
const DEFAULT_API_PORT: u16 = 5179;

#[derive(Debug, Parser)]
#[command(
    name = "studio-api",
    version,
    about = "Video Analysis Studio localhost API"
)]
struct Cli {
    #[arg(long)]
    host: Option<IpAddr>,
    #[arg(long)]
    port: Option<u16>,
    #[arg(long, default_value = "./studio-data")]
    data_dir: PathBuf,
    #[arg(long, default_value = "./studio-data/dev-api-token")]
    auth_token_file: PathBuf,
    #[arg(long)]
    disable_dev_auth: bool,
}

#[derive(Debug, Deserialize, Default)]
struct RuntimeConfig {
    api: Option<ApiConfig>,
    ui: Option<UiConfig>,
}

#[derive(Debug, Deserialize, Default)]
struct ApiConfig {
    host: Option<String>,
    port: Option<u16>,
}

#[derive(Debug, Deserialize, Default)]
struct UiConfig {
    host: Option<String>,
    dev_port: Option<u16>,
    #[serde(rename = "devPort")]
    dev_port_camel: Option<u16>,
    e2e_host: Option<String>,
    #[serde(rename = "e2eHost")]
    e2e_host_camel: Option<String>,
    e2e_port: Option<u16>,
    #[serde(rename = "e2ePort")]
    e2e_port_camel: Option<u16>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let runtime_config = load_runtime_config();
    let default_host = runtime_config
        .api
        .as_ref()
        .and_then(|config| config.host.as_deref())
        .unwrap_or(DEFAULT_API_HOST)
        .parse::<IpAddr>()?;
    let host = cli.host.unwrap_or(default_host);
    let port = cli
        .port
        .or_else(|| runtime_config.api.as_ref().and_then(|config| config.port))
        .unwrap_or(DEFAULT_API_PORT);

    let bind = SocketAddr::new(host, port);
    let listener = TcpListener::bind(bind).await?;
    let auth_token = if cli.disable_dev_auth {
        None
    } else {
        Some(load_or_create_auth_token(&cli.auth_token_file)?)
    };
    let app = build_app_with_options(
        RunManager::new(cli.data_dir),
        ApiOptions {
            auth_token,
            allowed_origins: allowed_origins(&runtime_config),
        },
    );
    tracing::info!(%bind, "studio-api listening");
    axum::serve(listener, app).await?;
    Ok(())
}

fn load_runtime_config() -> RuntimeConfig {
    let path = PathBuf::from("config/runtime.json");
    let Ok(contents) = fs::read_to_string(path) else {
        return RuntimeConfig::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn load_or_create_auth_token(path: &PathBuf) -> anyhow::Result<String> {
    if let Ok(token) = std::env::var("STUDIO_API_TOKEN") {
        let token = token.trim().to_string();
        if !token.is_empty() {
            return Ok(token);
        }
    }
    if let Ok(token) = fs::read_to_string(path) {
        let token = token.trim().to_string();
        if !token.is_empty() {
            return Ok(token);
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let token = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
    fs::write(path, format!("{token}\n"))?;
    Ok(token)
}

fn allowed_origins(config: &RuntimeConfig) -> Vec<String> {
    let mut origins = vec![
        "http://127.0.0.1:8702".to_string(),
        "http://localhost:8702".to_string(),
    ];
    if let Some(ui) = &config.ui {
        let dev_port = ui.dev_port.or(ui.dev_port_camel).unwrap_or(8702);
        for host in ui_origin_hosts(ui.host.as_deref().unwrap_or("127.0.0.1")) {
            origins.push(format!("http://{host}:{dev_port}"));
        }
        let e2e_host = ui
            .e2e_host
            .as_deref()
            .or(ui.e2e_host_camel.as_deref())
            .unwrap_or("127.0.0.1");
        let e2e_port = ui.e2e_port.or(ui.e2e_port_camel).unwrap_or(4173);
        for host in ui_origin_hosts(e2e_host) {
            origins.push(format!("http://{host}:{e2e_port}"));
        }
    }
    origins.sort();
    origins.dedup();
    origins
}

fn ui_origin_hosts(host: &str) -> Vec<String> {
    match host {
        "0.0.0.0" => vec!["127.0.0.1".to_string(), "localhost".to_string()],
        "::" | "[::]" => vec!["[::1]".to_string()],
        other => vec![other.to_string()],
    }
}
