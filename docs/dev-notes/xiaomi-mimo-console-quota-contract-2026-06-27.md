# 小米 MiMo 官方控制台额度接口契约确认

- **任务 ID**：TE-NEXT-W03E-R3A（首次） / TE-NEXT-W03E-R3B（本轮 session evidence unblock 评估）
- **日期**：2026-06-27
- **执行方**：Claude Code
- **状态**：`BLOCKED：缺少官方控制台登录态网络证据` — sessionFetch 安全调用能力已实现（R3B-Rework-2），但仍需用户在 Windows 端实际登录小米 MiMo 控制台并提供真实网络证据，才能解除 R3C 派发门禁

---

## 结论

**BLOCKED：缺少官方控制台登录态网络证据**

> **R3B-Rework-2 更新（2026-06-27）**：sessionFetch 安全调用能力已实现并通过 27 个测试。阻塞条件从两个减少到一个：仅需用户在 Windows 端实际登录小米 MiMo 控制台验证真实额度查询链路。`quota_fetch_owner: tauri_webview_session_fetch`。

R3B 本轮在 R3A 基础上额外验证了两条独立阻塞路径：

1. **真实登录态网络证据仍不可获得**（R3A 已记录，R3B 复核未变，**仍为当前唯一阻塞**）：
   - 执行方（AI）无小米 MiMo 账号；工单第 3 节明确禁止模拟输入账号/密码/验证码，也禁止要求用户把凭证发给 agent。
   - 工作区无脱敏 HAR 文件（`*.har` 搜索 0 结果），`test/fixtures/` 下无 `xiaomi-mimo-console/` 目录。
   - 用户在本轮未提供手动登录后的网络抓包或脱敏 HAR。
   - 按 R3B 工单第 3 节："如果没有真实登录交互，也没有脱敏证据，立即转入 BLOCKED 文档收口，不要实现任何会话成功路径。"

2. ~~**安全 sessionFetch 边界当前不可用**~~（**已在 R3B-Rework-2 中实现，2026-06-27**）：
   - ✅ `open_xiaomi_mimo_console_login` 现使用 `initialization_script(SESSION_FETCH_JS)` 注入受控 JS（页面加载前执行，不受 CSP 限制）
   - ✅ `on_navigation` 拦截非官方域名（复用 `is_official_xiaomi_url`）
   - ✅ `verify_xiaomi_mimo_console_session` 通过 `eval()` 触发 `window.__tokenEyesSessionFetch__()`，JS 用 `fetch('/api/v1/tokenPlan/usage', { credentials: 'include' })` 同会话请求
   - ✅ JS 通过 `window.__TAURI__.invoke('xiaomi_mimo_quota_result', ...)` 回传脱敏 DTO，Rust 不接触 Cookie
   - ✅ 注入的 JS 不读取 `document.cookie`/`localStorage`/`sessionStorage`/DOM（有专门测试验证）
   - ✅ 27 个测试全部通过（含 12 个新增 sessionFetch 测试）
   - ⏳ 仍需在 Windows + WebView2 环境实际验证登录后能否成功 fetch

3. **第三方工具均依赖手动复制 Cookie**（违反 W03C-R2 安全策略，R3A 已记录，R3B 维持）：cc-switch、Mimo-Usage-Monitor 均需用户从 DevTools 复制完整 Cookie 到本地文件；工单禁止该路径。

因此 **W03E-R3C（官方额度 adapter）不可派发**，需等待以下最小解除阻塞条件全部满足：

- (a) 用户在 Token Eyes 打开的官方窗口内手动完成登录并提供脱敏网络证据（HAR 或字段白名单 JSON），且
- (b) Token Eyes 完成 Tauri 2.x WebView 会话内受控 `sessionFetch` 能力（使 Rust 仅接收脱敏 quota DTO，不接触 Cookie/原始响应头），且
- (c) 该能力在目标 Windows + WebView2 环境验证可用，且用户接受 Cookie 约 24h 过期需定期重新登录。

仅满足 (a) 不解除阻塞，因为 (b) 缺失时唯一调用路径仍是复制 Cookie（被禁止）。

无法完成工单要求的"使用官方控制台登录态观察网络请求"。具体阻塞原因：

