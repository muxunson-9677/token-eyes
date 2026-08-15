# Widget control design QA

- Source visual truth: `.codex-artifacts/widget-control-visual-audit/reference-basic-settings.png`
- Implementation screenshots: `.codex-artifacts/widget-control-visual-audit/widgets-toolbar-resting.png`, `.codex-artifacts/widget-control-visual-audit/widgets-toolbar-pressed.png`, `.codex-artifacts/widget-control-visual-audit/widgets-status-open.png`
- Combined comparison: `.codex-artifacts/widget-control-visual-audit/comparison.png`
- Primary viewport: 875 x 805, light theme, `/widgets`
- Secondary viewport: 1218 x 803, light theme, `/widgets`
- States: resting, pointer held, rebound/settled, dropdown open and option selected
- Console check: no JavaScript runtime exception occurred during the control interactions. The Vite-only preview still reports the existing local-data endpoint 502/404 responses when its desktop backend is unavailable; these responses do not affect the control rendering or interaction verified here.

**Findings**

- No remaining P0, P1, or P2 mismatch in the requested controls.
- The earlier implementation was blocked because `WidgetsPage` did not render the `.tt-reference-route-widgets` scope class. The route-scoped depth and animation rules therefore never matched the actual page even though stylesheet contract tests found the declarations.
- Post-fix evidence shows the Basic Settings reference controls and widget controls use the same `tt-raised-control` surface: identical border color, white-to-gray surface gradient, top highlight, and layered shadow.
- Pointer-down evidence shows a real `0.94` scale, `2px` downward translation, darker inset shadow, and subsequent return to rest. The same state was measured on the project-folder action and the Refresh Data action.
- All three toolbar dropdowns now use the same Base UI `Select` component as Basic Settings rather than native `<select>` controls. The status menu opened and changed from `状态：全部` to `活跃项目` in the browser run.

**Required fidelity surfaces**

- Fonts and typography: retained the existing widget toolbar font family, weight, size, icon sizing, truncation, and Chinese label wrapping. No clipping was visible at either viewport.
- Spacing and layout rhythm: existing control heights and toolbar wrapping were preserved. The raised surface adds depth without changing the table alignment or causing horizontal overflow at 875 x 805 and 1218 x 803.
- Colors and visual tokens: border, gradient, highlight, shadow, hover, and dark-theme values are now shared with the accepted Basic Settings controls through one class.
- Image and asset fidelity: no raster assets were introduced or replaced. Existing Lucide product icons remain sharp and aligned.
- Copy and content: labels and localized copy are unchanged. Dropdown selection behavior remains functional.

**Full-view comparison evidence**

- `.codex-artifacts/widget-control-visual-audit/widgets-resting.png`
- `.codex-artifacts/widget-control-visual-audit-1218x803/widgets-resting.png`

**Focused comparison evidence**

- `.codex-artifacts/widget-control-visual-audit/comparison.png` places the Basic Settings reference, widget resting state, and widget pressed state in one image.
- `.codex-artifacts/widget-control-visual-audit/report.json` records the computed border, gradient, shadow, dimensions, transform, dropdown selection, and refresh-button press state.

**Comparison history**

1. Earlier finding: widget rules existed in CSS but were never active because the route scope class was absent; native dropdowns also differed structurally from Basic Settings.
2. Fixes: added the real route scope, shared the accepted raised-control surface, replaced the three native selects with the shared Base UI `Select`, and retained a visible press/rebound response.
3. Post-fix evidence: 875 x 805 and 1218 x 803 captures show visible static elevation and a clearly compressed pressed frame; browser interaction confirms dropdown selection and Refresh Data press feedback.

**Open Questions**

- None for the requested control-depth and press-feedback scope.

**Implementation Checklist**

- [x] Basic Settings and Widgets share the same raised control surface.
- [x] Toolbar buttons have visible resting depth.
- [x] Toolbar dropdowns use the shared Select component and remain operable.
- [x] Refresh Data has the same resting depth and press response.
- [x] Pointer-down feedback is immediate and visibly changes scale, position, and inset shadow.
- [x] Reduced-motion users retain static feedback without the rebound animation.
- [x] Verified at both requested/current narrow viewport and a wider desktop viewport.

**Follow-up Polish**

- No task-scoped P3 follow-up is required.

final result: passed

---

# 套餐行情价格与折叠态信息组复验（2026-08-15，阶段性记录）

