# Xiaomi MiMo Token Plan Auth Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 MiMo 官网登录产生的 `Failed to fetch`，在用户完成官方登录后自动读取真实额度、写入所选 Token 套餐并关闭登录窗口。

**Architecture:** 本地 API 修复跨 origin 认证边界；远程 MiMo WebView 只在页面内存保存脱敏额度，Rust 通过 `eval_with_callback` 读取，绝不向远程页面开放 Tauri IPC；React 用单个授权事务串行完成 pending session、打开窗口、自动验证、保存所选套餐和关闭窗口。

**Tech Stack:** React 18、Vitest、Node.js `node:test`、Tauri 2.11.3、Rust、Windows WebView2。

---

## 0. 执行边界

这是一个单工单，必须由同一个 subagent 串行执行全部任务，不得再派发子代理。

当前工作区包含大量用户未提交修改，且本功能依赖这些修改。不要创建基于 HEAD 的新 worktree，因为它会缺少 `src-tauri/src/xiaomi_mimo_session.rs` 等前置代码。

硬约束：

- 不得运行 `git reset`、`git checkout --`、`git clean`、递归删除或 stash。
- 不得提交、推送、创建 PR；主代理验收后决定提交范围。
- 不得修改本工单“允许修改”之外的文件。
- 不得格式化整个文件或清理无关乱码、注释、死代码。
- 每条生产代码都必须由本工单中的失败测试先行驱动。
- 如果连续三次不同修复仍无法通过同一验收点，停止并返回 `BLOCKED`，不要继续叠加补丁。

开始前必读：

- `CLAUDE.md`
- `docs/superpowers/specs/2026-06-28-xiaomi-mimo-token-plan-auth-sync-design.md`
- `src/lib/local-api.js`
- `test/token-plan-console-sessions.test.js`
- `src-tauri/src/xiaomi_mimo_session.rs`
- `src-tauri/src/lib.rs`
- `dashboard/src/lib/api.ts`
- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`

允许修改：

- `src/lib/local-api.js`
- `test/token-plan-console-sessions.test.js`
- `test/local-api-security.test.js`（只在本地认证响应头测试更适合放在这里时使用）
- `src-tauri/src/xiaomi_mimo_session.rs`
- `src-tauri/src/lib.rs`
- `dashboard/src/lib/api.ts`
- `dashboard/src/lib/api.test.ts`
- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- `dashboard/src/content/copy.csv`（只有新增用户可见文案时使用）
- `docs/test-reports/token-plan/2026-06-28-xiaomi-mimo-auth-sync.md`

禁止修改 Spend、Dashboard、pricing、catalog 配额、发布版本和无关测试。

## 1. 建立基线

- [ ] **Step 1: 记录工作区基线**

```powershell
git status --short
git diff -- src/lib/local-api.js test/token-plan-console-sessions.test.js src-tauri/src/xiaomi_mimo_session.rs src-tauri/src/lib.rs dashboard/src/lib/api.ts dashboard/src/components/settings/TokenPlanSection.jsx dashboard/src/components/settings/TokenPlanSection.test.jsx
```

把已有差异视为用户代码，不得回退。

- [ ] **Step 2: 运行针对性基线测试**

```powershell
node --test test/token-plan-console-sessions.test.js test/token-plans-api.test.js
cargo test --manifest-path src-tauri/Cargo.toml xiaomi_mimo_session
npm.cmd --prefix dashboard run test -- TokenPlanSection.test.jsx api.test.ts --run
```

预期：当前测试通过。测试通过不代表缺陷不存在；已知真实 Chromium 请求 `http://127.0.0.1:<port>/api/local-auth` 会因缺少 CORS 头抛出 `Failed to fetch`。

## 2. 修复本地认证 CORS 和 Tauri origin

**Files:**

- Modify: `test/token-plan-console-sessions.test.js`
- Modify: `src/lib/local-api.js`（`hasAllowedLoopbackOrigin`、`/api/local-auth`）

- [ ] **Step 1: 写失败测试——local-auth 响应可被 WebView 跨 origin 读取**

在 `test/token-plan-console-sessions.test.js` 增加：

