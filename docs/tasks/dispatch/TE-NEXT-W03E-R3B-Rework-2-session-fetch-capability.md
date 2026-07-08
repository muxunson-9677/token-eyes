# W03E-R3B-Rework-2 SessionFetch Capability Development

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` before implementation. Execute only this work order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Token Eyes 桌面端实现 Tauri 2.x WebView 会话内安全 `sessionFetch` 能力，使用户在官方窗口登录后，Token Eyes 能在不导出 Cookie 的前提下查询小米 MiMo 官方额度。

**Architecture:** 利用 Tauri 2.x 的 `initialization_script`（页面加载前注入受控 JS）+ `on_navigation`（导航拦截，阻止非官方域名）+ `eval()`/事件机制（Rust 触发 JS 执行并接收结果）实现安全会话内 fetch。Cookie 始终留在 WebView 会话中，Rust 只接收脱敏 quota DTO。

**Tech Stack:** Tauri 2.8.2、Rust、WebView2 (Windows)、`window.__TAURI__.invoke` 事件机制、Node Test Runner。

---

## 0. 派发说明

本工单是 R3B 首轮 BLOCKED 结论后的解阻开发任务。R3B 首轮结论为 BLOCKED 的两个原因：

1. 缺少真实登录态网络证据 → 本工单不解决（需要用户配合提供 HAR 或实际登录测试）
2. 安全 sessionFetch 边界不可用 → **本工单解决这个**

本工单完成后，R3B 的第二个阻塞条件解除。第一个条件（真实证据）需要在 Windows 端由用户实际登录验证。

## 1. 技术方案（已由主调度者调研确认）

### Tauri 2.x 提供的三个核心 API

1. **`WebviewWindowBuilder::initialization_script(js)`** —— 在 WebView 加载每个新页面时自动注入 JS，在 `window.onload` 之前执行。不受页面 CSP 限制。
2. **`WebviewWindowBuilder::on_navigation(callback)`** —— 导航拦截回调，返回 `false` 阻止跳转到非官方域名。项目已有 `is_official_xiaomi_url()` 可复用。
3. **`webview.eval(js)` + `window.__TAURI__.invoke` 事件机制** —— Rust 调 `eval()` 在 WebView 里执行 JS，JS 通过 `invoke` 把结果传回 Rust。`eval` 本身不返回值，必须配合事件回传。

`tauri.conf.json` 已配置 `withGlobalTauri: true`，注入的 JS 可使用 `window.__TAURI__`。

### 安全边界

- Cookie 始终留在 WebView2 会话中，Rust 不读取、不持久化 Cookie
- `initialization_script` 注入的 JS 只调用官方额度接口，不读取页面 DOM、不读取 Cookie 值、不读取用户输入
- JS 只把额度数字（total/used/remaining）和同步时间通过 `invoke` 传回 Rust
- `on_navigation` 阻止跳转到非官方域名（复用 `is_official_xiaomi_url`）

### 工作流程

```
1. 用户在 Token Plan 表单选择 Xiaomi MiMo + official_account → 点"连接"
2. Rust 调 open_xiaomi_mimo_console_login → 打开 WebView 窗口加载小米官网
   - initialization_script 注入受控 JS（监听 invoke 指令）
   - on_navigation 拦截非官方域名