本节是当时 10 家厂商目录的阶段性核验；后续已新增小米 MiMo，并以 Google Antigravity 替换 Perplexity。现行目录与最终验证见本文末尾。

| 核对项 | 操作与证据 | 结果 |
| --- | --- | --- |
| 公开价格 | 复查 Cursor 官方定价及官方社区公开说明、OpenAI Business 官方定价页 | Cursor Pro+ 显示 `$60/月`；OpenAI Business 显示 `$25/用户/月`，并展示年付 `$20/用户/月`。 |
| 非公开固定价 | 复查 xAI、Cursor、OpenAI、Anthropic 与 Antigravity 官方定价页 | 仅在官网未给出统一数值时显示“官网结账页 / 联系销售 / 按量计费”；未填造价格。 |
| 桌面折叠态 | Chromium，1864 × 1237，`dashboard/tmp/plan-market-pricing-divider-desktop-20260815.png` | 标签、套餐数、起步价为 `标签｜套餐数｜起步价` 三段；两条 1px、32px 高分隔线可见；各行套餐数和价格列右边缘一致。 |
| Cursor 展开态 | Chromium 点击 Cursor | Pro+ 卡片实际呈现 `$60/月`。 |
| 窄屏折叠态 | Chromium，390 × 844，`dashboard/tmp/plan-market-pricing-divider-mobile-grok-20260815.png` | 卡片改为完整厂商信息在第一行、右对齐信息组在第二行；标签不竖排；`scrollWidth === clientWidth === 390`。 |

## 两次独立核对

1. **需求匹配**：核对补齐的公开价格、非公开价格的如实说明，以及桌面三段信息的分隔与对齐结构。
2. **真实效果**：分别在 1864px 桌面和 390px 移动端实际加载、截图并点击 Cursor 展开；发现移动端被信息组挤压后，已改为两行布局并重新截图确认。

## 当时验证

- `npm --prefix dashboard run test -- src/pages/PlanMarketPage.test.jsx`：11 通过。
- `node --test test/plan-market.test.js`：3 通过。
- `npm --prefix dashboard run typecheck`、`npm --prefix dashboard run build`、`npm run validate:copy`、`git diff --check`：通过。
- `npm test`：1,833 通过、0 失败、8 跳过。

未提交、未推送、未合并，也未进行安装包验证；这仍需用户明确授权。

final result: passed

# 套餐行情第二轮优化验收记录（阶段性记录）

## 验收矩阵

| 用户要求 | 真实场景与操作 | 可见结果 / 证据 |
| --- | --- | --- |
| 展开不跳动 | 1864×1237，鼠标按下并展开 GLM | header、统计区和 GLM 标题行的矩形完全相同；仅卡片详情使页面高度由 1695.34px 增至 2059.59px。 |
| 详情完整 | 展开当时的 10 家厂商（1024×768） | 10 个详情区全部可见、0 个详情横向溢出、0 个套餐卡内容裁切。 |
| 厂商补全 | 默认列表 | 当时在既有 7 家外新增火山引擎 / 豆包、xAI Grok、Perplexity；后续目录已替换为 Antigravity 并新增小米 MiMo。 |
| 直连与风险 | 展开国内与海外套餐 | 国内套餐为绿色“国内直连”；海外套餐为黄色“需要 VPN”；Claude 为红色“风控风险：极高”。 |
| 全球地区比价 | 初始页首屏 | 标题下方显示可点击的“全球不同地区订阅费比价”，跳转 opentherank 链接。 |
| 体积感与按压 | 真实鼠标 `mousedown` GLM 标题卡 | 按下时计算样式为 `scale(0.998)` 并下沉 2px；来源与比价按钮同样具有按压下沉样式；减少动态效果偏好会关闭过渡。 |

## 两次独立核对

1. **需求匹配**：逐项核对目录、完整字段、网络/风险语义、外链和按压反馈；补全目录数据全部使用对应官方页或官方帮助中心。
2. **真实效果审计**：用 Chromium 实际点击并截图，发现并修复 CSS 多余括号造成的 Vite 500，以及 1024px 中厂商标题被挤压的问题；修复后重新核对小桌面无横向溢出。

本记录不代表用户验收，也不代表原生安装包验收；在用户明确要求前未执行提交、推送、合并或打包。

---

# 套餐行情视觉验收记录（旧版阶段性记录）

