# TE-FULL-G04 Rework 2 - Align API-only Source Breakdown with Time Zone Filtering

## 给 Claude Code 的执行说明

你负责继续返工 `TE-FULL-G04`。上一轮普通 API-only source 已修复，但时区过滤下仍不能验收。

阻塞现象:

- queue 中有 `source=codex` 的 API usage row
- 不存在任何 `codex` subscription/spend record
- 请求 `/functions/tokentracker-spend-records?from=2026-05-31&to=2026-05-31&tz_offset_minutes=-480`
- row: `hour_start=2026-06-01T00:30:00.000Z`
- 该 row 在 UTC-8 本地日期属于 `2026-05-31`
- `totals.api_usd` 正确大于 0
- 但 `by_source` 返回空数组，不包含 `codex`

G04 的 GET 口径支持 `tz` / `tz_offset_minutes`，所以 `by_source` 的 source 收集必须和 API cost 计算使用同一套日期口径。

## 必须基于

- 返工分支: `claude/te-full-g04-spend-crud-summary`
- 当前远端 HEAD: `14b3151`
- 已审核基线: D07 `c2c360b`

开始前执行:

```bash
git fetch origin
git switch claude/te-full-g04-spend-crud-summary
git pull --ff-only origin claude/te-full-g04-spend-crud-summary
git rev-parse --short HEAD
```

`rev-parse` 必须显示 `14b3151` 或它之后的提交。

## 必修问题

### 1. API-only source 收集必须使用时区后的 day key

当前返工在 `src/lib/local-api.js` 的 `summarizeSpendRecords()` 中收集 queue sources 时直接使用:

```js
const day = row.hour_start.slice(0, 10);
```

这和 API cost 计算不一致。`computeApiCostForRange()` 使用:

```js
aggregateByDay(rows, timeZoneContext, pricingOptions)
```

而 `aggregateByDay()` 内部使用 `rowDayKey(row, timeZoneContext)`。

修复要求:

- source 收集逻辑必须复用 `rowDayKey(row, timeZoneContext)` 或等价的同一口径。
- `from/to` 比较仍以 `YYYY-MM-DD` 字符串比较即可，但 day 必须是 timezone-adjusted day。
- 普通 UTC/default 场景仍要保留上一轮修复效果。
- 不要新增另一套日期换算函数。

### 2. 补充时区边界回归测试

在 `test/spend-records-api.test.js` 新增测试，覆盖:

1. 写入 queue row:

```json
{
  "hour_start": "2026-06-01T00:30:00.000Z",
  "source": "codex",
  "model": "gpt-5.2-codex",
  "input_tokens": 1000000,
  "output_tokens": 1000000,
  "cached_input_tokens": 0,
  "cache_creation_input_tokens": 0,
  "reasoning_output_tokens": 0,
  "total_tokens": 2000000,
  "conversation_count": 1
}
```

2. 不创建任何 `codex` subscription/spend record。
3. 配置 `agentDefaultPricing.codex`，让 API cost 大于 0。
4. 请求:

```text
/functions/tokentracker-spend-records?from=2026-05-31&to=2026-05-31&tz_offset_minutes=-480
```

5. 断言:
   - `totals.api_usd > 0`
   - `by_source` 包含 `source=codex`
   - `codex.subscription_usd === 0`
   - `codex.api_usd > 0`
   - `codex.combined_usd === codex.api_usd`

保留上一轮新增的普通 API-only source 测试。

### 3. 报告口径

更新:

```text
docs/test-reports/full-plan/15-spend-crud-summary.md
```

报告必须写清楚:

- 本轮修复的是 `tz/tz_offset_minutes` 下 `by_source` 与 `totals.api_usd` 口径不一致。
- 新增时区边界回归测试名称。
- 分支 HEAD 和实现 commit。避免只写旧实现 commit 导致审核追踪混乱。

## 必跑验证

```bash
node --test test/spend-records-api.test.js test/pricing.test.js test/local-settings-api.test.js
npm --prefix dashboard run test -- SpendPage.test.jsx currency.test.ts
npm --prefix dashboard run typecheck
npm run dashboard:build
npm run validate:copy
npm run validate:guardrails
```

## 交付

最终提交并推送:

```bash
git status --short
git add src/lib/local-api.js test/spend-records-api.test.js docs/test-reports/full-plan/15-spend-crud-summary.md
git commit -m "fix: align spend source breakdown with timezone filtering"
git push origin claude/te-full-g04-spend-crud-summary
```

返回给 Codex/用户时只给摘要、commit SHA、验证结果和报告路径。
