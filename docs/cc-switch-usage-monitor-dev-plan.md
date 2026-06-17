# CC Switch 二开:多环境Token用量监控面板 — 开发计划

> 本文档面向 Codex / Hermes Agent 执行,按阶段顺序逐条完成,每条任务给出目标文件/模块位置与验收标准。完成一条勾选一条,不要跳阶段。

## 0\. 项目背景与边界

**目标**:基于 CC Switch(`farion1231/cc-switch`)二次开发,移除模型切换/MCP/skills能力，仅使用agent配置token检测使用统计,新增 Hermes / OpenClaw 用量适配,统一展示 Windows 与 WSL 两环境的Agent用量,新增费用核算(月度花销、累计花销、手动订阅费)与基于历史速率的消耗预测。

**明确不做(本阶段范围外,以后再议)**:

* 不做反向代理 / 多账号负载均衡(ccflare 类思路,风险高)
* 不做菜单栏极简常驻模式(已有可视化 Dashboard 即可)
* 不做终端状态行嵌入式监控
* 不做多用户 / 成就系统 / 团队协作

**借鉴对象与边界**:

* 借鉴 **ccusage** 对 Hermes Agent / OpenClaw 本地日志格式的解析规则,作为新适配器的实现参考。
* 借鉴 **Claude-Code-Usage-Monitor** 的"燃烧速率(burn rate)+ 预测耗尽时间 + 套餐档位自动识别"算法思路。
* 技术栈不变:Tauri + Rust(服务层) + React/TS(前端) + SQLite。不引入新框架、不新增代理服务进程。

\---

## 阶段0:环境准备

1. Clone `https://github.com/farion1231/cc-switch`,基于最新 release(当前 v3.16.x 系列)创建开发分支 `feature/usage-monitor-rework`。
2. 安装依赖并跑通现有项目,确认现有"Win端Codex用量统计"与"WSL端Claude Code用量统计"功能在你的机器上正常工作,作为后续开发的基线(baseline)。
3. 通读现有用量相关代码,产出一份"现状文件清单",至少包含:数据源适配器所在目录(参照其 OpenCode 适配器实现位置)、usage\_records 表迁移文件位置、Dashboard 前端组件目录、现有"路径自动检测+自定义覆盖"设置模块位置。

**验收标准**:基线版本可正常编译启动,现状文件清单已记录在仓库 `docs/dev-notes/` 下。

\---

## 阶段1:功能裁剪(移除模型切换)

4. 定位并移除/隐藏 Provider 切换相关 UI 入口与对应 Tauri 命令——只裁剪"切换模型/切换Provider"的操作能力,**保留**"识别当前正在使用哪个 Provider"的能力(用量归因仍需要它)。
5. 清理裁剪后遗留的前端状态管理与路由引用,确保编译无报错、应用可正常启动。

**验收标准**:主界面不再出现"切换 Provider"按钮及相关操作入口,但用量统计、当前Provider识别功能不受影响。

\---

## 阶段2:数据层扩展

6. 编写数据库迁移脚本,在 usage\_records 表新增字段:`billing\_mode`(api\_key / token\_plan)、`plan\_cycle\_type`(5h / weekly / monthly)、`plan\_start\_at`、`plan\_end\_at`。
7. 新增 `subscription\_fees` 表(手动订阅费,例如 Claude Max / ChatGPT Plus):`id`、`agent\_type`、`plan\_label`、`monthly\_fee`、`currency`、`billing\_day`、`effective\_from`、`effective\_to`(空表示仍在订阅)、`note`。
8. 新增 `spend\_summary` 聚合查询(视图或查询函数):按 `month\_key + platform(win/wsl) + agent\_type + source\_type(api消耗/套餐摊销/手动订阅)` 汇总金额,供月度/累计花销复用,累计值由聚合计算得出,不单独存死数。

**验收标准**:迁移脚本可在已有用户数据库上无损升级,历史记录的 `billing\_mode` 能合理回填默认值,不丢数据。

\---

## 阶段3:采集适配开发(Hermes / OpenClaw)

