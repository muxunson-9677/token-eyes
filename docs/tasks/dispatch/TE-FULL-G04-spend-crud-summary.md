# TE-FULL-G04 - 完整花销模块 CRUD 与汇总实现

## 给 Claude Code 的执行说明

你负责实现 full plan 的 `G04`。本工单只做花销模块的完整订阅记录 CRUD、月度/累计汇总、API 成本 + 订阅成本合计、按 Agent/平台拆分、USD/CNY 双币种展示。不要改 Token Plan 自动刷新、pricing rules、汇率设置、云同步、Leaderboard、Skills 或其它模块。

## 基准与分支

必须基于已审核的 D07 返工结果:

- 基准分支: `claude/te-full-d07-configurable-usd-cny-rate`
- 基准 commit: `c2c360b`
- 新建分支: `claude/te-full-g04-spend-crud-summary`

开始前:

```bash
git fetch origin
git switch -c claude/te-full-g04-spend-crud-summary origin/claude/te-full-d07-configurable-usd-cny-rate
git rev-parse --short HEAD
```

`rev-parse` 必须为 `c2c360b` 或它之后明确包含 D07 的提交。

## 当前基础

当前已有:

- 后端 `src/lib/local-api.js`
  - `/functions/tokentracker-spend-records`
  - `source/plan_label/amount/currency/note/created_at`
  - create/list/delete
  - `currencySettings.usdToCny` 汇总
- 前端 `dashboard/src/pages/SpendPage.jsx`
  - 简化新增表单
  - 列表展示
  - USD/CNY 总额卡片
- API 客户端 `dashboard/src/lib/api.ts`
  - `getSpendRecords`
  - `createSpendRecord`
  - `deleteSpendRecord`

G04 要在这些文件上增量扩展，不要另起一套 API 或页面。

## 数据结构

`subscription_records` 存在本地 `config.json` 的 `spendRecords` 数组中，字段统一为:

```json
{
  "id": "uuid",
  "source": "claude",
  "plan_label": "Max",
  "amount": 20,
  "currency": "USD",
  "billing_cycle": "monthly",
  "start_date": "2026-06-01",
  "end_date": "",
  "note": "",
  "created_at": "2026-06-21T00:00:00.000Z",
  "updated_at": "2026-06-21T00:00:00.000Z"
}
```

规则:

- `currency`: 只允许 `USD` / `CNY`,其它回退 `USD`。
- `billing_cycle`: 只允许 `monthly` / `yearly` / `one_time`,其它回退 `monthly`。
- `amount`: 非有限数、负数、0 归一化为 0; 创建/更新时 amount 必须 > 0。
- `source` 和 `plan_label` 必填。
- `start_date`: `YYYY-MM-DD`,缺失时回退今天。
- `end_date`: `YYYY-MM-DD` 或空字符串; 空表示仍有效。
- `updated_at` 在每次更新时刷新。

## 汇总口径

全部金额内部以 USD 为主,展示时同时给 USD 和 CNY。汇率必须使用 D07 的 `currencySettings.usdToCny`,不要重新写死 7.2。

### 订阅记录换算

先把记录金额转换为 USD:

```text
amount_usd = currency == "CNY" ? amount / usdToCny : amount
```

然后按周期计算:

- `monthly`: 每个与记录有效期重叠的自然月计 `amount_usd`。
- `yearly`: 每个与记录有效期重叠的自然月计 `amount_usd / 12`。
- `one_time`: 仅当 `start_date` 落在统计区间内时计 `amount_usd`。

有效期:

- 起点为 `start_date` 所在自然日。
- 终点为 `end_date` 所在自然日; `end_date=""` 表示持续到统计区间结束。
- 月度判断以自然月为单位,只要该月与有效期有交集,就计入该月。

### API 成本

API 成本来自现有 queue rows 的 `computeRowCost`/`pricingRules` 计算结果,不能从 Spend 记录里重复生成。沿用 `aggregateByDay(rows, timeZoneContext, getPricingOptions())` 的口径。

### 返回结构

扩展 `/functions/tokentracker-spend-records` 的 `GET` 返回:

