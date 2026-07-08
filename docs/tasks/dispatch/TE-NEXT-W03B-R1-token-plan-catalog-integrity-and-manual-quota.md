# TE-NEXT-W03B-R1 - Token 套餐目录完整性与手工额度修复工单

> **给执行型 Agent 的要求：** 按任务逐项执行，先写失败测试，再写最小实现；每个步骤使用复选框记录。不得使用未公开的小米接口，不得实现 Cookie 抓取。

**目标：** 目录套餐只能保存已核验的套餐 ID；小米 MiMo 套餐允许用户手工填写已用额度、剩余额度和到期时间；没有官方额度 API 时不展示可用的自动刷新入口。

**架构：** 后端是套餐目录真实性的唯一裁决者，任何 `provider_id` 与 `plan_id` 组合必须在服务端验证。前端仅锁定目录给出的总额度，运行中的用量字段保留手工编辑能力；小米目录套餐强制使用 `manual` 刷新方式。

**技术栈：** Node.js CommonJS、本地 HTTP API、React 18、Vitest、Node `node:test`。

---

## 任务 ID

`TE-NEXT-W03B-R1`

## 背景与已确认缺陷

W03B 的现有测试可以通过，但独立 API 验证发现以下请求返回 HTTP `200` 并被保存：

```json
{
  "source": "hermes",
  "provider_id": "xiaomi_mimo",
  "plan_id": "made-up-plan",
  "plan_label": "伪造套餐",
  "total_quota": 7
}
```

这绕过了“套餐目录由服务端规范化”的要求。另一个问题是，前端对目录套餐同时禁用了总额度、已用额度、剩余额度和到期时间；小米没有官方额度查询 API，因此用户无法为已选小米套餐手工维护后面三项信息。最后，表单仍显示 `official_api`、`cookie_scrape`、凭证引用和自动刷新开关，会误导用户以为小米支持自动同步。

## 开始前必读

1. `CLAUDE.md`
2. `docs/dev-notes/xiaomi-mimo-plan-contract-2026-06-25.md`
3. `docs/tasks/dispatch/TE-NEXT-W03B-token-plan-provider-catalog-and-form.md`
4. `src/lib/token-plan-catalog/index.js`
5. `src/lib/local-api.js` 中 `normalizeTokenPlanRecord`、`upsertTokenPlanRecord` 和 Token Plan 路由
6. `dashboard/src/components/settings/TokenPlanSection.jsx`
7. `test/token-plans-api.test.js`
8. `dashboard/src/components/settings/TokenPlanSection.test.jsx`

## 允许修改的文件

- 修改：`src/lib/local-api.js`
- 修改：`test/token-plans-api.test.js`
- 修改：`dashboard/src/components/settings/TokenPlanSection.jsx`
- 修改：`dashboard/src/components/settings/TokenPlanSection.test.jsx`
- 修改：`dashboard/src/content/copy.csv`
- 修改：`dashboard/src/content/i18n/zh/dashboard.json`，仅当复制校验工具要求同步时修改

不要修改小米套餐数量、额度值、目录 JSON、调度器实现、Tauri 配置、parser、花销模块或任何无关文件。

## 固定行为契约

| 输入 | 后端结果 |
|---|---|
| `provider_id: "xiaomi_mimo"` + 目录中存在的 `plan_id` | HTTP `200`；总额度、单位、展示文案和目录版本均由目录覆盖 |
| `provider_id: "xiaomi_mimo"` + 空或不存在的 `plan_id` | HTTP `400`；不写入本地配置 |
| 目录中不存在的非 `custom` `provider_id` | HTTP `400`；不写入本地配置 |
| `provider_id: "custom"` + `plan_id: "custom"` | HTTP `200`；使用手工套餐字段 |
| 旧记录缺少 `provider_id` | 读取时迁移为 `custom/custom/manual`，原始额度不变 |

小米 MiMo 的目录套餐在前端必须满足：

