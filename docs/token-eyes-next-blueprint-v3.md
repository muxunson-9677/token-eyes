# Token Eyes 后续工作蓝图（完整修正版）

> 生成时间：2026-06-22
> 前提：Full Plan核心链路已完成并通过验收（详见`token-eyes-product-development-report-2026-06-22.md`）。
> 执行工单的Agent：**Claude Code**（不是Hermes）。
> 本文档是对照用户原始诉求7条逐项比对后，识别的6个实质性缺口 + 1个阻塞项的完整开发计划。
> 飞书所有权已转移完成，不在本文档范围内。

---

## 一、用户原始诉求7条 vs 当前实现完整对照

| 原始诉求 | 当前状态 | 缺口 |
|---|---|---|
| 1. 统一汇总所有Agent/模型Token | ✅ 已完成（Usage页，Win+WSL） | 无 |
| 2a. 按Agent/模型分类展示 | ✅ 已完成 | 无 |
| 2b. 区分计费方式：API Key vs Token Plan | ⚠️ 后端有billing_mode字段但UI层**没有显式标注/徽章** | **缺口GAP-2** |
| 3. Token Plan醒目展示套餐内容/订阅时间/剩余余量 | ✅ plan_label/expires_at/remaining_quota已完成 | 无 |
| 3续. **5小时额度/周额度**（Codex专属窗口机制） | ❌ 通用Token Plan字段无法表达滚动窗口概念 | **缺口GAP-3** |
| 4. 实时/准实时监测，能动态刷新用量 | ❌ 当前Dashboard无自动刷新间隔设置（CC Switch有30s刷新） | **缺口GAP-4** |
| 5. 预留扩展接口（RESTful API或本地文件标准化），后续接入OpenClaw等 | ❌ 没有标准化适配器规范文档，未来接入只能靠猜现有代码 | **缺口GAP-5** |
| 6a. 精准检测token（准确到具体字符） | ⚠️ 当前是小时级聚合，非请求级精度；是否已足够需要评估 | **缺口GAP-6（需评估）** |
| 6b. 缓存命中率 | ✅ 已完成（缓存命中率卡片） | 无 |
| 7a. 用户可自定义输入时间区间/平台/消费金额 | ✅ 订阅记录CRUD已完成 | 无 |
| 7b. API Key花销实时计费增加（用量刷新后成本随之更新） | ⚠️ 依赖GAP-4动态刷新，当前无法"实时增加" | 依赖GAP-4 |
| 7c. 花销可视化：不同平台不同折线，hover显示费用 | ❌ 当前只有卡片和表格，**没有折线趋势图** | **缺口GAP-1（最重要）** |
| 7d. 花销视图支持当天/周/月/综合累计 | ✅ 时间范围筛选已完成 | 无 |
| Win+WSL跨环境统一展示 | ✅ 已完成（Data Directories覆盖+WSL UNC路径） | 无 |
| C05: WebView2文件夹选择器验证 | V00已解除baseline阻塞；当前等待用户本机执行V01（Rust工具链 + Node.js + WebView2运行时，不需要.NET SDK） | **阻塞项BLK-1：待人工验证** |

---

## 二、执行总规则（Codex必读）

- 标注`[Codex设计]`：你自己做，输出规范/接口设计，不写实现代码，完成后告知用户确认。
- 标注`[→Claude Code执行]`：你写成工单`.md`，告知用户转交Claude Code执行。
- 标注`[用户本机操作]`：你告知用户具体步骤，不生成工单。
- 每次生成工单前先读飞书进度表，保证顺序没乱；每次审核完在飞书表更新状态。
- 设计任务（接口规范、数据结构）必须你自己完成，禁止直接丢给Claude Code自行猜测。

---

## 模块一：Spend花销可视化折线图（GAP-1）【最高优先级】

### 为什么最重要
用户原始诉求第7条明确写"不同平台有不同的计费折线，鼠标放置上可显示费用（参考cc switch使用统计可视化折线图）"。当前Spend页只有4张卡片和一个by-source表格，这是最直观的体验缺口，也是用户最容易感知到"差距在哪"的地方。CC Switch的使用趋势图（多条折线、不同颜色、hover tooltip显示详情）是对标参考。