```json
{
  "records": [],
  "totals": {
    "subscription_usd": 0,
    "subscription_cny": 0,
    "api_usd": 0,
    "api_cny": 0,
    "combined_usd": 0,
    "combined_cny": 0,
    "lifetime_subscription_usd": 0,
    "lifetime_subscription_cny": 0,
    "lifetime_api_usd": 0,
    "lifetime_api_cny": 0,
    "lifetime_combined_usd": 0,
    "lifetime_combined_cny": 0
  },
  "by_source": [
    {
      "source": "claude",
      "subscription_usd": 0,
      "subscription_cny": 0,
      "api_usd": 0,
      "api_cny": 0,
      "combined_usd": 0,
      "combined_cny": 0
    }
  ]
}
```

兼容性:

- 为避免打断现有 MVP 测试,可以继续保留旧字段 `total_usd` / `total_cny`,但其含义必须等于当前统计区间的 `combined_usd` / `combined_cny`。
- `GET` 支持可选查询参数:
  - `from=YYYY-MM-DD`
  - `to=YYYY-MM-DD`
  - `tz` / `tz_offset_minutes` 沿用 usage summary 口径
- 若未传 `from/to`,默认当前自然月。

## API 行为

扩展当前 `/functions/tokentracker-spend-records`:

- `GET`: 返回记录、当前区间汇总、累计汇总、按 source 拆分。
- `POST`: 创建记录。
- `PUT`: 更新已有记录,body 必须带 `id`。
- `DELETE`: 删除记录,body 必须带 `id`。

不要新增云端 Edge Function。G04 只做本地 Token Eyes full plan 能力。

## 前端要求

修改 `dashboard/src/pages/SpendPage.jsx`:

- 表单支持:
  - source
  - plan_label
  - amount
  - currency
  - billing_cycle
  - start_date
  - end_date
  - note
- 列表支持编辑、保存、取消、删除。
- 页面顶部展示:
  - 本月 API 成本
  - 本月订阅成本
  - 本月总成本
  - 累计总成本
- 每个金额都显示 USD 和 CNY。
- 展示按 source 拆分的成本行,至少包含 subscription/api/combined。
- 所有文案走 `dashboard/src/content/copy.csv`。

保持 UI 密度和现有 Settings/Spend 风格一致。不要做营销页、不要做大 hero、不要引入新的设计系统。

## 禁止范围

- 不改 D07 的汇率设置入口。
- 不改 D04 的 pricing rules UI 或规则归一化。
- 不做真实支付/账单抓取。
- 不做云同步。
- 不做 Token Plan 自动刷新。
- 不引入外部汇率 API。
- 不把 prompt、消息内容或会话正文写入任何花销记录。

## 测试要求

后端至少覆盖:

1. `POST/GET/PUT/DELETE` 完整 CRUD。
2. `billing_cycle=monthly/yearly/one_time` 的本月汇总。
3. 累计汇总。
4. CNY 记录按 D07 `currencySettings.usdToCny` 换算。
5. API 成本 + 订阅成本合计。
6. 按 source 拆分。
7. 旧字段 `total_usd/total_cny` 兼容。

前端至少覆盖:

1. 加载 records/totals/by_source。
2. 新增记录。
3. 编辑并保存记录。
4. 删除记录。
5. 展示本月 API/订阅/总成本、累计总成本、按 source 拆分。

## 必跑验证

```bash
node --test test/spend-records-api.test.js test/pricing.test.js test/local-settings-api.test.js
npm --prefix dashboard run test -- SpendPage.test.jsx currency.test.ts
npm --prefix dashboard run typecheck
npm run dashboard:build
npm run validate:copy
npm run validate:guardrails
```

## 报告

新增:

```text
docs/test-reports/full-plan/15-spend-crud-summary.md
```

报告必须包含:

- 分支和最终 commit SHA。
- 改动文件列表。
- 订阅记录字段结构。
- 汇总公式说明。
- API 成本、订阅成本、combined 成本的测试证据。
- 所有验证命令结果。
- 是否有阻塞问题。

## 交付

提交并推送:

```bash
git status --short
git add src/lib/local-api.js dashboard/src/lib/api.ts dashboard/src/pages/SpendPage.jsx dashboard/src/pages/SpendPage.test.jsx dashboard/src/content/copy.csv test/spend-records-api.test.js docs/test-reports/full-plan/15-spend-crud-summary.md
git commit -m "feat: add full spend crud summary"
git push origin claude/te-full-g04-spend-crud-summary
```

如果必须修改其它文件,报告里说明原因。返回时只给摘要、commit SHA、验证结果和报告路径。
