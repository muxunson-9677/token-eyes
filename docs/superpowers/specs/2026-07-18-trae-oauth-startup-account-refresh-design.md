# Token Eyes TRAE OAuth, startup, and account refresh design

## Scope

All implementation and generated artifacts stay inside the Token Eyes repository. Cockpit Tools is used only as a read-only behavioral reference; no source code is copied from it and no external application is modified.

## Goals

1. Add a Token Eyes-owned TRAE CN OAuth flow that retrieves account identity, plan entitlement, quota usage, and reset time through the provider's official protocol.
2. Keep account quota and exact token usage as separate data sources. OAuth quota must never be represented as exact request tokens.
3. Make the desktop shell interactive within two seconds on a cold launch on the verification machine. Backend startup and data refresh must not block the WebView main thread.
4. Refresh every Codex token plan through its own account binding and persisted session reference. Two accounts from the same provider must never overwrite or reuse each other's quota snapshot.
5. Hide expired token plans, order usable plans by used quota descending, then show exhausted but unexpired plans.
6. Persist and display resolved TRAE and CodeBuddy data directories, and use the verified official TRAE brand icon.

## Architecture

### TRAE OAuth and quota

- Implement an isolated native TRAE session module with per-account storage under the Token Eyes application data directory.
- Use an OAuth PKCE flow with a loopback callback and the system browser.
- Resolve the TRAE CN login host, exchange the authorization result for account credentials, then query the official entitlement and usage endpoints.
- Store only credentials and normalized account/quota metadata. Never store prompts, messages, or conversation bodies.
- Expose native commands for opening login, verifying callback completion, refreshing quota, and deleting a binding.
- Surface normalized quota windows to token plans using provider-specific units such as requests/credits. Exact tokens continue to come only from readable local usage records.

### Startup

- Render a minimal interactive navigation shell before loading the full dashboard and authentication providers.
- Start the bundled Node backend asynchronously and expose readiness separately from shell interactivity.
- Load heavy pages and providers after the first interactive paint.
- Preserve a cached last-known local view while fresh data is loading.

### Codex multi-account refresh

- Resolve each token plan through its `account_binding_id` and the corresponding unique `session_ref`.
- Refresh all connected Codex plans independently when usage data is opened and on explicit refresh.
- Save each quota response back to only the matching plan record.
- Normalize Unix-second reset timestamps to ISO strings before UI formatting.

### Token service visibility

- Exclude records whose explicit `expires_at` is in the past.
- Exclude unconfigured or failed records.
- Rank non-expired records in two groups: usable first, exhausted second.
- Within each group, sort by used quota descending and retain stable record order as the final tie breaker.

### Data directories and icon

- Auto-detection merges evidence-backed discoveries into saved overrides instead of clearing unrelated or previously saved paths.
- Installation directories may resolve to provider user-data directories, but both the configured path and resolved data path remain visible.
- Overview connection state is derived from the same persisted discovery result used by Basic Settings.
- Replace the placeholder TRAE glyph with a verified official TRAE asset stored in the project.

## Verification

- Rust tests cover OAuth state isolation, callback validation, quota normalization, credential refresh, and deletion boundaries.
- React tests cover per-account refresh, stale snapshot replacement, expired filtering, ordering, directory merge/persistence, and icon mapping.
- Node tests cover directory discovery and exact-token privacy boundaries.
- The startup benchmark records process launch, first paint, first interactive navigation, and backend-ready timestamps. First interactive navigation must be at or below two seconds on the verification machine.
- Build the Windows NSIS installer only after all focused tests, dashboard build, Rust tests, and startup benchmark pass.