### 任务

**[Codex设计]** P01 — Spend折线图数据接口规范
- 设计时间序列数据格式：按`日期+source`返回每天的`API成本+订阅摊销成本`
- 聚合粒度规则：day视图按小时粒度，week视图按天粒度，month和total视图按天粒度（月份多时可按周）
- 时间范围和时区参数复用现有Usage接口的`from/to/tz/tz_offset_minutes`参数结构，保持一致性
- 接口URL建议：`/functions/tokentracker-spend-timeseries`
- 响应结构：`{ series: [{ date: "2026-06-22", source: "claude", api_cost_usd: 1.2, subscription_cost_usd: 0.8, combined_usd: 2.0 }, ...] }`
- 输出规范写入`docs/dev-notes/spend-chart-api-spec.md`

**[→Claude Code执行]** P02 — Spend时间序列后端接口
- 依据：`docs/dev-notes/spend-chart-api-spec.md`（P01产出，Codex告知Claude Code后再派发）
- 目标文件：`src/lib/local-api.js`，新增`/functions/tokentracker-spend-timeseries`接口
- 数据来源：API成本从usage queue按日期聚合（与现有spend by_source逻辑一致），订阅成本从subscription_records按billing_cycle摊销展开到每一天
- 时区处理：复用现有spend接口的日期过滤逻辑，不重新实现，保持口径一致
- 验收标准：用Postman或curl调用接口，day/week/month三个时间范围都能返回正确的`series`数组，不同source各自一条数据线，金额与现有Spend卡片合计数字吻合

**[→Claude Code执行]** P03 — Spend折线图前端组件
- 依据：P02产出的接口 + CC Switch使用统计图作为视觉参考（多折线、不同颜色区分source、hover tooltip）
- 目标文件：新增`dashboard/src/components/spend/SpendTrendChart.jsx`，集成到`SpendPage.jsx`卡片下方
- 图表库：**必须复用TokenTracker现有已引入的图表库**，不允许引入新npm依赖
- 具体要求：
  - 每个source一条折线，颜色区分（复用现有Dashboard的颜色体系）
  - X轴：时间；Y轴：金额，跟随全局货币设置（USD或CNY，用currencySettings.usdToCny换算）
  - Hover tooltip：显示该时间点每个source的`API成本 / 订阅成本 / 合计`，格式参考CC Switch的usage趋势tooltip
  - 支持时间范围切换（day/week/month/total/custom），切换后图表更新
  - 图例：列出所有source名称及其对应颜色
- 验收标准：Spend页能看到折线趋势图，hover有完整tooltip，切换时间范围图表正确更新，数字与上方卡片合计一致

---

## 模块二：API Key vs Token Plan 显式标注（GAP-2）

### 背景
用户原始诉求第2条"区分计费方式：API Key（按量付费）和Token Plan（订阅套餐包）"。当前Usage页只显示source和model，不显示该用量是走API Key消耗还是Token Plan套餐消耗。例如，Hermes接DeepSeek API的请求是API Key按量，Hermes接小米MiMo Token Plan的请求是套餐消耗，这两种在数据上应该有显式区分。

### 任务

**[Codex设计]** Q01 — billing_mode标注规范
- 明确`billing_mode`字段（api_key/token_plan）在数据层是否已正确写入usage records
- 如果已写入：设计UI展示方案——在Usage页的by-source分组或model breakdown列表里，给每条source增加一个徽章（"API Key"/"套餐"），颜色区分（比如橙色=API Key、绿色=Token Plan）
- 如果没有写入：设计从source名称推断billing_mode的规则（例如"Xiaomi MiMo Token Plan"包含"Token Plan"关键词→套餐，Codex (Session)包含session字样→API Key类）
- 设计Usage页顶部增加一个`计费方式`筛选器（全部/API Key/Token Plan），让用户可以单独查看某种计费方式下的用量
- 输出规范写入`docs/dev-notes/billing-mode-display-spec.md`

