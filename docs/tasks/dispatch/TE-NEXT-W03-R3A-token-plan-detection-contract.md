# TE-NEXT-W03-R3A - Token 套餐检测方式数据模型与接口契约

## 任务 ID

`TE-NEXT-W03-R3A`

## 所属模块

Token 套餐 / 检测方式 / 本地 API 契约

## 派发对象

Codex

## 当前状态

已完成（2026-06-25），验收通过。

## 用户需求基线

Token 套餐模块必须保持 `新增套餐 -> 服务商 -> 套餐 -> 检测方式` 的结构。

不允许再做以下方向：

- 不在 Token 套餐主界面单独放“小米 MiMo 控制台连接”卡片。
- 不把小米账号连接做成全局入口。
- 不把“打开官网窗口成功”当成“已连接”。
- 不让用户手动维护已用额度、剩余额度、到期时间作为主路径。
- 不用“去官网查看”链接替代检测。

## 前置依赖

- `W03-R2` 已完成：打开小米控制台窗口不再直接返回 `connected: true`。
- `docs/tasks/dispatch/TE-NEXT-W03-R3-token-plan-auth-methods-dispatch.md` 已存在总调度。
- `src/lib/token-plan-catalog/xiaomi-mimo.catalog.json` 已包含已核验小米 MiMo 套餐目录。

## 目标

定义 Token 套餐检测方式的数据模型和本地 API 契约，作为 `W03-R3B`、`W03-R3C`、`W03-R3D` 的唯一输入。

本工单只做契约设计和最小后端模型落点，不直接写前端实现。

## 必读文件

1. `CLAUDE.md`
2. `上下文.md`
3. `docs/tasks/dispatch/TE-NEXT-W03-R3-token-plan-auth-methods-dispatch.md`
4. `docs/dev-notes/xiaomi-mimo-plan-contract-2026-06-25.md`
5. `src/lib/local-api.js`
6. `src/lib/token-plan-refresh.js`
7. `src/lib/token-plan-catalog/xiaomi-mimo.catalog.json`
8. `test/token-plans-api.test.js`
9. `test/token-plan-console-sessions.test.js`

## 允许修改的文件

- 修改：`src/lib/local-api.js`
- 修改：`src/lib/token-plan-refresh.js`
- 修改：`test/token-plans-api.test.js`
- 修改：`test/token-plan-console-sessions.test.js`
- 新增或修改：`docs/dev-notes/token-plan-detection-contract.md`
- 修改：`docs/tasks/dispatch/TE-NEXT-W03-R3-token-plan-auth-methods-dispatch.md`

不得修改 `dashboard/src/components/settings/TokenPlanSection.jsx` 做前端实现。

## 数据模型契约

每条 Token 套餐记录必须能表达以下结构。字段命名沿用本地 API 的 snake_case。

```js
{
  id: "uuid",
  source: "hermes",
  provider_id: "xiaomi_mimo",
  plan_id: "xiaomi_mimo_standard_monthly",
  plan_label: "Standard（月付）",

  quota_kind: "credits",
  quota_unit: "credits",
  total_quota: 11000000000,
  total_quota_display: "11,000,000,000（11B）Credits",
  quota_catalog_version: "2026-06-25",
  quota_source: "catalog|provider_reported|custom_api|manual|manual_legacy",

  used_quota: 0,
  remaining_quota: 0,
  expires_at: "",

  detection_method: "official_account|custom_api",
  detection_config: {
    official_account: {
      provider_home_url: "https://platform.xiaomimimo.com/token-plan",
      account_binding_id: "console-session-or-account-binding-id"
    },
    custom_api: {
      api_key_ref: "token-plan/xiaomi_mimo/custom-api/<uuid>",
      api_format: "json_path|openai_compatible|custom_mapping",
      request_url: "https://example.com/quota",
      official_url: "https://platform.xiaomimimo.com/token-plan",
      method: "GET|POST",
      response_mapping: {
        total_quota_path: "$.total",
        used_quota_path: "$.used",
        remaining_quota_path: "$.remaining",
        expires_at_path: "$.expires_at"
      }
    }
  },

  sync_status: "not_configured|auth_required|syncing|success|failed|reauth_required|unsupported",
  last_sync_attempt_at: "",
  last_synced_at: "",
  last_error_code: "",
  last_error_message: "",
  provider_reported_at: ""
}
```

## 兼容旧字段

现有字段需要兼容读取，不得导致旧记录丢失：

| 旧字段 | 新语义 |
|---|---|
| `refresh_method: "manual"` | `sync_status: "not_configured"`，除非已有同步状态 |
| `refresh_method: "official_api"` | `detection_method: "official_account"` 或按 provider 能力映射 |
| `credential_ref` | 只作为历史凭证引用读取，不允许保存明文 |
| `last_refresh_status` | 映射到 `sync_status` |
| `last_refresh_at` | 映射到 `last_sync_attempt_at` 或 `last_synced_at` |
| `last_refresh_error` | 映射到 `last_error_message` |

