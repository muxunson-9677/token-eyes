# TE-NEXT-W03D - 小米 MiMo 官方实时额度适配器

## 任务 ID

`TE-NEXT-W03D`

## 所属模块

Token 套餐 / 小米 MiMo 账号额度同步

## 前置依赖

1. `TE-NEXT-W03A` 报告已确认目标官方站点、套餐目录和授权方式。
2. `TE-NEXT-W03B` 已完成 `provider_id`、`plan_id` 与目录规范化。
3. `TE-NEXT-W03C` 已完成受限凭证保管和账号绑定。

如果 W03A 的结论是“没有官方可授权读取额度的接口或页面”，本工单不得实现抓包、逆向或浏览器 Cookie 抓取。只实现清晰的 `unsupported` 状态和手动套餐回退，不应宣称实时同步。

## 任务目标

为 `provider_id: "xiaomi_mimo"` 实现仅基于 W03A 已核验官方能力的额度适配器。成功时同步服务商实际返回的总额度、已用额度、剩余额度、到期时间和读取时间；失败时保存可操作的中文原因，不覆盖上一次成功值。

## 开始前必读

1. `CLAUDE.md`
2. `docs/dev-notes/xiaomi-mimo-plan-contract-2026-06-25.md`
3. `src/lib/token-plan-catalog/xiaomi-mimo.catalog.json`
4. `docs/tasks/dispatch/TE-NEXT-W03B-token-plan-provider-catalog-and-form.md`
5. `docs/tasks/dispatch/TE-NEXT-W03C-token-plan-credential-vault-and-account-authorization.md`
6. `src/lib/token-plan-refresh.js`
7. `src/lib/local-api.js`
8. `test/token-plan-refresh.test.js`
9. `test/token-plans-api.test.js`
10. `dashboard/src/components/settings/TokenPlanSection.jsx`

## 允许修改的文件

- 新增：`src/lib/token-plan-providers/xiaomi-mimo.js`
- 新增：`test/token-plan-providers/xiaomi-mimo.test.js`
- 修改：`src/lib/token-plan-refresh.js`
- 修改：`src/lib/local-api.js`
- 修改：`test/token-plan-refresh.test.js`
- 修改：`test/token-plans-api.test.js`
- 修改：`dashboard/src/components/settings/TokenPlanSection.jsx`
- 修改：`dashboard/src/components/settings/TokenPlanSection.test.jsx`
- 修改：`dashboard/src/content/copy.csv`
- 修改：`dashboard/src/content/i18n/zh/dashboard.json`，仅在 copy 流程要求时修改

不改小米目录 JSON 的已核验套餐事实；若官方资料变化，先回到 W03A 更新证据和目录。

## 确定的适配器接口

`src/lib/token-plan-providers/xiaomi-mimo.js` 必须导出：

```js
async function fetchXiaomiMimoQuota({ plan, binding, getCredential, fetchImpl, now }) {
  // 返回成功快照或抛出具有 code 与 userMessage 的错误
}

function normalizeXiaomiMimoQuota(payload, plan) {
  // 返回：
  // {
  //   total_quota, total_quota_display, quota_unit,
  //   used_quota, remaining_quota, expires_at,
  //   quota_source: "provider_reported",
  //   provider_reported_at
  // }
}
```

适配器注册键固定为 `xiaomi_mimo`。刷新器选择适配器时使用 `plan.provider_id`，不再使用 Agent `plan.source`。

额外状态字段固定为：

```js
{
  account_binding_id: "uuid",
  provider_reported_at: "2026-06-25T00:00:00.000Z",
  quota_source: "provider_reported",
  last_refresh_status: "success|failed|unsupported|reauth_required",
  last_refresh_error_code: "",
  last_refresh_error: ""
}
```

## 任务 1：根据 W03A 实现传输层契约测试

### 1.1 先写失败测试

新建 `test/token-plan-providers/xiaomi-mimo.test.js`。根据 W03A 已确认的官方请求格式，使用注入的 `fetchImpl` 编写测试，至少覆盖：

1. 成功响应正确规范化总额、已用、剩余、到期时间和原始单位。
2. 官方返回没有总额度时，保留目录固定总额或标为“官网未公布”，不能编造数值。
3. `401`/授权过期映射为 `reauth_required`，中文消息提示重新授权，但不泄露响应体或秘密。
4. `429` 记录可读的稍后重试原因，不能紧密重试。
5. 不支持套餐或官方没有查询接口时映射为 `unsupported`。
6. 请求头只使用从受限 `getCredential` 获得的秘密；任何测试断言或日志不得打印秘密。

推荐测试形态：

```js
const result = await fetchXiaomiMimoQuota({
  plan: { provider_id: "xiaomi_mimo", plan_id: "<W03A 已核验套餐>", account_binding_id: "binding-1" },
  binding: { id: "binding-1", auth_kind: "<W03A 已核验方式>", credential_ref: "token-plan/xiaomi_mimo/binding-1" },
  getCredential: async () => "test-secret",
  fetchImpl: async () => new Response(JSON.stringify(<W03A 官方样例的最小脱敏响应>), { status: 200 }),
  now: "2026-06-25T00:00:00.000Z",
});
```