1. `total_quota` 不可编辑，并显示目录的 Credits 文案。
2. `used_quota`、`remaining_quota`、`expires_at` 可编辑，保存后保留用户值。
3. 不显示刷新方式、刷新间隔、凭证引用或自动刷新开关。
4. 保存的 `refresh_method` 固定为 `manual`，`refresh_enabled` 固定为 `false`，`credential_ref` 固定为空字符串。
5. 套餐下拉框只显示小米目录中已核验的套餐；“自定义套餐”只在服务商选择为 `custom` 时显示。

## 任务 1：阻止伪造服务商与套餐 ID

**文件：**

- 修改：`test/token-plans-api.test.js`
- 修改：`src/lib/local-api.js`

- [ ] **步骤 1：增加两个失败 API 测试**

在 `test/token-plans-api.test.js` 的目录套餐测试后增加：

```js
test("token plans API rejects an unknown plan id for a catalog provider", async () => {
  const { handler, headers, readRecords } = await createTokenPlanApiFixture();

  const response = await call(handler, "/functions/tokentracker-token-plans", {
    method: "POST",
    headers,
    body: JSON.stringify({
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_id: "made-up-plan",
      plan_label: "伪造套餐",
      total_quota: 7,
    }),
  });

  assert.equal(response.statusCode, 400);
  assert.match(readJsonResponse(response).error, /套餐/);
  assert.deepEqual(readRecords(), []);
});

test("token plans API rejects an unknown provider id", async () => {
  const { handler, headers, readRecords } = await createTokenPlanApiFixture();

  const response = await call(handler, "/functions/tokentracker-token-plans", {
    method: "POST",
    headers,
    body: JSON.stringify({
      source: "hermes",
      provider_id: "unknown_provider",
      plan_id: "unknown_plan",
      plan_label: "伪造服务商套餐",
      total_quota: 7,
    }),
  });

  assert.equal(response.statusCode, 400);
  assert.match(readJsonResponse(response).error, /服务商/);
  assert.deepEqual(readRecords(), []);
});
```

若当前测试没有 `createTokenPlanApiFixture`，在同一测试文件提取它：创建临时 `trackerDataDir`、调用 `/api/local-auth`、构造本地授权头，并提供从临时 `tracker-config.json` 读取 `tokenPlans` 的 `readRecords()`。测试结束必须递归删除该临时目录。

- [ ] **步骤 2：先运行 API 测试，确认新增断言失败**

运行：

```bash
node --test test/token-plans-api.test.js
```

预期：新增两个用例失败；当前实现错误地返回 HTTP `200`。

- [ ] **步骤 3：在服务端进行目录强制校验**

在 `src/lib/local-api.js` 的 `upsertTokenPlanRecord` 调用 `normalizeTokenPlanRecord` 前，新增一个只用于校验的函数，行为等价于：

```js
function validateTokenPlanCatalogSelection(payload, fallback) {
  const input = payload && typeof payload === "object" ? payload : {};
  const previous = fallback && typeof fallback === "object" ? fallback : {};
  const providerId = String(input.provider_id ?? previous.provider_id ?? "").trim().toLowerCase();
  const planId = String(input.plan_id ?? previous.plan_id ?? "").trim();

  if (!providerId || providerId === "custom") {
    if (providerId === "custom" && planId && planId !== "custom") {
      const error = new Error("自定义服务商只能使用自定义套餐");
      error.statusCode = 400;
      throw error;
    }
    return;
  }

  const provider = getProviderCatalog(providerId);
  if (!provider) {
    const error = new Error(`不支持的服务商：${providerId}`);
    error.statusCode = 400;
    throw error;
  }

  if (!planId || !getPlanById(providerId, planId)) {
    const error = new Error("所选套餐不存在或未核验");
    error.statusCode = 400;
    throw error;
  }
}
```

在 `upsertTokenPlanRecord` 中，在构造 `record` 前调用：

```js
validateTokenPlanCatalogSelection({ ...payload, id }, fallback);
```

旧记录兼容：当 `fallback` 和 `payload` 都没有 `provider_id` 时，函数直接返回，随后现有标准化逻辑负责迁移为 `custom/custom/manual`。

