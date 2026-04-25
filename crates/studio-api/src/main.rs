use std::fs;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

use clap::Parser;
use serde::Deserialize;
use studio_api::build_app;
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
}

#[derive(Debug, Deserialize, Default)]
struct RuntimeConfig {
    api: Option<ApiConfig>,
}

#[derive(Debug, Deserialize, Default)]
struct ApiConfig {
    host: Option<String>,
    port: Option<u16>,
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
    let app = build_app(RunManager::new(cli.data_dir));
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
