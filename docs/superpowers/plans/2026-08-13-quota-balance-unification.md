# 套餐额度授权展示 + Token Plan / API 余额检测统一打通方案（0.54.40-V3）

- 日期：2026-08-13
- 基线：`codex/fix-npm-ci-05440` @ `2e18d6cb`（已发布的 0.54.40）
- 分支：`0.54.40-V3`（独立 worktree：`.worktrees/0.54.40-V3`）
- 状态：P0/P1/P2 已完成（P3 backlog 见 §5 与 dev-notes §4）
  - P0：余额链路核验通过（206 个 provider-api 测试全绿）；文档已交付
    （`docs/guides/provider-quota-and-balance-setup.md` + `docs/dev-notes/provider-quota-balance-interfaces.md`）
  - P1：ZCode 套餐额度检测（`src/lib/zcode-token-plan.js`，读本机加密凭据 + billing/balance，15 个测试）
  - P2：Zed 订阅额度检测（`src/lib/zed-limits.js` + limit-account 适配器 + Web 面板全链路，12 个测试；
    web-only 上线，Swift 原生弹窗留 backlog，parity 规则改为「Swift 列表 = JS 列表前缀」）
  - 全量验证：node 1810 pass / dashboard vitest 1306 pass / validate:copy·ui-hardcode·guardrails 全过

## 1. 目标

1. **套餐额度授权展示（Cockpit 对齐）**：参考 Cockpit Tools（jlcodes99/cockpit-tools）已在真实用户群验证过的授权方式（OAuth 授权 / Token·JSON 导入 / 读取本机客户端凭据文件），把 Token Eyes 尚未覆盖的 agent 套餐额度检测补齐，让持有账号的用户开箱即用，无需我们逐一真人验收。
2. **Token Plan 与 API 余额检测统一**：DeepSeek、阿里云（百炼/BSS）、火山引擎等供应商的套餐用量与余额检测方式各不相同，梳理每家的官方接口、鉴权方式与响应字段，统一接入现有 token-plan / provider-balance 架构。
3. **配置文档**：为每个供应商编写面向用户的配置指南（怎么拿凭据、需要什么权限、界面里怎么填、常见错误怎么排查）。

## 2. 合规边界（重要）

- Cockpit Tools 是 source-available 但**禁止未授权商业使用**的项目。Token Eyes 计划商业化，因此：
  - **禁止**复制、改写、翻译 Cockpit Tools 的任何代码。
  - **允许**参考其验证过的"接口事实"：各平台官方 API 端点、鉴权流程、响应字段名、本机凭据文件路径。接口事实不构成版权表达。
  - Cockpit 自己声明其 Codex/Grok OAuth 参考了 MIT 协议的 [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)——需要 OAuth 流程实现细节时优先参考该项目。
- 所有新适配器代码沿用 Token Eyes 现有 JS 适配器风格（`src/lib/<provider>-token-plan.js` / `src/lib/usage-limits.js` fetcher / provider-api preset），自主实现。

## 3. 0.54.40 现状底账（盘点结论）

### 3.1 官方额度检测（usage-limits，`src/lib/usage-limits.js`）

已覆盖 9 家：claude、codex、cursor、kimi、gemini、kiro、antigravity、copilot、grok（`grok-limits.js`）。
凭据来源都是"读本机 CLI/IDE 登录态"（`~/.claude`、`~/.codex/auth.json`、Cursor session cookie、`~/.kimi`、`~/.gemini`、copilot hosts.json 等）——与 Cockpit 的"本机导入"是同一形态。

### 3.2 Token Plan 套餐检测（`src/lib/token-plan-refresh.js` 适配器注册表）

- JS 适配器 7 家：glm、kimi、minimax、aliyun_bailian、codex、claude、cursor。
- 原生 WebView 控制台会话 2 家：xiaomi_mimo（`xiaomi_mimo_session.rs`）、trae（`trae_session.rs`，`deferred_native` 机制，OAuth token 隔离在桌面进程）。
- 控制台会话白名单：`xiaomi_mimo, glm, minimax, codex, claude, cursor, trae, kimi`（`local-api.js` `ALLOWED_CONSOLE_PROVIDER_IDS`）。
- 套餐目录（catalog）9 家：aliyun-bailian、claude、codex、cursor、glm、kimi、minimax、trae、xiaomi-mimo。

### 3.3 API 余额检测（provider-api-*，presets 见 `dashboard/src/lib/provider-api-presets.js`）

