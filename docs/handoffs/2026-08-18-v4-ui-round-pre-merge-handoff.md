# Token Eyes 0.54.40-V4 本轮 UI 优化合并前完整交接

> 最后核对时间：2026-08-18（Asia/Shanghai）
> 交接目的：新对话框从当前真实状态继续完成“修复审查阻断项 → 双重审核 → 提交推送 → 合并并推送正式分支”。
> 最新用户边界：**当前功能分支和功能工作树暂时不得清理；即使后续合并检查无误，也必须保留，等待用户再次明确下达清理指令。**

## 0. 新对话框首先要知道的结论

1. 当前轮次**尚未完成合并**。
2. 功能分支已经有一轮提交并推送到 GitHub，但独立合并前审查发现 5 个问题；对应修复已经写进功能工作树，**尚未提交和推送**。
3. 正式分支 `0.54.40-V4` 仍停在 `a0762048`，本地与远端一致且工作树干净。
4. 功能分支 `codex/v4-ui-round-20260816` 已推送 HEAD 为 `34173b76`，本地与远端一致；但功能工作树现在是脏的：
   - 32 个未暂存修改；
   - 2 个已暂存删除；
   - 本交接文档创建后还会新增 1 个未跟踪 Markdown 文件。
5. 当前未提交修复已经通过多层测试，但仍有两项关键收尾没有完成：
   - 重新运行并保留当前 HEAD/当前工作区对应的 24 场景视觉审核终态输出，逐图人工核对；
   - 当前修复后重新运行生产 Tauri `--no-bundle` 构建。
6. `docs/superpowers/designs/2026-08-17-latest-round-dual-review.md` 仍记录旧版 `632×144` 小组件几何和旧提交，**是已知过期文档，必须更新后才能合并**。
7. 绝对不要在当前 Codex 自动创建的 E 盘分离工作树中提交或合并；所有功能修改都必须在下述 D 盘正式功能工作树进行。
8. 后续若合并通过，只允许完成：提交、推送、快进合并、推送正式分支、核验。**不要删除功能分支、远端功能分支或功能工作树。**

## 1. 仓库与工作树身份

### 1.1 本轮唯一功能工作树

- 路径：`D:\04-AI-Project\010-Token eye\.worktrees\v4-ui-round-20260816`
- 分支：`codex/v4-ui-round-20260816`
- 已推送本地 HEAD：`34173b766ea85034ad4fb04ab22aadd497c1c5a4`
- 远端 `origin/codex/v4-ui-round-20260816`：同为 `34173b766ea85034ad4fb04ab22aadd497c1c5a4`
- 状态：**有未提交改动，不干净**。

### 1.2 正式工作树

- 路径：`D:\04-AI-Project\010-Token eye\.worktrees\0.54.40-V4`
- 分支：`0.54.40-V4`
- 本地 HEAD：`a07620482f4d6d10c83042184b4694105223c4be`
- 远端 `origin/0.54.40-V4`：同为 `a07620482f4d6d10c83042184b4694105223c4be`
- 状态：干净。

### 1.3 禁止误用的当前 Codex 工作树

- 当前对话框环境路径：`E:\AgentData\Codex\worktrees\5929\010-Token eye`
- 状态：分离 HEAD，停在历史提交 `85386fd9b310201e031c4923fc2333781d32844f`
- 用途：只能读取项目规则或辅助检查。
- 禁止：不要在此处提交、切分支、合并、推送或生成最终交付。

### 1.4 根工作树

- 路径：`D:\04-AI-Project\010-Token eye`
- 分支：`main`
- HEAD：`a679a03cf709060c35f823003c09e784eceaf970`
- 本轮不应修改。

### 1.5 远端

- Git remote：`https://github.com/muxunson-9677/token-eyes.git`
- 2026-08-18 已成功执行 `git fetch origin --prune`。
- GitHub GraphQL 状态查询曾返回 HTTP 503，因此“是否存在 PR”没有得到可靠的 API 复核；当前工作流本来也不依赖 PR，计划是直接将已审核功能分支快进到正式分支。