`refresh_*` 字段可暂时保留给旧 UI 使用，但新代码不得只依赖旧字段。

## 敏感字段边界

允许落普通 config：

- `account_binding_id`
- `api_key_ref`
- `provider_home_url`
- `request_url`
- `official_url`
- `api_format`
- `response_mapping`
- 同步状态、错误码、错误消息
- 额度快照

禁止落普通 config、接口响应、日志、测试快照、前端列表：

- API Key 原文
- Cookie 原文
- Bearer token
- Authorization header
- 账号密码、验证码、二维码内容
- 可还原秘密的 token 片段

凭证引用必须匹配受控格式：

```text
token-plan/<provider_id>/<purpose>/<uuid>
```

例如：

```text
token-plan/xiaomi_mimo/custom-api/2e2c7f3d-7b9f-4c92-b2d2-c6e9f4a8c320
```

## 本地 API 契约

### 1. 列出套餐记录

```text
GET /functions/tokentracker-token-plans
```

响应：

```js
{
  records: [TokenPlanRecord]
}
```

### 2. 创建或更新套餐记录

```text
POST /functions/tokentracker-token-plans
```

请求允许包含 `detection_method`、`detection_config` 和额度快照字段。

请求不得包含以下字段：

```text
api_key
apiKey
cookie
authorization
authorization_header
bearer
token
password
```

响应：

```js
{
  ok: true,
  record: TokenPlanRecord,
  records: [TokenPlanRecord]
}
```

### 3. 保存自定义 API 密钥

```text
POST /functions/tokentracker-token-plan-secrets
```

仅桌面本地授权请求可用。请求：

```js
{
  provider_id: "xiaomi_mimo",
  purpose: "custom-api",
  secret: "user-input-api-key"
}
```

响应只返回引用：

```js
{
  ok: true,
  api_key_ref: "token-plan/xiaomi_mimo/custom-api/<uuid>"
}
```

不得提供 GET 读取秘密接口。

### 4. 检测或同步套餐状态

```text
POST /functions/tokentracker-token-plans-refresh
```

请求：

```js
{
  id: "token-plan-record-id"
}
```

响应：

```js
{
  ok: true,
  plan: TokenPlanRecord,
  records: [TokenPlanRecord]
}
```

失败时只更新：

- `sync_status`
- `last_sync_attempt_at`
- `last_error_code`
- `last_error_message`

失败不得清空上一次成功的：

- `total_quota`
- `used_quota`
- `remaining_quota`
- `expires_at`
- `provider_reported_at`

## 状态映射

| 场景 | `sync_status` |
|---|---|
| 未选择检测方式 | `not_configured` |
| 官网账号未绑定或等待登录 | `auth_required` |
| 检测请求进行中 | `syncing` |
| 检测并解析成功 | `success` |
| 网络错误、格式错误、mapping 缺失 | `failed` |
| 授权过期、401、403、会话撤销 | `reauth_required` |
| 服务商没有可复现额度数据源 | `unsupported` |

## 实施步骤

- [x] 写 `test/token-plans-api.test.js` 失败测试：POST 保存 `detection_method: "custom_api"` 时响应不包含 API Key 明文。
- [x] 写 `test/token-plans-api.test.js` 失败测试：POST 带 `api_key`、`cookie`、`authorization` 字段必须返回 400。
- [x] 写 `test/token-plans-api.test.js` 失败测试：旧记录读取后补齐 `detection_method`、`sync_status`，且旧额度不丢失。
- [x] 写 `test/token-plans-api.test.js` 失败测试：刷新失败只更新错误状态，不清空上次成功额度。
- [x] 在 `src/lib/local-api.js` 增加检测字段归一化。
- [x] 在 `src/lib/token-plan-refresh.js` 增加新状态常量和旧字段兼容映射。
- [x] 新增 `docs/dev-notes/token-plan-detection-contract.md`，保存本工单确定的数据模型和接口契约。
- [x] 运行验证命令。

## 验证命令

```bash
node --test test/token-plans-api.test.js test/token-plan-refresh.test.js test/token-plan-console-sessions.test.js
npm run validate:guardrails
```

## 验收标准

1. `GET /functions/tokentracker-token-plans` 返回的新旧记录都有统一检测字段。
2. 本地 API 拒绝明文 API Key、Cookie、Authorization 等长期保存字段。
3. 自定义 API 只保存 `api_key_ref`，不保存秘密。
4. 官网账号检测只保存 `account_binding_id` 或 `session_ref` 引用，不保存 Cookie。
5. 检测失败不清空上次成功额度。
6. `W03-R3B` 和 `W03-R3C` 可以只依赖本工单契约开工。

## 后续派发

本工单完成后，允许并行派发：

- `TE-NEXT-W03-R3B-token-plan-form-provider-detection.md`
- `TE-NEXT-W03-R3C-custom-api-detection-config.md`

不得提前派发 `TE-NEXT-W03-R3D-token-plan-sync-integration-acceptance.md`。
