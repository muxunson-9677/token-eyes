# 工单 5：本地数据链路、筛选状态与统一刷新修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让支出使用统计在真实本地未登录模式中完成加载，使来源/模型/日期筛选真正生效，并由一个刷新时钟更新全部统计区域，同时阻止新版 Tauri 复用不兼容的旧本地 API。

**Architecture:** 在 `local-api-url.ts` 固化唯一的本地运行时判断，所有新增 usage hooks 共用该判断；筛选状态只做向下级联，删除会吞掉目标选择的反向 merge；`UsageFiltersProvider` 暴露单一 `refreshRevision`，Spend 页只维护一个定时器，各数据 hook 监听 revision 重新取数。`/api/local-auth` 增加协议版本和 capability，Rust 端解析并校验后才允许复用服务。

**Tech Stack:** React 18、TypeScript、Vitest、Testing Library、Node.js local API、Rust/Tauri 2、PowerShell 验证命令。

---

## 基本信息

- **工单编号**：TICKET-05
- **优先级**：P0
- **依赖**：设计规格 commit `715ff4b`
- **后续依赖**：TICKET-06、TICKET-07
- **执行方式**：独占当前工作区执行；不得与 TICKET-06/07 并行
- **设计依据**：`docs/superpowers/specs/2026-06-29-spend-usage-remediation-long-tasks-design.md`

## 开工前置与边界

开始前依次阅读：

1. `CLAUDE.md`
2. 上述设计规格
3. `dashboard/src/App.jsx:91-130`
4. `dashboard/src/lib/local-api-url.ts`
5. `dashboard/src/hooks/use-usage-filters.tsx`
6. 六个新增 usage hooks
7. `dashboard/src/pages/SpendPage.jsx`
8. `src/lib/local-api.js:3035-3070`
9. `src-tauri/src/commands.rs:55-235`

硬边界：

- 不修改 parser、日志 token 归一化、价格规则或 Provider 可见性产品规则。
- 不把真实用户日志正文写进测试；所有测试使用 synthetic fixture。
- 不新增 WebSocket、后台 daemon 或第二套刷新定时器。
- 不清理工作区现有未提交改动，不执行 `git reset --hard`、`git checkout --`。
- 每次提交前只暂存本任务文件，并运行 `git diff --cached --name-only` 检查范围。

## 验收标准

1. `http://127.0.0.1:<port>/spend` 和 Tauri WebView 在无云端 token 时均能完成统计加载。
2. 从默认“全部来源/全部模型”选择具体项后，按钮显示选择数量，所有统计请求带上对应参数。
3. Agent 变化清空来源和模型；来源变化清空模型；目标选择本身不会被清空。
4. 手动刷新和自动刷新都会重新请求 summary、trend、filter options、request records、Provider stats、model stats 和 Spend records。
5. Request Log 内部来源下拉使用同一来源重新请求 records 与 totals。
6. 旧 `/api/local-auth` 响应即使含 token 也不能被新版 Tauri 接受；当前协议响应可以被接受。
7. 所有 loading 分支最终进入 loaded、empty 或 error，禁止永久 spinner。

---

### Task 1：建立唯一的本地 Dashboard 运行时判断

**Files:**
- Modify: `dashboard/src/lib/local-api-url.ts`
- Create: `dashboard/src/lib/local-api-url.test.ts`

- [ ] **Step 1：先写失败测试**

在 `dashboard/src/lib/local-api-url.test.ts` 写入以下测试。测试通过模块重载分别覆盖 localhost、Tauri 和普通远端网页：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