## 2. 必须先读取并遵守的规则

新对话框开始后，先完整读取：

1. 仓库根目录 `AGENTS.md`；
2. 仓库根目录 `CLAUDE.md`，它是本项目唯一规则源；
3. 本交接文档；
4. 与本轮直接相关的计划、规格和审核文件：
   - `docs/superpowers/plans/2026-08-16-v4-ui-round-20260816.md`
   - `docs/superpowers/plans/2026-08-16-v4-ui-preview-feedback-corrections.md`
   - `docs/superpowers/plans/2026-08-16-desktop-widget-agent-linkage-repair.md`
   - `docs/superpowers/plans/2026-08-17-overview-widget-cost-accuracy.md`
   - `docs/superpowers/plans/2026-08-17-widget-plan-and-popup-corrections.md`
   - `docs/superpowers/designs/2026-08-16-desktop-widget-agent-linkage-repair.md`
   - `docs/superpowers/designs/2026-08-17-latest-round-dual-review.md`（注意：目前过期，不能作为最终证据）
   - `docs/test-reports/v4-ui-round-20260816-acceptance.md`
   - `docs/test-reports/v4-ui-round-20260816-baseline.md`

关键全局规则：

- 计划、规格、PRD 等文档能用中文的地方必须使用中文。
- UI/参考图/设计稿复刻任务必须执行两道独立审核：
  1. 第一审：修改结果与用户逐项要求逐项匹配；
  2. 第二审：在真实构建、真实页面、真实窗口与真实交互路径中确认效果已经呈现，并再次与用户要求匹配。
- 测试通过不是用户可见交付完成的充分条件。
- 源码、构建产物、实际运行窗口、安装包必须证明身份一致，不能使用旧截图、旧构建或旧安装包冒充当前结果。
- 不得清理、覆盖或重置用户未提交工作；不得使用 `git reset --hard`、`git checkout --`、广泛 `git clean` 或强推。

## 3. 本轮功能分支与正式分支的关系

2026-08-18 最新核对结果：

- `origin/0.54.40-V4` 是功能分支 HEAD 的祖先，`git merge-base --is-ancestor` 退出码为 0。
- 功能分支已提交部分相对正式分支领先 12 个提交。
- 正式分支自 `a0762048` 后没有发现远端新增提交。
- 之前做过一次合并树检查，没有冲突；正式合并前必须重新检查。

功能分支已提交的 12 个提交（从旧到新）：

1. `804e8158abc5917152881c772e2103cb041ee31a` — `docs: add v4 ui round implementation plan`
2. `21165ba91af5bfd5522d3b29c52828c5bc1dd1dd` — `docs: record v4 ui baseline`
3. `20cac4010988bf8958651dccf7d0aea5ff749dc6` — `feat: unify card press feedback`
4. `188bf950d6eadc464cc1c08cb29d82f4184851de` — `fix: render token plan quota facts per model`
5. `db97d22112ef76e486f474e0cad6a3b4e7b8eb0e` — `feat: compact service and plan market cards`
6. `cf2102378dc41bd67fa6431b0053650d3b1b7d46` — `feat: align cost settings controls and cache`
7. `45c12b3b86494785055c6eda8b018c4f5d68f78a` — `fix: enable limit sorting and align reset heatmap`
8. `692330abe45dbd4c4691da853a1d1dcc8dffc75b` — `fix: unify dark mode surfaces`
9. `3939259f1364942e8d0eccbada65a70d94c16519` — `fix: align desktop launch icon and size`
10. `70c6c4a4db4971b762387922770884bcb6128716` — `test: cover v4 ui round acceptance`
11. `2204cf626cd94650e2e237a4ab65dc9a9d994dc9` — `feat: refine UI and desktop widget experience`
12. `34173b766ea85034ad4fb04ab22aadd497c1c5a4` — `fix: finalize desktop widget experience`

