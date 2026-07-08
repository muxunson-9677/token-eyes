# Kimi 官方同步调研记录

日期：2026-07-08（Kimi Code WebView 路径已更新）

## 官方数据源

| 数据 | 端点 | 认证 |
|------|------|------|
| Kimi Code 额度（5h / 周） | `GET https://api.kimi.com/coding/v1/usages` | WebView 登录后 OAuth Bearer token |
| Moonshot API 余额 | `GET https://api.moonshot.cn/v1/users/me/balance` | API Key（`kimi_api_budget` 套餐） |

## 字段映射

### usages（Kimi Code）

- `usage` → `rolling_weekly` 窗口
- `limits[0].detail` → `rolling_5_hour` 窗口（300 分钟）
- 平面字段：`total_quota` / `used_quota` / `remaining_quota` 取自 weekly

### balance（API 按量）

- `data.available_balance`（CNY）→ `remaining_quota`（分）
- `voucher_balance` / `cash_balance` 保留在解析结果 `balance` DTO

## 实现路径

- **kimi_code_manual_quota（WebView 主路径）**：`kimi_session.rs` + `TokenPlanSection.jsx`；登录 `https://www.kimi.com/code`
- **kimi_api_budget**：Token Plan secrets 保存 API Key（`purpose: balance-api`）— **本工单不改**，与 Code WebView 互不干扰
- 后端 adapter：`official_account` + 非 `kimi_api_budget` 时返回 `KIMI_CONSOLE_SYNC_REQUIRED`

## 频率与限制

- Token Plan 调度：5 分钟（`refresh_interval_minutes: 5`）
- 请求超时 10s；响应上限 1MB；禁止重定向

## 实机验证

待 R-KIMI-01：无 `~/.kimi-code` 时 WebView 连接；5h/周与控制台一致；多账户 `account_binding_id`；`kimi_api_budget` 不受影响。
