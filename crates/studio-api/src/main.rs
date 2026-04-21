use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

use clap::Parser;
use studio_api::build_app;
use studio_core::RunManager;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(
    name = "studio-api",
    version,
    about = "Video Analysis Studio localhost API"
)]
struct Cli {
    #[arg(long, default_value = "127.0.0.1")]
    host: IpAddr,
    #[arg(long, default_value_t = 5179)]
    port: u16,
    #[arg(long, default_value = "./studio-data")]
    data_dir: PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let bind = SocketAddr::new(cli.host, cli.port);
    let listener = TcpListener::bind(bind).await?;
    let app = build_app(RunManager::new(cli.data_dir));
    tracing::info!(%bind, "studio-api listening");
    axum::serve(listener, app).await?;
    Ok(())
}