describe("isLocalDashboardRuntime", () => {
  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it("treats localhost as local runtime", async () => {
    const { isLocalDashboardRuntime } = await import("./local-api-url");
    expect(window.location.hostname).toBe("localhost");
    expect(isLocalDashboardRuntime()).toBe(true);
  });

  it("treats Tauri WebView as local runtime", async () => {
    (window as any).__TAURI_INTERNALS__ = { invoke: vi.fn() };
    const { isLocalDashboardRuntime } = await import("./local-api-url");
    expect(isLocalDashboardRuntime()).toBe(true);
  });
});
```

- [ ] **Step 2：运行测试确认红灯**

Run:

```powershell
npm --prefix dashboard run test -- src/lib/local-api-url.test.ts
```

Expected: FAIL，提示 `isLocalDashboardRuntime` 未导出。

- [ ] **Step 3：实现最小公共 helper**

在 `dashboard/src/lib/local-api-url.ts` 的 `isTauriRuntime()` 后新增：

```ts
export function isLocalDashboardRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return (
    isTauriRuntime() ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}
```

不要在本工单创建第二个同义 helper。

- [ ] **Step 4：运行测试确认绿灯**

Run:

```powershell
npm --prefix dashboard run test -- src/lib/local-api-url.test.ts
```

Expected: PASS，2 tests。

- [ ] **Step 5：提交公共 helper**

```powershell
git add dashboard/src/lib/local-api-url.ts dashboard/src/lib/local-api-url.test.ts
git diff --cached --name-only
git commit -m "fix: detect local usage runtime consistently"
```

---

### Task 2：让全部新增 usage hooks 支持本地未登录模式并终止 loading

**Files:**
- Create: `dashboard/src/hooks/__tests__/local-usage-hooks.test.tsx`
- Modify: `dashboard/src/hooks/use-usage-summary.ts`
- Modify: `dashboard/src/hooks/use-usage-trend.ts`
- Modify: `dashboard/src/hooks/use-usage-filter-options.ts`
- Modify: `dashboard/src/hooks/use-request-usage-records.ts`
- Modify: `dashboard/src/hooks/use-provider-stats.ts`
- Modify: `dashboard/src/hooks/use-model-stats.ts`

- [ ] **Step 1：写本地无 token 的失败测试**

在新测试文件中 mock `resolveAuthAccessToken()` 返回 `null`，mock `isLocalDashboardRuntime()` 返回 `true`，并为六个 API wrapper 返回最小响应。至少包含以下断言：

```tsx
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageFiltersProvider } from "../use-usage-filters";
import { useUsageSummary } from "../use-usage-summary";
import { getUsageSummary } from "../../lib/api";

vi.mock("../../lib/auth-token", () => ({
  isAccessTokenReady: () => false,
  resolveAuthAccessToken: async () => null,
}));
vi.mock("../../lib/mock-data", () => ({ isMockEnabled: () => false }));
vi.mock("../../lib/local-api-url", () => ({
  isLocalDashboardRuntime: () => true,
}));
vi.mock("../../lib/api", () => ({
  getUsageSummary: vi.fn(),
  getSpendTimeseries: vi.fn(),
  getProviderStats: vi.fn(),
  getModelStats: vi.fn(),
  getRequestUsageRecords: vi.fn(),
}));