## 视觉真源与实现证据

- 收起态参考：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-3a585d68-ee2b-4e33-965f-22a4beb240c1.png`
- 展开态参考：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-04120d5d-bb92-416e-8748-9c309271fdba.png`
- 生产构建收起态：`dashboard/tmp/plan-market-production.png`（1865 × 1233）
- 浏览器展开态：`dashboard/tmp/plan-market-expanded-top.png`（2127 × 1328）
- 较小桌面：`dashboard/tmp/plan-market-small-desktop-settled.png`（1024 × 900）
- 移动端：`dashboard/tmp/plan-market-mobile.png`（390 × 844）

## 验收矩阵

| 要求 | 数据/视口 | 操作 | 可见结果与证据 |
| --- | --- | --- | --- |
| 参考图的全宽收起态 | 已核实套餐目录，1865 × 1233 | 打开 `/spend/plans` | 当时为无侧栏的全宽结构；后续用户要求改为固定左侧导航，现行状态见本文末尾。 |
| 参考图的展开态 | 同一目录，2127 × 1328 | 逐个点击 GLM、阿里云百炼、Claude 的行标题 | 公告、套餐卡片网格、价格/额度、来源链接及向上箭头呈现；展开三项后回到页面顶部截图。 |
| 状态转换 | Chromium | 点击 GLM：收起→展开→收起→再展开 | `aria-expanded` 依次为 `true`、`false`、`true`；详情节点在收起时被移除。 |
| 筛选与排序 | Chromium | 厂商筛选 Claude；恢复全部；按套餐数升序 | 筛选后仅显示 Claude；恢复后首项为阿里云百炼；未修改目录数据。 |
| 窄屏适配 | 1024 × 900、390 × 844 | 打开初始态 | 统计卡重排，控件与行内容无横向溢出、遮挡或裁切。 |
| 生产资源呈现 | `dashboard/dist`，1865 × 1233 | Vite Preview 打开同一路由 | 收起态页面、图标、文字、卡片和交互控件实际呈现；产物包含 `PlanMarketPage-*.js`。 |

## 第一轮：逐项匹配核对

- 当时套餐行情路由采用参考图所示的全宽页面；后续已按用户要求恢复固定左侧导航。
- 已移除参考图不存在的说明行，并重新对齐标题、统计卡和首行的纵向位置。
- 已保留目录中的真实厂商、套餐数、价格、日期和官方来源；参考图中不存在于目录的厂商、热门/折扣标签及示例统计数未伪造。
- 已核对收起态和展开态的标题层级、右侧控件、统计卡、厂商图标、价格列、公告、套餐卡、来源链接、边框、圆角和留白。

## 第二轮：独立真实效果审计

- 实际 Chromium 运行中完成展开、收起、筛选、排序和恢复操作；页面宽度与客户端宽度均为 2127，无横向溢出。
- 单独查看 1024 和 390 宽度的真实截图；两种布局均无重叠或裁切。
- 生产构建后通过 Vite Preview 重新打开并截图，确认不是开发源码与产物脱节。
- 独立 Vite 页面会请求未由 Preview 托管的 `/api/auth/refresh` 并得到 404；这是独立静态预览缺少 CLI 本地 API 的既有运行时边界，未影响本页静态目录、展示或交互。未将其归因于套餐行情页面。

## 结果

passed

原生安装包未构建、安装或启动：本次用户未授权打包/覆盖安装，以上为浏览器中的生产前端产物验证，不应被表述为原生安装验证。

---

# 套餐行情视觉验收记录（旧版重审）

## 当时的视觉真源与证据

- 默认态参考：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-3a585d68-ee2b-4e33-965f-22a4beb240c1.png`（1864 × 1237）
- 展开态参考：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-04120d5d-bb92-416e-8748-9c309271fdba.png`（2139 × 1334）
- 当前默认态：`dashboard/tmp/plan-market-final-default-v2.png`（1864 × 1237）
- 当前展开态：`dashboard/tmp/plan-market-visual-pass-four-expanded.png`（2139 × 1334）
- 默认态并排比对：`dashboard/tmp/plan-market-compare-final-default.png`
- 展开态并排比对：`dashboard/tmp/plan-market-compare-final-expanded.png`

## 验收矩阵

