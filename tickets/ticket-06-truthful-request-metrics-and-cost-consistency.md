# 工单 6：请求明细真实性、指标可用性与成本口径修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除由半小时聚合桶伪造的请求明细、成功率和延迟；对无法测量的指标明确返回“不可用”；让汇总、趋势、请求明细、Provider 统计和模型统计使用同一价格规则，并显式标出未定价 token。

**Architecture:** `queue.jsonl` 继续作为 token、会话和成本聚合源，但不再转换成请求记录。只有包含真实时间戳和 token 事件的 Codex rollout 可以进入请求日志，且没有采集到的状态码、总延迟、首 token 延迟必须为 `null`。后端通过统一的 `MetricAvailability` 与 pricing coverage 契约描述数据能力；`computeRowCostDetailed()` 成为价格命中与覆盖率的唯一判定入口，旧 `computeRowCost()` 只保留兼容委托。所有 API 在同一行数据和同一 `pricingOptions` 下得到相同成本。

**Tech Stack:** Node.js local API、CommonJS pricing/rollout modules、React 18、TypeScript、Vitest、Testing Library、Node test runner。

---

## 基本信息

- **工单编号**：TICKET-06
- **优先级**：P0
- **前置依赖**：TICKET-05 已通过主上下文审核；设计规格 commit `715ff4b`
- **后续依赖**：TICKET-07
- **执行方式**：在 TICKET-05 的同一分支和工作区继续执行；不得与 TICKET-07 并行
- **设计依据**：`docs/superpowers/specs/2026-06-29-spend-usage-remediation-long-tasks-design.md`

## 开工前置与边界

开始前依次阅读：

1. `CLAUDE.md`
2. 上述设计规格
3. TICKET-05 的完成报告与 commits
4. `src/lib/local-api.js:250-490` 和请求记录 endpoint
5. `src/lib/rollout.js:8658-8825`
6. `src/lib/pricing/index.js:230-325`
7. `dashboard/src/lib/types/usage.ts`
8. 三个统计表和 `UsageStatsPanel.jsx`
9. 本工单列出的现有后端与前端测试

硬边界：

- 不再从 `queue.jsonl` 生成“看起来像请求”的行；不能把 bucket、会话或对话数重命名成请求数。
- 不得用 `200`、`100%`、`0ms` 代替未知数据；未知使用 `null` 和 availability 元数据。
- 不修改 TICKET-05 的筛选、刷新、local runtime 或握手语义。
- 不接入新的外部 telemetry，不读取或上传真实用户日志正文。
- 不改变已有价格优先级：精确规则 → Agent 默认价格 → 内置模型价格 → 未定价。
- 明确配置的零价精确规则属于“已定价且价格为 0”；默认全零 Agent 价格和未命中的内置价格属于“未定价”。
- 每次提交只暂存本任务文件；提交前运行 `git diff --cached --name-only`。

## 验收标准

1. 非 Codex 聚合数据不会出现在请求日志 records 中；响应明确列出 `aggregate_only_sources`。
2. Codex rollout 记录保留真实 token 事件，但 `status`、`latency_ms`、`first_token_ms` 在未采集时均为 `null`。
3. 未测量的请求数、成功数、成功率和平均延迟返回 `null`，前端显示 `—`/“不可用”，不显示 0 或 100%。
4. Provider/模型统计仍显示 token、会话、成本；请求数、成功率和延迟按 availability 显示。
5. 同一 synthetic fixture 在 summary、timeseries、request、provider、model 五类 API 中的成本完全一致，误差不超过 `1e-6`。
6. 每个成本层级返回 `priced_tokens`、`unpriced_tokens`、`pricing_coverage`；存在未定价 token 时 UI 不得把 `$0` 表述成真实零成本。
7. request endpoint 的 `limit` 只截断 records；`page.total_count` 和 totals 仍描述完整匹配集，且在 UI 中有明确文案。
8. 所有新增/修改测试、类型检查、copy 校验和构建通过，无新 warning。