describe("local usage hooks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches usage summary without a cloud token", async () => {
    vi.mocked(getUsageSummary).mockResolvedValue({
      ok: true,
      totals: {
        total_tokens: 10,
        input_tokens: 6,
        output_tokens: 4,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        cost_usd: 0,
        request_count: 1,
        success_count: 1,
        success_rate: 100,
        avg_latency_ms: 0,
        cache_hit_rate: 0,
      },
    } as any);

    const { result } = renderHook(
      () => useUsageSummary({ from: "2026-06-01", to: "2026-06-01" }),
      { wrapper: UsageFiltersProvider },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getUsageSummary).toHaveBeenCalledTimes(1);
    expect(result.current.summary?.totals?.total_tokens).toBe(10);
  });
});
```

在同一文件继续为 `useUsageTrend`、`useUsageFilterOptions`、`useProviderStats`、`useModelStats`、`useRequestUsageRecords` 各写一个无 token 本地测试。每项都必须断言 API 被调用且 `loading === false`；Request hook 传入 `visibleProviderIds: ["codex"]`。

- [ ] **Step 2：运行测试确认现状失败**

Run:

```powershell
npm --prefix dashboard run test -- src/hooks/__tests__/local-usage-hooks.test.tsx
```

Expected: FAIL；API mock 未被调用或 loading 未结束。

- [ ] **Step 3：逐个 hook 接入公共本地判断**

六个 hook 都导入：

```ts
import { isLocalDashboardRuntime } from "../lib/local-api-url";
```

在 hook 顶层计算：

```ts
const isLocalMode = isLocalDashboardRuntime();
```

把 refresh guard 统一改成：

```ts
const token = await resolveAuthAccessToken(accessToken);
if (!token && !mockEnabled && !guestAllowed && !isLocalMode) {
  setLoading(false);
  return;
}
```

把初始化 effect 的无权限分支统一改成：

```ts
if (!tokenReady && !guestAllowed && !mockEnabled && !isLocalMode) {
  // 按各 hook 类型清空数据
  setError(null);
  setLoading(false);
  return;
}
```

将 `isLocalMode` 加入相关 callback/effect 依赖。不得通过把 `guestAllowed` 写死为 true 绕过鉴权。

- [ ] **Step 4：运行六 hook 测试**

Run:

```powershell
npm --prefix dashboard run test -- src/hooks/__tests__/local-usage-hooks.test.tsx
```

Expected: PASS，六个本地无 token 用例全部通过。

- [ ] **Step 5：运行 TypeScript 检查**

```powershell
npm --prefix dashboard run typecheck
```

Expected: exit 0。

- [ ] **Step 6：提交本地 hook 修复**

```powershell
git add dashboard/src/hooks/__tests__/local-usage-hooks.test.tsx dashboard/src/hooks/use-usage-summary.ts dashboard/src/hooks/use-usage-trend.ts dashboard/src/hooks/use-usage-filter-options.ts dashboard/src/hooks/use-request-usage-records.ts dashboard/src/hooks/use-provider-stats.ts dashboard/src/hooks/use-model-stats.ts
git diff --cached --name-only
git commit -m "fix: load spend usage hooks in local mode"
```

---

### Task 3：修复来源和模型筛选 reducer

**Files:**
- Modify: `dashboard/src/hooks/__tests__/use-usage-filters.cascade.test.tsx`
- Modify: `dashboard/src/hooks/use-usage-filters.tsx`
- Modify: `dashboard/src/ui/dashboard/components/SourceFilter.jsx`
- Modify: `dashboard/src/ui/dashboard/components/ModelFilter.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/SourceFilter.test.jsx`
- Create: `dashboard/src/ui/dashboard/components/__tests__/ModelFilter.test.jsx`

- [ ] **Step 1：把错误的 no-op 测试改为产品行为测试**

删除“null targets 保持 null”的断言，新增：

```tsx
it("applies a concrete source selection from the default all state", () => {
  const { result } = setup();
  act(() => result.current.actions.setSources(["codex"]));
  expect(result.current.state.agentIds).toBeNull();
  expect(result.current.state.sources).toEqual(["codex"]);
  expect(result.current.state.models).toBeNull();
});

it("applies a concrete model selection from the default all state", () => {
  const { result } = setup();
  act(() => result.current.actions.setModels(["gpt-5.5"]));
  expect(result.current.state.agentIds).toBeNull();
  expect(result.current.state.sources).toBeNull();
  expect(result.current.state.models).toEqual(["gpt-5.5"]);
});

