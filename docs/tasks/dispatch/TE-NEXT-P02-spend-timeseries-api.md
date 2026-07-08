# TE-NEXT-P02 - Spend Timeseries API

## 任务边界

你负责实现后续补齐任务 `P02 — Spend时间序列后端接口`。只做 Spend 折线图所需的只读 timeseries API 和 dashboard API client 函数,不要实现前端折线图组件,不要改 Spend 表单/CRUD UI,不要改数据库 schema,不要引入新 npm 依赖。

本工单依据:

- `docs/token-eyes-next-blueprint-v3.md`
- `docs/dev-notes/spend-chart-api-spec.md`
- 现有 `src/lib/local-api.js` Spend 汇总逻辑
- 现有 `test/spend-records-api.test.js` 中 G04/G04 rework 测试

## 先读文件

开始前按顺序读:

1. `CLAUDE.md`
2. `docs/dev-notes/spend-chart-api-spec.md`
3. `src/lib/local-api.js`
4. `dashboard/src/lib/api.ts`
5. `test/spend-records-api.test.js`

如果发现当前分支不是 TokenTracker/Token Eyes 当前集成基线,或者 `docs/dev-notes/spend-chart-api-spec.md` 不存在,停止并报告。

## 目标

新增:

```http
GET /functions/tokentracker-spend-timeseries
```

响应包含:

- `from`, `to`, `bucket`, `timezone`, `currency`
- `sources`
- `totals`
- `by_source`
- `series`

同一 `from/to/tz/tz_offset_minutes` 下,`timeseries.totals` 必须与 `/functions/tokentracker-spend-records` 的 `totals` 保持一致。

## 必须复用的现有口径

在 `src/lib/local-api.js` 中复用或贴近现有 helper:

- `getTimeZoneContext(url)`
- `getZonedParts(date, timeZoneContext)`
- `rowDayKey(row, timeZoneContext)`
- `computeRowCost(row, pricingOptions)`
- `normalizeSpendRecord(record)`
- `computeSubscriptionCostForRange(record, fromDate, toDate, usdToCny)`
- `getPricingOptions()`
- `getUsdToCny()`
- `readQueueData(qp)`
- `readTrackerConfig()`

不要重新发明一套日期/汇率/计价逻辑。

## 实现要求

### 1. 后端 endpoint

修改 `src/lib/local-api.js`:

- 新增内部 helper,一次读取 queue 后按 `(source, bucket_start)` 聚合 API 成本。
- 新增内部 helper,按 P01 规范把订阅成本分配到有效 bucket。
- 新增 endpoint:

```js
if (p === "/functions/tokentracker-spend-timeseries") {
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const bucket = url.searchParams.get("bucket") || "auto";
  const timeZoneContext = getTimeZoneContext(url);
  json(res, readSpendTimeseries(from, to, bucket, timeZoneContext));
  return true;
}
```

具体函数名可按代码风格调整,但行为必须符合 `docs/dev-notes/spend-chart-api-spec.md`。

### 2. bucket 行为

实现 `auto/hour/day/week`:

- `auto`,同一天: `hour`
- `auto`,2-120天: `day`
- `auto`,超过120天: `week`
- `hour`: 最多31天
- `day`: 最多366天
- `week`: 最多260周

超过限制返回 HTTP 400:

```json
{ "ok": false, "error": "spend timeseries range is too large for requested bucket" }
```

### 3. 输出连续序列

每个 `source x bucket` 都要有一行。该桶无成本时返回 0,保证 P03 前端能画连续折线。

金额字段:

- `api_cost_usd`
- `api_cost_cny`
- `subscription_cost_usd`
- `subscription_cost_cny`
- `combined_usd`
- `combined_cny`

统一 round 到 6 位小数。

### 4. API client

修改 `dashboard/src/lib/api.ts`:

- 在 `PATHS` 增加:

```ts
spendTimeseries: "tokentracker-spend-timeseries",
```

- 导出:

```ts
export async function getSpendTimeseries(params?: AnyRecord) {
  const tzParams = buildTimeZoneParams(params || {});
  return fetchLocalJson(PATHS.spendTimeseries, { ...(params || {}), ...tzParams });
}
```

如果你需要避免重复透传 `timeZone` / `tzOffsetMinutes`,可以按现有 API style 清理参数,但最终请求必须发送 `tz` / `tz_offset_minutes`。

## 测试要求

在 `test/spend-records-api.test.js` 末尾追加聚焦测试,或新建 `test/spend-timeseries-api.test.js`。建议新建文件以降低冲突。

至少覆盖:

1. 默认当前月返回 `series`, `totals`, `by_source`, `sources`。
2. monthly/yearly/one_time 订阅记录分配后,`series` 求和等于 `tokentracker-spend-records` 同范围 `totals.subscription_usd`。
3. API-only source 出现在 `sources`, `series`, `by_source`。
4. `tz_offset_minutes=-480` 时,`2026-06-01T00:30:00.000Z` queue row 被计入本地日期 `2026-05-31`。
5. CNY 订阅记录使用 `currencySettings.usdToCny` 转换。
6. 超出 bucket 限制返回 400 和稳定错误信息。

测试里不要读取真实用户日志。用临时 `trackerDataDir` 和临时 `queue.jsonl`,参考现有 `test/spend-records-api.test.js` 写法。

## 验证命令

至少运行:

```bash
node --test test/spend-records-api.test.js test/pricing.test.js test/local-settings-api.test.js
```

如果新建了 `test/spend-timeseries-api.test.js`,运行:

```bash
node --test test/spend-timeseries-api.test.js test/spend-records-api.test.js test/pricing.test.js test/local-settings-api.test.js
```

同时运行 dashboard API client 相关检查:

```bash
npm --prefix dashboard run typecheck
npm --prefix dashboard run build
```

如果因为已有无关问题失败,必须贴出失败摘要并证明与你本次改动无关。

## 验收标准

- `/functions/tokentracker-spend-timeseries?from=YYYY-MM-DD&to=YYYY-MM-DD&tz_offset_minutes=480` 返回完整 JSON。
- `bucket=hour`, `bucket=day`, `bucket=week` 都能工作。
- 每个 source 在每个 bucket 都有一行,0 成本行不缺失。
- `sum(series.combined_usd)` 等于响应 `totals.combined_usd`。
- 同一 `from/to/tz/tz_offset_minutes` 下,响应 `totals` 与 `/functions/tokentracker-spend-records` 的 `totals` 一致。
- 新增测试通过,现有 Spend/price/local settings 定向测试通过。

## 禁止事项

- 不实现 P03 前端折线图。
- 不新增图表库或 npm 依赖。
- 不改 Spend CRUD schema。
- 不改 Token Plan 自动刷新。
- 不改飞书同步逻辑。
- 不把 prompt/message/conversation body 返回到 API。
- 不顺手重构 `local-api.js` 无关 endpoint。

## 完成后回复

回复必须包含:

- 分支名
- commit SHA
- 修改文件列表
- endpoint 示例响应摘要
- 测试命令和结果
- 是否存在阻塞或无关失败