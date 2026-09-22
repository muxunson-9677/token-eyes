# Token Eyes 0.54.50 核查与修复状态

状态：PARTIAL / REPAIRING。25项已逐项核查并记录；多项仍有未解决/未验证子项，第一审不通过，最终安装版第二审未运行。

## GitHub 审查快照授权（2026-09-22）

- 用户现已明确要求提交并推送当前工作分支，供 GPT 网页端审查。本次仅归档当前代码、测试与本状态文档；下文“未提交/未授权提交推送”为此前阶段记录。
- 审查基线为 2f38d623578544833e3726c0ab81010939cfbeeb；审查对象为包含本文件的提交。没有合并 main、改版本或发布安装包，安装验收与 D07/C01 扩展范围仍未获得授权。
- 本地原始日志、截图、隔离数据和构建产物未纳入提交；下文日志路径是本地证据索引，网页端不能凭该路径直接读取。复核者应独立重跑相关检查，并保留未验证结论。
- 已记录的全量测试仍有 9 项 Node 与 1 项 Dashboard 基线失败；第一审 PARTIAL / 不通过，第二审 BLOCKED / NOT_RUN。本次 GitHub 归档不改变验收状态。

## 基线与边界

- 用户已授权新建干净工作树并执行附件全部核查。
- 工作树：D:/04-AI-Project/010-Token eye/.worktrees/token-eyes-05450-fixes
- 分支：codex/token-eyes-05450-fixes；初始 HEAD：2f38d623578544833e3726c0ab81010939cfbeeb；初始干净。
- 远端：https://github.com/muxunson-9677/token-eyes.git。版本保持 0.54.49；本次已授权提交推送供审查，未授权部署、覆盖安装或真实历史改写。
- Tauri 入口 dashboard/dist，启动 1586×932，最小 900×600。所有隔离数据、日志、缓存位于 artifacts/05450。
- 初始缺依赖：undici、@mongodb-js/zstd、vite、vitest、typescript 均 MODULE_NOT_FOUND；按既有 package-lock 用 npm ci 补齐，不改版本。
- 验收同一最终候选以 HEAD + diff SHA256 标识；最终安装双审待固定提交和隔离安装授权，不以单测代替。

## 执行顺序与复核

1. 依赖/隔离基线 → 原有聚焦测试与失败登记。
2. D01/D02/D10/D15/D13/D14 → 生产入口的失败恢复及状态测试。
3. Gemini/Codex/账号归属/查询/审计 → 独立期望值和顺序、重读、历史兼容复核。
4. 刷新、登记来源、UI → 真实链路与同视口截图/交互检查。
5. 每项或五个生产文件复核 diff 和所有状态；最终第一审逐项合同、第二审独立入口，缺证据保留。

## 验收合同与逐项状态

各项最终运行时为本次候选 CLI → local API → Tauri 安装版及受影响显示端；纯函数测试仅算代码层。数据项以隔离输入驱动正常采集/刷新/重启；UI 项以正常鼠标键盘切换、展开、缩放、恢复驱动。未经运行不声称已达预期。

### D01｜完整记录与增量游标

- 定位：`src/lib/rollout.js` 的 `parseRolloutFile`、`parseClaudeFile` 及直接调用者。
- 核查半行解析失败仍推进游标、读取期间追加与返回偏移不一致、截短/原子替换的恢复。按UTF-8实际消费字节处理；区分未完成尾部与完整损坏行，后者不能永久堵住后续记录。完整但无末尾换行的记录按来源契约处理，不永久漏采。
- 验收：分两次写入补全后计一次；中文字节切分、CRLF、重复读取、截短/替换后均可恢复；同时检查总量和时间桶。Codex后续累计可能补回总量，不能据约简反例断言永远丢总量。

- 状态：partial：完整记录与消费偏移已改，尚未取得安装版证据。
- 当前修改/反证：使用有上限的字节读取，完整行消费；头尾指纹识别截短/替换，保留未完成尾部。
- 证据：rollout-recovery.test.js；recovery-independent-stage6.log；final-node-focused.log（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：任意已读区中部等长改写不在头尾指纹检测范围；实际安装版重启未验。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D02｜写入失败时的状态一致性

- 定位：`rollout.js` 的各增量解析、`enqueueTouchedBuckets`、`attributionQueuedKey`；`src/commands/sync.js` 游标写回。
- 查清“游标/去重/已入队标记先变，但队列未落盘”和相反方向的失败。优先修现有提交顺序、临时状态和幂等恢复；注意浅拷贝可能仍修改原状态。不能只回滚内存而不处理已经写出的内容。
- 验收：分别在队列写入前后、游标提交前后注入失败，包括部分写入；重启重试后已确认消费不丢不重，失败来源不前移成功状态。主队列与项目队列也要核对。不是必须换数据库。

- 状态：partial：异常回滚和重试已有代码证据。
- 当前修改/反证：深拷贝游标，成功后发布；失败将主/项目队列恢复至原长度。独立进程分别在游标提交前后退出重读。
- 证据：rollout-recovery.test.js；recovery-independent-stage6.log（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：独立进程在主/项目队列部分写入时退出的反例已补齐，残片先备份再恢复；超1MiB无法定位尾行时拒绝猜测。真实安装版强杀与sync游标持久化完整旅程仍未验。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D03｜Gemini消息用量语义

- 定位：`rollout.js` 的 `parseGeminiIncremental`、`parseGeminiFile`。
- 先确认受支持日志为单消息usage还是会话累计；对于消息级usage，不同消息不能相互作累计差分；同消息后补/修订需替换其原贡献或应用正确差值。不得直接改变共用 `diffGeminiTotals` 的语义影响OpenCode等来源。
- 验收（消息级格式）：不同消息100+150=250，100+100=200；同消息100修订到150合计150；重复扫描不增加；旧游标继续读取兼容。新旧格式衔接与C02合并处理，不重做两次。

- 状态：partial：消息级计数与修订已有代码证据。
- 当前修改/反证：独立消息相加；同session/message修订先减旧再加新；副本去重；旧游标seed不重复追加。
- 证据：gemini-message-usage.test.js；gemini-invalid-green.log（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：旧累计差分历史未修，legacy_unreconciled明确保留；用户安装版本/迁移样例缺失。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D04｜Gemini缓存、工具及推理字段

- 定位：`rollout.js/normalizeGeminiTokens` 及费用使用方。
- 逐字段核对日志写入器和对应官方usage定义；若input已包含cache，就只能计一次。工具prompt不能直接当输出；推理是否独立相加按该来源定义。保留上游报告值及必要差异说明，不能用取最大值掩盖字段矛盾，也不能武断套用其他Agent公式。
- 验收：无工具/推理，input100、cache80、output20、reported120时，总120、非缓存输入20、缓存80、输出20；再补受支持格式的工具/推理样例，金额分项使用正确口径。异常结构不得默默变成准确0。

