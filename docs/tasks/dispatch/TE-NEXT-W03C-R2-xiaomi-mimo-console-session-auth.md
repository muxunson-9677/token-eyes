# TE-NEXT-W03C-R2：小米 MiMo 控制台授权会话

## 任务目标

实现桌面端“连接小米 MiMo 控制台账号”的能力，让用户在官方登录页面完成授权后，Token Eyes 可以保存一个受控的本地会话引用，用于后续实时同步 Token Plan 状态。

本工单不实现额度解析，不实现手动录入主路径。它只负责建立安全、可撤销、可验证的官方控制台会话。

## 必须遵守的需求边界

- 主目标是实时同步，不是手动记录。
- 登录必须发生在小米官方页面，应用不得收集账号密码、验证码、二维码内容。
- 不读取 Chrome、Edge、Firefox 等外部浏览器 Cookie 数据库。
- 不让用户复制粘贴 Cookie 作为主路径。
- 不把 Cookie、token、账号密码写入 `tracker-config.json`、日志、前端状态、API 响应或测试截图。
- 用户必须能删除授权；删除后同步功能不可继续使用。

## 开始前必读

1. `CLAUDE.md`
2. `docs/tasks/dispatch/TE-NEXT-W03-R2-live-quota-dispatch-order.md`
3. `docs/dev-notes/xiaomi-mimo-plan-contract-2026-06-25.md`
4. `src-tauri/src/lib.rs`
5. `src-tauri/src/commands.rs`
6. `src-tauri/tauri.conf.json`
7. `src/lib/local-api.js`
8. `dashboard/src/lib/api.ts`
9. `dashboard/src/components/settings/TokenPlanSection.jsx`
10. `dashboard/src/content/copy.csv`

## 推荐架构

新增一个桌面端小米控制台会话模块：

- Tauri 侧负责打开官方登录窗口，域名限定为 `platform.xiaomimimo.com` 和必要的官方登录跳转域名。
- 会话存储在应用隔离的 WebView 会话容器或系统安全存储中。
- Node 本地 API 只保存绑定元数据，不保存会话密文。
- 前端只展示连接状态，不展示任何凭证。

绑定元数据结构固定为：

```js
{
  id: "uuid",
  provider_id: "xiaomi_mimo",
  auth_kind: "official_console_session",
  display_name: "小米 MiMo 控制台账号",
  status: "connected|expired|revoked|failed",
  session_ref: "token-plan/xiaomi_mimo/session/<uuid>",
  connected_at: "2026-06-25T00:00:00.000Z",
  last_verified_at: "",
  last_error_code: "",
  last_error_message: ""
}
```

`session_ref` 是引用，不是 Cookie 值。

## 允许修改的文件

- 新增：`src-tauri/src/xiaomi_mimo_session.rs`
- 修改：`src-tauri/src/lib.rs`
- 修改：`src-tauri/src/commands.rs`
- 修改：`src-tauri/tauri.conf.json`
- 新增：`src/lib/token-plan-console-sessions.js`
- 新增：`test/token-plan-console-sessions.test.js`
- 修改：`src/lib/local-api.js`
- 修改：`test/token-plans-api.test.js`
- 修改：`dashboard/src/lib/api.ts`
- 修改：`dashboard/src/components/settings/TokenPlanSection.jsx`
- 修改：`dashboard/src/components/settings/TokenPlanSection.test.jsx`
- 修改：`dashboard/src/content/copy.csv`
- 修改：`dashboard/src/content/i18n/zh/dashboard.json`，仅在文案同步流程需要时修改

不要修改套餐目录 JSON，不要修改 Spend 页面，不要修改 Agent parser。

## 任务 1：先写会话元数据测试

新增 `test/token-plan-console-sessions.test.js`，覆盖以下行为：

1. 创建绑定只保存 `session_ref`，不保存 Cookie 原文。
2. 列表接口不返回任何 `cookie`、`authorization`、`token` 字段。
3. 删除绑定会删除会话引用。
4. 非桌面环境创建绑定返回 `desktop_required`。
5. 未授权本地请求返回 `401`。

运行：

```powershell
node --test test/token-plan-console-sessions.test.js
```

预期：实现前失败，实现后通过。

## 任务 2：实现本地会话绑定 API

在 `src/lib/local-api.js` 增加本地 API：

```text
GET    /functions/tokentracker-token-plan-console-sessions
POST   /functions/tokentracker-token-plan-console-sessions
DELETE /functions/tokentracker-token-plan-console-sessions?id=<session-id>
POST   /functions/tokentracker-token-plan-console-sessions/<session-id>/verify
```

要求：

- 所有写操作必须通过本地授权校验。
- 只允许 `provider_id: "xiaomi_mimo"`。
- `auth_kind` 固定为 `official_console_session`。
- API 响应不得包含 Cookie、token、登录态正文。
- 删除时必须清理原生侧会话或安全存储引用。

## 任务 3：实现桌面端登录入口

在 Tauri 侧实现最小命令：

```rust
open_xiaomi_mimo_console_login(session_ref: String) -> Result<XiaomiMimoSessionStatus, String>
verify_xiaomi_mimo_console_session(session_ref: String) -> Result<XiaomiMimoSessionStatus, String>
delete_xiaomi_mimo_console_session(session_ref: String) -> Result<(), String>
```

行为要求：

- 打开官方控制台登录页，例如 `https://platform.xiaomimimo.com/console/balance` 或官方跳转后的控制台页。
- 登录窗口标题和说明必须明确告诉用户：这是小米官方页面，Token Eyes 不收集密码。
- 只允许官方域名加载；如果跳转到非官方域名，显示失败并停止。
- 验证会话时，只检查是否已经进入控制台或能访问控制台页面，不读取额度字段。
- 错误信息要中文可读，但不得包含响应体、请求头、Cookie。

## 任务 4：前端接入“连接小米 MiMo 控制台”

在 Token 套餐设置中增加连接入口：

- 未连接：显示“连接小米 MiMo 控制台账号”。
- 连接中：显示官方登录窗口已打开。
- 已连接：显示连接状态、最后验证时间、重新验证、删除连接。
- 连接失败：显示失败原因和重试入口。

要求：

- 不显示 Cookie 输入框。
- 不显示“Cookie 抓取”。
- 不要求用户手填 `credential_ref`。
- 网页/Vite 环境显示“该功能仅桌面端支持”，不能伪造成功。

## 最终验证

运行：

```powershell
node --test test/token-plan-console-sessions.test.js test/token-plans-api.test.js
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npx tauri build --no-bundle
```

人工验证：

1. 桌面端点击“连接小米 MiMo 控制台账号”。
2. 官方登录页打开。
3. 用户完成登录后，Token Eyes 显示已连接。
4. 删除连接后，状态变为未连接。
5. 检查本地配置、日志、API 响应，确认没有 Cookie 或 token 原文。

## 验收标准

- 用户能通过官方页面完成小米控制台连接。
- 应用保存的是会话引用和状态，不是明文 Cookie。
- 删除连接后不能继续同步。
- 网页环境不能创建假连接。
- 所有验证命令通过。

## 禁止事项

- 不读取外部浏览器 Cookie。
- 不模拟输入账号密码。
- 不绕过验证码或风控。
- 不把手动 Cookie 粘贴作为主流程。
- 不在本工单中实现额度字段解析。
