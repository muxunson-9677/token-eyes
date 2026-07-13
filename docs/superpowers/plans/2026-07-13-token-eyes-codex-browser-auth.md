# Token Eyes Codex Browser Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Token Eyes' isolated Codex WebView login with OpenAI's official Codex app-server browser flow, and make authorization completion independent from quota synchronization.

**Architecture:** Token Eyes starts the official `codex app-server` over stdio, initializes its stable JSONL protocol, asks it to begin a managed ChatGPT login, and opens the returned official `authUrl` in the system browser. A small native protocol client owns process I/O and a per-binding Token Eyes data directory; `codex_session.rs` owns the authorization/quota state machine. The frontend persists an authorized account immediately, then treats rate-limit synchronization as a separate retryable result.

**Tech Stack:** Rust 2021, Tauri 2, `tauri-plugin-opener`, OpenAI Codex app-server JSONL protocol, React 18, Vitest, Node test runner.

**Official protocol evidence:** [OpenAI authentication](https://learn.chatgpt.com/docs/auth) documents that Codex clients open a browser for ChatGPT sign-in. [Codex app-server](https://learn.chatgpt.com/docs/app-server) documents `account/login/start`, `account/login/completed`, `account/read`, and `account/rateLimits/read` for product integrations.

---

## File map

- Create `src-tauri/src/codex_app_server.rs`: resolve and start the official Codex app-server, exchange JSONL messages, validate the returned official URL, and parse sanitized login/rate-limit results.
- Rewrite `src-tauri/src/codex_session.rs`: orchestrate authorization and quota states without embedded WebView, private web endpoints, browser cookies, or credential DTOs.
- Modify `src-tauri/src/lib.rs`: register the focused app-server module while preserving existing Tauri commands.
- Modify `src/lib/local-api.js`: accept an independently authorized native result even when quota synchronization failed.
- Modify `test/token-plan-console-sessions.test.js`: cover authorized-without-quota persistence and credential-field rejection.
- Modify `dashboard/src/lib/api.ts`: expose the explicit `authorized` and quota-sync status fields.
- Modify `dashboard/src/components/settings/TokenPlanSection.jsx`: persist authorization first and then save quota success or retryable quota failure.
- Modify `dashboard/src/components/settings/TokenPlanSection.test.jsx`: cover system-browser authorization completion with both quota success and quota failure.
- Modify `dashboard/src/content/copy.csv`: state that the system browser is used and report missing official Codex component honestly.
- Create `test/token-eyes-codex-auth-contract.test.js`: reject reintroduction of the Codex WebView/private quota endpoint and require official app-server methods.
- Modify `docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md`: record evidence and remaining real-account acceptance work.

### Task 1: Lock the official protocol boundary with failing tests

**Files:**
- Create: `test/token-eyes-codex-auth-contract.test.js`
- Test: `src-tauri/src/codex_session.rs`

- [x] **Step 1: Write the Node source contract test**

```js
test("Codex auth uses official app-server and never an embedded WebView", () => {
  assert.match(source, /account\/login\/start/);
  assert.match(source, /account\/login\/completed/);
  assert.match(source, /account\/rateLimits\/read/);
  assert.doesNotMatch(source, /WebviewWindowBuilder/);
  assert.doesNotMatch(source, /backend-api\/wham\/usage/);
  assert.doesNotMatch(source, /document\.cookie|localStorage|sessionStorage/);
});
```

- [x] **Step 2: Run the contract test and confirm the old implementation fails**

Run: `node --test test/token-eyes-codex-auth-contract.test.js`

Expected: FAIL because `codex_session.rs` still contains `WebviewWindowBuilder` and `/backend-api/wham/usage`.

- [x] **Step 3: Add failing Rust tests for protocol parsing**

Add tests requiring:

```rust
assert_eq!(parse_login_completed(&message, "login-1"), LoginCompletion::Succeeded);
assert_eq!(quota.quota_windows[0].kind, "rolling_5_hour");
assert!(validate_auth_url("https://chatgpt.com/auth/authorize?client_id=token-eyes-test"));
assert!(!validate_auth_url("https://chatgpt.com.evil.example/auth/authorize"));
```

- [x] **Step 4: Run the focused Rust tests and confirm missing symbols fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib codex_app_server`

Expected: FAIL because `codex_app_server` and its protocol helpers do not exist.

- [x] **Step 5: Commit the red tests**

```powershell
git add -- test/token-eyes-codex-auth-contract.test.js src-tauri/src/codex_session.rs
git commit -m "test: define official Codex auth contract"
```

### Task 2: Implement the official app-server client and authorization state machine

**Files:**
- Create: `src-tauri/src/codex_app_server.rs`
- Modify: `src-tauri/src/codex_session.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/codex_app_server.rs`
- Test: `src-tauri/src/codex_session.rs`

- [x] **Step 1: Implement sanitized protocol types and parsing**

Use explicit request methods and never expose raw messages to the dashboard:

```rust
const LOGIN_START_METHOD: &str = "account/login/start";
const LOGIN_COMPLETED_METHOD: &str = "account/login/completed";
const ACCOUNT_READ_METHOD: &str = "account/read";
const RATE_LIMITS_READ_METHOD: &str = "account/rateLimits/read";

pub enum LoginCompletion { Pending, Succeeded, Failed(String) }
pub struct BrowserLoginStart { pub login_id: String, pub auth_url: String }
```

Map `usedPercent`, `windowDurationMins`, and `resetsAt` into the existing sanitized `CodexQuotaWindowDto`; use `300` minutes for `rolling_5_hour` and `10080` minutes for `rolling_weekly`.

- [x] **Step 2: Implement a bounded JSONL process client**

Resolve the executable without invoking a shell on user input: inspect PATH entries for `codex.exe` and `codex.cmd`, plus `%APPDATA%\npm\codex.exe|codex.cmd` on Windows; use `codex` from PATH on Unix. Launch the already-resolved executable/script directly with the single fixed `app-server` argument; a real Windows fixture must prove `.cmd` paths containing spaces receive that argument correctly. Use piped stdin/stdout, hidden-window flags on Windows, and a Token Eyes-owned `CODEX_HOME` formed by joining `app.path().app_data_dir()/codex-accounts` with the UUID suffix returned by `validate_session_ref`. Add resolver tests for paths with spaces and for a missing executable. Send:

```json
{"method":"initialize","id":1,"params":{"clientInfo":{"name":"token_eyes","title":"Token Eyes","version":"0.54.0"}}}
{"method":"initialized","params":{}}
```

Each request must have a bounded wait. Keep only parsed sanitized state in memory; never log stdout lines, `authUrl` query parameters, tokens, or account email.

- [x] **Step 3: Replace the WebView command implementation**

`open_codex_console_login` must:

1. start or reuse the per-binding app-server;
2. call `account/read` and reuse an existing managed ChatGPT session when available;
3. otherwise call `account/login/start` with `{ "type": "chatgpt", "useHostedLoginSuccessPage": true, "appBrand": "codex" }`;
4. validate that `authUrl` is HTTPS on an official OpenAI/ChatGPT host;
5. open it with `app.opener().open_url(&auth_url, None::<String>)` in the system browser.

`verify_codex_console_session` must return `authorized: true` immediately after `account/login/completed.success` without querying quota. A separate `sync_codex_console_quota` command queries `account/rateLimits/read`; a rate-limit failure returns an authorized status with a retryable quota error, not an authorization failure.

`delete_codex_console_session` must send `account/logout`, terminate only the Token Eyes-owned app-server child for that binding, and remove only its validated directory below Token Eyes app data. The successful connect path must not call this destructive disconnect command; normal application exit may terminate the child while retaining the managed login for later refresh.

- [x] **Step 4: Run the focused tests**

Run:

```powershell
node --test test/token-eyes-codex-auth-contract.test.js
cargo test --manifest-path src-tauri/Cargo.toml --lib codex_app_server
cargo test --manifest-path src-tauri/Cargo.toml --lib codex_session
```

Expected: all focused tests PASS; the source contract confirms no Codex WebView or private `/backend-api/wham/usage` remains.

- [x] **Step 5: Commit the native implementation**

```powershell
git add -- src-tauri/src/codex_app_server.rs src-tauri/src/codex_session.rs src-tauri/src/lib.rs test/token-eyes-codex-auth-contract.test.js
git commit -m "fix: use official Codex browser authentication"
```

### Task 3: Persist authorization separately from quota synchronization

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `test/token-plan-console-sessions.test.js`

- [x] **Step 1: Write a failing local API test**

Create a pending Codex console session, then verify it with:

```js
native_result: {
  connected: true,
  authorized: true,
  state_code: "authorized",
  session_ref: created.session_ref,
  error_code: "QUOTA_SYNC_FAILED",
  error_message: "授权成功，但额度同步失败，请重试。"
}
```

Assert that the stored session is `connected`, retains the sanitized quota-sync error, and contains none of `authorization`, `cookie`, `token`, `headers`, or `raw_response`.

- [x] **Step 2: Run the test and confirm it fails**

Run: `node --test test/token-plan-console-sessions.test.js --test-name-pattern="authorized without quota"`

Expected: FAIL because only `state_code === "connected"` can currently persist a connected session.

- [x] **Step 3: Implement the minimal state transition**

Accept `native.connected === true`, `native.authorized === true`, and `state_code` in `connected|authorized`. Clear errors for `connected`; retain bounded quota-sync error fields for `authorized`. Keep the existing forbidden-key check unchanged.

- [x] **Step 4: Run all console-session tests**

Run: `node --test test/token-plan-console-sessions.test.js`

Expected: all tests PASS.

- [x] **Step 5: Commit the local persistence change**

```powershell
git add -- src/lib/local-api.js test/token-plan-console-sessions.test.js
git commit -m "fix: separate Codex authorization from quota sync"
```

### Task 4: Update the Token Eyes UI state machine

**Files:**
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [x] **Step 1: Write failing component tests**

Add one success case and one partial-success case:

```js
verifyCodexConsoleSession.mockResolvedValue({
  connected: true,
  authorized: true,
  state_code: "authorized",
  error_code: "QUOTA_SYNC_FAILED",
  error_message: "授权成功，但额度同步失败，请重试。",
  session_ref: "token-plan/codex/session/test"
});
```

Assert that the official session is persisted as connected, the plan keeps existing quota values, `sync_status` is `error`, the form closes, and the error remains visible on the saved record. In the full-success case, assert quota windows and `sync_status: "success"` are saved.

- [x] **Step 2: Run the focused component tests and confirm failure**

Run: `npm --prefix dashboard run test -- --run src/components/settings/TokenPlanSection.test.jsx -t "Codex system browser"`

Expected: FAIL because the current handler requires `nativeStatus.quota` before accepting authorization.

- [x] **Step 3: Implement authorization-first persistence**

Extend `CodexSessionStatus` with:

```ts
authorized: boolean;
quota_sync_status?: "idle" | "success" | "error";
```

In `handleConnectCodex`, stop polling as soon as `authorized` is true. Call `verifyConsoleSession` immediately. If quota exists, save the existing success fields; otherwise preserve prior quota values and save `sync_status: "error"`, `last_error_code`, and `last_error_message`. Do not call the destructive disconnect command after successful authorization.

- [x] **Step 4: Update user-facing copy**

State that Token Eyes opens the system default browser and reuses the browser's signed-in ChatGPT account when available. Explain that Token Eyes automatically recognizes the official result, while browser-tab closure remains controlled by the browser/OpenAI page. Remove the inaccurate “无需本机 Codex CLI” and “窗口内登录” language.

- [x] **Step 5: Run focused UI and copy validation**

Run:

```powershell
npm --prefix dashboard run test -- --run src/components/settings/TokenPlanSection.test.jsx
npm run validate:copy
npm run validate:ui-hardcode
```

Expected: component tests and both validations PASS.

- [x] **Step 6: Commit the UI change**

```powershell
git add -- dashboard/src/lib/api.ts dashboard/src/components/settings/TokenPlanSection.jsx dashboard/src/components/settings/TokenPlanSection.test.jsx dashboard/src/content/copy.csv
git commit -m "fix: complete Codex auth before quota sync"
```

### Task 5: Full verification and progress report

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md`

- [x] **Step 1: Run repository verification**

Run:

```powershell
node --test test/token-eyes-codex-auth-contract.test.js test/token-plan-console-sessions.test.js
npm --prefix dashboard run test -- --run src/components/settings/TokenPlanSection.test.jsx
npm run validate:copy
npm run validate:ui-hardcode
npm run dashboard:build
cargo test --manifest-path src-tauri/Cargo.toml --lib
$env:CARGO_NET_OFFLINE='true'; cargo build --manifest-path src-tauri/Cargo.toml --release
git diff --check
```

Expected: all tests, validations, and builds PASS. Existing unrelated warnings must be reported, not silently attributed to this change.

- [x] **Step 2: Update the 1–6 tracking document**

Mark items 3 and 4 as repository-verified. Record the official app-server methods used, test counts, and that real-account browser acceptance remains manual because the agent is not authorized to launch or change external software.

- [x] **Step 3: Commit the verification record**

```powershell
git add -- docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md
git commit -m "docs: record Codex browser auth verification"
```

- [x] **Step 4: Report the checkpoint**

Report exactly: completed work, verification evidence, remaining manual acceptance, and the next subproject (C: other AI spend aggregation).
