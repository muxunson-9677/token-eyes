# Cursor live parity — Cockpit Tools alignment (Task 4)

**Date:** 2026-07-19  
**Worktree:** `D:\04-AI-Project\010-Token eye\.worktrees\provider-api`  
**Branch:** `codex/token-eyes-provider-api`  
**Status:** DONE_WITH_CONCERNS

Cockpit Tools source was cloned read-only to  
`C:\Users\admin\AppData\Local\Temp\cockpit-tools-readonly-20260719195623\cockpit-tools`  
(outside the Token Eyes tree; not committed).

---

## 1. Cockpit contract summary

### 1.1 OAuth / PKCE (`src-tauri/src/modules/cursor_oauth.rs`)

| Step | Contract |
|---|---|
| Verifier | 32 random bytes → base64url (no pad) |
| Challenge | `SHA256(verifier)` → base64url (no pad) |
| UUID | UUID v4 string |
| Login URL | `https://cursor.com/loginDeepControl?challenge={challenge}&uuid={uuid}&mode=login` |
| Poll URL | `GET https://api2.cursor.sh/auth/poll?uuid={uuid}&verifier={verifier}` |
| Poll cadence | 2s interval, max 150 attempts (~300s), expires_in=300 |
| Poll 404 | keep waiting |
| Poll 200 success | body has `accessToken`, `refreshToken`, optional `authId` (camelCase) |
| Termination | success tokens / cancelled / expired / max polls |

### 1.2 Token refresh / identity

| Endpoint | Auth | Notes |
|---|---|---|
| `POST https://api2.cursor.sh/oauth/token` | JSON body | `grant_type=refresh_token`, `client_id=KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB`, `refresh_token` |
| Refresh response | | `access_token` / `accessToken`, optional refresh, `shouldLogout` |
| `POST …/aiserver.v1.AuthService/GetUserMeta` | `Authorization: Bearer {access}` | `email`, `workos_id`, `sign_up_type` |
| Account id | JWT `sub` or auth id | e.g. `auth0\|user_…`, `google-oauth2\|user_…` |

### 1.3 usage-summary

| Item | Contract |
|---|---|
| URL | `GET https://cursor.com/api/usage-summary` |
| Headers | `Accept: application/json`, `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)`, `Cookie: WorkosCursorSessionToken={user_id}%3A%3A{access_token}` |
| Cookie user_id | JWT `sub` → last `\|` segment; must start with `user_` |
| Authorization | **Not** used on usage-summary (Cookie only) — matches Cockpit |

### 1.4 Response field paths (Cockpit `cursor.ts` / `cursor_account.rs`)

| UI label | JSON path |
|---|---|
| Total Usage | `individualUsage.plan.totalPercentUsed` (fallback `used`/`totalSpend` ÷ `limit`) |
| Auto + Composer | `individualUsage.plan.autoPercentUsed` |
| API Usage | `individualUsage.plan.apiPercentUsed` |
| Reset | `billingCycleEnd` |
| Plan cents | `individualUsage.plan.used` / `.limit` (often both 2000 while percent ≪ 100) |
| On-Demand | `individualUsage.onDemand.enabled` / used / limit |
| Membership | `membershipType` |

**Critical:** prefer explicit `*PercentUsed` over `used/limit` ratio. Live Pro accounts can have `used==limit==2000` while `totalPercentUsed≈29%`.

### 1.5 Per-account storage (Token Eyes)

```
provider = cursor
account_id = JWT sub / stable auth id
session_ref = token-plan/cursor/session/{local-id}
display_name = redacted email
```

Stored under `app_data/cursor-accounts/{session_suffix}/` as `auth.json` + `meta.json`.  
Token plans bind `detection_config.official_account.session_ref` only — not a global current account.

---

## 2. Fixtures

| File | Source |
|---|---|
| `src-tauri/tests/fixtures/cursor/usage-summary-account-a.json` | **LIVE** capture 2026-07-19 via Token Eyes stored refresh token → oauth/token → usage-summary. Tokens/cookies omitted. `account_id=auth0\|user_01KWTPZG4VW30ZF6MKZ2XXM398`. |
| `src-tauri/tests/fixtures/cursor/usage-summary-account-b.json` | **Reconstructed** from Cockpit field paths + screenshot values (6% / 1% / 39%, reset 2026-08-13). Labeled in `_fixture.notes`. Not raw live capture (Token Eyes app data had only account A). |

Live A raw percents:

| Field | Value |
|---|---:|
| `totalPercentUsed` | 29.544927536231885 |
| `autoPercentUsed` | 23.246666666666666 |
| `apiPercentUsed` | 71.53333333333333 |
| `billingCycleEnd` | 2026-08-06T14:31:29.000Z |
| `plan.used` / `plan.limit` | 2000 / 2000 |

Cockpit UI screenshot showed Total Usage **27%** / Auto **20%** / API **72%** for the same account family — UI rounding / older refresh; live API is authoritative for parser tests.

---

## 3. What was implemented

1. **Rust** `parse_cursor_quota_snapshot` / `CursorQuotaSnapshot` already Cockpit-aligned; fixture tests updated to live A + screenshot B; missing critical fields → error; auth OK + usage fail → `sync_failed`.
2. **Dashboard refresh:** `refreshConnectedCursorPlans` calls `verifyCursorConsoleSession` per plan `session_ref` on Token Service load (parity with Codex/Trae). Previously Cursor never refreshed → stuck at 0%.
3. **Connect loop:** treat `sync_failed` / `reauth_required` as hard failures; with `retainNativeSession` do **not** delete `auth.json` on connect failure (prevents wiping a just-authorized account after usage glitch).
4. **TokenServiceList:** Cursor windows `total` / `auto_composer` / `api` with Cockpit labels; do not crush to used=0/remaining=0.
5. **DTO:** `api.ts` `CursorQuotaSnapshot` extended with percent fields + `account_id`.

---

## 4. Test results

| Command | Result |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib cursor_session -- --nocapture` | **33 passed** (this is the command that executes the new unit/fixture tests) |
| `cargo test --manifest-path src-tauri/Cargo.toml cursor_session -- --nocapture` | **Fails compile** on orphan integration tests (`toml` / `cc_switch_lib` unresolved) — same baseline as Task 1 report; filter never reaches unit tests |
| `npm --prefix dashboard test -- --run TokenServiceList.test.jsx use-token-service-plans.test.js` | **16 passed** |

---

## 5. Live dual-account acceptance

| Check | Result |
|---|---|
| Account A live usage-summary via Token Eyes refresh token | **PASS** — Total ~29.5% (not 0); Cookie auth form verified |
| Account B live capture | **BLOCKED** — only one `cursor-accounts/*` auth in `Roaming\com.tokeneyes.desktop`; fixture B reconstructed |
| Installed EXE dual-account UI vs Cockpit | **Pending Task 6** — not re-driven this session; code + unit tests solid |
| Cross-wire / overwrite | Code binds per `session_ref`; refresh iterates plans independently |

---

## 6. Self-review / concerns

1. Mandated cargo filter without `--lib` still fails due to unrelated integration-test crate graph.
2. Account B fixture is not a raw live capture — labeled clearly.
3. Cockpit screenshot Total 27% vs live 29.5% — refresh-time drift / rounding; parser uses raw API fields.
4. Existing Token Eyes `auth.json` lacked `meta.json` / `account_id` — reconnect + new persist path writes both.
5. Do not treat `plan.used/limit` ceiling as Total Usage — that was a primary 0%/100% footgun vs Cockpit.
