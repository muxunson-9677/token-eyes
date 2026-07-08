# TE-FULL-H04 - Full Plan Final Integration and Acceptance

## 给 Claude Code 的执行说明

你负责执行 full plan 的 `H04`：把已审核的 full-plan 分支集成到同一条最终验收分支，并完成最终回归验收报告。

本工单不是新功能开发。只允许做以下事情:

- 合并已审核分支。
- 解决合并冲突。
- 为合并冲突补必要的回归测试。
- 写最终验收报告。

不要新增 full plan 之外的功能，不要重构无关代码，不要合并 `main`，不要删除已经审核过的报告。

## 已审核输入分支

- D04/D07/G04 线:
  - 分支: `claude/te-full-g04-spend-crud-summary`
  - HEAD: `32d89f3`
  - 包含:
    - D04 Agent+Model pricing rules
    - D07 configurable USD/CNY rate
    - G04 spend CRUD + summary + R1/R2/R3 source breakdown fixes

- F03/F04 线:
  - 分支: `claude/te-full-f04-token-plan-refresh-risk-acceptance`
  - HEAD: `dbbad84`
  - 包含:
    - F03 Token Plan auto-refresh scheduler
    - F04 failure/risk/credential acceptance report

## 目标分支

```bash
git fetch origin
git switch -c claude/te-full-h04-final-integration-acceptance origin/claude/te-full-g04-spend-crud-summary
git merge --no-ff origin/claude/te-full-f04-token-plan-refresh-risk-acceptance
```

如果合并无冲突，也必须继续跑完整验收。
如果有冲突，按下面规则解决。

## 冲突解决规则

### 必须保留的 D04/D07/G04 能力

- `src/lib/pricing/index.js`
  - `pricingRules`
  - `normalizePricingRules`
  - `DEFAULT_USD_TO_CNY`
  - `normalizeUsdToCny`
  - `computeRowCost` 中 pricingRules/source default/built-in 优先级
- `src/lib/local-api.js`
  - `pricingRules`
  - `currencySettings`
  - spend records CRUD
  - spend summary totals/lifetime/by_source
  - API-only source union
  - `rowDayKey(row, timeZoneContext)` source filtering
  - default current-month effective `fromKey/toKey` filtering
- Dashboard
  - Settings pricing rules CRUD
  - USD/CNY rate setting
  - Spend records CRUD
  - Spend monthly/lifetime totals
  - Spend by_source table

### 必须保留的 F03/F04 能力

- `src/lib/token-plan-refresh.js`
- `src/lib/local-api.js`
  - Token Plan refresh local API
  - manual refresh no-op success
  - unsupported official API failure message
  - cookie scrape risk/failure handling
  - credential whitelist: only `codex_auth_json` / `claude_credentials_json` / empty
  - same-plan in-flight concurrency returns 409
- `src/commands/serve.js` scheduler wiring
- `dashboard/src/components/settings/TokenPlanSection.jsx`
  - subtitle/empty state copy from F03 rework
  - failure/risk messaging from F04 acceptance
- `dashboard/src/lib/api.ts`
  - Token Plan API methods
  - Spend API methods
- Tests:
  - `test/token-plans-api.test.js`
  - `test/token-plan-refresh.test.js`
  - `dashboard/src/components/settings/TokenPlanSection.test.jsx`

### 文档报告必须保留

合并后这些报告都必须存在:

```text
docs/test-reports/full-plan/04-agent-model-pricing-rules.md
docs/test-reports/full-plan/07-configurable-usd-cny-rate.md
docs/test-reports/full-plan/13-token-plan-auto-refresh-scheduler.md
docs/test-reports/full-plan/14-token-plan-refresh-risk-acceptance.md
docs/test-reports/full-plan/15-spend-crud-summary.md
```

如果 merge 过程中 `04-agent-model-pricing-rules.md` 被删除，必须恢复。不要因为一个分支缺这个文件就删除已审核报告。

## 必做验收

