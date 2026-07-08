# TE-NEXT-V03 - Mock Data UI Showcase

## 给执行 subagent 的说明

你是本工单执行者。只执行本文描述的任务，不要顺手改现有生产 Dashboard、Tauri、CLI、真实数据 API 或同步逻辑。

本工单的目标是创建一个完全独立的虚拟数据 UI 展示文件夹，用来提前演示 Token Eyes 后续正式界面会有哪些可视化内容，以及点击不同按钮时会出现哪些内容。真实功能开发完成后，再把这个演示中的虚拟数据入口替换为真实数据入口。

## 背景

当前 Token Eyes Windows 界面在无数据状态下会显示空卡片、空趋势图和提示文案。产品需要一个独立的演示区，先用虚拟数据把未来的展示效果跑通，方便确认信息架构、按钮切换和可视化内容。

用户明确要求：

- 单独创建一个文件夹。
- 用虚拟数据做 UI 展示。
- 展示界面里要能看到未来会出现哪些可视化内容。
- 点击不同按钮时要出现不同内容。
- 后期投入使用时，要能断开虚拟数据并接入真实数据。

## 范围

### 必须做

- 新建独立目录：`mock-data-ui-showcase/`
- 用静态 HTML/CSS/JS 实现一个可直接预览的演示界面。
- 演示界面不要依赖真实 API、登录、云端账号、Tauri bridge 或本地 CLI 服务。
- 虚拟数据必须集中放在独立数据文件中。
- UI 读取数据必须通过一个数据适配层，后续替换真实数据时只改适配层。
- 左侧导航至少包含：`概览`、`支出`、`设置`。
- 每个导航按钮点击后，右侧主区域展示不同内容。
- 概览页至少展示 Token 总数、成本、缓存命中率、活跃天数、使用趋势、Agent 分布、项目用量、每日明细。
- 支出页至少展示总成本、USD/CNY、Provider 统计、模型统计、请求日志。
- 设置页只做演示状态，不接真实设置，展示数据源状态、同步状态、未来接入真实数据的占位信息。

### 不要做

- 不要修改 `dashboard/src/` 下现有生产页面。
- 不要修改 `src/`、`src-tauri/`、`TokenTrackerWin/`、`TokenTrackerBar/`。
- 不要新增 npm 依赖。
- 不要接真实 API。
- 不要新增登录、授权、云同步或本地读取逻辑。
- 不要把演示入口挂到生产导航。

## 建议目录结构

```text
mock-data-ui-showcase/
  README.md
  index.html
  styles.css
  app.js
  data/
    mock-data.js
    data-source.js
```

职责说明：

- `index.html`：演示页面骨架，只引用本目录内的 CSS 和 JS。
- `styles.css`：演示界面全部样式，保持轻量，不引入构建链路。
- `app.js`：按钮切换、渲染图表、渲染表格、状态管理。
- `data/mock-data.js`：所有虚拟数据。
- `data/data-source.js`：唯一数据入口，后期真实数据接入时优先替换这里。
- `README.md`：说明如何打开、哪些是假数据、未来如何切换真实数据。

## UI 要求

### 整体布局

参考当前 Token Eyes 桌面窗口的信息结构：

- 左侧固定导航：顶部为产品名 `Token Eyes Demo`，下方为 `概览`、`支出`、`设置`。
- 右侧主内容区：顶部有时间范围按钮：`日`、`周`、`月`、`总计`、`自定义`。
- 顶部右侧有演示按钮：`刷新`、`分享`、`1分钟` 下拉样式按钮。它们只做 UI 状态反馈，不执行真实网络行为。
- 默认进入 `概览` 页面，默认时间范围为 `月`。

### 概览页内容

点击 `概览` 后展示：

- KPI 卡片：`TOKEN 总数`、`估算成本`、`缓存命中率`、`活跃天数`。
- 主趋势图：显示近 30 天 token 使用趋势，可以用 SVG polyline、CSS bar chart 或 Canvas 实现，不引入图表库。
- Agent 分布：显示 Codex、Claude Code、Cursor、Gemini、OpenCode 的占比。
- 使用热力图：显示近 6 周每日活跃程度。
- 项目用量：显示 5 个虚拟项目的 token 排名。
- 每日明细：表格展示日期、Token、成本、请求数、主要 Agent。

