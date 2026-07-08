# TE-FULL-G04 Rework - Include API-only Sources in Spend Breakdown

## 给 Claude Code 的执行说明

你负责返工 `TE-FULL-G04`。当前分支主体功能和常规验证已完成，但不能验收：Spend 汇总的 `by_source` 只从订阅记录初始化 source，导致只有 API 消耗、没有订阅记录的 Agent/平台不会出现在按 source 拆分里。

G04 的验收口径包含 “API 成本 + 订阅成本合计、按 Agent/平台/source 拆分”。因此 API-only source 必须出现在 `by_source` 中。

## 必须基于

- 返工分支: `claude/te-full-g04-spend-crud-summary`
- 当前远端 HEAD: `41fe309`
- 基线: 已审核 D07 `c2c360b`

开始前执行:

```bash
git fetch origin
git switch claude/te-full-g04-spend-crud-summary
git reset --hard origin/claude/te-full-g04-spend-crud-summary
git rev-parse --short HEAD
```

`rev-parse` 必须显示 `41fe309` 或它之后的提交。不要从其它 full-plan 分支或脏工作区提交。

## 必修问题

### 1. `by_source` 漏掉 API-only source

当前现象:

- queue 中存在 `source=codex` 的 API usage row
- 本地没有任何 `codex` spend/subscription record
- `totals.api_usd` 能正确大于 0
- 但 `by_source` 返回空数组或不包含 `codex`

期望:

```json
{
  "source": "codex",
  "subscription_usd": 0,
  "api_usd": 3,
  "combined_usd": 3
}
```

具体要求:

- `by_source` 必须是订阅记录 sources 与 API usage sources 的并集。
- 只有订阅、只有 API、订阅 + API 三种 source 都要展示。
- `subscription_usd/cny` 没有记录时为 0。
- `api_usd/cny` 没有 usage 时为 0。
- `combined_usd/cny` 等于两者相加。
- 不要为了修这个问题改变 G04 之外的模块范围。

建议位置:

- `src/lib/local-api.js`
- `summarizeSpendRecords()`
- `computeApiCostForRange()` 如有必要可补充一个能返回 period source 集合的辅助函数，但不要重复发明 pricing 逻辑。

### 2. 报告 final commit SHA 需要更新

当前报告 `docs/test-reports/full-plan/15-spend-crud-summary.md` 写的最终 commit 仍是 `117591c`，但当前远端 HEAD 已是 `41fe309`。返工提交后，报告里的最终 commit 必须更新为返工后的真实 HEAD。

## 必须新增回归测试

在 `test/spend-records-api.test.js` 增加后端测试，覆盖:

1. 写入 queue API usage row，例如 `source=codex`。
2. 不创建任何 `codex` spend/subscription record。
3. 配置可计算成本的 `agentDefaultPricing.codex`。
4. 调用 `/functions/tokentracker-spend-records`。
5. 断言:
   - `totals.api_usd > 0`
   - `by_source` 包含 `source=codex`
   - `codex.subscription_usd === 0`
   - `codex.api_usd > 0`
   - `codex.combined_usd === codex.api_usd`

保留原有 G04 测试，不要删减。

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

更新报告:

```text
docs/test-reports/full-plan/15-spend-crud-summary.md
```

报告必须包含:

- 返工分支和最终 commit SHA。
- API-only source breakdown 的修复说明。
- 新增回归测试名称。
- 上述验证命令和结果。
- 是否有阻塞问题。

最终提交并推送:

```bash
git status --short
git add src/lib/local-api.js test/spend-records-api.test.js docs/test-reports/full-plan/15-spend-crud-summary.md
git commit -m "fix: include api-only sources in spend breakdown"
git push origin claude/te-full-g04-spend-crud-summary
```

返回给 Codex/用户时只给摘要、commit SHA、验证结果和报告路径。
