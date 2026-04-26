# Video Analysis Studio

Product workspace for the YouTube/local-video analysis workflow.

## Layout

- `crates/studio-core`: stable app-facing workflow DTOs, dependency checks, run manager, and compatibility wrappers over the sibling package workspace.
- `crates/studio-api`: localhost Axum API for browser development.
- `apps/ui`: React/Vite UI used by both browser and desktop.
- `apps/desktop`: Tauri v2 desktop app wrapping the UI and calling Rust commands directly.

The Rust workflow engine is package-backed by the sibling `../rust-packages` workspace. This
repo keeps the app/API surface stable while delegating reusable workflow execution to
`video-analysis-use-cases` and related packages.

## Local Development

```bash
gh auth setup-git
bun install
cargo check --workspace
cargo test --workspace
bun dev
```

`video-analysis-studio` and `../rust-packages` are expected to move together. They share a Rust
toolchain baseline of `1.95`, and UI workflow catalog tests in this repo read
`../rust-packages/crates/video/video-analysis-use-cases/src/workflow_catalog.json` directly, so
package-side workflow catalog changes are part of this repo's compatibility surface.

During development, run the app with `bun dev`. It reads `config/runtime.json` at startup, starts the localhost API from that config, waits for the API to come up, and then launches the Vite dev server with the configured UI port. The default UI dev port remains `8702`.

If you need the backend separately, use `bun run api:dev`.

The API host and port, UI dev port, and UI test port all come from `config/runtime.json`. The browser UI uses the same startup config for its default API base URL. `VITE_STUDIO_API_URL` can still override the API URL when needed.