已提交部分相对正式分支规模较大：约 156 个文件、6192 行新增、1069 行删除。不要在最后阶段做无关重构。

## 4. 本轮用户要求与实现范围总览

以下矩阵用于新对话框理解为什么分支改动很多。最终是否可合并仍以最新双审为准。

### 4.1 全局 UI 与基础页面

- 为指定页面和指定卡片统一按压回弹反馈；已经有正确按压效果的卡片保持不动。
- 套餐行情页卡片与成本设置/成本与额度卡片统一体积、分隔符、字体和标签层级；删除“覆盖 XXXXX”等冗余小字；重做顶部四张统计卡。
- 成本设置页统一标签、摘要和操作按钮的左右归属；标签靠左，操作按钮统一尺寸/圆角/间距并最右对齐；“自动比价/如何定价”等收纳成入口。
- 成本与额度页 Token 套餐折叠后间距立即收拢；展开后直接显示套餐内容，不再二次折叠。
- 成本与额度页避免每次点击都重新闪烁加载，使用会话缓存改善流畅度。
- 基础设置“限制显示”支持真实拖拽排序，拖拽项贴着鼠标移动，不以原地模糊/松开瞬移作为交互。
- 重置记录热力图适应窗口缩放并始终靠右对齐。
- 深色模式统一所有页面表面层级，避免白/黑块混杂。
- 应用启动图标使用正式 Logo；默认窗口尺寸按用户提供的宽屏截图调整。
- 数据与诊断页 Agent 卡片紧凑、字段分行对齐、不能溢出父容器；账本完整性等卡片文字不能越界。

### 4.2 Token 套餐与费用语义

- Token 套餐不能把不同模型/额度窗口的重置时间偷懒设成一致；必须使用官方来源或真实同步数据。
- 套餐用量按供应商、账户、套餐和额度窗口组织，展示 5h/7d/weekly 等真实窗口、进度、百分比、重置时间、有效期。
- 同一套餐的多条额度窗口统一收纳，不得错误地拆成多个套餐；Cursor 不得凭空出现 `7d`。
- 删除 Token 服务列表“同步成功”等冗余文案，避免全中文重复堆叠。
- 费用统计中：
  - API 账单、自定义花销和已记录订阅付款可作为现金支出；
  - 订阅套餐内 Token 按官方模型标价折算的结果只能叫“API 标价等价价值”，不能冒充真实现金支出；
  - 订阅回本/价值比较使用“标价等价价值 ÷ 订阅付款”，并明确语义。
- 请求日志标题区右侧显示小字“计费统计来源于模型官方标价”。

### 4.3 DeepSeek Harness、Agent 可见性与概览明细

- 新增 `DeepSeek Harness`，使用官方资源图标。
- “限制显示”成为 Agent 可见性和顺序的统一来源：使用明细 Agent 卡片、悬浮小组件 Agent 选择列表都读取同一套配置。
- 已启用但暂无数据的 Agent 仍可出现在选择入口，不能因为暂无用量就消失。
- 概览“每日细目”整行可点击；展开层显示当日总 Token 分别来自哪些 Agent、哪些模型；覆盖下面日期条目而不挤开表格布局；再次点击关闭。

### 4.4 悬浮小组件最终业务与交互约束

这是本轮反复调整最多、最需要真实审核的部分：

- 折叠主体在打开/关闭任何展开态时，屏幕位置、尺寸、Agent 图标位置、Agent 图标尺寸都不能跳动。
- 当前正式折叠几何不是早期 `632×144`，而是：
  - 窗口：`352×76`
  - 深色主体卡：约 `325×66`
  - 右侧三按钮导轨：约 `28×59`