### 1. 分支集成验收

报告中列出:

- 集成分支名。
- G04 输入 commit: `32d89f3`
- F04 输入 commit: `dbbad84`
- merge commit 或最终 HEAD。
- 是否有冲突。
- 如果有冲突，逐文件说明保留了哪些能力。

### 2. 后端回归

必须运行:

```bash
node --test test/pricing.test.js test/local-settings-api.test.js test/token-plans-api.test.js test/token-plan-refresh.test.js test/spend-records-api.test.js
```

必须覆盖并报告这些结果:

- D04 pricingRules 测试通过。
- D07 currencySettings 测试通过。
- F03/F04 Token Plan refresh 测试通过。
- G04 Spend CRUD/summary/R1/R2/R3 测试通过。

### 3. 前端回归

必须运行:

```bash
npm --prefix dashboard run test -- AgentPricingSection.test.jsx TokenPlanSection.test.jsx SpendPage.test.jsx currency.test.ts
npm --prefix dashboard run typecheck
npm run dashboard:build
npm run validate:copy
npm run validate:guardrails
```

必须确认:

- Settings pricing rules CRUD 仍可测试通过。
- Token Plan UI 文案/空状态/失败状态测试通过。
- Spend UI records/totals/by_source 测试通过。
- USD/CNY formatting 测试通过。
- copy registry 没有新增错误。
- architecture guardrails 没有违规。

### 4. 产品面最终验收

报告中必须逐项判断:

- Dashboard 是否仍展示 token/cost/cache/token plan 相关能力。
- Spend 是否展示订阅 CRUD、API cost、subscription cost、combined cost、lifetime cost、by_source。
- Settings 是否展示 data directories、pricing rules、USD/CNY、Token Plan 相关设置。
- 不应出现与 Token Eyes 无关的入口或主流程:
  - 模型切换
  - Skills Manager
  - Leaderboard
  - 账号登录强制门槛

如果发现入口仍存在但属于当前基线既有残留，必须在报告里标明是否阻塞最终验收。

## 输出报告

新增:

```text
docs/test-reports/full-plan/16-final-integration-acceptance.md
```

报告必须包含:

- 分支、输入 commits、最终 commit。
- merge 过程和冲突处理。
- 后端验证命令与结果。
- 前端验证命令与结果。
- 产品面验收表。
- 是否有阻塞问题。
- 是否建议 Codex 创建最终 PR / 合并。

## 交付

提交并推送:

```bash
git status --short
git add src/lib/local-api.js src/lib/pricing/index.js src/lib/token-plan-refresh.js src/commands/serve.js dashboard/src/lib/api.ts dashboard/src/components/settings/AgentPricingSection.jsx dashboard/src/components/settings/TokenPlanSection.jsx dashboard/src/components/settings/AppearanceSection.jsx dashboard/src/pages/SpendPage.jsx dashboard/src/content/copy.csv test/pricing.test.js test/local-settings-api.test.js test/token-plans-api.test.js test/token-plan-refresh.test.js test/spend-records-api.test.js dashboard/src/components/settings/AgentPricingSection.test.jsx dashboard/src/components/settings/TokenPlanSection.test.jsx dashboard/src/pages/SpendPage.test.jsx dashboard/src/lib/currency.test.ts docs/test-reports/full-plan/04-agent-model-pricing-rules.md docs/test-reports/full-plan/07-configurable-usd-cny-rate.md docs/test-reports/full-plan/13-token-plan-auto-refresh-scheduler.md docs/test-reports/full-plan/14-token-plan-refresh-risk-acceptance.md docs/test-reports/full-plan/15-spend-crud-summary.md docs/test-reports/full-plan/16-final-integration-acceptance.md
git commit -m "chore: integrate full plan acceptance branch"
git push origin claude/te-full-h04-final-integration-acceptance
```

如果某些文件没有变化，`git add` 会忽略即可。返回给 Codex/用户时只给摘要、commit SHA、验证结果和报告路径。