1. **缺少真实控制台登录态网络探测**：
   - 本次执行使用 `agent-browser`（Chromium 无头浏览器）尝试打开 `https://platform.xiaomimimo.com/console/balance`，页面跳转至小米账号登录页。
   - **无法登录**：我没有小米 MiMo 账号，且工单禁止模拟输入账号密码/验证码。
   - 因此，无法完成"控制台登录态下观察网络请求"这一关键步骤。

2. **sessionFetch 通道当前不可用**：
   - W03C-R2 的 `verify_xiaomi_mimo_console_session` 在 Tauri 2.x 运行时中明确返回 `DesktopSessionNotVerified`（见 `src-tauri/src/xiaomi_mimo_session.rs:300-310`）。
   - 注释写明："We do not have a Tauri 2.x safe way to read the inner page state of an external webview from the Rust side."
   - 因此即使用户在 WebView 中登录成功，Token Eyes 当前也无法从 Rust 侧发起受控 `sessionFetch` 请求来调用内部 API。

3. **第三方工具均依赖手动复制 Cookie**（不可接受路径）：
   - 所有已知社区工具（cc-switch、Mimo-Usage-Monitor）都需要用户从浏览器 DevTools **手动复制 Cookie** 到本地文件。
   - W03C-R2 第 14 行明确禁止："不让用户复制粘贴 Cookie 作为主路径"。
   - 即使 sessionFetch 通道修复，内部 API 的 Cookie 认证意味着用户必须定期（24h）重新登录，这不是可靠的自动同步。

4. **缺失关键字段**：第三方来源的响应结构中无 `expires_at`、`plan_name`、`reset_cycle`。

因此，**W03E-R3B（后端 adapter 实现）当前阻塞**，等待以下任一条件满足：

- 用户提供小米 MiMo 控制台登录后的脱敏 HAR 文件（含 `/api/v1/tokenPlan/usage` 请求），供契约确认
- Token Eyes 桌面端完成 Tauri WebView 内页面状态读取能力（使 sessionFetch 可用），且用户愿意接受定期重新登录
- 小米 MiMo 官方文档化额度查询 API（如 REST API + API Key 认证）

---

## 探测过程

### 探测方法

按工单要求执行以下探测路径：

1. **官方文档审查**：审查小米 MiMo 官方文档站 `https://mimo.mi.com/docs/` 中与 API/额度/套餐相关的全部页面。
2. **第三方社区交叉验证**：搜索 GitHub、CSDN 等平台中社区发现的 MiMo 控制台 API，对比多个独立来源。
3. **真实控制台登录态网络探测（尝试但未完成）**：使用 `agent-browser` 打开 `https://platform.xiaomimimo.com/console/balance`，尝试完成控制台登录态下的网络请求观察。

### 1. 真实控制台登录态网络探测（未完成）⚠️

**执行过程**：

```powershell
agent-browser open https://platform.xiaomimimo.com/console/balance
agent-browser wait --load load
agent-browser screenshot
```

**结果**：页面跳转至小米账号登录页（`account.xiaomi.com` 或类似页面），需要输入手机号/邮箱 + 密码 + 可能验证码。

**阻塞原因**：
- 我没有小米 MiMo 账号
- 工单硬约束 4/5 禁止收集账号密码、模拟输入
- 即使有账号，登录涉及用户隐私（手机号、密码、验证码），不可由 AI 代理完成

**截图**：已保存于 agent-browser session，可备查。

**结论**：真实控制台登录态网络探测**无法由 AI 独立完成**，需用户提供登录后的脱敏 HAR 文件或手动登录后由 AI 辅助抓包。

### 2. 官方文档审查

| 文档页面 | URL | 是否包含额度查询 API |
|---|---|---|
| Token Plan 定价 | https://mimo.mi.com/docs/zh-CN/price/token-plan | 否，仅套餐定价 |
| 首次调用 API | https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call | 否，仅提及控制台人工查看 |
| 速率限制 | https://mimo.mi.com/docs/zh-CN/api/guidance/rate-limit | 否，仅 RPM/TPM 限制 |
| Token Plan 快速接入 | https://mimo.mi.com/docs/zh-CN/tokenplan/quick-access | 否，仅接入指南 |

