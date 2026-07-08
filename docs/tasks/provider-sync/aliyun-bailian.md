# 阿里云百炼官方同步调研记录

日期：2026-07-07

## 官方数据源

| 数据 | 端点 | 认证 |
|------|------|------|
| Coding Plan 请求额度 | `POST {console}/data/api.json?action=zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2&product=broadscope-bailian&api=queryCodingPlanInstanceInfoV2` | Coding Plan 订阅 Key（`sk-sp-`，Bearer + x-api-key） |
| 按量付费余额 | 无公开 Open Platform API | 仅费用与成本控制台 |

控制台 host：
- 中国大陆：`https://bailian.console.aliyun.com`（`commodityCode: sfm_codingplan_public_cn`）
- 国际：`https://modelstudio.console.alibabacloud.com`（`commodityCode: sfm_codingplan_public_intl`）

参考：CodexBar `docs/alibaba-coding-plan.md`

## 字段映射

`codingPlanQuotaInfo`：
- `per5HourUsedQuota` / `per5HourTotalQuota` → `rolling_5_hour`（请求次数）
- `perWeekUsedQuota` / `perWeekTotalQuota` → `rolling_weekly`
- `perBillMonth*` 存在但 Token Plan UI 仅展示 5h/周窗口

## 已知限制

- 部分账号/区域 API Key 路径返回 `ConsoleNeedLogin`，需控制台 Cookie（未实现 Tauri 会话桥）
- INTL 账户可能无可用 API Key 额度路径（CodexBar #612）
- 额度单位为**模型调用次数**，非 Token

## 实现路径

- **aliyun_bailian_manual_quota**：`aliyun-bailian-token-plan.js` + `sk-sp-` Key
- **aliyun_bailian_pay_as_you_go_budget**：不展示官方自动检测

## 实机验证

待 **R-BAILIAN-01**：用户 `sk-sp-` Key 对照百炼 Coding Plan 控制台。
