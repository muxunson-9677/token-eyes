# Full Plan D04 — 完整 Agent + Model 计费规则验收报告

日期: 2026-06-21

## 分支与 commit

- 基准分支: `codex-token-tracker-baseline`
- 实现分支: `codex/te-full-d04-agent-model-pricing-rules`
- 初版 commit: `cef011d` — `feat: add agent model pricing rules`
- 返工 commit: 见 `git log -1`（提交信息: `fix: force pricing rule id and normalize source for reasoning fold`）

> 说明: 任务派单原文使用 `claude/` 分支前缀，但实际执行方为 CodeBuddy，故改用 `codex/` 前缀以保持与仓库其它分支命名一致。

## 返工说明（复审修复）

基于 `77c93b0` 做三处小修：

1. **`normalizePricingRule`**：`id` 不再信任外部传入值，强制 `id = ${source}:${model}`；`normalizePricingRules` 按规范化后的 `source:model` 去重。补测试：同 source+model、不同 id 的输入只保留一条。
2. **`computeRowCostWithRule`**：对 `row.source` 做 `trim().toLowerCase()` 后再判断 `codex` / `every-code` reasoning 折叠。补测试：`source: "CODEX"` 命中 rule 时不重复计 reasoning。
3. **报告 SHA 修正**：初版报告把 HEAD 写成 `cef011d`，实际分支 HEAD 为 `77c93b0`（docs 提交），本次返工进一步推进到新 commit。

## 修改文件

| 文件 | 改动 |
|---|---|
| `src/lib/pricing/index.js` | 新增 `normalizePricingRule` / `normalizePricingRules` / `getPricingRuleForRow` / `computeRowCostWithRule` / `DEFAULT_USD_TO_CNY`；`computeRowCost` 增加 `pricingRules` 优先级（高于 `agentDefaultPricing` 和内置模型价）。 |
| `src/lib/local-api.js` | `readLocalSettings` / `updateLocalSettings` / `getPricingOptions` 增加 `pricingRules` 读写与归一化；导出 `normalizePricingRules`。 |
| `dashboard/src/components/settings/AgentPricingSection.jsx` | 重构为“Agent + Model 规则列表（增删改查）+ 默认计费（回退）”两段式 UI。 |
| `dashboard/src/components/settings/AgentPricingSection.test.jsx` | 覆盖默认计费、规则列表展示、新增规则、删除规则、空态提示。 |
| `dashboard/src/content/copy.csv` | 更新 section 标题/副标题；新增 rules CRUD 与 default 段落文案。 |
| `test/pricing.test.js` | 新增 8 个测试：归一化去重、优先级、CNY 换算、Codex reasoning 折叠、非 Codex 计费 reasoning、回退、精确匹配、空规则。 |
| `test/local-settings-api.test.js` | 新增 2 个测试：`pricingRules` 持久化与归一化、`getPricingOptions` 端到端成本计算。 |

`dashboard/src/lib/api.ts` 未改动：`getLocalSettings` / `setLocalSettings` 已使用 `AnyRecord` 透传，`pricingRules` 无需新增类型即可往返。

## API 结构摘要

`GET /functions/tokentracker-local-settings` 返回新增键：

```json
{
  "dataDirectories": { "claude": "", "codex": "", "hermes": "" },
  "agentDefaultPricing": { "claude": { "inputUsdPer1M": 0, "outputUsdPer1M": 0 }, ... },
  "pricingRules": [
    {
      "id": "codex:gpt-5.2-codex",
      "source": "codex",
      "model": "gpt-5.2-codex",
      "inputPricePer1M": 1.75,
      "outputPricePer1M": 14,
      "currency": "USD",
      "updated_at": "2026-06-20T00:00:00.000Z"
    }
  ]
}
```

`POST /functions/tokentracker-local-settings` 接收 `pricingRules` 数组并归一化：

- `source` 小写、`model` 去首尾空格；`id` 缺失时按 `${source}:${model}` 自动生成。
- `inputPricePer1M` / `outputPricePer1M` 负数与非有限数归零；`currency` 非 `USD`/`CNY` 回退 `USD`。
- `updated_at` 缺失时填入当前 ISO 时间。
- 缺 `source` 或 `model` 的条目被丢弃；同一 `id` 去重。

配置落盘到本机 `~/.tokentracker/tracker/config.json`，不上传云端。

## 成本优先级验证

`computeRowCost(row, options)` 优先级（由高到低）：

