# 2026-08-18 本轮调整双重审核记录

## 审核身份与范围

- 功能工作树：`D:\04-AI-Project\010-Token eye\.worktrees\v4-ui-round-20260816`
- 功能分支：`codex/v4-ui-round-20260816`
- 正式目标分支：`0.54.40-V4`
- 正式基线：`a07620482f4d6d10c83042184b4694105223c4be`
- 源码审核提交：`54ded81b6707dc7d17fb1e728d6fe815fb1310b4`（已推送到 `origin/codex/v4-ui-round-20260816`）
- 审核覆盖源码、测试、生产构建、Windows 内嵌运行时、Rust 小组件窗口几何、24 张真实渲染截图及关键交互。

本次执行两道互相独立的审核：规格审核逐项核对用户要求和可观察结果；质量审核检查实现、测试隔离、并发时序、窗口几何、真实滚动和 Git 交付边界。最终结论分别为 `PASS` 和 `APPROVED`，没有遗留 P0/P1/P2 问题。

## 第一审：用户要求与实现结果

| 用户要求 | 实现结果 | 主要证据 |
| --- | --- | --- |
| DeepSeek Harness 使用官方图标 | 设置页、使用明细和悬浮小组件统一使用正式品牌资源 | `dashboard/public/brand-logos/deepseek-harness.svg`、`ProviderIcon.test.jsx` |
| 概览页“每日细目”整行可点击、覆盖展开且不挤开表格 | 日期行支持鼠标和键盘；明细层覆盖下方内容；展开前后表格行数与高度不变 | `DataDetails.jsx`、`DataDetails.test.jsx`、`docs/screenshots/latest-round-real-ui/01-overview-daily-overlay.png` |
| 请求日志显示计价来源说明 | 标题区右侧显示“计费统计来源于模型官方标价” | `RequestUsageLog.jsx`、`RequestUsageLog.test.jsx`、`03-request-log-pricing-note.png` |
| 订阅 Token 等价价值不能冒充现金支出 | “实际现金支出”与“API 标价等价价值”分离；回本倍数只按等价价值除以订阅支出 | `use-cost-accumulation.js`、`subscription-roi.ts` 及对应测试、`05-cost-semantics.png` |
| 限制显示、使用明细和小组件共用 Agent 开关与顺序 | 三处读取同一套偏好；无当前用量但已启用的 Agent 仍可选择；DeepSeek Harness 已纳入 | `AgentSwitcher.test.jsx`、`DesktopWidgetPage.test.tsx`、`02-usage-limits-display-agents.png` |
| 小组件项目状态来自真实活动数据 | 保留用户选择的项目；活动状态来自实际会话生命周期和时间窗，不把陈旧会话伪装成活跃 | `widget-view-model.test.js`、`DesktopWidgetPage.test.tsx`、`WidgetsPage.test.jsx` |
| 小组件套餐显示准确 | 只显示用户已配置套餐，保留每个真实额度窗口，重置时间与套餐有效期分开 | `widget-view-model.test.js` |
| 小组件按设计状态呈现且边缘不跳位 | 主体在普通展开态按显示器边缘夹取；庆祝态只允许透明特效光晕在极端边缘被裁，主体胶囊位置和关闭前后保持不变 | `verify-token-eyes-widget-ui.mjs`、`widget_window.rs` 几何回归测试 |

## 第二审：真实呈现与交互

### 小组件六态几何

| 状态 | 窗口与主体结果 |
| --- | --- |
| 折叠态 | 窗口 `352×76`，主卡 `325×66` |
| Agent 菜单 | 窗口 `352×280`，7 个 Agent，可用真实滚轮到达最后一项 |
| 项目态 | 窗口 `352×360`，主卡 `325×350`；首个项目文件夹含 7 个会话，可滚到底 |
| 套餐态 | 窗口 `352×360`，主卡 `325×350`；一个 Codex Pro 20x 套餐包含 3 个额度窗口，可滚到底 |
| 模型态 | 窗口 `352×360`，主卡 `325×350`；10 个模型，可滚到底 |
| 庆祝态 | 透明窗口 `632×356`，可见主卡仍为 `325×66`；关闭按钮可用，关闭前后主卡矩形不跳动 |

