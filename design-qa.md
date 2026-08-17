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

---

# 小组件用量套餐字段与卡片终审（2026-08-17）

本节为现行终审记录，覆盖上方阶段性记录中“Cursor 含 4 个窗口”的旧结论。当前真实数据契约为：Codex 2 条用量，Cursor 3 条用量；Cursor 不存在 `7d`、`monthly` 或第 4 条用量。

## 视觉真源与原生证据

- 用户最新参考与问题标注：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-4908d48e-3ac6-4505-bf5c-3575c1d3d390.png`
- 原生小组件页：`.artifacts/widget-audit-20260817/final-plan-card-audit/widgets-native-final.png`
- 原生成本设置 Token 套餐展开态：`.artifacts/widget-audit-20260817/final-plan-card-audit/cost-settings-token-plan-expanded.png`
- 用户参考与最终原生效果同图对照：`.artifacts/widget-audit-20260817/final-plan-card-audit/reference-vs-native-final.png`

## 第一审：修改结果与调整意见逐项匹配

| 调整意见 | 当前结果 | 核对证据 |
| --- | --- | --- |
| 套餐卡尺寸、形状、体积质感参照成本设置 Token 套餐卡 | 两张卡固定为 264 × 306 CSS 像素，圆角、薄边框、浅渐变和克制的分层阴影一致；没有明显黑色底部投影；两张卡等宽等高 | 原生截图与计算样式；成本设置展开态原生截图 |
| 勾选框在右上角，不显示绿点或橙点 | 两张卡的勾选框均固定右上角，状态点已移除 | `widgets-native-final.png` |
| Codex 必须区分为 2 条用量 | 仅显示 `7 天`、`GPT 5.3 Codex Spark` 两条，未生成额外窗口 | 原生 DOM 与截图 |
| Cursor 必须区分为 3 条用量 | 仅显示 `Total Usage`、`Auto + Composer Usage`、`API Usage` 三条 | 原生 DOM 与截图 |
| Cursor 不得出现错误的 `7d`、`monthly` 或第 4 条进度 | Cursor 卡片的上述错误字段均不存在 | 原生 DOM 查询与截图 |
| 账号必须来自真实套餐配置 | Codex 显示 `mux***@gmail.com`；Cursor 显示 `eze***@outlook.com` | 原生 DOM 与本地套餐配置 |
| 每条用量显示自己的真实重置时间，不得用有效期代替 | Codex 两条分别显示 `2026-08-20 11:33:19`、`2026-08-20 12:03:32`；Cursor 三条均显示 `2026-08-22 12:17:12` | 原生 DOM 与本地套餐配置中的官方重置时间戳 |
| 有效期与额度重置分开呈现 | 卡片底部单独显示套餐有效期；各进度条下分别显示额度重置时间 | `widgets-native-final.png` |

## 第二审：用户真实体验效果是否已经呈现

1. 重新执行前端生产构建、内嵌运行时准备和 Tauri 原生程序构建，启动的审核对象是本工作树的 `src-tauri/target/release/token-eyes.exe`，不是开发浏览器页面或源码推断。
2. 在原生 Tauri/WebView2 中进入小组件页，直接读取实际 DOM：Codex 为 2 条，Cursor 为 3 条；账号、用量名称、每条独立重置时间和套餐有效期均已实际渲染。
3. 原生截图中两张卡实测同为 264 × 306 CSS 像素；勾选框位于右上角，没有状态色点，没有明显黑色底部投影。
4. 打开同一原生程序中的成本设置 Token 套餐展开态，核对正式套餐卡的体积语言和同一份真实账号、用量名称与重置数据。
5. 将用户最新参考图与最终原生截图放入同一张对照图后进行可见差异核对；最终原生效果已明确区分 Codex 两条与 Cursor 三条，未发现 `7d`、`monthly` 或第 4 条 Cursor 进度。

## 验证记录

- `node --test test/widget-view-model.test.js test/local-api-desktop-widget.test.js`：18 项通过。
- `npm --prefix dashboard test -- src/pages/WidgetsPage.test.jsx src/pages/DesktopWidgetPage.test.tsx src/ui/foundation/__tests__/AppleGlassFidelity.test.jsx`：3 个文件、63 项通过；仅有既有 React `act` / canvas 警告，无失败。
- `npm --prefix dashboard run typecheck`：通过。
- `npm --prefix dashboard run build`：通过。
- `npm run tauri:prepare-runtime`：通过。
- `npx tauri build --no-bundle --config '{"build":{"beforeBuildCommand":""}}'`：通过，并以该原生产物完成第二审。
- `git diff --check`：通过。

本轮未提交、未推送、未合并、未封装安装包。

passed

---

# 小组件用量套餐卡片清洁度复验（2026-08-17）

## 视觉真源与原生证据

- 用户最新参考：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-d7dcabd9-5a45-4971-ac6d-3f6f72ad8c87.png`
- 原生小组件页：`.artifacts/widget-audit-20260817/latest-card-clean/01-widgets-plan-cards-native.png`
- 参考图与原生同图对照：`.artifacts/widget-audit-20260817/latest-card-clean/09-reference-vs-native-card-comparison.png`
- 原生悬浮小组件状态：`.artifacts/widget-audit-20260817/latest-card-clean/05-widget-agent-menu-native.png` 至 `08-widget-limits-expanded-native.png`

