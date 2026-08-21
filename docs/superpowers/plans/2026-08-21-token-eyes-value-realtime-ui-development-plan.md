# Token Eyes 价值对比与实时会话详细开发计划

> **执行代理要求：** REQUIRED SUB-SKILL：使用 `superpowers:executing-plans` 按任务顺序执行；若用户明确授权并行代理，再使用 `superpowers:subagent-driven-development`。每完成一个复选框都要留下对应证据，不能跨阶段凭印象勾选。

**目标：** 在 Token Eyes `0.54.47` 的隔离分支中新增“价值对比”和“实时会话”两个真实功能页。现有左侧导航视觉完全保留，只在“套餐行情”后依次新增两个入口；两页右侧内容区以用户提供的两张设计稿为最终视觉目标复刻，并使用真实、可解释、隐私安全的数据。

**架构：** 保持现有 `AppLayout → App.jsx 路由 → Page → hook → dashboard API client → loopback local API → 纯聚合模块 → 既有 usage/spend/plan/lifecycle 数据源` 分层。新计算先写成无文件系统副作用的纯函数并单测，`local-api.js` 只负责读取现有数据并组装输入，页面只消费已定义的只读 view model。未知数据使用 `null + evidence_state`，不得在 UI 层猜测或补零。

**技术栈：** Tauri 2、Node.js CommonJS、React 18、TypeScript、Vite、Tailwind/CSS、Lucide、原生 SVG、Vitest、Testing Library、Node Test Runner、Playwright、pixelmatch。

**任务清单：** [2026-08-21-token-eyes-value-realtime-ui-task-checklist.md](./2026-08-21-token-eyes-value-realtime-ui-task-checklist.md)

---

## 一、执行前必须理解的固定结论

### 1.1 输入和优先级

1. 用户后追加的导航约束优先于原方案“推荐导航”：不得新增新的一级“价值对比/实时会话”分组。
2. 左侧导航以现有 Token Eyes 实现为准；两张设计稿只约束右侧内容区。
3. 右侧内容区以设计稿为最终结果，不是风格参考；但设计稿中的数字、Agent、套餐、趋势只是确定性视觉状态，不是生产数据。
4. 产品方案约束数据意义、隐私白名单、状态与不做事项；它不授权提交、推送、合并、打包或发布。
5. 未经用户下一条明确指令，不执行本计划中的任何产品代码任务。

### 1.2 已完成的需求覆盖核对

| 原始要求 | 清单落点 | 本计划落点 |
|---|---|---|
| 两个独立功能页 | 清单 3/4、3/6 | 任务 5–16 |
| 左侧只在套餐行情后新增两项 | 清单 2、验收 NAV-01 | 任务 3 |
| 左侧不用设计稿样式 | 清单 1.3、2.2 | 任务 3、17 |
| 右侧内容页最终复刻 | 清单 1.3、3/4、3/6 | 任务 1、8、13、17 |
| 价值计算和套餐归因 | 清单 3/3、4.1 | 任务 5–9 |
| 实时规则和多 Agent 层级 | 清单 3/5、4.2 | 任务 10–16 |
| WorkBuddy/CodeBuddy/Qoder/Trae 原生单位 | 清单 3/2、4.3 | 任务 14 |
| 隐私白名单 | 清单 3/7、验收 PRIV-01 | 任务 4、15 |
| 八种数据状态、未知不为零 | 清单 3/2、7 | 任务 4–15 |
| P0–P5 实施顺序 | 清单 4.4 | 本计划阶段 P0–P5 |
| 不推荐、不排行、不固定换算、不强行合并 | 清单 5 | 任务 4、5、11、14、16 |
| 两次独立最终验收 | 清单 3/10、3/11 | 任务 17、19 |

这张表是“覆盖存在性”核对；真正完成仍以任务清单第 6 节每条验收证据为准。

### 1.3 固定路由、copy key 与接口名

为避免执行者自行命名造成测试和实现分叉，统一使用：

| 对象 | 固定值 |
|---|---|
| 价值对比路由 | `/spend/value-comparison` |
| 实时会话路由 | `/spend/realtime-sessions` |
| 价值导航 copy | `nav.spend.value_comparison` |
| 实时导航 copy | `nav.spend.realtime_sessions` |
| 价值 local API | `/functions/tokentracker-value-comparison` |
| 实时 local API | `/functions/tokentracker-realtime-sessions` |
| 价值页面状态存储 | `tt.valueComparison.preferences.v1` |
| 实时页面状态存储 | `tt.realtimeSessions.preferences.v1` |

---

## 二、目标文件结构

执行完成后，新增或主要修改文件应落在以下边界；如果必须越界，先记录原因并向用户说明。

```text
docs/reference/value-realtime-ui/
  README.md
  value-comparison-reference.png
  realtime-sessions-reference.png

src/lib/
  value-comparison-view-model.js
  realtime-session-view-model.js
  local-api.js

dashboard/src/
  App.jsx
  content/copy.csv
  lib/api.ts
  hooks/use-value-comparison.ts
  hooks/use-realtime-sessions.ts
  pages/ValueComparisonPage.tsx
  pages/ValueComparisonPage.test.tsx
  pages/RealtimeSessionsPage.tsx
  pages/RealtimeSessionsPage.test.tsx
  ui/components/Sidebar.jsx
  ui/components/__tests__/Sidebar.nav.test.jsx
  ui/value-realtime/
    EvidenceState.tsx
    DisclosureRow.tsx
    SvgCharts.tsx
    ValueComparisonView.tsx
    RealtimeSessionsView.tsx
    value-realtime.css

test/
  value-comparison-view-model.test.js
  realtime-session-view-model.test.js
  local-api-value-comparison.test.js
  local-api-realtime-sessions.test.js
  value-realtime-privacy.test.js
  app-route-pathname-guard.test.js

dashboard/scripts/
  capture-value-realtime-reference.mjs
  verify-value-realtime-visual.mjs
```

