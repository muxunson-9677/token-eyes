# TE-FULL-G04 - 花销模块 CRUD 与汇总测试报告 (返工 R2 后)

## 分支和提交

- **返工分支**: `claude/te-full-g04-spend-crud-summary`
- **基准 commit**: `c2c360b` (from `claude/te-full-d07-configurable-usd-cny-rate`)
- **R1 commit**: `78dc760` (API-only source 修复)
- **R2 commit**: (当前提交，时区口径修复)

## 返工修复说明

### R1：`by_source` 漏掉 API-only source（已合入）

原因：`summarizeSpendRecords()` 中的 `bySourceMap` 只从订阅记录（`spendRecords`）初始化，导致只有 API 消耗但没有订阅记录的 source（如 `codex`）不会出现在 `by_source` 拆分中。

修复：订阅记录迭代后新增 queue rows 遍历，收集当前统计区间内所有出现在 queue 中的 source，对尚未在 `bySourceMap` 中的 source 补初始化。

### R2：`tz/tz_offset_minutes` 下 `by_source` 与 `totals.api_usd` 口径不一致

原因：`summarizeSpendRecords()` 在收集 API-only source 时直接使用 `row.hour_start.slice(0, 10)` 取 UTC naive 日期，但 `computeApiCostForRange()` 内部使用 `aggregateByDay()` → `rowDayKey(row, timeZoneContext)` 做时区调整后的日期分组。当 queue row 的 UTC 日期在查询范围外但时区调整后的本地日期在查询范围内时（如 `hour_start=2026-06-01T00:30:00.000Z` 在 UTC-8 下属于 `2026-05-31`），`totals.api_usd > 0` 但 `by_source` 为空，口径不一致。

修复：
- source 收集循环改用 `rowDayKey(row, timeZoneContext)` 获取时区调整后的 day
- 比较逻辑改用 `fromStr`/`toStr` 字符串与 `day` 进行 YYYY-MM-DD 比较
- 与 `aggregateByDay()` 内部完全一致的口径

```js
// 修复前（R1）：UTC naive，与 API cost 计算口径不一致
const day = row.hour_start.slice(0, 10);
if (day < fromDate.toISOString().slice(0, 10) || day > toDate.toISOString().slice(0, 10)) continue;

// 修复后（R2）：使用 rowDayKey，与 aggregateByDay 完全一致
const day = rowDayKey(row, timeZoneContext);
if (!day) continue;
if (fromStr && day < fromStr) continue;
if (toStr && day > toStr) continue;
```

