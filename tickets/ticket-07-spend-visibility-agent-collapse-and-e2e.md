# 工单 7：支出显示范围联动、Agent 折叠交互与真实本地 E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“设置 → 限制显示”成为支出页唯一的 Provider 展示范围；顶部仅显示已启用 Agent；“全部”按钮按已确认语义折叠/展开这些 Agent；最后用真实 local API 和 Tauri 构建完成整页体验验收。

**Architecture:** `useLimitsDisplayPrefs().visibleOrdered` 是页面级 allowlist。SpendPage 将该 allowlist 传给 Agent、来源/模型选项、summary、trend、请求日志、Provider/模型表和手工支出汇总；各 hook 在发请求前把当前筛选与 allowlist 求交集，空 allowlist 绝不退化为“查询全部”。AgentSwitcher 只保存页面内 `expanded` 状态，不把折叠状态写入设置。Playwright 脚本用临时 HOME 启动真实 CLI server，禁止 `?mock=1`，验证网络参数、交互和控制台。

**Tech Stack:** React 18、TypeScript/JavaScript、Vitest、Testing Library、Playwright、Node.js CLI local API、Tauri 2。

---

## 基本信息

- **工单编号**：TICKET-07
- **优先级**：P0
- **前置依赖**：TICKET-05、TICKET-06 均已通过主上下文审核；设计规格 commit `715ff4b`
- **执行方式**：在前两个工单的同一分支和工作区串行执行；这是三个长工单中的最后一个
- **设计依据**：`docs/superpowers/specs/2026-06-29-spend-usage-remediation-long-tasks-design.md`

## 已确认产品语义

“全部”按钮的状态机固定如下，不再二次解释：

1. 页面首次进入：全部范围，Agent 图标展开。
2. 已是全部范围且图标展开：点击“全部”只折叠图标，数据范围不变。
3. 已是全部范围且图标折叠：再次点击“全部”展开图标，数据范围不变。
4. 当前选中单个 Agent：点击“全部”先切回全部范围，同时折叠图标；再次点击才展开。
5. 折叠后保留“全部”按钮、来源、模型、刷新和日期控件；只隐藏 Agent 图标。
6. 折叠状态只属于当前 SpendPage 实例，刷新或重新进入页面恢复展开。

显示范围语义固定如下：

- `visibleOrdered` 中启用几个 Provider，支出页所有 Provider 级区域最多显示这几个，并按该顺序展示。
- 隐藏只影响读取和展示，不停止采集、不删除 queue、rollout、订阅记录或配置。
- 当前选中的 Agent/来源被设置隐藏后，页面回到“全部可见 Provider”范围；不能保留不可见筛选。
- 如果全部 Provider 都关闭，显示明确空状态且不发送会退化为全量的 usage/spend 请求。

## 开工前置与边界

依次阅读：

1. `CLAUDE.md`
2. 共同设计规格
3. TICKET-05、TICKET-06 的完成报告与 commits
4. `dashboard/src/hooks/use-limits-display-prefs.js`
5. `dashboard/src/lib/limits-providers.js`
6. `dashboard/src/lib/spend-provider-visibility.js`
7. `dashboard/src/ui/dashboard/components/AgentSwitcher.jsx`
8. `dashboard/src/ui/dashboard/components/UsageFilterBar.jsx`
9. `dashboard/src/pages/SpendPage.jsx`
10. 六个 usage hooks 和三个明细表组件
11. `src/lib/local-api.js` 的 spend-records endpoint

硬边界：

- 不新增第二套 Provider 可见性设置，不在 SpendPage 保存自己的 visible list。
- 不改变“限制显示”页面的持久化 key、拖拽顺序或 NativeBridge 同步协议。
- 不把折叠状态写入 localStorage、local settings 或后端。
- 不用 CSS 把隐藏数据遮住后仍按全量计算 totals；请求与汇总口径必须同时收窄。
- 不修改 TICKET-06 的 availability、request granularity 或 pricing coverage 语义。
- 不在 E2E 中使用真实用户 HOME、真实日志、云账号、`?mock=1` 或固定端口。
- 每次提交只暂存本任务文件；提交前运行 `git diff --cached --name-only`。