```js
test("GET /api/local-auth exposes CORS without caching the token", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-local-auth-cors-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const res = await call(handler, "/api/local-auth", {
      headers: { origin: "http://127.0.0.1:5173" },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Access-Control-Allow-Origin"], "*");
    assert.equal(res.headers["Access-Control-Allow-Methods"], "GET, POST, PUT, DELETE, OPTIONS");
    assert.match(res.headers["Access-Control-Allow-Headers"], /X-TokenTracker-Local-Auth/i);
    assert.equal(res.headers["Cache-Control"], "no-store");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 写失败测试——打包 Tauri origin 可以执行认证后的本地写请求**

```js
test("POST console session accepts the packaged Tauri origin", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-tauri-origin-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;

    const res = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tokentracker-local-auth": token,
        origin: "http://tauri.localhost",
      },
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/tauri-origin-test",
      }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(readJsonResponse(res).session.status, "pending_login");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

保留现有“外部 origin 返回 401”的测试，作为反例。

- [ ] **Step 3: 运行测试确认 RED**

```powershell
node --test test/token-plan-console-sessions.test.js
```

预期：至少一个新测试失败；失败原因分别是 local-auth 缺少 CORS 头、`http://tauri.localhost` 被 origin 校验拒绝。

- [ ] **Step 4: 写最小实现**

在 `src/lib/local-api.js` 增加精确的受信任 origin 判断：

```js
function isAllowedLocalAppOrigin(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return true;
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname === "tauri.localhost") {
      return true;
    }
    return url.protocol === "tauri:" && url.hostname === "localhost";
  } catch (_e) {
    return false;
  }
}
```

让 `hasAllowedLoopbackOrigin` 对每个非空 `origin/referer` 调用该函数，仍然拒绝任意外部域名。

给 `/api/local-auth` 当前 `writeHead` 增加：

```js
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
"Access-Control-Allow-Headers": "Content-Type, Authorization, X-TokenTracker-Local-Auth",
```

保留 `"Cache-Control": "no-store"`。

- [ ] **Step 5: 运行测试确认 GREEN**

```powershell
node --test test/token-plan-console-sessions.test.js test/local-api-security.test.js
```

预期：全部通过；外部 origin 反例仍通过。

## 3. 用 eval 回调替代远程 Tauri IPC

**Files:**

- Modify: `src-tauri/src/xiaomi_mimo_session.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 写失败测试——注入脚本不再调用 Tauri IPC**

在 Rust 测试模块增加：

```rust
#[test]
fn initialization_script_keeps_quota_in_page_memory_without_remote_ipc() {
    let js = SESSION_FETCH_JS.to_lowercase();
    assert!(js.contains("__tokeneyesquotaresult__"));
    assert!(!js.contains("__tauri__"));
    assert!(!js.contains("invoke("));
    assert!(js.contains("platform.xiaomimimo.com"));
}
```

- [ ] **Step 2: 写失败测试——eval 返回值解析契约**

新增纯函数 `parse_quota_eval_result` 的测试：

```rust
#[test]
fn parse_quota_eval_result_accepts_success_object() {
    let raw = r#"{"status":"success","total":11000000000,"used":100,"remaining":10999999900,"expires_at":null,"provider_reported_at":"2026-06-28T00:00:00.000Z"}"#;
    let parsed = parse_quota_eval_result(raw).unwrap().unwrap();
    assert_eq!(parsed.status, "success");
    assert_eq!(parsed.total, Some(11_000_000_000.0));
    assert_eq!(parsed.used, Some(100.0));
}

#[test]
fn parse_quota_eval_result_treats_null_as_awaiting() {
    assert_eq!(parse_quota_eval_result("null").unwrap(), None);
}

#[test]
fn parse_quota_eval_result_rejects_non_object_values() {
    assert!(parse_quota_eval_result("\"unexpected\"").is_err());
}
```

为便于 `assert_eq!(Option<QuotaFetchResult>, None)`，可给 `QuotaFetchResult` 派生 `PartialEq`；不要为了测试增加生产后门。

- [ ] **Step 3: 运行测试确认 RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml xiaomi_mimo_session
```

预期：新测试因脚本仍含 `window.__TAURI__.invoke`、解析函数不存在而失败。

