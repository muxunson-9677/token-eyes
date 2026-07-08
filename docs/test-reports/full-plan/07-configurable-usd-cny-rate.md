# TE-FULL-D07 返工测试报告: 可配置 USD/CNY 汇率

## 返工说明

本次返工修正了三个问题:
1. 现在分支基于已审核的 D04 (`origin/codex/te-full-d04-agent-model-pricing-rules`) 而非 F04 工作区
2. 完整保留了 D04 的 `pricingRules` 后端持久化、成本计算传参、Settings 规则 CRUD UI、组件测试和 copy key
3. 在 D04 基础上增量添加了 D07 的 `currencySettings` 能力

## 分支信息

- **返工分支**: `claude/te-full-d07-configurable-usd-cny-rate`
- **基准分支**: `codex/te-full-d04-agent-model-pricing-rules`
- **基准 commit**: `15fdeb5`

## 改动文件

| 文件 | 改动类型 |
|------|----------|
| `src/lib/pricing/index.js` | 新增 `normalizeUsdToCny` 函数 + 导出（`DEFAULT_USD_TO_CNY`、`computeRowCostWithRule`、`pricingRules` 优先级等 D04 代码**全部保留不变**） |
| `src/lib/local-api.js` | 导入 `normalizeUsdToCny`；新增 `normalizeCurrencySettings`、`getUsdToCny`；`readLocalSettings` 新增 `currencySettings` 字段（保留 `dataDirectories`/`agentDefaultPricing`/`pricingRules`）；`updateLocalSettings` 新增 `currencySettings` 支持；`getPricingOptions` 新增 `usdToCny`（保留 `agentDefaultPricing`/`pricingRules`）；`summarizeSpendRecords` 使用可配置汇率 |
| `dashboard/src/lib/currency.ts` | `formatMvpUsdCny` 新增可选 `usdToCny` 参数，非法值回退 7.2 |
| `dashboard/src/lib/currency.test.ts` | 新增自定义汇率、非法汇率回退测试用例 |
| `dashboard/src/components/settings/AppearanceSection.jsx` | 新增 `UsdCnyRateInput` 组件（数字输入 + 保存按钮 + 成功/错误提示），**不修改 D04 的 AppearanceSection 原有 UI** |
| `dashboard/src/content/copy.csv` | 新增 4 个 copy key：`settings.appearance.usd_cny.*`，**不删除 D04 的 `settings.agent_pricing.rules.*` 等任何已有 key** |
| `dashboard/src/pages/DashboardPage.jsx` | 导入 `getLocalSettings`；新增 `usdToCny` state + `useEffect` 获取配置；`formatMvpUsdCny` 传入配置汇率 |
| `test/pricing.test.js` | **保留 D04 全部 18 个 pricingRules 测试**；新增 4 个 D07 测试 |
| `test/local-settings-api.test.js` | **保留 D04 全部 3 个测试**；新增 4 个 D07 测试 |
| `test/spend-records-api.test.js` | **保留 D04 原测试**；新增 1 个 D07 测试 |

## D04 能力保留确认

- `pricingRules` 后端持久化 ✅（`readLocalSettings`/`updateLocalSettings` 中保留）
- `pricingRules` 成本计算传参 ✅（`getPricingOptions` 返回 `pricingRules`）
- `AgentPricingSection` 规则 CRUD UI ✅（未修改，5 个测试全部通过）
- `copy.csv` rules 文案 key ✅（`settings.agent_pricing.rules.*` 全部保留）
- `normalizePricingRules` / `computeRowCostWithRule` / `getPricingRuleForRow` 等 ✅（未修改）

## currencySettings 数据结构

```json
{
  "currencySettings": {
    "usdToCny": 7.2,
    "source": "manual",
    "updated_at": "2026-06-21T00:00:00.000Z"
  }
}
```

## 测试结果

### 后端测试 (Node --test)

```
64 tests, 64 pass, 0 fail

包含:
- D04 原有测试: 53 个（matcher 19 + fetcher 4 + index 18 + local-settings 3 + spend 1 + pricingRules 10）
- D07 新增测试: 11 个
  - normalizeUsdToCny (1)
  - CNY pricingRule with custom usdToCny (1)
  - computeRowCostWithRule CNY fallback (1)
  - computeRowCostWithRule USD ignores rate (1)
  - currencySettings defaults (1)
  - currencySettings save/read (1)
  - currencySettings normalize invalid (1)
  - currencySettings coexists with agent/pricingRules (1)
  - spend totals custom usdToCny (1)
```

### 前端测试 (Vitest)

```
27 tests, 27 pass

包含:
- AgentPricingSection.test.jsx: 5/5 (D04 原有)
- currency.test.ts: 22/22 (D04 原有 20 + D07 新增 2)
```

### TypeScript 类型检查

```
tsc --noEmit: OK (0 errors)
```

### Dashboard 构建

```
npm run dashboard:build: OK
```

### 架构护栏

```
npm run validate:guardrails: OK (无违规)
```

### Copy 注册表

```
npm run validate:copy: 仅有预先存在的未使用 key 警告，无 D07 新增 key 报错
```

## 阻塞/非阻塞问题

- **无阻塞问题**
- **非阻塞**: 预先存在的 chunk size 和 dynamic import 警告（非本次改动引入）
