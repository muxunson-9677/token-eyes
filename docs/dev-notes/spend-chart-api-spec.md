# Spend Chart API Spec

更新时间: 2026-06-22

任务: P01 - Spend折线图数据接口规范

## 目标

新增一个只读本地接口,为 Spend 页折线趋势图提供按时间桶和 source 拆分的花销序列。接口必须同时包含 API 成本、订阅摊销成本和合计成本,并且同一查询范围内的序列合计必须与现有 Spend 汇总卡片口径一致。

本规范只定义接口和口径。P02 实现时不要改动数据库 schema,不要引入云同步,不要改变现有 Spend 记录 CRUD 的请求方式。

## 现有口径

P02 必须复用以下现有基础设施:

- `src/lib/local-api.js`
  - `getTimeZoneContext(url)`: 读取 `tz` 和 `tz_offset_minutes`。
  - `rowDayKey(row, timeZoneContext)`: 将 queue row 映射到用户本地日期。
  - `aggregateByDay(rows, timeZoneContext, pricingOptions)`: 当前 Usage/Spend API 成本的日聚合口径。
  - `computeRowCost(row, pricingOptions)`: API 成本唯一计算入口。
  - `normalizeSpendRecord(record)`: Spend 记录归一化入口。
  - `computeSubscriptionCostForRange(record, fromDate, toDate, usdToCny)`: 当前 Spend 卡片的订阅成本识别口径。
  - `getPricingOptions()` 和 `getUsdToCny()`: 自定义计价和 USD/CNY 汇率来源。
- `dashboard/src/lib/api.ts`
  - `buildTimeZoneParams({ timeZone, tzOffsetMinutes })`: 前端请求时区参数的既有结构。

已验证过的 G04 修复口径必须保留:

- API-only source 即使没有订阅记录,只要 queue 在查询范围内有成本,也必须出现在结果里。
- 日期窗口必须按 `tz` / `tz_offset_minutes` 判断,不能只用 UTC `hour_start.slice(0, 10)`。
- CNY 订阅记录必须用当前 `currencySettings.usdToCny` 转成 USD 后参与计算,再返回 CNY 展示值。

## 接口

```http
GET /functions/tokentracker-spend-timeseries
```

### Query 参数

| 参数 | 必填 | 说明 |
|---|---:|---|
| `from` | 否 | 本地日期,格式 `YYYY-MM-DD`。缺省时使用当前本地月第一天,与 `tokentracker-spend-records` 默认范围一致。 |
| `to` | 否 | 本地日期,格式 `YYYY-MM-DD`。缺省时使用当前本地月最后一天,与 `tokentracker-spend-records` 默认范围一致。 |
| `tz` | 否 | IANA 时区名,例如 `Asia/Shanghai`。沿用 Usage API。 |
| `tz_offset_minutes` | 否 | 当前本地相对 UTC 的分钟偏移,例如中国时区传 `480`。沿用 Usage API。 |
| `bucket` | 否 | `auto` / `hour` / `day` / `week`。缺省为 `auto`。 |

不在 P02 增加 `source` 或 `model` 筛选。Spend 趋势图第一版需要展示所有 source 的多折线,避免把筛选逻辑和图表数据口径混在一起。

### bucket 规则

`bucket=auto` 时:

- `from === to`: 使用 `hour`。
- 查询跨度 `2-120` 天: 使用 `day`。
- 查询跨度大于 `120` 天: 使用 `week`。

显式传 `bucket=hour|day|week` 时按请求执行,但 P02 必须限制最大输出:

- `hour`: 最多 31 天。
- `day`: 最多 366 天。
- `week`: 最多 260 周。

超过限制时返回 `400`:

```json
{ "ok": false, "error": "spend timeseries range is too large for requested bucket" }
```

### 时间桶定义

- `hour`: 按用户本地小时聚合,`bucket_start` 格式为 `YYYY-MM-DDTHH:00:00`。
- `day`: 按用户本地日期聚合,`bucket_start` 格式为 `YYYY-MM-DD`。
- `week`: 按用户本地日期所属 ISO 周聚合,周一为 `bucket_start`,格式为 `YYYY-MM-DD`。

所有范围判断都按本地日期闭区间 `[from, to]` 处理。接口不返回 prompt、message、文件内容或任何对话正文。

## 响应结构

```json
{
  "from": "2026-06-01",
  "to": "2026-06-30",
  "bucket": "day",
  "timezone": {
    "tz": "Asia/Shanghai",
    "tz_offset_minutes": 480
  },
  "currency": {
    "base": "USD",
    "usd_to_cny": 7.2
  },
  "sources": ["claude", "codex", "hermes"],
  "totals": {
    "api_cost_usd": 12.5,
    "api_cost_cny": 90,
    "subscription_cost_usd": 30,
    "subscription_cost_cny": 216,
    "combined_usd": 42.5,
    "combined_cny": 306
  },
  "by_source": [
    {
      "source": "claude",
      "api_cost_usd": 4,
      "api_cost_cny": 28.8,
      "subscription_cost_usd": 20,
      "subscription_cost_cny": 144,
      "combined_usd": 24,
      "combined_cny": 172.8
    }
  ],
  "series": [
    {
      "bucket_start": "2026-06-01",
      "bucket_end": "2026-06-01",
      "label": "06-01",
      "source": "claude",
      "api_cost_usd": 0.2,
      "api_cost_cny": 1.44,
      "subscription_cost_usd": 0.67,
      "subscription_cost_cny": 4.82,
      "combined_usd": 0.87,
      "combined_cny": 6.26
    }
  ]
}
```