---

### Task 1：建立“可测量指标”和“价格覆盖率”的共享契约

**Files:**
- Modify: `dashboard/src/lib/types/usage.ts`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `dashboard/src/content/i18n/zh/dashboard.json`
- Create: `dashboard/src/lib/types/__tests__/usage-contract.test.ts`

- [ ] **Step 1：先写契约失败测试**

在 `usage-contract.test.ts` 中构造真实请求、聚合 Provider 和未定价 totals，使用 `satisfies` 锁定以下契约：

```ts
import type {
  PricingCoverage,
  ProviderStat,
  RequestUsageRecordsResponse,
  UsageRecord,
} from "../usage";

const coverage: PricingCoverage = "partial";

const rolloutRecord = {
  id: "codex:session:1",
  record_kind: "request_event",
  timestamp: "2026-06-29T00:00:00.000Z",
  hour_start: "2026-06-29T00:00:00.000Z",
  source: "codex",
  source_display_name: "Codex",
  model: "gpt-test",
  total_tokens: 10,
  input_tokens: 6,
  output_tokens: 4,
  cached_input_tokens: 0,
  cache_creation_input_tokens: 0,
  reasoning_output_tokens: 0,
  cost_usd: 0,
  pricing_coverage: "unpriced",
  status: null,
  latency_ms: null,
  first_token_ms: null,
  request_source: "codex_rollout",
} satisfies UsageRecord;

const aggregateProvider = {
  source: "claude",
  source_display_name: "Claude",
  request_count: null,
  conversation_count: 2,
  tokens: 10,
  cost_usd: 0,
  priced_tokens: 0,
  unpriced_tokens: 10,
  pricing_coverage: "unpriced",
  success_rate: null,
  avg_latency_ms: null,
  metric_availability: "aggregate_only",
} satisfies ProviderStat;

void coverage;
void rolloutRecord;
void aggregateProvider;
```

再定义一个 `RequestUsageRecordsResponse` fixture，要求包含：

```ts
granularity: "request_event";
aggregate_only_sources: ["claude"];
page: { limit: 100; returned_count: 1; total_count: 5; totals_scope: "all_matching" };
availability: {
  request_records: "measured";
  status: "unavailable";
  latency: "unavailable";
};
```

- [ ] **Step 2：运行测试确认现有类型失败**

```powershell
npm --prefix dashboard run test -- src/lib/types/__tests__/usage-contract.test.ts
```

Expected: FAIL，缺少 nullable 字段、availability 和 pricing coverage 类型。

- [ ] **Step 3：最小扩展类型契约**

在 `usage.ts` 增加：

```ts
export type MetricAvailability = "measured" | "aggregate_only" | "unavailable";
export type PricingCoverage = "complete" | "partial" | "unpriced";

export interface PricingCoverageFields {
  priced_tokens: number;
  unpriced_tokens: number;
  pricing_coverage: PricingCoverage;
}
```

具体字段要求：

- `UsageRecord`：增加 `record_kind: "request_event"`、`pricing_coverage`；把 `status`、`latency_ms` 改为 `number | null`。
- `RequestUsageRecordsTotals`：`request_count` 保持真实记录计数；`success_count`、`success_rate`、`avg_latency_ms` 改为 `number | null`，并扩展 `PricingCoverageFields`。
- `RequestUsageRecordsTotals` 额外增加 `status_sample_count` 与 `latency_sample_count`，供多 Provider 合并时做正确分母和加权平均；没有样本时均为 0。
- `RequestUsageRecordsResponse`：增加 `granularity`、`aggregate_only_sources`、`availability` 和 `page`。
- `UsageSummary`：请求/成功/延迟字段改为 nullable，并增加 `conversation_count`、`metric_availability` 与 pricing coverage。
- `ProviderStat`、`ModelStat`：请求/成功/延迟字段改为 nullable；增加 `conversation_count`、`metric_availability` 与 pricing coverage。
- Provider/model/summary/request response 的 totals 使用带 pricing coverage 的交叉类型；老字段只在输入兼容层可选，真实 local API 响应必须完整返回新字段。

