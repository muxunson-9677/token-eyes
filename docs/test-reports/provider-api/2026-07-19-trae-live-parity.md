# TRAE live parity report (Task 5)

Date: 2026-07-19  
Branch: `codex/token-eyes-provider-api`  
Worktree: `.worktrees/provider-api`

## Status

**DONE_WITH_CONCERNS**

Code + unit tests + redacted fixtures are in place. Interactive live OAuth acceptance in the Token Eyes EXE (browser authorize → poll → Cockpit 75 remaining / 速通 Pro match) remains pending Task 6.

---

## 1. Cockpit TRAE contract summary

Source (read-only): `jlcodes99/cockpit-tools`  
Files: `crates/cockpit-core/src/modules/trae_oauth.rs`, `trae_account.rs`, `src/types/trae.ts`

### GetLoginGuidance

| Item | Contract |
|------|----------|
| CN endpoints (order) | `POST https://api.trae.cn/cloudide/api/v3/trae/GetLoginGuidance`, then `api.trae.com.cn`, then `www.trae.cn` |
| Body | `{ "loginTraceID": "<trace>", "login_trace_id": "<trace>" }` |
| Success field | `Result.LoginHost` (also `loginHost` / nested `data` variants) |
| Live probe (2026-07-19) | `api.trae.cn` and `api.trae.com.cn` return `"LoginHost": "www.trae.cn"` |
| CN fallback if all fail | platform default `https://www.trae.cn` |

**Critical separation:** GetLoginGuidance is an **API guidance** call (often on `api.trae.cn`). The browser opens a **web auth** URL on `www.trae.cn`. Do not rewrite `https://api.trae.cn` + `/authorization`.

### Browser authorization URL (Cockpit `build_verification_uri` + screenshot)

| Item | Contract |
|------|----------|
| Origin | `https://www.trae.cn` (screenshot + live LoginHost) |
| Path | `/authorization` |
| Required params (Cockpit Trae CN) | `login_version=1`, `auth_from=trae`, `login_channel=native_ide`, `plugin_version`, `auth_type=local`, `client_id=ono9krqynydwx5`, `redirect=0`, `login_trace_id`, `auth_callback_url`, `machine_id`, `device_id`, `x_device_id`, `x_machine_id`, `x_device_brand`, `x_device_type`, `x_os_version`, `x_env`, `x_app_version`, `x_app_type`, `code_challenge`, `code_challenge_method=S256` |
| Local callback | `http://127.0.0.1:{port}/authorize` |
| Poll UI | expires 600s, poll ~1s (Cockpit modal) |

### Auth code callback

| Item | Contract |
|------|----------|
| Path | `/authorize` |
| Auth code | `authCode` / `auth_code` / nested `authCodeInfo.AuthCode` |
| Or refresh path | `refreshToken` (+ optional `cloudideToken`) |
| Host for exchange | callback `loginHost` / `login_host` (API host for ExchangeToken, not browser origin) |

### Token exchange + refresh

| Step | Path | Notes |
|------|------|-------|
| Auth code | `POST {api}/trae/api/v3/oauth/ExchangeToken` | Body: `ClientID`, `AuthCode`, `CodeVerifier`, `IDEVersion`, `DeviceInfo` (incl. P-256 `DevicePublicKey`) |
| Refresh | `POST {api}/cloudide/api/v3/trae/oauth/ExchangeToken` | Body: `ClientID`, `RefreshToken`, `ClientSecret="-"`, `UserID=""` |
| CN API roots | `https://api.trae.cn`, `https://api.trae.com.cn` | |
| Profile | `POST …/cloudide/api/v3/trae/GetUserInfo` | user id / nickname |

### Quota (CN)

| Item | Contract |
|------|----------|
| Usage endpoint | `POST /trae/api/v1/pay/ide_user_ent_usage` (Cockpit; Token Eyes also tries v2 first) |
| Body | `{ "require_usage": true }` |
| Auth header | `Authorization: Cloud-IDE-JWT {access_token}` |
| Pack list | `user_entitlement_pack_list[]` |
| Product type (速通) | `entitlement_base_info.product_type` = `100` (`CN_EXPRESS`) |
| Plan name | pack `display_desc` (screenshot: `速通 Pro`) or identity mapping |
| Fast total | sum `entitlement_base_info.quota.premium_model_fast_request_limit` |
| Fast used | sum `usage.premium_model_fast_amount` |
| Remaining | `limit - used` (screenshot: **75**) |
| Used ratio | `round(used/limit*100)` (screenshot: **25%** → total 100 / used 25) |
| resetAt | `entitlement_base_info.end_time + 1` (unix seconds; screenshot display `2026/08/01 00:03`) |
| account_id | user id e.g. `4267669818716825` (GetUserInfo / usage `user_id`) |
| Pay status (plan) | `POST /trae/api/v1/pay/ide_user_pay_status` → `user_pay_identity_str` |

