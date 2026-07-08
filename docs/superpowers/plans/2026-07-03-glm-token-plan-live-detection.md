# GLM Token Plan Live Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-safe GLM Coding Plan usage and account-balance detection without invoking a model.

**Architecture:** A Node provider adapter reads 5-hour and weekly quota windows from GLM's official usage endpoint using a securely stored Coding Plan API Key. A provider-restricted Tauri WebView uses the user's GLM console session to read account balance and returns only a sanitized DTO. Existing Token Plan records retain flat quota fields while adding provider-reported quota windows.

**Tech Stack:** Node.js 20 CommonJS, `node:test`, React 18/Vitest, Tauri 2/Rust, Windows DPAPI credential vault.

---

Execution rule: the worktree is already dirty. Every commit below must stage only the files named in that task. Do not format, revert, or stage unrelated files.

### Task 1: GLM quota parser and HTTP client

**Files:**
- Create: `src/lib/glm-token-plan.js`
- Create: `test/glm-token-plan.test.js`

- [ ] **Step 1: Write parser tests for both official rolling windows**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseGlmQuotaResponse } = require("../src/lib/glm-token-plan");

const payload = {
  code: 200,
  data: {
    level: "pro",
    limits: [
      {
        type: "TOKENS_LIMIT",
        unit: 3,
        usage: 4_000_000,
        currentValue: 1_000_000,
        percentage: 25,
        nextResetTime: "2026-07-03T15:00:00+08:00",
      },
      {
        type: "TOKENS_LIMIT",
        unit: 6,
        usage: 20_000_000,
        currentValue: 5_000_000,
        percentage: 25,
        nextResetTime: "2026-07-08T10:00:00+08:00",
      },
    ],
  },
};

test("parseGlmQuotaResponse returns 5-hour and weekly token windows", () => {
  const result = parseGlmQuotaResponse(payload);
  assert.equal(result.level, "pro");
  assert.deepEqual(result.quota_windows, [
    {
      kind: "rolling_5_hour",
      unit: "tokens",
      total: 4_000_000,
      used: 1_000_000,
      remaining: 3_000_000,
      percentage: 25,
      resets_at: "2026-07-03T15:00:00+08:00",
    },
    {
      kind: "rolling_weekly",
      unit: "tokens",
      total: 20_000_000,
      used: 5_000_000,
      remaining: 15_000_000,
      percentage: 25,
      resets_at: "2026-07-08T10:00:00+08:00",
    },
  ]);
});

test("parseGlmQuotaResponse rejects a missing weekly window", () => {
  assert.throws(
    () => parseGlmQuotaResponse({ code: 200, data: { limits: [payload.data.limits[0]] } }),
    (error) => error.code === "GLM_RESPONSE_STRUCTURE_DRIFT",
  );
});
```

- [ ] **Step 2: Run the parser tests and verify RED**

Run: `node --test test/glm-token-plan.test.js`

Expected: FAIL because `src/lib/glm-token-plan.js` does not exist.

- [ ] **Step 3: Implement strict quota normalization**

```js
const GLM_USAGE_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";
const MAX_RESPONSE_BYTES = 1024 * 1024;

class GlmTokenPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GlmTokenPlanError";
    this.code = code;
  }
}

function finiteNonNegative(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new GlmTokenPlanError("GLM_RESPONSE_STRUCTURE_DRIFT", `Invalid ${field}`);
  }
  return number;
}

function parseWindow(item, kind) {
  const total = finiteNonNegative(item.usage, `${kind}.usage`);
  const used = finiteNonNegative(item.currentValue, `${kind}.currentValue`);
  return {
    kind,
    unit: "tokens",
    total,
    used,
    remaining: Math.max(0, total - used),
    percentage: finiteNonNegative(item.percentage ?? (total ? used / total * 100 : 0), `${kind}.percentage`),
    resets_at: String(item.nextResetTime || ""),
  };
}

