# Cursor 官方同步调研记录

日期：2026-07-08（WebView 路径已更新）

## 官方数据源

| 数据 | 端点 | 认证 |
|------|------|------|
| 账单周期用量摘要 | `GET https://cursor.com/api/usage-summary` | WebView 同会话 Cookie（`credentials: include`） |
| 登录页 | `https://www.cursor.com/settings` | 无需本机 Cursor IDE |

## 额度响应字段

- `individualUsage.plan.totalPercentUsed` / `autoPercentUsed` / `apiPercentUsed`
- `teamUsage.onDemand`：团队/企业池化额度
- `billingCycleEnd`：账单周期结束（映射为 `resets_at`）
- **无独立 5 小时窗口**；主窗口为账单周期用量百分比

## Token Plan 映射

- `rolling_weekly`：主窗口（账单周期 %）
- 无 API 证据时不写入 `rolling_5_hour`

## 认证路径（主路径）

- **桌面 WebView**：`open_cursor_console_login` → `verify_cursor_console_session`（`src-tauri/src/cursor_session.rs`）
- 同域 `fetch('/api/usage-summary', { credentials: 'include' })`
- 每条记录独立 `account_binding_id`；`session_ref` 格式 `token-plan/cursor/session/<uuid>`
- 后端 adapter 在 `official_account` 模式返回 `CURSOR_CONSOLE_SYNC_REQUIRED`，禁止依赖本机 `vscdb` / IDE 安装

## 可选降级路径

- 本机 Cursor IDE `state.vscdb` + `cli-config.json` 仍可供 usage-limits 侧边栏，**不是** Token 套餐官方模式主路径

## 频率与限制

- Token Plan 调度器：5 分钟间隔
- 非文档化内部 API；结构漂移时返回 `unsupported`
- 禁止将 Cookie 写入 config.json

## 实现路径

- **用量（WebView）**：`cursor_session.rs` + `TokenPlanSection.jsx`
- **解析**：`cursor-token-plan.js` + `usage-limits.js` `normalizeCursorUsageSummary`

## 实机验证

待 R-CURSOR-01：无 Cursor IDE 安装机器上 WebView 登录；账单周期 % 与网页一致；双账户独立刷新。