- [ ] **Step 4：增加明确文案**

在 `copy.csv` 增加英文默认 copy key，并在 `zh/dashboard.json` 增加中文翻译：

```text
usage.metric.unavailable = Unavailable / 暂不可用
usage.metric.aggregate_only = Aggregate data only / 仅有聚合数据
usage.cost.unpriced = Pricing unavailable / 未配置价格
usage.cost.partial = Partially priced / 部分 Token 未定价
usage.request.aggregate_only = This source has aggregate usage but no request-level records. / 此来源仅有聚合用量，没有请求级明细。
usage.request.totals_scope = Totals cover all matching records. / 汇总覆盖全部匹配记录。
```

使用项目现有 CSV 列结构写入，不手工改变相邻行格式。

- [ ] **Step 5：运行契约和 copy 校验**

```powershell
npm --prefix dashboard run test -- src/lib/types/__tests__/usage-contract.test.ts
npm --prefix dashboard run typecheck
npm run validate:copy
```

Expected: 全部 exit 0。

- [ ] **Step 6：提交共享契约**

```powershell
git add dashboard/src/lib/types/usage.ts dashboard/src/lib/types/__tests__/usage-contract.test.ts dashboard/src/content/copy.csv dashboard/src/content/i18n/zh/dashboard.json
git diff --cached --name-only
git commit -m "fix: define truthful usage metric contracts"
```

---

### Task 2：停止从聚合桶伪造请求记录

**Files:**
- Modify: `test/request-usage-records-api.test.js`
- Modify: `test/rollout-parser.test.js`
- Modify: `src/lib/local-api.js`
- Modify: `src/lib/rollout.js`

- [ ] **Step 1：把现有伪记录断言改成真实性断言**

在 `request-usage-records-api.test.js` 删除这些旧预期：queue row 产生 record、`status === 200`、`latency_ms === 0`、`request_source === "queue_bucket"`、success rate 为 100%。替换为：

```js
assert.deepEqual(body.records, []);
assert.deepEqual(body.aggregate_only_sources, ["claude"]);
assert.equal(body.granularity, "request_event");
assert.deepEqual(body.availability, {
  request_records: "aggregate_only",
  status: "unavailable",
  latency: "unavailable",
});
assert.equal(body.totals.request_count, 0);
assert.equal(body.totals.success_count, null);
assert.equal(body.totals.success_rate, null);
assert.equal(body.totals.avg_latency_ms, null);
assert.equal(body.totals.status_sample_count, 0);
assert.equal(body.totals.latency_sample_count, 0);
assert.equal(body.queue_baseline_totals.total_tokens, 1700);
```

保留 queue baseline 的 token 断言，证明删除的是伪请求而不是聚合用量。

- [ ] **Step 2：增加 Codex rollout 的缺失指标与分页测试**

在 rollout fixture 中写入 5 个 synthetic `token_count` 事件，请求 `limit=2`，断言：

```js
assert.equal(body.records.length, 2);
assert.equal(body.page.returned_count, 2);
assert.equal(body.page.total_count, 5);
assert.equal(body.page.totals_scope, "all_matching");
assert.equal(body.totals.request_count, 5);
assert.equal(body.records[0].record_kind, "request_event");
assert.equal(body.records[0].status, null);
assert.equal(body.records[0].latency_ms, null);
assert.equal(body.records[0].first_token_ms, null);
for (const forbidden of ["prompt", "message", "content", "encrypted_content", "tool_result"]) {
  assert.equal(Object.hasOwn(body.records[0], forbidden), false);
}
```

- [ ] **Step 3：运行测试确认红灯**

```powershell
node --test test/request-usage-records-api.test.js test/rollout-parser.test.js
```