it("changing an agent clears source and model selections", () => {
  const { result } = setup();
  act(() => result.current.actions.setSources(["codex"]));
  act(() => result.current.actions.setModels(["gpt-5.5"]));
  act(() => result.current.actions.setAgentIds(["codex"]));
  expect(result.current.state).toMatchObject({
    agentIds: ["codex"],
    sources: null,
    models: null,
  });
});
```

- [ ] **Step 2：补 UI 应用行为测试**

SourceFilter 测试必须点击 `Codex` 和“应用”，然后断言触发按钮不再显示“全部来源”。ModelFilter 测试以 `gpt-5.5` 做同样验证。

Run:

```powershell
npm --prefix dashboard run test -- src/hooks/__tests__/use-usage-filters.cascade.test.tsx src/ui/dashboard/components/__tests__/SourceFilter.test.jsx src/ui/dashboard/components/__tests__/ModelFilter.test.jsx
```

Expected: 至少来源和模型应用用例 FAIL，复现当前缺陷。

- [ ] **Step 3：删除会吞掉目标选择的 MERGE_FILTERS 路径**

在 `use-usage-filters.tsx` 中保留简单向下级联：

```ts
case "SET_AGENT_IDS":
  return { ...state, agentIds: action.agentIds, sources: null, models: null };
case "SET_SOURCES":
  return { ...state, sources: action.sources, models: null };
case "SET_MODELS":
  return { ...state, models: action.models };
```

从 `FilterAction`、reducer 和 `useUsageFilterActions()` 删除 `MERGE_FILTERS`、`selectSourcesCascade`、`selectModelsCascade`。不要新增等价的反向 merge。

- [ ] **Step 4：让两个弹窗直接应用目标选择**

`SourceFilter.jsx`：

```jsx
const { setSources } = useUsageFilterActions();

const handleApply = () => {
  setSources(draft);
  setOpen(false);
};
```

`ModelFilter.jsx`：

```jsx
const { setModels } = useUsageFilterActions();

const handleApply = () => {
  setModels(draft);
  setOpen(false);
};
```

删除两个组件中仅供反向 merge 使用的 `getAgentIdByQueueSource` 计算和无用 import。`draft === null` 继续表示“全部”。

- [ ] **Step 5：运行筛选测试和 SpendPage 测试**

```powershell
npm --prefix dashboard run test -- src/hooks/__tests__/use-usage-filters.cascade.test.tsx src/ui/dashboard/components/__tests__/SourceFilter.test.jsx src/ui/dashboard/components/__tests__/ModelFilter.test.jsx src/pages/SpendPage.test.jsx
```

Expected: 全部通过；控制台不得出现新的 `act()` warning。

- [ ] **Step 6：提交筛选修复**

```powershell
git add dashboard/src/hooks/__tests__/use-usage-filters.cascade.test.tsx dashboard/src/hooks/use-usage-filters.tsx dashboard/src/ui/dashboard/components/SourceFilter.jsx dashboard/src/ui/dashboard/components/ModelFilter.jsx dashboard/src/ui/dashboard/components/__tests__/SourceFilter.test.jsx dashboard/src/ui/dashboard/components/__tests__/ModelFilter.test.jsx
git diff --cached --name-only
git commit -m "fix: apply spend source and model filters"
```

---

### Task 4：用单一 refresh revision 刷新全部支出数据

**Files:**
- Modify: `dashboard/src/hooks/use-usage-filters.tsx`
- Modify: `dashboard/src/hooks/__tests__/use-usage-filters.cascade.test.tsx`
- Modify: `dashboard/src/hooks/use-usage-summary.ts`
- Modify: `dashboard/src/hooks/use-usage-trend.ts`
- Modify: `dashboard/src/hooks/use-usage-filter-options.ts`
- Modify: `dashboard/src/hooks/use-request-usage-records.ts`
- Modify: `dashboard/src/hooks/use-provider-stats.ts`
- Modify: `dashboard/src/hooks/use-model-stats.ts`
- Modify: `dashboard/src/hooks/__tests__/local-usage-hooks.test.tsx`
- Modify: `dashboard/src/pages/SpendPage.jsx`
- Modify: `dashboard/src/pages/SpendPage.test.jsx`

- [ ] **Step 1：先写 refresh revision 状态测试**

在 filter hook 测试中增加：

```tsx
it("increments one shared refresh revision", () => {
  const { result } = setup();
  expect(result.current.refreshRevision).toBe(0);
  act(() => result.current.requestRefresh());
  expect(result.current.refreshRevision).toBe(1);
  act(() => result.current.requestRefresh());
  expect(result.current.refreshRevision).toBe(2);
});
```

- [ ] **Step 2：先写一次刷新触发全部 API 的页面测试**

在 `SpendPage.test.jsx` 使用 fake timers，把 interval 设置为 `30s`，清空 mount 调用计数后推进 30 秒：

```jsx
vi.useFakeTimers();
getLocalSettings.mockResolvedValue({ dashboardRefresh: { interval: "30s" } });
render(<SpendPage signedIn />);
await waitFor(() => expect(getUsageSummary).toHaveBeenCalled());

