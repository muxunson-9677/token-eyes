# TE-FULL-D07 Rework - Preserve D04 Pricing Rules While Adding USD/CNY Rate

## 给 Claude Code 的执行说明

你负责返工 `TE-FULL-D07`。当前提交/工作区不能验收，原因不是 USD/CNY 汇率本身，而是交付形态和基线错误:

1. 远端没有 `claude/te-full-d07-configurable-usd-cny-rate` 分支，无法按 commit 审核。
2. 当前工作区 D07 改动叠在 F04 工作区上，未基于已审核的 D04。
3. 当前改动相对 D04 回退了 `pricingRules` 后端持久化、成本计算传参、Settings 规则 CRUD UI、组件测试和 copy key。

返工目标: 在保留 D04 全部 `pricingRules` 能力的前提下，实现 D07 可配置 USD/CNY 汇率。

## 必须基于

- 基准分支: `codex/te-full-d04-agent-model-pricing-rules`
- 基准 commit: `5a2221c`
- 返工分支: `claude/te-full-d07-configurable-usd-cny-rate`

开始前执行:

```bash
git fetch origin
git switch -c claude/te-full-d07-configurable-usd-cny-rate origin/codex/te-full-d04-agent-model-pricing-rules
git rev-parse --short HEAD
```

`rev-parse` 必须显示 `5a2221c` 或它之后明确包含 D04 的提交。不要从 F03/F04 分支、baseline 分支或脏工作区直接提交。

## 必须保留的 D04 能力

以下能力不能被删除、改名或绕过:

- `src/lib/pricing/index.js`
  - `normalizePricingRules`
  - `computeRowCost` 的 `pricingRules` 优先级
  - `pricingRules[source:model] -> agentDefaultPricing[source] -> built-in -> 0` 的成本优先级
- `src/lib/local-api.js`
  - `readLocalSettings()` 返回 `pricingRules`
  - `updateLocalSettings()` 持久化 `pricingRules`
  - `getPricingOptions()` 返回 `pricingRules`
- `dashboard/src/components/settings/AgentPricingSection.jsx`
  - 规则列表 CRUD UI
  - 新增/编辑/删除规则
  - USD/CNY 规则 currency 选择
- `dashboard/src/components/settings/AgentPricingSection.test.jsx`
  - D04 已有 5 个规则 CRUD 相关测试必须保留并通过
- `dashboard/src/content/copy.csv`
  - `settings.agent_pricing.rules.*` 文案 key 必须保留

## D07 应增加的能力

在上述 D04 能力基础上增加:

1. 本地配置结构:

```json
{
  "currencySettings": {
    "usdToCny": 7.2,
    "source": "manual",
    "updated_at": "2026-06-21T00:00:00.000Z"
  }
}
```

2. `src/lib/pricing/index.js`
   - 增加 `DEFAULT_USD_TO_CNY = 7.2`
   - 增加 `normalizeUsdToCny(value)`
   - 让 CNY 规则使用可配置 `usdToCny`
   - 不要破坏 D04 的 `normalizePricingRules`

3. `src/lib/local-api.js`
   - `readLocalSettings()` 同时返回:
     - `dataDirectories`
     - `agentDefaultPricing`
     - `pricingRules`
     - `currencySettings`
   - `updateLocalSettings()` 同时支持:
     - `dataDirectories`
     - `agentDefaultPricing`
     - `pricingRules`
     - `currencySettings`
   - `getPricingOptions()` 同时返回:
     - `agentDefaultPricing`
     - `pricingRules`
     - `usdToCny`
   - `summarizeSpendRecords()` 使用 `currencySettings.usdToCny`

4. Dashboard:
   - `dashboard/src/lib/currency.ts`: `formatMvpUsdCny(value, usdToCny?)`
   - `dashboard/src/pages/DashboardPage.jsx`: 读取本地 `currencySettings.usdToCny` 并传给成本展示
   - `dashboard/src/components/settings/AppearanceSection.jsx`: 增加 USD/CNY 汇率输入和保存按钮
   - `dashboard/src/content/copy.csv`: 只新增 D07 文案，不删除 D04 rules 文案

## 必须新增/保留的测试

后端:

- `test/pricing.test.js`
  - 保留 D04 pricingRules 测试
  - 新增 CNY rule 使用 `usdToCny` 的测试
  - 新增 invalid `usdToCny` fallback 到 7.2 的测试
- `test/local-settings-api.test.js`
  - 保留 D04 pricingRules 持久化和 `getPricingOptions` 测试
  - 新增 `currencySettings` 默认值、保存、非法值归一化、与 `agentDefaultPricing/pricingRules` 共存测试
- `test/spend-records-api.test.js`
  - 新增 spend totals 使用自定义 `usdToCny` 的测试

前端:

- `dashboard/src/components/settings/AgentPricingSection.test.jsx`
  - D04 原有 5 个测试必须继续通过
- `dashboard/src/lib/currency.test.ts`
  - 新增 `formatMvpUsdCny` 自定义汇率和非法汇率 fallback 测试

## 必跑验证

```bash
node --test test/pricing.test.js test/local-settings-api.test.js test/spend-records-api.test.js
npm --prefix dashboard run test -- AgentPricingSection.test.jsx currency.test.ts
npm --prefix dashboard run typecheck
npm run dashboard:build
npm run validate:copy
npm run validate:guardrails
```

## 报告与交付

更新报告:

```text
docs/test-reports/full-plan/07-configurable-usd-cny-rate.md
```

报告必须包含:

- 返工分支和最终 commit SHA
- 明确说明已保留 D04 `pricingRules` 后端、Settings UI、测试和 copy keys
- 上述验证命令和结果
- 是否有阻塞问题

最终必须提交并推送:

```bash
git status --short
git commit -m "feat: add configurable usd cny rate"
git push origin claude/te-full-d07-configurable-usd-cny-rate
```

返回给 Codex/用户时只给摘要、commit SHA、验证结果和报告路径。不要只给未提交工作区结果。
