# Cursor live parity report (Task 4)

Date: 2026-07-19  
Branch: `codex/token-eyes-provider-api`  
Worktree: `.worktrees/provider-api`

## Status

**DONE_WITH_CONCERNS**

Code + unit tests + redacted fixtures are in place. Dual-account live EXE acceptance against Cockpit UI remains pending Task 6 (only one Token Eyes `cursor-accounts/` folder present; account B had no local token for a second live capture).

---

## 1. Cockpit contract summary

Source (read-only): `jlcodes99/cockpit-tools`  
Files: `crates/cockpit-core/src/modules/cursor_oauth.rs`, `cursor_account.rs`

### OAuth / PKCE

| Step | Contract |
|------|----------|
| Challenge | 32 random bytes → base64url (no pad) verifier; `SHA256(verifier)` → base64url challenge |
| Login URL | `https://cursor.com/loginDeepControl?challenge={challenge}&uuid={uuid}&mode=login` |
| UUID | UUID v4 string (Cockpit); Token Eyes uses 16 random hex bytes (compatible poll key) |
| Poll | `GET https://api2.cursor.sh/auth/poll?uuid={uuid}&verifier={verifier}` |
| Poll interval / TTL | 2s / 300s (Cockpit UI + `OAUTH_POLL_INTERVAL_MS=2000`, max 150) |
| Poll 404 | keep waiting |
| Poll 200 | JSON camelCase: `accessToken`, `refreshToken`, `authId` |
| Termination | success when both access + refresh present; timeout/cancel clears pending |

### Token / identity field names

| Field | Source |
|-------|--------|
| `accessToken` / `access_token` | poll + oauth/token |
| `refreshToken` / `refresh_token` | poll + oauth/token |
| `authId` | poll; may be email-like or WorkOS id |
| JWT `sub` | e.g. `auth0\|user_…` / `google-oauth2\|user_…` |
| WorkOS user id | `sub.rsplit('\|').next()` must start with `user_` |
| Email / `workosId` | `POST https://api2.cursor.sh/aiserver.v1.AuthService/GetUserMeta` with `Authorization: Bearer {access}` |

### usage-summary

| Item | Contract |
|------|----------|
| URL | `GET https://cursor.com/api/usage-summary` |
| Auth | `Cookie: WorkosCursorSessionToken={userId}%3A%3A{accessToken}` |
| Headers | `Accept: application/json`, browser `User-Agent` (Cockpit: macOS Safari UA) |
| Refresh first | `POST https://api2.cursor.sh/oauth/token` with `grant_type=refresh_token`, `client_id=KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB` |

### Response paths (Cockpit `read_usage_percent`)

| UI label | JSON path |
|----------|-----------|
| Total Usage | `individualUsage.plan.totalPercentUsed` (fallback `used`/`totalSpend`/`total_spend` ÷ `limit` **only if percent absent**) |
| Auto + Composer | `individualUsage.plan.autoPercentUsed` |
| API Usage | `individualUsage.plan.apiPercentUsed` |
| Reset | `billingCycleEnd` |
| Membership | `membershipType` (also Stripe profile / usage body) |

**Critical:** live responses can have `plan.used == plan.limit` (ceiling) while `totalPercentUsed` is ~29%. Explicit percent must win; do not overwrite with the used/limit ratio.

### Per-account storage (Cockpit)

- Account id derived from auth identity (authId / JWT sub / workosId)
- Each account file holds tokens + `cursor_usage_raw`
- Refresh updates that account only; no global “current account” overwrite for quota binding

---

## 2. What Token Eyes implemented