- Agent 菜单：固定窗口 `352×280`；菜单固定高度；可用鼠标滚轮访问全部项目；滚动条本身隐藏；菜单必须指向 Agent 按钮；上下左右圆角和体积感保持一致；不得出现矩形大投影。
- 项目、套餐、模型三种展开态统一窗口 `352×360`、主体卡约 `325×350`；内部内容滚轮滚动，窗口外形和顶部折叠主体不变。
- 点击 Agent 菜单后再点空白处，应正确收回菜单，不得留下空白的大尺寸展开态。
- 关闭项目卡、套餐卡或模型卡不能切割 Agent 菜单。
- 右侧三个按钮在折叠和展开状态下尺寸、图标、位置、衔接关系完全一致；只允许紧贴的轻微体积阴影，不得有大范围扩散阴影或底部黑色投影。
- 右侧三个按钮必须藏在主体右边缘后方，最下按钮不能超过深色主体高度。
- 项目文件夹以文件夹为一级，一个文件夹下可有多个会话状态；活动状态来自真实会话/生命周期数据，不得所有项目错误显示 0 或“不活跃”。
- 套餐按供应商/账户/套餐分组：
  - 套餐名称一级显示；
  - 账户单独作为下方小字；
  - 同一套餐多额度窗口放在同一张二级套餐卡内；
  - 折叠态只显示第一个套餐的汇总状态，不展示所有详细窗口；
  - 展开态可滚轮浏览不同供应商套餐；
  - 使用紧凑表达，例如 `Weekly`、`2d 16h (08/20 11:33)`、`有效期 14 天`；
  - 不显示 `xx 元` 占位；
  - 重置时间靠右对齐；
  - 不伪造窗口或重置周期。
- 小组件设置页用量套餐卡片参照成本设置页 Token 套餐卡：同尺寸、同体积/形状/文字层级；勾选框位于右上角；不再显示绿点/橙点；左上拖拽手柄必须可拖动。
- 特效态透明画布可以扩大，但深色折叠主体必须保持 `325×66` 和原屏幕位置；关闭特效按钮贴近主体，关闭后不跳位。

## 5. 独立合并前审查结论与当前修复状态

独立审查最初结论是“存在阻断，不建议合并”。5 个问题如下。

### 5.1 P1：视觉审核脚本和双审文档验证旧几何

原问题：

- `dashboard/scripts/verify-token-eyes-widget-ui.mjs` 仍使用 prefs v10、`632×144` 和多个旧展开高度；
- `docs/superpowers/designs/2026-08-17-latest-round-dual-review.md` 仍声称旧尺寸与旧提交通过；
- 即使脚本通过，也不能证明当前 v11 `352×76` 小组件真实效果。

当前工作区修复：

- 验证脚本已改为 prefs v11；
- 折叠 `352×76`、展开 `352×360`、Agent 菜单 `352×280`、特效画布 `632×356`；
- 24 个场景覆盖 1、1.25、1.5、2 倍设备缩放；
- Agent 菜单使用 7 个启用 Agent，并滚动到底检查最后一项；
- 项目/额度/模型列表滚动到底检查最后一行；
- 套餐 fixture 已使用一个 `planId` 聚合 3 个真实额度窗口。

仍未完成：

- 旧双审文档尚未更新；
- 新脚本最近一次运行生成了 24 张新截图，但由于对话被中断，没有保留下最终 `WIDGET_VISUAL_AUDIT=PASS_24_SCENARIOS` 输出；新对话必须重新运行并人工逐图审阅。

### 5.2 P1：靠近显示器底部展开会越界

原问题：

- Rust 只按折叠高度限制窗口位置，然后保持左上原点扩展到 360/280 高；靠近屏幕底部时展开内容会落到屏幕外；
- 旧测试反而固化了越界行为。

当前工作区修复：

- `src-tauri/src/widget_window.rs` 新增 `resize_geometry_within_monitors`；
- 普通展开态和临时菜单/特效几何都会根据显示器边界重新限制；
- 新增“足够空间时保持原点”和“靠近底部时完整可见”的 Rust 测试。

注意：