运行：

```bash
node --test test/token-plan-providers/xiaomi-mimo.test.js
```

预期：实现前失败。

### 1.2 实现最小适配器

1. 使用 W03A 已核验的官方 URL、方法、请求头和 payload；禁止补充任何猜测路径。
2. 请求设置合理超时；超时必须归类为可读网络错误。
3. 请求前确认绑定状态是 `connected`；没有绑定返回 `reauth_required`，不发网络请求。
4. 只接受与当前 `plan_id` 语义一致的套餐数据；返回其他套餐时标记为数据不匹配，保留上次成功快照。
5. 严格按官方单位规范化，不把人民币、积分、请求数或速率百分比伪装成 Token。
6. 成功时返回上述快照对象；失败只抛出结构化错误 `{ code, userMessage }`。

重新运行适配器测试，预期通过。

## 任务 2：接入刷新调度器与本地 API

### 2.1 先扩展刷新器测试

在 `test/token-plan-refresh.test.js` 新增测试：

1. 注册 `xiaomi_mimo` 适配器后，`refreshPlan` 以 `provider_id` 选择适配器，即使 `source` 为 `hermes`。
2. 成功结果同步 `expires_at`、`quota_source`、`provider_reported_at`。
3. 适配器返回 `reauth_required` 或 `unsupported` 时，保留旧额度，只更新状态和错误。
4. 凭证服务调用失败时，刷新状态为 `reauth_required`，不退化为 Cookie 抓取。

先运行：

```bash
node --test test/token-plan-refresh.test.js
```

预期：新增测试失败。

### 2.2 修改刷新框架

在 `src/lib/token-plan-refresh.js`：

1. provider adapter 注册与查找改为 `provider_id`。
2. 将 `account_binding_id` 传入适配器，并通过 W03C 的受限凭证服务提供 `getCredential`。
3. 支持 `success`、`failed`、`unsupported`、`reauth_required` 四种状态。
4. 仅在 `success` 时覆盖额度与到期时间；非成功状态保留最近一次成功快照。
5. `refresh_method` 只保留 `manual` 和 `official_api`。移除 UI 中“Cookie 抓取（未实现）”可选项；历史 `cookie_scrape` 记录升级为 `manual`，并写清“浏览器 Cookie 自动抓取已禁用，请使用官方授权或手动更新”。

在 `src/lib/local-api.js` 注册小米适配器并连接绑定元数据查询；刷新 API 应返回更新后记录，但响应绝不包含凭证。

重新运行刷新与 API 测试，预期通过。

## 任务 3：展示实时状态并保护手工回退

在 `TokenPlanSection.jsx`：

1. 对已绑定且可刷新记录显示“上次同步时间”“实时数据来源：官方账号”“立即同步”按钮和自动刷新开关。
2. `reauth_required` 显示“授权已失效，请重新授权”，提供 W03C 的重新授权入口。
3. `unsupported` 显示“该服务商暂未提供官方额度查询，当前显示手工记录”，不显示刷新成功。
4. 显示到期时间时标注“实时同步”或“手工填写”，与 `quota_source` 一致。
5. 请求失败时显示简明错误和重试时间；不要直接展示服务商原始错误体。

新增组件测试，覆盖成功同步、授权失效、无官方接口、手工套餐四种状态。

## 最终验证

运行：

```bash
node --test test/token-plan-providers/xiaomi-mimo.test.js
node --test test/token-plan-refresh.test.js test/token-plans-api.test.js
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npx tauri build --no-bundle
```

人工验证：

1. 使用测试账号或用户本人授权账号完成官方授权，创建 Hermes + 小米 MiMo 套餐记录。
2. 点击“立即同步”，确认总额度、已用、剩余和到期时间与官方页面一致，且显示同步时间。
3. 撤销授权或使用失效测试令牌，确认应用显示重新授权而不清空上次成功额度。
4. 检查设置页、本地 API 响应、日志和 tracker config，确认没有明文令牌或 Cookie。

## 验收标准

1. 小米套餐数据只来自 W03A 已核验的官方能力。
2. 刷新按 `provider_id` 工作，Hermes 使用小米套餐时不会被错误识别为独立 Agent。
3. 已用、剩余、到期时间和同步状态可实时更新；任何不可用状态均明确呈现。
4. 授权失效、限流、网络故障和不支持均不覆盖上次成功数据。
5. 无官方查询能力时，产品明确回退到手工记录，不实施 Cookie 抓取。
6. 所有最终验证命令通过，桌面构建成功。

## 禁止事项

- 不实现浏览器 Cookie 自动抓取、DevTools 协议读取或网页 DOM 逆向。
- 不调用 W03A 未确认的 URL 或私有接口。
- 不记录 HTTP 请求头、响应体中的秘密、API Key、Cookie 或账号 ID。
- 不将没有明确总额度的速率限制转换为 Token 套餐总额。
- 不改动无关的 Agent parser、价格规则或 Spend 页面。

## 完成后报告

回复中提供：适配器使用的官方证据链接、状态映射表、脱敏测试结果、全部验证命令结果、手工验证差异说明和新的 EXE 路径。