## 第一审：修改结果与要求逐项匹配

| 用户要求 | 修改结果 | 可验证证据 |
| --- | --- | --- |
| 去掉底部明显黑色投影 | 套餐卡不再叠加通用嵌套卡和 Token 服务卡的重阴影，只保留内描边与极轻的 `0 2px 8px / 4.5%` 柔和层次 | 原生计算样式和同图对照 |
| 两张卡片一样大 | 网格使用 `align-items: stretch`，卡片使用 `height: 100%` | 两张原生卡均为 `300 × 311.89288330078125` CSS 像素 |
| 勾选框放右上角 | 卡头结构改为拖拽柄、图标、标题信息、勾选框四列，勾选框在最后一列并顶端对齐 | 原生截图与 DOM 边界坐标 |
| 删除绿点、橙点 | 移除套餐状态圆点节点与对应样式 | 两张卡的 `.tt-token-plan-status` 数量均为 0 |

## 第二审：原生真实效果核对

1. 第一轮源码与测试通过后，原生实机仍出现明显底部黑影；计算样式显示 `0 7px 17px`，说明修改没有完全呈现。
2. 继续追查发现 `.tt-token-service-card` 的全局规则覆盖了小组件页局部阴影；先新增失败断言，再移除该错误复用类并重新构建原生程序。
3. 第二次原生实机核对中，两张卡等宽等高，勾选框位于右上角，绿点/橙点消失，卡片只剩轻微柔和层次，没有参考图所指出的黑色硬投影。
4. 另外重新截图核对概览每日明细遮盖式展开、使用明细请求日志、基础设置限制显示和悬浮小组件 Agent/项目/套餐状态，作为本轮其他页面的用户可见证据。

## 验证记录