字段规则:

- `sources` 是本次查询范围内所有有 API 成本或订阅成本的 source,按字母序排序。
- `series` 必须为每个 `source x bucket` 返回一行,没有成本的桶返回 0,保证前端折线连续。
- 所有金额统一四舍五入到 6 位小数,与现有 Spend 后端一致。
- `totals` 等于 `series` 的逐项求和。
- `by_source` 等于按 source 汇总后的 `series` 求和。
- `combined_* = api_cost_* + subscription_cost_*`。

## API 成本聚合

P02 不要调用现有 `computeApiCostForRange()` 逐 source/逐桶重复扫描队列。应新增一个内部聚合 helper,一次读取 queue 后按 source 和 bucket 聚合:

1. `const allRows = readQueueData(qp)`。
2. 使用 `getPricingOptions()`。
3. 对每行 queue:
   - 跳过无 `hour_start` 的行。
   - 用 `getZonedParts(new Date(row.hour_start), timeZoneContext)` 得到本地日期和小时。
   - 判断本地日期是否落在 `[from, to]`。
   - 按 `bucket` 生成 `bucket_start`。
   - 用 `computeRowCost(row, pricingOptions)` 得到 USD API 成本。
   - 聚合到 `(source, bucket_start)`。

source 归一化沿用现有 Spend by_source 口径:

```js
const source = String(row.source || "unknown").trim().toLowerCase() || "unknown";
```

## 订阅成本摊销

P02 必须保持序列合计与现有 Spend 卡片一致。规则如下:

1. 对每条 `spendRecord`,先用 `computeSubscriptionCostForRange(record, fromDate, toDate, usdToCny)` 得到该记录在当前查询范围内的 USD 成本。
2. 如果该成本为 0,不参与序列。
3. 找出该记录在查询范围内的有效 bucket:
   - `one_time`: 只落在 `start_date` 对应的 bucket。
   - `monthly` / `yearly`: 落在记录有效区间与 `[from, to]` 相交的所有 bucket。
4. 将第 1 步得到的范围成本平均分配到这些有效 bucket。

这个规则是有意的:它让折线图求和严格等于当前 Spend 卡片,同时仍能在图上显示订阅成本随时间分布。不要在 P02 改成另一套“真实日费率”算法;如果未来要重新定义订阅会计口径,应另开任务同时改卡片和图表。

## 前端接入约定

P02 只需要提供后端接口和 API client 函数:

- 在 `dashboard/src/lib/api.ts` 增加 `PATHS.spendTimeseries = "tokentracker-spend-timeseries"`。
- 导出 `getSpendTimeseries(params)`。
- `params` 透传 `from`, `to`, `bucket`, `timeZone`, `tzOffsetMinutes`。
- 不增加新 npm 依赖。

P03 图表实现时应使用本接口的 `sources`, `series`, `totals`, `by_source`。Spend 页上方卡片仍可继续调用 `getSpendRecords()`;如果 P03 增加时间范围切换,同一个 `from/to/tz/tz_offset_minutes` 必须同时传给 `getSpendRecords()` 和 `getSpendTimeseries()`。

## P02 测试要求

在 `test/spend-records-api.test.js` 或新的聚焦测试文件中增加以下测试:

1. `GET /functions/tokentracker-spend-timeseries` 返回 `series`, `totals`, `by_source`, `sources`,且默认范围为当前月。
2. monthly/yearly/one_time 订阅记录在 month/day bucket 下分配后,`series` 求和等于 `tokentracker-spend-records` 同范围的 `totals.subscription_usd`。
3. 带 queue row 的 API-only source 必须出现在 `sources`, `series`, `by_source`。
4. 使用 `tz_offset_minutes=-480` 时,`2026-06-01T00:30:00.000Z` 的 queue row 在本地日期 `2026-05-31` 的查询中被计入。
5. CNY 订阅记录使用 `currencySettings.usdToCny` 转换,返回的 USD/CNY 金额与现有 Spend 汇总一致。
6. 超出 bucket 输出限制时返回 400,且错误信息稳定。

## P02 验收标准

- curl 调用 `/functions/tokentracker-spend-timeseries?from=YYYY-MM-DD&to=YYYY-MM-DD&tz_offset_minutes=480` 能返回完整 JSON。
- `bucket=hour` / `bucket=day` / `bucket=week` 都能工作。
- 每个 source 在每个 bucket 都有一行,0 成本行不缺失。
- `sum(series.combined_usd)` 等于响应 `totals.combined_usd`。
- 同一 `from/to/tz/tz_offset_minutes` 下,响应 `totals` 与 `/functions/tokentracker-spend-records` 的 `totals` 一致。
- 现有 `npm test` 中 Spend 相关测试通过,新增 timeseries 测试通过。