Expected: FAIL，现有 endpoint 仍生成 queue records 和状态/延迟占位值。

- [ ] **Step 4：删除伪请求生成路径**

从 `local-api.js` 删除 `synthesizeQueueRecords()` 及其仅供该函数使用的代码。request endpoint 调整为：

1. 仅对请求范围内包含 `codex` 时调用 `collectRolloutRequestUsageRecords()`。
2. 非 Codex source 只加入 `aggregate_only_sources`，不加入 records；当请求未显式列 sources 时，从日期/模型过滤后的 queue 行提取实际非 Codex source，禁止返回含糊的 `"all"`。
3. 继续用 `computeQueueTotals()` 返回 `queue_baseline_totals`，供 token/caliber 对账。
4. 不再给 Codex record 补 `status = 200` 或 `latency_ms = 0`；统一补 `null`。
5. `computeRecordTotals()` 只计算真实 records；仅对非 null 状态计算成功指标，仅对非 null 延迟计算平均值，同时返回 `status_sample_count` 和 `latency_sample_count`。如果没有任何测量值，对应结果为 `null`。

availability 计算规则固定为：

```js
const hasRequestRecords = fullRecords.length > 0;
const aggregateOnlySources = requestedSources.filter((source) => source !== "codex");
const availability = {
  request_records: hasRequestRecords
    ? "measured"
    : aggregateOnlySources.length > 0
      ? "aggregate_only"
      : "unavailable",
  status: fullRecords.some((record) => record.status != null) ? "measured" : "unavailable",
  latency: fullRecords.some((record) => record.latency_ms != null) ? "measured" : "unavailable",
};
```

- [ ] **Step 5：在 rollout collector 中先统计完整匹配集再分页**

移除文件循环内以 `records.length >= maxLimit` 提前停止的两个分支。所有匹配记录收集并排序后返回：

```js
return {
  source: normalizedSource,
  from: from || null,
  to: to || null,
  records: records.slice(0, maxLimit),
  total_count: records.length,
  totals: finalizeTotals(totals),
};
```

每个 record 创建时直接写入：

```js
record_kind: "request_event",
status: null,
latency_ms: null,
first_token_ms: null,
request_source: "codex_rollout",
```

endpoint 以 collector 的 `total_count` 构造 `page`，禁止通过 `limited.length` 猜总数。
endpoint 的 request totals 直接使用 collector 在分页前计算的 `totals`；禁止对 `records.slice(0, limit)` 再调用 `computeRecordTotals()`。仅请求 aggregate-only source 时返回 token 为 0 的 request totals，并把真实聚合 token 放在 `queue_baseline_totals`。

- [ ] **Step 6：运行请求真实性测试**

```powershell
node --test test/request-usage-records-api.test.js test/rollout-parser.test.js
```

Expected: 全部通过；测试源码中不再出现 `queue_bucket`、`queue_synthesized`、`status=200 placeholder`。

- [ ] **Step 7：提交请求明细修复**

```powershell
git add test/request-usage-records-api.test.js test/rollout-parser.test.js src/lib/local-api.js src/lib/rollout.js
git diff --cached --name-only
git commit -m "fix: stop fabricating request usage metrics"
```

---

### Task 3：修正 summary、Provider 和模型统计的指标语义

**Files:**
- Modify: `test/usage-caliber-consistency.test.js`
- Modify: `test/provider-model-stats.test.js`
- Modify: `src/lib/local-api.js`

- [ ] **Step 1：写聚合数据能力测试**

把现有 `conversation_count` 等同于 `request_count`、`success_rate = 100`、`avg_latency_ms = 0` 的断言替换为：

```js
assert.equal(provider.request_count, null);
assert.equal(provider.conversation_count, 4);
assert.equal(provider.success_rate, null);
assert.equal(provider.avg_latency_ms, null);
assert.equal(provider.metric_availability, "aggregate_only");
```

