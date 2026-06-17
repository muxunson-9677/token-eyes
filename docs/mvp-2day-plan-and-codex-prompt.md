# Token Eyes — MVP 两日冲刺计划(含给 Codex 的完整指令)

## Part 1:计划总览(给你自己看的进度表)

### MVP 最终要看到的画面
打开应用 Dashboard,能同屏看到:
- Win端 Codex + WSL端 Claude Code 的用量(原生自带,零开发)
- Hermes 的用量(新增,本次核心工作)
- 一个"本月花销 / 累计花销"的简单图表,数字 = API Key 实际消耗成本 + 你手动填的订阅费(Claude Max / ChatGPT Plus 等)
- 一个手动添加/编辑订阅费的表单

### 本次 MVP 明确不做(挪到下一轮)
- OpenClaw 适配
- 路径"自动检测+候选下拉"(Hermes 路径先做成一个手动输入框,够用就行)
- 燃烧速率预测、套餐自动识别档位
- 套餐按周期摊销的复杂费用计算(花销公式先用最简版:不做摊销,只算token消耗成本+手动订阅费)
- UI 视觉打磨

### Day 1(打通数据链路,后端为主)

**上午(Codex 独立做,顺序执行,这是后续派单的前提)**
1. 新建 GitHub 仓库 `token-eyes`,导入 CC Switch 最新代码作为基线,建好分支策略,把开发计划文档放入 `docs/`。
2. 跑通基线,确认 Win Codex / WSL Claude 用量统计原生可用;记录现有 `usage_records` 表结构、现有 Tab 组件位置、现有路径设置模块位置。
3. 设计本次最小 schema 改动:`billing_mode`、`plan_*` 字段、`subscription_fees` 表,写好迁移脚本。
4. 定义 `cost_ledger` 的最简聚合公式与接口签名、`subscription_fee_commands` 的 CRUD 接口签名(这一步是"设计",必须 Codex 自己定,定完才能派单)。

**下午(并行派单,CC 和 Hermes 各开终端同时跑)**
5. 工单01:Hermes 本地数据解析适配器(参考 ccusage 对 Hermes Agent 日志格式的解析规则)。
6. 工单02:Hermes 数据源路径配置(本轮只做手动输入框,不做自动检测)。
7. 工单03:前端新增 Hermes 筛选 Tab(照抄现有 Tab 实现模式)。
8. 工单04:按第4步定义的接口,实现 `subscription_fee_commands` 增删改查。
9. 工单05:按第4步定义的公式,实现 `cost_ledger` 聚合查询。

**晚上**
10. Codex 审核工单01-05的PR,合并入main。
11. 验证后端链路:Hermes 数据能写进 `usage_records`、`subscription_fees` 能存手动订阅费、聚合查询能正确算出月度/累计花销数字(可以先用命令行或简单测试脚本验证,不依赖前端)。

### Day 2(前端可视化 + 联调收尾)

**上午**
12. Codex 定义三个前端组件需要的数据接口:用量列表(复用现有模式)、花销图表(简化版,月度+累计两个数字配一个柱状图)、订阅费表单。
13. 工单06/07/08:并行派给 CC/Hermes 分别实现这三个组件。

**下午**
14. Codex 审核合并06/07/08。
15. 工单09:联调测试任务(按 Codex 给的测试步骤执行:验证三个数据源用量都能展示、手动填一条订阅费验证花销数字正确、跑一次冷启动打包测试),派给 CC/Hermes 执行并写测试报告。
16. Codex 根据测试报告做最终验收,合并入main,打tag `v0.1-mvp`。

**晚上**:缓冲时间处理遗留bug;如果提前完成,可以开始预研OpenClaw适配(下一轮第一项)。

---

## Part 2:粘贴给 Codex 的完整指令(从这里往下复制)

你是本项目"Token Eyes"的主工程师与仓库维护者。项目方案已经制定完成,下面是接下来两天的具体执行计划,这是你本阶段的唯一任务来源,严格按顺序执行,不要扩大范围。

### 你的角色与三块职责
1. **主线开发**:架构性、跨模块、有设计判断的任务由你直接完成。
2. **任务派发**:规范已明确、机械执行、单文件改动的任务,写成任务工单派给 Claude Code 或 Hermes Agent。
3. **审核守门**:所有 PR 必须经你审核通过才能合并入 main,你是唯一有权合并的人。

### 重要限制
**你不能自己直接调用、启动或远程操作 Claude Code / Hermes Agent 的进程。** 你的派发动作仅限于:在 `docs/tasks/<编号>.md` 写好任务工单文件,写完后明确告知我"工单已就绪,请人工转交执行",然后停下等待。我会手动把工单内容转交执行,执行完成后把结果(完成情况 + PR 链接)告知你,你再进入审核流程。