vi.clearAllMocks();
await act(async () => {
  vi.advanceTimersByTime(30_000);
  await Promise.resolve();
});

await waitFor(() => {
  expect(getSpendRecords).toHaveBeenCalled();
  expect(getSpendTimeseries).toHaveBeenCalled();
  expect(getUsageSummary).toHaveBeenCalled();
  expect(getProviderStats).toHaveBeenCalled();
  expect(getModelStats).toHaveBeenCalled();
  expect(getRequestUsageRecords).toHaveBeenCalled();
});
vi.useRealTimers();
```

Expected before implementation: trend/tab/filter-option API 中至少一项没有被重新调用。

为避免 `useUsageFilterOptions` 的 90 天 Provider/model 请求让断言假阳性，测试要分别检查：详情 Tab 的 Provider/model 请求携带页面 `from/to`，filter-options 请求携带 lookback `from/to`。三个详情面板即使非激活也必须在一次 revision 后各刷新一次。

在同一测试文件增加日期回归：先点击 `7d`，再打开自定义日期面板并应用 `2026-06-01` 至 `2026-06-14`。每次操作后都断言 summary、trend、request、Provider、model 和 Spend records 的最后一次调用携带新的 `from/to`；filter options 继续使用自己的 lookback，不断言它跟随页面日期。该测试使用 `vi.setSystemTime()` 固定当前日期，禁止依赖执行当天。

- [ ] **Step 3：在 UsageFiltersProvider 增加 revision，不写入持久化筛选 state**

```tsx
const [refreshRevision, requestRefresh] = React.useReducer(
  (current: number) => current + 1,
  0,
);

const value = useMemo(
  () => ({ state, dispatch, activeFilterCount, refreshRevision, requestRefresh }),
  [state, activeFilterCount, refreshRevision],
);
```

同步扩展 `UsageFiltersContextValue`。`RESET` 不重置 revision。

- [ ] **Step 4：每个数据 hook 只监听同一个 revision**

六个 hook 使用相同模式：

```ts
const { refreshRevision } = useUsageFilters();
const handledRefreshRevision = useRef(refreshRevision);

useEffect(() => {
  if (handledRefreshRevision.current === refreshRevision) return;
  handledRefreshRevision.current = refreshRevision;
  void refresh();
}, [refreshRevision, refresh]);
```

这段 effect 不替换现有首次加载 effect；不得在 hook 内注册 interval。

- [ ] **Step 5：让三个详情 Tab 保持挂载并响应同一 revision**

把 `UsageDetailTabs` 从“只创建 active component”改为三个 `role="tabpanel"` 都挂载，非激活 panel 使用原生 `hidden` 属性：

```jsx
<div role="tabpanel" hidden={activeTab !== "requests"}>
  <RequestUsageLog {...sharedProps} />
</div>
<div role="tabpanel" hidden={activeTab !== "provider"}>
  <ProviderUsageTable {...sharedProps} />