3. 用户在窗口内手动登录小米账号
4. 用户回到 Token Eyes 点"验证" → Rust 调 verify_xiaomi_mimo_console_session
5. verify 命令通过 eval() 在 WebView 内执行 fetch /api/v1/tokenPlan/usage
6. 注入的 JS 用同会话 Cookie 发起请求 → 拿到额度 JSON
7. JS 通过 invoke 把脱敏 quota DTO 传回 Rust
8. Rust 返回 { connected: true, quota: {...} } → UI 展示额度
```

## 2. 开始前必读

- `CLAUDE.md`
- `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md`（R3B 契约，含接口字段）
- `src-tauri/src/xiaomi_mimo_session.rs`（现有会话模块）
- `src-tauri/src/lib.rs`（命令注册）
- `src-tauri/Cargo.toml`（依赖）
- `src-tauri/tauri.conf.json`（CSP 和 withGlobalTauri 配置）

## 3. 允许修改的文件

- `src-tauri/src/xiaomi_mimo_session.rs`（核心修改）
- `src-tauri/src/lib.rs`（如需注册新命令或事件）
- `src-tauri/Cargo.toml` 和 `Cargo.lock`（如需新增依赖）
- `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md`（更新契约结论）
- `test/fixtures/xiaomi-mimo-console/`（脱敏响应 fixture）

禁止修改：
- `dashboard/` 下任何文件（UI 集成是 R3D 的工作）
- `src/lib/token-plan-refresh.js`、`src/lib/local-api.js`（adapter 是 R3C 的工作）
- `src/lib/token-plan-providers/`

## 4. Task 1：先写失败测试

在 `src-tauri/src/xiaomi_mimo_session.rs` 的测试模块中新增失败测试：

- [ ] `session_fetch_quota_returns_not_verified_when_window_closed`：会话窗口不存在时返回 `SessionNotFound`
- [ ] `session_fetch_quota_returns_awaiting_when_no_login_yet`：窗口存在但未登录时返回 `AwaitingVerification`（不是 connected）
- [ ] `session_fetch_quota_returns_connected_with_dto_on_success`：模拟 JS 回传成功 DTO 时返回 `connected: true` + quota 字段
- [ ] `session_fetch_quota_returns_reauth_on_401`：模拟 JS 回传 401 时返回 `reauth_required`
- [ ] `session_fetch_quota_returns_failed_on_network_error`：模拟 JS 回传网络错误时返回 `failed`
- [ ] `session_fetch_quota_returns_unsupported_on_invalid_structure`：模拟 JS 回传结构漂移时返回 `unsupported`
- [ ] `session_fetch_dto_does_not_contain_cookie_or_headers`：返回的 DTO 不含 cookie/header/token/raw_response 字段
- [ ] `initialization_script_does_not_read_cookie_or_dom`：注入的 JS 脚本字符串不含 `document.cookie`、`localStorage`、`getCookie` 等读取凭证的操作

运行：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml xiaomi_mimo_session
```

预期：新增测试因能力缺失而失败。

## 5. Task 2：实现 initialization_script + on_navigation

修改 `open_xiaomi_mimo_console_login`：

- [ ] 在 `WebviewWindowBuilder` 上添加 `.initialization_script(SESSION_FETCH_JS)`
- [ ] `SESSION_FETCH_JS` 内容：
  - 注册一个全局函数 `window.__tokenEyesSessionFetch__`
  - 该函数用 `fetch('/api/v1/tokenPlan/usage', { credentials: 'include' })` 发起同会话请求
  - 拿到响应后通过 `window.__TAURI__.invoke('xiaomi_mimo_quota_result', { ... })` 传回 Rust
  - **严禁** 读取 `document.cookie`、`localStorage`、`sessionStorage`、页面 DOM 或用户输入
  - 只传回 `{ status, total, used, remaining, expiresAt, providerReportedAt }` 或 `{ error, errorCode }`
- [ ] 添加 `.on_navigation(|url| { Ok(is_official_xiaomi_url(url.as_str())) })` 拦截非官方域名
- [ ] `SESSION_FETCH_JS` 作为常量字符串定义在模块顶部，便于测试审查

## 6. Task 3：实现 verify + fetch quota 命令

修改 `verify_xiaomi_mimo_console_session`：

- [ ] 不再固定返回 `DesktopSessionNotVerified`
- [ ] 改为通过 `webview.eval()` 触发注入的 `window.__tokenEyesSessionFetch__()`
- [ ] 监听 `xiaomi_mimo_quota_result` 事件接收 JS 回传的 DTO
- [ ] 根据回传结果映射状态：
  - 成功 + 有效结构 → `Connected` + quota DTO
  - 401/403 → `reauth_required`（保留旧额度，由 R3C 处理）
  - 结构无效 → `unsupported`
  - 网络错误/5xx → `failed`
  - 超时（如 10 秒无回传）→ `failed`