- [ ] **Step 4: 改写 SESSION_FETCH_JS**

保持现有端点和缩放规则，但只写页面内存：

```js
(function () {
  window.__tokenEyesQuotaResult__ = null;
  window.__tokenEyesSessionFetch__ = async function () {
    if (window.location.hostname !== 'platform.xiaomimimo.com') return;
    try {
      var resp = await fetch('/api/v1/tokenPlan/usage', { credentials: 'include' });
      if (resp.status === 401 || resp.status === 403) {
        window.__tokenEyesQuotaResult__ = {
          status: 'error', error: 'auth_required', error_code: String(resp.status)
        };
        return;
      }
      if (!resp.ok) {
        window.__tokenEyesQuotaResult__ = {
          status: 'error',
          error: resp.status >= 500 ? 'server_error' : 'http_error',
          error_code: String(resp.status)
        };
        return;
      }
      var json = await resp.json();
      var items = json && json.data && json.data.usage && json.data.usage.items;
      var planItem = Array.isArray(items)
        ? items.find(function (item) { return item.name === 'plan_total_token'; })
        : null;
      if (!planItem) {
        window.__tokenEyesQuotaResult__ = {
          status: 'error', error: 'structure_drift', error_code: 'parse_error'
        };
        return;
      }
      var scale = 100000000;
      var total = Number(planItem.limit) / scale;
      var used = Number(planItem.used) / scale;
      window.__tokenEyesQuotaResult__ = {
        status: 'success',
        total: total,
        used: used,
        remaining: total - used,
        expires_at: null,
        provider_reported_at: new Date().toISOString()
      };
    } catch (_error) {
      window.__tokenEyesQuotaResult__ = {
        status: 'error', error: 'network_error', error_code: 'network_error'
      };
    }
  };
  if (window.location.hostname === 'platform.xiaomimimo.com') {
    window.__tokenEyesSessionFetch__();
  }
})();
```

字段必须使用 Rust struct 已定义的 snake_case 名称。

- [ ] **Step 5: 实现纯解析函数**

```rust
fn parse_quota_eval_result(raw: &str) -> Result<Option<QuotaFetchResult>, String> {
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| format!("Unable to parse MiMo quota result: {error}"))?;
    if value.is_null() {
        return Ok(None);
    }
    if !value.is_object() {
        return Err("MiMo quota result must be an object or null".to_string());
    }
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("Invalid MiMo quota result: {error}"))
}
```

- [ ] **Step 6: 改写 verify 命令读取 eval 回调**

保留 active session、窗口存在性和域名检查。删除 `pending_quota_result` 轮询和 `xiaomi_mimo_quota_result` IPC 命令路径。

核心结构：

```rust
let (sender, receiver) = std::sync::mpsc::sync_channel(1);
window
    .as_ref()
    .expect("window checked above")
    .eval_with_callback(
        "window.__tokenEyesQuotaResult__ || null",
        move |value| {
            let _ = sender.send(value);
        },
    )
    .map_err(|error| format!("Unable to inspect MiMo login state: {error}"))?;

let raw = tauri::async_runtime::spawn_blocking(move || {
    receiver.recv_timeout(QUOTA_FETCH_TIMEOUT)
})
.await
.map_err(|error| format!("MiMo quota callback task failed: {error}"))?
.ok();

let result = match raw {
    Some(raw) => parse_quota_eval_result(&raw)?,
    None => None,
};
```

把 `result.as_ref()` 传给现有 `map_quota_fetch_result_to_status`。verify 成功时不要立即关窗；窗口必须在前端确认套餐和 session 均写入后再关闭。

从 `src-tauri/src/lib.rs` 移除 `xiaomi_mimo_quota_result` 注册，并删除对应 command。保留 `delete_xiaomi_mimo_console_session` 作为成功后的关闭/释放命令。