模型行做同样断言。usage summary 对仅有 queue 数据的 fixture 断言：

```js
assert.equal(body.totals.request_count, null);
assert.equal(body.totals.conversation_count, 7);
assert.equal(body.totals.success_count, null);
assert.equal(body.totals.success_rate, null);
assert.equal(body.totals.avg_latency_ms, null);
assert.equal(body.totals.metric_availability, "aggregate_only");
```

同时修改 `usage-caliber-consistency.test.js` 中旧的“非 Codex request totals 等于 usage summary”用例：真实 request totals 应为 0/空 records；只有 `queue_baseline_totals.total_tokens/cost_usd` 与 usage summary 相等。不得为了保住旧三口径断言恢复 queue 伪记录。

- [ ] **Step 2：运行测试确认红灯**

```powershell
node --test test/usage-caliber-consistency.test.js test/provider-model-stats.test.js
```

Expected: FAIL，当前实现仍把 conversation count 呈现为 request count。

- [ ] **Step 3：修改聚合函数，不丢失已有可用信息**

`aggregateBySource()` 与 `aggregateByModel()` 的每行改为：

```js
request_count: null,
conversation_count: 0,
success_rate: null,
avg_latency_ms: null,
metric_availability: "aggregate_only",
```

循环只累计 `conversation_count`、tokens 和 cost。summary 同理：保留真实 `conversation_count`，请求/成功/延迟字段返回 null。不要为了让 UI 有数字而用 `conversation_count` 填 `request_count`。

- [ ] **Step 4：运行聚合统计测试**

```powershell
node --test test/usage-caliber-consistency.test.js test/provider-model-stats.test.js
```

Expected: 全部通过；token 和 conversation totals 与修改前一致。

- [ ] **Step 5：提交指标语义修复**

```powershell
git add test/usage-caliber-consistency.test.js test/provider-model-stats.test.js src/lib/local-api.js
git diff --cached --name-only
git commit -m "fix: distinguish conversations from request metrics"
```

---

### Task 4：建立统一成本计算结果和未定价覆盖率

**Files:**
- Modify: `src/lib/pricing/index.js`
- Modify: `src/lib/rollout.js`
- Modify: `src/lib/local-api.js`
- Modify: `test/pricing.test.js`
- Create: `test/usage-cost-consistency.test.js`

- [ ] **Step 1：先写 detailed pricing 单元测试**

增加四类用例：精确规则、正数 Agent 默认价格、内置命中、未命中。核心断言：

```js
const exactZero = pricing.computeRowCostDetailed(row, {
  pricingRules: [{
    source: row.source,
    model: row.model,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    currency: "USD",
  }],
});
assert.deepEqual(exactZero, {
  cost_usd: 0,
  pricing_coverage: "complete",
  pricing_source: "exact_rule",
});

const unknown = pricing.computeRowCostDetailed(
  { ...row, source: "claude", model: "unknown-synthetic-model" },
  { agentDefaultPricing: { claude: { inputUsdPer1M: 0, outputUsdPer1M: 0 } } },
);
assert.deepEqual(unknown, {
  cost_usd: 0,
  pricing_coverage: "unpriced",
  pricing_source: "none",
});
```

另断言 `computeRowCost(row, options) === computeRowCostDetailed(row, options).cost_usd`，保持旧调用兼容。

- [ ] **Step 2：写五类 endpoint 成本一致性测试**

`usage-cost-consistency.test.js` 使用临时 HOME、synthetic queue 和 Codex rollout。queue 行与 rollout 的一个 `token_count` 事件使用相同来源、模型和六维 token 数；写入一条精确 `pricingRules`，再以相同日期分别请求 summary、timeseries、request、provider、model endpoint。断言：