| Preset | 端点 | 鉴权 | 解析路径 |
|---|---|---|---|
| deepseek | `https://api.deepseek.com/user/balance` | bearer | `balance_infos[*].total_balance`（专用合并逻辑） |
| aliyun_bss（阿里云/千问/百炼） | `https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14` | `aliyun_rpc`（HMAC-SHA1 RPC 签名，`provider-api-signing.js`） | `Data.AvailableAmount` / `Data.Currency` |
| moonshot | `https://api.moonshot.cn/v1/users/me/balance` | bearer | `data.available_balance` |
| volcengine_billing（火山/豆包） | `https://open.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01` | `volcengine_hmac`（HMAC-SHA256 V4 风格签名） | `Result.AvailableBalance` |
| xiaomi_mimo / minimax / glm | 官方控制台 | `official_console`（原生会话桥） | 会话快照 |

结论：**DeepSeek / 阿里云 / 火山引擎的余额检测代码在 0.54.40 已存在**（含签名实现与 `test/provider-api-signing.test.js`）。本轮的任务是：验证链路完整性（含 UI 流程）、补齐能力注册表缺口、补用户配置文档，而不是从零实现。

### 3.4 与 Cockpit Tools 16 平台对照的缺口

| 平台 | Cockpit 授权方式 | Token Eyes 现状 | 本轮动作 |
|---|---|---|---|
| Windsurf | OAuth / Token·JSON 导入（Plan、Prompt credits） | 无 | 新增额度检测 |
| CodeBuddy / CodeBuddy CN | OAuth / Token·JSON / 本机导入 | 仅用量采集（queue source） | 新增额度检测 |
| Qoder | 本机导入 / JSON 导入（Credits） | 无 | 新增额度检测 |
| Trae 套件（Trae/SOLO/CN） | OAuth / 本机导入（pay v2 配额） | 原生会话已接（trae_session.rs） | 验证 + 覆盖面确认 |
| Zed | OAuth / JSON / 本机登录态导入 | 仅用量采集 | 新增额度检测 |
| ZCode | Z.ai/BigModel OAuth；`~/.zcode/v2/credentials.json` | GLM 配额 API 已接（同一 BigModel 体系） | 评估复用 glm 适配器读 zcode 本机凭据 |
| Antigravity / Kiro / Copilot / Grok / Codex / Cursor / Claude / Gemini | — | 已覆盖 | 无 |

（各平台具体端点、鉴权头与响应字段见 §4 调研结果。）

## 4. 平台接口事实（调研结果）

> 来源：直接阅读 jlcodes99/cockpit-tools 的 Rust 模块（`src-tauri/src/modules/<platform>_account.rs` / `_oauth.rs`）。以下均为"接口事实"（端点/鉴权/字段/本机凭据路径），非代码。共享 UA 常量 `antigravity-cockpit-tools`。

### 4.1 可纯 JS 本机凭据读取实现（与现有 usage-limits fetcher 同形态）

**Kiro（AWS）— 已覆盖**：Token Eyes 现有 `fetchKiroLimits`（走 kiro CLI）。Cockpit 走 `GET {runtime}/getUsageLimits?origin=AI_EDITOR&profileArn=<arn>&resourceType=AGENTIC_REQUEST`，Bearer 读 `~/.aws/sso/cache/kiro-auth-token.json`，字段 `usageBreakdownList[0].{usageLimit,currentUsage,resetAt}` / `freeTrialInfo`。可作为无 CLI 依赖的补充路径。置信度：高。

**ZCode（智谱 Z.ai / BigModel）— 推荐新增**：
- 凭据：`~/.zcode/v2/credentials.json`，AES-256-GCM，前缀 `enc:v1:{nonce}.{tag}.{ciphertext}`（base64url）。密钥 = SHA-256(`ZCODE_CREDENTIAL_SECRET` 环境变量，缺省回退 `zcode-credential-fallback:{platform}:{home}:{username}`，即 host/user 绑定)。键：`oauth:<provider>:access_token`、`zcode_jwt_token`、active-provider。
- 额度：`GET https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=3.3.4`，`Authorization: Bearer <zcode_jwt_token>`。
- 响应：`{code:0,data}`；`data.plans[]` 取 `status=="active"` → plan_type；`data.balances[]` 按模型求和：`total_units`/`used_units`/`remaining_units||available_units`，reset 取 `period_end||expires_at` 最小值。
- 置信度：高。与 Token Eyes 现有 glm 生态一致，商业价值高。

**Zed — 可选新增（需读 OS keychain）**：
- 凭据：OS 凭据库 `https://zed.dev`（macOS Keychain internet-password service=`zed.dev`；Windows Credential Manager target=`zed:url=https://zed.dev`）。account=user_id，secret=access_token。Token Eyes 已有 Claude/Copilot 的 keychain 读取（securityRunner）可复用形态。
- 额度：`GET https://cloud.zed.dev/client/users/me`，`Authorization: <user_id> <access_token>`（空格分隔、非 Bearer）。**故意不用** `/frontend/billing/*`（桌面凭据会 401）。
- 响应：`plan.plan_v3`；`current_usage.token_spend.{used,limit,remaining}`（**单位：美分**）；`current_usage.edit_predictions.{used,limit,remaining}`；`subscription.period.{start_at,end_at}`。已被 CodexBar 独立佐证。置信度：高。

