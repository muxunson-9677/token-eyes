# 支出使用统计缺陷修复长任务设计

> 日期：2026-06-29
> 状态：三工单拆分已确认，实施工单已生成

## 目标

把当前支出使用统计验收中暴露的问题收敛为三个按顺序执行的长任务，使 Token Eyes 在本地未登录模式下具备真实、可筛选、可刷新的使用统计，并让支出页严格服从设置页“限制显示”的 Provider 可见性配置。

三个任务必须覆盖：

1. 本地模式永久加载、来源/模型筛选无效、刷新覆盖不完整、请求日志局部筛选汇总错误，以及 Tauri 复用旧版后端。
2. 聚合桶伪装请求、虚构状态/延迟/成功率、请求数语义不实，以及汇总成本与请求成本不一致。
3. “限制显示”与支出页全部 Provider 级区域联动、Agent 图标数量与顺序联动、“全部”按钮折叠/展开，以及真实本地模式端到端验收。

## 工单拆分与执行顺序

### 工单 5：本地数据链路、筛选状态与统一刷新修复

该工单恢复功能可用性，解决所有会让页面无法加载或控件不生效的 P0/P1 缺陷。

主要职责：

- 新增的 usage summary、trend、filter options、request records、Provider stats、model stats hooks 必须识别本地模式。本地 API 不要求云端 access token；云端模式继续执行现有鉴权。
- 无论鉴权、接口失败还是空数据，hook 都必须结束 loading，禁止永久显示“加载中”。
- 重做筛选 reducer 的目标选择与级联边界：
  - 用户从“全部”选择具体来源时，`sources` 必须替换为实际选择。
  - 用户从“全部”选择具体模型时，`models` 必须替换为实际选择。
  - Agent 变化清空来源和模型；来源变化清空模型。
  - 来源/模型反向补充上级范围时，不得把目标选择本身吞掉。
- 顶部手动刷新和 `30s / 1m / 5m` 自动刷新必须覆盖汇总、趋势、请求日志、Provider 统计、模型统计、筛选候选项和旧 Spend 记录。`manual` 不注册定时器。
- 请求日志内部来源下拉变化时，记录和 totals 必须使用同一数据范围；不得显示“单来源记录 + 全来源 totals”。
- 本地 API 提供明确的版本或 capability 握手。Tauri 只能复用满足当前最低 capability 的服务；旧服务必须被拒绝并在空闲端口启动当前版本。
- 保留自定义日期面板现有行为，并为日期变化触发全部统计刷新增加回归测试。

允许的实现原则：

- 优先复用现有 `isLocalMode` 判断和 local API URL 解析，不创建第二套本地模式探测。
- 刷新可以通过一个共享 revision/invalidation 信号驱动各数据 hook；不得为每个组件再建立独立定时器。
- 不在该工单修改日志解析、价格表或 Provider 可见性产品规则。

主要文件范围：

- `dashboard/src/hooks/use-usage-filters.tsx`
- `dashboard/src/hooks/use-usage-summary.ts`
- `dashboard/src/hooks/use-usage-trend.ts`
- `dashboard/src/hooks/use-usage-filter-options.ts`
- `dashboard/src/hooks/use-request-usage-records.ts`
- `dashboard/src/hooks/use-provider-stats.ts`
- `dashboard/src/hooks/use-model-stats.ts`
- `dashboard/src/pages/SpendPage.jsx`
- `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`
- `dashboard/src/lib/local-api-url.ts`
- `src/lib/local-api.js`
- `src-tauri/src/commands.rs`

完成标志：真实本地未登录页面不再永久 loading；来源、模型和日期筛选实际改变所有统计请求；一次刷新能更新全部区域；旧本地服务不会被新版 Tauri 静默复用。

### 工单 6：请求明细真实性、指标可用性与成本口径修复

该工单只处理数据真实性和跨视图口径，不继续扩展 UI 布局。

主要职责：

