# Claude 官方同步调研记录

日期：2026-07-08（WebView 路径已更新）

## 官方数据源

| 数据 | 端点 | 认证 |
|------|------|------|
| 5 小时 / 7 天额度利用率 | `GET https://api.anthropic.com/api/oauth/usage` | WebView 登录后 OAuth access token |
| 请求头 | `anthropic-beta: oauth-2025-04-20` | Bearer access token |

## 额度响应字段

- `five_hour.utilization`：5 小时窗口利用率（0–1 或百分比）
- `seven_day.utilization`：7 天窗口利用率
- `seven_day_opus`：Opus 专用周窗口（可选）
- `resets_at`：重置时间（ISO，部分响应）

## 双模式（WO-9）

| 模式 | 说明 | 额度同步 |
|------|------|----------|
| **官方账号** | Token Eyes 内 WebView 登录 Anthropic 控制台 | ✅ Tauri `claude_session.rs` → `quota_windows` |
| **路由模式（CC Switch 等）** | 经第三方路由的 API Key / 代理 | ❌ **不伪造**官方额度；仅本地 Token 统计 + 手工登记 |

路由模式对应 catalog 套餐 `claude_routing`，或 `claude_account_mode=routing`；不得设置 `detection_method=official_account`。

## 认证路径（主路径）

- **桌面 WebView**：`open_claude_console_login` → `verify_claude_console_session`（`src-tauri/src/claude_session.rs`）
- 登录 URL：`https://console.anthropic.com/`
- 每条套餐记录独立 `account_binding_id`；`session_ref` 格式 `token-plan/claude/session/<uuid>`
- 后端 adapter（`claude-token-plan.js`）在 `official_account` 模式下返回 `CLAUDE_CONSOLE_SYNC_REQUIRED`，禁止再走 `~/.claude/.credentials.json` 作为唯一路径

## 可选降级路径

- 本机 Claude Code CLI 登录态（`~/.claude/.credentials.json`）仍可供非 `official_account` 检测或 usage-limits 侧边栏使用，**不是** Token 套餐官方模式主路径

## 频率与限制

- Token Plan 调度器：5 分钟间隔
- OAuth usage 端点有速率限制；失败时保留上次额度，更新 `sync_status`

## 实现路径

- **官方用量（WebView）**：`claude_session.rs` + `TokenPlanSection.jsx` WebView 连接流
- **解析**：`claude-token-plan.js` `parseClaudeUsageBody`
- **路由**：静态 catalog + 手工额度；UI 标明「仅 Token 统计」

## 实机验证

待 R-CLAUDE-01：无 `~/.claude` 时 WebView 连接；双账户独立刷新；路由模式无 CLI 文案。
