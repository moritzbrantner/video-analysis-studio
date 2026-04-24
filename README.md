# Video Analysis Studio

Product workspace for the YouTube/local-video analysis workflow.

## Layout

- `crates/studio-core`: shared workflow types, dependency checks, run manager, report generation.
- `crates/studio-api`: localhost Axum API for browser development.
- `apps/ui`: React/Vite UI used by both browser and desktop.
- `apps/desktop`: Tauri v2 desktop app wrapping the UI and calling Rust commands directly.

## Local Development

```bash
gh auth setup-git
bun install
cargo check --workspace
cargo test --workspace
bun dev
cargo run -p studio-api -- --data-dir ./studio-data
```

During development, run the app with `bun dev`. The UI dev server is pinned to `http://127.0.0.1:8702` and will fail to start if that port is unavailable.

The API binds to `127.0.0.1:5179` by default.