</div>
<div role="tabpanel" hidden={activeTab !== "model"}>
  <ModelUsageTable {...sharedProps} />
</div>
```

这样三个 hook 始终订阅 `refreshRevision`，Tab 切换也保留排序/局部筛选状态。不得用 CSS 把多个 panel 同时暴露给可访问性树。

- [ ] **Step 6：SpendPage 只保留一个 timer**

自动刷新 timer 和手动刷新按钮都只调用 `requestRefresh()`。Spend records 监听 revision 做静默刷新：

```jsx
const { state: filterState, refreshRevision, requestRefresh } = useUsageFilters();

useEffect(() => {
  if (refreshRevision === 0) return;
  setIsRefreshing(true);
  fetchRecords({ silent: true }).finally(() => setIsRefreshing(false));
}, [refreshRevision, fetchRecords]);
```

timer：

```jsx
useEffect(() => {
  if (filterState.refreshInterval === "manual") return undefined;
  const ms = INTERVAL_MS[filterState.refreshInterval];
  if (!ms) return undefined;
  const timer = window.setInterval(requestRefresh, ms);
  return () => window.clearInterval(timer);
}, [filterState.refreshInterval, requestRefresh]);
```

删除旧 `Promise.allSettled([refreshSummary(), fetchRecords(...)])` 刷新链，避免 summary 被重复请求。

- [ ] **Step 7：运行刷新测试**

```powershell
npm --prefix dashboard run test -- src/hooks/__tests__/use-usage-filters.cascade.test.tsx src/hooks/__tests__/local-usage-hooks.test.tsx src/pages/SpendPage.test.jsx src/ui/dashboard/components/__tests__/RefreshIntervalPicker.test.jsx
```

Expected: 全部通过；只有 SpendPage 注册 interval，六个 hook 没有自己的 interval。

- [ ] **Step 8：提交统一刷新**

```powershell
git add dashboard/src/hooks/use-usage-filters.tsx dashboard/src/hooks/__tests__/use-usage-filters.cascade.test.tsx dashboard/src/hooks/use-usage-summary.ts dashboard/src/hooks/use-usage-trend.ts dashboard/src/hooks/use-usage-filter-options.ts dashboard/src/hooks/use-request-usage-records.ts dashboard/src/hooks/use-provider-stats.ts dashboard/src/hooks/use-model-stats.ts dashboard/src/hooks/__tests__/local-usage-hooks.test.tsx dashboard/src/pages/SpendPage.jsx dashboard/src/pages/SpendPage.test.jsx
git diff --cached --name-only
git commit -m "fix: refresh all spend usage views together"
```

---

### Task 5：让请求日志内部来源筛选同时约束 records 和 totals

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx`
- Modify: `dashboard/src/hooks/__tests__/use-request-usage-records.test.tsx`

- [ ] **Step 1：写失败测试**

测试先返回 Codex 与 Claude 两组不同 totals，选择 Claude 后断言 hook 只再次查询 Claude，且表尾 totals 变为 Claude 数值：

```jsx
await user.selectOptions(screen.getByLabelText(/选择数据源|source/i), "claude");

await waitFor(() => {
  expect(getRequestUsageRecords).toHaveBeenLastCalledWith(
    expect.objectContaining({ source: "claude" }),
  );
});
expect(screen.getByText("200")).toBeInTheDocument();
expect(screen.queryByText("300")).not.toBeInTheDocument();
```

测试 fixture 中 Claude totals.input_tokens 为 200、全部 totals.input_tokens 为 300。

- [ ] **Step 2：运行测试确认红灯**

```powershell
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx src/hooks/__tests__/use-request-usage-records.test.tsx
```

Expected: FAIL；当前只在客户端过滤 records，totals 仍为全部来源。

- [ ] **Step 3：用选中来源缩小 hook 查询集合**

在 `RequestUsageLog.jsx` 计算：