```js
assert.ok(Math.abs(summaryCost - timeseriesCost) <= 1e-6);
assert.ok(Math.abs(summaryCost - providerCost) <= 1e-6);
assert.ok(Math.abs(summaryCost - modelCost) <= 1e-6);
assert.ok(Math.abs(summaryCost - requestCost) <= 1e-6);
assert.equal(summary.totals.pricing_coverage, "complete");
assert.equal(summary.totals.unpriced_tokens, 0);
```

queue 与 rollout 虽是两个采集源，但该 synthetic fixture 故意使用完全相同的规范化 usage 行，因此五类成本必须相等。生产数据不要求两个采集源 token 总数天然相同；测试只锁定同一行输入和同一 `pricingOptions` 的价格一致性。

再增加一个未知模型 fixture，断言所有包含该行的聚合响应都返回 `unpriced_tokens > 0` 和 `pricing_coverage === "unpriced"`。

- [ ] **Step 3：运行测试确认红灯**

```powershell
node --test test/pricing.test.js test/usage-cost-consistency.test.js
```

Expected: FAIL，缺少 detailed result，rollout 尚未接收 `pricingOptions`。

- [ ] **Step 4：实现唯一价格命中判定入口**

在 `pricing/index.js` 增加并导出 `computeRowCostDetailed(row, options)`：

1. 精确规则命中返回 `pricing_source: "exact_rule"` 和 `complete`；即使所有费率为 0 也算 complete。
2. Agent 默认价格只有至少一个标准化费率大于 0 时才算 `agent_default`/complete；全零返回 none/unpriced。
3. 内置模型查找必须保留 matcher 的 `hit` 信息；命中返回 `builtin`/complete，不能用最终价格是否为 0 猜测。
4. 未命中返回 `cost_usd: 0`、`pricing_source: "none"`、`pricing_coverage: "unpriced"`。
5. `computeRowCost()` 只返回 detailed result 的 `cost_usd`。

不得复制第二套价格优先级。

- [ ] **Step 5：给所有聚合器累计 pricing coverage**

为每一行调用一次 detailed 结果，并用统一 helper 累计：

```js
function addPricingCoverage(acc, row, pricingResult) {
  const tokens = Number(row.total_tokens || 0);
  if (pricingResult.pricing_coverage === "complete") acc.priced_tokens += tokens;
  else acc.unpriced_tokens += tokens;
}

function finalizePricingCoverage(acc) {
  acc.pricing_coverage = acc.unpriced_tokens === 0
    ? "complete"
    : acc.priced_tokens === 0
      ? "unpriced"
      : "partial";
  return acc;
}
```

应用到 `computeQueueTotals()`、按日/按桶聚合、`aggregateBySource()`、`aggregateByModel()`、`computeRecordTotals()`。空集合固定为 `complete` 且两个 token 数均为 0，避免把“没有数据”误报为未定价。

- [ ] **Step 6：给 rollout 传入完全相同的 pricingOptions**

扩展 `collectRolloutRequestUsageRecords({ pricingOptions })`；创建 record 时调用 `computeRowCostDetailed(record, pricingOptions)`，写入：

```js
record.cost_usd = pricingResult.cost_usd;
record.pricing_coverage = pricingResult.pricing_coverage;
```

`local-api.js` request endpoint 必须把已有 `const pricingOptions = getPricingOptions()` 原样传入，禁止在 rollout 内再次读取配置或使用空 options。

- [ ] **Step 7：运行 pricing 与跨 endpoint 测试**

```powershell
node --test test/pricing.test.js test/usage-cost-consistency.test.js test/request-usage-records-api.test.js test/provider-model-stats.test.js test/usage-caliber-consistency.test.js
```

Expected: 全部通过；无 fixture 依赖机器真实 HOME。

- [ ] **Step 8：提交成本口径修复**

```powershell
git add src/lib/pricing/index.js src/lib/rollout.js src/lib/local-api.js test/pricing.test.js test/usage-cost-consistency.test.js test/request-usage-records-api.test.js test/provider-model-stats.test.js test/usage-caliber-consistency.test.js
git diff --cached --name-only
git commit -m "fix: unify usage pricing and expose coverage"
```

