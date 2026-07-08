# TE-NEXT-W03B - Token 套餐服务商目录与选择式表单

## 任务 ID

`TE-NEXT-W03B`

## 所属模块

Token 套餐 / 本地配置与设置页

## 前置依赖

`TE-NEXT-W03A` 已完成，且 `src/lib/token-plan-catalog/xiaomi-mimo.catalog.json` 已通过 JSON 解析验证。若该目录没有任何已核验套餐，本工单仍可实现目录框架和“自定义套餐”入口，但不得显示虚构的小米套餐。

## 任务目标

将 Token 套餐从自由文本录入改成“Agent 来源 + 服务商 + 套餐目录”的结构化配置。用户选择服务商后，只看到该服务商已核验的套餐；选择套餐后自动写入已核验的总额度和单位。没有官方固定额度时，明确显示“官网未公布”或允许用户选择“自定义套餐”，不能默默把示例值当成实时数据。

## 背景

当前 `TokenPlanSection` 的 `source`、`plan_label` 和额度字段均为自由输入。`source` 在项目数据中是 Agent，如 `hermes`；小米 MiMo 是该 Agent 实际调用的模型服务商。若继续使用一个字段，会破坏计费方式归因和 Provider 统计。

现有数据写在本地 `tracker-config.json` 的 `tokenPlans` 数组。已有记录必须兼容读取，不能因为新增字段丢失。

## 开始前必读

1. `CLAUDE.md`
2. `docs/tasks/dispatch/TE-NEXT-W03A-xiaomi-mimo-plan-contract-discovery.md`
3. `src/lib/local-api.js` 中 Token Plan 的标准化与保存逻辑
4. `src/lib/token-plan-refresh.js`
5. `src/lib/source-metadata.js`
6. `src/lib/agent-adapters.js`
7. `dashboard/src/components/settings/TokenPlanSection.jsx`
8. `dashboard/src/components/settings/TokenPlanSection.test.jsx`
9. `dashboard/src/content/copy.csv`

## 允许修改的文件

- 新增：`src/lib/token-plan-catalog/index.js`
- 新增：`src/lib/token-plan-catalog/index.test.js`
- 使用：`src/lib/token-plan-catalog/xiaomi-mimo.catalog.json`
- 修改：`src/lib/local-api.js`
- 修改：`test/token-plans-api.test.js`
- 修改：`dashboard/src/lib/api.ts`
- 修改：`dashboard/src/components/settings/TokenPlanSection.jsx`
- 修改：`dashboard/src/components/settings/TokenPlanSection.test.jsx`
- 修改：`dashboard/src/content/copy.csv`
- 修改：`dashboard/src/content/i18n/zh/dashboard.json`，仅在项目现有复制流程要求同步时修改

不得改 parser、请求日志 schema、花销模块、自动刷新调度器实现或 Tauri 配置。

## 确定的数据规范

Token Plan 记录新增以下字段，字段名固定：

```js
{
  id: "uuid",
  source: "hermes",
  provider_id: "xiaomi_mimo",
  plan_id: "xiaomi_mimo_standard",
  plan_label: "Standard",
  quota_kind: "fixed_tokens|rolling_window|credits|unknown|manual",
  quota_unit: "tokens|requests|credits|percent",
  total_quota: 11000000000,
  total_quota_display: "110 亿 Token",
  quota_catalog_version: "2026-06-25",
  quota_source: "catalog|manual|provider_reported",
  used_quota: 0,
  remaining_quota: 11000000000,
  expires_at: "",
  refresh_enabled: false,
  refresh_interval_minutes: 60,
  refresh_method: "manual"
}
```

字段约束：