**[→Claude Code执行]** Q02 — billing_mode徽章与筛选器实现
- 依据：`docs/dev-notes/billing-mode-display-spec.md`
- 目标文件：`dashboard/src/pages/DashboardPage.jsx`及其子组件、`src/lib/local-api.js`（如需后端增加筛选参数）
- 要求：UI层加徽章 + 顶部筛选器，不允许改动数据库schema（只改展示层和筛选逻辑）
- 验收标准：Usage页能看到每个source旁边的计费方式徽章，筛选器切换后数据正确过滤

---

## 模块三：Codex 5小时/周额度专属展示（GAP-3）

### 背景
用户原始诉求第3条明确提到"5小时额度/周额度"，这是Codex Pro订阅的特有机制：每5小时有一个滚动请求窗口额度，每周也有一个累计额度上限。通用的`total_quota/remaining_quota`字段无法表达"当前5小时窗口内还剩多少"这种滚动概念。

### 任务

**[Codex设计]** R01 — Codex窗口额度数据结构规范
- 调研Codex CLI本地数据（`~/.codex/`目录下或类似位置）是否记录了5小时窗口和周窗口的剩余额度信息
- 如果CLI日志有记录：设计解析和展示字段，直接从日志读取
- 如果CLI日志没有记录（更可能的情况）：设计为"用户手动录入当前窗口剩余额度+录入时间，系统按录入时间显示倒计时，5小时窗口到期后提示用户更新"
- 在Token Plan设置区，`source=codex`的条目额外展示两个专属字段：`五小时窗口剩余额度+窗口重置倒计时`、`本周剩余额度+周重置倒计时`；其他source的条目不显示这两个字段
- 输出规范写入`docs/dev-notes/codex-quota-window-spec.md`

**[→Claude Code执行]** R02 — Codex窗口额度展示实现
- 依据：`docs/dev-notes/codex-quota-window-spec.md`
- 目标文件：`dashboard/src/components/settings/TokenPlanSection.jsx`、`src/lib/local-api.js`（如需新字段存储）
- 要求：只在source为codex的Token Plan条目里渲染这两个字段，其余source渲染原有通用字段
- 验收标准：Settings页的Token Plan列表中，Codex条目能看到5小时窗口和周额度字段；Claude/Hermes条目不出现这两个字段

---

## 模块四：Dashboard动态刷新（GAP-4）

### 背景
用户原始诉求第4条"实时/准实时监测，能动态刷新用量"，第7条"API Key花销实时计费增加"。当前Dashboard打开后是静态快照，不会自动更新。CC Switch有30s可配置刷新间隔选项（截图中可见右上角"30s"下拉）。这是"实时性"体验的核心。

### 任务

**[Codex设计]** S01 — 动态刷新机制规范
- 确认当前前端调用本地API的方式（轮询还是WebSocket），TokenTracker基线是否有刷新机制
- 设计刷新方案：推荐前端轮询（setInterval），可选档位：30s/1min/5min/手动，默认1min
- 确认需要刷新的数据范围：Usage汇总指标+Usage趋势图+Spend汇总卡片（Token Plan余量已有独立刷新调度器，不重复触发）
- 设计UI：在Dashboard右上角加一个刷新间隔下拉控件（仿CC Switch的"30s"控件位置和交互），加一个手动刷新按钮，加一个"上次更新时间"小字
- 输出规范写入`docs/dev-notes/dashboard-refresh-spec.md`

**[→Claude Code执行]** S02 — Dashboard动态刷新实现
- 依据：`docs/dev-notes/dashboard-refresh-spec.md`
- 目标文件：`dashboard/src/pages/DashboardPage.jsx`、`dashboard/src/pages/SpendPage.jsx`（Spend页也要跟随刷新）
- 要求：刷新间隔配置持久化保存到本地设置，重开应用后保持上次选择；刷新时不能让整个页面闪烁，只更新数据内容部分
- 验收标准：Dashboard右上角有刷新间隔下拉 + 手动刷新按钮 + 上次更新时间；选30s后等待30s，页面数据自动更新（可通过修改日志文件后观察Dashboard数字变化来验证）

---

## 模块五：标准化扩展接口（GAP-5）