- 状态：partial：已核对有版本来源的字段契约。
- 当前修改/反证：input减已含cache，tool不作output，thoughts独立；矛盾/非法计数拒绝。消息账保留上游六个数值字段以审计。
- 证据：gemini-message-usage.test.js；gemini-invalid-red.log → gemini-invalid-green.log（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：仅验证v0.24.0写入器契约和合成字段；真实安装格式及金额全链未验。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D05｜Codex并行读取路径不一致

- 定位：`src/lib/local-api.js/collectCodexRolloutQueueRows`、`withCodexRolloutRows`；对照 `rollout.js` 与既有fork测试。
- 核查回退入口直接累加last usage、重复/归档/fork回放、只有部分队列即跳过补读，以及旧文件今天续写却按文件名日期漏选。复用已有正确的纯解析逻辑，不通过调用会写队列/游标的sync来满足只读查询。
- 验收：重复事件、累计重置、父子历史、归档副本、跨日续写分别有样例；同来源/时间/指标的可比统计一致；队列与日志按明确覆盖关系替代或补齐，不能全删历史或两份相加。缺覆盖证据时不能声称完整。

- 状态：partial：共享算法、补读和归档去重已有代码证据。
- 当前修改/反证：只读与增量共用解析，重复累计/重置正确；session元数据续读保留，事件本地日期分桶，文件级缓存。请求收集器同步累计差分。
- 证据：rollout-recovery.test.js；value-realtime-local-api.test.js；price-cache-green.log（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：去重依赖session+timestamp；同刻多真事件、只有部分历史时的精确覆盖仍有限制。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D06｜Cursor多账号与导出覆盖

- 定位：`src/commands/sync.js` 的Cursor homes循环；`rollout.js/parseCursorApiIncremental`，必要时追 `cursor-config.js`。
- 区分多目录与多账号；确认是否共用cursor或清零范围而互相覆盖。按有证据的账号身份隔离统计，同账号副本去重；窗口替换必须有完整覆盖证据。不要凭目录名假造账号，也不能直接删除一个目录规避问题。
- 验收：A100+B200=300，换读取顺序不变；同账号重复目录不双计；局部/缺页/失败/完整空导出不误删其他账号或窗口外历史。身份暂缺时保留待解决，不把风险标已修。

- 状态：partial：全部账号先收集再统一提交。
- 当前修改/反证：同userId目录去重；任一账号失败或已知账号集合缩小则保留旧快照；仅更新出现的桶。
- 证据：cursor-account-exports.test.js；cursor-account-green2.log（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：缺页/同桶部分导出/完整空导出没有上游覆盖证明，不能保证替换完整；账号完整隔离仍依赖D07。真实Cursor账号未授权验证。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D07｜归属在聚合前丢失

- 定位：`rollout.js/addAttributedTotals`、`mergeProviderAttribution`、归属切片/入队键；`usage-attribution.js` 及读端。
- 核查仅按计费模式分桶导致不同provider/account/credential/plan混合或挂到最后一条。按现有可靠身份作必要分拆、元数据修订与兼容；写、读、总览、审计一起验证，不只补读端键。证据冲突不可留下错误的明确归属。
- 验收：同source/model/时间内多账号、多Key、API/套餐能按可靠证据分开，顺序不影响总量/归属；只修订归属而Token不变也能更新；旧新桶共存不重复。无法恢复的历史身份明确未知，不猜。

- 状态：partial：阻止混合桶冒充最后一个账号；完整分桶受阻。
- 当前修改/反证：provider/account/credential/plan冲突字段变未知，数量保留；仅归属变化进入入队标识；审计拒绝独立清单身份碰撞。
- 证据：rollout-recovery.test.js；attribution-boundaries.test.js；mixed-identity-green2.log（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：正式队列身份仍仅source/model/time/billing_mode；云端模式快照和旧5列fallback不支持完整身份。需要协同持久化/读端/云兼容设计，未授权迁移；旧混合桶不能凭空还原。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D08｜项目读取缺模型维度

- 定位：`local-api.js/readProjectQueueData`，对照项目队列写入。
- 补齐写入已有而读端遗漏的身份，处理旧聚合与新模型分项的关系；不能把所有unknown模型当成可删重复，也不能用全局模型构成反推单个项目。
- 验收：同项目同时间模型A100+B200=300；同身份的新快照只取最新；换顺序、重读和旧数据共存结果正确，项目与可比总量一致。

- 状态：partial：项目模型维度已改。
- 当前修改/反证：读取保留model；取消全局模型比例反推单项目。按同身份latest-wins。
- 证据：usage-caliber-consistency.test.js；request-usage-records-api.test.js（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：旧unknown汇总与新模型细项没有覆盖标识，仍不可擅自删旧或声称全历史去重。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D09｜请求筛选、日期、截断和历史覆盖

- 定位：`local-api.js/buildRequestUsageRecordsList`、`/functions/tokentracker-request-usage-records`、直接收集器及显示端。
- 分别核查四个子问题：原始/聚合分支模型筛选不一致；本地日被UTC转换偏移；先截断再标all_matching；存在部分原始日志就替换该来源全部历史聚合。筛选应在相关截断前生效；日期使用同一明确日历语义，DST日不能盲算24小时。
- 验收：模型不混入；上海/洛杉矶及DST边界一致；1200条样例可正确反映覆盖。允许保留现有1000条容量限制，但必须真实显示部分合计/覆盖未知，不能伪造全量数量；恰好1000条不能断言还有更多。原始与汇总只按可证明的覆盖关系组合，保持旧历史。未提供全量浏览则明示现有限制，不宣称功能已扩展。

- 状态：partial：筛选、日历、截断范围已有代码和组件证据。
- 当前修改/反证：筛选前置；共用日历/DST边界；返回truncated/has_more/totals_scope并显示部分/未知合计。原始与汇总按桶比较。
- 证据：request-calendar-boundary.test.js；request-usage-records-api.test.js；use-request-usage-records.test.tsx（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：1000容量保留；原始与汇总以桶总量相等作为替换条件，仍不足以证明所有归属/分项完整，未宣称全量浏览。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D10｜读取失败不等于没消费

- 定位：`src/lib/fs.js/readJsonStrict`、`sqlite-reader.js/readSqliteJsonRows`、`sync.js` 的错误及成功时间、受影响API/页面。
- 关键状态损坏不能以空状态覆盖；SQLite忙、缺表、权限、格式不支持不能都变成成功空库。复用严格读取/错误/旧快照机制，必要时兼容扩展受影响调用，不全局破坏helper协议。全局sync结束不能替代每个来源成功。
- 验收：missing、真空库、损坏、忙、权限和缺表分别可辨；错误保留最近成功值和原时间；恢复后可继续采集。确无历史时显示不可用而非精确0。不能只写控制台错误而UI仍标正常。

