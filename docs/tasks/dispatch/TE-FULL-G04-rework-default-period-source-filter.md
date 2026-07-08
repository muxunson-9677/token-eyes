# TE-FULL-G04 Rework 3 - Filter API-only Sources by Effective Default Period

## 给 Claude Code 的执行说明

你负责继续返工 `TE-FULL-G04`。R2 已修复 `tz_offset_minutes` 下 API-only source 漏项，但又暴露默认当前月请求的 source 过滤问题。

当前不能验收的原因:

- `GET /functions/tokentracker-spend-records` 未传 `from/to` 时，接口默认统计当前自然月。
- 如果 queue 中只有上个月的 API-only source，比如 `source=codex`，当前月 `totals.api_usd` 正确为 0。
- 但 `by_source` 仍会出现 `codex`，且所有金额都是 0。

这违反 G04 的口径：`by_source` 应该展示当前统计区间内的 source 拆分，不应该把区间外的历史 API-only source 带进当前月默认视图。

## 必须基于

- 返工分支: `claude/te-full-g04-spend-crud-summary`
- 当前远端 HEAD: `0e01616`
- 已审核基线: D07 `c2c360b`

开始前执行:

```bash
git fetch origin
git switch claude/te-full-g04-spend-crud-summary
git pull --ff-only origin claude/te-full-g04-spend-crud-summary
git rev-parse --short HEAD
```

`rev-parse` 必须显示 `0e01616` 或它之后的提交。

## 必修问题

### 1. API-only source 收集必须使用 effective period key

当前 R2 代码在 `src/lib/local-api.js` 的 `summarizeSpendRecords()` 中:

```js
const day = rowDayKey(row, timeZoneContext);
if (!day) continue;
if (fromStr && day < fromStr) continue;
if (toStr && day > toStr) continue;
```

问题:

- 未传 `from/to` 时，`fromStr` 和 `toStr` 都为空。
- `fromDate/toDate` 已经默认成当前自然月，但 source 收集没有使用这个默认区间。
- 结果是所有历史 queue source 都会进入 `by_source`，即使它们在当前统计区间没有 API 成本。

修复要求:

- 继续使用 `rowDayKey(row, timeZoneContext)`，保留 R2 的时区修复。
- 新增或使用 effective date key:

```js
const fromKey = fromDate.toISOString().slice(0, 10);
const toKey = toDate.toISOString().slice(0, 10);
```

- source 收集时无条件用 effective key 过滤:

```js
if (day < fromKey || day > toKey) continue;
```

- 不要回退到 `row.hour_start.slice(0, 10)`。
- 不要新增另一套时区换算函数。
- 普通 API-only source、时区边界 API-only source、默认当前月过滤都必须同时成立。

### 2. 新增默认当前月过滤回归测试

在 `test/spend-records-api.test.js` 新增测试，覆盖:

1. 写入一条上个月的 queue API usage row:

```json
{
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

`hour_start` 用当前日期的上个月 UTC 时间，避免测试和真实月份耦合。

2. 不创建任何 `codex` subscription/spend record。
3. 配置 `agentDefaultPricing.codex`，让该历史 row 如果被统计会有 API cost。
4. 请求默认接口:

```text
/functions/tokentracker-spend-records
```

5. 断言:
   - `totals.api_usd === 0`
   - `by_source` 不包含 `source=codex`
   - `by_source.length === 0`，如果测试里没有创建其它 spend record

保留 R1 和 R2 两个回归测试:

- `G04 rework: API-only source appears in by_source breakdown`
- `G04 rework 2: timezone-adjusted API-only source appears in by_source`

## 必跑验证

```bash
node --test test/spend-records-api.test.js test/pricing.test.js test/local-settings-api.test.js
npm --prefix dashboard run test -- SpendPage.test.jsx currency.test.ts
npm --prefix dashboard run typecheck
npm run dashboard:build
npm run validate:copy
npm run validate:guardrails
```

## 报告要求

更新:

```text
docs/test-reports/full-plan/15-spend-crud-summary.md
```

报告必须包含:

- R3 commit SHA。
- 本轮修复说明：默认当前月请求下，API-only source 收集必须按 effective `fromDate/toDate` 过滤。
- 新增默认当前月过滤回归测试名称。
- R1/R2/R3 三个回归测试均保留并通过。
- 上述验证命令结果。

## 交付

最终提交并推送:

```bash
git status --short
git add src/lib/local-api.js test/spend-records-api.test.js docs/test-reports/full-plan/15-spend-crud-summary.md
git commit -m "fix: filter spend source breakdown by effective period"
git push origin claude/te-full-g04-spend-crud-summary
```

返回给 Codex/用户时只给摘要、commit SHA、验证结果和报告路径。