## 验收标准

1. 设置中只启用 Claude、Codex、Hermes 时，顶部 Agent 行只有这 3 个图标；隐藏 Provider 不出现在来源/模型候选、趋势、请求、Provider、模型、by-source、订阅记录或汇总 totals 中。
2. Provider 顺序跟随 `visibleOrdered`；Agent 行和 by-source 行不得自行按字母排序。
3. “全部”按钮严格通过上述 6 条状态机测试，具有正确的 `aria-expanded` 和动态可访问名称。
4. 可见性变化会清理隐藏选择；不会出现已选 hidden source 但按钮仍显示已选数量的状态。
5. 空 allowlist 显示“请在显示设置中启用至少一个 Provider”，且 usage/spend API 调用数为 0。
6. 1200px 与 900px viewport 下筛选栏无水平页面溢出；折叠/展开不移动页面主内容到不可见区域。
7. 真实本地 Playwright E2E 覆盖加载、范围参数、折叠/展开、来源/模型、日期、刷新和三个明细 Tab；无 console error、pageerror、React warning。
8. release Tauri 构建启动后可人工体验，并在报告中记录 executable、端口、截图和验收结果。

---

### Task 1：建立可见 Provider 范围的纯函数和回归测试

**Files:**
- Modify: `dashboard/src/lib/spend-provider-visibility.js`
- Modify: `dashboard/src/lib/spend-provider-visibility.test.js`

- [ ] **Step 1：先写 allowlist 失败测试**

增加以下纯函数契约测试：

```js
import {
  normalizeVisibleProviderIds,
  intersectVisibleSources,
  filterVisibleSourceOptions,
  reconcileVisibleUsageFilters,
} from "./spend-provider-visibility.js";

expect(normalizeVisibleProviderIds(["Codex", "claude", "codex", "unknown"]))
  .toEqual(["codex", "claude"]);

expect(intersectVisibleSources(null, ["claude", "codex"]))
  .toEqual(["claude", "codex"]);
expect(intersectVisibleSources(["cursor", "codex"], ["claude", "codex"]))
  .toEqual(["codex"]);

expect(filterVisibleSourceOptions([
  { source: "cursor" },
  { source: "codex" },
  { source: "claude" },
], ["claude", "codex"]).map((row) => row.source))
  .toEqual(["claude", "codex"]);

expect(reconcileVisibleUsageFilters({
  agentIds: ["cursor"],
  sources: ["cursor"],
  models: ["cursor-model"],
}, ["claude", "codex"]))
  .toEqual({ agentIds: null, sources: null, models: null });
```

未知 ID 必须被丢弃，已知 ID 集合从 `LIMIT_PROVIDER_IDS` 导入，不能在 helper 中复制列表。

- [ ] **Step 2：写空 allowlist 和顺序测试**

断言 `normalizeVisibleProviderIds([])`、`intersectVisibleSources(null, [])`、`filterProviderRows(rows, [])` 均返回空数组；断言 `filterProviderRows` 和 options helper 按 allowlist 顺序输出。

- [ ] **Step 3：运行测试确认红灯**

```powershell
npm --prefix dashboard run test -- src/lib/spend-provider-visibility.test.js
```

Expected: FAIL，新增 helper 尚不存在。

- [ ] **Step 4：实现最小纯函数**

固定行为：

```js
export function intersectVisibleSources(selectedSources, visibleProviderIds) {
  const visible = normalizeVisibleProviderIds(visibleProviderIds);
  if (!Array.isArray(selectedSources)) return visible;
  const selected = new Set(selectedSources.map(normalizeSource));
  return visible.filter((source) => selected.has(source));
}
```

`filterVisibleSourceOptions` 先按 source 建 Map，再按 visible 顺序取值。`reconcileVisibleUsageFilters` 发现 agent/source 中任一当前选择全部被隐藏时，返回 `agentIds: null, sources: null, models: null`；部分仍可见时保留交集，并在 sources 变化时清空 models。函数必须无 React 依赖。

- [ ] **Step 5：运行测试确认绿灯**

```powershell
npm --prefix dashboard run test -- src/lib/spend-provider-visibility.test.js
```