---

### Task 5：前端只展示真实可用指标

**Files:**
- Modify: `dashboard/src/hooks/use-request-usage-records.ts`
- Modify: `dashboard/src/hooks/__tests__/use-request-usage-records.test.tsx`
- Modify: `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`
- Modify: `dashboard/src/ui/dashboard/components/ProviderUsageTable.jsx`
- Modify: `dashboard/src/ui/dashboard/components/ModelUsageTable.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/ProviderUsageTable.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/ModelUsageTable.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx`

- [ ] **Step 1：先写不可用指标和价格覆盖率 UI 测试**

至少覆盖：

1. Request record 的 `status/latency_ms/first_token_ms` 全为 null 时显示 `—`，没有绿色成功态。
2. 只有 `aggregate_only_sources: ["claude"]` 且 records 为空时显示“此来源仅有聚合用量，没有请求级明细”，而不是通用“暂无数据”。
3. Provider/模型行的 request/success/latency 为 null 时三列均显示 `—`；token、conversation、cost 仍显示。
4. `pricing_coverage: "unpriced"` 时成本旁显示“未配置价格”，不能只显示 `$0.0000`。
5. `pricing_coverage: "partial"` 时显示“部分 Token 未定价”。
6. request footer 显示 `page.returned_count / page.total_count`，并提示 totals 覆盖全部匹配记录。
7. 合并多个 Provider 响应时，null 成功率/延迟仍为 null；存在测量样本时使用 `status_sample_count` 和 `latency_sample_count` 计算成功率与加权平均。

- [ ] **Step 2：运行前端测试确认红灯**

```powershell
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx src/ui/dashboard/components/__tests__/ProviderUsageTable.test.jsx src/ui/dashboard/components/__tests__/ModelUsageTable.test.jsx src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx
```

Expected: FAIL，当前 hook/formatter 会把 null 转成 0，并把未知状态着成成功色。

- [ ] **Step 3：先修复多 Provider totals 合并语义**

`use-request-usage-records.ts` 合并响应时：

- 六维 token、cost、priced/unpriced tokens 直接求和；
- `request_count` 与 `page.total_count/returned_count` 求和；
- `status_sample_count === 0` 时 `success_count/success_rate` 为 null，否则用成功数除以 status 样本数；
- `latency_sample_count === 0` 时 `avg_latency_ms` 为 null，否则按每个响应的 latency 样本数做加权平均；
- `aggregate_only_sources` 去重并按查询 Provider 顺序输出；
- availability 只要有 measured 就为 measured，否则有 aggregate_only 就为 aggregate_only，否则 unavailable；
- pricing coverage 由合并后的 priced/unpriced token 重新判定。

hook return type 增加 `page`、`availability`、`aggregateOnlySources`，RequestUsageLog 直接消费这些字段。禁止用当前有限的 records 重新计算 `totals_scope: "all_matching"` 的指标。

- [ ] **Step 4：增加 null-aware formatter，禁止 `safeNum(null)` 决定语义**

三个表使用相同最小规则：

```jsx
function formatAvailableNumber(value, formatter) {
  return value == null ? "—" : formatter(value);
}
```

具体行为：

- `statusIsError(null)` 不得返回 true 或 false；null 状态不加成功/失败颜色。
- latency 为 null 显示 `—`；真实 `0ms` 仍显示 `0ms`，不能混为未知。
- success rate 为 null 显示 `—`；真实 0% 显示 `0.0%`。
- request count 为 null 显示 `—`；conversation count 可在 Provider/模型主标签下以次级文案“会话 N”显示，不新增表格列。
- 排序比较中 null 固定排在有值之后，升降序都不得把 null 当 0。

- [ ] **Step 5：渲染 pricing coverage**

