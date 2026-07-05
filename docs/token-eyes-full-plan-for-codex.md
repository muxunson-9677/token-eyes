# Token Eyes 完整开发方案(给Codex存档版 / 含任务分工)

> 这是给Codex长期存档、作为后续全部开发依据的版本。产品定义、数据模型、验收标准等核心内容与`token-eyes-dev-plan-v2.md`一致,本文件在此基础上把每一项工作明确标注成 **[Codex自己做]** 或 **[→派给Claude Code执行]**,并把阶段计划展开成可以直接转成工单的任务清单。Codex看到任何一条任务时,先看标签再决定怎么处理:标了`[Codex]`的自己做,标了`[→Claude Code]`的写工单派出去,不允许把`[→Claude Code]`的任务自己写代码做掉,也不允许把`[Codex]`的设计判断类工作直接丢给Claude Code自己猜。

## 任务分工总表(先看这个,有疑问时回来对照)

**只属于Codex自己做的事(就这几类,别的都不是Codex该做的)**:
1. 仓库初始化、分支策略维护
2. 飞书自建应用创建、鉴权配置、多维表格初始化与日常读写(用户已授权全部权限)
3. 把每个功能任务写成工单`.md`,定义清楚目标文件、输入规范、验收标准、禁止事项
4. 涉及接口/数据结构/公式的**设计判断**(写进`docs/dev-notes/interfaces.md`,作为工单的"已确定输入规范",自己不写实现代码)
5. 审核 Claude Code 提交的PR,对照验收标准逐条核对,通过则合并+在飞书表打勾,不通过写明原因打回

**其余全部派给 Claude Code 执行**:所有实际功能代码的编写、所有测试验证的执行、所有bug修复,没有例外。哪怕是看起来"简单"的UI小改动,也按工单流程走,不要因为"简单"就让Codex自己手写。

---

## 0. 产品定义与基座决策(摘要,完整论述见v2文档)

基座从CC Switch切换为 **TokenTracker**(`github.com/mm7894215/TokenTracker`),移植CC Switch的Win/WSL路径覆盖思路。产品定义:一个跑在Windows上的桌面应用,统一展示Win本机+WSL内Claude Code/Codex/Hermes Agent三者的token消耗、成本、缓存命中率、套餐余量(自动刷新),并支持手动记录订阅花销并汇总。不做模型切换、skills、MCP、记忆路由、排行榜、账号登录。

## 1. 数据模型(完整版,与v2文档第7节一致)

继承TokenTracker原有:`hour_start`、`source`、`model`、`input_tokens`、`output_tokens`、`cached_input_tokens`、`cache_creation_input_tokens`、`total_tokens`。

新增表:
- `pricing_rules`:`source`、`model`、`unit_price_input`、`unit_price_output`、`currency`
- `plan_quota`:`source`、`plan_label`、`total_quota`、`used_quota`、`remaining_quota`、`expires_at`、`updated_at`(最近一次成功刷新时间)、`refresh_interval_minutes`、`refresh_method`(manual/cookie_scrape/official_api)、`last_refresh_status`(success/failed)、`credential_ref`(凭证的本地安全存储引用,不直接落库存原始cookie明文)
- `subscription_records`:`id`、`source`、`plan_label`、`amount`、`currency`、`billing_cycle`、`start_date`、`end_date`、`note`

## 2. 飞书集成详细步骤

**[Codex]** 在飞书开放平台(`open.feishu.cn`)创建一个自建应用,拿到 App ID / App Secret;用官方Node.js或Python SDK(飞书没有像`gh`那样的官方CLI,走SDK/REST API)完成鉴权;把App ID/Secret放进项目根目录的`.env`,确保`.env`已加入`.gitignore`,绝不能硬编码进代码或提交进仓库;把整个搭建步骤记录进`docs/feishu-setup.md`,方便以后排查鉴权失效问题。

**[Codex]** 用API创建多维表格"Token Eyes进度表",字段:任务ID、所属模块、任务标题、负责执行方(固定填 Claude Code)、状态(单选:待分派/已分派/执行中/待审核/已完成/打回)、分支名、工单文件链接、PR链接、验收标准摘要、备注。

**[Codex]** 使用边界:这个飞书集成只服务于本项目的进度管理,不要做成Token Eyes产品本身的功能(不要在产品里加"同步到飞书"这种用户可见按钮);即使被授予了全部权限,实际操作也只围绕这张多维表格的增删改查,不要碰用户飞书空间里其他无关的文档/日历/消息。