### 背景
用户原始诉求第5条"预留扩展接口：后续新增OpenClaw或其他插件时，能通过标准化接口（如RESTful API或读取本地文件）轻松接入"。当前代码里Hermes适配器是如何接入的只能靠阅读代码摸索，没有文档化的标准接口规范。这意味着以后要接入OpenClaw，开发者（人类或AI）需要猜测怎么做，风险很高。本模块的目标不是现在就实现OpenClaw，而是把"如何接入一个新Agent"这件事**标准化成文档**，并在代码里建立一个清晰的注册入口，未来任何人按照文档就能接入新Agent而不需要摸索代码结构。

### 任务

**[Codex设计]** T01 — 适配器标准化接口规范
- 梳理现有Claude Code、Codex、Hermes三个适配器的实现模式（读哪个目录、解析什么格式、映射到哪些字段），提取共同模式
- 设计一个标准的"Agent适配器接口规范"，包含：
  - 适配器需要实现哪些函数/方法（比如：`discoverDataPath()`自动探测默认数据路径、`parseUsageFile(filePath)`解析日志文件为标准usage记录数组、`getAgentInfo()`返回agent名称/图标/颜色等元数据）
  - 标准usage记录的必填字段和可选字段（与现有usage queue schema对齐）
  - 如何注册一个新适配器（在哪个文件加一行配置或import）
  - Data Directory设置页如何自动出现新Agent的路径输入框（不需要手动改设置页组件）
- 以OpenClaw作为示例，写一个"如果要接入OpenClaw，步骤是什么"的示例说明（不需要真正实现，只是验证规范可操作）
- 输出写入`docs/dev-notes/agent-adapter-spec.md`，这是未来接入任何新Agent的权威参考文档

**[→Claude Code执行]** T02 — 适配器注册机制代码化
- 依据：`docs/dev-notes/agent-adapter-spec.md`
- 目标：在现有代码里建立一个**适配器注册表**（比如`src/lib/adapters/registry.js`），把现有三个适配器（Claude Code/Codex/Hermes）迁移到这个注册表模式下，确保功能与之前完全一致，不改变现有行为
- 副作用验证：迁移后现有三个Agent的数据读取必须与迁移前结果一致（跑已有测试验证）
- 额外产出：Data Directory设置页改为从注册表动态读取Agent列表，不再硬编码三个输入框，这样以后加一个适配器，设置页自动多出一行输入框
- 验收标准：注册表文件存在，三个现有Agent迁移完成，现有后端测试97/97仍然全通过，Data Directory设置页展示效果与之前一致

---

## 模块六：精准Token检测评估（GAP-6）

### 背景
用户原始诉求第6条"token消耗检测准确到具体字符（可参考github项目或skills的精准捕捉）"。需要先评估清楚"准确到具体字符"在当前实现里是否已经满足，再决定要不要新增开发任务。

### 任务

**[Codex设计+评估]** U01 — 精准Token检测可行性评估（先评估再决定是否派单）
- 当前实现现状：usage数据来自Agent本地日志（JSONL格式），按小时聚合成`hour_start`为单位的记录
- 需要评估的问题：
  - Agent本地日志（`~/.claude/projects/*.jsonl`、`~/.codex/`、`~/.hermes/`）里每一行记录的粒度是"每次对话"还是"每次API请求"？字段里的token数字是API实际返回的值，还是客户端估算的？
  - "准确到具体字符"是否意味着需要显示到请求级别（每条消息消耗多少token），而不是当前的小时级别聚合？
  - 参考ccusage（github.com/ryoppippi/ccusage）对精准token的处理方式：它是直接读JSONL里每行的token字段，还是自己用tokenizer重新计算？
- 评估结论A（最可能）：日志里的token字段本身就是API实际返回的精确值，当前实现已经是"精准的"，只是展示粒度是小时级聚合——如果是这种情况，需要新增"请求日志"视图（类似CC Switch截图里的"请求日志"Tab，每行一条请求记录），让用户能看到每次请求的精确token消耗
- 评估结论B：日志里某些字段是估算值——如果是这种情况，设计用哪个tokenizer库重新计算精确值
- 将评估结论告知用户确认，再决定后续工单

