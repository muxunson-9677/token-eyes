# TE-NEXT-W03E-R2：小米 MiMo 实时额度同步接入

## 任务目标

基于 `W03C-R2` 的官方控制台会话和 `W03D-R2` 的额度数据契约，实现小米 MiMo Token Plan 的实时状态同步。用户在 Token Eyes 内应能看到已用额度、剩余额度、到期时间、最后同步时间和失败原因。

本工单的主路径是实时同步。手动字段只能作为同步失败后的兜底显示，不允许替代实时同步验收。

## 前置条件

必须同时满足：

- `TE-NEXT-W03C-R2` 已完成，能创建、验证、删除小米 MiMo 控制台会话。
- `TE-NEXT-W03D-R2` 已完成，存在 `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-25.md` 和脱敏 fixture。

如果 `W03D-R2` 结论是 `BLOCKED`，本工单不得实现假同步；应只提交“实时同步阻塞”的 UI 状态和验收报告。

## 开始前必读

1. `CLAUDE.md`
2. `docs/tasks/dispatch/TE-NEXT-W03-R2-live-quota-dispatch-order.md`
3. `docs/tasks/dispatch/TE-NEXT-W03C-R2-xiaomi-mimo-console-session-auth.md`
4. `docs/tasks/dispatch/TE-NEXT-W03D-R2-xiaomi-mimo-console-quota-endpoint-discovery.md`
5. `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-25.md`
6. `src/lib/token-plan-refresh.js`
7. `src/lib/local-api.js`
8. `dashboard/src/components/settings/TokenPlanSection.jsx`
9. `dashboard/src/lib/api.ts`
10. `src/lib/token-plan-catalog/xiaomi-mimo.catalog.json`

## 允许修改或新增的文件

- 新增：`src/lib/token-plan-providers/xiaomi-mimo-console.js`
- 新增：`test/token-plan-providers/xiaomi-mimo-console.test.js`
- 修改：`src/lib/token-plan-refresh.js`
- 修改：`test/token-plan-refresh.test.js`
- 修改：`src/lib/local-api.js`
- 修改：`test/token-plans-api.test.js`
- 修改：`dashboard/src/lib/api.ts`
- 修改：`dashboard/src/components/settings/TokenPlanSection.jsx`
- 修改：`dashboard/src/components/settings/TokenPlanSection.test.jsx`
- 修改：`dashboard/src/content/copy.csv`
- 修改：`dashboard/src/content/i18n/zh/dashboard.json`，仅在文案同步流程需要时修改
- 新增：`docs/test-reports/token-plan/2026-06-25-xiaomi-mimo-live-quota.md`

不要修改与 Token Plan 无关的模块。

## 数据字段规范

Token Plan 记录新增或规范化以下字段：

```js
{
  account_binding_id: "uuid",
  quota_source: "catalog|provider_live|manual_fallback",
  provider_reported_at: "2026-06-25T00:00:00.000Z",
  last_refresh_status: "success|failed|reauth_required|rate_limited|blocked",
  last_refresh_error_code: "",
  last_refresh_error: "",
  last_successful_refresh_at: "2026-06-25T00:00:00.000Z"
}
```

同步成功时：

- 更新 `used_quota`。
- 更新 `remaining_quota`。
- 更新 `expires_at`。
- `quota_source` 设为 `provider_live`。
- 写入 `provider_reported_at` 和 `last_successful_refresh_at`。

同步失败时：

- 不清空上次成功的额度数据。
- 更新失败状态和中文失败原因。
- UI 必须显示“当前显示的是上次成功同步数据”或等价文案。

## 任务 1：实现小米控制台适配器测试

新增 `test/token-plan-providers/xiaomi-mimo-console.test.js`。

测试使用 `W03D-R2` 的脱敏 fixture，覆盖：

1. 成功提取已用额度、剩余额度、到期时间。
2. 如果控制台只返回总额度和已用额度，能计算剩余额度，并标注计算方式。
3. `401` 或 `403` 映射为 `reauth_required`。
4. `429` 映射为 `rate_limited`，并给出中文稍后重试原因。
5. 网络错误映射为 `failed`。
6. 响应结构变化时映射为 `blocked`，不编造数值。
7. 日志和错误中不包含 Cookie、token、Authorization。

运行：

```powershell
node --test test/token-plan-providers/xiaomi-mimo-console.test.js
```

预期：实现前失败，实现后通过。

## 任务 2：实现 `xiaomi-mimo-console` 适配器

新增 `src/lib/token-plan-providers/xiaomi-mimo-console.js`，导出：

```js
async function fetchXiaomiMimoConsoleQuota({
  plan,
  binding,
  sessionFetch,
  now,
}) {}

function normalizeXiaomiMimoConsoleQuota(payload, plan, now) {}

module.exports = {
  fetchXiaomiMimoConsoleQuota,
  normalizeXiaomiMimoConsoleQuota,
};
```