1. `source` 是 Agent ID，必须来自现有来源元数据；用户可选 Hermes、Codex 等，不能输入任意文本。
2. `provider_id` 是模型服务商 ID；首批只需要支持目录中的 `xiaomi_mimo` 和一个 `custom` 选项。
3. `plan_id` 必须是所选服务商目录中的 ID；自定义套餐固定为 `custom`。
4. `total_quota` 以原子单位存储，且必须是非负安全整数。11,000,000,000 小于 JavaScript 安全整数上限，可以安全存储。
5. `total_quota_display` 保留官方展示格式；UI 显示该字段优先于程序缩写。
6. 目录套餐的额度字段只读；`quota_kind: "unknown"` 不显示伪造数值。
7. `quota_source: "manual"` 时才允许编辑总额度、已用额度、剩余额度和到期时间。
8. 旧记录缺失新增字段时，按 `provider_id: "custom"`、`plan_id: "custom"`、`quota_source: "manual"` 兼容；不得改变其原有数值。

## 任务 1：先建立目录读取与规范化测试

### 1.1 编写失败测试

新建 `src/lib/token-plan-catalog/index.test.js`，覆盖以下场景：

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getProviderCatalog,
  getPlanById,
  listProviderOptions,
} = require("./index");

test("小米目录只暴露已核验的套餐", () => {
  const catalog = getProviderCatalog("xiaomi_mimo");
  assert.equal(catalog.provider_id, "xiaomi_mimo");
  assert.ok(Array.isArray(catalog.plans));
  for (const plan of catalog.plans) {
    assert.ok(plan.plan_id);
    assert.ok(plan.official_evidence_url);
  }
});

test("未知套餐不会回退为任意目录记录", () => {
  assert.equal(getPlanById("xiaomi_mimo", "not-a-plan"), null);
});