- [ ] **Step 7: 运行 Rust 测试确认 GREEN**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml xiaomi_mimo_session
```

预期：全部通过，且不新增 warning。

## 4. 消除后端重复套餐写入

**Files:**

- Modify: `test/token-plan-console-sessions.test.js`
- Modify: `src/lib/local-api.js`

- [ ] **Step 1: 写失败测试——verify 只更新 session，不隐式创建错误套餐**

增加一个测试：创建 pending session，不预建套餐；发送 `connected + quota` 的 native result；断言 session 为 connected，同时 `GET /functions/tokentracker-token-plans` 中没有由后端生成的 `source: cursor`、`plan_id: custom` 记录。

核心断言：

```js
assert.equal(verifyBody.session.status, "connected");
const plans = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans"));
assert.equal(plans.records.some((record) =>
  record.provider_id === "xiaomi_mimo"
  && record.detection_config?.official_account?.account_binding_id === createdSession.id
), false);
```

- [ ] **Step 2: 运行测试确认 RED**

```powershell
node --test test/token-plan-console-sessions.test.js
```

预期：当前 `syncConsoleSessionQuotaToPlan` 会创建硬编码 fallback 套餐，测试失败。

- [ ] **Step 3: 写最小实现**

从 `verifyConsoleSessionById` 成功分支移除 `syncConsoleSessionQuotaToPlan(...)` 调用，并删除仅由该调用使用的 helper。verify API 只持久化 session 状态；套餐由 React 使用用户当前选择的 source/plan 单独写入。

- [ ] **Step 4: 运行测试确认 GREEN**

```powershell
node --test test/token-plan-console-sessions.test.js test/token-plans-api.test.js
```

预期：全部通过；session 与套餐写入职责分离。

## 5. 补齐前端 API 类型

**Files:**

- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/api.test.ts`

- [ ] **Step 1: 写失败测试——Tauri wrapper 使用正确命令和参数**

扩展 `dashboard/src/lib/api.test.ts` 的 import，并设置 Tauri mock：

```ts
it("invokes the Xiaomi MiMo native commands with camelCase arguments", async () => {
  const invoke = vi.fn()
    .mockResolvedValueOnce({ connected: false, state_code: "login_started" })
    .mockResolvedValueOnce({
      connected: true,
      state_code: "connected",
      quota: { total_quota: 100, used_quota: 25, remaining_quota: 75 },
    });
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { core: { invoke } },
  });

  await openXiaomiMimoConsoleLogin("session-ref");
  await verifyXiaomiMimoConsoleSession("session-ref");

  expect(invoke).toHaveBeenNthCalledWith(1, "open_xiaomi_mimo_console_login", {
    sessionRef: "session-ref",
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "verify_xiaomi_mimo_console_session", {
    sessionRef: "session-ref",
  });
});
```

- [ ] **Step 2: 运行测试确认 RED 或契约缺口**

```powershell
npm.cmd --prefix dashboard run test -- api.test.ts --run
```

如果调用测试立即通过，保留它作为回归测试；随后 `npm.cmd --prefix dashboard run typecheck` 必须暴露 quota 类型缺口，不能通过删除断言制造 RED。

- [ ] **Step 3: 定义脱敏 quota 类型**

```ts
export interface XiaomiMimoQuota {
  total_quota: number;
  used_quota: number;
  remaining_quota: number;
  expires_at?: string | null;
  provider_reported_at?: string;
}

export interface NativeSessionResult {
  connected: boolean;
  session_ref: string;
  state_code: string;
  error_code: string;
  error_message: string;
  quota?: XiaomiMimoQuota;
}

export interface XiaomiMimoSessionStatus extends NativeSessionResult {}
```

不得加入 cookie、headers、raw response 或 credential 字段。

- [ ] **Step 4: 运行测试和类型检查确认 GREEN**

```powershell
npm.cmd --prefix dashboard run test -- api.test.ts --run
npm.cmd --prefix dashboard run typecheck
```

## 6. 实现单事务自动授权、同步和关窗

**Files:**

- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Modify: `dashboard/src/content/copy.csv`（仅当现有 copy key 无法表达错误时）

- [ ] **Step 1: 更新测试 mock**

在测试 import/mock 中加入现有 API：

```js
deleteConsoleSession,
deleteXiaomiMimoConsoleSession,
```

在 `beforeEach` 中设置：

```js
deleteConsoleSession.mockResolvedValue({ ok: true });
deleteXiaomiMimoConsoleSession.mockResolvedValue(undefined);
verifyConsoleSession.mockImplementation(async (_id, nativeResult) => ({
  ok: true,
  session: makeXiaomiSession({
    id: "new-session-id",
    session_ref: nativeResult.session_ref,
    status: nativeResult.connected ? "connected" : "awaiting_verification",
  }),
}));
```