| 要求 | 数据 / 视口 | 操作 | 当时可见结果 |
| --- | --- | --- | --- |
| 默认列表 1:1 结构 | 1864 × 1237 | 打开 `/spend/plans` | 当时为无侧栏、7 个厂商行的版本；后续已按用户要求改为固定左侧导航、11 家厂商。 |
| 展开详情 1:1 结构 | 2139 × 1334 | 点击智谱 GLM | 展开态收紧统计区和行标题；公告条、Lite/Pro/Max 三卡、入门/热门/推荐/高配标签、来源按钮和向上箭头均呈现。 |
| 收起 / 展开状态 | Chromium | 点击 GLM 后再次点击 | `aria-expanded` 为 `true` 后回到 `false`；详情节点移除，默认态恢复。 |
| 筛选 / 排序 | Chromium | 筛选 Cursor，恢复全部，再按套餐数排序 | 筛选后仅 1 行 Cursor；排序后首行是阿里云百炼。 |
| 较小桌面 | 1024 × 768 | 打开初始态 | `scrollWidth === clientWidth === 1024`，无横向溢出。 |

## 第一轮：需求逐项匹配

- 以第一张图作为默认列表的厂商、统计数和标签真源：7 个厂商、3 个最近更新、26 个套餐变体、100% 来源覆盖。
- 以第二张图作为 GLM 展开状态的结构真源：76px 展开标题、公告条、三张套餐卡和来源区的纵向落点均重新测量并对齐。
- 使用设计稿裁取的 7 个品牌图形替换近似的项目通用图标，避免品牌图标漂移。
- 修正默认态行高，确保同尺寸视口中第 7 行完整呈现。

## 第二轮：独立真实效果审计

- 真实 Chromium 点击完成展开、收起、筛选、恢复和排序；不是再次运行静态截图。
- 展开时厂商级标签不会残留在展开标题中，避免与第二张设计稿冲突。
- 浏览器仅出现 `http://127.0.0.1:5173/api/auth/refresh` 的 404：独立 Vite 本地预览缺少 CLI 后端，该请求不影响此静态套餐目录、筛选、排序或展开交互。未验证原生安装包。

## 当时构建验证

- `npx vitest run src/pages/PlanMarketPage.test.jsx src/App.routes.test.jsx`：2 文件、26 测试通过。
- `npm --prefix dashboard run typecheck`、`npm --prefix dashboard run build`、`npm run validate:copy`、`git diff --check`：通过。文案校验仅保留项目既有的未使用键警告。

final result: passed

---

# 套餐行情当前交付前复核（2026-08-15）

本节为现行记录，覆盖上方所有阶段性记录：路由保持固定左侧导航；目录为 **11 家厂商、51 个套餐**，包含小米 MiMo 与 Google Antigravity，不包含 Perplexity。

| 核对项 | 当前要求 | 当前可见结果 / 证据 |
| --- | --- | --- |
| 左侧导航与紧凑布局 | 左侧导航全局固定，折叠态卡片较旧版缩小 | `/spend/plans` 在应用导航壳内渲染；卡片保持紧凑信息组。 |
| 价格与档位完整性 | 所有公开价格逐档显示；无统一价时如实显示销售/按量说明 | Grok 显示 `$0`、`$10`、`$30`、`$100`、`$300`、`$30` 与“联系销售（定制报价）”；Kimi 显示 `¥49/¥99/¥199/¥699`；MiMo 显示 `¥39/¥99/¥329/¥659`。 |
| 折叠态信息组 | 标签、套餐数、起步价右侧整齐对齐，分隔线清晰 | 真实桌面与窄屏浏览器检查；桌面为三段信息组，窄屏切为两行且无横向溢出。 |
| 官方图标 | 小米 MiMo 使用官方图标 | `/plan-market-icons/xiaomi-mimo.png` 来自 MiMo 官方站点，并在厂商行实际呈现。 |
| 间距与展开内容 | 比价入口与统计卡之间紧凑；展开不省略档位详情 | 入口与统计区间距收紧；展开包含公告、全部套餐卡、价格、额度、亮点和官方来源。 |

## 两次独立核对

1. **需求匹配**：逐条核对固定导航、11 家/51 套餐目录、Kimi 与 Grok 价格、MiMo 图标、右侧信息组和紧凑间距。
2. **真实效果**：分别在开发与生产构建中加载页面；展开全部厂商并检索价格节点，确认 51 张套餐卡都有可见价格或明确的非固定价文案，且不存在横向溢出。