Expected: 全部通过。

- [ ] **Step 6：提交范围 helper**

```powershell
git add dashboard/src/lib/spend-provider-visibility.js dashboard/src/lib/spend-provider-visibility.test.js
git diff --cached --name-only
git commit -m "fix: define spend provider display scope"
```

---

### Task 2：实现 AgentSwitcher 的可见列表与折叠状态机

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/AgentSwitcher.jsx`
- Create: `dashboard/src/ui/dashboard/components/__tests__/AgentSwitcher.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageFilterBar.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/UsageFilterBar.test.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `dashboard/src/content/i18n/zh/dashboard.json`

- [ ] **Step 1：先写状态机测试**

用真实 `UsageFiltersProvider` 渲染组件：

```jsx
render(
  <UsageFiltersProvider>
    <AgentSwitcher visibleProviderIds={["claude", "codex", "hermes"]} />
  </UsageFiltersProvider>,
);
```

测试必须逐条覆盖：

1. 首次 3 个 Agent 按钮可见，全部按钮 `aria-expanded="true"`。
2. 全部范围点击一次后 3 个 Agent 隐藏，全部按钮仍在，`aria-expanded="false"`。
3. 再点一次恢复 3 个 Agent。
4. 选择 Codex 后只 Codex 为 `aria-pressed="true"`；点击全部后筛选回到 null 且 Agent 折叠；再点才展开。
5. 传入顺序 `hermes, claude` 时 DOM 顺序一致。
6. `visibleProviderIds=[]` 时只显示全部按钮且不会渲染 25 个 registry Agent。

- [ ] **Step 2：写筛选栏布局测试**

`UsageFilterBar.test.jsx` 断言 `visibleProviderIds` 透传给 AgentSwitcher，且折叠后来源、模型、刷新、日期按钮仍存在。测试容器宽度设为 900px，断言 toolbar 使用 `flex-wrap` 且 Agent group 没有固定 25 图标宽度。

- [ ] **Step 3：运行测试确认红灯**

```powershell
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/AgentSwitcher.test.jsx src/ui/dashboard/components/__tests__/UsageFilterBar.test.jsx
```

Expected: FAIL，当前 AgentSwitcher 无 props、无展开状态并渲染全部 registry。

- [ ] **Step 4：实现按可见顺序映射 Agent**

```jsx
const visibleAgents = useMemo(() => {
  const bySource = new Map(DASHBOARD_AGENTS.map((agent) => [agent.queueSource, agent]));
  return normalizeVisibleProviderIds(visibleProviderIds)
    .map((source) => bySource.get(source))
    .filter(Boolean);
}, [visibleProviderIds]);
```

禁止回退到 `DASHBOARD_AGENTS.map()`。ProviderIcon 继续用现有 fallback；没有 icon 的已知 Provider 显示稳定占位图标，不显示 spinner。

- [ ] **Step 5：实现已确认状态机**

```jsx
const [expanded, setExpanded] = useState(true);

const handleAllClick = () => {
  if (!isAll) {
    setAgentIds(null);
    setExpanded(false);
    return;
  }
  setExpanded((current) => !current);
};
```

全部按钮增加 `aria-expanded={expanded}`。动态 aria/title 分三种：当前是单 Agent 时为“显示全部 Agent 并收起列表”；全部且展开时为“收起 Agent 列表”；全部且折叠时为“展开 Agent 列表”。`aria-pressed` 仍只表示数据范围是否为全部，不能拿 expanded 替代 selection。

- [ ] **Step 6：增加动态 copy 并透传 props**

增加：

```text
ticket02.agent.collapse = Collapse agent list / 收起 Agent 列表
ticket02.agent.expand = Expand agent list / 展开 Agent 列表
ticket02.agent.show_all_collapse = Show all agents and collapse the list / 显示全部 Agent 并收起列表
spend.visibility.empty = Enable at least one provider in Display settings. / 请在显示设置中启用至少一个 Provider。
```

`UsageFilterBar` 接收 `visibleProviderIds` 并传给 `<AgentSwitcher>`。

- [ ] **Step 7：运行组件、copy 和硬编码校验**

