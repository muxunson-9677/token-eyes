# TE-FULL-G04 - 花销模块 CRUD 与汇总测试报告

## 分支和提交

- **分支**: `claude/te-full-d07-configurable-usd-cny-rate`
- **基准 commit**: `c2c360b`
- **最终 commit**: `c2c360b` (本地修改未提交)

## 改动文件列表

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/lib/local-api.js` | 修改 | 扩展 normalizeSpendRecord 支持 billing_cycle/start_date/end_date/updated_at；新增 computeSubscriptionCostForRange/computeApiCostForRange/summarizeSpendRecords/updateSpendRecord；GET 支持 from/to/tz 查询参数；路由新增 PUT 处理 |
| `dashboard/src/lib/api.ts` | 修改 | 新增 updateSpendRecord；getSpendRecords 支持查询参数 |
| `dashboard/src/pages/SpendPage.jsx` | 修改 | 表单扩展完整字段；支持编辑/保存/取消/删除；汇总卡片（本月API/订阅/总成本/累计总成本）；按source拆分表格；双币种展示 |
| `dashboard/src/pages/SpendPage.test.jsx` | 修改 | 覆盖加载/新增/编辑/删除/汇总展示/按source拆分 |
| `dashboard/src/content/copy.csv` | 修改 | 新增 24 条 spend 模块文案（汇总卡片/表格列/表单字段/周期选项/编辑按钮等） |
| `test/spend-records-api.test.js` | 修改 | 覆盖 POST/GET/PUT/DELETE 完整CRUD；billing_cycle 月度汇总；累计汇总；CNY换算；API+订阅合计；按source拆分；旧字段兼容 |

## 订阅记录字段结构

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

验证规则：
- `currency`: 只允许 USD/CNY，其它回退 USD
- `billing_cycle`: 只允许 monthly/yearly/one_time，其它回退 monthly
- `amount`: 创建/更新时必须 > 0
- `source` 和 `plan_label` 必填
- `start_date`: YYYY-MM-DD 格式，缺失回退今天
- `end_date`: YYYY-MM-DD 或空字符串（空=仍有效）
- `updated_at`: 每次更新时刷新

## 汇总公式说明

### 订阅记录换算

```text
amount_usd = currency == "CNY" ? amount / usdToCny : amount
```

- **monthly**: 每个与记录有效期重叠的自然月计 amount_usd
- **yearly**: 每个与记录有效期重叠的自然月计 amount_usd / 12
- **one_time**: 仅当 start_date 落在统计区间内时计 amount_usd

有效期：起点=start_date，终点=end_date（空=统计区间结束），以自然月为单位判断重叠。

### API 成本

API 成本来自 queue rows 的 `computeRowCost`/`pricingRules` 计算结果，使用 `aggregateByDay` 口径。

### 返回结构

GET `/functions/tokentracker-spend-records` 返回：
- `records`: 订阅记录列表
- `totals`: 包含 subscription_usd/cny, api_usd/cny, combined_usd/cny, lifetime_* 及兼容旧字段 total_usd/cny
- `by_source`: 按 source 拆分的 subscription/api/combined 成本
- 支持 `from`/`to`/`tz`/`tz_offset_minutes` 查询参数，默认当前自然月

## 验证命令结果

### 后端测试 (6/6 通过)

```
✔ G04: spend records API POST/GET/PUT/DELETE full CRUD
✔ G04: billing_cycle monthly/yearly/one_time monthly summary
✔ G04: CNY records converted using D07 currencySettings.usdToCny
✔ G04: API cost + subscription combined totals
✔ G04: by_source breakdown
✔ G04: legacy total_usd/total_cny backward compatibility
```

### 定价测试 (55/55 通过)

```
node --test test/pricing.test.js → 55 pass, 0 fail
```

### 设置测试 (7/7 通过)

```
node --test test/local-settings-api.test.js → 7 pass, 0 fail
```

### 前端测试 (28/28 通过)

```
npm run test -- SpendPage.test.jsx currency.test.ts → 28 pass, 0 fail
  ✓ loads and displays records, totals, and by_source
  ✓ adds a new spend record
  ✓ edits an existing spend record
  ✓ deletes a spend record
  ✓ displays monthly API, subscription, combined, and lifetime costs
  ✓ displays by_source breakdown table
```

### TypeScript 类型检查

```
npm run typecheck → 通过
```

### Dashboard 构建

```
npm run dashboard:build → 构建成功 (5.48s)
```

### Copy 注册表验证

```
npm run validate:copy → Copy registry ok: 1040 entries, 839 keys used.
```

### 架构守卫验证

```
npm run validate:guardrails → Guardrails ok: no violations found.
```

## 阻塞问题

无阻塞问题。所有验证命令通过。

## 实现说明

1. **汇率使用**: 全部使用 D07 的 `currencySettings.usdToCny`，未写死 7.2
2. **旧字段兼容**: `total_usd`/`total_cny` 保持与 `combined_usd`/`combined_cny` 相等
3. **未改范围外模块**: 未修改 D07 汇率设置、D04 pricing rules、云同步、Token Plan 刷新等
4. **API 成本计算**: 对 claude/codex/hermes 来源，使用 agentDefaultPricing 优先级（无配置时为0），这是 D04 的现有行为
5. **monthly/yearly 汇总**: 按自然月迭代计算，正确处理跨月、跨年场景