- `/functions/tokentracker-request-usage-records` 只能把真实 request-level usage 事件作为请求记录。
- 禁止把 queue 半小时聚合行伪装成请求。仅有聚合数据的来源返回空请求列表和明确 capability/availability 信息；如产品需要展示聚合数据，必须使用“聚合用量”语义，不能出现在“请求日志”中。
- 原始数据没有 HTTP status、总延迟或首字延迟时，接口返回 `null`，UI 显示 `—`。不得默认填 `200`、`0ms` 或据此计算 `100%` 成功率。
- Provider/模型统计中的请求数、成功率和平均延迟必须携带明确语义：
  - 有真实 request-level 数据时显示真实值。
  - 只有 conversation/session/aggregate 数据时，不得改名为请求或伪造成功率；不可用指标显示 `—`。
- 调查并修复当前真实数据中“30 天汇总 7.68 亿 Tokens、成本 `$0`，同时 Codex 请求记录存在非零成本”的差异。所有成本路径必须调用同一价格计算入口，并增加合成 fixture 证明 summary、trend、Provider、model 与 request records 在相同原始 usage 下可对账。
- 对未定价模型不得把 `$0` 当作已知零成本。响应应提供未定价 token/record 数或 pricing coverage，UI 显示“未定价”或“部分定价”。
- 请求日志本地来源筛选后，totals 必须严格等于当前筛选范围内记录的汇总；分页/limit 的 totals 语义必须在响应字段中固定并由测试验证。
- 保持隐私边界：不得读取、保存或返回 prompt、message、content、encrypted content、tool result 正文。

主要文件范围：

- `src/lib/local-api.js`
- `src/lib/rollout.js`
- `src/lib/pricing/index.js`（仅在确认公共价格入口存在缺陷时修改）
- `dashboard/src/lib/api.ts`
- `dashboard/src/lib/types/usage.ts`
- `dashboard/src/hooks/use-request-usage-records.ts`
- `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`
- `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`
- `dashboard/src/ui/dashboard/components/ProviderUsageTable.jsx`
- `dashboard/src/ui/dashboard/components/ModelUsageTable.jsx`
- 对应 Node 与 Vitest 测试

完成标志：界面不再展示任何推断的请求、状态、延迟或成功率；已定价数据跨视图成本一致；未定价数据被明确标识；请求 totals 与其声明的数据范围一致。

### 工单 7：Provider 可见性、Agent 折叠交互与最终集成验收

该工单在前两张工单通过后执行，负责用户可见行为和最终验收，不重新设计后端口径。

#### Provider 可见性

`useLimitsDisplayPrefs().visibleOrdered` 是支出页唯一的 Provider 展示范围和顺序来源：

- 设置页“限制显示”启用几个 Provider，支出页 Agent 图标只展示这几个，并保持设置顺序。
- 同一可见集合应用于使用趋势、全部来源候选项、全部模型候选项、请求日志来源、Provider 统计、模型统计和按来源拆分。
- “全部 Agent / 全部来源 / 全部模型”表示当前已启用 Provider 集合内的全部，不表示绕过设置显示隐藏项。
- 隐藏只影响展示和筛选候选范围，不停止底层采集，也不删除历史数据。
- 已启用但没有数据的 Provider：Provider 级趋势/统计可显示零或空态；模型和请求日志不得生成虚构记录。
- 当前选中的 Agent、来源或模型被设置页关闭时，安全回退到当前可见集合的“全部”，不得保留不可见筛选造成空白页。

#### “全部”按钮折叠行为

蓝框中的网格按钮同时承担“全部 Agent”和折叠控制：

- Agent 图标展开且当前为全部时，点击网格按钮：保持 `agentIds = null` 并折叠所有 Agent 图标，只保留网格按钮。
- 当前选中单个 Agent 时，点击网格按钮：先切回 `agentIds = null`，同时折叠 Agent 图标。
- 折叠状态再次点击网格按钮：展开设置页当前启用的 Agent 图标，筛选范围仍为全部。
- 点击任一 Agent 图标：只展示该 Agent 数据。
- 折叠状态是页面级临时 UI 状态，不新增持久化配置；刷新页面后默认展开。
- 按钮必须提供可访问名称、`aria-expanded` 和当前筛选的 `aria-pressed` 语义。