- 这解决“内容不可见”，但靠近边缘时窗口必须向上移动；新对话要人工判断这种边界行为是否符合当前产品预期，不能只看单测。

### 5.3 P2：Codex rollout 并发扫描可能返回旧快照

原问题：

- 扫描 A 运行期间新增文件，扫描 B 看到新签名却直接等待并返回 A 的旧结果。

当前工作区修复：

- `src/lib/local-api.js` 的 owner 扫描每轮获取新文件列表；
- waiter 等待已有扫描完成后重新进入收集函数，再做新签名检查/补扫；
- `test/usage-caliber-consistency.test.js` 新增“并发期间文件签名变化”回归测试；
- 该测试在修复前曾按预期失败（第二请求只得到 100，而不是 300），修复后通过。

### 5.4 P2：Windows bundled-runtime smoke 遗留测试目录

原问题：

- `test/windows-bundled-runtime-smoke.test.cjs` 创建 `src-tauri/target/runtime-smoke-*`，清理钩子只结束进程、不删除目录。

当前工作区修复：

- 清理钩子用 `finally` 删除本次测试目录；
- 最近一次新测试没有增加新目录。

本地仍存在 13 个**旧的被忽略目录**，均产生于修复前：

- `runtime-smoke-11804`
- `runtime-smoke-26364`
- `runtime-smoke-28008`
- `runtime-smoke-28552`
- `runtime-smoke-2964`
- `runtime-smoke-35208`
- `runtime-smoke-40312`
- `runtime-smoke-42948`
- `runtime-smoke-55564`
- `runtime-smoke-55872`
- `runtime-smoke-59968`
- `runtime-smoke-63924`
- `runtime-smoke-65440`

不要使用 `git clean` 删除它们；一次 dry-run 已表明相关匹配可能扩大到整个 `src-tauri/target/`。用户目前要求保留工作树，因此可以将其作为被忽略的旧构建/测试残留如实汇报，等待后续明确清理授权。

### 5.5 P3：未引用调试截图

当前已暂存删除：

- `docs/screenshots/latest-round-real-ui/debug-cost.png`
- `docs/screenshots/latest-round-real-ui/debug-overview.png`

这两项是当前仅有的 staged changes。

## 6. 当前未提交改动清单

### 6.1 未暂存的文本修改

- `dashboard/scripts/verify-token-eyes-widget-ui.mjs`
- `dashboard/src/pages/DesktopWidgetPage.test.tsx`
- `dashboard/src/pages/desktop-widget.css`
- `src-tauri/src/widget_window.rs`
- `src/lib/local-api.js`
- `test/usage-caliber-consistency.test.js`
- `test/windows-bundled-runtime-smoke.test.cjs`
- `test/windows-widget-contract.test.js`

### 6.2 未暂存的视觉证据

`docs/screenshots/token-eyes-widget-ui/` 下 24 张 PNG 均已用当前几何重新生成：

- 01 compact：1x / 1.25x / 1.5x / 2x
- 02 Agent 菜单：1x / 1.25x / 1.5x / 2x
- 03 projects：1x / 1.25x / 1.5x / 2x
- 04 limits：1x / 1.25x / 1.5x / 2x
- 05 models：1x / 1.25x / 1.5x / 2x
- 06 celebration：1x / 1.25x / 1.5x / 2x

这些图片最新修改时间约为 2026-08-18 01:51:55 至 01:52:08。

### 6.3 已暂存删除

- `docs/screenshots/latest-round-real-ui/debug-cost.png`
- `docs/screenshots/latest-round-real-ui/debug-overview.png`

### 6.4 本交接文档

本交接文档会作为新增未跟踪文件出现。建议在最终文档提交中有意识地加入，而不是使用 `git add -A` 一把抓。

### 6.5 当前 diff 健康

- `git diff --check` 当前没有空白错误；只出现 Git 的 LF/CRLF 转换提示。
- 未提交文本 diff 约 251 行新增、69 行删除；另外有 24 张更新截图和 2 张暂存删除截图。