**结论**：小米 MiMo 官方文档中不存在任何额度查询 API 的文档说明。

### 3. 第三方社区交叉验证

通过 cc-switch 项目和 CSDN 社区文章交叉验证，发现小米 MiMo 控制台存在以下内部 API：

| 端点 | 方法 | 用途 | 认证方式 | 官方文档化 |
|---|---|---|---|---|
| `/api/v1/balance` | GET | 按量计费余额查询 | Cookie（需手动复制） | 否 |
| `/api/v1/tokenPlan/usage` | GET | TokenPlan 套餐用量查询 | Cookie（需手动复制） | 否 |

**验证来源（含精确可点击链接）**：

| # | 来源 | 精确 URL | 提供信息 |
|---|---|---|---|
| 1 | CSDN: l_h999 "cc-switch进行小米 mimo 用量查询" | https://blog.csdn.net/l_h999/article/details/161784249 | 两个端点的 URL、Cookie 获取方法、响应结构、24h 有效期 |
| 2 | GitHub: farion1231/cc-switch Issue #2488 | https://github.com/farion1231/cc-switch/issues/2488 | 功能请求（已关闭），确认 Cookie 认证方式 |
| 3 | GitHub: zhangswings/Mimo-Usage-Monitor | https://github.com/zhangswings/Mimo-Usage-Monitor | 完整开源实现，源码验证了 API 端点和 Cookie 认证方式 |
| 4 | Mimo-Usage-Monitor Python 源码 | https://raw.githubusercontent.com/zhangswings/Mimo-Usage-Monitor/main/scripts/mimo_usage.py | 实际 API 调用代码：`GET /api/v1/tokenPlan/usage`，Cookie 从 `.mimo_cookies` 文件读取 |
| 5 | Mimo-Usage-Monitor Shell 源码 | https://raw.githubusercontent.com/zhangswings/Mimo-Usage-Monitor/main/scripts/mimo_usage.sh | 同样的 API 端点，`curl -b "$COOKIES"` 传递 Cookie |

**交叉验证一致性**：
- 端点 URL 完全一致（来源 1、3、4、5 均使用相同的 `/api/v1/tokenPlan/usage`）
- 认证方式完全一致（所有来源均依赖**手动从浏览器 DevTools 复制 Cookie**）
- Cookie 24h 过期（来源 1、3 均确认）
- 响应结构一致（来源 1 的 CSDN 文章和来源 4 的 Python 源码解析相同字段）

---

## 控制台入口 URL

- 官方控制台首页：`https://platform.xiaomimimo.com/`
- 订阅管理页：`https://platform.xiaomimimo.com/console/plan-manage`
- 用量信息页：`https://platform.xiaomimimo.com/console/usage`
- 余额页：`https://platform.xiaomimimo.com/console/balance`
- Token Plan 购买页：`https://platform.xiaomimimo.com/token-plan`

---

## 额度接口详细契约（社区发现，非官方）

### 接口 1：按量计费余额查询

```
GET https://platform.xiaomimimo.com/api/v1/balance
```

**Request Headers（脱敏）**：

```
Cookie: serviceToken="<redacted_service_token>"; userId=<redacted_user_id>; ...
Accept: application/json
```

**Request Body**：无

**Response Schema（脱敏）**：

```json
{
  "code": 0,
  "data": {
    "balance": "<redacted>",
    "cashBalance": "<redacted>",
    "giftBalance": "<redacted>",
    "frozenBalance": "<redacted>",
    "overdraftLimit": "<redacted>",
    "remainingOverdraftLimit": "<redacted>",
    "currency": "CNY"
  }
}
```

### 接口 2：TokenPlan 套餐用量查询

```
GET https://platform.xiaomimimo.com/api/v1/tokenPlan/usage
```

**Request Headers（脱敏）**：

```
Cookie: serviceToken="<redacted_service_token>"; userId=<redacted_user_id>; ...
Accept: application/json
```

**Request Body**：无

**Response Schema（脱敏）**：

```json
{
  "data": {
    "usage": {
      "items": [
        {
          "name": "plan_total_token",
          "used": "<redacted>",
          "limit": "<redacted>",
          "percent": "<redacted>"
        },
        {
          "name": "compensation_total_token",
          "used": "<redacted>",
          "limit": "<redacted>",
          "percent": "<redacted>"
        }
      ]
    }
  }
}
```