9. 参考 ccusage 对 Hermes Agent、OpenClaw 本地日志格式的解析规则,新增 `src-tauri/src/services/usage\_source\_hermes.rs`、`usage\_source\_openclaw.rs`,实现"读取本地数据 → 映射为标准 usage\_records 结构"的适配器,接口形态对齐现有 OpenCode 适配器模式(同一套注册/导入流程)。
10. 前端用量筛选 Tab 中加入 "Hermes" "OpenClaw" 两个数据源筛选项,展示方式与现有 Tab(如 OpenCode)保持一致。

**验收标准**:在已安装 Hermes / OpenClaw 的机器上,Dashboard 能看到对应 Agent 的用量记录,字段结构与其他 Agent 对齐,无需额外人工转换。

\---

## 阶段4:路径发现增强(Win + WSL 统一识别)

11. 在现有"自动检测候选路径 + 用户自定义覆盖"设置模块中,为每个数据源(含新增的 Hermes/OpenClaw)增加 WSL 候选路径形式(`\\\\wsl$\\<distro>\\...` 或 `\\\\wsl.localhost\\<distro>\\...`),并自动枚举本机已安装的 WSL 发行版列表供下拉选择。
12. 增加路径有效性自检(目标文件/目录是否存在、是否可读),检测失败时在设置页给出明确提示,而不是静默失败或硬编码报错。

**验收标准**:设置页能同时列出"本机路径候选"与"各WSL发行版路径候选",用户可直接选择或手动覆盖,不需要自己拼接 UNC 路径。

\---

## 阶段5:费用核算与消耗预测引擎

13. 新增 `src-tauri/src/services/cost\_ledger.rs`,实现按月 / 按平台(win/wsl) / 按 Agent 聚合:API Key 按量消耗成本 + Token Plan 套餐成本(按周期摊销) + 手动订阅费,输出"月度花销"与"累计花销"。
14. 新增 `src-tauri/src/commands/subscription\_fee\_commands.rs`,提供手动订阅费的增删改查命令,供前端表单调用。
15. 借鉴 Claude-Code-Usage-Monitor 的燃烧速率算法思路,新增预测逻辑:基于近期消耗速度估算当前套餐/额度还能用多久,以及当前计费周期(5小时窗 / 周窗)预计是否会提前打满,并尽量复用其"套餐档位自动识别"的思路用于 Token Plan 类型判定。

**验收标准**:给定一段历史用量数据,系统能输出类似"本月已花销 X 元;距离当前套餐窗口重置剩余 Y 小时,按当前速度预计提前/按时用完"的结果。

\---

## 阶段6:可视化大盘开发

16. 在 `src/components/usage/` 下新增:`SpendOverviewChart.tsx`(月度+累计花销趋势图,按平台/Agent拆分)、`SubscriptionFeeForm.tsx`(订阅费录入表单)、`PlanCountdown.tsx`(套餐剩余时间倒计时)、`BurnRateIndicator.tsx`(燃烧速率/预测提示)。
17. 复用 CC Switch 现有 Dashboard 的筛选器与图表风格(已有 provider/model 过滤组件、配色与卡片样式),保证新组件视觉风格与原 Dashboard 一致,不另起一套样式系统。

**验收标准**:打开 Dashboard 可同屏看到——各 Agent 当前用量、各套餐倒计时与消耗预测、月度/累计花销趋势图;视觉风格与原有页面统一。

\---

## 阶段7:联调测试与发布

18. 在 Windows 本机 + WSL 两套环境联调,验证 Hermes / OpenClaw / Codex / Claude Code 四个 Agent 的数据均能正确归集、`billing\_mode` 判定正确、花销计算无重复计数(尤其注意套餐摊销与API消耗不要叠加错误)。
19. 打包 Windows 安装包,在全新机器(无历史数据库)上做一次完整冷启动测试,验证数据库迁移与初始化流程不报错。

**验收标准**:四个 Agent × 两个环境的用量与花销数据均能在 Dashboard 正确显示,数字自洽,冷启动无报错。

\---

## 执行顺序提醒

严格按阶段0 → 阶段7顺序执行,每个阶段内的任务编号也按顺序完成。每完成一条任务,先跑一次现有测试/手动验证再进入下一条,避免裁剪(阶段1)与新增功能(阶段2起)互相踩坑。

