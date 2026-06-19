# Token Eyes 开发方案 v2(战略调整版:换基座)

> 本文档是项目唯一的方向性依据,由人类负责人与Claude共同确定,Codex作为"翻译官"负责把它拆解成工单和飞书表任务,不允许在此基础上自行扩展或猜测范围。

## 0. 关键决策:为什么换基座

上一版基于 CC Switch 二开的 MVP,虽然能跑,但保留了完整的多应用切换框架、provider管理、skills/MCP/路由设置等无关能力,没有收敛成"只看Hermes统计+订阅费+花销图"的最小面板。根本原因是 CC Switch 本质是"模型切换器",用量统计是附加能力,要把它精简成纯监控工具,等同于一次外科手术,稍有指令模糊就会被保留过多东西。

**决定**:新仓库改用 **TokenTracker**(`github.com/mm7894215/TokenTracker`)作为基线,而不是继续在 CC Switch 上改。理由:

- 原生支持解析 Claude Code、Codex CLI、**Hermes Agent** 等本地日志,Hermes 的解析器已经现成,不用我们自己逆向格式。
- 数据 schema 已经包含 `source`(对应"哪个Agent")、`model`、`input_tokens`、`output_tokens`、`cached_input_tokens`、`cache_creation_input_tokens`、`total_tokens`,正好对应你要的 B/C/D/F 几项。
- Dashboard 已经支持按天/周/月/全部/自定义时间范围筛选(对应 A),按模型的成本分析(对应部分 E),风格干净,符合你说喜欢的那种简洁感。
- 它本身没有模型切换功能,不存在"减法手术"的风险,新增功能可以干净地叠加上去。
- 唯一缺的是 CC Switch 那个"Windows读取WSL路径"的配置覆盖机制,这个会单独移植过来,不需要带上CC Switch整个项目。

**操作建议**:Codex 重新 init 仓库(或新建分支彻底清空旧内容),以 TokenTracker 的源码作为基线,之前基于CC Switch做的尝试归档不再继续往上改。

**执行者更新**:本计划原假设开发执行由 Hermes Agent 承担;当前已调整为工单执行者固定为 **Claude Code**。Hermes Agent 仍然是 Token Eyes 要监控的目标数据源之一,不是本轮工单执行方。

---

## 1. 产品定义(一句话)

一个跑在 Windows 上的桌面应用,统一展示 Windows 本机 + WSL 内三个 Agent(Claude Code、Codex、Hermes Agent)的 token 消耗、成本、缓存命中率、套餐余量,并支持用户手动记录各平台订阅花销并汇总。不做任何模型切换、skills 浏览、MCP、记忆路由、排行榜/账号登录类功能。

## 2. 监控目标(三个 Agent 的实际部署情况)

- **Claude Code**:装在 WSL 内,经 CC Switch 配置走 DeepSeek 模型 → 走 Claude Code 本地 session 日志(`~/.claude/projects/*.jsonl`),TokenTracker 已有现成解析器,实际计费模型字段会显示成 DeepSeek 系列模型名,不影响解析,但**影响计价**(见第5节E)。
- **Codex**:装在 Windows C 盘,官方订阅账号登录 → TokenTracker 已有现成解析器。
- **Hermes Agent**:装在 WSL 内,接 DeepSeek API,同时还有小米 MiMo Token Plan → TokenTracker 已有 Hermes 解析器,但需要在第一阶段验证:它是否能区分同一个 Hermes 下"走 DeepSeek API"和"走小米 MiMo Token Plan"这两种不同计费来源,如果只笼统记成"hermes"一个来源,需要在解析层补一个细分字段。

## 3. 直接复用,不用重新做的能力

- 三个 Agent 的本地日志解析器(parser)
- 统一的 token 用量数据 schema
- Dashboard 现成图表:用量趋势、按天/周/月/全部/自定义范围筛选
- 已有的 `cached_input_tokens`、`cache_creation_input_tokens` 字段(只是还没做成"命中率%"卡片展示)