**[→Claude Code执行，条件触发]** U02 — 请求级Token明细视图
- 仅在U01评估为"结论A，需要新增请求级视图"时派发
- 依据：U01评估报告 + CC Switch截图里的请求日志Tab（显示时间/供应商/计费模型/输入token/输出token/总成本/用时/状态/来源）作为视觉参考
- 目标：在Dashboard的Usage页下方，新增"请求日志"Tab（仿CC Switch），展示最近N条请求，每行显示：时间/Agent/模型/输入token/输出token/缓存token/估算成本/来源（Win或WSL）
- 支持按Agent和时间范围筛选
- 验收标准：能看到请求级别的token明细，数字与小时级聚合视图在同一时间范围内求和结果吻合

---

## 阻塞项：Windows WebView2文件夹选择器验证（BLK-1）

**[已审核]** V00 — Token Eyes Tauri baseline 恢复
- 结果：Token Eyes Tauri baseline 已恢复并推送到 `claude/te-next-v00-tauri-baseline-restore`，commit `d37d29cf2ddae6a0a5e3cce539dfd13392ef7325`。
- 主工单：`docs/tasks/dispatch/TE-NEXT-V00-tauri-baseline-restore.md`
- 验证报告：`docs/test-reports/v2.1/20-token-eyes-tauri-baseline.md`
- 目标：恢复/创建真正属于当前 Token Eyes dashboard 的 Tauri Windows 桌面壳，使 V01 能继续做用户本机验证。
- 关键边界：不要求 `.NET SDK` / `.NET 8 SDK`；不要用 CC Switch 旧壳关闭 V01；不要重做已审核的 P/Q/R/S/T/U 主线功能。
- 验收标准：`src-tauri` 存在且产品名不是 CC Switch；Tauri dev/build 能加载当前 Token Eyes dashboard；Settings -> Data Directories 三个“选择文件夹”按钮可弹出系统文件夹选择器、选择后回填、取消不清空。

**[已分派给用户]** V01 — WebView2手动验证
- 前置：V00 已完成并生成真正可运行的 Token Eyes Tauri baseline。
- 步骤1：在PowerShell运行`rustc --version`、`cargo --version`、`node --version`、`npm --version`，确认本机已有Rust工具链和Node.js
- 步骤2：确认Windows 10/11自带或已安装WebView2 Runtime；不要安装无关SDK作为本项前置
- 步骤3：切换到 V00 产出的 Token Eyes Tauri 分支，按Tauri Windows build流程打包运行
- 步骤4：进入Settings → Data Directories，逐一测试Claude/Codex/Hermes三个"选择文件夹"按钮：能弹出系统文件夹选择器✅、选择后路径回填✅、取消后不破坏已有值✅
- 步骤5：把结果（截图或文字）告知Codex，Codex在飞书表把BLK-1更新为完成或记录具体问题
- 如果按钮有问题：**[→Claude Code执行]** V02按具体问题描述修复WebView2交互逻辑

---

## 优先顺序建议

**立即开始**：模块一（P01→P02→P03），Spend折线图是最直观的体验缺口，P01由Codex设计，P02/P03串行派给Claude Code。

**同步进行**：BLK-1（用户本机操作，不阻塞开发），模块四S01（Codex自己做，工作量小）。

**P01-P03完成后**：模块二（Q01→Q02）和模块四（S01→S02）并行推进。

**再之后**：模块三（R01→R02），R01需要Codex先调研Codex CLI日志格式。

**同步推进**：模块五（T01→T02），T01是纯规范设计，Claude Code执行T02不需要等其他模块。

**最后处理**：模块六（U01），纯评估，结论可能是"已足够，无需新增开发"。

---

## 给Codex的完整操作指令（从这里往下复制粘贴）

你好Codex，这是Token Eyes项目的后续工作蓝图（完整修正版）。Full Plan核心已完成，现在需要补齐6个对照用户原始诉求发现的缺口 + 1个阻塞项。

执行工单的Agent是**Claude Code**，不是Hermes。之前飞书进度表里的"Hermes Agent"执行方，全部更新为"Claude Code"。

**你的职责边界不变**：
- `[Codex设计]`的任务你自己做（规范/接口设计），不写实现代码，写完告知用户确认
- `[→Claude Code执行]`的任务你写成工单`.md`，告知用户转交Claude Code
- `[用户本机操作]`的任务你只告知用户步骤，不生成工单
- 每次生成工单前先读飞书进度表，工单做完后及时更新飞书表状态