- 状态：partial：关键游标、SQLite及错误展示贯通一部分。
- 当前修改/反证：损坏游标拒绝覆盖；严格SQLite保留错误；OpenCode/Kilo读库显式strict，真空库仍进入健康状态；来源失败保留成功时间，接口不暴露错误内部信息，页面提示。
- 证据：collection-health.test.js；sqlite-reader.test.js；sqlite-health-stage8.log（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：已补busy/缺表/权限/损坏错误分类和sync提前异常时健康落盘。各来源内部静默catch尚未全部消除；Windows真实权限拒绝和缺失状态全UI链仍未验。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D11｜不完整结果被标exact

- 定位：`src/lib/realtime-session-view-model.js/buildSession`、`tokenMetric`、直接显示端。
- 不能只要some记录有数字就声称完整准确。只考察应贡献该指标的记录；无usage的生命周期元数据不自动算漏记。保留正确0、已知部分和既有证据级别，不把估计/缺失升级exact；标记必须实际显示。
- 验收：应计入的100+未知为部分数据；完整100+0保持准确；估计不升级；旧快照与新观测时间区分。缺失请求状态不能编成成功，未知活跃状态不等于确定0。

- 状态：partial：指标证据级别及观测时间已改。
- 当前修改/反证：100+未知为partial，100+0为exact，估计不升级；元数据不当贡献；未知活跃值为null；页面显示标记且使用数据时间。
- 证据：realtime-session-view-model.test.js；RealtimeSessionsPage.test.jsx；ui-source-refresh-333.png（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：已补无usage终止事件：保留实际状态、数值为null、不计算金额；仅有未知usage时总量null，混合数据标覆盖未知。请求接口/类型/组件已回归，最终安装版请求旅程未验。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D12｜审计器自身漏审

- 定位：`scripts/audit-token-correctness.cjs/rowKey`，对照当前正式队列身份。
- 至少保留合法计费模式分桶；若D07/D08修订身份，审计同步对齐。区分累计快照修订与重复消费，不能把同桶多条直接判成多次消费。期望值由独立样例给出，不复制被测算法自证。
- 验收：API100+套餐200=300；同身份快照100→150只计150；身份维度不漏。与独立样例清单对账时故意漏一条/多算一条/错归属能够发现；单靠账本内部等式不能声称已证明无漏记。不建设大型审计平台。

- 状态：partial：独立对账已有代码证据。
- 当前修改/反证：审计保留billing_mode，快照修订不叫重复消费；独立expectedRows检漏、多、错量、错归属。无清单ok=null。
- 证据：audit-token-correctness.test.js；token-audit.test.js；mixed-identity-green2.log（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：仍受D07正式身份维度限制；没有真实完整独立清单，不能宣称整本账无漏记。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D13｜Claude项目分支未定义变量

- 定位：`rollout.js/parseClaudeFile` 及 `parseClaudeIncremental` 调用者。
- 验证项目分支引用repoRoot却未传入的作用域问题；显式传递已有正确上下文，不把日志目录冒充项目，也不为修参数重做项目识别。
- 验收：触发该生产分支时无ReferenceError；无项目正常；有项目时归属及总量正确。不能扩大成“所有Claude采集都坏了”。

- 状态：partial：项目分支作用域已有代码证据。
- 当前修改/反证：显式传repoRoot到Claude项目解析分支，保留现有项目发现。
- 证据：rollout-recovery.test.js；final-node-focused.log（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：真实安装版项目归属旅程未运行。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D14｜Windows子会话与Kiro路径

- 定位：`rollout.js` 的subagents判别、Kiro路径函数；`sync.js` 与已有目录配置。
- 两个子项分别核查：正反斜杠导致子会话误判；Kiro IDE默认路径只覆盖某平台且配置未贯通。区分Kiro IDE/CLI。用当前支持平台的实际目录或对应版本资料补局部适配，不猜路径、不顺手扩展全部平台。
- 验收：Windows子会话不计主会话用户消息，其Token仍保留；正反斜杠、中文/空格路径与明确自定义目录可用；Kiro实际支持路径贯通到解析。未知平台/格式保留未验证说明。

- 状态：partial：Windows分隔符与Kiro存储路径已改。
- 当前修改/反证：Windows子会话用户消息不计主会话、Token保留；Kiro IDE按APPDATA及显式KIRO_IDE_STORAGE_DIR；自定义DB/JSONL模型目录同根。
- 证据：kiro-paths.test.js；kiro-stage5.log；rollout-recovery.test.js（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：常规APPDATA未发现Kiro安装；目录设置UI未新增Kiro键；其它平台/格式未扩展，Kiro CLI单独保留。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D15｜长任务同步锁与漏触发

- 定位：`fs.js/openLock`；`sync.js` 的finally和相关触发入口。
- 验证按5分钟老化误接管活跃任务、旧owner删除新锁和忙时触发丢失。对现有单写机制补必要的所有权、存活/恢复检查；不能仅延长超时、无条件unlink或把所有失败无限重试。时钟/进程模拟只在隔离测试中进行。
- 验收：活跃任务超阈值不被接管；崩溃可恢复；旧owner不能删除新owner锁；并发触发后新数据仍能补采。必须检查Windows实际文件/进程行为，Linux结果不能冒充Windows通过。

- 状态：partial：实际Windows文件/进程层四项通过。
- 当前修改/反证：活跃PID不按年龄接管；死进程可回收；owner token校验释放；busy留下pending，成功退出补采。Windows内核命名管道门随崩溃释放，堵住恢复竞争。
- 证据：fs-lock.test.js；recovery-independent-stage6.log；final-node-focused.log（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：Windows新增内核命名管道门，序列化获取和回收；检查—删除竞争反例、跨进程排他及崩溃释放已验证。混用旧版进程、非Windows并发及全部pending压力边界未验。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### D16｜准确数据及时到达各显示端

- 定位：`RealtimeSessionsPage.jsx`、`SpendPage.jsx`、相关hooks/api缓存、服务同步/现有通知入口、小组件及胶囊的实际消费者。
- 先测“完整源记录可读→采集成功→接口→可见UI”，记录瓶颈；核查新日志发现、同步后缓存、价格/归属修订失效、焦点/休眠恢复。先接好现有免费Hook/日志增量/事件或刷新机制。必要的局部唤醒/查漏修复属于本项，不因“最小修改”一律禁止；新平台或第三方配置变更按权限门处理。
- 验收：源数据变化能触发正确采集与刷新，断线/恢复不永久丢更新；可比页面/小组件/胶囊显示一致，旧值时间不刷新成假实时。报告样本量、前后延迟和CPU/内存/磁盘影响，不虚构2秒达标；只改文案或轮询数字不算解决采集问题。供应商结算延迟另列，不高频撞限流。