- `npm test -- src/pages/WidgetsPage.test.jsx src/ui/foundation/__tests__/AppleGlassFidelity.test.jsx`：31 项通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm run tauri:prepare-runtime`：通过。
- `npx tauri build --no-bundle --config '{"build":{"beforeBuildCommand":""}}'`：通过，并以该原生产物完成第二审。

未提交、未推送、未合并、未封装安装包。

passed

---

# 当前最终结论：小组件用量套餐（2026-08-17）

以本文《小组件用量套餐字段与卡片终审（2026-08-17）》为当前有效结论：Codex 严格为 2 条用量，Cursor 严格为 `Total Usage`、`Auto + Composer Usage`、`API Usage` 3 条用量；旧记录中的 Cursor 4 条结论作废。最终原生证据为 `.artifacts/widget-audit-20260817/final-plan-card-audit/widgets-native-final.png`，同图对照为 `.artifacts/widget-audit-20260817/final-plan-card-audit/reference-vs-native-final.png`。

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

---

# 悬浮小组件与小组件套餐聚合复验（2026-08-17，最终重审）

## 视觉真源与原生实现证据

- 成本设置 Token 套餐参考：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-76d07bce-83da-49b3-9c60-436605a7ff38.png`
- Agent 展开态参考：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-dcd51e3c-6ee5-4c3a-bd5b-d0beca3ad00e.png`
- 原生小组件页套餐卡：`.artifacts/widget-audit-20260817/native-28-widgets-plan-cost-style-final.png`
- 原生 Agent 固定高度菜单：`.artifacts/widget-audit-20260817/native-32-agent-menu-final-collapsed.png`
- 原生 Agent 滚轮后状态：`.artifacts/widget-audit-20260817/native-33-agent-menu-wheel-final-collapsed.png`
- 三种侧栏模式摘要固定证据：`.artifacts/widget-audit-20260817/top-summary-final/`
- 参考图与原生实机同图对照：`.artifacts/widget-audit-20260817/latest-reference-vs-native-comparison.png`

原生悬浮小组件审核视口为 353 × 280 CSS 像素（折叠 + Agent 菜单）和 353 × 361 CSS 像素（三种内容展开态）；主应用审核视口为 1587 × 933 CSS 像素。全部证据均来自本轮重新构建并启动的 Tauri/WebView2 原生程序。

## 第一审：修改结果与用户要求逐项匹配

| 用户要求 | 实现结果 | 匹配证据 |
| --- | --- | --- |
| 小组件用量套餐参照成本设置 Token 套餐卡片 | 复用同类紧凑卡片语言：小圆角、薄边框、分层阴影、紧凑标题、细分隔线、进度条与有效期状态条；移除小组件设置页不需要的编辑/删除操作 | 同图对照首行；`data-card-layout="cost-settings-token-plan"` |
| 同一套餐下多个用量统一展示 | 顶层只按真实套餐生成卡片，额度窗口在同一卡片内纵向排列；Codex 1 张卡含 2 个窗口，Cursor 1 张卡含 4 个窗口 | `native-28-widgets-plan-cost-style-final.png` |
| 套餐内容干净、官方额度名称不降级 | Codex 第二个额度显示 `GPT 5.3 Codex Spark Weekly`，不再显示 `other`；有效期改为中文剩余时长与本地日期 | 原生 DOM 与截图均显示正式名称和 `有效期：13天 9小时 · 2026/08/30 22:24` |
| Agent 展开态不要过长，可用滚轮选择且没有右侧滚动竖条 | 菜单内容区固定为 180px；保留纵向滚轮；隐藏原生滚动条；实际滚轮后 `scrollTop` 从 0 变为 102.857 | `native-32-agent-menu-final-collapsed.png`、`native-33-agent-menu-wheel-final-collapsed.png` |
| Agent 选择显示框左右触底，不留无效空白 | 菜单项与选中高亮均占满菜单内层宽度，左右只保留统一内边距；选中行没有额外空栏 | 同图对照第二行；计算样式宽度 100% |
| 三个侧栏按钮展开后顶部折叠态内容固定不变 | 项目、用量套餐、模型消耗三种模式分别记录折叠与展开；顶部摘要的文字、HTML 和边界矩形完全相同，按钮只切换下方详情区 | `.artifacts/widget-audit-20260817/top-summary-final/` |

## 第二审：原生用户真实体验是否已经呈现

1. 首次源码与测试核对通过后，原生截图仍显示 `other`；追查确认是只重建 Tauri、未更新 EmbeddedServer 内嵌运行时，属于“代码已改但用户看不到”的真实交付失败。
2. 重新执行 `npm run tauri:prepare-runtime`，把当前源码及生产依赖写入正式内嵌运行时，再重建原生程序；第二次原生截图和 DOM 均显示 `GPT 5.3 Codex Spark Weekly`，证明最终呈现来自新产物而非开发源码推断。
3. 在原生悬浮小组件上真实打开 Agent 菜单并发送鼠标滚轮事件：菜单高度保持不变，滚动位置发生变化，DeepSeek Harness 与 WorkBuddy 可被滚入视野，右侧无滚动竖条。
4. 分别点击项目、用量套餐、模型消耗侧栏按钮并展开详情；三种状态的顶部摘要未发生文字、位置或尺寸变化，也没有因内容模式切换而闪烁重排。
5. 将两张用户参考图与最终原生截图放入同一张对照图，肉眼核对套餐卡体积、内部多用量分组、Agent 菜单玻璃体积、固定高度、触底宽度和隐藏滚动条，没有发现剩余任务级偏差。

## 验证记录

- `node --test test/widget-view-model.test.js`：15 项通过。
- `npx vitest run src/pages/WidgetsPage.test.jsx`：18 项通过；存在既有 React `act` 警告但无失败。
- `npm run typecheck`（dashboard）：通过。
- 任务相关 ESLint：通过。
- `npm run build`（dashboard）：通过。
- `npm run tauri:prepare-runtime`：通过，正式内嵌运行时已更新。
- `npx tauri build --no-bundle --config '{"build":{"beforeBuildCommand":""}}'`：通过，并以该原生产物完成第二审。

未提交、未推送、未合并、未封装安装包。

passed

---

# 全文最终有效结论（2026-08-17）

小组件用量套餐的最终原生结果是：Codex 2 条用量，Cursor 3 条用量。Cursor 的 3 条依次为 `Total Usage`、`Auto + Composer Usage`、`API Usage`，不存在 `7d`、`monthly` 或第 4 条。以 `.artifacts/widget-audit-20260817/final-plan-card-audit/widgets-native-final.png` 和 `.artifacts/widget-audit-20260817/final-plan-card-audit/reference-vs-native-final.png` 为最终用户可见证据；本文较早阶段记录中的 Cursor 4 条结论不再有效。

passed