## 7. 已运行验证与证据边界

以下结果来自当前未提交修复完成后的最近一次执行：

- Rust 源文件格式检查：通过。
- Rust 小组件聚焦测试：18/18 通过。
- Windows/data 聚焦 Node 测试：31/31 通过。
- 前端小组件聚焦测试：38/38 通过。
  - 测试输出仍有既有 React `act(...)` 提示和 JSDOM canvas “not implemented”提示，但退出码为 0。
- `npm run ci:local`：通过。
- Rust 完整 lib 测试：223/223 通过。
- `git diff --check`：通过，仅 LF/CRLF 提示。

特别说明：

- 24 张当前几何截图已经生成，并由上一对话的主执行者抽查过 compact、Agent 菜单、limits、models、celebration 等状态；但视觉脚本最终 PASS 行没有在中断前被可靠记录。**新对话必须重跑，不得从截图时间戳推断通过。**
- 当前修复之后的生产 Tauri `npx tauri build --no-bundle` 尚未重新执行；之前的构建是在这些修复之前通过的，不能冒充当前结果。
- 真正的 NSIS 安装测试默认跳过，只有设置 `TOKEN_EYES_ISOLATED_INSTALLER_SMOKE=1` 并在隔离 Windows 用户或虚拟机执行，才能证明真实安装与启动。当前任务是合并，不应为追求“全绿”污染用户真实安装环境。
- 根目录普通 `npm test` 不包含两个 `.test.cjs` Windows smoke；相关验证需通过 Tauri 专用脚本或显式 `node --test ...test.cjs`。

## 8. 视觉证据必须重新审核的具体内容

新对话不要只看自动脚本。至少逐张打开 1x 和 2x 的以下状态，并对照用户要求：

1. `01-compact-1x.png`
   - 352×76 窗口；主体约 325×66；导轨不越界；无直角阴影；Agent 图标不跳位。
2. `02-agent-menu-1x.png`
   - 菜单箭头指向 Agent 按钮；上下圆角完整；无矩形大投影；隐藏滚动条；滚轮可访问 DeepSeek Harness、WorkBuddy 等最后项目。
3. `03-projects-1x.png`
   - 一个文件夹一级展示，多个会话状态在其内；底部最后一项可滚轮看到；顶部折叠主体不变。
4. `04-limits-1x.png`
   - 一个 Codex/Pro 20x 套餐卡聚合 3 个额度窗口；账号在小字行；重置时间/有效期准确且紧凑；没有把三个窗口拆成三个套餐。
5. `05-models-1x.png`
   - 完整模型列表可滚动到最后一项；不出现竖向可见滚动条；无裁切。
6. `06-celebration-1x.png`
   - 特效画布扩大，但主体保持 325×66；关闭按钮贴近主体；关闭后主体位置不改变。
7. 对应 2x 图
   - 检查高 DPI 下边缘、阴影、圆角、文字、滚轮区域和导轨是否仍不裁切。

此外必须运行原生/浏览器交互验证：

- Agent 菜单反复开关；
- 菜单打开时点主体空白处；
- Agent 菜单打开后进入项目态再关闭；
- 三个侧边按钮来回切换；
- 折叠/展开反复操作；
- 靠近显示器底边和右边打开菜单/展开态；
- 特效开关与关闭按钮；
- 套餐滚轮访问所有供应商；
- 项目滚轮访问所有文件夹/会话。

## 9. 新对话框建议执行顺序

### 阶段 A：恢复上下文并冻结边界

