# Q01 - billing_mode 标注规范

更新时间：2026-06-23
任务编号：Q01
任务性质：Codex 设计任务
后续执行：Q02 交给 Claude Code

## 结论

当前仓库不能证明 usage queue 记录已经可靠写入 `billing_mode`。

已确认：

- `docs/test-reports/v2.1/01-parser-baseline.md` 明确记录：Hermes 本地 schema 里存在 `billing_provider`、`billing_base_url`、`billing_mode` 字段，但 TokenTracker 当前 queue row 只输出 `source` 和 `model`，不输出计费线字段。
- `src/lib/local-api.js` 的 `/functions/tokentracker-usage-model-breakdown` 当前按 queue row 的 `source/model/hour_start` 聚合，没有读取或返回 `billing_mode`。
- `src/lib/rollout.js` 当前没有 `billing_mode` 输出路径。
- 设置页已有 Token 套餐记录接口：`/functions/tokentracker-token-plans`，字段包括 `source`、`plan_label`、`total_quota`、`used_quota`、`remaining_quota`、`expires_at`、刷新配置等。

因此 Q02 不允许改 queue schema、parser schema 或数据库结构。第一版只做展示层派生标注：如果未来 row 里出现显式 `billing_mode` 就优先使用；当前没有时，根据 Token 套餐记录和有限关键词推断；无法可靠判断时显示“未标注”，不能强行伪装成 API Key 或套餐。

## 展示目标

用户在 Usage 页面能直接看出每个 source/model 的计费方式：

- `API Key`：按量 API Key / pay-as-you-go / 外部 API 计费。
- `Token Plan`：订阅套餐、官方账号套餐、手动录入的 Token 套餐。
- `未标注`：当前数据无法可靠判断。
- `混合`：同一个 source 下的 model 同时包含多种计费方式。

筛选器用于查看某一种计费方式下的 source/model 明细。第一版筛选 Usage Overview 的 source/model breakdown，不改变 Spend、Leaderboard、Heatmap、请求趋势图和历史汇总口径。

## 数据定义

内部标准值：

```ts
type BillingMode = "api_key" | "token_plan" | "unknown";
type SourceBillingMode = BillingMode | "mixed";
```

后端返回建议：

```json
{
  "source": "hermes",
  "billing_mode": "mixed",
  "billing_modes": ["api_key", "token_plan"],
  "models": [
    {
      "model": "deepseek-v4-pro",
      "billing_mode": "api_key",
      "billing_mode_confidence": "heuristic_model_keyword"
    },
    {
      "model": "mimo-v2.5-pro",
      "billing_mode": "token_plan",
      "billing_mode_confidence": "token_plan_label_match"
    }
  ]
}
```

`billing_mode_confidence` 只用于调试和测试，不要在 UI 里展示为大段说明。允许值：

- `explicit_row`
- `token_plan_label_match`
- `source_token_plan_match`
- `heuristic_model_keyword`
- `fallback_unknown`

## 派生规则

按以下优先级执行，先命中先返回。

### 1. 显式字段优先

如果 queue row 或聚合输入里存在以下字段，先归一化：

- `billing_mode`
- `billingMode`
- `billing_provider` / `billingProvider` 可作为辅助，但不能单独替代 `billing_mode`

归一化规则：

- `api_key`、`api-key`、`api key`、`payg`、`pay_as_you_go`、`pay-as-you-go` -> `api_key`
- `token_plan`、`token-plan`、`token plan`、`subscription`、`plan` -> `token_plan`
- 其他值 -> `unknown`

### 2. Token 套餐记录匹配

从 `readTokenPlanRecords()` 读取本地 Token 套餐记录。不要新增新配置文件。

匹配规则：

- `record.source` 与 queue source 归一化后相等，并且 `record.plan_label` 能匹配当前 model 的关键词时，返回 `token_plan`。
- 关键词匹配使用小写、去符号、分词后的包含关系；长度小于 3 的词忽略。
- 典型例子：`plan_label="Xiaomi MiMo Token Plan"` 可匹配 `model="mimo-v2.5-pro"`。
- 对明显可能混合计费的 source，例如 `hermes`，不要仅因为 `record.source === "hermes"` 就把所有 Hermes model 标成 `token_plan`。
- 对单一套餐型 source，例如用户明确录入 `source=codex` 的 Token 套餐记录，且当前 source 下没有 model 级冲突时，可以按 source 级别返回 `token_plan`。

### 3. 模型/来源关键词

在没有显式字段和 Token 套餐匹配时，可以做保守关键词推断。

Token Plan 关键词：

- `mimo`
- `token plan`
- `subscription`
- `pro plan`
- `max plan`
- `plus plan`

API Key 关键词：

