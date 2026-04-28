# Video Analysis Studio

Product workspace for the YouTube/local-video analysis workflow.

## Layout

- `crates/studio-core`: stable app-facing workflow DTOs, workflow catalog, dependency checks, run manager, and app-owned pipeline entrypoints.
- `crates/studio-api`: localhost Axum API for browser development.
- `apps/ui`: React/Vite UI used by both browser and desktop.
- `apps/desktop`: Tauri v2 desktop app wrapping the UI and calling Rust commands directly.

The Rust workflow engine uses reusable analysis crates from the sibling `../rust-packages`
workspace, while this repo owns the app/API workflow surface and catalog directly.

## Local Development

```bash
gh auth setup-git
bun install
cargo check --workspace
cargo test --workspace
bun dev
```

`video-analysis-studio` and `../rust-packages` are expected to move together. They share a Rust
toolchain baseline of `1.95`, and the app-owned workflow catalog lives at
`crates/studio-core/src/workflow_catalog.json`.

During development, run the app with `bun dev`. It reads `config/runtime.json` at startup, starts the localhost API from that config, launches the desktop app against the shared UI dev server on the configured port, waits for that UI to come up, and opens the browser version to the same URL. The default UI dev port remains `8702`.

If you need the backend separately, use `bun run api:dev`.

If you only need the desktop shell with the same shared UI dev server, use `bun run desktop:dev`.

The API host and port, UI dev port, and UI test port all come from `config/runtime.json`. The browser UI uses the same startup config for its default API base URL. `VITE_STUDIO_API_URL` can still override the API URL when needed.
