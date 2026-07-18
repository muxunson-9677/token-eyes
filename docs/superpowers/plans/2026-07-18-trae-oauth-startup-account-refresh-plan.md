# TRAE OAuth, startup, and account refresh implementation plan

1. Capture current startup, token-plan, and directory-discovery baselines with existing tests and benchmark scripts.
2. Add failing Rust tests for isolated TRAE OAuth sessions and normalized entitlement/usage responses.
3. Implement the minimal native TRAE OAuth and quota commands, then wire typed dashboard API wrappers.
4. Add failing React tests for TRAE account binding and quota persistence, then add the Token plan editor flow.
5. Add failing startup tests/benchmarks for an interactive shell independent of backend readiness, then split the boot entry and lazy-load heavy providers.
6. Add failing tests for two Codex bindings refreshing independently, stale quota replacement, Unix reset timestamps, expired filtering, and required ordering; implement the smallest matching refresh coordinator.
7. Add failing tests for directory merge/persistence and official icon selection; implement the data-directory state fix and project-owned icon asset.
8. Run focused suites, full dashboard build, Node tests, Rust tests, and startup benchmark. Resolve failures before packaging.
9. Remove superseded installers inside this worktree's release bundle and build one latest NSIS installer.
