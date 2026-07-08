# GLM 官方同步调研记录

日期：2026-07-07

## 官方数据源

| 数据 | 端点 | 认证 |
|------|------|------|
| 5 小时 / 每周 Token 额度 | `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` | Coding Plan API Key（`Authorization` 头） |
| 账户余额 | `GET /api/biz/account/query-customer-account-report`（相对 `www.bigmodel.cn`） | 控制台登录态（`bigmodel_token_production` cookie） |

## 额度响应字段

- `data.limits[]` 中 `type: "TOKENS_LIMIT"`
- `unit: 3` → 5 小时滚动窗口
- `unit: 6` → 每周滚动窗口
- `usage` = 窗口总量，`currentValue` = 已用，`nextResetTime` = 重置时间

## 余额响应字段

- `data.balance`、`data.availableBalance`、`data.creditBalance`、`data.currency`

## 频率与限制

- 前端可见页轮询：60s（页面可见）/ 5min（后台）
- Token Plan 调度器：5min 间隔（`refresh_interval_minutes: 5`）
- 请求超时：10s；响应上限：1MB；禁止重定向

## 实现路径

- **用量**：Node `glm-token-plan.js` adapter + OS 凭据库保存 API Key
- **余额**：Tauri `glm_session.rs` 受限 WebView 登录 `https://www.bigmodel.cn/coding-plan/personal/usage`

## 实机验证

待 R-GLM-01：用户真实 GLM 账户对照控制台余额与额度窗口。
