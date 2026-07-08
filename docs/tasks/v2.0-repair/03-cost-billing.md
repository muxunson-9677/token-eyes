# 03 - API 计费与成本累积修复

## 中文简述
本工单修复 `支出 > 成本累积`。当前 UI 有 API 计费区块，但数据只是从支出记录派生；独立的 `api-billing.js` 没有接入 local API，也没有被前端 hook 使用。支出页测试还存在超时和旧订阅表单断言。

## 第一性原理
- 用户要解决的问题：知道自己在哪个平台充值的账户花了多少钱，并和 Token 套餐、订阅记录一起看成本累积。
- 数据来源：订阅/支出记录、Token 套餐记录、API 计费检测模块、可用本地凭据或配置。
- 用户点击后发生什么：进入 `支出 > 成本累积`，看到 Token 套餐、API 计费、订阅记录；新增订阅记录已归属成本累积语义。
- 不做的事：不把 API 计费伪装成真实平台账单；如果只能检测凭据存在，必须显示“未连接/未检测到费用”。

## 缺漏证据
- `api-billing.js` 有采集函数但未被路由接入：[api-billing.js](<D:/04-AI-Project/010-Token eye/src/lib/api-billing.js>):270。
- local API 搜索不到 API 计费 endpoint 接入，只看到 token plan 和 agent environment 路由：[local-api.js](<D:/04-AI-Project/010-Token eye/src/lib/local-api.js>):4433。
- 前端 hook 直接从 spend records 派生 API 账户：[use-cost-accumulation.js](<D:/04-AI-Project/010-Token eye/dashboard/src/hooks/use-cost-accumulation.js>):64。
- `SpendPage.test.jsx` 运行超时，且保留旧订阅表单断言：[SpendPage.test.jsx](<D:/04-AI-Project/010-Token eye/dashboard/src/pages/SpendPage.test.jsx>):155。

## 修复范围
- 修改 `src/lib/api-billing.js`。
- 修改 `src/lib/local-api.js`，新增或接入 API 计费读取 endpoint。
- 修改 `dashboard/src/lib/api.ts`，增加 API 计费读取函数。
- 修改 `dashboard/src/hooks/use-cost-accumulation.js`，使用 API 计费 endpoint，而不是只从 spend records 派生。
- 修改 `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`。
- 修改 `dashboard/src/pages/SpendPage.test.jsx`，移除旧订阅表单路径，覆盖成本累积 Tab。
- 必要时补充 `dashboard/src/content/copy.csv`。

## 执行步骤
1. 写后端测试：构造 spend records 和本地凭据检测输入，断言 API 计费账户返回 provider、accountName、billingSource、monthCostUsd、lifetimeCostUsd、status、lastSyncedAt。
2. 接入 local API endpoint，例如 `/functions/tokentracker-api-billing-accounts`。
3. 写 dashboard API 测试或 hook 测试，断言 `useCostAccumulation` 会调用 API 计费接口。
4. 更新 `use-cost-accumulation.js`：Token 套餐、API 计费、订阅记录分别来自明确数据源。
5. 更新成本累积 UI：API 计费区分“已同步/未连接/同步错误”，费用为 0 时不能误导用户。
6. 修复 `SpendPage.test.jsx`：聚焦 `使用统计` 和 `成本累积` 两个 Tab，不再测试已迁移的旧新增订阅表单位置。
7. 确认 `新增订阅记录` 文案不再作为功能名出现，统一为 `订阅记录`。

## 验收标准
- `src/lib/api-billing.js` 被实际调用，不是孤立文件。
- local API 有可测试的 API 计费读取入口。
- `CostAccumulation` 的 API 计费数据来自 API 计费入口。
- 成本累积包含 Token 套餐、API 计费、订阅记录三块。
- `SpendPage.test.jsx` 不超时，并覆盖 Tab 切换和成本累积内容。
- 页面不把“检测到凭据”误报成“已花费金额”，除非有支出/账单数据支撑。

## 验证命令
```powershell
node --test test/spend-records-api.test.js test/spend-timeseries-api.test.js test/token-plans-api.test.js
npm --prefix dashboard run test -- src/pages/SpendPage.test.jsx --reporter=verbose
Push-Location dashboard
npx eslint "src/pages/SpendPage.jsx" "src/hooks/use-cost-accumulation.js" "src/ui/dashboard/components/CostAccumulation.jsx"
Pop-Location
npm --prefix dashboard run build
```

如新增后端测试文件，必须把该文件加入第一条 `node --test` 命令一起运行。

## 上下文建议
单独上下文执行。它跨后端、本地 API、前端 hook 和支出页测试，和 `01/02` 并行时不要共用同一上下文。

## 审查记录模板
```text
审查轮次：
反方问题：
涉及文件：
修复动作：
复查命令：
复查结果：
最终结论：
```

工单执行完成的最后增加一个审查环节，以对抗性审查的方式回写审查记录，如果出现问题就修复，修复执行完的环节依旧是对抗性审查，直到都完成了才能结束，并汇报给我工单的完成情况。

---

## 审查记录

### 第 1 轮

**反方问题：**
1. costSummary 的 fallback 计算使用未过滤的 spendRecords，当 sources 不为空时可能包含不在可见列表中的 provider 数据
2. subscriptionRecords 和 costSummary 各自独立过滤 spendRecords，存在重复计算和不一致风险

**涉及文件：**
- `dashboard/src/hooks/use-cost-accumulation.js`

**修复动作：**
1. 新增 `filteredSpendRecords` 统一过滤层，按 sources 过滤支出记录
2. `costSummary` 的 fallback 计算改为使用 `filteredSpendRecords`
3. `subscriptionRecords` 改为直接基于 `filteredSpendRecords` 映射，避免重复过滤

**复查命令：**
```powershell
npm --prefix dashboard run test -- src/pages/SpendPage.test.jsx
```

**复查结果：**
23 个测试全部通过，无失败。

**最终结论：**
通过。修复后代码结构更清晰，过滤逻辑统一，避免了数据不一致风险。