test("服务商选择始终包含自定义套餐入口", () => {
  assert.deepEqual(
    listProviderOptions().map((item) => item.id).includes("custom"),
    true,
  );
});
```

运行：

```bash
node --test src/lib/token-plan-catalog/index.test.js
```

预期：失败，原因是目录读取模块不存在。

### 1.2 实现最小目录模块

新建 `src/lib/token-plan-catalog/index.js`。模块只负责加载已提交的 JSON 目录、返回不可变副本和提供 `custom` 选项；不访问网络、不缓存远程数据、不读取账号数据。

实现必须满足：

```js
function getProviderCatalog(providerId) { /* 找不到时返回 null */ }
function getPlanById(providerId, planId) { /* 必须同一 provider 才能返回 */ }
function listProviderOptions() { /* 返回 [{ id, name }]，结尾含 custom */ }
```

如果 W03A 的 `plans` 为空，`getProviderCatalog("xiaomi_mimo")` 仍返回服务商元数据，页面显示“暂未发现可核验套餐，请使用自定义套餐”。

重新运行目录测试，预期通过。

## 任务 2：扩展本地 API 的记录标准化

### 2.1 编写失败 API 测试

在 `test/token-plans-api.test.js` 新增两个用例：

1. 保存 `source: "hermes"`、`provider_id: "xiaomi_mimo"` 和目录中真实存在的 `plan_id`，断言 API 返回目录给定的 `plan_label`、总额度、单位、目录版本和 `quota_source: "catalog"`；客户端提交的冲突总额度不得覆盖目录值。
2. 保存旧格式记录（只有 `source`、`plan_label` 和三项额度），断言读取后保留原数值，并补齐 `provider_id: "custom"`、`plan_id: "custom"`、`quota_source: "manual"`。

运行：

```bash
node --test test/token-plans-api.test.js
```

预期：新增断言失败。

### 2.2 修改记录标准化与保存

在 `src/lib/local-api.js` 中：

1. 在 `normalizeTokenPlanRecord` 中读取并标准化新增字段。
2. 当 `provider_id` 不是 `custom` 时，通过 `getPlanById(provider_id, plan_id)` 取得目录记录。
3. 目录记录存在时，使用目录的 `plan_label`、`quota_kind`、`quota_unit`、`total_quota`、`total_quota_display`、`quota_catalog_version` 和 `quota_source: "catalog"`；不要信任客户端传来的对应字段。
4. 目录套餐的 `used_quota`、`remaining_quota`、`expires_at` 仅保留已存在的本地值，留给后续实时适配器更新；首次创建时为 `0` 或空字符串。
5. `custom` 记录沿用手工额度行为，但 `total_quota`、`used_quota`、`remaining_quota` 均必须归一化为非负安全整数。
6. 保存时验证 `source` 是现有 Agent ID；无效来源返回 HTTP `400` 与中文可读错误。

不要删除旧的 `plan_label` 字段，因为现有计费方式推导仍会读取该字段。

重新运行 API 测试，预期通过。

## 任务 3：改造套餐表单为级联选择

### 3.1 编写失败组件测试

在 `dashboard/src/components/settings/TokenPlanSection.test.jsx` 增加测试：

1. “新增套餐”表单有“Agent 来源”“服务商”“套餐”三个选择框，不再允许直接输入来源。
2. 选择 `xiaomi_mimo` 后，仅显示目录返回的套餐与“自定义套餐”；不显示来自其他服务商的套餐。
3. 选择一个固定 Token 套餐后，总额度输入框是只读，并显示目录的 `total_quota_display`。
4. 选择“自定义套餐”后，总额度、已用额度、剩余额度和到期时间可编辑。
5. 目录为空时，出现“官方套餐暂未核验，请使用自定义套餐”的提示，而非空白或报错。

先运行：

```bash
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
```

预期：新增断言失败。

### 3.2 增加 API 目录读取能力

在 `src/lib/local-api.js` 增加只读端点：

```text
GET /functions/tokentracker-token-plan-catalog
```

响应固定为：

```json
{
  "providers": [
    {
      "id": "xiaomi_mimo",
      "name": "小米 MiMo",
      "plans": []
    },
    {
      "id": "custom",
      "name": "自定义套餐",
      "plans": []
    }
  ]
}
```

端点不返回账户绑定、凭证或任何运行时额度。`dashboard/src/lib/api.ts` 新增 `getTokenPlanCatalog()` 调用该端点。

### 3.3 修改设置页

在 `TokenPlanSection.jsx` 中：

1. 加载套餐目录；加载失败时仍保留自定义套餐入口，并显示本地 API 错误。
2. 使用已有来源元数据生成 Agent 来源下拉框。
3. 使用目录生成服务商下拉框；服务商变更时重置 `plan_id` 和目录衍生字段。
4. 使用目录生成套餐下拉框；选定目录套餐时，将规范字段写入提交 payload，固定额度字段不可编辑。
5. 对未知额度显示“官网未公布”，不显示 `0 Token`。
6. 记录卡片展示 `Agent 来源 / 服务商 / 套餐`，并显示额度单位和目录/手工来源。
7. 保留旧记录的编辑能力：旧记录以“自定义套餐”形式显示。

所有新增用户文案必须进入 `dashboard/src/content/copy.csv`，之后按项目既有 copy 工具同步翻译文件。不得在 JSX 硬编码中文。

重新运行组件测试，预期通过。

## 最终验证

依次运行：

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

手动验证：

1. 新建 Hermes 的小米 MiMo 套餐，选择一个 W03A 已核验的套餐；总额度和单位自动出现且不可手改。
2. 如果 W03A 证实某套餐为 `110 亿 Token`，确认界面显示“110 亿 Token”，存储值为 `11000000000`。
3. W03A 未核验的套餐不出现在选择框中。
4. 新建自定义套餐时，所有手动额度字段可编辑。
5. 打开旧记录并保存，不丢失原有额度。

## 禁止事项

- 不硬编码未经 W03A 官方证据确认的 Lite、Standard、Pro、Max 或额度。
- 不把 `source` 改为服务商字段，不影响现有 Agent 统计。
- 不从前端信任目录套餐的额度数值，服务端必须重新依据 `provider_id + plan_id` 规范化。
- 不在表单或 config 中加入 Cookie、账号密码或 API Key 输入框。
- 不新增网络目录拉取、远程配置或 npm 依赖。

## 完成后报告

回复中列出：W03A 目录版本、修改文件、每条验证命令结果、是否存在未核验套餐，以及是否构建出新的 Tauri 可执行文件。仅在本工单要求时构建；不要为了截图伪造套餐。