```jsx
const queriedProviderIds = useMemo(
  () => (sourceFilter ? [sourceFilter] : visibleProviderIds),
  [sourceFilter, visibleProviderIds],
);
```

传给 hook：

```jsx
const { records, totals, loading, error, refresh } = useRequestUsageRecords({
  // 其他参数保持不变
  visibleProviderIds: queriedProviderIds,
  limit: 100,
});
```

来源选项从 `visibleProviderIds` 生成，不再从当前 records 反推；显示名使用 `limitProviderName(id)`。删除客户端 `filteredRecords`，排序直接基于 hook 返回的 `records`。

- [ ] **Step 4：运行请求日志测试**

```powershell
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx src/hooks/__tests__/use-request-usage-records.test.tsx
```

Expected: PASS；无 `act()` warning。

- [ ] **Step 5：提交请求日志筛选修复**

```powershell
git add dashboard/src/ui/dashboard/components/RequestUsageLog.jsx dashboard/src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx dashboard/src/hooks/__tests__/use-request-usage-records.test.tsx
git diff --cached --name-only
git commit -m "fix: align request records and totals filters"
```

---

### Task 6：给本地 API 增加协议握手并拒绝旧服务

**Files:**
- Create: `test/local-api-handshake.test.js`
- Modify: `src/lib/local-api.js`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1：写 Node API 握手失败测试**

在 `test/local-api-handshake.test.js` 通过 `createLocalApiHandler` 调用 `/api/local-auth`，断言：

```js
assert.equal(body.protocol_version, 2);
assert.ok(body.capabilities.includes("spend_usage_v2"));
assert.equal(typeof body.token, "string");
assert.ok(body.token.length > 0);
```

Run:

```powershell
node --test test/local-api-handshake.test.js
```

Expected: FAIL，当前响应只有 token。

- [ ] **Step 2：扩展 local-auth 响应**

在 `src/lib/local-api.js` 靠近模块常量处定义：

```js
const LOCAL_API_PROTOCOL_VERSION = 2;
const LOCAL_API_CAPABILITIES = Object.freeze([
  "spend_usage_v2",
  "provider_model_stats",
  "request_usage_records",
]);
```

响应改为：

```js
res.end(JSON.stringify({
  token: localAuthToken,
  protocol_version: LOCAL_API_PROTOCOL_VERSION,
  capabilities: LOCAL_API_CAPABILITIES,
}));
```

- [ ] **Step 3：更新 Rust probe 测试**

保留旧响应拒绝测试，并新增当前响应接受测试：

```rust
#[test]
fn api_probe_rejects_server_without_current_spend_capability() {
    let body = r#"{"token":"legacy","protocol_version":1,"capabilities":[]}"#;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body,
    );
    let (port, handle) = serve_probe_response(response);
    assert!(!is_token_tracker_api_available(port));
    handle.join().expect("probe server thread");
}

#[test]
fn api_probe_accepts_current_spend_capability() {
    let body = r#"{"token":"current","protocol_version":2,"capabilities":["spend_usage_v2"]}"#;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body,
    );
    let (port, handle) = serve_probe_response(response);
    assert!(is_token_tracker_api_available(port));
    handle.join().expect("probe server thread");
}
```

将现有 `serve_probe_response` 参数改为 `String` 并在线程中 `move`，不得使用 `Box::leak`；测试结束后必须 `join` 后台线程。

- [ ] **Step 4：解析 HTTP body 并校验版本/capability**

在 `commands.rs` 引入：

```rust
use serde::Deserialize;

const REQUIRED_LOCAL_API_PROTOCOL_VERSION: u32 = 2;
const REQUIRED_LOCAL_API_CAPABILITY: &str = "spend_usage_v2";

#[derive(Deserialize)]
struct LocalAuthProbe {
    token: String,
    protocol_version: u32,
    capabilities: Vec<String>,
}
```

