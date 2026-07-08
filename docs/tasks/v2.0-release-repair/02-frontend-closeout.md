# 02 - 前端交互与视觉闭环修复

## 中文简述

本工单必须在 01 通过后，由同一个主线 subagent 继续执行。目标是把 01 的真实数据契约接入 UI，修复假分页、错误的 0 值、趋势图右侧空白、项目路径不可用、环境状态失真和 API 计费来源不清等问题。

## 第一性原理执行规则

- UI 只能展示 01 已证明的数据，不得在前端重新推断或伪造。
- 按钮必须产生用户可观察的动作；测试不能只证明按钮存在。
- 未知、未定价、未连接、部分数据必须使用不同状态。
- 响应式图表必须测量真实容器宽度，不能依赖固定 fallback 通过截图。
- 所有用户可见文案进入 `dashboard/src/content/copy.csv`。
- 只修复本轮验收范围，不顺手重构其他页面。

## 前置门槛

- 01 的请求日志 Hook 已返回服务端分页元数据。
- 01 的项目路径、成本 availability、API 计费和环境检测契约已有测试。
- 01 的审查记录最终结论为“通过”。任一条件不满足，不得开始 02。

## 缺漏证据

### 1. 页码按钮没有连接服务端分页

- `RequestUsageLog` 只对 `sortedRecords` 本地 `slice()`：`dashboard/src/ui/dashboard/components/RequestUsageLog.jsx:205`。
- 页码输入框直接绑定 `currentPage`，输入时立即切页；“跳转”按钮只是再次设置同一状态：`RequestUsageLog.jsx:487`。
- 测试通过构造 60 条前端假记录验证分页，没有证明后端第 2 页能被读取。

### 2. 趋势图固定 640px

- 组件加载阶段返回 `StateCard`，真实 `containerRef` 尚未挂载：`UsageTrendChart.jsx:403`。
- `ResizeObserver` effect 只执行一次，首次 `ref` 为空后不会重新绑定：`UsageTrendChart.jsx:261`。
- 实测 SVG 宽 640px、内容容器宽约 942px，右侧留下约 302px 空白。

### 3. 顶部指标把未知值显示为 0

- `safeNum(null)` 将未知请求数和成本转换成 0：`UsageStatsPanel.jsx:115`。
- UI 没有消费 `pricing_coverage` 和 `metric_availability`。

### 4. 项目、计费和环境状态未完成用户闭环

- 实测项目卡没有真实路径可操作。
- API 计费卡无法说明金额是平台账单、usage 估算还是不可用。
- 环境卡显示 `ready` 时可能没有当前版本，也没有最新版本可用性说明。

## 修复范围

- `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`
- `dashboard/src/ui/dashboard/components/UsageTrendChart.jsx`
- `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`
- `dashboard/src/ui/dashboard/components/ProjectUsagePanel.jsx`
- `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`
- `dashboard/src/components/settings/DataDirectoriesSection.jsx`
- `dashboard/src/pages/SpendPage.jsx`
- `dashboard/src/content/copy.csv`
- 对应组件测试、页面测试和真实浏览器 E2E

## 任务 1：接入真正的请求日志分页

1. `currentPage` 改变时调用 01 的 Hook 获取对应服务端页，不再对当前页记录做二次分页。
2. 总记录数和总页数来自服务端 `total/totalPages`。
3. 页码按钮、上一页、下一页、首尾页、`...` 都必须触发服务端页请求。
4. 页码输入使用独立 `pageDraft`；输入不会立即切页，点击“跳转”或按 Enter 后才提交并钳制到合法页。
5. 来源、模型、时间范围或排序改变时回到第 1 页并重新请求。
6. 使用稳定唯一 row key；消除运行测试中的重复 key 警告。
7. 新增集成测试：模拟后端 `total=60` 且每次只返回 10 条，点击第 2 页后断言 API 收到 `page=2&pageSize=10` 并展示第 11-20 条。

## 任务 2：修复顶部指标真实性

1. `request_count=null` 显示 `—` 和“仅有聚合数据”说明，不显示 0。
2. `pricing_coverage=unpriced` 显示“未定价”，不显示绿色 `$0`。
3. `partial` 同时显示已知成本和未定价 Token 提示。
4. 真实零成本只能在 coverage 证明已完整定价且金额为 0 时显示 `$0`。
5. 测试覆盖 `priced/partial/unpriced/aggregate_only` 四种状态。

## 任务 3：让趋势图完整占满容器