**数值缩放规则（社区发现）**：
- 原始值需除以 `1,000,000`（SCALE）再除以 `100`（multiplier）
- 最终单位为"百M"（即 100,000,000 Credits）

---

## 字段映射（如接口可用）

| Token Eyes 字段 | 控制台字段路径 | 单位 | 说明 |
|---|---|---|---|
| total_quota | `items[plan_total_token].limit / 100,000,000` | Credits（百M） | 套餐积分总额度 |
| used_quota | `items[plan_total_token].used / 100,000,000` | Credits（百M） | 套餐积分已用量 |
| remaining_quota | `(limit - used) / 100,000,000` | Credits（百M） | 计算得出 |
| expires_at | **未发现** | — | 响应中无到期时间字段 |
| plan name / package name | **未发现** | — | 响应中无套餐名称字段 |

**缺失字段**：
- `expires_at`（到期时间）：响应中未发现
- `plan_name`（套餐名称）：响应中未发现
- `reset_cycle`（重置周期）：响应中未发现

---

## 错误状态映射

| HTTP 状态 | 控制台含义 | Token Eyes 映射 | 说明 |
|---|---|---|---|
| 200 + code=0 | 成功 | `success` | 正常返回数据 |
| 200 + code≠0 | 业务错误 | `failed` | 需解析具体 code |
| 401 | 未登录/Cookie 失效 | `reauth_required` | Cookie 过期需重新登录 |
| 403 | 无权限 | `reauth_required` | 账号权限不足 |
| 429 | 限流 | `failed`（带限流提示） | 需稍后重试 |
| 5xx | 服务端错误 | `failed` | 服务商暂不可用 |
| 网络超时 | 连接失败 | `failed` | 网络不可达 |

---

## 隐私和安全说明

### 禁止持久化的字段

- Cookie 完整值（含 `serviceToken`, `userId`, `xiaomichatbot_ph` 等）
- 任何形式的 session cookie
- `api-platform_serviceToken`
- `api-platform_slh`, `api-platform_ph`

### 允许进入本地套餐记录的字段

- 脱敏后的额度数值（used, total, remaining）
- 同步时间戳
- 同步状态
- 错误码和错误消息（不含 Cookie/Token）

### 安全风险

1. **Cookie 泄露风险**：Cookie 中含 `serviceToken` 和 `userId`，一旦泄露可被用于冒用身份。
2. **Cookie 短期失效**：约 24 小时过期，无法实现可靠的自动刷新。
3. **无官方 SLA**：接口可能随时变更、增加风控（如验证码）、或下线。
4. **非官方文档化**：使用该接口属于逆向工程行为，不在小米官方支持范围内。

---

## 后续 W03E-R3B 最小接口建议（阻塞解除后）

如果未来小米 MiMo 提供官方额度查询 API：

```js
// 建议的 adapter 接口
async function fetchXiaomiMimoConsoleQuota({
  plan,          // { provider_id, plan_id, account_binding_id }
  binding,       // { id, auth_kind, credential_ref }
  sessionFetch,  // 受控会话 fetch（通过 W03C-R2 的桌面会话）
  now,           // ISO timestamp
}) {
  // 1. 通过 sessionFetch 调用官方额度 API
  // 2. 解析响应中的 used, total, remaining
  // 3. 计算 remaining = total - used（如响应未直接提供）
  // 4. 返回标准化的 TokenPlanQuotaSnapshot
}

function normalizeXiaomiMimoConsoleQuota(payload, plan, now) {
  // 返回 { total_quota, used_quota, remaining_quota, expires_at,
  //         quota_source: "provider_reported", provider_reported_at }
}
```

---

## 阻塞详情

### 阻塞原因

1. **缺少真实控制台登录态网络探测**：
   - 本次执行使用 `agent-browser` 尝试打开控制台但无法登录（无小米账号）。
   - 真实控制台登录态下的网络请求观察**未完成**。
   - 所有接口信息均来自第三方社区来源，未经真实登录态验证。