1. **Token refresh** before usage fetch (was missing → stale access token → 401 → UI stuck at 0%).
2. **`CursorQuotaSnapshot`** fields on the DTO: `account_id`, `total_usage_percent`, `auto_composer_percent`, `api_usage_percent`, `reset_at`, `fetched_at`, plus legacy `used_quota`/`quota_windows` bridge.
3. **Strict parse** (`parse_cursor_quota_snapshot`): missing Total Usage fields → error; never invent connected 0%.
4. **`SessionStateCode::SyncFailed`**: auth OK + usage fail → `sync_failed`, not `connected`.
5. **Per-account persistence**: `cursor-accounts/{session_suffix}/auth.json` + `meta.json` with `provider`, `account_id`, `session_ref`, `display_name` (redacted email). Plans store `session_ref` (+ `account_id`) under `detection_config.official_account` only.
6. **Dashboard**: TokenServiceList Cursor lanes (Total / Auto+Composer / API); `use-token-service-plans` refreshes Cursor plans; TokenPlanSection refresh requires `connected` + quota and persists `session_ref`/`account_id`.

---

## 3. Fixtures

| File | Capture |
|------|---------|
| `src-tauri/tests/fixtures/cursor/usage-summary-account-a.json` | **Live** usage-summary after refresh+cookie via `curl` (2026-07-19). Account `auth0\|user_01KWTPZG4VW30ZF6MKZ2XXM398`. Tokens/cookies redacted; body kept. Total ~29% (Cockpit screenshot was ~27% — refresh-time drift). |
| `src-tauri/tests/fixtures/cursor/usage-summary-account-b.json` | **structure from Cockpit field paths + screenshot values; not raw live capture**. Total 6% / Auto 1% / API 39%, reset `2026-08-13T09:08:00.000Z`. Account id redacted from Cockpit screenshot auth id prefix. |

Live capture note: PowerShell `Invoke-WebRequest` returned 401 for the same Cookie that `curl.exe` accepted (200). Rust `reqwest` matches curl-style headers (aligned with Cockpit).

---

## 4. Test results

### Command that executes the new unit tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib cursor_session -- --nocapture
```

**Result:** `33 passed; 0 failed` (2026-07-19).

### Mandated filter

```bash
cargo test --manifest-path src-tauri/Cargo.toml cursor_session -- --nocapture
```

**Result:** fails to compile **unrelated** integration tests (`cc_switch_lib` / `toml` missing in `tests/*.rs`). Documented baseline; unit coverage is via `--lib`.

### Covered behaviors

1. Fixtures → distinct `account_id` + Total/Auto/API/`billingCycleEnd`
2. Missing critical fields → error
3. Explicit `totalPercentUsed` wins over `used`/`limit` ceiling
4. Auth OK + usage Err → `sync_failed`, not connected
5. `CursorAccountMeta` shape without secrets

---

## 5. Live acceptance (dual account vs Cockpit)

| Check | Result |
|-------|--------|
| Account A live usage-summary after refresh | **OK** (~29% Total / ~23% Auto / ~72% API; Cockpit screenshot 27/20/72 — drift OK) |
| Account B live usage-summary | **BLOCKED** — no second Token Eyes `cursor-accounts/` auth; Cockpit account JSON store not found under Local/Roaming for raw capture |
| Installed EXE dual-plan UI vs Cockpit | **Pending Task 6** |
| Cross-wire / overwrite | Code paths use per-`session_ref` dirs + plan-bound `session_ref`; not live-proven for two plans |
| Auth file alone ⇒ connected | **Rejected** in code (must parse usage successfully) |

---

## 6. Self-review / concerns

1. Only one authorized Token Eyes Cursor account on disk; dual-account EXE parity unfinished.
2. Integration-test target still broken by pre-existing `cc_switch_lib` deps — use `--lib` for Cursor unit tests.
3. Cockpit also loads Stripe profile / team limits; Token Eyes Task 4 scope is usage-summary Total/Auto/API + reset.
4. UUID format differs slightly from Cockpit (hex vs UUID v4) but poll contract is the same.
5. After deploy, user should reconnect or refresh each Cursor plan once so refresh tokens rotate and `meta.json` is written.