function parseGlmQuotaResponse(payload) {
  const data = payload?.data;
  const limits = Array.isArray(data?.limits) ? data.limits : [];
  const fiveHour = limits.find((item) => item?.type === "TOKENS_LIMIT" && Number(item.unit) === 3);
  const weekly = limits.find((item) => item?.type === "TOKENS_LIMIT" && Number(item.unit) === 6);
  if (!fiveHour || !weekly) {
    throw new GlmTokenPlanError("GLM_RESPONSE_STRUCTURE_DRIFT", "GLM quota windows are missing");
  }
  return {
    level: String(data.level || "").toLowerCase(),
    quota_windows: [parseWindow(fiveHour, "rolling_5_hour"), parseWindow(weekly, "rolling_weekly")],
  };
}
```

- [ ] **Step 4: Add HTTP behavior tests**

```js
const { fetchGlmQuota } = require("../src/lib/glm-token-plan");

test("fetchGlmQuota sends the API key only to the official usage endpoint", async () => {
  const calls = [];
  const result = await fetchGlmQuota({
    apiKey: "glm-test-key",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(calls[0].url, "https://open.bigmodel.cn/api/monitor/usage/quota/limit");
  assert.equal(calls[0].options.headers.Authorization, "glm-test-key");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(result.quota_windows[1].remaining, 15_000_000);
});

test("fetchGlmQuota maps provider auth errors without including the key", async () => {
  await assert.rejects(
    fetchGlmQuota({
      apiKey: "glm-secret-key",
      fetchImpl: async () => new Response(JSON.stringify({ code: 1001, msg: "unauthorized" }), { status: 200 }),
    }),
    (error) => error.code === "GLM_REAUTH_REQUIRED" && !error.message.includes("glm-secret-key"),
  );
});
```

- [ ] **Step 5: Implement the bounded GET request**

```js
async function fetchGlmQuota({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 10_000 }) {
  if (!String(apiKey || "").trim()) {
    throw new GlmTokenPlanError("GLM_REAUTH_REQUIRED", "GLM API Key is missing");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(GLM_USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: String(apiKey).trim(),
        Accept: "application/json",
        "Accept-Language": "zh-CN,zh",
      },
      redirect: "manual",
      signal: controller.signal,
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new GlmTokenPlanError("GLM_RESPONSE_TOO_LARGE", "GLM response exceeded the size limit");
    }
    const payload = JSON.parse(text);
    if (response.status === 401 || response.status === 403 || [1001, 1002].includes(Number(payload?.code))) {
      throw new GlmTokenPlanError("GLM_REAUTH_REQUIRED", "GLM API Key is invalid or expired");
    }
    const businessCode = Number(payload?.code || 0);
    if (!response.ok || payload?.success === false || ![0, 200].includes(businessCode)) {
      throw new GlmTokenPlanError("GLM_PROVIDER_ERROR", "GLM usage endpoint returned an error");
    }
    return parseGlmQuotaResponse(payload);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new GlmTokenPlanError("GLM_TIMEOUT", "GLM usage request timed out");
    }
    if (error instanceof GlmTokenPlanError) throw error;
    throw new GlmTokenPlanError("GLM_NETWORK_ERROR", "Unable to query GLM usage");
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  GLM_USAGE_URL,
  GlmTokenPlanError,
  parseGlmQuotaResponse,
  fetchGlmQuota,
};
```

- [ ] **Step 6: Run tests and commit**

Run: `node --test test/glm-token-plan.test.js`

Expected: all GLM parser/client tests PASS.

```bash
git add src/lib/glm-token-plan.js test/glm-token-plan.test.js
git commit -m "feat: add GLM token plan usage client"
```

### Task 2: Persist Token Plan secrets in the OS vault

**Files:**
- Modify: `src/lib/local-api.js:1194-1205,1996-2008,4770-4810`
- Modify: `test/token-plans-api.test.js`

- [ ] **Step 1: Write a restart-persistence test**

```js
const { createInMemoryCredentialStore } = require("../src/lib/provider-api-secrets");

test("token plan secrets use the injected credential store across handler restarts", async () => {
  const credentialStore = createInMemoryCredentialStore();
  const first = createLocalApiHandler({ trackerDataDir, credentialStore });
  const save = await call(first, "/functions/tokentracker-token-plan-secrets", {
    method: "POST",
    headers: await getAuthHeaders(first),
    body: JSON.stringify({ provider_id: "glm", purpose: "usage-api", secret: "glm-key" }),
  });
  const ref = readJsonResponse(save).api_key_ref;
  assert.equal(credentialStore.readSecret(ref), "glm-key");

  const second = createLocalApiHandler({ trackerDataDir, credentialStore });
  assert.equal(second.__test?.resolveTokenPlanApiKey?.(ref), "glm-key");
});
```

Expose `resolveTokenPlanApiKey` only through the handler's existing test dependency surface; do not add a production HTTP read endpoint for secrets.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/token-plans-api.test.js`

Expected: FAIL because Token Plan secrets still use a process-local `Map`.

- [ ] **Step 3: Replace the process-local map with the existing credential vault**

Use the already-created `providerApiCredStore` for Token Plan secrets:

```js
function resolveTokenPlanApiKey(apiKeyRef) {
  if (!tokenPlanRefresh.isValidApiKeyRef(apiKeyRef)) return "";
  return providerApiCredStore.readSecret(apiKeyRef) || "";
}
```

In `POST /functions/tokentracker-token-plan-secrets`:

```js
if (!providerApiCredStore.isAvailable()) {
  json(res, {
    ok: false,
    error_code: "credential_store_unavailable",
    error: "安全凭据存储不可用，无法保存 GLM API Key",
  }, 503);
  return true;
}
const apiKeyRef = `token-plan/${providerId}/${purpose}/${crypto.randomUUID()}`;
const saved = providerApiCredStore.saveSecret(apiKeyRef, secret);
if (!saved.ok) {
  json(res, { ok: false, error_code: saved.error_code, error: "保存 API Key 失败" }, 503);
  return true;
}
json(res, { ok: true, api_key_ref: apiKeyRef, masked: saved.masked });
```

- [ ] **Step 4: Add no-leak and unavailable-store tests**

```js
test("token plan secret response never returns plaintext", async () => {
  const body = readJsonResponse(response);
  assert.equal(JSON.stringify(body).includes("glm-key"), false);
  assert.match(body.masked, /^••••/);
});

test("token plan secret save fails closed when secure storage is unavailable", async () => {
  const handler = createLocalApiHandler({ trackerDataDir, credentialStore: createUnavailableStore() });
  const response = await saveGlmSecret(handler, "glm-key");
  assert.equal(response.statusCode, 503);
  assert.equal(readJsonResponse(response).error_code, "credential_store_unavailable");
});
```

Also add a deletion test: deleting a Token Plan record with
`detection_config.official_account.api_key_ref` must call
`providerApiCredStore.deleteSecret(ref)`. Replacing that reference during an
update must delete the previous reference only after the new record is saved.

Use one narrow helper in `local-api.js`:

```js
function getTokenPlanSecretRefs(record) {
  return [
    record?.detection_config?.official_account?.api_key_ref,
    record?.detection_config?.custom_api?.api_key_ref,
  ].filter((ref) => tokenPlanRefresh.isValidApiKeyRef(ref));
}
```

After a successful replacement, delete refs present in the old record but not
the new record. After a successful record deletion, delete every returned ref.

- [ ] **Step 5: Run tests and commit**

Run: `node --test test/token-plans-api.test.js test/provider-api-security.test.js`

Expected: both suites PASS and no response contains the test secret.

```bash
git add src/lib/local-api.js test/token-plans-api.test.js
git commit -m "fix: persist token plan secrets securely"
```

### Task 3: Add GLM quota windows and provider-keyed refresh

**Files:**
- Modify: `src/lib/token-plan-refresh.js:55-57,384-395,555-615`
- Modify: `src/lib/local-api.js:1520-1640`
- Modify: `src/lib/token-plan-catalog/glm.catalog.json`
- Modify: `src/lib/token-plan-catalog/index.test.js`
- Modify: `test/token-plan-refresh.test.js`
- Modify: `test/token-plans-api.test.js`

- [ ] **Step 1: Write a failing provider-key lookup test**

```js
test("official detection selects adapters by provider_id before Agent source", async () => {
  registerProviderAdapter("glm", async () => ({
    quota_windows: [
      { kind: "rolling_5_hour", unit: "tokens", total: 100, used: 20, remaining: 80, percentage: 20, resets_at: "a" },
      { kind: "rolling_weekly", unit: "tokens", total: 500, used: 100, remaining: 400, percentage: 20, resets_at: "b" },
    ],
  }));
  const result = await refreshPlan({
    id: "glm-plan",
    source: "hermes",
    provider_id: "glm",
    detection_method: "official_account",
    refresh_method: "official_api",
  });
  assert.equal(result.status, "success");
  assert.equal(result.record.total_quota, 500);
  assert.equal(result.record.quota_windows.length, 2);
});
```

- [ ] **Step 2: Run refresh tests and verify RED**

Run: `node --test test/token-plan-refresh.test.js`

Expected: FAIL because adapter lookup still uses `plan.source`.

- [ ] **Step 3: Key adapters by provider with legacy fallback**

```js
function getProviderAdapterForPlan(plan) {
  const providerId = String(plan?.provider_id || "").trim().toLowerCase();
  if (providerId && PROVIDER_ADAPTERS.has(providerId)) return PROVIDER_ADAPTERS.get(providerId);
  return getProviderAdapter(plan?.source);
}
```

Use `getProviderAdapterForPlan(plan)` in both official-account and legacy official-API branches.

- [ ] **Step 4: Persist the GLM API-key reference in official detection config**

Extend `normalizeDetectionConfig` without ever accepting plaintext:

```js
const apiKeyRef = String(oa.api_key_ref || "").trim();
result.official_account = {
  provider_home_url: String(oa.provider_home_url || "").trim(),
  account_binding_id: String(oa.account_binding_id || "").trim(),
  api_key_ref: isValidApiKeyRef(apiKeyRef) ? apiKeyRef : "",
};
```

Add a test asserting a valid `token-plan/glm/usage-api/<uuid>` reference survives POST/GET while `api_key`, `authorization`, and `token` are still rejected recursively.

- [ ] **Step 5: Normalize quota windows in Token Plan records**

```js
function normalizeQuotaWindows(input, fallback = []) {
  const allowedKinds = new Set(["rolling_5_hour", "rolling_weekly"]);
  const source = Array.isArray(input) ? input : Array.isArray(fallback) ? fallback : [];
  const toSafeInteger = (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  };
  return source
    .filter((item) => item && allowedKinds.has(item.kind))
    .map((item) => ({
      kind: item.kind,
      unit: "tokens",
      total: toSafeInteger(item.total),
      used: toSafeInteger(item.used),
      remaining: toSafeInteger(item.remaining),
      percentage: Math.max(0, Math.min(100, Number(item.percentage) || 0)),
      resets_at: String(item.resets_at || ""),
    }));
}
```

Add `quota_windows` to normalized records. When an adapter returns a weekly window, mirror it into the existing flat quota fields and set `quota_source: "provider_reported"`.

- [ ] **Step 6: Enable five-minute background refresh for GLM**

Add `5` to `ALLOWED_INTERVALS`. The GLM form saves:

```js
refresh_enabled: true,
refresh_method: "official_api",
refresh_interval_minutes: 5,
```

Do not change the default interval for existing providers or legacy records.

- [ ] **Step 7: Correct the GLM static catalog semantics**

Change all three GLM catalog entries to dynamic token quotas:

```json
"quota": {
  "kind": "rolling_window",
  "total": 0,
  "unit": "tokens",
  "display": "官方动态额度（5 小时与每周窗口）"
}
```

Update the catalog test to expect `quota_unit: "tokens"` and `total_quota: 0`. The catalog identifies the purchased tier; live provider data supplies numeric limits.

- [ ] **Step 8: Add the built-in GLM adapter**

In `src/lib/glm-token-plan.js`:

```js
function createGlmProviderAdapter({ fetchImpl = globalThis.fetch } = {}) {
  return async function glmProviderAdapter(plan, { resolveApiKey } = {}) {
    const ref = plan?.detection_config?.official_account?.api_key_ref || "";
    const apiKey = resolveApiKey ? await resolveApiKey(ref) : "";
    const result = await fetchGlmQuota({ apiKey, fetchImpl });
    return { quota_windows: result.quota_windows, provider_reported_at: new Date().toISOString() };
  };
}
```

Register it once from `token-plan-refresh.js`:

```js
const glmTokenPlan = require("./glm-token-plan");
registerProviderAdapter("glm", glmTokenPlan.createGlmProviderAdapter());
```

Pass `resolveApiKey: opts.resolveApiKey` to provider adapters.

- [ ] **Step 9: Map GLM error codes without clearing snapshots**

Map `GLM_REAUTH_REQUIRED` to `sync_status: "reauth_required"`, `GLM_RESPONSE_STRUCTURE_DRIFT` to `unsupported`, and transient failures to `failed`. Preserve all previous quota and balance values.

- [ ] **Step 10: Run tests and commit**

Run:

```bash
node --test src/lib/token-plan-catalog/index.test.js test/glm-token-plan.test.js test/token-plan-refresh.test.js test/token-plans-api.test.js
```

Expected: all suites PASS.

```bash
git add src/lib/glm-token-plan.js src/lib/token-plan-refresh.js src/lib/local-api.js src/lib/token-plan-catalog/glm.catalog.json src/lib/token-plan-catalog/index.test.js test/glm-token-plan.test.js test/token-plan-refresh.test.js test/token-plans-api.test.js
git commit -m "feat: refresh GLM token plan quota windows"
```

### Task 4: Add the GLM official-console balance bridge

**Files:**
- Create: `src-tauri/src/glm_session.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/local-api.js:2030-2260,5260-5355`
- Modify: `test/token-plan-console-sessions.test.js`

- [ ] **Step 1: Write Rust tests for official domains and balance parsing**

```rust
#[test]
fn allows_only_bigmodel_console_hosts() {
    assert!(is_official_glm_url("https://www.bigmodel.cn/coding-plan/personal/usage"));
    assert!(is_official_glm_url("https://open.bigmodel.cn/login"));
    assert!(!is_official_glm_url("https://bigmodel.cn.evil.example/login"));
}

#[test]
fn maps_sanitized_balance_result() {
    let result = BalanceFetchResult {
        status: "success".into(),
        balance: Some(88.5),
        available_balance: Some(80.0),
        credit_balance: Some(8.5),
        currency: Some("CNY".into()),
        provider_reported_at: Some("2026-07-03T12:00:00.000Z".into()),
        error_code: None,
    };
    let status = map_balance_fetch_result_to_status("token-plan/glm/session/test", true, true, Some(&result));
    assert!(status.connected);
    assert_eq!(status.balance.unwrap().available_balance, 80.0);
}
```

- [ ] **Step 2: Run Rust tests and verify RED**

Run: `cargo test glm_session --manifest-path src-tauri/Cargo.toml`

Expected: FAIL because `glm_session` does not exist.

- [ ] **Step 3: Implement a restricted GLM WebView session**

Create the module with commands:

```rust
#[tauri::command]
pub async fn open_glm_console_login(app: AppHandle, session_ref: String) -> Result<GlmSessionStatus, String>;

#[tauri::command]
pub async fn verify_glm_console_session(app: AppHandle, session_ref: String) -> Result<GlmSessionStatus, String>;

#[tauri::command]
pub async fn delete_glm_console_session(app: AppHandle, session_ref: String) -> Result<(), String>;
```

Use `https://www.bigmodel.cn/coding-plan/personal/usage` as the login URL. Register an initialization script that:

```js
(function () {
  window.__tokenEyesGlmBalanceResult__ = null;
  window.__tokenEyesGlmBalanceFetch__ = async function () {
    if (window.location.hostname !== 'www.bigmodel.cn') return;
    const name = 'bigmodel_token_production=';
    const entry = document.cookie.split(';').map((v) => v.trim()).find((v) => v.startsWith(name));
    const authorization = entry ? decodeURIComponent(entry.slice(name.length)) : '';
    if (!authorization) {
      window.__tokenEyesGlmBalanceResult__ = { status: 'error', error_code: 'auth_required' };
      return;
    }
    const response = await fetch('/api/biz/account/query-customer-account-report', {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual',
      headers: { Authorization: authorization, Accept: 'application/json' }
    });
    const payload = await response.json();
    if ([1001, 1002].includes(Number(payload && payload.code))) {
      window.__tokenEyesGlmBalanceResult__ = { status: 'error', error_code: 'auth_required' };
      return;
    }
    const data = payload && payload.data;
    const balance = Number(data && data.balance);
    const available = Number(data && data.availableBalance);
    const credit = Number(data && data.creditBalance);
    if (![balance, available, credit].every(Number.isFinite)) {
      window.__tokenEyesGlmBalanceResult__ = { status: 'error', error_code: 'structure_drift' };
      return;
    }
    window.__tokenEyesGlmBalanceResult__ = {
      status: 'success',
      balance,
      available_balance: available,
      credit_balance: credit,
      currency: String(data.currency || 'CNY'),
      provider_reported_at: new Date().toISOString()
    };
  };
})();
```

The authorization value must never be returned by `eval_with_callback`, serialized, or logged. Verification reads only `window.__tokenEyesGlmBalanceResult__`.

- [ ] **Step 4: Register GLM state and commands**

In `src-tauri/src/lib.rs`:

```rust
mod glm_session;
use glm_session::GlmSessionState;

.manage(Mutex::new(GlmSessionState::default()))

glm_session::open_glm_console_login,
glm_session::verify_glm_console_session,
glm_session::delete_glm_console_session,
```

- [ ] **Step 5: Generalize local console bindings for GLM**

Change the allowlist to:

```js
const ALLOWED_CONSOLE_PROVIDER_IDS = new Set(["xiaomi_mimo", "glm"]);
```

Normalize an optional balance snapshot on session records:

```js
balance: native.balance ? {
  balance: Number(native.balance.balance),
  available_balance: Number(native.balance.available_balance),
  credit_balance: Number(native.balance.credit_balance),
  currency: String(native.balance.currency || "CNY"),
  provider_reported_at: String(native.balance.provider_reported_at || now),
} : fallback.balance || null,
```

Reject any extra native fields named `authorization`, `cookie`, `token`, `raw_response`, or `headers`.

- [ ] **Step 6: Add local API tests for sanitized GLM balance**

```js
test("GLM console verification stores only sanitized balance", async () => {
  const session = await createConsoleSession(handler, {
    provider_id: "glm",
    session_ref: "token-plan/glm/session/test",
  });
  const response = await verifyConsoleSession(handler, session.id, {
    connected: true,
    state_code: "connected",
    balance: {
      balance: 88.5,
      available_balance: 80,
      credit_balance: 8.5,
      currency: "CNY",
      provider_reported_at: "2026-07-03T12:00:00.000Z",
    },
  });
  const body = readJsonResponse(response);
  assert.equal(body.session.balance.available_balance, 80);
  assert.equal(/authorization|cookie|raw_response/i.test(JSON.stringify(body)), false);
});
```

- [ ] **Step 7: Run tests and commit**

Run:

```bash
cargo test glm_session --manifest-path src-tauri/Cargo.toml
node --test test/token-plan-console-sessions.test.js
```

Expected: both suites PASS.

```bash
git add src-tauri/src/glm_session.rs src-tauri/src/lib.rs src/lib/local-api.js test/token-plan-console-sessions.test.js
git commit -m "feat: add GLM console balance session"
```

### Task 5: Add GLM two-step setup and live state to Token Plan UI

**Files:**
- Modify: `dashboard/src/lib/api.ts:1140-1290`
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Write component tests for the GLM setup**

```jsx
it("shows API Key and official account steps for GLM", async () => {
  renderSectionWithCatalog(glmCatalog);
  await selectProvider("glm");
  expect(screen.getByLabelText(copy("settings.token_plan.glm.api_key"))).toBeEnabled();
  expect(screen.getByRole("button", { name: copy("settings.token_plan.glm.connect_account") })).toBeEnabled();
});

it("saves the GLM usage key before the plan record", async () => {
  renderSectionWithCatalog(glmCatalog);
  await configureGlmPlan({ apiKey: "glm-secret", planId: "glm_pro" });
  expect(api.saveTokenPlanSecret).toHaveBeenCalledWith({
    provider_id: "glm",
    purpose: "usage-api",
    secret: "glm-secret",
  });
  expect(api.saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
    detection_config: expect.objectContaining({
      official_account: expect.objectContaining({ api_key_ref: expect.stringMatching(/^token-plan\/glm\/usage-api\//) }),
    }),
  }));
});

it("renders both GLM quota windows and account balance", async () => {
  renderSectionWithRecords([glmLiveRecord], [glmConnectedSession]);
  expect(screen.getByText(/5 小时/)).toBeInTheDocument();
  expect(screen.getByText(/每周/)).toBeInTheDocument();
  expect(screen.getByText(/80.00 CNY/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the component tests and verify RED**

Run: `npm --prefix dashboard run test -- TokenPlanSection.test.jsx`

Expected: new GLM setup assertions FAIL.

- [ ] **Step 3: Add native API wrappers**

```ts
export type GlmBalanceSnapshot = {
  balance: number;
  available_balance: number;
  credit_balance: number;
  currency: string;
  provider_reported_at: string;
};

export async function openGlmConsoleLogin(sessionRef: string) {
  return invoke("open_glm_console_login", { sessionRef });
}

export async function verifyGlmConsoleSession(sessionRef: string) {
  return invoke("verify_glm_console_session", { sessionRef });
}

export async function deleteGlmConsoleSession(sessionRef: string) {
  return invoke("delete_glm_console_session", { sessionRef });
}
```

- [ ] **Step 4: Add provider-specific form behavior**

When `form.provider_id === "glm"` and detection is enabled:

- Save the API Key with purpose `usage-api`.
- Store only `api_key_ref` in `detection_config.official_account`.
- Create a GLM console binding and call the native open/verify wrappers.
- Save `account_binding_id` only after verification returns a sanitized balance.
- Keep usage and balance errors independent.

Do not add a separate settings card outside the existing Token Plan add/edit form.

- [ ] **Step 5: Render live windows and balance**

Add small provider-state rows inside the existing record card:

```jsx
{record.quota_windows?.map((window) => (
  <QuotaWindowRow key={window.kind} window={window} />
))}
{accountSession?.balance && (
  <BalanceRow
    value={accountSession.balance.available_balance}
    currency={accountSession.balance.currency}
    reportedAt={accountSession.balance.provider_reported_at}
  />
)}
```

Use existing design tokens and card styles. All user-facing strings go through `dashboard/src/content/copy.csv`.

- [ ] **Step 6: Add visible and background polling**

Use one effect per selected GLM plan:

```jsx
const [glmUsageError, setGlmUsageError] = useState("");
const [glmBalanceError, setGlmBalanceError] = useState("");

useEffect(() => {
  if (!glmPlanId || !glmSessionId || !glmSessionRef) return undefined;
  let cancelled = false;
  let inFlight = false;
  const refresh = async () => {
    if (cancelled || inFlight) return;
    inFlight = true;
    try {
      const usage = await refreshTokenPlan(glmPlanId);
      if (!cancelled) {
        setRecords(usage.records || []);
        setGlmUsageError("");
      }
    } catch (error) {
      if (!cancelled) setGlmUsageError(error instanceof Error ? error.message : String(error));
    }
    try {
      const nativeResult = await verifyGlmConsoleSession(glmSessionRef);
      const verified = await verifyConsoleSession(glmSessionId, nativeResult);
      if (!cancelled) {
        setConsoleSessions((current) => current.map((item) => (
          item.id === verified.session.id ? verified.session : item
        )));
        setGlmBalanceError("");
      }
    } catch (error) {
      if (!cancelled) setGlmBalanceError(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight = false;
    }
  };
  refresh();
  const interval = window.setInterval(refresh, document.visibilityState === "visible" ? 60_000 : 300_000);
  return () => {
    cancelled = true;
    window.clearInterval(interval);
  };
}, [glmPlanId, glmSessionId, glmSessionRef]);
```

Also listen for `visibilitychange` and recreate the interval so a hidden window uses 5 minutes and a visible page uses 60 seconds. Never allow overlapping refreshes.

- [ ] **Step 7: Run UI validation and commit**

Run:

```bash
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
```

Expected: all commands PASS.

```bash
git add dashboard/src/lib/api.ts dashboard/src/components/settings/TokenPlanSection.jsx dashboard/src/components/settings/TokenPlanSection.test.jsx dashboard/src/content/copy.csv
git commit -m "feat: add GLM live token plan setup"
```

### Task 6: End-to-end regression and production acceptance

**Files:**
- Modify only if a failing in-scope test exposes a defect in files already named above.

- [ ] **Step 1: Run all Token Plan tests**

```bash
node --test src/lib/token-plan-catalog/index.test.js test/glm-token-plan.test.js test/token-plan-refresh.test.js test/token-plan-custom-api.test.js test/token-plans-api.test.js test/token-plan-console-sessions.test.js test/serve-token-plan-scheduler.test.js
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: zero failures.

- [ ] **Step 2: Run project guardrails and builds**

```bash
npm run validate:guardrails
npm run validate:copy
npm run validate:ui-hardcode
npm run dashboard:build
npx tauri build --no-bundle
```

Expected: every command exits 0. Do not fix unrelated failures by changing unrelated files; report them separately.

- [ ] **Step 3: Inspect the final diff boundary**

Run:

```bash
git diff --check
git status --short
git diff --name-only HEAD~5..HEAD
```

Expected changed implementation files are limited to Token Plan catalog, Token Plan refresh/local API, GLM native session, Token Plan dashboard files, tests, and these design/plan documents.

- [ ] **Step 4: Perform real-account desktop acceptance**

With a real GLM Coding Plan account:

1. Enter the API Key and verify the displayed 5-hour and weekly limits against `https://www.bigmodel.cn/coding-plan/personal/usage`.
2. Confirm no chat/completion/model endpoint appears in network logs.
3. Complete official login and compare available balance against `https://www.bigmodel.cn/finance/overview`.
4. Restart Token Eyes and confirm the API Key remains usable without re-entry.
5. Revoke the key, then confirm `reauth_required` appears and previous values remain visible as stale.

Expected: all five checks pass before calling the feature production-ready.

- [ ] **Step 5: Review any acceptance-driven fixes without staging unrelated work**

Run:

```bash
git diff --check
git diff --name-only
git diff --cached --name-only
```

Expected: no whitespace errors and no unrelated staged files. Because the current worktree already contains overlapping user changes, do not create an additional acceptance commit unless the GLM-only hunks can be isolated without staging those existing changes. Report any uncommitted GLM fixes explicitly.