## 4. 必须删除/默认关闭的能力(TokenTracker自带但我们不需要)

- Skills Manager(250+ skills 浏览/同步功能)
- 公开 Leaderboard、云同步、账号登录相关功能
- 任何跟"看自己的token消耗和花销"无关的社交/排行类入口

## 5. 新增功能清单(逐项对应你列的需求)

**A. 时间范围**:今日/本周/本月/全部累计 + 用户自定义区间。TokenTracker已支持day/week/month/total/custom,核实UI措辞和默认选项是否符合预期即可,基本不用新开发。

**B. 来源Agent**:直接复用现有 `source` 字段,对应 Claude Code / Codex / Hermes Agent 三者,Hermes若能细分DeepSeek/小米两条线则再加一层。

**C+D. 各Agent用了哪些模型 / 各消耗多少token**:复用现成的按model分组统计表,无需重新开发。

**E. 折算成钱(人民币/美元)——本项目第一个真正要新开发的点**:
- 新增"自定义计费规则"面板,让用户给每个 (Agent, model) 组合手动设置单价,因为实际走的是DeepSeek/小米后端,TokenTracker内置的官方Anthropic/OpenAI定价表对你不适用。
- 新增 USD↔CNY 换算,默认用户在设置里手动填一个汇率(可手动刷新更新),不强依赖实时汇率接口,避免引入额外的网络依赖和故障点。

**F. 缓存命中率的token数和百分比**:新增一张汇总卡片,基于已有的 `cached_input_tokens` 字段计算命中数量与百分比,加进Dashboard顶部即可,工作量很小。

**H. API Key花费 + Token Plan消耗量及剩余时间/剩余额度(自动刷新)**:
- API Key按量部分:直接复用E算出来的成本数字。
- Token Plan部分(比如小米MiMo套餐)的静态信息——套餐名称、总额度、起止时间——由用户手动录入一次,后续平台改套餐再改一次即可,这部分本身不需要自动刷新。
- **已用/剩余额度必须自动刷新,不能靠用户手动点按钮**:新增一个后台刷新调度器,用户在设置里配置好该套餐的查询方式(优先用官方API,没有官方API就用登录后的Cookie/查询URL),系统按用户设定的间隔(下拉可选,例如15分钟/30分钟/1小时/3小时/6小时,默认1小时)在后台自动拉取一次最新数据,更新到"当前套餐用量"卡片上。不需要做到秒级实时,但必须是自动轮询,不是手动刷新。
- 风险提示:Cookie抓取属于非官方接口方式,可能违反目标网站服务条款,且网站改版会随时失效,UI上要明确告知这一点;轮询失败时要给出清晰报错(比如"刷新失败,登录状态可能已过期,请重新获取Cookie"),不能静默失败。

**G. 花销模块(完全新增,核心新功能)**:
- 用户手动添加"订阅记录":平台/Agent、套餐名称、计费周期(月付/年付/一次性)、金额、币种、起止日期、备注。
- 系统把"API消耗成本"(由E算出)与"手动订阅记录"汇总成本月花销、累计花销,按Agent/平台拆分,支持人民币/美元双币种展示。
- TokenTracker完全没有这个功能,需要从零设计数据结构和UI模块,工作量在本项目里排第二大。

## 6. 跨环境(Win+WSL)统一展示——移植自CC Switch

- 移植CC Switch"配置目录覆盖"的设计思路(参考你截图里:Claude Code配置目录可手动指定为 `\\wsl.localhost\Ubuntu\home\hermes\.claude`)。
- 在设置页给每个数据源加一个"数据目录"输入框,默认自动探测本机标准路径,允许手动改写成WSL的UNC路径形式。
- 这样Windows端运行的桌面应用就能同时读到WSL内Claude Code/Hermes Agent的本地日志,和Windows本机Codex的日志,合并展示在同一个Dashboard里——这是本项目里工作量最大、最核心的一块新开发内容。

## 7. 数据模型变更(在TokenTracker现有schema基础上增量)