- 状态：partial：隔离源→生产解析→真实接口→浏览器已跑。
- 当前修改/反证：发现并修正价格修改后请求缓存未失效。3次111递增到333自动可见；不刷新旧数据时间。
- 证据：price-cache-red.log → price-cache-green.log；latency-results.json；ui-source-refresh-333.png（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：样本3：可见上界2971/12782/5023ms，解析各5ms；仅解析进程CPU/RSS和队列写入字节，不是全应用资源前后基准。真实发现/Hook、断线休眠、widgets/胶囊、价格/归属UI全链未验。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### C01｜套餐与API归属证据

- 定位：`usage-attribution.js/createConfiguredTokenPlanResolver`、`test/usage-attribution.test.js` 及真实提供证据的适配器；与D07共用修复。
- 既有测试允许部分provider_receipt归属被配置套餐覆盖，不能直接反转。先分清字段代表认证形式还是真实计费方式；API形态也可能访问套餐。核对账号/Key/路由与有效期，保留明确运行证据和用户覆盖。不能因为买了套餐就覆盖不相关账号，也不能凭模型名猜。
- 验收：同供应商API与套餐并存，明确绑定互不误记；无可靠证据显示待确认，已有已知归属不退化。旧测试描述错误事实时，用核实契约同步修订；确需用户选择的业务规则具体询问，不自作主张。

- 状态：partial：显式账号/凭据绑定匹配已改。
- 当前修改/反证：配置声明account_ref/credential_ref时必须与usage相同；保留API路由可以使用套餐、provider_receipt不等于实付的既有事实。
- 证据：attribution-boundaries.test.js；usage-attribution.test.js（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：未绑定provider-only配置仍可能过宽；生产绑定是否代表真实账号未证明；真实账号及历史归属未验。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### C02｜Gemini现行日志格式

- 定位：`rollout.js/listGeminiSessionFiles`、Gemini解析器及当前支持版本的写入契约。
- 核对实际/声明支持版本的JSON或JSONL和消息修订。官方main不是已安装版本证明。已支持产品版本确有格式缺口时，补现有适配器的必要分支，与D03/D04一起验证；不建设未来版本框架。
- 验收：支持版本的历史/当前记录均能发现，迁移副本不双计；无样例或未知结构明确未验证/不支持，不能填0后称完整接入。缺检测能力仍是缺口，说明限制不等于已补齐。

- 状态：blocked：现行安装版本和格式证据缺失。
- 当前修改/反证：核对Gemini v0.24.0版本写入器，复用D03/D04；本机.gemini存在但未发现tmp/chats，常规npm位置无可识别安装版本。
- 证据：阶段3官方来源；gemini-message-usage.test.js（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：JSONL现行格式、迁移副本样例与用户安装版本仍缺；未增加猜测兼容分支。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### C03｜Claude额度比例与单位

- 定位：`src/lib/claude-token-plan.js`、`token-plan-refresh.js`，追到当前真正使用的适配器/UI。
- 验证是否启用 `<=1` 乘100的路径、上游比例究竟是0—1还是0—100、百分比是否错标Token。用脱敏响应或明确的对应接口定义核对，不假定旧路径代表当前主流程；缺证据不要改单位算法。
- 验收：0、0.5、1、50、100按已确认标尺及合法范围解释；null/缺字段不是0；百分比不是实际100个Token。未启用路径有证据可记当前不适用，不靠删除适配器消除风险。

- 状态：partial：缺失值与单位已改，比例标尺受阻。
- 当前修改/反证：null/空/布尔/负数/越界拒绝当0；percentage明确unit和quota_unit=percent，保留小数。当前official_account路径要求官网同步，另一路适配器仍存在。
- 证据：claude-missing-red.log；claude-unit-red.log → claude-unit-green.log（92通过）（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：0.5和1按0—1还是0—100解释仍缺对应OAuth usage接口证据；保留旧比例算法。不能拿statusline另一个接口代替；真实额度未验。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### C04｜其余已登记Agent的真实覆盖

- 定位：`shared/agent-registry.json`、`src/lib/agent-adapters.js`、`sync.js` 和实际对应解析器；清单以当前仓库注册表为准。
- 对已登记来源逐一核对支持范围与至少一份可追溯样例，优先用户在用的Hermes、DSH、WorkBuddy及OpenCode、OpenClaw。记录发现路径、Token/模型、账号/计费方式、请求状态/父子会话、原生额度、采集刷新哪些已验证、哪些上游未提供。先复用已有测试，不引入新Agent或追逐所有历史版本。
- 验收：发现目录不等于准确支持；当前已支持来源的实际缺陷补局部解析/路径/状态并回归。缺样例必须先查现有fixture、受支持版本官方实现或授权只读样例，仍缺才记受阻；未跑通的来源不能写“全部正常”。能力限制与已修Bug分别报告。

- 状态：partial：登记来源逐项映射，真实覆盖仍不完整。
- 当前修改/反证：28个登记条目映射生产入口/已有测试；只读检查优先来源的目录和脱敏字段结构，见来源表和阶段7—8。
- 证据：agent-registry.json；agent-adapters.test.js；full-node-final.log；source-structure-summary.json（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：没有逐来源真实版本、独立Token总数、账号/Key、父子状态、原生额度、刷新全链证据；不能称全部正常。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### U01｜视觉与组件样式

- 定位：实际启用页面，重点 `dashboard/src/styles.css`、`pages/value-realtime-pages.css`、既有基础组件。
- 在同窗口/主题/状态比较同类标题、卡片、控件。源码颜色或变量不同不是已证实视觉Bug；正常Agent品牌色/状态色不应强行统一。实际不一致按现有已认可组件局部对齐，不创建新设计系统或改侧栏布局。
- 验收：受影响同类组件尺寸、字号、间距和交互协调，正常明暗主题保留；视觉问题有前后截图及全页检查，无证据不做审美性改版。

- 状态：partial：实际截图确认的局部问题已处理。
- 当前修改/反证：保留视觉体系/侧栏；深色Agent小卡浅底低对比实际复现，局部复用现有背景变量。
- 证据：ui-dark-final-1586.png（修前）；ui-dark-cards-fixed-1586.png（修后）（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：所有来源状态和原生DPI未穷尽；未做无证据的统一美化。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### U02｜数字、金额、日期格式

- 定位：`RealtimeSessionsPage.jsx` 的number/money/compact/月选项，及已有格式化和文案工具。
- 核查固定语言、币种/精度、日期拼接和未知值，优先复用现有工具。只为修当前已证实不一致抽取必要小函数，不全仓替换。
- 验收：当前支持语言、币种、极大/极小值、0和未知按既定规则显示；API等价估值不冒充实际花销。