### 4.2 需 Tauri 原生会话 + OAuth（重活，与 xiaomi_mimo/trae 同层）

**Windsurf（Codeium）**：Connect-RPC + Firebase，非简单 REST。POST `{apiServer}/exa.seat_management_pb.SeatManagementService/GetUserStatus`，凭据在 `state.vscdb`（`windsurfAuthStatus` blob 含 apiKey/firebaseIdToken）。字段 `planInfo.planName/planEnd`、`availablePromptCredits`/`usedPromptCredits`、`availableFlowCredits`/`usedFlowCredits`。置信度：端点高、精确 schema 需真机样本。

**Trae / Trae CN / SOLO（字节）**：OAuth + `state.vscdb`（provider `icube.cloudide`）。CN pay v2：POST `/trae/api/v2/pay/ide_user_pay_status`、`/ide_user_ent_usage`、`/user_current_entitlement_list`。头 `Authorization: Bearer` + `x-cloudide-token`。**Token Eyes 已接 trae 原生会话**（`trae_session.rs`，deferred_native）——需确认覆盖 CN pay v2 与 product_type 命名。

**CodeBuddy / CodeBuddy CN / Workbuddy（腾讯）**：device-login 轮询（`/v2/plugin/auth/state`→`/auth/token`）。额度 POST `/v2/billing/meter/get-dosage-notify`、`/get-payment-type`、`/get-user-resource`（加量包）。Bearer + `X-User-Id/X-Enterprise-Id/X-Tenant-Id`。数值藏在 raw payload，需真机样本定字段。置信度：端点高、精确额度字段中。

**Qoder（阿里）**：device flow（`openapi.qoder.sh/api/v1/deviceToken/poll`）。额度 `GET /api/v3/user/status`、`/api/v2/quota/usage`，Bearer。解析器 fuzzy，需真机样本定字段。置信度：端点高、字段中。

**Antigravity（Google）**：本仓库**无公开 REST 额度端点**——额度由本机 Antigravity language server 提供。凭据在 keychain `gemini:antigravity`（Google OAuth）。置信度：低，不建议本轮做独立 HTTP fetcher。

## 5. 本轮范围与实施策略（建议）

**判断**：用户点名的 DeepSeek / 阿里云 / 火山引擎"API 余额"检测在 0.54.40 **已实现并有测试**（签名 + preset + executor）。真正缺的是：(a) 端到端流程验证与文档，(b) 少数几家能纯 JS 落地的额度检测。Windsurf/CodeBuddy/Qoder 等需原生会话 + 真机样本，属重活且无法离线验收，建议延后。

分阶段（每阶段独立可测、无需真实账号，测试用注入 fetchImpl + fixture）：

- **P0 巩固既有余额链路 + 文档**（无新原生代码，纯收益）
  - 验证 provider-api 余额从 UI 配置 → 保存密钥 → 测试连通 → 展示 的完整链路（DeepSeek / 阿里云 BSS / 火山引擎 / Moonshot / SiliconFlow / OpenRouter）。
  - 交付 `docs/guides/provider-quota-and-balance-setup.md`：每家凭据获取（最小权限）+ 界面步骤 + 字段含义 + 排错。
- **P1 ZCode 套餐额度检测**（纯 JS，本机加密凭据读取 + billing/balance）——新增 `src/lib/zcode-token-plan.js` 适配器 + 能力注册 + catalog + 测试 + 文档。
- **P2 Zed 订阅额度检测**（keychain 读取 + `/client/users/me`）——复用 securityRunner 形态；新增 usage-limits fetcher + 前端 spec + 测试 + 文档。
- **P3（可选，需真机样本）** Trae CN pay v2 覆盖确认；Windsurf/CodeBuddy/Qoder 原生会话——列为 backlog，待有账号用户提供样本后再排。

### 测试策略
- Node 侧：注入 `fetchImpl` 返回伪造 `{status,json}`，fixture 落 `test/fixtures/`；本机凭据读取注入临时目录 + 假 keychain runner。
- Dashboard 侧：Vitest 组件测试 + copy/i18n 锚点，禁止硬编码文案。
- 不触真实网络、不需要真实账号。

## 6. 配置文档交付

- 位置：`docs/guides/provider-quota-and-balance-setup.md`（中文，面向最终用户）
- 每个供应商一节：适用套餐 → 凭据获取步骤（含权限最小化，如阿里云 BSS ReadOnlyAccess、火山引擎账单只读）→ Token Eyes 界面配置步骤 → 展示字段说明 → 常见错误与排查。
