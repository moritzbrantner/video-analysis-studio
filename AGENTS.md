# Repository Rules

## Development Runtime

- Use port `8702` for the UI dev server.
- Treat `8702` as reserved for this app during development.
- Do not switch to a different port unless the user explicitly asks for it.

## Cross-repository dependencies

- `studio-core` is the application-owned capability-composition façade. API and desktop code must reach audio, text, and visual capabilities through it.
- Multi-domain composition inside `studio-core` is intentional application behavior.
- Run `python3 scripts/check_dependency_boundaries.py` and `python3 scripts/test_check_dependency_boundaries.py` after changing Cargo boundaries.

- Use `bash scripts/source-deps activate` for ordinary work that needs current `audio-analysis`, `nlp-stack`, or `visual-analysis` source.
- Exact source revisions in `.coding-tooling.source-deps.json` are implementation evidence; do not publish packages merely to unblock feature work.
- Keep committed Cargo package coordinates as the distribution contract and run registry-only verification only for an explicitly assigned release/distribution task.
- Update exact source pins when a reviewed upstream source head changes; never replace them with moving branches.