- 状态：partial：复用现有语言/币种格式化。
- 当前修改/反证：number/compact/time/month随copy locale；金额使用useCurrency+formatUsdCurrency，未知不写0。
- 证据：RealtimeSessionsPage.test.jsx；ui-stage5.log；full-dashboard-final.log（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：浏览器中语言/币种逐项切换、极大极小值全组合尚未跑完；API等価值不代表实付。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### U03｜时间轴与缺失点

- 定位：实时页 `FocusSparkline`、`RealtimeLineChart` 及实际数据点语义。
- 先分清时间轴与分类轴；时间轴上的不等间隔不能按序号画成等间隔。明确单位/聚合，零值与未知不同；只有明确缺数据才断开，不能把合法稀疏采样全部当缺失。不重建全项目图表库。
- 验收：不等时间间隔、单点、零值、明确缺失和切换周期绘制正确，既有交互不退化，平滑不伪造数值。

- 状态：partial：时间轴、缺失和单点已有代码及浏览器证据。
- 当前修改/反证：按真实时间比例绘图；null分段，0保留，单点画点；周期筛选不塞范围外点。
- 证据：realtime-chart.test.js；RealtimeSessionsPage.test.jsx；ui-dark-minimum-final.png（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：稀疏/明确缺失的全浏览器组合未全覆盖，安装渲染未验。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### U04｜当前Agent与全局范围

- 定位：实时页所选Agent主卡、`SidePanels`、限制显示设置与可比摘要。
- 追踪实际范围，同职责统一筛选；不同职责明确标当前Agent/全部可见Agent/当前周期，不强行让本来不同范围的数字相等。显示限制继续生效，不能悄悄删除隐藏来源历史。
- 验收：切Agent/周期/显示设置后标题、数值和提示同口径；隐藏来源不混进应受限卡片；合法全局卡片明确说明范围。

- 状态：partial：选中范围和全局标题已有交互证据。
- 当前修改/反证：局部选Agent，SidePanels明确全部Agent；Codex→WorkBuddy→Hermes和今天→7天→今天反向切换已执行。
- 证据：浏览器阶段7—8；RealtimeSessionsPage.test.jsx（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：全部Agent卡目前包含隐藏来源，标题明确但全部可见范围的产品一致性仍需核对；显示限制真实设置旅程未验。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### U05｜小窗口、缩放与交互

- 定位：实时页局部断点、WorkBuddy小卡、壳层间距及受影响组件。
- 用实际启动尺寸和最小支持尺寸核查遮挡、裁切、文字可读、展开/回弹/焦点及窗口缩放；10px或!important本身不能当作改版理由。有实际问题才局部修，不能靠隐藏必需字段解决。
- 验收：参考最小900×600（以当前配置为准）、实际Windows常用DPI及相关主题/状态下无明显遮挡；修改后检查整页及相邻卡片，不仅截局部。按仓库规则完成受影响用户旅程。

- 状态：partial：900×600与1586×932浏览器复查。
- 当前修改/反证：窄窗口摘要单列，构成图上下排列防日期重叠，workspace无横溢出，小卡数字允许换行；深浅主题复查及页签切换。
- 证据：ui-after-light-900.png（修前）；ui-minimum-composition-final.png、ui-dark-minimum-final.png、ui-dark-cards-fixed-1586.png（修后）（日志/图片位于 artifacts/05450/evidence）。
- 未解决或未验证：Windows系统DPI、最终WebView2、密集0/1/2/5/10来源和完整键盘焦点/回弹未验。
- 第一审：逐条核对后为 PARTIAL/BLOCKED，缺上述证据，不签通过。
- 第二审：最终安装制品未生成/安装，NOT_RUN；浏览器证据不能替代。
- 历史：真实历史未改写，不宣称账本已修正。

### 阶段复核 1

- Node修改前聚焦基线314/314；Dashboard正确工作目录基线108/108。首次Dashboard命令cwd错误造成ENOENT，已归为执行错误而非产品失败。
- 已改生产文件：rollout.js（完整记录、项目/路径、失败恢复）、fs.js（锁所有权）、sync.js（去除重复无条件删锁）。未改真实历史、规则、版本或其他工作树。
- D02深拷贝避免浅引用污染；队列保留累计快照/latest-wins语义，不将失败写入算成功。D01指纹仅检查已读区头尾256字节，任意中间就地篡改不在已验证范围，原子替换另测。
- D13代码层第一轮通过；安装版两审未运行。其余编号和子项仍保留，尚无整项验收通过。

### 阶段复核 2（已触及5个生产文件）

- 新增 sqlite-reader.js 的 opt-in strict 错误协议，默认调用兼容；sync.js 严格读游标，损坏不能降为空。D10仍未闭合：严格选项与逐来源状态/UI需继续贯通。
- realtime-session-view-model.js 对100+未知输出partial、100+0保持exact、估计保留estimated，26项回归通过；D11直接显示标记及未知活跃状态仍待核。
- 锁、完整行、项目、失败回滚的聚焦回归见stage2-node.log；未触及真实历史、云或第三方设置。没有把辅助测试标为安装验收。

### 阶段复核 3

- Gemini 183项、项目/请求接口31项、请求覆盖40项、时区22项、Codex只读/解析191项通过（独立日志位于artifacts/05450/evidence）；不拼接为最终通过。
- 官方字段依据：https://raw.githubusercontent.com/google-gemini/gemini-cli/v0.24.0/packages/core/src/services/chatRecordingService.ts 与 https://ai.google.dev/api/generate-content#UsageMetadata ，查证2026-09-22；并非用户安装版本证明。
- D08旧测试要求从全局模型占比推断单个项目，违反附件且无原始证据，已改为保留unknown，未删项目历史。
- 实际共用算法修订触及local-api.js、usage-attribution.js日期helper、claude-request-usage.js和audit脚本；范围仍是原编号。

### C04 登记来源逐项入口（当前仓库）