在成本数字旁使用已有弱提示样式渲染 copy：complete 不显示额外提示；partial 显示“部分 Token 未定价”；unpriced 显示“未配置价格”。汇总卡在 unpriced 时以 `—` 作为主成本值，保留 tooltip 说明，不用 `$0` 冒充估算结果。明确零价规则的 coverage 是 complete，因此仍可显示 `$0`。

- [ ] **Step 6：运行 hook、UI、类型和 copy 校验**

```powershell
npm --prefix dashboard run test -- src/hooks/__tests__/use-request-usage-records.test.tsx src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx src/ui/dashboard/components/__tests__/ProviderUsageTable.test.jsx src/ui/dashboard/components/__tests__/ModelUsageTable.test.jsx src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
```

Expected: 全部 exit 0，无 duplicate key、`act()` 或未处理 Promise warning。

- [ ] **Step 7：提交前端真实性展示**

```powershell
git add dashboard/src/hooks/use-request-usage-records.ts dashboard/src/hooks/__tests__/use-request-usage-records.test.tsx dashboard/src/ui/dashboard/components/RequestUsageLog.jsx dashboard/src/ui/dashboard/components/ProviderUsageTable.jsx dashboard/src/ui/dashboard/components/ModelUsageTable.jsx dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx dashboard/src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx dashboard/src/ui/dashboard/components/__tests__/ProviderUsageTable.test.jsx dashboard/src/ui/dashboard/components/__tests__/ModelUsageTable.test.jsx dashboard/src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx
git diff --cached --name-only
git commit -m "fix: render unavailable usage metrics honestly"
```

---

### Task 6：工单级集成验证与交接

**Files:**
- Modify only if a failing assertion proves a TICKET-06 regression
- Create: `docs/test-reports/v2.1/23-spend-truthful-metrics-cost.md`

- [ ] **Step 1：运行完整后端定向测试**

```powershell
node --test test/pricing.test.js test/usage-cost-consistency.test.js test/request-usage-records-api.test.js test/rollout-parser.test.js test/provider-model-stats.test.js test/usage-caliber-consistency.test.js test/spend-timeseries-api.test.js
```

Expected: 全部通过；测试输出不得读取真实用户 HOME。

- [ ] **Step 2：运行完整前端定向测试**

```powershell
npm --prefix dashboard run test -- src/lib/types/__tests__/usage-contract.test.ts src/hooks/__tests__/local-usage-hooks.test.tsx src/hooks/__tests__/use-request-usage-records.test.tsx src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx src/ui/dashboard/components/__tests__/ProviderUsageTable.test.jsx src/ui/dashboard/components/__tests__/ModelUsageTable.test.jsx src/pages/SpendPage.test.jsx
```

Expected: 全部通过，无控制台 warning。

- [ ] **Step 3：运行类型、规则和构建验证**

```powershell
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
```

Expected: 全部 exit 0；只允许记录构建器已有的 chunk-size warning。

- [ ] **Step 4：完成 synthetic API 对账报告**

报告必须包含：fixture 的来源/模型/token/规则、五类 endpoint 返回成本、priced/unpriced token、差值、request granularity、aggregate-only sources、null 指标样例、命令与通过数。禁止复制真实日志正文；禁止使用“理论上”“应该一致”。

- [ ] **Step 5：提交测试报告**

```powershell
git add docs/test-reports/v2.1/23-spend-truthful-metrics-cost.md
git diff --cached --name-only
git commit -m "test: verify truthful usage metrics and cost"
```

## 完成回报格式

subagent 最终回复必须包含：

- 分支名和全部 commit SHA；
- 实际修改文件；
- 删除的伪请求路径和替代 API 契约；
- Codex 与非 Codex 的 granularity/availability 差异；
- conversation count 与 request count 的最终语义；
- `computeRowCostDetailed()` 的四级命中规则；
- 五类 API 成本与 pricing coverage 对账表；
- 全部验证命令、通过数量和 warning；
- 未解决问题或明确写“无”。

主上下文审核通过 TICKET-06 后，才允许派发 TICKET-07。