Missing critical fields must **fail parse** — never invent `0 requests` + `connected`.

---

## 2. What Token Eyes implemented

1. **Browser auth origin** always `https://www.trae.cn/authorization` via `resolve_browser_auth_origin` — never `Url::parse(apiHost).set_path("/authorization")`.
2. Query params ordered to match Cockpit CN `build_verification_uri` (`login_version` / `auth_from` first).
3. **CN fast-request quota parse** (`parse_trae_quota_snapshot`) on Cockpit field paths; exposes `plan_name`, `account_id`, total/used/remaining, reset.
4. **`sync_failed`**: tokens may persist while quota fails; `connected` requires a successful parse with real fields.
5. GetUserInfo used to resolve `account_id` when missing from usage body.
6. Dashboard: Trae `TraeQuotaSnapshot`, persist `plan_name` / `account_id` / `session_ref`; refresh treats `sync_failed` as failed sync (not connected zeros).

---

## 3. Fixtures

| File | Capture |
|------|---------|
| `src-tauri/tests/fixtures/trae/login-guidance.json` | **Live** GetLoginGuidance from `api.trae.cn` (2026-07-19). `LoginHost=www.trae.cn`. |
| `src-tauri/tests/fixtures/trae/quota.json` | **structure from Cockpit field paths + screenshot values; not raw live capture**. Remaining 75, 速通 Pro, account `4267669818716825`, used 25 / total 100 (25%). |

---

## 4. Test results

### Command that executes these unit tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib trae_session -- --nocapture
```

(Note: bare `cargo test … trae_session` without `--lib` still fails at unrelated integration-test compile in this worktree — same as Cursor Task 4 baseline.)

### Exact summary

```
running 13 tests
test trae_session::tests::exchange_routes_match_official_native_client_protocol ... ok
test trae_session::tests::guidance_fallbacks_prefer_current_public_routes ... ok
test trae_session::tests::quota_lookup_prefers_cn_v2_and_keeps_official_fallbacks ... ok
test trae_session::tests::sync_failed_is_authorized_but_not_connected ... ok
test trae_session::tests::rejects_credentials_as_session_references ... ok
test trae_session::tests::extracts_nested_login_guidance_host ... ok
test trae_session::tests::rejects_payloads_without_provider_quota ... ok
test trae_session::tests::accepts_refresh_token_callback_without_auth_code ... ok
test trae_session::tests::accepts_auth_code_info_callback_without_state ... ok
test trae_session::tests::parses_cn_fast_request_quota_fixture_with_plan_remaining_and_reset ... ok
test trae_session::tests::missing_account_id_is_parse_failure_not_connected_zero ... ok
test trae_session::tests::browser_auth_url_uses_www_even_when_guidance_host_is_api ... ok
test trae_session::tests::builds_authorization_url_from_guidance_host_with_official_client_fields ... ok

test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 165 filtered out; finished in 0.00s
```

TDD note: `browser_auth_url_uses_www_even_when_guidance_host_is_api` first failed with `left: Some("api.trae.cn")` under the old rewrite, then passed after the browser-origin fix.

---

## 5. Files changed

- `src-tauri/src/trae_session.rs`
- `src-tauri/src/lib.rs` (already registered; no change required in this task)
- `dashboard/src/lib/api.ts`
- `dashboard/src/hooks/use-token-service-plans.js`
- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `src-tauri/tests/fixtures/trae/login-guidance.json`
- `src-tauri/tests/fixtures/trae/quota.json`
- `docs/test-reports/provider-api/2026-07-19-trae-live-parity.md`

---

## 6. Live acceptance status

**Pending Task 6.** This agent session did not drive the Token Eyes GUI OAuth click → browser `www.trae.cn/authorization` → authorize → poll → live remaining 75 parity against Cockpit. Unit coverage + live LoginHost probe only.

---

## 7. Concerns

1. Quota fixture is structure-aligned (Cockpit paths + screenshot), not a redacted live `ide_user_ent_usage` body — live field drift possible.
2. Cockpit main still lists v1 `ide_user_ent_usage` as primary; Token Eyes tries v2 then v1 then entitlement list.
3. Unrelated integration tests still block bare `cargo test … trae_session` without `--lib`.