|来源|生产解析入口|现有可追溯合成样例入口|真实版本/账号/原生额度/刷新|
|---|---|---|---|
|Claude Code|parseClaudeIncremental|rollout-parser.test.js、rollout-recovery.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Codex|parseRolloutIncremental|codex-fork-replay.test.js、rollout-git-config.test.js、rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Every Code|parseRolloutIncremental|codex-fork-replay.test.js、rollout-git-config.test.js、rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Cursor|parseCursorApiIncremental|cursor-billable-total-tokens.test.js、rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Trae|parseTraeIncremental|trae-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Gemini CLI|parseGeminiIncremental|collection-health.test.js、gemini-message-usage.test.js、rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|OpenCode|parseOpencodeIncremental|rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|OpenClaw|parseOpenclawIncremental|openclaw-session-plugin.test.js、openclaw-hook.test.js；专属独立计数样例仍缺|未验证；不得用发现目录或合成样例声称完整支持|
|Kilo CLI|parseOpencodeDbIncremental|kilo-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Kilo Code|parseKilocodeIncremental|kilo-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Roo Code|parseRoocodeIncremental|roocode-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Kiro（含 CLI）|parseKiroIncremental|kiro-fallback.test.js、rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Kiro CLI|parseKiroCliIncremental|rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Hermes Agent|parseHermesIncremental|billing-mode-derivation.test.js、rollout-parser.test.js、usage-attribution.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Kimi|parseKimiIncremental|rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Kimi Code|parseKimiCodeIncremental|rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|CodeBuddy|parseCodebuddyIncremental|rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|WorkBuddy|parseWorkbuddyIncremental|待沿注册入口核查|未验证；不得用发现目录或合成样例声称完整支持|
|oh-my-pi|parseOmpIncremental|rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|pi|parsePiIncremental|rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Craft Agents|parseCraftIncremental|rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Grok Build|parseGrokBuildIncremental|local-api-legacy-codex-schema.test.js、rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|GitHub Copilot|parseCopilotIncremental|rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Zed Agent|parseZedIncremental|zed-goose-reset-cursor.test.js、zed-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Goose|parseGooseIncremental|goose-parser.test.js、zed-goose-reset-cursor.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Droid|parseDroidIncremental|droid-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|Antigravity|parseAntigravityIncremental|rollout-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|
|DeepSeek Harness|parseDeepSeekHarnessIncremental|agent-adapters.test.js、deepseek-harness-parser.test.js|未验证；不得用发现目录或合成样例声称完整支持|

### 阶段复核 4

- UI链路已触及5个生产文件，新增时间坐标/缺失分段小helper，复用既有币种/语言，传递请求截断范围并显示。未改侧栏、页面职责或视觉体系。
- 隔离浏览器第一次自动发现了宿主Codex生命周期（Windows AgentData磁盘发现独立于HOME），ui-before-1586.png失效；随后明确注入空生命周期/只读回退，ui-isolated-realtime-before-1586.png为合成数据浏览器基线，不能证明真实采集或安装。
- 全量Node阶段回归2544项：2520通过、16失败、8跳过。失败逐项追查：6个缺SQL文件、2个GLM静态条目时效断言、构建身份门和.tmp前置目录；另6个Codex相关失败。保留日志，不将失败删除。
- Codex复核发现共享解析后丢了非整小时本地日期分桶，已传入事件日期；恢复每文件缓存，避免活跃父会话令全部子文件重复读取。测试的I/O注入随readCompleteJsonl改为fs.promises.open；新增消费样例用独立时间戳，旧样例同时间同内容本应去重，缓存/恢复预期保留。
- D06/D07/C01仍非通过：Cursor导出无覆盖证明；归属只有计费模式桶且云upsert仍按旧身份，不能仅改本地键导致新旧桶双计。正在核查最小兼容方案与证据缺口。

### 阶段复核 5—6

- 先复核再推进：Cursor账号收集helper仅改变原循环提交边界；全部账号先成功再统一入队，同账号目录按userId哈希去重、账号集合缩小则报错保留旧值。导出未出现的模型/时桶不清零；不声称已证明单桶完整导出或修正旧历史。
- D07根因复现：同桶100+200原先把300全部写为最后一个account_ref。现冲突绑定不再伪装精确归属，数字保持300；金额/Token未改作实付。完整身份拆桶仍未做：原持久桶、云upsert及旧桶需要共同迁移/覆盖证据，当前不能宣称账号账本准确。
- C01只增加显式account_ref/credential_ref绑定匹配，保留现有API形态可使用套餐的规则；未直接反转provider_receipt既有测试。生产配置无法提供可比绑定的范围仍未闭合。
- Kiro Windows路径依据厂商仓库一手问题10267/4917与现有IDE结构；本机常规APPDATA位置未发现安装，不能声称实机可用。增加Windows APPDATA和KIRO_IDE_STORAGE_DIR显式存储路径；自定义db/jsonl的模型目录沿同一根查找。未猜新格式、未扩大Linux支持。
- 代码回归：kiro-stage5.log 171通过/1跳过；cursor-account-green2.log 233通过；mixed-identity-green2.log 71通过；ui-stage5.log 89通过；UI lint、类型、构建退出0。
- D01读中追加边界、D02独立进程在游标提交前/后退出再读、Windows锁合计21通过（recovery-independent-stage6.log）。这是代码/文件系统层，未替代安装版重启。
- 最小窗口截图证实摘要金额卡裁切；已增加761—1050宽度下单列摘要卡断点，待新生产构建全页复核。未修改主视觉方向/侧栏。

## 独立子项复核（代码证据不等于安装通过）

|独立子项|当前证据/缺口|
|---|---|
|D01 半行、UTF-8/CRLF、无换行完整行、完整坏行|生产解析器合成输入通过；保留未消费尾部|
|D01 读中追加|在真实文件读取时追加，下一检查点才消费，测试通过|
|D01 截短/原子替换|重写/替换样例通过；任意中部等长改写未覆盖|
|D02 主队列写前/部分写/项目失败|异常注入回滚磁盘及深层游标，通过|
|D02 游标提交前/后退出|两个独立进程退出再读通过；不能代替完整cmdSync落盘边界|
|D02 双队列崩溃中断|分别在主/项目部分追加后进程退出，再读不丢不重，残片保留；安装版未验|
|D05 重复/累计重置/归档副本/fork|生产共享解析器、请求器及既有fork用例通过|
|D05 部分队列/跨日续写|相关接口样例通过；历史完整覆盖未证明|
|D06 多账号/同账号副本/失败|统一提交、账号ID去重、失败保留，代码通过|
|D06 局部/缺页/完整空导出|没有可信覆盖协议，未闭合；不得清空旧桶|
|D06 窗口外历史|未出现桶保留；不证明同桶导出完整|
|D07/C01 多provider/account/key/plan|冲突字段不再挂最后账号；完整身份隔离未闭合|
|D07 仅归属修订|入队标识包含归属；旧新混合账历史未恢复|
|C01 认证与计费/覆盖有效期|保留既有路由套餐契约和有效期测试；真实绑定不明|
|D09 模型筛选/日历/DST|生产接口与独立日期样例通过|
|D09 截断/恰好1000|保留容量，显式has_more/totals_scope；不是全量浏览|
|D09 原始/汇总覆盖|按桶总量核对仍不等于完整身份及分项证明|
|D10 missing/真空库/损坏|关键读取已有区分；并非所有来源均贯通|
|D10 busy/权限/缺表|严格读分为BUSY/PERMISSION/SCHEMA/CORRUPT；真实SQLite空/缺表/忙/损坏通过，真实权限故障未注入|
|D10 最近成功/UI/恢复|合成错误→恢复和接口脱敏通过；全部源UI链未验|
|D11 partial/0/estimated/元数据|模型和组件用例通过|
|D11 观测时间/活跃未知|浏览器观察数据时间和暂无数据；旧值不按接口now翻新|
|D11 无usage的终止请求|保留中断/失败状态；数值null，金额不伪造；接口回归通过，安装UI未验|
|D14 Windows子会话|Windows真实文件路径测试通过，中文/空格路径有样例|
|D14 Kiro默认/自定义/CLI|路径测试通过；IDE默认安装不存在，设置UI入口未贯通|
|D15 活跃超阈值/崩溃/owner释放/补采|Windows文件及子进程测试通过|
|D15 并发恢复竞争|Windows命名管道门+实际并发反例通过；旧版混用/其它平台未验|
|D16 完整源→采集→API→UI|3个合成增量样本可见；测试直接调用解析器|
|D16 发现/Hook/焦点/休眠|源码有15秒、focus/visibility刷新；真实系统旅程未验|
|D16 价格/归属失效|价格修订缓存反例RED→GREEN；归属及价格全显示端未验|
|D16 小组件/胶囊/资源前后|未验；局部解析资源样本不能代替|
|C04 各来源Token/模型|已有测试与入口映射；WorkBuddy和DSH只读结构证据见下|
|C04 各来源账号/计费/状态/父子/原生额度/刷新|未形成逐来源真实证据，均不得整体判通过|
|U01 明暗主题|实际发现深色小卡低对比并复查改后；其它同类组件保留|
|U02 语言/币种/大小数/0/未知|格式化及组件测试；浏览器完整切换矩阵未跑|
|U03 不等间隔/单点/0/明确缺失|几何测试通过，浏览器单点可见；全状态未跑|
|U04 Agent/周期/限制|Agent及周期正反切换有证据；限制设置未完整走|
|U05 窗口/主题/交互|900×600、1586×932、页签反向切换及明暗主题；原生DPI/密集来源未验|

