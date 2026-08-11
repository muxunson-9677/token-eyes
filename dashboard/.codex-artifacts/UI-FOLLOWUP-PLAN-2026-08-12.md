# Dashboard Interaction And Layout Follow-up Implementation Plan

> **For agentic workers:** Execute inline in this task. Do not commit or push unless the user later requests it.

**Goal:** 修复用户在 1329×912 实机审核中发现的五项真实交互和布局回归，并在 900×600 最小窗口复核。

**Architecture:** 保留当前组件和视觉语言，仅补充语义交互钩子、稳定滚动视口和最终级联保护。单元测试锁定组件契约，浏览器几何与截图负责最终用户体验验收。

**Tech Stack:** React, Vitest, Testing Library, CSS container/media queries, Playwright runtime audit.

---

### Task 1: 锁定失败基线

- [ ] 趋势粒度必须是可点击按钮并打开真实粒度面板。
- [ ] Agent 展开区域必须拥有独立正常流容器。
- [ ] 项目用量必须使用永久保留滚动条的固定视口。
- [ ] 热力图必须保持 `justify-self:end` 与 `fit-content`。
- [ ] 小组件按压必须达到肉眼可见的 2px 下沉与 0.94 缩放。

### Task 2: 最小实现

- [ ] `TrendMonitor.jsx` 复用现有 `TrendMonitorZoomModal`，让“天”按钮打开粒度选择。
- [ ] `UsageOverview.jsx` 为展开区增加稳定布局钩子；CSS 让第二栅格行按内容增长。
- [ ] `DataDetails.jsx` 与 `ProjectUsagePanel.jsx` 增加稳定滚动视口和预留网格高度。
- [ ] `apple-glass.css` 删除热力图窄宽度上下堆叠，改为单行紧凑缩放。
- [ ] `apple-glass.css` 加强小组件按压位移、缩放、阴影和底色反馈。

### Task 3: 自动检查

- [ ] 运行四个定向测试文件并确认全绿。
- [ ] 运行 dashboard typecheck 与 build。
- [ ] 运行 `git diff --check`，确认没有格式错误。

### Task 4: 两轮真实体验核查

- [ ] 1329×912：依次验证热力图、粒度按钮、项目折叠、Agent 展开、小组件按压。
- [ ] 900×600：重复相同流程，检查溢出、重叠、裁切和滚动条跳动。
- [ ] 第一轮发现的所有视觉问题修复后，再独立重复第二轮；不以测试通过替代视觉结论。