不要把非目录套餐静默改写为目录套餐；必须明确返回 HTTP `400`。

- [ ] **步骤 4：重新运行 API 测试**

运行：

```bash
node --test test/token-plans-api.test.js
```

预期：全部通过，且新增测试确认伪造请求没有写入配置。

## 任务 2：允许目录套餐手工维护运行额度

**文件：**

- 修改：`dashboard/src/components/settings/TokenPlanSection.test.jsx`
- 修改：`dashboard/src/components/settings/TokenPlanSection.jsx`

- [ ] **步骤 1：增加失败组件测试**

在现有“目录套餐使总额度只读”测试后增加：

```jsx
it("catalog plan keeps runtime quota fields editable and saves them", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  await user.click(screen.getByRole("button", { name: "新增套餐" }));
  await user.selectOptions(screen.getByLabelText("Agent 来源"), "hermes");
  await user.selectOptions(screen.getByLabelText("服务商"), "xiaomi_mimo");
  await user.selectOptions(screen.getByLabelText("套餐"), "xiaomi_mimo_standard_monthly");

  expect(screen.getByLabelText("总额度")).toBeDisabled();
  expect(screen.getByLabelText("已用额度")).not.toBeDisabled();
  expect(screen.getByLabelText("剩余额度")).not.toBeDisabled();
  expect(screen.getByLabelText("到期时间")).not.toBeDisabled();

  await user.clear(screen.getByLabelText("已用额度"));
  await user.type(screen.getByLabelText("已用额度"), "120");
  await user.clear(screen.getByLabelText("剩余额度"));
  await user.type(screen.getByLabelText("剩余额度"), "10999999880");
  await user.type(screen.getByLabelText("到期时间"), "2026-07-15");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
    provider_id: "xiaomi_mimo",
    plan_id: "xiaomi_mimo_standard_monthly",
    used_quota: 120,
    remaining_quota: 10999999880,
    expires_at: "2026-07-15",
  }));
});
```

如项目翻译后的实际标签不同，使用当前 `copy.csv` 定义的中文标签；不要为测试修改用户文案。

- [ ] **步骤 2：先运行组件测试，确认新增断言失败**

运行：

```bash
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
```

预期：新增用例在“已用额度”“剩余额度”或“到期时间”禁用断言失败。

- [ ] **步骤 3：只解锁运行字段**

在 `TokenPlanSection.jsx` 中：

1. 保持 `total_quota` 的 `disabled={loading || saving || isCatalogPlan}`。
2. 将 `used_quota`、`remaining_quota`、`expires_at` 的 `disabled` 改为 `disabled={loading || saving}`。
3. 不允许前端修改目录的 `quota_kind`、`quota_unit`、`total_quota`、`total_quota_display` 或 `quota_catalog_version`。
4. 保持服务端对目录固定额度的覆盖，不能仅靠前端只读保护。
5. 修改 `planOptions`：仅当 `form.provider_id === "custom"` 时追加 `{ value: "custom", label: copy("settings.token_plan.custom_plan") }`。小米 MiMo 只显示目录返回的 Lite、Standard、Pro、Max 月付/年付套餐。

- [ ] **步骤 4：重新运行组件测试**

运行：

```bash
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
```

预期：全部通过。

## 任务 3：小米目录套餐只保留手工刷新状态

**文件：**

- 修改：`dashboard/src/components/settings/TokenPlanSection.test.jsx`
- 修改：`dashboard/src/components/settings/TokenPlanSection.jsx`
- 修改：`src/lib/local-api.js`
- 修改：`test/token-plans-api.test.js`
- 修改：`dashboard/src/content/copy.csv`
- 修改：`dashboard/src/content/i18n/zh/dashboard.json`，仅在复制工具要求时修改

- [ ] **步骤 1：增加失败测试**

组件测试新增：选择 `xiaomi_mimo` 目录套餐后，刷新方式、刷新间隔、凭证引用和自动刷新开关均不在表单中；保存参数包含：

```js
expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
  refresh_method: "manual",
  refresh_enabled: false,
  credential_ref: "",
}));
```