## 阶段复核 7—8

- UI实际观察后才改：900×600摘要金额裁切、图表日期重叠、workspace横溢出；使用窄窗口局部断点，复查clientWidth=scrollWidth=593。小卡数字可完整换行。深色小卡浅底造成低对比，复用现有surface颜色后截图复查。未改侧栏、正常Agent品牌色或页面职责。
- 真实浏览器操作：四个分析页签来回切换；Codex→WorkBuddy→Hermes→Claude；今天→7天→今天；浅色→深色→浅色。主题按钮有不同accessible name，早期精确文本定位超时属自动化定位错误，改按已观察按钮操作；不能计作产品失败。最终截图都是隔离数据，不含宿主会话。
- C03缺失值与单位：空/null/布尔/非法范围不再作0；额度unit与quota_unit改percent，保留小数。保留比例算法以避免在没有对应接口契约时猜标尺；92项回归通过。
- D10 OpenCode/Kilo默认调用显式strict，失败保存来源错误而不当空；空库也进入解析健康记录。185项相关回归通过。仍有来源内部静默catch和提前异常时持久化缺口，未宣称贯通所有来源。
- D04非法计数字段用反例锁定；上游input/output/cached/thoughts/tool/total只保存数值于消息游标账以审计，不记录正文。175项相关测试通过。
- D16请求价格缓存复现1→2后仍读1，加入价格配置签名后34项通过。没有提高轮询频率。
- D16可见时延3个样本：2971/12782/5023ms（从完整源记录可读到观察可见的上界）；解析各5ms。进程CPU采样0/16000/0微秒（Windows粒度有限，不等于零负载），RSS增量368640/380928/401408字节，每次队列追加342字节。仅解析进程，不含browser/backend资源，不是修前/修后性能对照，也未测供应商结算延迟。证据latency-results.json。
- C04只读结构：WorkBuddy生产resolver发现9文件；对全部9份只提取字段和一致性计数，20条rawUsage的total均等于prompt+completion；缓存镜像、推理镜像无冲突，cacheWrite均0。其余层级出现input_tokens不代表生产providerData.rawUsage走该形态，没有盲改解析。新增同字段/合成数值专属解析测试，与DSH/registry共44通过。DSH发现11文件，取5份小文件沿生产usage路径读取，1332项usage字段为inputTokens/cacheReadTokens/outputTokens/reasoningTokens。均未保存正文/原始ID/密钥/Cookie，不能证明真实总账和账号额度。
- Gemini实际目录存在但未识别会话/版本；Hermes/OpenClaw仅有目录不足以证明支持；OpenCode默认数据位置不存在；Kiro默认IDE存储未发现。缺样例不是通过。

## 当前测试与第一审结果

- 第一审逐项对照上述合同、当前diff、生产模块用例与浏览器证据。结果 **PARTIAL / 不通过**：多项技术缺口仍未解决，不能只把阻塞归于安装权限。
- 最后全量Node：2568项，2551通过、9失败、8跳过，退出1（full-node-final-review.log）。阶段9新增问题已复核，当前仅剩已在HEAD复现的9项基线失败。
- 最后全量Dashboard：1902项，1901通过、1失败，退出1（full-dashboard-final.log）。
- 9个Node失败已在HEAD隔离副本复现：6项缺scripts/ops/leaderboard SQL文件；2项GLM静态额度is_stale断言；1项Windows构建身份unknown拒绝门。证据baseline-failures-stage4.log。前端失败为PlanMarketPage缺Grok标签，基线同样复现，见baseline-ui-failure.log。原有失败保留，不修与本轮无关的发行/市场逻辑，不删除失败断言。
- lint使用仓库约定src范围退出0（final-lint-src.log）；最初扩大到eslint .扫到edge-patches/config得到265错误，属额外范围检查，不能冒充仓库lint命令失败。
- 类型、Vite生产构建、注册表、copy、UI硬编码、data-display-policy均退出0。构建只证明dashboard/dist可生成，不代表安装版可用。
- 全仓架构检查退出1：artifacts/05450/tmp下两个本轮测试负例schema.sql被扫描命中。清理精确临时目录被自动审批拒绝（blocked by policy），未重试绕过，目录保留。不把这次检查记绿，也没有放宽扫描规则。
- git diff --check退出0；CRLF提示不等于差异错误。最终源码指纹见evidence/source-fingerprint.json。

## 第二审启动检查：BLOCKED / NOT_RUN