2. **第三方工具均依赖手动复制 Cookie**（违反 W03C-R2 安全策略）：
   - 所有已知社区工具（cc-switch、Mimo-Usage-Monitor）都需要用户从浏览器 DevTools 手动复制完整 Cookie 字符串到本地文件。
   - W03C-R2 第 14 行明确禁止："不让用户复制粘贴 Cookie 作为主路径"。
   - 项目允许的路径是：用户在官方页面登录 → Token Eyes 保存 `session_ref`（路径引用，非 Cookie 值） → Cookie 留在受控 WebView/桌面会话容器中 → 通过 `sessionFetch` 调用内部 API。
   - 当前 `sessionFetch` 通道不可用（Tauri 2.x 无法从 Rust 侧读取外部 WebView 内部页面状态）。

3. **Cookie 短期失效（24h）**：
   - 即使 `sessionFetch` 通道修复，Cookie 有效期约 24 小时。
   - 用户需定期重新登录，不是可靠的自动同步。

4. **缺失关键字段**：第三方来源的响应结构中无 `expires_at`、`plan_name`、`reset_cycle`。

### 解除阻塞需要的外部信息

以下任一条件满足即可解除阻塞：

1. 用户提供小米 MiMo 控制台登录后的脱敏 HAR 文件（含 `/api/v1/tokenPlan/usage` 请求），供契约确认响应结构和字段完整性。
2. Token Eyes 桌面端完成 Tauri WebView 内页面状态读取能力（使 `sessionFetch` 可用），且用户愿意接受 24h 定期重新登录。
3. 小米 MiMo 官方发布额度查询 API 文档（REST API + API Key 认证，不依赖 Cookie）。

### 当前可用能力

- 静态套餐目录：Lite/Standard/Pro/Max 四档套餐的总额度已核验，可用于套餐选择。
- 手工录入：用户可手工更新已用额度、剩余额度和到期时间。
- 官方控制台人工查看：用户可登录控制台后人工查看用量数据。

---

## 证据来源

| # | 来源 | 精确 URL | 类型 | 日期 | 内容 |
|---|---|---|---|---|---|
| 1 | 小米 MiMo 官方文档 - Token Plan 定价 | https://mimo.mi.com/docs/zh-CN/price/token-plan | 官方文档 | 2026-06-27 | 仅套餐定价说明，无 API |
| 2 | 小米 MiMo 官方文档 - 首次调用 API | https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call | 官方文档 | 2026-06-27 | 仅提及控制台人工查看 |
| 3 | 小米 MiMo 官方文档 - 速率限制 | https://mimo.mi.com/docs/zh-CN/api/guidance/rate-limit | 官方文档 | 2026-06-27 | 仅 RPM/TPM 限制 |
| 4 | 小米 MiMo 官方文档 - Token Plan 快速接入 | https://mimo.mi.com/docs/zh-CN/tokenplan/quick-access | 官方文档 | 2026-06-27 | 仅 API 接入指南 |
| 5 | CSDN: l_h999 "cc-switch进行小米 mimo 用量查询" | https://blog.csdn.net/l_h999/article/details/161784249 | 社区文章 | 2026-06-08 | 披露两个端点的 URL、Cookie 获取方法、响应结构、24h 有效期 |
| 6 | GitHub: farion1231/cc-switch Issue #2488 | https://github.com/farion1231/cc-switch/issues/2488 | GitHub Issue | 2026-04-30 | 功能请求（已关闭），确认 Cookie 认证方式 |
| 7 | GitHub: zhangswings/Mimo-Usage-Monitor | https://github.com/zhangswings/Mimo-Usage-Monitor | 开源工具 | — | 基于 Cookie 的用量监控工具完整实现 |
| 8 | Mimo-Usage-Monitor Python 源码 | https://raw.githubusercontent.com/zhangswings/Mimo-Usage-Monitor/main/scripts/mimo_usage.py | 源码 | 2026-06-27 获取 | `GET /api/v1/tokenPlan/usage`，Cookie 从 `.mimo_cookies` 读取 |
| 9 | Mimo-Usage-Monitor Shell 源码 | https://raw.githubusercontent.com/zhangswings/Mimo-Usage-Monitor/main/scripts/mimo_usage.sh | 源码 | 2026-06-27 获取 | `curl -b "$COOKIES"` 调用同一端点 |
| 10 | 小米 MiMo 控制台余额页（agent-browser 探测） | https://platform.xiaomimimo.com/console/balance | 真实探测 | 2026-06-27 | 页面跳转至登录页，无法完成登录 |

