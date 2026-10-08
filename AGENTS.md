# Repository Rules

## Development Runtime

- Use port `8702` for the UI dev server.
- Treat `8702` as reserved for this app during development.
- Do not switch to a different port unless the user explicitly asks for it.

## Cross-repository dependencies

- `studio-core` is the application-owned capability-composition façade. `studio-api` and desktop code must depend on it rather than importing audio, NLP, or visual implementation crates directly.
- The application may legitimately compose audio, text, and visual capabilities inside `studio-core`; do not treat that multi-domain composition as a layering violation.
- Normal development uses the versioned registry coordinates in the root Cargo workspace. Keep `.coding-tooling.source-deps.json` empty unless a task explicitly co-develops this application with a specific upstream capability.
- A task-scoped exact source override is implementation evidence for that migration only. Remove it when the cross-repository change is complete; do not maintain an ambient exact-head graph of every capability used by the application.
- Do not publish packages merely to unblock feature work. Registry-only verification belongs to an explicitly assigned release/distribution task.
- Never replace an exact task-scoped source revision with a moving branch.
- Run `python3 scripts/check_dependency_boundaries.py` after changing Cargo boundaries. The API and desktop layers must continue to reach media capabilities through `studio-core`.