```powershell
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/AgentSwitcher.test.jsx src/ui/dashboard/components/__tests__/UsageFilterBar.test.jsx
npm run validate:copy
npm run validate:ui-hardcode
```

Expected: 全部 exit 0。

- [ ] **Step 8：提交 Agent 交互**

```powershell
git add dashboard/src/ui/dashboard/components/AgentSwitcher.jsx dashboard/src/ui/dashboard/components/__tests__/AgentSwitcher.test.jsx dashboard/src/ui/dashboard/components/UsageFilterBar.jsx dashboard/src/ui/dashboard/components/__tests__/UsageFilterBar.test.jsx dashboard/src/content/copy.csv dashboard/src/content/i18n/zh/dashboard.json
git diff --cached --name-only
git commit -m "feat: collapse visible spend agents"
```

---

### Task 3：让六个 usage hooks 统一受 visible allowlist 约束

**Files:**
- Modify: `dashboard/src/hooks/use-usage-summary.ts`
- Modify: `dashboard/src/hooks/use-usage-trend.ts`
- Modify: `dashboard/src/hooks/use-usage-filter-options.ts`
- Modify: `dashboard/src/hooks/use-request-usage-records.ts`
- Modify: `dashboard/src/hooks/use-provider-stats.ts`
- Modify: `dashboard/src/hooks/use-model-stats.ts`
- Modify: `dashboard/src/hooks/__tests__/local-usage-hooks.test.tsx`
- Modify: `dashboard/src/hooks/__tests__/use-request-usage-records.test.tsx`
- Create: `dashboard/src/hooks/__tests__/usage-visible-scope.test.tsx`

- [ ] **Step 1：先写请求参数失败测试**

对 summary、trend、filter options、provider、model 五个 hook 传 `allowedSources: ["claude", "codex"]`。筛选 state 为 `sources: ["codex", "cursor"]` 时，断言每个 API 的最后一次调用只含：

```ts
expect.objectContaining({ sources: ["codex"] })
```

filter options 没有用户 source selection，但也必须向 provider/model options API 传 `sources: ["claude", "codex"]`，并按 allowlist 顺序导出 source options。

request hook 继续使用 `visibleProviderIds`，增加去重、未知 ID 丢弃和空数组不请求测试。

- [ ] **Step 2：写空 allowlist 安全测试**

六个 hook 都传空数组，等待 loading 结束，断言对应 API 调用数为 0、error 为 null、结果为空。summary/trend 的空结果必须由 hook 暴露明确的 `disabledByVisibility: true`，页面用它显示设置空状态；不能调用 API 时省略 sources 参数。

- [ ] **Step 3：运行测试确认红灯**

```powershell
npm --prefix dashboard run test -- src/hooks/__tests__/usage-visible-scope.test.tsx src/hooks/__tests__/use-request-usage-records.test.tsx src/hooks/__tests__/local-usage-hooks.test.tsx
```

Expected: FAIL，现有 hooks 不接受 `allowedSources`，空数组存在全量回退风险。

- [ ] **Step 4：给五个 hook 增加同名参数**

`useUsageSummary`、`useUsageTrend`、`useUsageFilterOptions`、`useProviderStats`、`useModelStats` 的 params 都增加：

```ts
allowedSources?: string[];
```

在 hook 顶层使用纯函数计算：

```ts
const effectiveSources = useMemo(
  () => intersectVisibleSources(filterParams.sources, allowedSources),
  [filterParams.sources, allowedSources],
);
const disabledByVisibility = Array.isArray(allowedSources) && effectiveSources.length === 0;
```

API、cache key、scope key、callback dependency 均使用稳定序列化后的 `effectiveSources`，不再直接使用 `filterParams.sources`。当 disabled 时清空旧 cache/render state、结束 loading、返回空数据且不请求。

- [ ] **Step 5：约束 filter options 和 request hook**

filter options 原注释“FULL universe”改为“visible universe”，两个 API 都传 `sources: normalizedAllowedSources`，输出按 allowlist 顺序排列。request hook 将 `visibleProviderIds` 先经 `normalizeVisibleProviderIds()`，空数组立即返回；TICKET-05 的内部 source dropdown 只能在该集合内进一步收窄。