沿用现有结构:`hour_start`、`source`、`model`、`input_tokens`、`output_tokens`、`cached_input_tokens`、`cache_creation_input_tokens`、`total_tokens`。

新增:
- `pricing_rules`:`source`、`model`、`unit_price_input`、`unit_price_output`、`currency`(自定义计费规则)
- `plan_quota`:`source`、`plan_label`、`total_quota`、`used_quota`、`remaining_quota`、`expires_at`、`updated_at`(手动录入的套餐余量)
- `subscription_records`:`id`、`source`、`plan_label`、`amount`、`currency`、`billing_cycle`、`start_date`、`end_date`、`note`(花销模块的订阅记录)

## 8. 给Codex的"翻译官"操作规则

- Codex不能自己调用/启动 Claude Code 或 Hermes Agent,只负责生成工单`.md`文件,执行永远交还给人工转发;本轮工单由人工转交 Claude Code 执行。
- 每份工单固定包含:任务ID、所属模块、目标文件、背景说明、已确定的输入规范(接口/字段/参照格式)、具体步骤、验收标准、禁止事项。
- **飞书集成(用户已授权)**:飞书没有一个像`gh`那样的官方标准CLI,实际是飞书开放平台的REST API + 官方SDK(Node.js/Python等)。用户已经/将在飞书开放平台创建一个自建应用,并授予该应用多维表格(Bitable)的全部读写权限,把App ID / App Secret交给Codex使用。Codex要主动通过这个API/SDK去**创建和更新**多维表格记录,不再是"人工誊抄进表格"那种被动模式——任务派发时自动建一行记录,任务审核通过/打回时自动更新状态字段。App ID/App Secret要放进项目的`.env`文件,加入`.gitignore`,不能硬编码进代码或提交到仓库。
- **飞书多维表格字段建议**:任务ID、所属模块、任务标题、负责执行方(固定填 Claude Code)、状态(单选:待分派/已分派/执行中/待审核/已完成/打回)、分支名、工单文件链接、PR链接、验收标准摘要、备注。
- **纪律**:Codex每次生成新工单前,必须先通过API读一遍飞书表当前进度,确认任务顺序没有乱;每次收到执行结果做审核时,也要对照该任务原始验收标准逐条核对,通过才把飞书表状态改成"已完成",不通过要写明具体原因退回重做,不能自己代写代改。

## 9. 阶段顺序建议(给Codex,具体拆解由它细化成工单)

0. 重新init仓库(基线=TokenTracker),把本文档放进`docs/`。
0a. Codex完成飞书开放平台自建应用的创建/权限确认(用户已授权全部多维表格读写权限),用API/SDK建好进度表骨架,验证能正常读写。
1. 验证三个Agent的现有解析器在你机器上真实可用,尤其Hermes Agent这条(包括能否区分DeepSeek/小米两条计费线),这是后续一切的前提。
2. 跨环境路径覆盖功能(让Win端读到WSL数据)——本项目工作量最大的一块,优先做。
3. 自定义计费规则面板 + USD/CNY换算。
4. 缓存命中率卡片。
5. Token Plan静态信息手动录入(套餐名/总额度/起止时间)+ 后台自动刷新调度器(按设定间隔拉取已用/剩余额度,优先官方API,否则Cookie抓取)。
6. 花销模块(订阅记录CRUD+汇总,支持双币种)。
7. 删除/隐藏Skills Manager、Leaderboard等无关功能。
8. 联调验收。

## 10. 验收标准(防止再次跑偏的最终检验句)

打开应用应该只看到三块东西:**一个统一Dashboard**(用量+成本+缓存命中率,可按时间筛选,按Agent/Model分组)、**一个花销页**(订阅记录+汇总,双币种)、**一个设置页**(路径覆盖+定价规则+套餐余量录入)。不应该出现:模型切换按钮、skills浏览器、排行榜、账号登录、任何与"看自己花了多少token和多少钱"无关的入口。如果Codex交回的版本里出现了这些,直接打回。
