# 2026-08-17 本轮调整双重审核记录

## 审核范围

- 正式优化工作树：`D:\04-AI-Project\010-Token eye\.worktrees\v4-ui-round-20260816`
- 当前分支：`codex/v4-ui-round-20260816`
- 审核基准提交：`70c6c4a4db4971b762387922770884bcb6128716`
- 本轮只审核和修正现有未提交改动，没有提交、推送、合并或封装安装包。

本次按两道互相独立的审核执行：第一审逐项检查实现结果是否覆盖用户要求；第二审检查构建后的真实页面与悬浮小组件在目标尺寸、目标状态下是否真正呈现要求的效果。

## 第一审：调整结果与要求逐项匹配

| 用户要求 | 实现结果 | 一审证据 |
| --- | --- | --- |
| DeepSeek Harness 使用官方图标 | 使用 DeepSeek Harness 官方仓库的 `website/public/favicon.svg`，设置页、使用明细和悬浮小组件统一走正式品牌资源 | `dashboard/public/brand-logos/deepseek-harness.svg`；`ProviderIcon.test.jsx` |
| 概览页“每日细目”整行可点击；展开内容覆盖下方日期且不挤开空间；再次点击关闭 | 日期行支持鼠标与键盘触发；明细层使用覆盖布局；展开前后表格行数和表体高度不变；展示 Agent 与模型拆分 | `DataDetails.jsx`、`DataDetails.test.jsx`；真实页面报告中展开前后均为 10 行、541.5px，显示 3 个 Agent、5 个模型 |
| 请求日志右侧显示“计费统计来源于模型官方标价” | 精确文案已放到请求日志标题区右侧的小字位置 | `RequestUsageLog.jsx`、`RequestUsageLog.test.jsx`；真实页面截图 `03-request-log-pricing-note.png` |
| 费用统计不再把订阅套餐的 Token 等价价值冒充现金支出 | “实际现金支出”只汇总已记录订阅付款、官方 Billing/API 账单、自定义花销；Token 按官方标价计算的结果独立显示为“API 标价等价价值”；回本倍数只使用等价价值除以订阅支出 | `use-cost-accumulation.js`、`subscription-roi.ts` 及对应测试；真实页面截图 `05-cost-semantics.png` |
| 限制显示、使用明细与悬浮小组件使用同一套 Agent 开关和顺序 | 使用明细和悬浮小组件都读取限制显示偏好；开关打开但暂时没有用量数据的 Agent 仍可被选择；DeepSeek Harness 已纳入 | 使用明细真实页面只显示“全部、DeepSeek Harness、Codex、Claude Code、Cursor、Hermes Agent”；`AgentSwitcher.test.jsx`、`DesktopWidgetPage.test.tsx` |
| 悬浮小组件项目状态必须来自真实活动数据 | 选中的项目文件夹即使暂时无活跃会话仍保留；活动状态来自实际生命周期会话和用户选择的活跃时间窗，不再把陈旧会话标为活跃 | `widget-view-model.test.js`、`DesktopWidgetPage.test.tsx`、`WidgetsPage.test.jsx` |
| 悬浮小组件套餐显示必须准确 | 只显示用户已配置的 Token 套餐；保留每个真实额度窗口；重置时间与套餐有效期分开；无套餐时不伪造供应商额度 | `widget-view-model.test.js` 中套餐来源、多个额度窗口、重置时间与有效期测试 |
| 悬浮小组件按 5 张设计稿复刻，关闭特效按钮贴近主体，关闭后不跳位 | 折叠态固定 632×144；主卡 588×138；菜单、项目、额度、模型按设计稿分别使用独立高度；特效态只扩展透明画布，主卡尺寸和屏幕位置保持不变 | `verify-token-eyes-widget-ui.mjs` 的 24 个状态/缩放组合；`widget_window.rs` 的几何测试 |

## 第二审：真实呈现与交互效果

### 第二审发现并修复的问题

1. 费用口径说明虽然已经写入组件，但旧 CSS 将它设为 `display: none`，真实页面完全看不到。现已恢复为可见说明条，并在生产构建预览中确认呈现。
2. 悬浮小组件特效态虽然测试能触发，但透明画布的内边距会把主体压窄，视觉上再次出现“又窄又长”。现已改为保持主卡 588×138，只在四周增加透明特效空间。
3. Agent 菜单、套餐额度和模型列表在部分高度下最后一项被裁切。一审只能证明数据存在，二审实际截图发现不可完整看到；现已分别校正窗口高度和行高，最后一项完整可见。
4. 关闭特效按钮原先与主体距离不稳定。现已校正为距主体右侧 4px、顶部 5px；点击关闭后特效层消失，主卡尺寸和位置不改变。

### 悬浮小组件真实状态证据

| 状态 | 真实呈现结果 |
| --- | --- |
| 折叠态 | 窗口 632×144，主卡 588×138，无横向或纵向溢出 |
| Agent 菜单 | 窗口高 472，5 个启用 Agent 全部完整可见 |
| 项目态 | 窗口高 356，2 个选中项目完整可见，状态数字来自活动会话 |
| 套餐态 | 窗口高 426，3 个套餐额度窗口完整可见 |
| 模型态 | 窗口高 412，7 个模型完整可见，Token 与金额使用完整数值 |
| 特效态 | 透明画布 912×424，主卡仍为 588×138；关闭按钮贴近右上角；点击关闭后特效消失且主体不跳位 |

上述 6 个状态分别在 1、1.25、1.5、2 倍设备缩放下审核，共 24 个真实渲染场景，均无裁切和溢出。截图位于 `docs/screenshots/token-eyes-widget-ui/`。

### 应用页面真实证据

- 概览每日明细覆盖层：`docs/screenshots/latest-round-real-ui/01-overview-daily-overlay.png`
- 限制显示与使用明细 Agent 一致：`docs/screenshots/latest-round-real-ui/02-usage-limits-display-agents.png`
- 请求日志计价来源说明：`docs/screenshots/latest-round-real-ui/03-request-log-pricing-note.png`
- DeepSeek Harness 官方图标：`docs/screenshots/latest-round-real-ui/04-settings-deepseek-harness.png`
- 实际现金支出与 API 标价等价价值分离：`docs/screenshots/latest-round-real-ui/05-cost-semantics.png`

上述页面审核最后一次运行在 `npm run build` 生成的生产构建预览上，而不是只检查源码或单元测试。

## 验证结果

- 前端定向测试：10 个测试文件、143 项测试通过。
- Node Agent 适配、DeepSeek Harness 解析、业务与 Windows 小组件契约：55 项测试通过。
- Rust 小组件几何：13 项测试通过。
- TypeScript 类型检查：通过。
- 前端生产构建：通过；仅保留既有的大分包提示。
- 页面生产构建真实审核：通过。
- 悬浮小组件 24 个真实渲染场景：通过。
- `git diff --check`：通过，仅有 Git 的 LF/CRLF 提示。

## 当前交付边界

本轮没有生成 EXE，也没有提交、推送或合并。用户后续确认需要安装验收时，再基于当前已审核结果封装安装包。