### MVP 范围(只做这些,其余都不要碰)
- 新增:Hermes 用量统计、Hermes 数据源路径(手动输入框,不做自动检测)、`subscription_fees` 表与手动订阅费 CRUD、`cost_ledger` 简化版聚合(token消耗成本+手动订阅费,不做套餐摊销)、对应前端展示(用量Tab、花销图表、订阅费表单)。
- 不做:OpenClaw、燃烧速率预测、套餐自动识别、复杂摊销算法、UI视觉打磨。这些不要在本阶段的工单或代码里出现,出现了说明范围跑偏了。
- 已有:Win Codex / WSL Claude Code 的用量统计是 CC Switch 原生自带的,不需要任何开发,直接确认能跑通即可。

### Day 1 任务列表(按顺序执行1-4,5-9可以同时派单并行执行)
1. 新建 GitHub 仓库 `token-eyes`,导入 CC Switch 最新代码作为基线,建立分支策略(`main` 受保护只允许你合并,每个任务对应一个 `feature/<编号>-<关键词>` 分支),把开发计划文档放入 `docs/`。
2. 跑通基线,确认 Win Codex / WSL Claude Code 用量统计原生可用;记录现有 `usage_records` 表结构、现有用量 Tab 组件位置、现有路径设置模块位置,写进 `docs/dev-notes/baseline.md`。
3. 设计并编写迁移脚本:`usage_records` 新增 `billing_mode`(api_key/token_plan)、`plan_cycle_type`、`plan_start_at`、`plan_end_at` 字段;新增 `subscription_fees` 表(`id`、`agent_type`、`plan_label`、`monthly_fee`、`currency`、`billing_day`、`effective_from`、`effective_to`、`note`)。
4. 定义 `cost_ledger` 的最简聚合公式(本月花销 = 统计周期内 token 消耗按单价折算的成本 + 手动填写的订阅费;累计花销 = 全部历史的同口径求和,不做套餐摊销)与对外查询接口签名;定义 `subscription_fee_commands` 的增删改查接口签名。这两项是设计,必须你自己定,定完写入 `docs/dev-notes/interfaces.md`,作为后续工单的"已确定的输入规范"。
5. 写工单01:Hermes 本地数据解析适配器。要求:参考 ccusage 开源项目对 Hermes Agent 日志格式的解析规则,在 `src-tauri/src/services/` 新增 `usage_source_hermes.rs`,接口形态对齐现有数据源适配器模式,把解析结果映射进 `usage_records` 标准结构。
6. 写工单02:Hermes 数据源路径配置。要求:本轮只做一个手动输入框(用户自己填路径),不做自动检测候选列表,接到现有路径设置模块里。
7. 写工单03:前端新增 Hermes 筛选 Tab。要求:照抄现有用量 Tab(如 OpenCode)的实现模式与样式。
8. 写工单04:按第4步定义的接口实现 `subscription_fee_commands` 增删改查,新增 `src-tauri/src/commands/subscription_fee_commands.rs`。
9. 写工单05:按第4步定义的公式实现 `cost_ledger` 聚合查询,新增 `src-tauri/src/services/cost_ledger.rs`。
10. 工单01-05全部写完后告知我,等我反馈执行结果后,逐一审核PR(检查改动范围是否超出工单列出的目标文件、是否引入未声明依赖、自测报告是否齐全),通过则合并入main。

### Day 2 任务列表
11. 全部Day1任务合并后,定义三个前端组件的数据接口:用量列表展示字段、花销图表所需的聚合数据形状(月度数字+累计数字+按平台拆分)、订阅费表单字段,写入 `docs/dev-notes/interfaces.md` 补充。
12. 写工单06:实现 `SpendOverviewChart`(月度+累计花销简易柱状图),复用现有 Dashboard 图表组件风格。
13. 写工单07:实现 `SubscriptionFeeForm`(手动订阅费录入/编辑表单)。
14. 写工单08:Hermes 用量在 Dashboard 上的展示对接(确保第7步的Tab能正常显示数据)。
15. 审核合并06-08。
16. 写工单09:联调测试任务,给出具体测试步骤(验证三个数据源用量都能展示、手动填一条订阅费后花销数字正确、执行一次全新环境冷启动打包测试),要求执行者把结果写入 `docs/test-reports/09.md`。
17. 根据测试报告做最终验收,全部通过后合并入main并打tag `v0.1-mvp`,告知我MVP已完成。

### 任务工单格式(写每份工单都要包含)
任务编号与分支名;背景说明;允许改动的目标文件清单;已确定的输入规范(你设计好的接口/字段/参照格式);具体步骤(命令式列表);验收标准(可量化);禁止事项(不能动哪些文件、不能引入新依赖、不能调整已定schema)。

### 子智能体纪律(写进每份工单或单独告知执行者)
只在分配的 `feature/...` 分支工作,不能直接动main;完成后必须自测(编译通过+功能验证),把结果写进 `docs/test-reports/<编号>.md`;提交PR但不能自己合并;发现工单要求和代码现状冲突,不要自己改设计,在PR描述里写"设计冲突,请确认"并停下。

### 现在开始
请先回复:1) 仓库是否已建好;2) Day1 第1-4步的执行结果(尤其第4步的接口/公式设计,要给我看一下具体定义);3) 工单01-05的草稿内容。确认无误后我会转交执行。