要求：

- 请求路径只能来自 `W03D-R2` 的数据契约。
- `sessionFetch` 必须使用 `W03C-R2` 的受控会话，不允许使用外部浏览器 Cookie。
- 只接受 `provider_id: "xiaomi_mimo"`。
- 只接受当前记录关联的 `account_binding_id`。
- 不记录原始响应体。
- 不在错误里带凭证。

## 任务 3：接入刷新框架和本地 API

修改 `src/lib/token-plan-refresh.js`：

- 刷新时按 `provider_id` 找 provider adapter，不按 Agent `source`。
- 小米 MiMo 记录如果有 `account_binding_id`，使用控制台实时适配器。
- 小米 MiMo 记录如果没有 `account_binding_id`，状态为 `reauth_required`，提示用户连接控制台账号。
- 自动刷新只在桌面本地进程存活时运行。
- 不再显示或使用 `cookie_scrape` 刷新方式。

修改 `src/lib/local-api.js`：

- 保存 Token Plan 时允许关联 `account_binding_id`。
- 刷新接口返回更新后的实时状态。
- API 响应不得包含会话凭证。

新增或修改测试：

```powershell
node --test test/token-plan-refresh.test.js test/token-plans-api.test.js
```

测试必须覆盖：

- Hermes + 小米 MiMo 套餐按 `provider_id` 使用小米适配器。
- 未连接控制台时返回 `reauth_required`。
- 连接后同步成功更新已用、剩余、到期。
- 失败不覆盖上次成功数据。
- 响应不含 Cookie/token。

## 任务 4：接入前端实时状态

修改 `TokenPlanSection.jsx`：

- 小米 MiMo 目录套餐显示“连接控制台账号”入口。
- 已连接后显示“立即同步”按钮。
- 显示最后同步时间。
- 显示数据来源：`实时同步` / `上次同步` / `手动兜底`。
- 显示已用、剩余、到期时间。
- 同步失败时显示中文原因和重新授权入口。
- 移除 `Cookie 抓取（未实现）` 选项。
- 不再显示 `credential_ref` 输入框给用户。

组件测试必须覆盖：

- 未连接时提示连接小米控制台。
- 已连接并同步成功时显示实时额度。
- 授权失效时显示重新连接。
- 同步失败时保留上次成功数据。
- UI 不出现 Cookie 抓取选项。

运行：

```powershell
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
```

## 任务 5：端到端验收报告

新增 `docs/test-reports/token-plan/2026-06-25-xiaomi-mimo-live-quota.md`，包含：

```markdown
# 小米 MiMo 实时额度同步验收报告

## 自动化验证

| 命令 | 结果 | 说明 |
|---|---|---|

## 桌面端用户流程

| 场景 | 结果 | 说明 |
|---|---|---|
| 连接小米控制台账号 | PASS / FAIL |  |
| 立即同步额度 | PASS / FAIL |  |
| 自动刷新 | PASS / FAIL |  |
| 授权失效提示 | PASS / FAIL |  |
| 删除连接 | PASS / FAIL |  |

## 数据对齐

| 字段 | Token Eyes | 小米控制台 | 是否一致 |
|---|---|---|---|
| 套餐名称 |  |  |  |
| 已用额度 |  |  |  |
| 剩余额度 |  |  |  |
| 到期时间 |  |  |  |

## 凭证安全检查

- 本地配置：
- API 响应：
- 日志：
- 构建产物：

## 结论

PASS / BLOCKED
```

报告不得包含真实 Cookie、token、手机号、邮箱。

## 最终验证

运行：

```powershell
node --test test/xiaomi-mimo-console-contract.test.js
node --test test/token-plan-providers/xiaomi-mimo-console.test.js
node --test test/token-plan-refresh.test.js test/token-plans-api.test.js
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npx tauri build --no-bundle
```

安全检查：

```powershell
rg -n -i "cookie|authorization|set-cookie|access_token|refresh_token|api[_-]?key" "$HOME\.tokentracker" dashboard\dist src-tauri\target docs\test-reports\token-plan
```

命中必须人工复核。真实凭证出现即阻塞。

## 验收标准

- 用户完成官方控制台登录后，无需手动输入额度，即可同步状态。
- 已用额度、剩余额度、到期时间来自控制台实时数据源。
- 同步失败时保留上次成功数据并显示失败原因。
- 自动刷新在本地进程存活时生效。
- UI 不再把手动记录作为主路径。
- 所有最终验证通过。

## 禁止事项

- 不把手动录入作为实时同步完成标准。
- 不重新加入 Cookie 抓取选项。
- 不读取外部浏览器 Cookie。
- 不保存或展示凭证明文。
- 不编造控制台未返回的额度数据。
