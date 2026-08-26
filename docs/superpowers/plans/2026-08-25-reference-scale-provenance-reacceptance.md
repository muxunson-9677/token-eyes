# 参考尺度与数据溯源重新验收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `superpowers:test-driven-development` 逐项执行；本任务由当前会话内联完成并接受独立审查。用户禁止提交，因此所有提交步骤取消。

**Goal:** 让最终 Windows 生产安装版中的实时会话在同视口下忠实匹配参考图尺度，并让价值对比中的官方 API、顶部计算方法和六个月趋势显示真实、可追溯、紧凑的数值。

**Architecture:** 保持现有 API → view-model → React 页面链路。API 只增加安全聚合的观测用量字段；UI 用单一格式化器显示中文单位和可理解的溯源；CSS 用同一参考画布比例约束宽屏，不再按 `vh` 独立拉伸各卡片。视觉验收使用同尺寸截图和关键区域几何门禁。

**Tech Stack:** Node.js CommonJS、React 18、Vitest、Node Test、CSS、Playwright、Tauri Windows。

---

### Task 1: 锁定官方 API 观测数值契约

**Files:**
- Modify: `test/value-comparison-view-model.test.js`
- Modify: `test/value-realtime-local-api.test.js`
- Modify: `src/lib/value-comparison-view-model.js`
- Modify: `src/lib/local-api.js`

- [ ] 先在 view-model 与 local API 测试中增加失败断言：`official_api` 现金 `value` 仍为 `null`，同时输出 `observed_usage: { value, unit: "tokens", evidence_state, evidence }`。
- [ ] 运行定向测试，确认因为缺少 `observed_usage` 而失败，不得修改期望为既有“用量已识别”。
- [ ] 最小实现安全聚合字段：只汇总对应 API Key 归因行的 `total_tokens`，保留现金账单未知，不传出原始记录正文。
- [ ] 重跑定向 Node 测试直至通过。

### Task 2: 锁定数值、溯源和中文单位的页面契约

**Files:**
- Modify: `dashboard/src/pages/ValueComparisonPage.test.jsx`
- Modify: `dashboard/src/pages/ValueComparisonPage.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] 增加失败测试：官方 API 行必须出现真实紧凑 Token 数值，且页面中不再出现 `value.category.usage_detected` 作为该行主值。
- [ ] 增加失败测试：三张顶部卡分别显示“已录账类别”“本机 Token × 价格表”“使用价值 ÷ 已录支出”的可理解来源。
- [ ] 增加失败测试：趋势 `$39413.96` 显示为 `$3.94万`，Y 轴同样使用中文单位；小金额仍保留合理精度。
- [ ] 运行 Vitest 观察预期失败。
- [ ] 增加单一 `compactChinese` / `compactChineseMoney` 格式化路径，页面所有趋势柱顶与 Y 轴复用；官方 API 行优先显示 `observed_usage` 数值和单位；顶部状态改为来源/公式，不改变真实现金和估值语义。
- [ ] 更新 copy 注册表并重跑页面测试。

### Task 3: 移除宽屏独立拉伸，恢复参考比例

**Files:**
- Modify: `test/value-realtime-pages-style.test.js`
- Modify: `dashboard/src/pages/value-realtime-pages.css`

- [ ] 先增加失败样式契约：禁止 `min-height:1040px` 媒体查询按 `vh` 分别拉伸 `rt-workspace`、`vr-trend` 等区域；要求宽屏使用统一参考内容宽度、字体、图标和固定比例的尺寸 token。
- [ ] 运行 Node 样式测试，确认旧 `vh` 拉伸规则触发失败。
- [ ] 以参考图为准建立统一大屏 token，限制内容画布宽度并居中；按同一比例调整标题、KPI、焦点卡、Agent 卡、工作区、图标、字体和间距；不修改全局侧栏和其他页面。
- [ ] 重跑样式测试、两个页面 Vitest、typecheck 和生产构建。

### Task 4: 真实页面设计 QA 循环

**Files:**
- Modify: `design-qa.md`
- Create: `.codex-artifacts/2026-08-25-reference-scale-provenance-*.png/json`

- [ ] 用新服务和新浏览器在相同视口、相同状态打开参考与实现；等待字体和核心数据稳定。
- [ ] 生成同尺寸整页对照和焦点区域对照，不得使用两边独立缩放的 `object-fit`。
- [ ] 检查字体、间距、颜色、图标、文案、溢出、裁切、交互、控制台和功能 API；有 P0/P1/P2 时回到 RED→GREEN 修复并重新比较。
- [ ] `design-qa.md` 只有在无 P0/P1/P2 时写 `final result: passed`。

### Task 5: 全门禁、打包与两次独立安装版核对

**Files:**
- Create: `.codex-artifacts/2026-08-25-reference-scale-provenance-installed-round-1/*`
- Create: `.codex-artifacts/2026-08-25-reference-scale-provenance-installed-round-2/*`

- [ ] 运行 `git diff --check`、定向测试、Dashboard typecheck/build、文案与 UI hardcode 校验、`npm test`；记录真实退出码。
- [ ] 重新打包 Windows 安装程序，记录 SHA-256 与 Dashboard 资源 tree hash。
- [ ] 第一审使用全新安装 profile，从侧栏按正常鼠标操作核对验收合同全部行并截图。
- [ ] 完全退出后，用独立 profile 和相反页面顺序执行第二审；不得复用第一审结论。
- [ ] 只有两审全部通过才提供该精确安装包和两轮图片；否则继续修复，不交付候选包。
