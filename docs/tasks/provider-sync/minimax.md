# MiniMax 官方同步调研记录

日期：2026-07-07

## 官方数据源

| 数据 | 端点 | 认证 |
|------|------|------|
| Token Plan 额度（5h / 周） | `GET https://api.minimaxi.com/v1/token_plan/remains`（CN）<br>`GET https://api.minimax.io/v1/token_plan/remains`（Global） | Token Plan **订阅 Key**（`Authorization: Bearer`） |
| 按量付费余额 | 无公开 Open Platform API | 仅控制台 Billing → Balance |

**禁止**：`coding_plan/remains` 与 `www.minimaxi.com/v1/api/openplatform/...` 需浏览器 Cookie，不能作为 API Key 路径。

## 字段映射

- `model_remains[]` → 优先 `MiniMax-M*` / `general` 条目
- `current_interval_*` → `rolling_5_hour`（`token_plan/remains` 上 `current_interval_usage_count` 为已用 prompts）
- `current_weekly_*`（total > 0 或 `current_weekly_status` active）→ `rolling_weekly`
- `end_time` / `weekly_end_time` → `resets_at`（秒或毫秒时间戳）

## 实现路径

- **minimax_manual_quota**：`minimax-token-plan.js` + 订阅 Key（`purpose: token-plan-api`）
- **minimax_api_budget**：不展示官方自动检测（无公开余额 API）

## 频率与限制

- Token Plan 调度：5 分钟
- 请求超时 10s；CN 失败后尝试 Global host

## 实机验证

待 **R-MINIMAX-01**：用户 Token Plan 订阅 Key 对照控制台额度条。