- [ ] **Step 6：运行 hook 测试与类型检查**

```powershell
npm --prefix dashboard run test -- src/hooks/__tests__/usage-visible-scope.test.tsx src/hooks/__tests__/use-request-usage-records.test.tsx src/hooks/__tests__/local-usage-hooks.test.tsx
npm --prefix dashboard run typecheck
```

Expected: 全部通过；local no-token 能力仍通过。

- [ ] **Step 7：提交 hook allowlist**

```powershell
git add dashboard/src/hooks/use-usage-summary.ts dashboard/src/hooks/use-usage-trend.ts dashboard/src/hooks/use-usage-filter-options.ts dashboard/src/hooks/use-request-usage-records.ts dashboard/src/hooks/use-provider-stats.ts dashboard/src/hooks/use-model-stats.ts dashboard/src/hooks/__tests__/local-usage-hooks.test.tsx dashboard/src/hooks/__tests__/use-request-usage-records.test.tsx dashboard/src/hooks/__tests__/usage-visible-scope.test.tsx
git diff --cached --name-only
git commit -m "fix: constrain usage hooks to visible providers"
```

---

### Task 4：把 allowlist 接到 SpendPage 的全部展示和手工支出口径

**Files:**
- Modify: `dashboard/src/pages/SpendPage.jsx`
- Modify: `dashboard/src/pages/SpendPage.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageTrendChart.jsx`
- Modify: `dashboard/src/ui/dashboard/components/ProviderUsageTable.jsx`
- Modify: `dashboard/src/ui/dashboard/components/ModelUsageTable.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/ProviderUsageTable.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/ModelUsageTable.test.jsx`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `src/lib/local-api.js`
- Modify: `test/spend-records-api.test.js`

- [ ] **Step 1：先写 SpendPage 全区域可见性测试**

mock `visibleOrdered: ["claude", "codex"]`，API fixtures 同时返回 cursor。断言：

- Agent 行仅 Claude、Codex。
- source options 不含 Cursor。
- summary、trend、provider、model、request hooks/API 均收到 `["claude", "codex"]`。
- by-source、订阅 record 和四张金额 summary 不含 Cursor 金额。
- Provider/模型 Tab 切换后仍无 Cursor。

再 mock `visibleOrdered: []`，断言设置空状态存在，`getSpendRecords` 与六类 usage API 均未调用。

再用可变 mock 从 `["claude", "codex"]` rerender 为 `["claude"]`：先选中 Codex，再触发偏好变化，断言筛选回到全部、Codex 行立即消失、所有后续请求只含 Claude，旧 Codex cache 在新请求完成前也不得闪现。

- [ ] **Step 2：先写手工支出后端范围测试**

在临时 config 中放 Claude 和 Cursor 两条订阅，queue 中也放两来源。调用：

```text
/functions/tokentracker-spend-records?from=2026-06-01&to=2026-06-30&sources=claude
```

断言 records、by_source、period totals、lifetime totals 均只含 Claude；随后不带 sources 再请求，断言两条数据仍在，证明隐藏没有删除数据。

- [ ] **Step 3：运行前后端测试确认红灯**

```powershell
npm --prefix dashboard run test -- src/pages/SpendPage.test.jsx src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx src/ui/dashboard/components/__tests__/ProviderUsageTable.test.jsx src/ui/dashboard/components/__tests__/ModelUsageTable.test.jsx
node --test test/spend-records-api.test.js
```

Expected: FAIL，当前 summary/trend/table 未全部收到 allowlist，spend-records totals 仍是全量。

- [ ] **Step 4：在 SpendPage 统一接线并清理隐藏选择**

`visibleOrdered` 先经 `normalizeVisibleProviderIds` 得到 `visibleProviderIds`。传递到：

- `<UsageFilterBar visibleProviderIds={visibleProviderIds}>`
- `useUsageSummary({ allowedSources: visibleProviderIds })`
- `useUsageFilterOptions({ allowedSources: visibleProviderIds })`
- `<UsageTrendChartCard allowedSources={visibleProviderIds}>`
- Request/Provider/Model 三个 Tab
- `getSpendRecords({ sources: visibleProviderIds, ... })`