---

## 自审结果

### A. 需求不变量

| # | 不变量 | 结果 | 证据 |
|---|---|---|---|
| 1 | 保持 `新增套餐 → 服务商 → 套餐 → 检测方式` | ✅ 通过 | `git diff --name-only HEAD` 确认未修改任何前端文件 |
| 2 | 没有新增独立小米控制台连接卡片 | ✅ 通过 | 本工单未创建任何 UI 组件 |
| 3 | 没有把"打开窗口"当成同步成功 | ✅ 通过 | 文档明确标记 BLOCKED，不实现任何同步逻辑 |
| 4 | 没有用 mock/人工额度冒充实时额度 | ✅ 通过 | 未创建假 fixture，未编造接口字段，缺失字段明确标注 |
| 5 | 没有保存 Cookie/token/secret | ✅ 通过 | 文档中所有敏感值均为 `<redacted_*>` 占位符，安全扫描确认 |
| 6 | 是否完成真实控制台登录态网络探测 | ⚠️ **未完成** | 见下详述 |

**关于第 6 项**：使用 `agent-browser` 打开 `https://platform.xiaomimimo.com/console/balance`，页面跳转至小米账号登录页。因无小米 MiMo 账号且工单禁止模拟输入账号密码/验证码，无法完成登录。真实控制台登录态下的网络请求观察**未完成**。

### B. 真实链路验证

| 验证类型 | 结果 |
|---|---|
| 官方接口真实存在，契约 READY | ❌ 不成立 |
| 官方接口无法稳定确认，结果 BLOCKED | ❌ 未到这一步（未完成登录态探测） |
| 只看到页面数据，没有接口，结果 BLOCKED | ❌ 不成立（第三方源码确认了接口存在） |
| **真实控制台登录态网络探测未完成，结果 BLOCKED** | ✅ **当前结论** |

### C. 反例检查

| 反例 | 结果 | 来源 |
|---|---|---|
| 未登录时返回什么？ | 401（预期） | 第三方源码中 HTTP 状态码处理逻辑 |
| session 过期时返回什么？ | 401 → `reauth_required` | 第三方文章和源码 |
| 套餐不存在时返回什么？ | **未知** | 社区来源未覆盖此场景 |
| 接口返回字段缺失时是否能识别？ | 可识别（JSON Schema 校验） | 建议实现方式 |
| 返回结构变化时如何失败？ | 通过 Schema 校验失败报错 | 建议实现方式 |

### D. 安全检查

安全扫描命令和结果见"验证命令"章节。

| 检查项 | 结果 |
|---|---|
| 是否出现真实 Cookie 值？ | ✅ 否，全部为 `<redacted_*>` 占位符 |
| 是否出现 Authorization header？ | ✅ 否 |
| 是否出现 Set-Cookie？ | ✅ 否 |
| 是否出现 bearer token？ | ✅ 否 |
| 是否出现真实 session id？ | ✅ 否 |
| 是否出现 API key？ | ✅ 否 |
| 是否出现手机号/邮箱/用户 ID？ | ✅ 否，userId 已脱敏为 `<redacted_user_id>` |

---

## 验证命令

以下命令于 2026-06-27 实际运行，结果如下：

### 1. 架构 guardrails

```powershell
npm.cmd run validate:guardrails
```

**结果**：✅ `Guardrails ok: no violations found`

### 2. 安全扫描

```powershell
rg -n "cookie|authorization|set-cookie|bearer|session|secret|token|phone|email" "docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md" -i
```

**结果**：命中 30+ 行，逐条判定：

