# TE-NEXT-P03 - Spend 折线图前端组件

## 任务边界

本工单给 Claude Code 执行 `P03 - Spend 折线图前端组件`。只实现 Spend 页花销趋势图、多 source 折线、hover/focus tooltip、时间范围切换，以及与 P02 timeseries API 的前端集成。

不要改 P02 后端聚合算法，不要改 Spend CRUD schema，不要改 parser，不要改 adapter registry，不要实现 Q/R/U/V 模块，不要新增 npm 依赖。

本工单依据：

- `docs/token-eyes-next-blueprint-v3.md`
- `docs/dev-notes/spend-chart-api-spec.md`
- `docs/tasks/dispatch/TE-NEXT-P02-spend-timeseries-api.md`
- `dashboard/src/lib/api.ts` 中的 `getSpendTimeseries(params)`
- `dashboard/src/pages/SpendPage.jsx` 中 S02 已实现的刷新逻辑

## 先读文件

开始前按顺序读：

1. `CLAUDE.md`
2. `docs/dev-notes/spend-chart-api-spec.md`
3. `docs/tasks/dispatch/TE-NEXT-P02-spend-timeseries-api.md`
4. `dashboard/src/pages/SpendPage.jsx`
5. `dashboard/src/lib/api.ts`
6. `dashboard/src/hooks/useCurrency.js`
7. `dashboard/src/ui/dashboard/components/TrendMonitor.jsx`（只参考图表交互、tooltip、颜色体系，不要硬复制无关逻辑）
8. `dashboard/src/content/copy.csv`
9. `dashboard/src/pages/SpendPage.test.jsx`

如果 `getSpendTimeseries` 不存在，或者 P02 的验证结果不明确，停止并报告，不要自行猜接口。

## 目标

在 Spend 页汇总卡片下方、by-source 表格上方新增花销趋势图。

必须实现：

- 每个 `source` 一条折线。
- X 轴为时间桶，Y 轴为金额。
- 图例展示 source 名称和颜色。
- hover 或键盘 focus 到某个 bucket 时显示 tooltip。
- tooltip 展示该 bucket 下每个 source 的 API 成本、订阅成本、合计成本。
- 支持 `day/week/month/total/custom` 时间范围切换。
- 切换时间范围时，`getSpendRecords` 和 `getSpendTimeseries` 必须使用同一组 `from/to/tz/tz_offset_minutes`。
- S02 自动刷新时同时静默刷新 records 和 timeseries，不能清空旧图或导致整页闪烁。

## 图表实现要求

当前 `dashboard/package.json` 没有 Recharts/ECharts/Visx/D3 这类图表库。不要新增依赖。

使用原生 React + SVG：

- 新增 `dashboard/src/components/spend/SpendTrendChart.jsx`。
- 用 `<svg>` 绘制坐标轴、折线、点和 hover hit area。
- 如有需要，可以新增一个很小的 helper 文件，例如 `dashboard/src/components/spend/spend-trend-utils.js`，但不要过度抽象。
- 视觉风格参考现有 `TrendMonitor`：紧凑、信息密度高、明暗主题都可读。
- 图表容器要有稳定高度和响应式约束，移动端不能溢出。
- source 颜色使用稳定映射；未知 source 用固定 palette + hash 选择颜色。

## 数据和货币

调用：

```js
getSpendTimeseries({ from, to, bucket, timeZone, tzOffsetMinutes })
```

货币显示：

- 使用 `useCurrency()` 获取 `currency/rate`。
- 如果 `currency === "CNY"`，图表 Y 轴和 tooltip 使用 `*_cny` 字段。
- 其他情况默认使用 `*_usd` 字段。
- 不要重新计算后端金额，只选择展示字段。

字段映射：

- API 成本：`api_cost_usd/api_cost_cny`
- 订阅成本：`subscription_cost_usd/subscription_cost_cny`
- 合计：`combined_usd/combined_cny`

## 时间范围规则

在 Spend 页增加范围 state，至少支持：

- `day`：今天，`bucket=hour`
- `week`：最近 7 天，`bucket=day`
- `month`：当前自然月，`bucket=day`
- `total`：从最早可用记录到今天；如果暂时拿不到更早日期，可先用当前自然年到今天，并用短注释说明取舍
- `custom`：用户选择 `from/to`，`bucket=auto`