**[Codex]** 纪律:每次要生成新工单前,先用API读一遍飞书表当前状态,确认任务顺序没乱;每次收到 Claude Code 的执行结果做审核时,对照该任务原始验收标准逐条核对,通过则把状态改成"已完成"并合并PR,不通过写明具体原因改成"打回"。

## 3. 任务清单(按顺序执行,可直接转成工单编号)

0. **[Codex]** 重新init仓库,基线=TokenTracker源码,建立分支策略(main受保护只允许Codex合并,每个任务对应`feature/<编号>-<关键词>`分支),把本文档和v2文档放入`docs/`。
0a. **[Codex]** 按第2节完成飞书应用创建、鉴权、多维表格初始化,验证能正常读写一条测试记录后删除测试数据。
1. **[→Claude Code]** 在用户机器上验证TokenTracker现有的Claude Code / Codex / Hermes Agent三个解析器是否都能正常读到真实日志数据,尤其确认Hermes Agent这条能否区分"走DeepSeek API"和"走小米MiMo Token Plan"两种不同来源;把结果写成报告提交到`docs/dev-notes/baseline.md`。
2. **[Codex]** 根据任务1的报告做判断:如果Hermes解析器无法区分两条计费线,设计需要新增的细分字段规范,写入`docs/dev-notes/interfaces.md`,作为下一条工单的输入规范。
3. **[→Claude Code]**(仅当任务2判定需要时)按规范扩展Hermes解析器,细分DeepSeek/小米两条计费来源。
4. **[Codex]** 设计跨环境路径覆盖功能的配置项规范:需要覆盖的数据源清单、各自的默认探测路径、UNC路径覆盖格式(参考`\\wsl.localhost\<distro>\home\<user>\...`),写入`interfaces.md`。
5. **[→Claude Code]** 按任务4的规范,实现设置页里的"数据目录"覆盖输入框+对应的读取逻辑,确保Windows端能合并读取WSL内Claude Code/Hermes Agent的日志和Windows本机Codex的日志。
6. **[Codex]** 确认/微调`pricing_rules`表结构与成本计算公式(单价×token数,按input/output分别计价)。
7. **[→Claude Code]** 实现自定义计费规则面板(用户给每个Agent+model组合手动设单价)与成本计算逻辑。
8. **[Codex]** 设计USD↔CNY换算规则:用户在设置里手动填一个固定汇率,可手动刷新更新,定义存放位置和应用范围。
9. **[→Claude Code]** 实现USD/CNY换算功能,挂接到所有展示成本的地方(Dashboard和花销页)。
10. **[→Claude Code]** 实现缓存命中率卡片:基于`cached_input_tokens`字段计算命中token数与百分比,加进Dashboard顶部。
11. **[Codex]** 设计`plan_quota`自动刷新调度器的完整接口规范:刷新间隔配置项的可选档位、"官方API优先/Cookie兜底"的判定逻辑、失败时的报错文案格式、风险提示文案内容。
12. **[→Claude Code]** 实现Token Plan静态信息(套餐名/总额度/起止时间)的手动录入表单。
13. **[→Claude Code]** 按任务11的规范,实现后台自动刷新调度器:按用户设定间隔轮询已用/剩余额度,官方API优先,无API则走Cookie抓取,失败时按规范报错并展示"上次成功刷新时间"。
14. **[Codex]** 确认/微调`subscription_records`表结构与花销汇总公式(本月花销=API消耗成本+手动订阅记录;累计花销=全部历史同口径求和)。
15. **[→Claude Code]** 实现花销模块:订阅记录的增删改查表单 + 月度/累计花销汇总展示,支持人民币/美元双币种。
16. **[→Claude Code]** 隐藏或删除Skills Manager、Leaderboard等与本项目无关的入口。
17. **[→Claude Code]** 按Codex给出的测试步骤执行联调测试(验证三个Agent数据都能正确展示、跨环境路径生效、花销数字正确、套餐自动刷新真实在跑),把结果写进`docs/test-reports/`。
18. **[Codex]** 审核全部PR,逐条对照v2文档第10节的验收标准核对,通过的合并入main并在飞书表标记完成,不通过的列出具体问题退回 Claude Code 修正。

## 4. 验收标准(与v2文档第10节一致,不重复展开)

打开应用应该只看到:一个统一Dashboard、一个花销页、一个设置页。不应该出现模型切换按钮、skills浏览器、排行榜、账号登录,以及任何与"看token消耗和花销"无关的入口。
