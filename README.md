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
```

During development, run the app with `bun dev`. It reads `config/runtime.json` at startup, starts the localhost API from that config, waits for the API to come up, and then launches the Vite dev server with the configured UI port. The default UI dev port remains `8702`.

If you need the backend separately, use `bun run api:dev`.

The API host and port, UI dev port, and UI test port all come from `config/runtime.json`. The browser UI uses the same startup config for its default API base URL. `VITE_STUDIO_API_URL` can still override the API URL when needed.