| 命中词 | 出现位置 | 判定 |
|---|---|---|
| `Cookie` | 认证方式说明、安全约束讨论 | ✅ 安全 — 描述性文字 |
| `serviceToken` | 脱敏请求头示例（值为 `<redacted_service_token>`） | ✅ 安全 — 脱敏占位符 |
| `userId` | 脱敏请求头示例（值为 `<redacted_user_id>`） | ✅ 安全 — 脱敏占位符 |
| `session` | `sessionFetch`、`session_ref`、`DesktopSessionNotVerified` | ✅ 安全 — 函数名/字段名/状态码 |
| `token` | `tokenPlan`、`plan_total_token`、`serviceToken` | ✅ 安全 — URL 路径/字段名 |
| `email`、`phone` | 未出现 | ✅ |

**无真实凭证泄露**。

### 3. 敏感词扫描（全局）

```powershell
rg -n "cookie|authorization|set-cookie|bearer|session|secret|token|phone|email" test/fixtures -i
rg -n "cookie|authorization|set-cookie|bearer|session|secret|token|phone|email" test/ -i --max-count 100
```

**结果**：test/fixtures 中所有命中均为环境变量名（`TOKENTRACKER_DEVICE_TOKEN`）或 token 计数字段名（`input_tokens`、`output_tokens`）。test/ 目录中所有命中均为 token 计数字段名。**无真实凭证泄露**。

### 4. 回归测试（确认未破坏现有功能）

```powershell
node --test test/token-plans-api.test.js test/token-plan-console-sessions.test.js
```

**结果**：✅ **39 passed, 0 failed**

```powershell
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
```

**结果**：✅ **35 passed, 0 failed**

```powershell
npm --prefix dashboard run typecheck
```

**结果**：✅ `tsc --noEmit` 无错误

```powershell
cargo test xiaomi_mimo_session
```

**结果**：✅ **15 passed, 0 failed**

### 5. 构建验证

```powershell
npm --prefix dashboard run build
npx tauri build --no-bundle
```

**结果**：✅ Vite build 成功，`token-eyes.exe` 构建成功

---

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-06-27 | 初始版本，结论 BLOCKED |
| 2026-06-27 | **返工 v2**：修正 Cookie 概念混淆（不保存 Cookie → sessionFetch 路径分析）；补充 agent-browser 真实控制台探测记录；补齐精确可点击来源链接；新增自审结果和验证命令章节；结论修正为 `BLOCKED：缺少官方控制台登录态网络证据` |
| 2026-06-27 | **R3B session evidence unblock 评估**：复核确认无真实登录态证据、无脱敏 HAR；新增安全 sessionFetch 边界评估（Tauri 2.x 外部 WebView 无法从 Rust 侧读取页面状态/发同会话请求、无 `tauri-plugin-http`、CSP `script-src 'self'` 阻止注入）；结论扩展为 `BLOCKED：缺少官方控制台登录态网络证据，且安全 sessionFetch 边界当前不可用`；明确 R3C 不可派发及解除阻塞的最小条件 (a)(b)(c)；未修改任何生产代码（BLOCKED 路径不实现会话成功能力） |
| 2026-06-27 | **R3B-Rework-2 sessionFetch 能力开发**：调研确认 Tauri 2.11.3 的 `initialization_script`、`on_navigation`、`eval` API 均可用（CSP 不限制 Tauri 注入的 initialization_script）；实现 `SESSION_FETCH_JS`（注入受控 JS，用 `fetch('/api/v1/tokenPlan/usage', { credentials: 'include' })` 同会话请求，通过 `window.__TAURI__.invoke` 回传脱敏 DTO，不读 document.cookie/localStorage/DOM）；实现 `on_navigation` 拦截非官方域名；实现 `verify_xiaomi_mimo_console_session` 通过 eval+轮询触发 fetch 并接收结果；新增 `xiaomi_mimo_quota_result` 命令接收 JS 回传；新增 `XiaomiMimoQuotaDto`（只含 total/used/remaining/expires_at/provider_reported_at）；新增 `ReauthRequired`/`Unsupported`/`Failed` 状态码；27 个测试全部通过（含 12 个新增 sessionFetch 测试）；**sessionFetch 阻塞条件已解除**，仍需用户在 Windows 端实际登录验证（条件一）；`quota_fetch_owner: tauri_webview_session_fetch`；`callable_boundary: verify_xiaomi_mimo_console_session → eval → __tokenEyesSessionFetch__ → invoke event`；`auth_boundary: Cookie 留在 WebView2 会话中，Rust 只接收脱敏 quota DTO` |