## 改动文件列表

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/lib/local-api.js` | 返工修改 | `summarizeSpendRecords()` 中 queue source 收集改用 `rowDayKey()` 统一时区口径 |
| `test/spend-records-api.test.js` | 新增测试 | R1: `G04 rework: API-only source appears in by_source breakdown`；R2: `G04 rework 2: timezone-adjusted API-only source appears in by_source` |
| `docs/test-reports/full-plan/15-spend-crud-summary.md` | 更新报告 | 更新为 R2 返工后最终信息 |

## 订阅记录字段结构

```json
{
  "id": "uuid",
  "source": "claude",
  "plan_label": "Max",
  "amount": 20,
  "currency": "USD",
  "billing_cycle": "monthly",
  "start_date": "2026-06-01",
  "end_date": "",
  "note": "",
  "created_at": "2026-06-21T00:00:00.000Z",
  "updated_at": "2026-06-21T00:00:00.000Z"
}
```

验证规则：
- `currency`: 只允许 USD/CNY，其它回退 USD
- `billing_cycle`: 只允许 monthly/yearly/one_time，其它回退 monthly
- `amount`: 创建/更新时必须 > 0
- `source` 和 `plan_label` 必填
- `start_date`: YYYY-MM-DD 格式，缺失回退今天
- `end_date`: YYYY-MM-DD 或空字符串（空=仍有效）
- `updated_at`: 每次更新时刷新

## 汇总公式说明

### 订阅记录换算

```text
amount_usd = currency == "CNY" ? amount / usdToCny : amount
```

- **monthly**: 每个与记录有效期重叠的自然月计 amount_usd
- **yearly**: 每个与记录有效期重叠的自然月计 amount_usd / 12
- **one_time**: 仅当 start_date 落在统计区间内时计 amount_usd

有效期：起点=start_date，终点=end_date（空=统计区间结束），以自然月为单位判断重叠。

### API 成本

API 成本来自 queue rows 的 `computeRowCost`/`pricingRules` 计算结果，使用 `aggregateByDay` 口径。

### by_source 并集逻辑（返工修复）

`by_source` 是订阅记录 sources 与 API usage sources 的**并集**：
- 只有订阅、只有 API、订阅+API 三种 source 都展示
- `subscription_usd/cny` 没有记录时为 0
- `api_usd/cny` 没有 usage 时为 0
- `combined_usd/cny` = subscription + api

### 返回结构

GET `/functions/tokentracker-spend-records` 返回：
- `records`: 订阅记录列表
- `totals`: 包含 subscription_usd/cny, api_usd/cny, combined_usd/cny, lifetime_* 及兼容旧字段 total_usd/cny
- `by_source`: 按 source 拆分的 subscription/api/combined 成本（含 API-only source）
- 支持 `from`/`to`/`tz`/`tz_offset_minutes` 查询参数，默认当前自然月

## 验证命令结果

### 后端测试 (70/70 通过)

```
node --test test/spend-records-api.test.js test/pricing.test.js test/local-settings-api.test.js
```

| 测试 | 状态 |
|------|------|
| ✔ G04: spend records API POST/GET/PUT/DELETE full CRUD | pass |
| ✔ G04: billing_cycle monthly/yearly/one_time monthly summary | pass |
| ✔ G04: CNY records converted using D07 currencySettings.usdToCny | pass |
| ✔ G04: API cost + subscription combined totals | pass |
| ✔ G04: by_source breakdown | pass |
| ✔ G04: legacy total_usd/total_cny backward compatibility | pass |
| ✔ G04 rework: API-only source appears in by_source breakdown | pass (R1) |
| ✔ G04 rework 2: timezone-adjusted API-only source appears in by_source | **新增 (R2)** |
| 7 settings + 55 pricing + 8 spend = 70 total | **全部通过** |

R1 回归测试详情：
- 写入 codex queue API usage row（本月 UTC）
- 不创建任何 codex spend/subscription record
- 配置 agentDefaultPricing.codex
- 断言 `totals.api_usd > 0`、`by_source` 包含 `source=codex`、`codex.subscription_usd === 0`、`codex.api_usd > 0`、`codex.combined_usd === codex.api_usd`

R2 时区边界回归测试详情：
- 写入 codex queue row: `hour_start=2026-06-01T00:30:00.000Z`，`source=codex`
- 不创建任何 codex subscription/spend record
- 配置 agentDefaultPricing.codex（input $3/MTok, output $15/MTok）
- 请求 `?from=2026-05-31&to=2026-05-31&tz_offset_minutes=-480`
- UTC 日期是 2026-06-01，但在 UTC-8 本地日期属于 2026-05-31
- 断言 `totals.api_usd > 0`、`by_source` 包含 `source=codex`、`codex.subscription_usd === 0`、`codex.api_usd > 0`、`codex.combined_usd === codex.api_usd`

### 定价测试 (55/55 通过)

```
node --test test/pricing.test.js → 55 pass, 0 fail
```

### 设置测试 (7/7 通过)

```
node --test test/local-settings-api.test.js → 7 pass, 0 fail
```

### 前端测试 (28/28 通过)

```
npm run test -- SpendPage.test.jsx currency.test.ts → 28 pass, 0 fail
  ✓ loads and displays records, totals, and by_source
  ✓ adds a new spend record
  ✓ edits an existing spend record
  ✓ deletes a spend record
  ✓ displays monthly API, subscription, combined, and lifetime costs
  ✓ displays by_source breakdown table
```

### TypeScript 类型检查

```
npm run typecheck → 通过
```

### Dashboard 构建

```
npm run dashboard:build → 构建成功 (5.61s)
```

### Copy 注册表验证

```
npm run validate:copy → Copy registry ok: 1040 entries, 839 keys used.
```

### 架构守卫验证

```
npm run validate:guardrails → Guardrails ok: no violations found.
```

## 阻塞问题

无阻塞问题。所有验证命令通过。

## 实现说明

1. **汇率使用**: 全部使用 D07 的 `currencySettings.usdToCny`，未写死 7.2
2. **旧字段兼容**: `total_usd`/`total_cny` 保持与 `combined_usd`/`combined_cny` 相等
3. **未改范围外模块**: 未修改 D07 汇率设置、D04 pricing rules、云同步、Token Plan 刷新等
4. **API 成本计算**: 对 claude/codex/hermes 来源，使用 agentDefaultPricing 优先级（无配置时为0），这是 D04 的现有行为
5. **monthly/yearly 汇总**: 按自然月迭代计算，正确处理跨月、跨年场景
6. **by_source 并集**: 订阅 sources + queue sources 的并集，确保 API-only source 不遗漏
7. **时区口径统一（R2）**: source 收集使用 `rowDayKey()`，与 `aggregateByDay()`/`computeApiCostForRange()` 完全一致
