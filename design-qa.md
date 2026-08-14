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

# 套餐行情视觉验收记录

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
| 参考图的全宽收起态 | 已核实套餐目录，1865 × 1233 | 打开 `/spend/plans` | 无侧栏；标题、说明、右侧控件、四张统计卡和紧凑厂商行与参考结构、间距、圆角、描边和颜色一致。生产构建截图。 |
| 参考图的展开态 | 同一目录，2127 × 1328 | 逐个点击 GLM、阿里云百炼、Claude 的行标题 | 公告、套餐卡片网格、价格/额度、来源链接及向上箭头呈现；展开三项后回到页面顶部截图。 |
| 状态转换 | Chromium | 点击 GLM：收起→展开→收起→再展开 | `aria-expanded` 依次为 `true`、`false`、`true`；详情节点在收起时被移除。 |
| 筛选与排序 | Chromium | 厂商筛选 Claude；恢复全部；按套餐数升序 | 筛选后仅显示 Claude；恢复后首项为阿里云百炼；未修改目录数据。 |
| 窄屏适配 | 1024 × 900、390 × 844 | 打开初始态 | 统计卡重排，控件与行内容无横向溢出、遮挡或裁切。 |
| 生产资源呈现 | `dashboard/dist`，1865 × 1233 | Vite Preview 打开同一路由 | 收起态页面、图标、文字、卡片和交互控件实际呈现；产物包含 `PlanMarketPage-*.js`。 |

## 第一轮：逐项匹配核对

- 已修正首次实测中的侧栏宽度偏差：套餐行情路由改为参考图所示的全宽页面。
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