1. 切换工作目录到功能工作树。
2. 完整读取 `AGENTS.md`、`CLAUDE.md` 和本交接文档。
3. 明确向用户说明：不会清理功能分支/工作树。
4. 运行：

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/codex/v4-ui-round-20260816
git rev-parse origin/0.54.40-V4
git diff --check
```

预期：

- 功能已提交 HEAD/远端仍为 `34173b76`；
- 正式远端仍为 `a0762048`，若有变化必须停下重新评估；
- 当前未提交修复仍在，不能 reset。

### 阶段 B：完成当前阻断修复审核

1. 逐个审查第 6 节列出的文本 diff。
2. 重新运行聚焦测试，确认并发扫描、窗口边界、runtime smoke 清理均通过。
3. 重新运行视觉脚本并保留终态输出。
4. 使用本地图片查看器逐图审核 24 张证据，重点按第 8 节检查。
5. 重新运行生产 Tauri no-bundle 构建。
6. 运行完整门禁。

建议命令（先根据实际 package/依赖状态确认）：

```powershell
# 功能工作树
npm --prefix dashboard run test -- --run src/pages/DesktopWidgetPage.test.tsx
node --test test/usage-caliber-consistency.test.js test/windows-widget-contract.test.js test/windows-bundled-runtime-smoke.test.cjs
cargo test --manifest-path src-tauri/Cargo.toml --lib widget_window
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run ci:local
npm run tauri:prepare-runtime
npx tauri build --no-bundle
node dashboard/scripts/verify-token-eyes-widget-ui.mjs
git diff --check
```

不要机械照抄命令后宣称成功；必须查看退出码和关键输出。

### 阶段 C：先提交源代码和当前证据

如果阶段 B 无新问题：

1. 只暂存本轮阻断修复的代码、测试、24 张截图和两张调试图删除；
2. 不使用 `git add -A`；
3. 建议提交：

```text
fix: close pre-merge verification gaps
```

4. 推送 `codex/v4-ui-round-20260816`；
5. 记录新的完整 SHA，作为双审文档中的“审核源提交”。

### 阶段 D：更新双审文档

更新 `docs/superpowers/designs/2026-08-17-latest-round-dual-review.md`：

- 改为新源提交 SHA；
- 删除“没有提交/推送”的旧说法；
- 用当前几何替换旧几何：
  - 折叠窗口 352×76；主体约 325×66；导轨约 28×59；
  - Agent 菜单 352×280；
  - projects/limits/models 352×360，主体约 325×350；
  - celebration 632×356，主体仍约 325×66；
- 写清 24 场景覆盖 1/1.25/1.5/2 倍缩放；
- 写清滚轮访问最后一项、隐藏滚动条和 7 Agent；
- 写清同一套餐 3 个额度窗口聚合；
- 写清显示器底边限界测试；
- 写清 rollout 并发刷新回归测试；
- 写清 smoke 目录清理逻辑；
- 写清当前各项真实验证命令和数量；
- 能用中文的地方全部中文。

将本交接文档一并作为有意文档加入，或至少在提交前明确决定，避免它成为被遗忘的未跟踪文件。

建议文档提交：

```text
docs: record current widget dual review
```

推送功能分支。

### 阶段 E：新的独立只读复审

依据项目规则和 `requesting-code-review` 工作流，创建新的只读复审，明确要求复核：

1. 当前审核脚本、24 张截图、双审文档、源提交身份是否一致；
2. 显示器边缘展开是否完整且无意外跳动；
3. rollout single-flight 是否仍有死循环、陈旧缓存或并发回归；
4. runtime smoke 是否会新增残留目录；
5. 调试截图是否已移除；
6. 当前工作树、正式工作树、远端分支状态；
7. 用户逐项要求是否仍有遗漏。

只要独立复审还有 P0/P1/P2 或真实效果证据不充分，就不得合并。

### 阶段 F：合并前最后检查

功能工作树必须满足：

- `git status --short` 无输出；
- `HEAD == origin/codex/v4-ui-round-20260816`；
- 所有当前验证通过；
- 双审文档指向当前源提交/证据；
- 新独立复审无阻断。

正式工作树必须满足：

- 分支确为 `0.54.40-V4`；
- `git status --short` 无输出；
- 本地 HEAD 与 `origin/0.54.40-V4` 一致；
- 功能分支以正式分支为祖先；
- 合并树无冲突。

### 阶段 G：仅快进合并并推送正式分支

在正式工作树执行：

```powershell
git fetch origin --prune
git merge --ff-only codex/v4-ui-round-20260816
git push origin 0.54.40-V4
```

合并后核验：

```powershell
git rev-parse HEAD
git rev-parse origin/0.54.40-V4
git merge-base --is-ancestor codex/v4-ui-round-20260816 0.54.40-V4
git diff --exit-code codex/v4-ui-round-20260816..0.54.40-V4
git status --short --branch
```

### 阶段 H：合并后明确保留功能分支和工作树

这是用户最新明确指令：

- 不运行 `git worktree remove`；
- 不删除本地 `codex/v4-ui-round-20260816`；
- 不删除远端 `origin/codex/v4-ui-round-20260816`；
- 不清理工作树里的忽略构建产物；
- 只汇报“已合并且仍保留”，等待用户另行下达清理指令。

## 10. 最终向用户汇报时必须包含

若后续确实完成合并，最终汇报必须给出：

1. 正式分支最终完整 SHA；
2. `origin/0.54.40-V4` 与本地是否同 SHA；
3. 正式工作树是否干净；
4. 功能分支本地/远端是否同 SHA；
5. 功能工作树是否干净；
6. 功能分支和工作树仍被保留，未清理；
7. GitHub 分支/提交链接；
8. 独立复审是否无阻断；
9. 实际运行过的测试、构建和视觉审核；
10. 被忽略构建目录/旧 runtime-smoke 目录等本地残留要如实区分，不能笼统说“本地没有任何残留”；
11. 真正 NSIS 隔离安装测试若未执行，必须明确说明，不能用 no-bundle 构建冒充安装验收；
12. 未触碰其他工作树、分支和 stash。

## 11. 禁止事项

- 不要清理功能分支或功能工作树，除非用户在新对话框再次明确授权。
- 不要在 E 盘分离工作树提交。
- 不要在正式工作树脏的情况下合并。
- 不要使用 `git reset --hard`、`git checkout --`、强推或 broad `git clean`。
- 不要为了删除 13 个旧 smoke 目录而清空整个 `src-tauri/target`。
- 不要把旧双审文档、旧截图或旧安装包当作当前 HEAD 证据。
- 不要只汇报“测试通过”；必须给出真实用户效果和源到屏身份。
- 不要自动生成新的 EXE；当前任务是完成审核与合并，安装包只有用户再次要求时才生成。
- 不要顺手整理 156 个文件之外的无关代码。

## 12. 交接时的准确状态快照

截至本文件创建前：

- 功能已推送 HEAD：`34173b766ea85034ad4fb04ab22aadd497c1c5a4`
- 功能远端：同 SHA
- 正式本地/远端：`a07620482f4d6d10c83042184b4694105223c4be`
- 正式工作树：干净
- 功能分支相对正式：已提交部分领先 12 个提交
- 功能工作树：32 个未暂存修改 + 2 个已暂存删除
- `git diff --check`：无空白错误，仅行尾提示
- 当前 24 张小组件视觉证据修改时间：2026-08-18 01:51:55–01:52:08
- 被忽略旧 runtime-smoke 目录：13 个
- 合并：未执行
- 正式分支推送：未执行
- 功能分支清理：未执行，而且当前明确禁止

## 13. 给新对话框的第一句建议

可以直接告诉新执行者：

> 请先完整读取功能工作树中的 `AGENTS.md`、`CLAUDE.md` 和 `docs/handoffs/2026-08-18-v4-ui-round-pre-merge-handoff.md`。只在 `D:\04-AI-Project\010-Token eye\.worktrees\v4-ui-round-20260816` 继续，先核对现有未提交修复并完成双审，不得 reset/clean。审核无阻断后提交推送、快进合并到 `0.54.40-V4` 并推送正式分支；合并后保留当前功能分支、远端分支和工作树，等待我的后续清理指令。