API 测试新增：即使客户端为有效小米目录套餐提交：

```js
{
  refresh_method: "official_api",
  refresh_enabled: true,
  credential_ref: "codex_auth_json"
}
```

服务端返回记录仍必须为：

```js
{
  refresh_method: "manual",
  refresh_enabled: false,
  credential_ref: ""
}
```

- [ ] **步骤 2：先运行失败测试**

运行：

```bash
node --test test/token-plans-api.test.js
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
```

预期：新增断言失败，当前 UI 仍显示自动刷新控件，当前 API 仍保留客户端提交的刷新字段。

- [ ] **步骤 3：在后端强制小米手工模式**

在 `normalizeTokenPlanRecord` 获取 `catalogPlan` 的分支中，检查：

```js
if (providerId === "xiaomi_mimo") {
  refreshFields.refresh_enabled = false;
  refreshFields.refresh_method = "manual";
  refreshFields.credential_ref = "";
  refreshFields.next_refresh_at = "";
}
```

该强制规则只适用于 `provider_id === "xiaomi_mimo"`，因为 W03A 已确认其没有官方额度同步授权。不要修改其他服务商的既有刷新行为。

- [ ] **步骤 4：在前端隐藏无效控件**

在 `TokenPlanSection.jsx` 增加：

```js
const isManualOnlyProvider = form.provider_id === "xiaomi_mimo";
```

当 `isManualOnlyProvider` 为真时：

1. 在 `updateField("provider_id")` 和 `updateField("plan_id")` 路径将 `refresh_method` 设置为 `manual`、`refresh_enabled` 设置为 `false`、`credential_ref` 设为空字符串。
2. 不渲染刷新方式、刷新间隔、凭证引用和自动刷新开关。
3. 在表单底部显示 copy key `settings.token_plan.manual_only_provider`，文案为“该服务商未提供官方额度同步，已用额度、剩余额度和到期时间需手工更新。”

服务端行为是安全边界；前端隐藏仅改善用户体验。

- [ ] **步骤 5：同步文案并重新运行测试**

运行：

```bash
npm run validate:copy
node --test test/token-plans-api.test.js
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
```

预期：全部通过。

## 最终验证

- [ ] **步骤 1：运行完整的 W03B-R1 验证**

```bash
node --test src/lib/token-plan-catalog/index.test.js
node --test test/token-plans-api.test.js
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
```

预期：全部退出码为 `0`。

- [ ] **步骤 2：手动验收**

1. 新建 `Hermes / 小米 MiMo / Standard（月付）` 套餐。
2. 确认总额度显示 `11,000,000,000（11B）Credits` 且不可编辑。
3. 填写已用额度、剩余额度和到期时间，保存后重新编辑该记录，确认数值保留。
4. 确认表单不出现 Cookie、凭证引用、官方接口或自动刷新控件。
5. 切换到“自定义套餐”服务商，确认此时才出现“自定义套餐”选项与套餐名称输入框。
6. 通过本地 API 直接提交不存在的服务商或套餐 ID，确认返回 HTTP `400`，并确认配置文件没有新增记录。

## 验收标准

1. 所有目录套餐由后端以 `provider_id + plan_id` 校验；伪造服务商或套餐不能落盘。
2. 小米目录套餐固定总额度不可编辑，运行额度和到期时间可手工更新并持久化。
3. 小米套餐不显示、也不能通过 API 开启自动刷新或凭证引用。
4. 旧手工套餐兼容不回归。
5. 所有最终验证命令通过。

## 禁止事项

- 不增加小米实时额度 API、OAuth、API Key 输入、Cookie 抓取或浏览器自动化。
- 不改目录 JSON 中已核验套餐、Credit 数量和官方证据。
- 不把小米 Credits 转换成 Token。
- 不回退其他用户的工作区改动，不执行 `git reset --hard`、`git checkout --`。

## 完成后报告

回复：修改文件列表、每条验证命令结果、伪造套餐请求的 HTTP 状态、手工运行额度的保存证据、是否产生新的桌面 EXE，以及任何仍存在的阻塞项。