- `deepseek`
- `openrouter`
- `api key`
- `payg`
- `pay-as-you-go`
- `custom api`

关键词推断只能用于 model 级 badge。source 级 badge 由子 model 汇总得出。

### 4. 未标注兜底

无法可靠判断时返回 `unknown`。不要默认当作 API Key。

原因：当前 queue cost 是按模型价格估算出来的 API 成本，但这不等价于用户真实账单方式。把未知强行标成 API Key 会误导用户。

## Source 汇总规则

source 的 `billing_mode` 由其 model 子项汇总：

- 全部 model 都是 `api_key` -> `api_key`
- 全部 model 都是 `token_plan` -> `token_plan`
- 全部 model 都是 `unknown` -> `unknown`
- 存在两种或三种不同 mode -> `mixed`

`billing_modes` 返回去重后的 model mode 数组，排序固定为 `api_key`、`token_plan`、`unknown`。

## UI 方案

位置：Usage Overview 卡片内部，而不是全局改整个 Dashboard。

### 筛选器

在 Usage Overview 标题区域右侧或 provider distribution 上方增加一个紧凑 segmented control：

- 全部
- API Key
- 套餐
- 未标注

选择 `API Key` 时，只显示 `billing_mode=api_key` 的 model；source 卡片保留至少一个匹配 model 的 source，并按过滤后的 tokens/cost/share 重算该卡片内部展示值。

选择 `套餐` 同理。

选择 `未标注` 时，帮助用户发现还需要补 Token 套餐记录或等待 parser 输出显式字段的来源。

### 徽章

Provider 卡片标题旁显示 source 级 badge：

- `API Key`
- `套餐`
- `混合`
- `未标注`

展开后的 model 行在 model 名称右侧显示 model 级 badge。

样式要求：

- 不新增 npm 依赖。
- 使用现有 Tailwind utility。
- badge 小尺寸、低干扰，不能挤压 model 名称；移动端过窄时允许 badge 换行到下一行。
- 颜色建议：API Key 使用 amber，套餐使用 emerald，混合使用 sky/indigo，未标注使用 gray。不要引入大面积新配色。

## copy key

所有新增可见文本写入 `dashboard/src/content/copy.csv`：

- `usage.billing_filter.label` = `计费方式`
- `usage.billing_filter.all` = `全部`
- `usage.billing_filter.api_key` = `API Key`
- `usage.billing_filter.token_plan` = `套餐`
- `usage.billing_filter.unknown` = `未标注`
- `usage.billing_mode.api_key` = `API Key`
- `usage.billing_mode.token_plan` = `套餐`
- `usage.billing_mode.unknown` = `未标注`
- `usage.billing_mode.mixed` = `混合`

不要在 JSX 中硬编码这些中文或英文。

## Q02 实现边界

允许修改：

- `src/lib/local-api.js`：在 `/functions/tokentracker-usage-model-breakdown` 聚合结果里附加派生 `billing_mode` 元数据。
- `dashboard/src/lib/model-breakdown.ts`：保留并传递 `billing_mode`、`billing_modes`。
- `dashboard/src/ui/dashboard/components/UsageOverview.jsx`：增加筛选器和徽章。
- `dashboard/src/content/copy.csv`：新增 copy key。
- 相关测试文件。

不允许修改：

- queue schema。
- parser 输出结构。
- Spend 图表 P02/P03 逻辑。
- Pricing 计算公式。
- Token Plan CRUD schema。
- Windows/Tauri/WebView2 逻辑。

## 测试要求

Q02 至少覆盖：

1. `/functions/tokentracker-usage-model-breakdown` 对显式 `billing_mode=api_key/token_plan` 的 row 能正确返回 model/source mode。
2. Token 套餐记录 `plan_label="Xiaomi MiMo Token Plan"` 能把 `mimo-v2.5-pro` 标为 `token_plan`，但不把同 source 下的 `deepseek-v4-pro` 错标为套餐。
3. 无显式字段、无匹配规则时返回 `unknown`。
4. `buildFleetData()` 保留 source/model billing metadata，并在过滤后重算 tokens/cost/share。
5. UsageOverview 筛选器能切换全部/API Key/套餐/未标注，徽章文案来自 copy registry。
6. `validate:copy`、`validate:ui-hardcode` 通过。

## 验收标准

- Usage Overview 能看到计费方式筛选器。
- Provider 卡片和展开后的 model 行能看到计费方式 badge。
- 不可靠数据展示为“未标注”，不伪装成 API Key。
- Hermes 这类混合 source 能在不同 model 上展示不同 mode；source 汇总为“混合”。
- 过滤后 model 列表和 provider 卡片数据口径自洽。
- 不新增依赖，不改 schema，不影响 Spend P03。