- [ ] **Step 2: 写失败测试——未选 Agent 来源不启动授权**

按现有测试方式打开表单，选择 MiMo、Standard 月付和 official_account，但不选择 Agent 来源。点击连接后断言：

```js
expect(createConsoleSession).not.toHaveBeenCalled();
expect(openXiaomiMimoConsoleLogin).not.toHaveBeenCalled();
expect(screen.getByText(/Agent 来源/)).toBeInTheDocument();
```

如果现有 copy registry 没有合适提示，新增一个精准 key，例如 `settings.token_plan.console_session.source_required`，并通过 `copy(...)` 使用。

- [ ] **Step 3: 写失败测试——调用顺序和自动完成**

设置调用记录：

```js
const order = [];
createConsoleSession.mockImplementation(async (params) => {
  order.push("create-session");
  return {
    session: makeXiaomiSession({ id: "new-session-id", session_ref: params.session_ref }),
    sessions: [makeXiaomiSession({ id: "new-session-id", session_ref: params.session_ref })],
  };
});
openXiaomiMimoConsoleLogin.mockImplementation(async () => {
  order.push("open-window");
  return { connected: false, state_code: "login_started" };
});
verifyXiaomiMimoConsoleSession.mockImplementation(async (sessionRef) => {
  order.push("verify-native");
  return {
    connected: true,
    session_ref: sessionRef,
    state_code: "connected",
    error_code: "",
    error_message: "",
    quota: {
      total_quota: 11_000_000_000,
      used_quota: 1_000_000_000,
      remaining_quota: 10_000_000_000,
      expires_at: null,
      provider_reported_at: "2026-06-28T00:00:00.000Z",
    },
  };
});
verifyConsoleSession.mockImplementation(async () => {
  order.push("verify-backend");
  return { ok: true, session: makeXiaomiSession({ id: "new-session-id", status: "connected" }) };
});
saveTokenPlan.mockImplementation(async (record) => {
  order.push("save-plan");
  return { ok: true, record: { ...record, id: "plan-mimo" }, records: [{ ...record, id: "plan-mimo" }] };
});
deleteXiaomiMimoConsoleSession.mockImplementation(async () => {
  order.push("close-window");
});
```

选择 Agent `hermes`、MiMo、Standard 月付、official_account 后点击连接。等待完成并断言：

```js
expect(order).toEqual([
  "create-session",
  "open-window",
  "verify-native",
  "verify-backend",
  "save-plan",
  "close-window",
]);
expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
  source: "hermes",
  provider_id: "xiaomi_mimo",
  plan_id: "xiaomi_mimo_standard_monthly",
  used_quota: 1_000_000_000,
  remaining_quota: 10_000_000_000,
  detection_method: "official_account",
}));
expect(screen.queryByText("新增 Token 套餐")).not.toBeInTheDocument();
```

该测试不得点击手动“验证”按钮。

- [ ] **Step 4: 写失败测试——本地 session 创建失败时不打开窗口**

```js
createConsoleSession.mockRejectedValue(new Error("Failed to fetch"));
// 完成必填选择并点击连接
await waitFor(() => expect(screen.getByText("Failed to fetch")).toBeInTheDocument());
expect(openXiaomiMimoConsoleLogin).not.toHaveBeenCalled();
```

- [ ] **Step 5: 写失败测试——原生窗口打开失败时回滚 pending session**

```js
openXiaomiMimoConsoleLogin.mockRejectedValue(new Error("window failed"));
// 完成必填选择并点击连接
await waitFor(() => expect(deleteConsoleSession).toHaveBeenCalledWith("new-session-id"));
expect(saveTokenPlan).not.toHaveBeenCalled();
```

- [ ] **Step 6: 写失败测试——套餐保存失败时不关闭窗口、不显示成功**

原生验证返回 connected + quota，`saveTokenPlan` reject：