1. 修复 `ResizeObserver` 生命周期，确保从 loading/error/empty 切换到有数据状态后开始观察真实容器。
2. SVG 使用测得宽度并限制 `max-width: 100%`，窗口缩放后重新计算坐标。
3. 浏览器测试在 1440px 视口断言 `svg.width / chartContainer.contentWidth >= 0.95`。
4. 在 900px 和移动宽度检查无横向溢出、右轴不截断、tooltip 不越界。
5. 保留双轴、图例和 tooltip，不通过隐藏右轴来消除空白。

## 任务 4：完成项目路径、API 计费和环境状态 UI

1. 项目卡展示真实路径、Token、成本可用性、请求数可用性和最近活动时间。
2. 有真实路径时保留复制操作；桌面 bridge 已有安全打开目录能力时增加打开操作，否则不新增不可靠 bridge。
3. 无路径时显示“历史数据未记录项目路径”或等价文案，不生成虚假链接。
4. API 计费卡明确展示 `平台账单 / 使用量估算 / 未连接`，金额不可用时显示 `—`。
5. Token 套餐、API 计费、订阅记录保持三个独立区块；新增订阅记录不得出现在 API 计费区块。
6. 环境卡只有在 01 返回真实 ready 时显示“已就绪”；同时展示环境、当前版本、最新版本或“无法获取”。
7. `not-detected`、命令超时、WSL 未启动、版本不可获取均有明确中文状态。

## 任务 5：修复校验与回归测试

1. 删除仍要求热力图和 GitHub stars 的过时测试，替换为当前需求断言；不得简单跳过。
2. 修复 `validate:ui-hardcode` 报告的 RequestUsageLog raw text 增量。
3. 修复本轮文件引入的重复 key、`act()` 和控制台 warning。
4. 确保页面仍只有 `使用统计 / 成本累积`，且成本累积仍包含 Token 套餐、API 计费、订阅记录。
5. 概览页主路径不得重新出现热力图。

## 验收标准

- 后端有 5000 条记录时，UI 显示总数 5000、总页数 500，能够进入第 2 页并看到不同记录。
- 输入页码不会立即切页；点击跳转按钮后才切页，且按钮不是死按钮。
- 请求数未知时显示 `—`，未定价成本显示“未定价”，不能显示成真实 0。
- 1440px 下趋势图 SVG 至少占图表内容宽度的 95%，右侧无大块空白。
- 900px 和移动宽度无横向溢出、右轴截断或 tooltip 越界。
- 当前仓库真实路径在项目卡可见并可复制；历史未知路径有明确说明。
- 添加订阅记录不会在 API 计费区块出现同金额账户。
- 环境 `ready` 必须同时显示当前版本；目录存在但 Agent 不可执行时显示未检测到。
- 页面没有 `新增订阅记录`，没有热力图，没有 GitHub stars 项目指标。
- 目标测试、类型检查、目标 ESLint、copy 校验、UI hardcode 校验和 Dashboard build 全部退出 0。

## 验证命令

```powershell
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx src/ui/dashboard/components/__tests__/ProjectUsagePanel.test.jsx src/components/settings/DataDirectoriesSection.env.test.jsx src/pages/SpendPage.test.jsx --reporter=verbose
Push-Location dashboard
npx eslint "src/pages/SpendPage.jsx" "src/ui/dashboard/components/RequestUsageLog.jsx" "src/ui/dashboard/components/UsageTrendChart.jsx" "src/ui/dashboard/components/UsageStatsPanel.jsx" "src/ui/dashboard/components/ProjectUsagePanel.jsx" "src/ui/dashboard/components/CostAccumulation.jsx" "src/components/settings/DataDirectoriesSection.jsx"
npm run typecheck
Pop-Location
npm run validate:copy
npm run validate:ui-hardcode
npm --prefix dashboard run build
```

必须额外运行真实本地服务和 Playwright E2E，记录以下脱敏证据：后端总记录数、UI 总记录数、点击第 2 页后的首条记录 ID 哈希、SVG/容器宽度比、项目总数与带路径项目数、浏览器 console error/warning 数量。不得记录真实路径全文、密钥、Cookie 或 Token。

## 审查记录模板

```text
审查轮次：
反方问题：
失败证据：
涉及文件：
修复动作：
复查命令：
真实 E2E 证据：
复查结果：
剩余风险：
最终结论：通过 / 打回
```

工单执行完成的最后增加一个审查环节，以对抗性审查的方式回写审查记录，如果出现问题就修复，修复执行完的环节依旧是对抗性审查，直到都完成了才能结束，并汇报给我工单的完成情况