- 重新核对最终产物入口为Tauri的dashboard/dist，版本仍0.54.49，工作树未提交。当前没有本轮固定SHA制品，也没有安装后的manifest/用户界面证据。
- 附件第二节第3条：提交、推送、合并、改版本号、部署、Release和覆盖安装分别需要明确授权；第4条：安装/原生验证的仓库外操作要确认权限与隔离方法。CLAUDE.md产物门要求同一已提交SHA及获授权安装包。当前仅获新干净工作树及本地修复授权。
- 当前可调用浏览器工具可检查隔离Chromium，但没有已确认可用的最终WebView2/桌面GUI全旅程自动化链。旧安装包、旧截图或本轮网页截图不替代此证据。
- 因而第二审未执行，不能把再次跑单测或浏览器检查称作第二审通过。没有打包、覆盖用户安装或提供未验证安装包。

## 后续必要边界与具体缺口

1. D07/C01：本地正式identity只有source/model/time/billing_mode；云入口dashboard/edge-patches/tokentracker-ingest.ts的fallback仍按user/device/hour/source/model upsert。只改本地key将让另一端覆盖或重复。最小扩大方案应先定义向后兼容的完整身份切片/覆盖协议，再联动本地写读审计和云接收；可先只在隔离fixture验证，不迁移真实历史。实际云/schema变更及真实历史改写须另行授权，风险是旧桶重复或被错误覆盖。当前不能给出已完成迁移承诺。
2. D02/D10/D11/D15：阶段9继续复现并处理了部分写入崩溃、错误分类/落盘、无usage终止事件及Windows锁恢复竞争。仍需最终安装实测和所有来源错误传播/混用旧进程等边界验证；不能凭授权自动判通过。D06导出覆盖与C02/C03需要对应版本/脱敏响应证据，不能编造。
3. D16/U02/U04/U05：真实触发、系统恢复、各显示端、币种语言/限制/DPI矩阵仍缺；最终安装双审要固定源码提交、明确隔离安装路径与系统副作用，并具备桌面观察能力后运行。即使获授权也不提前保证通过。
4. 未改写真实历史、未推送/合并/发布、未改版本、未读取凭据或发起真实付费请求。旧账修复需单独差异预览/备份/恢复及授权。

## 阶段复核 9（第一审继续发现问题后的补修）

- D15：lock-race-red.log复现两个owner抢同一个死锁文件。Windows使用Node内置net命名管道串行化获取/回收，进程崩溃由内核释放；不新增依赖，不安装服务，不写系统配置。lock-race-green.log 23通过，含另一个真实Windows进程在旧lock文件消失时仍无法抢占。旧owner释放测试改为明确写入替代owner标记并验证不删除；没有删断言回避失败。其它平台保留旧文件锁，未声称跨平台压力通过。
- D11：request-missing-red.log复现仅turn_aborted也被显示为0Token/0金额。现usage_available=false、数值null，保留真实499状态；不价格计算，不拿元数据代替消费桶。全未知合计null、部分未知合计显示范围未证实。request-missing-green.log 189通过；types-stage9.log退出0；ui-stage9.log52通过及request-ui-stage9.log35通过。第一次vitest命令给错RequestUsageLog文件位置只匹配两文件，随后补跑正确__tests__路径，不夸大覆盖。
- D10：health-persist-red.log复现坏游标退出但未保存错误。现在读取健康文件也严格校验，sync失败finally保存tracker错误并释放锁；原来源成功时间和原坏游标保持。health-persist-green.log33通过。SQLite新增分类错误码，sqlite-native.log用真实node:sqlite验证空库/缺表/独占锁/损坏9通过；权限码为注入验证，不冒充ACL实测。
- D02：torn-queue-red2.log两个独立进程在主/项目队列部分追加后退出，重启时尾行与新行拼接导致坏JSON。现在先将尾部残片以SHA命名保存在同目录，再仅截去未完成最终行；完整无末换行JSON加换行保留。正常队列仅多读末字节；异常恢复最多读取1MiB，超限拒绝猜测。torn-queue-final.log29通过；全量解析关联torn-queue-green.log195通过。仅在隔离fixture执行，没有改用户真实队列。第一次测试生成脚本自身语法失败未加入反例，日志torn-queue-red.log不能算RED；真正反例为red2。
- 工作树仍未提交；同版本0.54.49。第二审仍NOT_RUN，技术补证没有替代固定SHA安装制品验收。

### 第一审补充纠错与待授权范围

- full-node-stage9.log实际为2568项、2550通过、10失败、8跳过。曾在仅看到尾部错误时误报为“仍9项失败”，随后已向用户更正。新增的第10项是DSH迁移测试要求损坏尾行留在主队列；与本轮先备份再修复尾行的新合同冲突。
- 已同步DSH断言：主队列无损坏尾行，残片备份字节完全相同，原api_key=11/token_plan=22及cloud兼容合计33和重复重放不增的断言全部保留。dsh-tail-contract.log43通过。不是通过删除或弱化业务断言取绿。
- D07/C01扩大范围问题已发出，尚未收到答复不能视为授权。建议范围仅当前工作树：rollout.js现有归属快照、usage-attribution.js身份/绑定、local-api.js各读端、audit-token-correctness.cjs独立对账，以及dashboard/edge-patches/tokentracker-ingest.ts与相应兼容fixture。保持现有总量读端可用、无可靠身份保留unknown，必须验证A100+B200=300、读取顺序/重试不变、仅归属修订有效、旧新桶不双计，以及旧云读端保持总量而不假报精确身份。不得直接修改线上schema或真实队列；若现有JSON快照仍不足再提出必要迁移，而非默认建设新账本平台。
- 此阶段结束时尚未获得提交或隔离安装授权；后续提交推送授权见文首。当前结果仍为可审查代码与证据，非可验收安装交付。

## 提交前封存指纹与审查结论

- HEAD：2f38d623578544833e3726c0ab81010939cfbeeb；分支codex/token-eyes-05450-fixes。41个修改/新增源码与测试文件另加本状态文档，未提交。
- 源码变更清单SHA256（包括未跟踪文件，排除状态文档）：9e745a6ea2e5bd474da1d410a79ec37d77a3f4d2328f95723346e255951fd22d。
- dashboard/dist文件清单SHA256：df9b8725d1c24eb00e7ff6072b1fda29ec3b2dd5a936838fd0998203b4ac7f37。详情artifacts/05450/evidence/source-fingerprint.json。
- 最后全量Node full-node-final-review.log：2568项/2551通过/9失败/8跳过。最终Dashboard全量1901通过/1基线失败，后续受影响组件87项通过、类型/构建/lint通过。
- 第一审PARTIAL/不通过；第二审BLOCKED/NOT_RUN。D06覆盖、D07/C01身份与历史兼容、C02/C03版本/比例证据、C04全来源真实覆盖、D16及U02/U04/U05原生完整旅程等缺口仍保留。上述代码辅助证据不得转述为全项修复。
- D07/C01扩展兼容范围授权问题待用户答复；当前未推断授权。测试服务结束后关闭本轮隔离浏览器/服务器，所有证据保留在工作树。