- [ ] 返回的 `XiaomiMimoSessionStatus` 新增可选 `quota` 字段（脱敏 DTO）
- [ ] `quota` 字段只含 `{ total_quota, used_quota, remaining_quota, expires_at, provider_reported_at }`，不含 cookie/header/token

如果 Tauri 2.8.2 的 `eval()` + 事件机制在当前环境不可用（编译错误或运行时不支持），记录具体限制并返回 BLOCKED，不要用 workaround 绕过。

## 7. Task 4：更新契约文档

更新 `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md`：

- [ ] 在结论部分新增 R3B-Rework-2 段落
- [ ] 记录 `quota_fetch_owner: tauri_webview_session_fetch`
- [ ] 记录 `callable_boundary: verify_xiaomi_mimo_console_session → eval → __tokenEyesSessionFetch__ → invoke event`
- [ ] 记录 `auth_boundary: Cookie 留在 WebView2 会话中，Rust 只接收脱敏 quota DTO`
- [ ] 更新 BLOCKED 结论：sessionFetch 能力已实现，仍需用户在 Windows 端实际登录验证（条件一）
- [ ] 如果本工单全部实现并通过测试，把 sessionFetch 阻塞条件标记为已解除

## 8. 验证命令

```powershell
cargo test --manifest-path src-tauri/Cargo.toml xiaomi_mimo_session
npm.cmd run validate:guardrails
rg -n "document\.cookie|localStorage|sessionStorage|getCookie|set-cookie" src-tauri/src/xiaomi_mimo_session.rs -i
git diff --check
```

敏感词扫描：
- `document.cookie` / `localStorage` / `sessionStorage` / `getCookie` 在 `SESSION_FETCH_JS` 中必须 0 命中
- `cookie` / `authorization` / `bearer` / `token=` 在返回 DTO 中必须 0 命中

如果修改了 Tauri 生产代码：

```powershell
npx.cmd tauri build --no-bundle
```

## 9. 禁止事项

- 不得读取、持久化或导出 Cookie/token/Authorization
- 不得在注入的 JS 中读取 `document.cookie`、`localStorage`、`sessionStorage` 或页面 DOM
- 不得修改 dashboard 或 Node 侧代码（R3D/R3C 的工作）
- 不得用 mock 数据冒充真实额度
- 不得把"窗口已打开"当成 connected
- 不得提交或清理共享工作区

## 10. 完成标准

- `initialization_script` 注入受控 JS，JS 不读取 Cookie/DOM
- `on_navigation` 拦截非官方域名
- `verify` 命令能通过 eval + 事件机制触发会话内 fetch 并接收结果
- 所有失败分支（401/结构无效/网络错误/超时）有测试
- 返回 DTO 不含敏感字段
- `cargo test xiaomi_mimo_session` 全部通过
- `validate:guardrails` 通过
- 契约文档更新

## 11. 返回模板

```markdown
## W03E-R3B-Rework-2 结果
- 结论：COMPLETED / BLOCKED
- sessionFetch 能力：已实现 / 不可用（原因）
- quota_fetch_owner：
- callable_boundary：

## 修改文件
- 路径与责任：

## 验证
- cargo test xiaomi_mimo_session：passed / failed 数量
- validate:guardrails：通过 / 失败
- 敏感词扫描：0 命中 / 有命中（逐条解释）

## 安全检查
- 注入 JS 是否读取 cookie/DOM：否
- 返回 DTO 是否含敏感字段：否
- Cookie 是否持久化：否

## 下一步
- R3B 条件一（真实登录态证据）是否解除：否（需用户在 Windows 端验证）
- R3C 是否可派发：否（需先完成 Windows 端真实登录验证）
```