**当前实时状态（2026-06-23）**：
- P02/P03/S02/T02 已审核。
- Q01/Q02 已审核；Q02 的主工单是 docs/tasks/dispatch/TE-NEXT-Q02-billing-mode-badges-filter.md，Codex 已补齐 `pay-as-you-go` 模型关键词边界。
- R01/R02 已审核；R02 的主工单是 docs/tasks/dispatch/TE-NEXT-R02-codex-quota-window-display.md，Codex 已补齐接口失败态回退测试。
- U01/U02 已审核；U02 的主工单是 docs/tasks/dispatch/TE-NEXT-U02-request-token-detail-view.md，Codex 已补齐请求级明细中文 copy 编码、cached input 归一化、日期边界和配置化 Codex data directory。
- 06-23 派单矩阵只用于顺序和上下文说明，不是主执行工单；R02/U02 不要再重复派发。
- V00 已审核：Token Eyes Tauri baseline 已恢复并推送，commit `d37d29cf2ddae6a0a5e3cce539dfd13392ef7325`。V01 仍为人工验证；Token Eyes 是 Tauri 应用，前置是 Rust 工具链、Node.js、WebView2 Runtime，不需要 .NET SDK。不要使用旧 CC Switch 壳作为通过证据。

**现在下一步**：不要再从 P01/P02/Q02/R02/U02/V00 开始。当前执行 V01 用户本机验证；本机验证失败并提供具体证据后才生成 V02。

---

## 2026-06-25 追加：W03-R3 Token 套餐产品结构修正

### 用户确认后的最新需求基线

Token 套餐模块的正确产品结构不是“在主界面放一个全局小米 MiMo 控制台连接卡片”，而是“服务商驱动的套餐配置”。用户点击“新增套餐”后，在同一个 Token 套餐表单内完成以下流程：

1. 选择 `Agent 来源`，例如 Hermes、Codex、Claude。
2. 选择 `服务商`，例如 `xiaomi_mimo`。
3. 选择该服务商下的套餐，例如小米 MiMo 的 Lite / Standard / Pro / Max。
4. 套餐选择后自动带出已核验的套餐基础信息，包括套餐名称、总额度、额度单位、额度来源。
5. 在该套餐记录内选择检测方式，检测方式必须支持并存：
   - 方案 1：官网账号登录检测。用户点击链接跳转/打开小米官网或控制台登录，完成授权后 Token Eyes 检测套餐状态。
   - 方案 2：自定义 API 检测。用户输入 API Key、API 格式、请求地址、官网链接，由 Token Eyes 发起请求并解析套餐状态。

### 明确废弃的方向

- 不要在 Token 套餐主界面单独放“小米 MiMo 控制台连接”卡片。
- 不要把小米账号连接做成全局入口。
- 不要把手动填写已用额度、剩余额度、到期时间作为主路径。
- 不要只提供“去官网查看”的链接来替代状态检测。

### W03-R3 任务拆分

本轮以 `docs/tasks/dispatch/TE-NEXT-W03-R3-token-plan-auth-methods-dispatch.md` 为调度入口，拆成四个工单：

1. `W03-R3A`：重构 Token 套餐配置模型，补充检测方式字段和安全边界。
2. `W03-R3B`：重构新增套餐表单，把小米连接入口并入服务商/套餐选择后的检测方式区域，移除独立小米卡片。
3. `W03-R3C`：实现自定义 API 检测配置，支持 API Key、API 格式、请求地址、官网链接和检测按钮。
4. `W03-R3D`：统一两种检测方式的状态同步与验收，展示已用额度、剩余额度、到期时间、最后同步时间、失败原因。

### 执行顺序

- 先做 `W03-R3A`。
- `W03-R3B` 和 `W03-R3C` 可在 `W03-R3A` 后并行。
- `W03-R3D` 必须等待 `W03-R3B`、`W03-R3C` 完成，并且方案 1 的小米官网数据源探测有可复现结论。

### 飞书同步状态

本地计划已更新；当前环境调用飞书开放平台时返回 `app secret invalid`，说明 `.env` 中飞书应用密钥已失效或不是当前表对应应用。飞书表需要在密钥更新后补同步。
