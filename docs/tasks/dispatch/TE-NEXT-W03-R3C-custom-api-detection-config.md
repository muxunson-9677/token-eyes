# TE-NEXT-W03-R3C - 自定义 API 检测配置与状态解析

## 任务 ID

`TE-NEXT-W03-R3C`

## 所属模块

Token 套餐 / 自定义 API 检测 / 凭证安全 / 状态解析

## 派发对象

Claude Code

## 当前状态

待派发，必须等待 `TE-NEXT-W03-R3A` 完成。

## 前置依赖

- `TE-NEXT-W03-R3A` 已确定 `custom_api` 数据模型、敏感字段边界和同步状态。

## 目标

支持用户在套餐记录内配置自定义 API 检测：

- API Key
- API 格式
- 请求地址
- 官网链接
- 响应字段映射

检测结果必须统一写入 Token 套餐状态字段：

- 总额度
- 已用额度
- 剩余额度
- 到期时间
- 最后同步时间
- 同步状态
- 失败原因

## 必读文件

1. `CLAUDE.md`
2. `上下文.md`
3. `docs/tasks/dispatch/TE-NEXT-W03-R3A-token-plan-detection-contract.md`
4. `src/lib/local-api.js`
5. `src/lib/token-plan-refresh.js`
6. `test/token-plans-api.test.js`
7. `test/token-plan-refresh.test.js`
8. `dashboard/src/lib/api.ts`
9. `dashboard/src/components/settings/TokenPlanSection.jsx`
10. `dashboard/src/content/copy.csv`

## 允许修改的文件

- 修改：`src/lib/local-api.js`
- 修改：`src/lib/token-plan-refresh.js`
- 新增：`src/lib/token-plan-custom-api.js`
- 新增：`test/token-plan-custom-api.test.js`
- 修改：`test/token-plans-api.test.js`
- 修改：`test/token-plan-refresh.test.js`
- 修改：`dashboard/src/lib/api.ts`
- 修改：`dashboard/src/components/settings/TokenPlanSection.jsx`
- 修改：`dashboard/src/components/settings/TokenPlanSection.test.jsx`
- 修改：`dashboard/src/content/copy.csv`
- 修改：`dashboard/src/content/i18n/zh/dashboard.json`，仅在 copy 流程要求时修改

## 安全要求

API Key 不得明文出现在：

- `config.json`
- 本地 API 响应
- 日志
- 测试快照
- 前端列表
- 错误消息
- `dashboard/dist`

如果当前环境没有可用本机凭证库，不允许假装已安全保存。必须返回 `desktop_required` 或明确阻塞，并只保存 `api_key_ref`。

## 自定义 API 配置契约

```js
{
  detection_method: "custom_api",
  detection_config: {
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
  }
}
```

## 解析输出契约

成功输出：

```js
{
  total_quota: 11000000000,
  used_quota: 3200000000,
  remaining_quota: 7800000000,
  expires_at: "2026-07-25",
  quota_source: "custom_api",
  provider_reported_at: "2026-06-25T00:00:00.000Z",
  sync_status: "success",
  last_error_code: "",
  last_error_message: ""
}
```

失败输出不得覆盖上次成功额度：

```js
{
  sync_status: "failed",
  last_error_code: "CUSTOM_API_MAPPING_MISSING",
  last_error_message: "自定义 API 响应缺少剩余额度字段",
  last_sync_attempt_at: "2026-06-25T00:00:00.000Z"
}
```

## 实施步骤

- [ ] 写 `test/token-plan-custom-api.test.js` 失败测试：fixture 成功响应可解析为统一额度快照。
- [ ] 写 `test/token-plan-custom-api.test.js` 失败测试：mapping 缺失返回 `CUSTOM_API_MAPPING_MISSING`。
- [ ] 写 `test/token-plan-custom-api.test.js` 失败测试：401/403 映射为 `reauth_required`，错误消息不泄露 API Key。
- [ ] 写 `test/token-plans-api.test.js` 失败测试：POST 明文 `api_key` 被拒绝。
- [ ] 写 `test/token-plans-api.test.js` 失败测试：GET 套餐列表不返回 API Key。
- [ ] 实现 `src/lib/token-plan-custom-api.js` 的请求、解析和错误映射。
- [ ] 修改 `src/lib/token-plan-refresh.js`，按 `detection_method: "custom_api"` 调用自定义 API 检测。
- [ ] 修改 `src/lib/local-api.js`，保存自定义 API 配置时只保留 `api_key_ref`。
- [ ] 在 `dashboard/src/lib/api.ts` 增加保存 API Key 引用的前端调用封装。
- [ ] 在 `TokenPlanSection.jsx` 表单内补齐自定义 API 配置区域，字段名必须符合 R3A 契约。
- [ ] 运行验证命令。

## 验证命令

```bash
node --test test/token-plan-custom-api.test.js test/token-plans-api.test.js test/token-plan-refresh.test.js
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
```

明文泄露检查：

```powershell
rg -n -i "do-not-leak|raw-cookie|authorization:|bearer |api[_-]?key" "$HOME\.tokentracker" dashboard\dist
```

预期：不命中测试秘密或真实秘密。

## 验收标准

1. 自定义 API 配置可以保存为套餐记录的一种检测方式。
2. API Key 只保存为引用，不写入普通配置、响应、日志和前端列表。
3. 成功响应能解析为统一套餐状态。
4. 失败、格式错误、mapping 缺失、授权失效都有中文失败原因。
5. 检测失败不清空上次成功额度。

## 并行关系

本工单可与 `TE-NEXT-W03-R3B-token-plan-form-provider-detection.md` 并行执行。

本工单不得实现 R3D 的完整统一展示验收。
