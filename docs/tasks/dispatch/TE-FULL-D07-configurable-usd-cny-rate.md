# TE-FULL-D07 - 可配置 USD/CNY 汇率实现

## 给 Claude Code 的执行说明

你负责实现 full plan 的 `D07`。只做可配置/手动刷新 USD-CNY 汇率,不要做 Spend 完整 CRUD、Token Plan 自动刷新、真实汇率 API、云同步或其它 full plan 任务。

## 基准与分支

必须基于已审核的 D04:

- 基准分支: `codex/te-full-d04-agent-model-pricing-rules`
- 基准 commit: `5a2221c`
- 新建分支: `claude/te-full-d07-configurable-usd-cny-rate`

开始前:

```bash
git fetch origin
git switch -c claude/te-full-d07-configurable-usd-cny-rate origin/codex/te-full-d04-agent-model-pricing-rules
git rev-parse --short HEAD
```

`rev-parse` 应为 `5a2221c` 或其后续等价提交。不要从旧 `codex-token-tracker-baseline` 开。

## 目标

把当前写死的 `USD/CNY = 7.2` 改成本地可配置汇率,并让以下地方使用同一个汇率来源:

1. `pricingRules` 中 `currency=CNY` 的成本换算。
2. Spend 页面手动支出记录的 USD/CNY 汇总。
3. Dashboard 上 MVP 的 USD/CNY 成本展示。
4. Settings 里允许用户手动输入并保存 USD/CNY 汇率。

## 数据结构

在本地 tracker config 中新增:

```json
{
  "currencySettings": {
    "usdToCny": 7.2,
    "source": "manual",
    "updated_at": "2026-06-21T00:00:00.000Z"
  }
}
```

规范化规则:

- `usdToCny` 必须是有限正数。
- 非法、缺失、`<=0` 时回退 `7.2`。
- `source` 当前只需要 `"manual"`。
- 保存时更新 `updated_at`。
- 不调用外部汇率 API; “手动刷新”就是用户修改输入框并保存。

## 允许修改的文件

优先只改:

- `src/lib/pricing/index.js`
- `src/lib/local-api.js`
- `dashboard/src/lib/currency.ts`
- `dashboard/src/lib/currency.test.ts`
- `dashboard/src/components/settings/AppearanceSection.jsx`
- `dashboard/src/content/copy.csv`
- `dashboard/src/pages/DashboardPage.jsx`
- `dashboard/src/pages/SpendPage.jsx`
- `test/pricing.test.js`
- `test/local-settings-api.test.js`
- `test/spend-records-api.test.js`

如需要新增聚焦测试文件可以新增,但不要做无关重构。

## 实现要求

### Local API

扩展 `/functions/tokentracker-local-settings`:

- `GET` 返回 `currencySettings`。
- `POST` 接收并规范化 `currencySettings`。
- 不影响现有 `agentDefaultPricing` / `pricingRules`。

`getPricingOptions()` 必须返回:

```js
{
  agentDefaultPricing,
  pricingRules,
  usdToCny
}
```

这样 D04 的 `computeRowCost(row, options)` 能用配置汇率处理 CNY pricing rule。

### Pricing

`src/lib/pricing/index.js` 已有:

```js
computeRowCostWithRule(row, rule, usdToCny = DEFAULT_USD_TO_CNY)
```

D07 要保证:

- `currency=CNY` rule 使用 `options.usdToCny`。
- 未传或非法时仍回退 `DEFAULT_USD_TO_CNY = 7.2`。
- 不破坏 D04 的优先级: `pricingRules -> agentDefaultPricing -> built-in -> 0`。

### Spend

`src/lib/local-api.js` 里 Spend 汇总当前使用固定 `MVP_USD_TO_CNY`。

改成读取 `currencySettings.usdToCny`:

- USD 记录换 CNY: `amount * usdToCny`
- CNY 记录换 USD: `amount / usdToCny`
- `total_usd` / `total_cny` 继续保留现有响应字段。

### Dashboard

Settings / Appearance 区域新增 USD/CNY 汇率输入:

- label: `USD/CNY 汇率`
- 输入 number,允许小数。
- 保存通过 `setLocalSettings({ currencySettings })`。
- 保存成功后显示已有 Settings 风格的成功/错误提示。
- 文案必须写入 `dashboard/src/content/copy.csv`,不要硬编码。

Dashboard 成本双币展示不能继续固定 7.2。`formatMvpUsdCny` 需要支持传入汇率,例如:

```ts
formatMvpUsdCny(value, usdToCny)
```

无效汇率回退 7.2。

## 禁止事项

- 不接真实汇率 API。
- 不新增后台定时任务。
- 不改 Token Plan 自动刷新。
- 不改 Spend 完整周期逻辑。
- 不改云端 edge pricing。
- 不保存任何敏感凭证。
- 不把飞书同步做进产品。

## 验收标准

必须补测试覆盖:

1. local settings GET/POST 能读写并规范化 `currencySettings`。
2. `pricingRules` 的 CNY rule 使用自定义 `usdToCny`,例如 `usdToCny=6` 时结果不同于 7.2。
3. Spend 汇总使用自定义 `usdToCny`。
4. Dashboard `formatMvpUsdCny` 使用传入汇率并对非法汇率回退。
5. Settings UI 能保存汇率,文案走 `copy.csv`。

## 验证命令

```bash
node --test test/pricing.test.js test/local-settings-api.test.js test/spend-records-api.test.js
npm.cmd --prefix dashboard run test -- currency.test.ts
npm.cmd --prefix dashboard run typecheck
npm.cmd run dashboard:build
npm.cmd run validate:copy
npm.cmd run validate:guardrails
```

如新增 `AppearanceSection.test.jsx`,也要跑:

```bash
npm.cmd --prefix dashboard run test -- AppearanceSection.test.jsx
```

## 报告

创建:

```text
docs/test-reports/full-plan/07-configurable-usd-cny-rate.md
```

报告包含:

- 分支和 commit SHA
- 改动文件
- `currencySettings` 结构
- pricingRules CNY 换算验证
- Spend 汇总验证
- Settings UI 验证
- 命令结果
- 阻塞/非阻塞问题

## 完成后提交

```bash
git status --short
git add src/lib/pricing/index.js src/lib/local-api.js dashboard/src/lib/currency.ts dashboard/src/lib/currency.test.ts dashboard/src/components/settings/AppearanceSection.jsx dashboard/src/content/copy.csv dashboard/src/pages/DashboardPage.jsx dashboard/src/pages/SpendPage.jsx test/pricing.test.js test/local-settings-api.test.js test/spend-records-api.test.js docs/test-reports/full-plan/07-configurable-usd-cny-rate.md
git commit -m "feat: add configurable usd cny rate"
git push -u origin claude/te-full-d07-configurable-usd-cny-rate
```

最后回复: 分支、commit、测试结果、是否有阻塞。
