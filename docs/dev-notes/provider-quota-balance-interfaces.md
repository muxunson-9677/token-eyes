# 供应商额度/余额接口对照(开发者版)

> 2026-08-13,0.54.40-V3。配套用户文档:`docs/guides/provider-quota-and-balance-setup.md`;
> 方案与合规边界:`docs/superpowers/plans/2026-08-13-quota-balance-unification.md`(Cockpit Tools 仅参考「接口事实」,所有实现自研)。

## 1. API 余额(provider-api 体系)

链路:`dashboard/src/lib/provider-api-presets.js`(preset)→ `src/lib/local-api.js`(configs/secrets/test/refresh/balances 五个端点)→ `src/lib/provider-api-executor.js`(安全执行)→ `src/lib/provider-api-balance.js`(解析/缓存)。签名实现:`src/lib/provider-api-signing.js`(测试:`test/provider-api-signing.test.js`)。

| providerId | 端点 | 鉴权 | 解析路径 | 状态 |
|---|---|---|---|---|
| deepseek | `GET https://api.deepseek.com/user/balance` | bearer | `balance_infos[*].total_balance` 专用合并 | 已实现+测试 |
| aliyun_bss | `GET https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14` | `aliyun_rpc`(HMAC-SHA1 RPC 签名,AK/SK) | `Data.AvailableAmount` / `Data.Currency` | 已实现+测试 |
| moonshot | `GET https://api.moonshot.cn/v1/users/me/balance` | bearer | `data.available_balance` | 已实现+测试 |
| volcengine_billing | `GET https://open.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01` | `volcengine_hmac`(HMAC-SHA256 V4 风格,AK/SK) | `Result.AvailableBalance`,币种固定 CNY | 已实现+测试 |
| xiaomi_mimo / minimax / glm | 官方控制台 | `official_console`(原生会话桥) | 会话快照 | 已实现 |
| 自定义 | 任意 GET/POST 余额端点 | bearer / header | 用户配置 path | 已实现(executor 拒绝密钥入 URL、拒绝模型调用端点) |

## 2. Token 套餐适配器(token-plan 体系)

链路:`src/lib/token-plan-refresh.js`(注册表 + refreshPlan)→ `src/lib/<provider>-token-plan.js`。适配器契约:`async (plan, { resolveApiKey }) => { quota_windows?, total_quota?, used_quota?, remaining_quota?, suggested_plan_id?, provider_reported_at }`,错误类映射见 `mapAdapterErrorToSyncStatus`。

| provider | 凭据来源 | 端点 | 备注 |
|---|---|---|---|
| glm | vault key(Coding Plan API Key) | `GET open.bigmodel.cn/api/monitor/usage/quota/limit` | 5h/周窗口 |
| kimi / minimax / aliyun_bailian / codex / claude / cursor | 本机登录态或控制台会话 | 各官方接口 | 既有 |
| **zcode(新)** | 本机 `~/.zcode/v2/credentials.json` 中 `zcode_jwt_token`(AES-256-GCM,`enc:v1:{nonce}.{tag}.{ct}` base64url;密钥 = SHA-256(`ZCODE_CREDENTIAL_SECRET` 或 host 绑定回退串)) | `GET https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=3.3.4`,`Authorization: Bearer <jwt>` | `data.plans[]` 取 active 为套餐名;`data.balances[]` 按模型求和 `total_units/used_units/(remaining_units\|\|available_units)`,reset 取最早 `period_end`。文件:`src/lib/zcode-token-plan.js`,测试:`test/zcode-token-plan.test.js`。**回退密钥推导串未经真机确认**(平台 token 用 Node `process.platform`),escape hatch:`TOKENTRACKER_ZCODE_JWT` |

## 3. 官方限额 fetcher(usage-limits 体系)

链路:`src/lib/usage-limits.js` `getUsageLimits()` → 每 provider fetcher → `data.<id>`;多账号矩阵:`src/lib/limit-account-adapters/`。前端:`dashboard/src/lib/limits-providers.js`(LIMIT_PROVIDER_IDS)+ `usage-limits-provider-specs.js`。

已覆盖:claude、codex、cursor、kimi、gemini、kiro、antigravity、copilot、grok、**zed(新)**。

### Zed(新)

- 凭据:OS 凭据库,macOS Keychain internet-password server=`zed.dev`(account=user_id,password=access_token);Windows 凭据管理器 target=`zed:url=https://zed.dev`(PowerShell CredRead P/Invoke 读取,blob UTF-8 优先、含 NUL 回退 UTF-16LE)。env 逃生口:`TOKENTRACKER_ZED_USER_ID`/`TOKENTRACKER_ZED_ACCESS_TOKEN`。
- 端点:`GET https://cloud.zed.dev/client/users/me`,`Authorization: <user_id> <access_token>`(空格分隔,非 Bearer)。**勿用** `/frontend/billing/*`(桌面凭据 401)。
- 字段:`plan.plan_v3`;`current_usage.token_spend.{used,limit,remaining}`(**美分**);`current_usage.edit_predictions.{used,limit,remaining}`;`subscription.period.{start_at,end_at}`。
- 文件:`src/lib/zed-limits.js`、`src/lib/limit-account-adapters/zed.js`;测试:`test/zed-limits.test.js`。
- **前端 parity 规则变更**:`LIMIT_PROVIDER_IDS` 允许在 Swift `LimitsSettingsStore.allProviders` 前缀之后追加 web-only 供应商(当前:zed)。Swift `normalizedOrder` 丢弃未知 id、web `normalizeOrder` 回补,见 `test/limits-providers-parity.test.js`。macOS 原生弹窗如需展示 zed,需补 typed decode + 资产后把 id 移入共享前缀。

## 4. 调研过、本轮未实现(backlog,需真机样本)

来源:Cockpit Tools 接口事实调研(2026-08-13),仅记录事实,不含其代码。

| 平台 | 端点/机制 | 阻塞点 |
|---|---|---|
| Windsurf | Connect-RPC `POST {apiServer}/exa.seat_management_pb.SeatManagementService/GetUserStatus`;凭据在 `state.vscdb` `windsurfAuthStatus`(apiKey/firebaseIdToken) | 精确 schema 需真机样本;Firebase 刷新流 |
| CodeBuddy(腾讯) | device-login 轮询;额度 `POST /v2/billing/meter/get-dosage-notify` 等,Bearer + `X-User-Id/X-Enterprise-Id/X-Tenant-Id` | 额度字段藏 raw payload,需样本 |
| Qoder(阿里) | device flow `openapi.qoder.sh/api/v1/deviceToken/poll`;`GET /api/v3/user/status`、`/api/v2/quota/usage` | 字段需样本;本机 token 存储位置未确认 |
| Trae CN pay v2 | `POST /trae/api/v2/pay/ide_user_pay_status` 等,`Bearer` + `x-cloudide-token`;凭据 `state.vscdb` provider `icube.cloudide` | Token Eyes 已有 trae 原生会话,需确认 CN pay v2 覆盖 |
| Kiro | `GET {runtime}/getUsageLimits?...`,Bearer 读 `~/.aws/sso/cache/kiro-auth-token.json` | 已有 CLI 路线覆盖;此为无 CLI 备选 |
| Antigravity | 无公开 REST 额度端点(本机 language server 提供) | 已有本机路线覆盖;不做 HTTP fetcher |
