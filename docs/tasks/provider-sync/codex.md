# Codex 官方同步调研记录

日期：2026-07-08（WebView 为主路径）

## 官方数据源

| 数据 | 端点 | 认证 |
|------|------|------|
| 5 小时 / 7 天额度窗口 | `GET https://chatgpt.com/backend-api/wham/usage` | WebView 同会话 Cookie（主路径）或 CLI OAuth（可选降级） |
| Token 刷新（CLI 路径） | `POST https://auth.openai.com/oauth/token` | `refresh_token` |

## 额度响应字段

- `rate_limit.primary_window` / `secondary_window`：按 `limit_window_seconds` 归类
- `18000` 秒 → `rolling_5_hour`；`604800` 秒 → `rolling_weekly`
- `used_percent`；`reset_at`

## 认证路径（主路径）

- **桌面 WebView**：`codex_session.rs` + `TokenPlanSection.jsx`；登录 `https://chatgpt.com/codex`
- 每条记录独立 `account_binding_id`
- 后端 adapter：`official_account` → `CODEX_CONSOLE_SYNC_REQUIRED`（禁止 CLI 作为唯一刷新路径）

## 可选降级路径

- `~/.codex/auth.json` + `codex-token-plan.js` 仍可供非 official_account 或 Limits 侧边栏

## 实机验证

R-CODEX-01：WebView 双账户独立刷新（2026-07-08 热修基线）。