#### 布局与最终验收

- 1200×800 Tauri 默认窗口和 900px 最小宽度下不得出现页面级横向滚动。
- Agent 区只渲染已启用项；图标缺失时使用项目既有 Provider fallback，不能显示旋转 loading 占位。
- 保持自定义日期面板、趋势图五维度、详情三个 Tab 的现有有效功能。
- 消除 React duplicate key、未包裹异步更新等新增测试警告。
- 增加真实本地模式端到端验收，不允许只用 `?mock=1`：
  - 启动当前版本本地 API 和 Tauri/本地 Dashboard。
  - 验证未登录状态下统计完成加载。
  - 验证来源、模型、日期和 Agent 切换改变数据请求。
  - 验证限制显示立即同步所有 Provider 级区域。
  - 验证网格按钮“切回全部并折叠 → 再次展开”。
  - 验证手动刷新与一个短周期自动刷新更新全部区域。
  - 检查浏览器/WebView 控制台无错误和 React warning。

主要文件范围：

- `dashboard/src/hooks/use-limits-display-prefs.js`
- `dashboard/src/lib/limits-providers.js`
- `dashboard/src/lib/spend-provider-visibility.js`
- `dashboard/src/ui/dashboard/components/AgentSwitcher.jsx`
- `dashboard/src/ui/dashboard/components/UsageFilterBar.jsx`
- `dashboard/src/ui/dashboard/components/SourceFilter.jsx`
- `dashboard/src/ui/dashboard/components/ModelFilter.jsx`
- `dashboard/src/pages/SpendPage.jsx`
- `dashboard/src/pages/SpendPage.test.jsx`
- 各组件测试与 Playwright 验收脚本/报告

完成标志：设置页与支出页可见 Provider 完全一致；Agent 折叠交互符合上述状态机；默认窗口不溢出；六项原始需求在真实本地模式中通过人工和自动验收。

## 数据流约定

```text
本地日志/usage queue
  → rollout/queue 规范化与价格计算
  → local API（明确真实请求、聚合数据和指标 availability）
  → usage data hooks（本地模式不要求云 token）
  → 全局筛选 + 限制显示的可见集合
  → 汇总 / 趋势 / 请求日志 / Provider / 模型视图
```

筛选决定数据范围；“限制显示”决定用户可见的 Provider 范围。两者不能通过两套互相漂移的状态实现。底层 API 保留所有已采集来源，前端把当前可见 Provider 集合作为筛选上限。

## 错误与空态

- 未登录本地模式：正常读取本地 API，不显示鉴权错误。
- API 失败：结束 loading，保留可用缓存或显示带重试按钮的错误态。
- Provider 不支持请求级明细：显示“该来源暂无请求级明细”，不得生成聚合伪记录。
- 指标不可用：显示 `—`，不得显示 `0ms`、`100%` 或绿色 `200`。
- 模型未定价：显示“未定价/部分定价”，不得显示为已确认的 `$0`。
- 全部 Provider 被关闭：Agent 区只保留网格按钮，其余 Provider 级区域显示明确空态，不发起逐 Provider 请求风暴。

## 测试与验收总门槛

每张工单必须先写失败测试，再做最小实现。三张工单全部完成后至少执行：

```powershell
npm test
npm --prefix dashboard run test
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npx tauri build --no-bundle
```

最终报告必须同时提供：

- 定向测试和全量测试结果；
- 真实本地未登录模式的 Playwright/Tauri 验收证据；
- 六项需求逐条通过表；
- summary、trend、Provider、model、request records 的成本与 Token 对账结果；
- 未支持指标和未定价模型的显式说明；
- 未读取或输出任何正文数据的隐私确认。

## 调度边界

- 执行顺序固定为：工单 5 → 工单 6 → 工单 7。
- 三张工单会共享 `SpendPage.jsx`、usage hooks 和请求日志组件，不得在同一工作区并行执行。
- 每张工单使用新的 subagent；主上下文在放行下一张前必须直接读取改动、复跑工单验收命令并检查真实窗口。
- 不得依赖 subagent 的完成摘要作为通过证据。