```js
saveTokenPlan.mockRejectedValue(new Error("save failed"));
await waitFor(() => expect(screen.getByText("save failed")).toBeInTheDocument());
expect(deleteXiaomiMimoConsoleSession).not.toHaveBeenCalled();
expect(screen.queryByTestId("detection-connected")).not.toBeInTheDocument();
```

- [ ] **Step 7: 运行测试确认 RED**

```powershell
npm.cmd --prefix dashboard run test -- TokenPlanSection.test.jsx --run
```

预期：新测试因当前顺序是先开窗口后建 session、没有自动验证循环、没有必填校验和成功关窗而失败。

- [ ] **Step 8: 实现最小授权事务**

在组件内增加常量和等待 helper：

```js
const XIAOMI_AUTH_POLL_MS = 1000;
const XIAOMI_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
```

将 `handleConnectXiaomiMimo` 改为以下顺序：

```js
if (!form.source) {
  setConsoleSessionError(copy("settings.token_plan.console_session.source_required"));
  return;
}

const sessionRef = `token-plan/xiaomi_mimo/session/${crypto.randomUUID()}`;
let createdSession = null;
let windowOpened = false;

try {
  const created = await createConsoleSession({
    provider_id: "xiaomi_mimo",
    auth_kind: "official_console_session",
    display_name: copy("settings.token_plan.console_session.mimo_display_name"),
    session_ref: sessionRef,
  });
  createdSession = created.session;
  setConsoleSessions(Array.isArray(created.sessions) ? created.sessions : []);

  await openXiaomiMimoConsoleLogin(sessionRef);
  windowOpened = true;

  const deadline = Date.now() + XIAOMI_AUTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const nativeStatus = await verifyXiaomiMimoConsoleSession(sessionRef);
    if (nativeStatus?.connected && nativeStatus?.quota) {
      const nativeResult = {
        connected: true,
        session_ref: nativeStatus.session_ref || sessionRef,
        state_code: "connected",
        error_code: "",
        error_message: "",
        quota: nativeStatus.quota,
      };
      const verified = await verifyConsoleSession(createdSession.id, nativeResult);
      const accountBindingId = verified.session?.id || createdSession.id;
      const now = new Date().toISOString();
      const saved = await saveTokenPlan({
        ...form,
        used_quota: Number(nativeStatus.quota.used_quota || 0),
        remaining_quota: Number(nativeStatus.quota.remaining_quota || 0),
        total_quota: Number(nativeStatus.quota.total_quota || form.total_quota || 0),
        expires_at: nativeStatus.quota.expires_at || form.expires_at || "",
        detection_method: "official_account",
        detection_config: {
          ...form.detection_config,
          official_account: {
            ...form.detection_config.official_account,
            account_binding_id: accountBindingId,
          },
        },
        sync_status: "success",
        last_synced_at: now,
        last_sync_attempt_at: now,
        last_error_code: "",
        last_error_message: "",
      });
      await deleteXiaomiMimoConsoleSession(sessionRef);
      setConsoleSessions((previous) => previous.map((session) =>
        session.id === accountBindingId ? verified.session : session
      ));
      setRecords(normalizeRecords(saved.records));
      setForm(EMPTY_FORM);
      setFormOpen(false);
      setSavedNotice(true);
      return;
    }

    if (nativeStatus?.state_code === "session_not_found") {
      throw new Error(nativeStatus.error_message || copy("settings.token_plan.console_session.window_closed"));
    }
    if (["unsupported", "failed"].includes(nativeStatus?.state_code)) {
      throw new Error(nativeStatus.error_message || copy("settings.token_plan.console_session.verify_error"));
    }
    await wait(XIAOMI_AUTH_POLL_MS);
  }
  throw new Error(copy("settings.token_plan.console_session.timeout"));
} catch (error) {
  if (createdSession && !windowOpened) {
    await deleteConsoleSession(createdSession.id).catch(() => {});
  }
  setConsoleSessionError(error?.message || copy("settings.token_plan.console_session.connect_error"));
} finally {
  setConnectingConsole(false);
}
```

这段代码是行为骨架；必须按现有变量名和 copy key 做最小适配。不要保留旧的 `autoSyncXiaomiMimoPlan` 重复写入路径。删除手动验证按钮或确保正常授权流程不再依赖它；保留已连接/失败状态展示。