实现建议：

- 尽量复用 `DashboardPage` 里已有的本地日期和时区参数生成思路。
- 如果复用 `DateRangePopover` 成本过高，可以先用两个 `input type="date"` 实现 custom。
- 所有可见文本必须进入 `copy.csv`。
- 范围切换必须同时刷新上方卡片、by-source 表格、记录列表和新图表，避免数字口径不一致。

## SpendPage 集成

修改 `dashboard/src/pages/SpendPage.jsx`：

- import `getSpendTimeseries` 和 `SpendTrendChart`。
- 新增 `timeseries`、`timeseriesLoading`、`timeseriesError` state。
- `fetchRecords({ silent })` 改为同一轮请求 records + timeseries，建议用 `Promise.all`。
- records 错误和 chart 错误要能区分展示。
- 初始加载可以继续显示原有 loading。
- silent refresh 必须保留已有 records 和图表数据。
- 手动刷新和自动刷新都必须刷新 timeseries。
- 保留 S02 的 `lastUpdatedAt` 行为。

## 文案要求

所有新增用户可见文本写入 `dashboard/src/content/copy.csv`。建议 key：

- `spend.trend.title`
- `spend.trend.subtitle`
- `spend.trend.empty`
- `spend.trend.loading`
- `spend.trend.error`
- `spend.trend.range.day`
- `spend.trend.range.week`
- `spend.trend.range.month`
- `spend.trend.range.total`
- `spend.trend.range.custom`
- `spend.trend.custom_from`
- `spend.trend.custom_to`
- `spend.trend.tooltip.api`
- `spend.trend.tooltip.subscription`
- `spend.trend.tooltip.combined`
- `spend.trend.legend_label`

不要在 JSX 里硬编码中文或英文 raw text。完成后必须跑 `npm run validate:ui-hardcode`。

## 测试要求

更新或新增前端测试，至少覆盖：

1. SpendPage 初始加载会调用 `getSpendRecords` 和 `getSpendTimeseries`。
2. 范围切换后，两者使用同一组 `from/to` 参数。
3. 图表渲染多个 source 的图例。
4. hover/focus 某个 bucket 后显示 API、订阅、合计 tooltip。
5. 空 `series` 显示 empty 文案。
6. CNY currency 下 tooltip/Y 轴使用 CNY 字段。

测试可以 mock `useCurrency` 和 `getSpendTimeseries`。不要读取真实用户日志。

## 验证命令

至少运行：

```bash
npm --prefix dashboard run test -- SpendPage.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
```

建议补跑 P02 契约测试：

```bash
node --test test/spend-timeseries-api.test.js test/spend-records-api.test.js test/pricing.test.js test/local-settings-api.test.js
```

如果完整 `npm --prefix dashboard run test` 仍因既有中文本地化断言失败，不要在本任务里修无关测试；完成回复中列出失败文件和原因即可。

## 验收标准

- Spend 页汇总卡片下方出现花销趋势图。
- 多个 source 时能看到多条线和图例。
- hover/focus tooltip 能显示该 bucket 每个 source 的 API 成本、订阅成本、合计成本。
- `day/week/month/total/custom` 切换后，图表与上方卡片数字口径一致。
- 自动刷新和手动刷新都会更新图表，且 silent refresh 不清空旧图。
- 新增文案全部在 copy registry 中。
- 不新增 npm 依赖。
- 定向测试、typecheck、build、copy 校验、UI hardcode 校验、guardrails 通过。

## 禁止事项

- 不改 `src/lib/local-api.js` 的 P02 聚合算法；如果发现 P02 明确 bug，停止并报告。
- 不改 queue schema 或 Spend record schema。
- 不实现 `billing_mode` 徽章/筛选器（Q02）。
- 不实现 Codex 5小时/周额度（R02）。
- 不改 parser 或 adapter registry。
- 不修 unrelated dashboard localization tests，除非本任务新增断言导致失败。

## 建议分支

`claude/te-next-p03-spend-trend-chart`

## 完成后回复必须包含

- 分支名
- commit SHA（如果未提交，明确说明未提交）
- 修改文件列表
- 图表位置和交互说明
- 测试命令和结果
- 是否存在阻塞或无关失败