原则：不要把新页面样式继续堆进巨大的全局 `dashboard/src/ui/foundation/apple-glass.css`；新样式必须由 `.tt-value-comparison-page` 或 `.tt-realtime-sessions-page` 根选择器限定。不要引入新的图表依赖，使用当前依赖和小型原生 SVG 组件。

---

## 三、执行计划

## 阶段 P0：范围、视觉标尺、数据与隐私合同

### 任务 0：重新建立实施现场并执行基线门

**读取：**

- `AGENTS.md`
- `CLAUDE.md`
- `E:\下载\Token_Eyes_用户价值与实时会话优化方案_v1.md`
- E 盘 Obsidian 中与 Codex、Token Eyes、worktree、UI 验收、依赖和打包有关的错误经验笔记
- 本任务清单和本开发计划

- [ ] 在目标工作树运行并保存输出：

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
git status --short --branch
git worktree list --porcelain
node -p "require('./package.json').version"
```

**期望：** 根目录是 `D:\04-AI-Project\010-Token eye\.worktrees\value-realtime-ui-05447`；分支是 `codex/value-realtime-ui-05447`；开始时基线是 `7445f02...`，若已经前移则必须记录实际 SHA，不能 reset 回旧 SHA。

- [ ] 检查依赖是否存在且属于当前工作树：

```powershell
Test-Path -LiteralPath 'node_modules'
Test-Path -LiteralPath 'dashboard/node_modules'
git check-ignore -v node_modules dashboard/node_modules
```

- [ ] 若依赖缺失，按 lockfile 安装；不得从其他 worktree 复制未知状态的依赖：

```powershell
npm ci
npm --prefix dashboard ci
```

- [ ] 执行未改代码基线：

```powershell
node --test test/app-route-pathname-guard.test.js
npm --prefix dashboard run test -- src/ui/components/__tests__/Sidebar.nav.test.jsx
npm --prefix dashboard run typecheck
```

**期望：** 全绿。若失败，保存原始输出并先区分基线故障、依赖故障和本任务故障；未完成归因前不得编码。

- [ ] 建立验收工作记录，逐行复制任务清单第 6 节的 NAV/VALUE/LIVE/UNIT/PRIV/STATE/RESP/ART 行，并预留“源码、API、开发 UI、生产 UI、第二审”证据栏。

### 任务 1：固化设计稿并建立右侧内容视觉标尺

**创建：**

- `docs/reference/value-realtime-ui/value-comparison-reference.png`
- `docs/reference/value-realtime-ui/realtime-sessions-reference.png`
- `docs/reference/value-realtime-ui/README.md`

- [ ] 将两张原图按原始字节复制到上述路径；不得重新压缩、缩放或截图转存。
- [ ] 重新计算 SHA-256，必须分别等于：
  - `2f9cfbb4c64427f79e589d265ba8e8adac2f15ed39bb187495a22ccc20efdda7`
  - `931f7f4ec30788829a86e58e249593592327733c4101788267f9f3f1e3855e66`
- [ ] 在 `README.md` 记录：原始路径、尺寸、哈希、右侧内容起始边界、标题栏排除区、左侧导航排除区、目标应用视口和缩放比例。
- [ ] 逐页记录几何标尺：内容外边距、标题基线、顶部控件高度、主卡高度、列宽比例、卡片间距、圆角、边框色、阴影、图表区高度、折叠行高度。
- [ ] 列出每张稿的所有可见控件和状态，做到实现时可一一打勾：
  - 价值页：标题/副标题、五种日期入口、事实声明、三段主叙事、辅助摘要、双栏构成、套餐表、六个月图、三行折叠。
  - 实时页：标题/副标题、今天、更新时间/刷新、三项摘要、焦点卡、Agent 横排、四个 Tab、环图、趋势图、三个右侧折叠。
- [ ] 明确对比时只比较右侧内容区域；侧栏和标题栏只检查“仍为现有 Token Eyes”，不进入像素匹配。

### 任务 2：先定义共享数据合同和计算不变量

**创建：**

- `docs/dev-notes/value-realtime-data-contract.md`
- `test/value-comparison-view-model.test.js`
- `test/realtime-session-view-model.test.js`

**价值接口固定顶层结构：**

```ts
type EvidenceState =
  | "exact" | "estimated" | "partial" | "quota_only"
  | "connected_no_exact_data" | "authorization_required"
  | "unsupported" | "stale";

interface EvidenceValue<T> {
  value: T | null;
  state: EvidenceState;
  source: string | null;
  observed_at: string | null;
  note_code: string | null;
}