在现有 header 检查通过后分割 body、解析 JSON：

```rust
let Some((_, body)) = response.split_once("\r\n\r\n") else {
    return false;
};
let Ok(probe) = serde_json::from_str::<LocalAuthProbe>(body) else {
    return false;
};

!probe.token.is_empty()
    && probe.protocol_version >= REQUIRED_LOCAL_API_PROTOCOL_VERSION
    && probe
        .capabilities
        .iter()
        .any(|item| item == REQUIRED_LOCAL_API_CAPABILITY)
```

不要只用字符串 `contains` 判断 JSON 字段。

- [ ] **Step 5：运行 Node 与 Rust 测试**

```powershell
node --test test/local-api-handshake.test.js
cargo test --manifest-path src-tauri/Cargo.toml commands::tests
```

Expected: 全部通过；旧协议拒绝、当前协议接受。

- [ ] **Step 6：提交握手修复**

```powershell
git add test/local-api-handshake.test.js src/lib/local-api.js src-tauri/src/commands.rs
git diff --cached --name-only
git commit -m "fix: reject stale local api servers"
```

---

### Task 7：工单级集成验证与交接

**Files:**
- Modify only if a failing assertion proves a TICKET-05 regression
- Create: `docs/test-reports/v2.1/22-spend-local-filters-refresh-runtime.md`

- [ ] **Step 1：运行定向前端测试**

```powershell
npm --prefix dashboard run test -- src/lib/local-api-url.test.ts src/hooks/__tests__/local-usage-hooks.test.tsx src/hooks/__tests__/use-usage-filters.cascade.test.tsx src/hooks/__tests__/use-request-usage-records.test.tsx src/ui/dashboard/components/__tests__/SourceFilter.test.jsx src/ui/dashboard/components/__tests__/ModelFilter.test.jsx src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx src/ui/dashboard/components/__tests__/RefreshIntervalPicker.test.jsx src/pages/SpendPage.test.jsx
```

Expected: exit 0，无 React duplicate key、`act()`、未处理 Promise warning。

- [ ] **Step 2：运行后端、类型和构建验证**

```powershell
node --test test/local-api-handshake.test.js test/request-usage-records-api.test.js test/provider-model-stats.test.js
cargo test --manifest-path src-tauri/Cargo.toml commands::tests
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npx tauri build --no-bundle
```

Expected: 所有命令 exit 0；只允许记录构建器既有 chunk-size warning。

- [ ] **Step 3：真实本地未登录冒烟**

1. 确认旧 `7681` 服务返回旧协议。
2. 启动新构建的 `src-tauri/target/release/token-eyes.exe`。
3. 检查 Tauri 选择新的兼容端口，而不是复用旧端口。
4. 打开支出页，30 秒内统计面板、趋势和请求 Tab 均离开 loading。
5. 选择一个来源和一个模型，确认触发按钮显示已选数量。
6. 点击手动刷新，确认全部区域产生新请求。

- [ ] **Step 4：写测试报告**

报告必须包含：commit 列表、每条命令及结果、Tauri 使用端口、筛选前后请求 URL、loading 截止时间、已知非本工单问题。不得写“应该通过”。

- [ ] **Step 5：提交测试报告**

```powershell
git add docs/test-reports/v2.1/22-spend-local-filters-refresh-runtime.md
git diff --cached --name-only
git commit -m "test: verify local spend filters and refresh"
```

## 完成回报格式

subagent 最终回复必须包含：

- 分支名和全部 commit SHA；
- 实际修改文件；
- 本地运行时判断的唯一入口；
- 来源/模型 reducer 的最终状态转换；
- 刷新 revision 如何覆盖七类数据；
- local API protocol/capability 值；
- 全部测试命令和通过数量；
- Tauri 实际端口和旧服务拒绝证据；
- 阻塞项或未解决问题。

主上下文审核通过 TICKET-05 后，才允许派发 TICKET-06。