当 `visibleProviderIds` 变化，调用 `reconcileVisibleUsageFilters` 与 filter actions 清理 hidden Agent/source/model。只在结果确实变化时 dispatch，禁止 effect 自循环。

- [ ] **Step 5：透传到趋势和两个统计表**

`UsageTrendChartCard` 接收 `allowedSources` 并传给 `useUsageTrend`。`ProviderUsageTable`、`ModelUsageTable` 接收 `visibleProviderIds`，分别作为 hook 的 `allowedSources`；渲染结果再用 allowlist 防御性过滤和排序，防止旧 cache 短暂泄露隐藏行。

- [ ] **Step 6：给 spend-records GET 增加 sources filter**

`dashboard/src/lib/api.ts` 对 `getSpendRecords` 使用与 usage endpoint 相同的 multi-value query serializer。`local-api.js` GET handler 解析 `sources` 并传给 `readSpendRecords`/`summarizeSpendRecords`。后端在计算以下内容前过滤：

- 返回的订阅 records；
- period subscription totals；
- lifetime subscription totals；
- queue/API totals；
- by_source。

POST/PUT/DELETE 的存储行为不变。SpendPage 在 mutation 成功后调用带 allowlist 的 `fetchRecords()`，不直接应用 mutation endpoint 返回的全量 summary。

- [ ] **Step 7：处理空 allowlist**

SpendPage 在 `visibleProviderIds.length === 0` 时：

- 不调用 `getSpendRecords`；
- 不挂载会发请求的 usage 内容；
- 在筛选栏下显示 `spend.visibility.empty`；
- 保留进入设置所需的现有导航，不创建新的设置副本；
- 清空页面旧 totals、records、bySource，禁止从上一次可见状态残留。

- [ ] **Step 8：运行页面、组件、后端和类型测试**

```powershell
npm --prefix dashboard run test -- src/pages/SpendPage.test.jsx src/lib/spend-provider-visibility.test.js src/ui/dashboard/components/__tests__/AgentSwitcher.test.jsx src/ui/dashboard/components/__tests__/UsageFilterBar.test.jsx src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx src/ui/dashboard/components/__tests__/ProviderUsageTable.test.jsx src/ui/dashboard/components/__tests__/ModelUsageTable.test.jsx
node --test test/spend-records-api.test.js
npm --prefix dashboard run typecheck
```

Expected: 全部通过，无 React warning。

- [ ] **Step 9：提交 SpendPage 全链路联动**

```powershell
git add dashboard/src/pages/SpendPage.jsx dashboard/src/pages/SpendPage.test.jsx dashboard/src/ui/dashboard/components/UsageTrendChart.jsx dashboard/src/ui/dashboard/components/ProviderUsageTable.jsx dashboard/src/ui/dashboard/components/ModelUsageTable.jsx dashboard/src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx dashboard/src/ui/dashboard/components/__tests__/ProviderUsageTable.test.jsx dashboard/src/ui/dashboard/components/__tests__/ModelUsageTable.test.jsx dashboard/src/lib/api.ts src/lib/local-api.js test/spend-records-api.test.js
git diff --cached --name-only
git commit -m "fix: apply display settings across spend views"
```

---

### Task 5：增加真实 local API 的 Playwright E2E

**Files:**
- Create: `dashboard/scripts/verify-spend-local.mjs`
- Modify: `dashboard/package.json`
- Create: `docs/test-reports/v2.1/artifacts/spend-local-1200-expanded.png`
- Create: `docs/test-reports/v2.1/artifacts/spend-local-900-collapsed.png`
- Create: `docs/test-reports/v2.1/artifacts/spend-local-network.json`

- [ ] **Step 1：先写可独立退出的 E2E runner 骨架**

脚本必须：

1. 用 `fs.mkdtemp()` 创建临时 HOME/USERPROFILE。
2. 用 Node `net.createServer().listen(0)` 取得空闲端口，关闭探测 server 后再启动 CLI。
3. 在临时 `.tokentracker/queue.jsonl` 写 Claude、Codex、Cursor synthetic rows；写临时 config/pricing 只用虚构模型。
4. `spawn(process.execPath, [root/bin/tracker.js, "serve", "--port", port, "--no-open", "--no-sync"])`。
5. 轮询 `/api/local-auth`，并断言 TICKET-05 的 protocol/capability。
6. `finally` 中关闭 browser、终止子进程、删除临时目录；Windows 上等待子进程真正退出。