六个状态分别在 DPR `1`、`1.25`、`1.5`、`2` 下生成并逐图审核，共 24 张 PNG。最终截图位于 `docs/screenshots/token-eyes-widget-ui/`，旧的两张 debug 图已删除。

真实浏览器交互还覆盖：菜单空白处关闭、重复打开/关闭菜单、切换模式时菜单关闭、项目/套餐/模型三种侧栏切换、项目两轮展开/折叠、Agent/项目/套餐/模型真实鼠标滚轮，以及庆祝态关闭前后的胶囊位置对比。脚本要求四个滚动目标都必须真实产生溢出并改变 `scrollTop`，否则直接失败；最终输出：

- `WIDGET_INTERACTION_AUDIT=PASS`
- `WIDGET_VISUAL_AUDIT=PASS_24_SCENARIOS`

### 审核中修复的阻断项

1. Rust 多显示器上下排列、负坐标和混合 DPI 下，扩展窗口可能被吸到相邻显示器；现以锚点选屏并使用稳定的等交集/零交集排序。
2. 庆祝态整体夹取会移动可见主体；现将普通弹层夹取与透明庆祝光晕分离，优先保证可见胶囊原位。
3. 用量汇总测试可能读取开发者真实 Codex 目录；现所有路径解析都可注入，测试只读取临时目录。
4. rollout 文件列表与并发 owner/waiter 可能漏掉新文件或产生时序不稳定；现每轮 owner 强制刷新列表，并通过两个 deferred 栅栏验证 S1/S2/S3 三代合并。
5. Windows bundled-runtime smoke 目录只用 PID 命名可能碰撞历史目录；现使用唯一 `mkdtempSync` 目录，并只清理本轮创建的精确路径。
6. 视觉脚本最初只有部分状态执行滚轮；现 Agent、项目、套餐、模型四态均强制完成真实滚动验证。

## 并发、隔离与恢复证据

- S1 首请求得到 `100`；S1 期间的 4 个 waiter 合并到 S2 并得到 `300`；S2 期间的 4 个 waiter 合并到 S3 并得到 `350`。
- 精确验证三代共执行 12 次 rollout `stat`，且目标并发测试连续运行 20 次零失败。
- 注入 `createReadStream` 拒绝后，同一 scope 的下一次请求可恢复并返回 `100`，不存在悬挂状态。
- 所有测试读取流都被断言位于临时 Codex home 下，不会汇总真实用户 rollout。
- smoke 前后历史 `runtime-smoke-*` 目录集合均为同一 13 个，新增和删除集合均为空。

## 新鲜验证结果

- Node 定向契约：35/35 通过。
- Dashboard 定向测试：38/38 通过。
- Rust `widget_window`：26/26 通过。
- Rust 全量库测试：231/231 通过。
- Windows bundled-runtime smoke：1/1 通过，历史目录 13→13。
- 小组件真实交互与视觉脚本：24/24 场景通过，两个最终 PASS 标记均存在。
- `npm run ci:local`：通过，包含类型检查、生产构建、全量 Node 测试及数据/文案/UI/架构守卫。
- `npm run tauri:prepare-runtime`：通过，内嵌 Node v22.22.2 校验完成。
- `npx tauri build --no-bundle`：通过，生成 `src-tauri/target/release/token-eyes.exe` 用于生产构建验证。
- `git diff --check`：通过；只有 Git 的既有 LF/CRLF 提示。

现有 React `act`/JSDOM canvas、Rust dead-code、Vite 大分包/动态导入、npm 镜像弃用提示均为非阻断警告，没有验证器失败。

## 当前交付边界

- 本轮没有生成或安装 NSIS 安装包；`--no-bundle` 仅生成生产 EXE 作为构建验证。
- `dashboard/dist/`、`src-tauri/EmbeddedServer-0.54.43/`、`src-tauri/target/` 为被 Git 忽略的本地构建产物，不进入提交，也不在合并后清理。
- 功能分支、远端功能分支和功能工作树在合并后全部保留，只有收到用户后续明确指令才允许清理。