### 支出页内容

点击 `支出` 后展示：

- 总成本卡片：USD 和 CNY 同时显示。
- 成本趋势：近 30 天成本柱状图。
- Provider 统计：按 Agent 展示 token、成本、请求数。
- 模型统计：按模型展示 token、成本、缓存命中率。
- 请求日志：展示 8 条虚拟请求记录，包含时间、Agent、模型、Token、成本、状态。

### 设置页内容

点击 `设置` 后展示：

- 数据源状态卡片：当前为 `虚拟数据模式`。
- 接入说明卡片：说明后期只替换 `data/data-source.js`。
- 展示开关：`显示成本`、`显示缓存`、`显示请求日志`。这些开关必须影响页面展示内容。
- 同步状态：展示 `未连接真实数据`、`等待后端接入`。

## 交互要求

- 点击左侧 `概览`、`支出`、`设置`，主内容区必须切换。
- 点击时间范围 `日`、`周`、`月`、`总计`、`自定义`，KPI 和图表上的数字要随范围变化。
- 点击 `刷新`，按钮出现短暂 loading 或时间戳更新。
- 点击 `分享`，显示一个轻量弹层或 toast，内容为 `演示数据已准备分享`。
- 点击设置页开关，相关模块应隐藏或显示。
- 所有按钮必须有明显 active 状态。

## 数据接入约束

虚拟数据必须只通过 `data/data-source.js` 暴露给 UI。

建议接口：

```js
window.TokenEyesShowcaseDataSource = {
  getOverviewData(rangeKey) {},
  getSpendData(rangeKey) {},
  getSettingsData() {},
};
```

`app.js` 只能调用 `window.TokenEyesShowcaseDataSource`，不要直接读取 `mock-data.js` 中的原始对象。

后期接真实数据时，优先把 `data/data-source.js` 改成调用真实 API，`app.js` 不应大改。

## 视觉要求

- 风格保持产品工具属性：清晰、克制、信息密度合理。
- 不要做营销落地页，不要做大 hero。
- 不要用大面积紫色渐变。
- 不要用装饰性光球、过多阴影或花哨动画。
- 卡片圆角不超过 8px。
- 字号要适合桌面窗口和 1200px 宽度展示。
- 页面在 390px 手机宽度下也不能文字重叠。

## 验收标准

- [ ] 仓库根目录出现 `mock-data-ui-showcase/`。
- [ ] 直接打开 `mock-data-ui-showcase/index.html` 能看到完整演示界面。
- [ ] 左侧 `概览`、`支出`、`设置` 三个按钮都能切换内容。
- [ ] 时间范围按钮能改变展示数字或图表内容。
- [ ] 设置页开关能影响展示内容。
- [ ] 所有虚拟数据都集中在 `mock-data-ui-showcase/data/mock-data.js`。
- [ ] UI 只通过 `mock-data-ui-showcase/data/data-source.js` 获取数据。
- [ ] 没有修改生产 Dashboard、CLI、Tauri、Windows 或 macOS app 文件。
- [ ] 没有新增 npm 依赖。
- [ ] README 写清楚如何断开虚拟数据并接入真实数据。

## 手动验证步骤

```powershell
git status --short
Start-Process ".\mock-data-ui-showcase\index.html"
```

打开页面后人工检查：

1. 默认页面是 `概览`。
2. 点击 `支出`，主内容变为成本、Provider、模型、请求日志。
3. 点击 `设置`，主内容变为虚拟数据状态和展示开关。
4. 回到 `概览`，分别点击 `日`、`周`、`月`、`总计`、`自定义`。
5. 点击 `刷新`，确认更新时间或 loading 状态变化。
6. 点击 `分享`，确认出现 toast 或弹层。
7. 在设置页关闭 `显示成本`，确认概览和支出中的成本模块隐藏。

## 完成后提交

只 stage 本工单新增目录内的文件：

```powershell
git status --short
git add mock-data-ui-showcase docs/tasks/dispatch/TE-NEXT-V03-mock-data-ui-showcase.md
git commit -m "feat: add mock data ui showcase"
```

最后回复：

- 新增文件列表。
- 如何打开演示页面。
- 哪些按钮已可交互。
- 虚拟数据未来替换真实数据的入口文件。
- 验证结果。