任何一步失败都以非零 exit code 退出，禁止 catch 后只打印 warning。

- [ ] **Step 2：预置“只显示 Claude/Codex”的设置**

在 `page.addInitScript` 中写：

```js
localStorage.setItem(
  "tt.limits.providerOrder",
  JSON.stringify(["claude", "codex", "cursor", "gemini", "hermes", "openclaw", "opencode", "antigravity"]),
);
localStorage.setItem(
  "tt.limits.providerVisibility",
  JSON.stringify({
    claude: true,
    codex: true,
    cursor: false,
    gemini: false,
    hermes: false,
    openclaw: false,
    opencode: false,
    antigravity: false,
  }),
);
```

禁止把 visible list 直接注入 SpendPage 内部。

- [ ] **Step 3：监听错误和网络范围**

收集 `console` 的 error/warning、`pageerror`、失败请求；记录所有 `tokentracker-*` 与 `spend-records` URL。测试结束断言：

- 没有 React、duplicate key、act、Unhandled、500、HTML-as-JSON 错误；
- usage/spend 请求的 source 范围只包含 claude/codex；
- 没有 cursor usage 行或 cursor subscription 进入 totals；
- URL 不含 `mock=1`。

- [ ] **Step 4：覆盖核心交互**

在 1200×900 viewport 打开 `http://127.0.0.1:<port>/spend`，依次断言：

1. 页面离开 loading，summary 和趋势进入 loaded/empty/error 之一，但不能永久 spinner。
2. Agent group 只有 Claude、Codex 和全部按钮。
3. 点击全部一次隐藏两个 Agent，`aria-expanded=false`；再点恢复。
4. 点击 Codex 后请求只含 Codex；点击全部后范围恢复 Claude/Codex 且图标折叠。
5. 来源选择 Claude、模型选择 synthetic Claude model 后，触发按钮显示已选数量，网络参数正确。
6. 选择 7d，再打开自定义日期面板并应用有效起止日期；趋势请求 from/to 更新。
7. 点击手动刷新后，summary、trend、request/provider/model 和 spend-records 都产生新请求。
8. 依次打开请求日志、Provider 统计、模型统计，均无 Cursor。
9. `document.documentElement.scrollWidth <= window.innerWidth`。

然后切到 900×800 viewport 重复折叠/展开和 overflow 断言。

- [ ] **Step 5：保存可审核 artifact**

保存两张截图和一份 JSON 到：

```text
docs/test-reports/v2.1/artifacts/spend-local-1200-expanded.png
docs/test-reports/v2.1/artifacts/spend-local-900-collapsed.png
docs/test-reports/v2.1/artifacts/spend-local-network.json
```

JSON 只包含 synthetic URL、状态、时间和断言结果，不包含 local auth token、HOME 路径或日志正文。

- [ ] **Step 6：增加并运行 npm script**

`dashboard/package.json` 增加：

```json
"verify:spend-local": "node scripts/verify-spend-local.mjs"
```

运行：

```powershell
npm run dashboard:build
npm --prefix dashboard run verify:spend-local
```

Expected: exit 0；输出端口、断言数量、截图路径和 `console errors: 0`。

- [ ] **Step 7：提交 E2E runner 与 artifacts**

```powershell
git add dashboard/scripts/verify-spend-local.mjs dashboard/package.json docs/test-reports/v2.1/artifacts/spend-local-1200-expanded.png docs/test-reports/v2.1/artifacts/spend-local-900-collapsed.png docs/test-reports/v2.1/artifacts/spend-local-network.json
git diff --cached --name-only
git commit -m "test: cover spend visibility in real local mode"
```

---

### Task 6：全量回归、Tauri 体验验收与最终交接

**Files:**
- Modify only if a failing assertion proves a TICKET-07 regression
- Create: `docs/test-reports/v2.1/24-spend-visibility-collapse-e2e.md`
- Create: `docs/test-reports/v2.1/artifacts/spend-tauri-release.png`