interface ValueComparisonResponse {
  ok: true;
  generated_at: string;
  range: { preset: "today" | "7d" | "month" | "30d" | "custom"; from: string; to: string };
  headline: {
    actual_spend_usd: EvidenceValue<number>;
    api_equivalent_value_usd: EvidenceValue<number>;
    value_multiplier: EvidenceValue<number>;
    recognized_tokens: EvidenceValue<number>;
    data_coverage_percent: EvidenceValue<number>;
    pricing_coverage_percent: EvidenceValue<number>;
  };
  composition: { actual_spend: ValueSlice[]; api_equivalent_value: ValueSlice[] };
  plans: PlanValueRow[];
  monthly_trend: MonthlyValuePoint[];
  details: ValueComparisonDetails;
}
```

**实时接口固定顶层结构：**

```ts
interface RealtimeSessionsResponse {
  ok: true;
  observed_at: string;
  revision: string;
  range: { preset: "today"; from: string; to: string };
  summary: {
    active_agent_count: EvidenceValue<number>;
    resources: NativeResourceValue[];
    api_equivalent_value_usd: EvidenceValue<number>;
  };
  focus_session: RealtimeSession | null;
  agents: RealtimeAgentSummary[];
  composition: RealtimeComposition;
  trend: RealtimeTrendPoint[];
  child_sessions: RealtimeSession[];
  requests: RequestDiagnosticV2[];
  data_status: EvidenceStateCounts;
  pricing_coverage_percent: EvidenceValue<number>;
}
```

- [ ] 为每个字段在合同文档中填写“来源、单位、允许状态、空值含义、过期阈值、是否可相加”。
- [ ] 写失败测试锁定以下不变量：
  1. 未知输入输出 `null`，不能输出 `0`。
  2. 价值倍数仅在分子已知且实际支出 `> 0` 时计算。
  3. 账户余额、USD 额度、实际现金、API 等价值互不相加。
  4. `plan_ref/account_ref` 缺失时只进入 `unattributed`。
  5. 原生资源单位不同不得合计成单一数字。
  6. 只有明确 `parent_session_id` 才能建立父子关系。
  7. 没有新 revision 时实时数据不变。
  8. 任何返回对象都不存在正文类字段。
- [ ] 先运行测试并确认因模块尚不存在而失败：

```powershell
node --test test/value-comparison-view-model.test.js test/realtime-session-view-model.test.js
```

**期望失败：** `MODULE_NOT_FOUND` 或明确的未实现断言；不能是语法、路径或测试本身错误。

### 任务 3：锁定导航、路由和 copy 合同

**修改：**

- `dashboard/src/ui/components/__tests__/Sidebar.nav.test.jsx`
- `test/app-route-pathname-guard.test.js`
- `dashboard/src/ui/components/Sidebar.jsx`
- `dashboard/src/App.jsx`
- `dashboard/src/content/copy.csv`

- [ ] 先把 Sidebar 结构测试的 spend 子路由期望改为：

```js
[
  "/spend/usage",
  "/spend/cost",
  "/spend/plans",
  "/spend/value-comparison",
  "/spend/realtime-sessions",
]
```

- [ ] 增加测试：两个新增入口都位于同一个 spend `children` 数组；overview/settings 数组完全不变；两项使用对应 copy key。
- [ ] 增加路由静态守卫：`App.jsx` 包含两个精确路径、两个懒加载页面和 `isSpendSubPath` 纳入；两个路径不在隐藏路由集合。
- [ ] 运行并确认红灯：

```powershell
node --test test/app-route-pathname-guard.test.js
npm --prefix dashboard run test -- src/ui/components/__tests__/Sidebar.nav.test.jsx
```

- [ ] 在 `Sidebar.jsx` 的 `spend.children` 中只追加两项，不改父组、图标、折叠逻辑或样式。
- [ ] 在 `App.jsx` 增加两个 lazy import、两个精确 path boolean、两个 PageComponent 分支，并纳入现有 `isSpendSubPath`。
- [ ] 先创建最小页面导出，让路由可解析；此时页面只可显示 copy 驱动的加载占位，不能写死最终数字。
- [ ] 在 `copy.csv` 注册导航和最小页面 copy；按仓库机制同步生成的 i18n JSON，不直接制造与 CSV 不一致的手改副本。
- [ ] 运行转绿并追加校验：

```powershell
node --test test/app-route-pathname-guard.test.js
npm --prefix dashboard run test -- src/ui/components/__tests__/Sidebar.nav.test.jsx
npm run validate:copy
npm run validate:ui-hardcode
```

- [ ] 人工检查 diff：Sidebar 现有类名、DOM 层级、图标和展开逻辑没有任何非必要变化。

### 任务 4：实现隐私白名单和安全输出守卫

**创建/修改：**

- `docs/dev-notes/value-realtime-data-contract.md`
- `test/value-realtime-privacy.test.js`
- `src/lib/value-comparison-view-model.js`
- `src/lib/realtime-session-view-model.js`

- [ ] 在合同中只允许：task/session/request ID、时间、Agent、模型、Token、状态、延迟、成本、原生额度、脱敏项目标识和证据元数据。
- [ ] 建立禁止字段集合，至少包含：`prompt`、`messages`、`content`、`response`、`completion`、`code`、`file_content`、`tool_result`、`system_prompt`、`reasoning`、`secret`、`api_key`、`authorization`、`cookie`。
- [ ] 写递归负向测试：输入 fixture 故意包含上述敏感字段，两个 view model 的 JSON 序列化结果不得出现字段名或哨兵正文。
- [ ] ID 使用稳定安全 ID；项目只输出末级安全标签或哈希引用，不返回完整本机路径。
- [ ] 错误消息只能输出稳定 `note_code`，不能透传可能含路径/凭据的上游原文。
- [ ] 运行：

```powershell
node --test test/value-realtime-privacy.test.js
```

**期望：** 负向 fixture 全部被剥离，允许字段保留。

## 阶段 P1：价值对比 MVP（现有聚合数据）

### 任务 5：实现价值对比纯聚合模块

**实现：** `src/lib/value-comparison-view-model.js`

**测试：** `test/value-comparison-view-model.test.js`

- [ ] 导出 `buildValueComparisonViewModel(input)`，输入只接受已读取的 spend timeseries、token plans、官方 API 账单和 `now/range`，模块内不读磁盘、不访问网络。
- [ ] 实际支出严格按现有语义组成：订阅实付 + 官方 API 账单 + other_ai 实际花销；不要把 API 等价估算或额度余额计入。
- [ ] 使用价值从 `spend-timeseries` 已有公开价格结果取值，沿用 `pricing_version/source_url/source_updated_at/observed_at/is_stale/estimated/pricing_coverage`，不在新模块重建价格引擎。
- [ ] 复用 `computeSubscriptionRoi` 的边界语义或在 CommonJS 侧写等价测试：实际支出小于等于零、未知或分子未知时 multiplier 为 `null`。
- [ ] 构成固定为 `subscription`、`api_key`、`native_resource`、`unattributed`；无证据类别不补假数。
- [ ] 六个月趋势按日历月输出，仅包含真实月份；非法日期、1970-01-01、未来异常日期不进入图表。
- [ ] 比较变化率时，前期为零/未知时返回 `null + note_code`，不能显示无限大或 0%。
- [ ] 补齐测试矩阵：典型、空数据、真实零支出、未知支出、部分定价、全部未定价、过期、重复行、非法日期、上游错误的最后成功快照。
- [ ] 运行：

```powershell
node --test test/value-comparison-view-model.test.js
```

### 任务 6：接入价值对比只读 local API

**修改：** `src/lib/local-api.js`

**创建：** `test/local-api-value-comparison.test.js`

- [ ] 将 `/functions/tokentracker-value-comparison` 加入只读聚合缓存集合，缓存 key 必须包含 `preset/from/to/time_zone/tz_offset_minutes` 和底层 queue/config mtime。
- [ ] GET 参数规则：
  - `preset=today|7d|month|30d|custom`
  - custom 必须同时有合法 `from/to`
  - `from <= to`
  - 日期按现有 timezone helpers 解释
  - 非法参数返回 400，不回退到本月掩盖错误
- [ ] 路由内复用现有嵌套 `readSpendTimeseries(...)` 和 token plan/config 读取，不复制聚合 SQL/价格逻辑。
- [ ] 将读取结果传给 `buildValueComparisonViewModel`，响应不包含原始账单凭据、完整路径或上游密钥。
- [ ] 沿用 `hasAllowedLoopbackOrigin`；非 GET 返回 405；非允许来源返回 403。
- [ ] 测试必须通过注入 provider/临时目录构造数据，不读取用户真实目录。
- [ ] 覆盖 200、400、403、405、空数据、部分定价、缓存失效和上游失败。
- [ ] 运行：

```powershell
node --test test/local-api-value-comparison.test.js test/value-realtime-privacy.test.js
```

### 任务 7：实现价值 API client 与 hook

**修改：** `dashboard/src/lib/api.ts`

**创建：** `dashboard/src/hooks/use-value-comparison.ts`

**测试：** `dashboard/src/hooks/use-value-comparison.test.tsx`

- [ ] 在 `PATHS` 增加 `valueComparison`，定义与合同完全一致的 TypeScript 类型并导出 `getValueComparison(params, signal)`。
- [ ] hook 返回固定状态：`data/loading/refreshing/error/stale/lastSuccessfulAt/preferences/setRange/refresh`。
- [ ] 初次进入、日期变化和手动刷新才请求；请求中切换范围必须 Abort 前一个请求，旧响应不能覆盖新范围。
- [ ] 失败时保留同一范围的最后成功快照并标记 stale；不同范围不得串用旧快照。
- [ ] 从 `tt.valueComparison.preferences.v1` 读取合法 preset/custom range；损坏 JSON 回退到 `month`，不能抛错。
- [ ] 测试初载、切换、竞态取消、失败保留、重试、存储恢复和损坏存储。
- [ ] 运行：

```powershell
npm --prefix dashboard run test -- src/hooks/use-value-comparison.test.tsx
```

### 任务 8：复刻价值对比右侧内容页

**实现：**

- `dashboard/src/pages/ValueComparisonPage.tsx`
- `dashboard/src/pages/ValueComparisonPage.test.tsx`
- `dashboard/src/ui/value-realtime/ValueComparisonView.tsx`
- `dashboard/src/ui/value-realtime/EvidenceState.tsx`
- `dashboard/src/ui/value-realtime/DisclosureRow.tsx`
- `dashboard/src/ui/value-realtime/SvgCharts.tsx`
- `dashboard/src/ui/value-realtime/value-realtime.css`

- [ ] 先写页面合同测试，使用 API fixture 而非组件硬编码数字，断言标题、五种日期入口、事实声明、三段主指标、构成、套餐表、趋势和三个折叠入口都存在。
- [ ] 根节点使用 `tt-value-comparison-page` 和稳定 `data-testid`；页面只占 `AppLayout` 右侧区域。
- [ ] 顶部日期控件顺序严格为：今日、近 7 天、本月、近 30 天、日历；选中态、hover、focus 和禁用态与设计稿层级一致。
- [ ] 顶部主卡是一个连续容器，内部为“实际支出 → 使用价值 → 价值倍数”，禁止拆成三张同权大卡。
- [ ] 数字格式：金额保留合理小数、Token 使用中文万/亿缩写、倍数用 `×`；未知显示 copy 驱动的 `—/暂无精确数据`，不得调用 `Number(null)`。
- [ ] 构成条、套餐趋势微图、六个月双柱图使用传入数据；SVG 提供可读 `aria-label` 或邻接文本表述。
- [ ] 套餐表默认显示设计稿对应数量，查看全部后可达全部行；长名称省略但 tooltip/可访问名称可读。
- [ ] 三个三级入口默认折叠；每项独立写入页面 preferences，刷新/离开返回/重启后恢复，不跨页污染。
- [ ] 加载、空、部分、过期、错误和恢复必须占用同一布局骨架，避免大幅跳动。
- [ ] 所有用户可见文案写入 `copy.csv`；组件中只使用 `copy()`。
- [ ] CSS 逐项匹配参考标尺，先保证 1620×971 目标视口，再处理小/中/大宽度；禁止通过整体 `transform: scale()` 假装匹配。
- [ ] 运行：

```powershell
npm --prefix dashboard run test -- src/pages/ValueComparisonPage.test.tsx
npm run validate:copy
npm run validate:ui-hardcode
```

## 阶段 P2：套餐级归因

### 任务 9：补齐 plan_ref/account_ref 的可追溯归因

**修改：**

- `src/lib/value-comparison-view-model.js`
- 必要时最小修改 `src/lib/usage-attribution.js` / `src/lib/usage-attribution-handler.js`
- `test/value-comparison-view-model.test.js`
- `test/usage-attribution*.test.js` 中直接受影响的测试

- [ ] 先用 fixture 建立三类记录：明确 plan_ref、仅 account_ref、完全未归因。
- [ ] plan 行只能聚合明确匹配该 plan 的使用价值和实付；同 provider 但无 ref 的记录不得按名称猜入。
- [ ] account_ref 只有在账户与套餐一对一且合同已有可靠证据时才能上卷；否则显示账户级结果。
- [ ] 所有未归因金额和 Token 必须在 totals 中可对账，并在详情中说明原因。
- [ ] 套餐行输出 `attribution_state` 和 evidence count，使 UI 能显示精确/部分/未归因。
- [ ] 抽样验证：所有套餐使用价值 + 账户级 + 未归因 = 顶层使用价值（在相同价格覆盖范围内）。
- [ ] 运行：

```powershell
node --test test/value-comparison-view-model.test.js test/usage-attribution*.test.js
```

## 阶段 P3：Codex、Claude Code、Hermes 实时会话 MVP

### 任务 10：先完成三类 Agent 证据盘点和特征测试

**修改/创建：**

- `docs/dev-notes/value-realtime-data-contract.md`
- `test/realtime-session-view-model.test.js`
- 必要时新增不含正文的测试 fixtures

- [ ] Codex：复用 `collectCodexLifecycleSessions` 的 session/project/status/updatedAt；Token 从带可靠 `session_id` 的 usage 行归因。
- [ ] Claude Code：使用 `claude-request-usage.js` 或 queue 中明确 session ID 的请求元数据；若没有显式 lifecycle，状态显示“最近有用量/未知”，不得写“运行中”。
- [ ] Hermes：只使用现有采集器明确提供的 session/request ID 与时间；缺状态证据同样降级，不按文件 mtime 推断运行中。
- [ ] 为每个 Agent 在合同中填“ID 来源、Token 来源、状态来源、标题来源、延迟来源、可支持字段、不可支持字段”。
- [ ] 先写特征测试锁定真实输入 shape；解析过程中不得把 prompt/response/message content 带入 fixture 输出。
- [ ] 若某 Agent 当前没有可验证 session ID，页面仍显示 Agent 级汇总并标 `partial`，同时把 session 卡留空；禁止伪造 session。

### 任务 11：实现实时会话纯 view model

**实现：** `src/lib/realtime-session-view-model.js`

**测试：** `test/realtime-session-view-model.test.js`

- [ ] 导出 `buildRealtimeSessionViewModel({ usageRows, lifecycleSessions, limits, requests, nowMs, range })`。
- [ ] 会话结构包含：安全 session ID、可选 parent/root ID、Agent、证据状态、可读标题及来源、项目安全标签、Token 分项、原生资源、API 等价值、请求数、子 Agent 数、时长、模型、计费方式、updated_at。
- [ ] 焦点会话排序：明确异常/等待审批优先，其次明确运行，再按最新真实事件；只有 unknown/recent activity 时不升级成 running。
- [ ] 活跃 Agent 计数只统计有明确 active lifecycle 的 Agent；最近用量但无 lifecycle 单列为 observed，不混入 active 数。
- [ ] 趋势点来自真实事件时间桶；没有新事件不得追加点或递增。
- [ ] `revision` 对规范化输入的 ID/时间/数值哈希，输入不变时 revision 稳定。
- [ ] 标题优先级：允许的官方 thread title → 安全项目标签 → copy 驱动降级；禁止读取正文生成标题，UUID 只可出现在详情。
- [ ] 子 Agent 只按显式 parent ID 建树；孤儿节点进入 unlinked，循环父子关系被拒绝并标 partial。
- [ ] 请求明细复用 `RequestDiagnosticV2`，不增加正文查看入口。
- [ ] 覆盖重复/乱序/迟到事件、同 ID 更新、无价格、断连、结束、未知、过期、循环父子和无标题测试。
- [ ] 运行：

```powershell
node --test test/realtime-session-view-model.test.js test/value-realtime-privacy.test.js
```

### 任务 12：接入实时会话只读 local API 和前台刷新策略

**修改/创建：**

- `src/lib/local-api.js`
- `test/local-api-realtime-sessions.test.js`
- `dashboard/src/lib/api.ts`
- `dashboard/src/hooks/use-realtime-sessions.ts`
- `dashboard/src/hooks/use-realtime-sessions.test.tsx`

- [ ] 新路由只允许 GET 和 loopback；输入固定为 `preset=today`、可选 `agent_id/focus_session_id`。
- [ ] local API 同时读取 lifecycle、queue usage、request diagnostics、usage limits/token plans，再传给纯 view model；不得调用 `src/lib/api/sessions.ts` 的正文消息接口。
- [ ] API 响应包含 `revision/observed_at`；缓存只能避免重复解析，不能把旧状态伪装成新鲜。
- [ ] hook 初次进入立即请求；页面可见且为当前路由时每 2 秒轻量轮询；`document.hidden`、离开路由或卸载后立刻停止并 Abort。
- [ ] revision 未变化时不替换 data，不播放增量动画；变化时仅对发生变化的数字设置短暂动画标记。
- [ ] 手动刷新不等待下一次轮询；并发刷新只保留最新结果。
- [ ] 网络失败保留最后成功快照并显示 stale；恢复后清除错误但保留用户当前 Tab/Agent。
- [ ] 该页面之外不得有后台轮询，避免无意义 CPU/磁盘占用。
- [ ] 测试 fake timers：2 秒刷新、hidden 停止、visible 恢复、unmount 停止、revision 不变、手动刷新、失败恢复。
- [ ] 运行：

```powershell
node --test test/local-api-realtime-sessions.test.js test/value-realtime-privacy.test.js
npm --prefix dashboard run test -- src/hooks/use-realtime-sessions.test.tsx
```

### 任务 13：复刻实时会话右侧内容页

**实现：**

- `dashboard/src/pages/RealtimeSessionsPage.tsx`
- `dashboard/src/pages/RealtimeSessionsPage.test.tsx`
- `dashboard/src/ui/value-realtime/RealtimeSessionsView.tsx`
- 复用同目录共享组件和 scoped CSS

- [ ] 先写页面合同测试，覆盖标题/副标题、今天、更新时间/刷新、三项摘要、焦点大卡、Agent 横排、四 Tab、两个可见图表、三个右侧折叠。
- [ ] 顶部摘要不把不同原生单位相加；若同时有 Token 和 Credits，使用分行/单位切换保持设计稿视觉中心。
- [ ] 焦点卡字段全部从 view model 来；无焦点时显示设计稿同尺寸空态，不创建假 Agent。
- [ ] Agent 横排按焦点优先、明确活跃、最近事件排序；超出宽度用可键盘到达的横向滚动/下一项控制。
- [ ] 四个 Tab 顺序固定：会话构成、趋势、子 Agent、请求明细；切换不触发无必要全量重新读取。
- [ ] 环图和趋势图只显示真实序列；无数据时显示解释性空态，不能画平滑假曲线。
- [ ] 数据状态、价格覆盖率、图例说明按设计稿右侧纵向区域呈现；小屏转为主列末尾，不覆盖图表。
- [ ] 真实增量动画只在 revision 变化且值变大/变小时触发一次；支持 `prefers-reduced-motion` 关闭。
- [ ] 时间、时长、Token、金额、单位和状态全部 copy/formatter 驱动；未知值不显示 0。
- [ ] 页面 preferences 保存当前 Agent、Tab 和折叠项；不保存敏感数据或 API 响应。
- [ ] CSS 在 1619×971 目标视口匹配参考标尺，并通过小/中/大三档布局。
- [ ] 运行：

```powershell
npm --prefix dashboard run test -- src/pages/RealtimeSessionsPage.test.tsx
npm run validate:copy
npm run validate:ui-hardcode
```

## 阶段 P4：原生资源适配与安全收口

### 任务 14：实现原生资源适配与单位降级

**修改：**

- `src/lib/realtime-session-view-model.js`
- 必要时最小复用 `src/lib/widget-view-model.js` 的 plan limit 规范化逻辑
- `test/realtime-session-view-model.test.js`

- [ ] WorkBuddy/CodeBuddy 输出 `unit=credits|points`，显示原始余额/已用/变化/快照；不能写 Token 等价。
- [ ] Qoder 默认 `unit=credits`；只有专项 fixture 证明独立 Token 字段来源后才能输出 Token，否则 `note_code=qoder_token_unverified`。
- [ ] Trae CN 输出 `unit=fast_requests`；Trae 国际版输出 `unit=usd_quota` 和 `used_percent`。
- [ ] USD quota 不能加入 actual_spend 或 api_equivalent_value；它是账户额度。
- [ ] 同时间窗资源变化与 Token 同时出现时输出 `observed_association=true` 和时间窗，不输出 ratio。
- [ ] 不同单位在顶部用分项/轮播式摘要展示，绝不相加成“实时 Token/Credits”单一数。
- [ ] 增加 UNIT-01 对应纯函数测试和隐私测试。

### 任务 15：跨层状态、错误、响应式和可访问性验收

**修改：** 两页、hooks、scoped CSS、对应测试。

- [ ] 用同一组确定性 fixture 覆盖：loading、empty、exact、estimated、partial、quota_only、connected_no_exact_data、authorization_required、unsupported、stale、error/recovered。
- [ ] 每种状态在 API 和 UI 使用同一枚举；禁止前端根据空数组猜状态。
- [ ] 价值页验证 today/7d/month/30d/custom；实时页验证 today、刷新和最后更新时间。
- [ ] 宽度至少验证右侧内容区 1024、1280、1360 像素及真实应用初始窗口；所有信息能通过正常纵向滚动到达，无页面级异常横滚。
- [ ] 键盘验证：Sidebar 两入口、日期控件、事实声明、查看全部、Tab、Agent 切换、刷新、所有折叠项；焦点顺序与视觉顺序一致。
- [ ] `aria-current`、`aria-selected`、`aria-controls`、`aria-expanded`、图表文本替代、状态 live region 只在必要时使用。
- [ ] 浅色按设计稿复刻；深色沿用现有 Token Eyes 主题语义，不允许白底白字、不可见边框和语义色反转。
- [ ] 确认 logs/API/DOM/localStorage 中没有正文、密钥、完整路径。
- [ ] 运行聚焦测试：

```powershell
node --test test/value-comparison-view-model.test.js test/realtime-session-view-model.test.js test/local-api-value-comparison.test.js test/local-api-realtime-sessions.test.js test/value-realtime-privacy.test.js test/app-route-pathname-guard.test.js
npm --prefix dashboard run test -- src/hooks/use-value-comparison.test.tsx src/hooks/use-realtime-sessions.test.tsx src/pages/ValueComparisonPage.test.tsx src/pages/RealtimeSessionsPage.test.tsx src/ui/components/__tests__/Sidebar.nav.test.jsx
```

## 阶段 P5：可靠父子树、视觉复刻与最终制品验收

### 任务 16：完成多 Agent 根任务/子 Agent 树

**修改：** `src/lib/realtime-session-view-model.js`、实时页面及测试。

- [ ] 为明确 `root_task_id/parent_session_id` 的 fixture 建立 Root Task → Session → Turn/Query → Request。
- [ ] 根任务聚合只汇总树内可追溯的 Token/成本；孤儿会话独立展示。
- [ ] 子 Agent Tab 显示父子边、状态、Agent、Token、更新时间；不读取正文补标题。
- [ ] 防止重复计数：父节点已有 aggregate bucket 时，子请求汇总不能再次加入父 total。
- [ ] 无父子证据、循环关系、跨日期迟到事件和删除后的孤儿均有测试。
- [ ] LIVE-03 的 fixture/API/UI 三层对账全部通过后才勾选。

### 任务 17：第一审——开发运行时逐页设计稿复刻

**创建：**

- `dashboard/scripts/capture-value-realtime-reference.mjs`
- `dashboard/scripts/verify-value-realtime-visual.mjs`
- `artifacts/value-realtime-ui/first-pass/`（验收产物，不提交用户隐私数据）

- [ ] Playwright 脚本通过网络拦截注入确定性脱敏 API fixture，不在生产组件内添加 screenshot-only 分支。
- [ ] 分别以原图完整尺寸启动/截图：价值 1620×971，实时 1619×971；记录 deviceScaleFactor、主题、字体加载完成和内容根节点 bbox。
- [ ] 对参考图按任务 1 记录的右侧边界裁剪，对实际图按 DOM bbox 裁剪；左侧导航从像素 diff 中排除，但另做整侧栏截图检查。
- [ ] pixelmatch 只作为定位差异辅助；验收仍逐项人工检查坐标、比例、文字、图标、颜色、边框、阴影、图表、Tab 和折叠。
- [ ] 生成：参考裁剪、实际裁剪、diff 图、全应用截图、逐项审查表。
- [ ] 每次修复一个局部后重新截取两页整面，防止引入邻接回归。
- [ ] 第一审同时走真实 API 开发状态，确认 fixture 对齐没有掩盖真实 empty/partial/stale。
- [ ] 单独确认 Sidebar：现有视觉没变，顺序精确为使用明细、成本与额度、套餐行情、价值对比、实时会话。
- [ ] 第一审所有任务清单行均有证据才通过。

### 任务 18：完整自动质量门

- [ ] 按以下顺序运行；任何一步失败都先诊断并修复，不跳过：

```powershell
npm run agents:check
npm --prefix dashboard run lint
npm --prefix dashboard run typecheck
npm --prefix dashboard run test
npm --prefix dashboard run build
npm --prefix dashboard run verify:data-display-policy
npm test
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
cargo test --manifest-path src-tauri/Cargo.toml --lib
git diff --check
git status --short
```

- [ ] 记录每条命令、退出码、通过数、失败数和执行 SHA。
- [ ] 运行 `git diff --stat` 与 `git diff --name-only`，每个变更文件都能追溯到清单项；删除偶然格式化和无关重构。
- [ ] 自动质量门只证明对应层，不宣称视觉或最终应用已经验收。
- [ ] 只有用户明确授权提交时，才在全绿后提交；建议按阶段提交并使用清晰信息。未经授权保持未提交工作树。

### 任务 19：第二审——最终生产制品真实用户旅程

> 此任务涉及构建 Tauri 候选制品、可能安装和提交身份绑定。执行前必须再次取得用户对相应操作的明确授权；没有授权时标记 `blocked`，不能用开发服务器替代。

- [ ] 锁定执行 SHA；生产前端、Tauri 可执行文件和安装包必须来自同一 SHA。
- [ ] 生成生产构建并记录 manifest、版本、SHA、时间、制品哈希；安装 smoke 只记录为制品层证据。
- [ ] 从 fresh 应用状态启动，不复用第一审页面状态或结论。
- [ ] 用正常鼠标/键盘依次进入：套餐行情 → 价值对比 → 实时会话。
- [ ] 价值页重走五种日期、查看全部、趋势、三个折叠、刷新/离开返回/重启持久化。
- [ ] 实时页重走手动刷新、等待真实新事件、revision 不变、Agent 切换、四 Tab、三个折叠、断连与恢复。
- [ ] 使用真实 local API 和真实 native 边界验证；mock/fixture 只能作为第一审确定性视觉证据。
- [ ] 在最终应用复查空、典型、密集、长标题、缺价格、仅额度、无 parent、过期和错误恢复。
- [ ] 重做右侧视觉对照和全侧栏顺序检查，不引用第一审“已通过”。
- [ ] 逐项更新阻断式验收矩阵；缺真实账号、来源或 GUI 能力时精确标 `partial/blocked` 并列缺失证据。
- [ ] 未全部通过前不得说“完成、已修复、验收通过、可以安装”，也不得把候选制品当作完成交付。

### 任务 20：最终交付报告

- [ ] 报告精确工作树、分支、HEAD、上游、Git 状态、是否提交/推送/合并。
- [ ] 分层报告：纯聚合测试、local API、前端单测、build、开发 UI 第一审、生产制品、最终应用第二审、CI/远端。
- [ ] 给出 NAV/VALUE/LIVE/UNIT/PRIV/STATE/RESP/ART 每一行的状态和证据路径。
- [ ] 明确哪些数字来自真实数据、哪些截图使用确定性脱敏 fixture、哪些能力因来源限制降级。
- [ ] 报告残余风险：尚无显式 lifecycle 的 Agent、价格覆盖缺口、原生额度只可快照、缺 parent ID 的孤儿会话。
- [ ] 未经授权不 push、不合并 main、不发布 npm/GitHub Release、不清理工作树。

---

## 四、实施中的决策规则

1. **现有能力优先复用。** 价值页复用 `readSpendTimeseries`、`use-cost-accumulation` 的金额语义和 `subscription-roi` 边界；实时页复用 `codex-lifecycle-reader`、`widget-view-model` 的安全 ID/状态规范、request diagnostics 和 token plan limits。
2. **不要前端二次计算事实。** 前端只做格式化和展示；价值倍数、归因、状态、覆盖率、revision 在纯聚合层决定。
3. **不要让 `local-api.js` 继续膨胀业务逻辑。** 新路由只做鉴权、参数解析、读取与调用纯模块。
4. **不要假装“实时”。** 2 秒仅是前台观察频率，不是数据增长器；数据是否变化由真实事件和 revision 决定。
5. **不要假装 Agent 在运行。** 文件最近修改或最近 usage 只能表示“最近观察到活动”，除非有明确 lifecycle 证据。
6. **不要把未知变成零。** `null`、0 和 stale 是三种不同事实，API、hook、UI、测试都必须保持区别。
7. **不要把额度当现金。** Credits、次数、USD quota、余额均是原生资源；只有明确账单才是实际支出。
8. **不要让视觉 fixture 进入生产事实链。** fixture 仅在测试/Playwright 拦截层使用，生产页面永远通过 API 取数。
9. **局部修复后做整面复查。** 两页布局高度互相依赖，修一张卡后必须重看标题到最后折叠行。
10. **证据不足就降级或阻断。** 不通过名称、时间相近、相同目录或设计稿演示内容补齐缺失事实。

---

## 五、完成定义

只有同时满足以下条件，执行者才可以把开发任务标记为完成：

- [ ] 任务清单第 3、4、5 节全部适用项已勾选且有证据。
- [ ] 第 6 节 15 条阻断式验收矩阵全部为通过；或经用户接受的项目明确标注 partial/blocked，且不冒充完成。
- [ ] 左侧保持现有 Token Eyes 样式，仅按固定顺序增加两个入口。
- [ ] 两页右侧内容在目标尺寸通过逐元素参考对照，不只通过单测/build。
- [ ] 真实数据链路不写死设计数字，不泄露正文与密钥，不伪造状态、兑换率、父子关系或未知值。
- [ ] 完整自动质量门全绿，`git diff --check` 无错误，无无关改动。
- [ ] 第一审与从最终生产制品重新开始的第二审相互独立且均有当前证据。
- [ ] 最终报告准确区分源码、测试、视觉、生产制品、安装后体验、Git 与远端状态。