初次授权时 `reauth_required` 表示用户尚未登录，继续轮询直到超时；后续刷新已有连接时仍可显示重新登录。

- [ ] **Step 9: 运行 UI 测试确认 GREEN**

```powershell
npm.cmd --prefix dashboard run test -- TokenPlanSection.test.jsx --run
```

预期：全部通过，无 act warning、未处理 Promise 或定时器泄漏。

- [ ] **Step 10: 校验文案**

若新增了 `source_required`、`window_closed`、`timeout`，将中文和英文文案注册到 `dashboard/src/content/copy.csv`，然后运行：

```powershell
npm.cmd run validate:copy
npm.cmd run validate:ui-hardcode
```

## 7. 完整自动化验证

- [ ] **Step 1: 运行针对性测试**

```powershell
npm.cmd --prefix dashboard run test -- TokenPlanSection.test.jsx api.test.ts --run
node --test test/token-plan-console-sessions.test.js test/local-api-security.test.js test/token-plans-api.test.js
cargo test --manifest-path src-tauri/Cargo.toml xiaomi_mimo_session
```

- [ ] **Step 2: 运行静态验证**

```powershell
npm.cmd --prefix dashboard run typecheck
npm.cmd run validate:copy
npm.cmd run validate:ui-hardcode
npm.cmd run validate:guardrails
git diff --check
```

- [ ] **Step 3: 运行构建**

```powershell
npm.cmd run dashboard:build
npx.cmd tauri build --no-bundle
```

- [ ] **Step 4: 运行安全扫描**

```powershell
rg -n "document\.cookie|localStorage|sessionStorage|getCookie|window\.__TAURI__|invoke\(" src-tauri/src/xiaomi_mimo_session.rs -i
```

预期：生产 `SESSION_FETCH_JS` 中没有 Cookie/Storage/DOM/remote IPC 读取。测试中的禁止词断言可以命中，必须逐条确认只出现在测试或安全注释中。

## 8. 报告与交接

**File:**

- Create: `docs/test-reports/token-plan/2026-06-28-xiaomi-mimo-auth-sync.md`

- [ ] **Step 1: 写自动化验收报告**

报告必须包含：

```markdown
# Xiaomi MiMo 授权同步验收报告

## 结论
- 自动化：PASSED / FAILED
- Windows 真实登录：PENDING USER ACCEPTANCE / PASSED

## 根因与修复
- local-auth CORS：
- 远程 WebView IPC：
- 自动授权事务：

## 修改文件
- 路径：职责

## 验证命令
- 命令：通过数 / 失败数

## 安全检查
- Cookie 是否离开 WebView：否
- 远程页面是否获得 Tauri IPC：否
- DTO 是否含敏感字段：否

## 人工验收步骤
1. 选择 Agent 来源、MiMo 套餐和官网账号登录检测。
2. 点击连接并完成官方登录。
3. 确认窗口自动关闭。
4. 对比套餐面板与官方页面额度。
```

没有用户真实登录证据时必须写 `PENDING USER ACCEPTANCE`，不能写端到端通过。

- [ ] **Step 2: 最终自审**

```powershell
git status --short
git diff --stat
git diff -- src/lib/local-api.js test/token-plan-console-sessions.test.js test/local-api-security.test.js src-tauri/src/xiaomi_mimo_session.rs src-tauri/src/lib.rs dashboard/src/lib/api.ts dashboard/src/lib/api.test.ts dashboard/src/components/settings/TokenPlanSection.jsx dashboard/src/components/settings/TokenPlanSection.test.jsx dashboard/src/content/copy.csv docs/test-reports/token-plan/2026-06-28-xiaomi-mimo-auth-sync.md
```

逐行确认每个变更都能追溯到本工单。不得提交。向主代理返回：

```markdown
STATUS: DONE / DONE_WITH_CONCERNS / BLOCKED

CHANGED:
- 文件与职责

RED-GREEN EVIDENCE:
- 每组失败测试的预期失败原因
- 修复后的通过数

VERIFICATION:
- 测试、typecheck、validators、build 结果

MANUAL ACCEPTANCE:
- PENDING USER ACCEPTANCE

CONCERNS:
- 无 / 具体风险
```
