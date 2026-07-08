# TE-NEXT-Q02 - billing_mode 徽章与筛选器实现

## 任务边界

本工单给 Claude Code 执行 `Q02 - billing_mode 徽章与筛选器实现`。

只实现 Usage Overview 中的计费方式派生标注、badge 和筛选器。不要改 queue schema、parser、Spend 图表、Pricing 公式、Token Plan CRUD schema、Windows/Tauri/WebView2 逻辑，也不要新增 npm 依赖。

依据规范：

- `docs/dev-notes/billing-mode-display-spec.md`
- `docs/token-eyes-next-blueprint-v3.md` 中 Q01/Q02
- `docs/test-reports/v2.1/01-parser-baseline.md` 中关于 Hermes `billing_mode` 未输出到 queue 的结论

## 先读文件

开始前按顺序读：

1. `CLAUDE.md`
2. `docs/dev-notes/billing-mode-display-spec.md`
3. `src/lib/local-api.js` 中 `/functions/tokentracker-usage-model-breakdown`
4. `src/lib/local-api.js` 中 `readTokenPlanRecords()` / `normalizeTokenPlanRecord()`
5. `dashboard/src/lib/model-breakdown.ts`
6. `dashboard/src/ui/dashboard/components/UsageOverview.jsx`
7. `dashboard/src/pages/DashboardPage.jsx`
8. `dashboard/src/content/copy.csv`
9. 现有相关测试：`test/local-settings-api.test.js`、`dashboard/src/lib/model-breakdown.test.*` 如存在、`UsageOverview` 相关测试如存在

如果发现当前 queue row 已经有可靠 `billing_mode` 字段，仍然按规范的“显式字段优先”实现，不要改 schema。

## 必须实现

### 1. 后端派生 metadata

在 `src/lib/local-api.js` 的 `/functions/tokentracker-usage-model-breakdown` 返回中，为 source 和 model 增加：

```json
{
  "billing_mode": "api_key | token_plan | unknown | mixed",
  "billing_modes": ["api_key", "token_plan", "unknown"],
  "billing_mode_confidence": "explicit_row | token_plan_label_match | source_token_plan_match | heuristic_model_keyword | fallback_unknown"
}
```

model 只允许 `api_key/token_plan/unknown`；source 可以是 `mixed`。

派生规则必须严格遵守 `docs/dev-notes/billing-mode-display-spec.md`。

关键点：

- 显式 row 字段 `billing_mode` / `billingMode` 优先。
- 当前没有显式字段时，结合 `readTokenPlanRecords()` 和 model/source 关键词推断。
- Hermes 这种可能混合的 source，不能仅因为存在 `source=hermes` 的套餐记录就把全部 Hermes model 标成套餐。
- 无法可靠判断时返回 `unknown`，不要默认 API Key。

### 2. 前端数据传递

修改 `dashboard/src/lib/model-breakdown.ts`：

- `buildFleetData()` 必须把 source 和 model 的 `billing_mode`、`billing_modes`、`billing_mode_confidence` 传给 UsageOverview。
- 增加过滤辅助函数也可以，但不要过度抽象。
- 过滤后需要重算 provider 的 `usage`、`usd`、`totalPercent`、model `share`，不能沿用过滤前百分比。

### 3. UsageOverview UI

修改 `dashboard/src/ui/dashboard/components/UsageOverview.jsx`：

- 在 Usage Overview 卡片内增加计费方式 segmented control。
- 选项：全部、API Key、套餐、未标注。
- Provider 卡片标题旁显示 source 级 badge。
- 展开后的 model 行在 model 名称旁显示 model 级 badge。
- `mixed` 只用于 source badge，不用于 model badge。
- 过滤后如果没有匹配项，显示一个简短 empty 状态，文案也进入 copy registry。

UI 要求：

- badge 小尺寸、低干扰，移动端不能挤压或溢出。
- 使用现有 Tailwind 和现有组件风格，不新增依赖。
- 不要写大段说明文字，不要在界面解释算法。

### 4. copy 文案

新增到 `dashboard/src/content/copy.csv`：

- `usage.billing_filter.label`
- `usage.billing_filter.all`
- `usage.billing_filter.api_key`
- `usage.billing_filter.token_plan`
- `usage.billing_filter.unknown`
- `usage.billing_filter.empty`
- `usage.billing_mode.api_key`
- `usage.billing_mode.token_plan`
- `usage.billing_mode.unknown`
- `usage.billing_mode.mixed`

建议中文值：

- 计费方式
- 全部
- API Key
- 套餐
- 未标注
- 当前计费方式下暂无数据
- API Key
- 套餐
- 未标注
- 混合

不要在 JSX 中硬编码这些文案。

## 测试要求

至少补以下测试：

1. 后端：显式 `billing_mode=api_key` / `billing_mode=token_plan` 的 queue row 返回正确 mode。
2. 后端：Token 套餐记录 `plan_label="Xiaomi MiMo Token Plan"` 能匹配 `mimo-v2.5-pro` 为 `token_plan`。
3. 后端：同一 `source=hermes` 下 `deepseek-v4-pro` 不因 MiMo 套餐记录被错标为套餐。
4. 后端：无显式字段、无规则命中时返回 `unknown`。
5. 前端：筛选 API Key / 套餐 / 未标注会过滤 model/provider，并重算百分比。
6. 前端：badge 文案来自 copy registry。

不要读取真实用户日志，测试用临时 queue/config。

## 验证命令

至少运行：

```bash
node --test test/local-settings-api.test.js
npm --prefix dashboard run test -- UsageOverview
npm --prefix dashboard run test -- model-breakdown
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
```

如果某个测试文件名不存在，改跑最接近的目标测试并在完成报告里说明。建议补跑：

```bash
npm --prefix dashboard run test -- DashboardPage.test.jsx
```

完整 `npm --prefix dashboard run test` 如果仍因既有中文本地化断言失败，不要在本任务里修无关测试；列出失败文件和原因即可。

## 验收标准

- Usage Overview 有计费方式筛选器。
- Provider 卡片和展开 model 行都有计费方式 badge。
- Hermes 混合来源可以显示 source=混合、model 分别为 API Key / 套餐 / 未标注。
- 未知数据展示为“未标注”，不伪造为 API Key。
- 筛选后 tokens/cost/share 自洽。
- copy、hardcode、guardrails、typecheck、build 通过。
- 不新增 npm 依赖，不改 queue/parser/schema，不影响 Spend P03。

## 建议分支

`claude/te-next-q02-billing-mode-badges-filter`

## 完成后回复必须包含

- 分支名
- commit SHA（如果未提交，明确说明未提交）
- 修改文件列表
- 派生规则实现说明
- UI 位置和筛选行为说明
- 测试命令和结果
- 是否存在阻塞或无关失败