- [ ] **Step 1：运行三个工单的前端定向回归**

```powershell
npm --prefix dashboard run test -- src/lib/local-api-url.test.ts src/lib/spend-provider-visibility.test.js src/hooks/__tests__/local-usage-hooks.test.tsx src/hooks/__tests__/usage-visible-scope.test.tsx src/hooks/__tests__/use-usage-filters.cascade.test.tsx src/hooks/__tests__/use-request-usage-records.test.tsx src/ui/dashboard/components/__tests__/AgentSwitcher.test.jsx src/ui/dashboard/components/__tests__/UsageFilterBar.test.jsx src/ui/dashboard/components/__tests__/SourceFilter.test.jsx src/ui/dashboard/components/__tests__/ModelFilter.test.jsx src/ui/dashboard/components/__tests__/DateRangePopover.test.jsx src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx src/ui/dashboard/components/__tests__/ProviderUsageTable.test.jsx src/ui/dashboard/components/__tests__/ModelUsageTable.test.jsx src/pages/SpendPage.test.jsx
```

Expected: 全部通过，无控制台 warning。

- [ ] **Step 2：运行三个工单的后端和 Rust 定向回归**

```powershell
node --test test/local-api-handshake.test.js test/pricing.test.js test/usage-cost-consistency.test.js test/request-usage-records-api.test.js test/rollout-parser.test.js test/provider-model-stats.test.js test/usage-caliber-consistency.test.js test/spend-timeseries-api.test.js test/spend-records-api.test.js
cargo test --manifest-path src-tauri/Cargo.toml commands::tests
```

Expected: 全部通过。

- [ ] **Step 3：运行规则、构建和真实 local E2E**

```powershell
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npm --prefix dashboard run verify:spend-local
npx tauri build --no-bundle
```

Expected: 全部 exit 0；只允许记录构建器已有 chunk-size warning。

- [ ] **Step 4：启动 release Token Eyes 做人工体验验收**

启动 `src-tauri/target/release/token-eyes.exe`，使用 synthetic 测试目录或清洗后的测试配置，不使用真实用户日志。验收：

1. 新 Tauri 连接的 API 具备 TICKET-05 capability，未复用旧服务。
2. 仅启用 2–3 个 Provider 时，支出页所有区域只显示这些 Provider。
3. 全部按钮的四种关键点击序列符合状态机。
4. 日期自定义面板、趋势 tooltip、请求/Provider/模型 Tab 可正常操作。
5. 30 秒自动刷新至少发生一次且没有重复并发刷新。
6. DevTools/日志中无错误；页面无水平溢出或永久 loading。

保留一张 release 应用截图到 `docs/test-reports/v2.1/artifacts/spend-tauri-release.png`。

- [ ] **Step 5：编写最终报告**

报告必须包含：TICKET-05/06/07 commit 列表、visible allowlist 数据流、全部按钮状态机结果、两种 viewport、real local E2E 端口和请求范围、console 统计、后端/Rust/构建命令、release executable 路径、截图、已知问题。不得写“应该通过”。

- [ ] **Step 6：提交最终验收报告**

```powershell
git add docs/test-reports/v2.1/24-spend-visibility-collapse-e2e.md docs/test-reports/v2.1/artifacts/spend-tauri-release.png
git diff --cached --name-only
git commit -m "test: verify spend visibility and agent collapse"
```

## 完成回报格式

subagent 最终回复必须包含：

- 分支名和 TICKET-07 全部 commit SHA；
- 实际修改文件；
- `visibleOrdered` 如何约束九类展示/查询区域；
- 空 allowlist 如何阻止全量回退；
- 全部按钮状态机的自动化测试结果；
- hidden selection 的清理行为；
- real local E2E 的端口、断言数、console/pageerror 数和 artifacts；
- Tauri release executable、实际启动端口和体验结论；
- 全部验证命令与通过数量；
- 未解决问题或明确写“无”。

TICKET-07 完成后，三个长工单才算整体完成；主上下文应按设计规格逐项复验，而不是只看 subagent 的“完成”声明。