1. `options.pricingRules` 中 `source:model` 精确匹配 → `computeRowCostWithRule`：
   - `input_like = input + cached_input + cache_creation`
   - `output_like = output + (codex/every-code 不计 reasoning ? 0 : reasoning_output)`
   - `native = input_like/1M * inputPricePer1M + output_like/1M * outputPricePer1M`
   - `usd = currency == "CNY" ? native / 7.2 : native`（固定汇率，D07 会改为可配置）
2. `options.agentDefaultPricing[source]`（MVP 回退，reasoning 始终计入 output）。
3. 内置模型价（LiteLLM + curated；非 Token Eyes 来源保留）。
4. 0。

测试覆盖：

- `pricingRules: pricingRule beats agentDefaultPricing and built-in model pricing` — 规则 15.75 > agent 默认 10。
- `pricingRules: CNY rule converts to USD via fixed 7.2 rate` — 7.2+36 CNY → 6 USD。
- `pricingRules: codex/every-code reasoning tokens are NOT double-billed` — 1M output + 0.5M reasoning = 只计 10（不重复计 5）。
- `pricingRules: non-codex source DOES bill reasoning tokens` — 1M output + 0.5M reasoning = 15。
- `pricingRules: no match falls through to agentDefaultPricing` — 不匹配的模型回退默认价。
- `pricingRules: empty rules array does not activate the rule path` — 空数组回退内置价。
- `local settings API getPricingOptions includes pricingRules for cost calc` — 端到端：写入规则后 usage-summary 返回 `totals.total_cost_usd = 15.75`。

## UI 验证

`AgentPricingSection.jsx` 重构为两段：

1. **Agent + Model 计费规则**：表格列出 source / model / 输入 / 1M / 输出 / 1M / 币种 / 更新时间；行内“编辑”“删除”按钮；空态提示；“新增规则”按钮打开表单（Agent 下拉、模型名文本、输入/输出价格、币种下拉），表单校验空值与重复组合。
2. **默认计费（回退）**：保留原 MVP `agentDefaultPricing` 的 Claude/Codex/Hermes input/output 编辑器。

顶部统一“保存”按钮同时提交 `agentDefaultPricing` 与 `pricingRules`。文案全部走 `copy.csv`。

组件测试（`AgentPricingSection.test.jsx`）5 项全部通过：

- 加载并保存默认计费。
- 空态提示展示。
- 已有规则在表格中渲染。
- 新增规则并保存（断言 `setLocalSettings` 收到 `pricingRules[0]` 含 source/model/价格/币种）。
- 删除规则从表格移除。

## 命令结果

```bash
node --test test/pricing.test.js test/local-settings-api.test.js
```

- `test/pricing.test.js`: 48 通过（40 原有 + 8 新增），0 失败。
- `test/local-settings-api.test.js`: 3 通过（1 原有 + 2 新增），0 失败。

```bash
npm.cmd --prefix dashboard run test -- AgentPricingSection.test.jsx
```

- 5 通过，0 失败。

```bash
npm.cmd --prefix dashboard run typecheck
```

- `tsc --noEmit` 无错误。

```bash
npm.cmd run dashboard:build
```

- 构建成功（`built in 5.05s`），仅有 chunk-size 警告（非阻塞，与本次改动无关）。

附加验证：

- `npm run validate:copy` — `Copy registry ok: 1010 entries`（仅 pre-existing 未用键警告）。
- `npm run validate:guardrails` — `Guardrails ok: no violations found`。
- `node --test test/model-breakdown.test.js test/edge-pricing-parity.test.js test/local-api.test.js` — 全部通过，无回归。

## 阻塞 / 非阻塞问题

- **阻塞**: 无。
- **非阻塞**:
  - `validate:ui-hardcode` 报告 `SpendPage.jsx` / `UsageOverview.jsx` / `DashboardView.jsx` / `LocaleProvider.test.jsx` 有 rawText 增长，均为 baseline 已存在的问题，不在本工单改动范围（本次未触碰这些文件），且 `AgentPricingSection.jsx` 未被该检查标记。
  - 汇率当前硬编码 `7.2`（`DEFAULT_USD_TO_CNY`），D07 将替换为 `currencySettings.usdToCny` 可配置项；`computeRowCostWithRule` 已预留 `usdToCny` 参数入口。
  - `settings.agent_pricing.claude/codex/hermes` 被 `validate:copy` 标为 unused，实为规则编辑器下拉通过 `copy(a.labelKey)` 动态引用（验证器无法识别动态键），属误报。
