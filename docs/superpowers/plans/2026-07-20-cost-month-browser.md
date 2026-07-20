# Cost Month Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent month selector to Cost Accumulation so current and historical months use exact API/Token, subscription, and Other AI ledger totals with correct comparisons.

**Architecture:** A pure date-range helper owns current-month versus historical-month boundaries. `SpendCostPage` owns the selected `YYYY-MM`, `useCostAccumulation` requests selected/comparison ranges, and the local spend API computes Other AI group month/year/lifetime totals for the requested summary month. The UI is controlled by props and never computes ledger totals.

**Tech Stack:** React 19, Vitest, Testing Library, Node.js local API, Node test runner, existing timezone/date helpers.

---

### Task 1: Selected-month date ranges

**Files:**
- Modify: `dashboard/src/lib/date-range.ts`
- Modify: `dashboard/src/lib/date-range.test.ts`

- [ ] **Step 1: Write failing date-range tests**

Add tests importing `getCostMonthRanges` and asserting these exact results:

```ts
expect(getCostMonthRanges({
  selectedMonth: "2026-07",
  now: new Date("2026-07-20T10:00:00+08:00"),
  timeZone: "Asia/Shanghai",
})).toEqual({
  selectedMonth: "2026-07",
  isCurrentMonth: true,
  selected: { from: "2026-07-01", to: "2026-07-20" },
  comparison: { from: "2026-06-01", to: "2026-06-20" },
  yearToSelected: { from: "2026-01-01", to: "2026-07-20" },
});

expect(getCostMonthRanges({
  selectedMonth: "2025-06",
  now: new Date("2026-07-20T10:00:00+08:00"),
  timeZone: "Asia/Shanghai",
})).toEqual({
  selectedMonth: "2025-06",
  isCurrentMonth: false,
  selected: { from: "2025-06-01", to: "2025-06-30" },
  comparison: { from: "2025-05-01", to: "2025-05-31" },
  yearToSelected: { from: "2025-01-01", to: "2025-06-30" },
});
```

Also cover January crossing into December, leap-year February, invalid month fallback, and future month clamping to the local current month.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm --prefix dashboard test -- --run src/lib/date-range.test.ts
```

Expected: FAIL because `getCostMonthRanges` is not exported.

- [ ] **Step 3: Implement the pure helper**

Add `getCostMonthRanges` to `date-range.ts`. Parse only `/^\d{4}-(0[1-9]|1[0-2])$/`, derive the local current month with `getLocalDateParts`, clamp invalid/future selections to current, and return selected/comparison/year ranges. For current month use same-elapsed-day comparison with previous-month clamping; for historical months use complete natural months.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: all `date-range.test.ts` tests PASS.

### Task 2: Other AI group summaries for the selected month

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `test/spend-records-api.test.js`

- [ ] **Step 1: Write a failing API test**

Create an Other AI group and three records: a June 2025 one-time USD charge, a July 2025 one-time charge, and a monthly charge active from January 2025. Request:

```js
const response = await call(
  handler,
  "/functions/tokentracker-spend-records?summary_month=2025-06&tz=Asia%2FShanghai",
);
const group = readJsonResponse(response).other_ai_group_totals
  .find((entry) => entry.group_id === groupId);

assert.equal(group.summary_month, "2025-06");
assert.equal(group.month_usd, expectedJuneUsd);
assert.equal(group.year_usd, expectedJanuaryThroughJuneUsd);
assert.equal(group.lifetime_usd, expectedLifetimeUsd);
```

The July one-time charge must be excluded from June and year-through-June, but included in lifetime.

- [ ] **Step 2: Run the focused API test and verify RED**

Run:

```powershell
node --test --test-name-pattern="OTHER-AI selected summary month" test/spend-records-api.test.js
```

Expected: FAIL because `summary_month` is ignored and the API reports the system current month.

- [ ] **Step 3: Implement selected-month group aggregation**

Parse `summary_month` in the spend-record GET handler and pass it into `readSpendRecords`. Update `summarizeOtherAiSpendGroups` so it:

```js
const selectedMonth = parseRequestedMonthOrLocalCurrent(summaryMonth, timeZoneContext);
const monthFrom = firstDayOfMonth(selectedMonth);
const monthTo = selectedMonth === localCurrentMonth
  ? localTodayEnd
  : lastDayOfSelectedMonthEnd;
const yearFrom = firstDayOfSelectedYear(selectedMonth);
```

Return `summary_month` and compute `month_*`, `year_*`, and `lifetime_*` from those exact boundaries. Preserve current behavior when the query is absent.

- [ ] **Step 4: Run API tests and verify GREEN**

Run:

```powershell
node --test test/spend-records-api.test.js test/spend-timeseries-api.test.js
```

Expected: all tests PASS.

### Task 3: Month-aware cost hook and stale-response protection

**Files:**
- Create: `dashboard/src/hooks/use-cost-accumulation.test.jsx`
- Modify: `dashboard/src/hooks/use-cost-accumulation.js`

- [ ] **Step 1: Write failing hook tests**

Mock the four API functions and render the hook with `selectedMonth: "2025-06"`. Assert:

```js
expect(getSpendTimeseries).toHaveBeenNthCalledWith(1, expect.objectContaining({
  from: "2025-06-01",
  to: "2025-06-30",
  timeZone: "Asia/Shanghai",
  sources: ["codex", "other_ai"],
}));
expect(getSpendTimeseries).toHaveBeenNthCalledWith(2, expect.objectContaining({
  from: "2025-05-01",
  to: "2025-05-31",
}));
expect(getSpendRecords).toHaveBeenCalledWith(expect.objectContaining({
  summary_month: "2025-06",
}));
```

Resolve a July request before a slower June request and assert the final hook state remains July. Return totals with `api_usd: 10`, `subscription_usd: 20`, `other_ai_usd: 30`, and `combined_usd: 60`; assert the hook preserves all four values and lifetime independently.

Reject the selected-month timeseries request and assert all selected-month summary amounts are `null` rather than a fallback that invents API zero from subscription records. Separately return an explicit all-zero totals object and assert the hook preserves numeric zero.

- [ ] **Step 2: Run the hook test and verify RED**

Run:

```powershell
npm --prefix dashboard test -- --run src/hooks/use-cost-accumulation.test.jsx
```

Expected: FAIL because the hook has no `selectedMonth` contract, uses the current comparison helper, and allows stale commits.

- [ ] **Step 3: Implement selected-month fetching**

Accept `selectedMonth`, call `getCostMonthRanges`, and send selected/comparison ranges with timezone and source filters. Send `summary_month` to `getSpendRecords`. Track a monotonically increasing request ID in `useRef`; only the latest request may call state setters or clear loading. Keep missing values as `null`, real empty-ledger totals as numeric zero, and preserve `monthOtherAiCostUsd` as a distinct field included once in `monthTotalCostUsd`.

- [ ] **Step 4: Run the hook test and verify GREEN**

Run the Step 2 command. Expected: all hook tests PASS.

### Task 4: Controlled month selector and dynamic cost labels

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Write failing component tests**

Render with `selectedMonth="2025-06"`, `currentMonth="2026-07"`, and a spy `onSelectedMonthChange`. Assert:

```jsx
expect(screen.getByLabelText("spend.cost.month_picker.label")).toHaveValue("2025-06");
expect(screen.getByText(/2025.*6.*spend.cost.summary.api_suffix/)).toBeInTheDocument();
expect(screen.getByText(/2025.*6.*spend.cost.other_ai_groups.month_suffix/)).toBeInTheDocument();
expect(screen.getByText(/2025.*6.*spend.cost.other_ai_groups.year_to_month_suffix/)).toBeInTheDocument();
```

Click previous/next and assert `2025-05`/`2025-07`. Render current month and assert the next button and future `<input type="month">` value are blocked by `max="2026-07"` and `disabled` on next.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx
```

Expected: FAIL because the selector and dynamic labels do not exist.

- [ ] **Step 3: Implement the controlled UI**

Add props `selectedMonth`, `currentMonth`, and `onSelectedMonthChange`. Render two accessible arrow buttons plus `<input type="month" max={currentMonth}>`. Use a pure month shift helper that cannot advance past current month. Replace fixed “本月/本年” labels with selected-month labels, while retaining “总累计”. Add copy keys for selector labels, API/subscription/total suffixes, and Other AI selected-month/year-through-month labels.

- [ ] **Step 4: Run component tests and verify GREEN**

Run the Step 2 command. Expected: all CostAccumulation tests PASS.

### Task 5: Page integration and regression verification

**Files:**
- Modify: `dashboard/src/pages/SpendPage.jsx`
- Modify: `dashboard/src/pages/SpendPage.test.jsx`
- Update: `docs/test-reports/provider-api/2026-07-20-cost-month-browser-baseline.md`

- [ ] **Step 1: Record the baseline and write the failing page test**

Record that the existing page has no month input and `useCostAccumulation` receives no selected month. Mock the hook, render `SpendCostPage`, change the month input to `2025-06`, and assert the hook is next called with `selectedMonth: "2025-06"` without changing the global usage filter.

- [ ] **Step 2: Run the page test and verify RED**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/SpendPage.test.jsx
```

Expected: FAIL because `SpendCostPage` does not own or pass month state.

- [ ] **Step 3: Integrate the selected month**

Initialize month state from `getCostMonthRanges({ timeZone, offsetMinutes: tzOffsetMinutes }).selectedMonth`, pass it to `useCostAccumulation`, and pass the controlled props to `CostAccumulation`. Do not connect it to `useUsageFilters`.

- [ ] **Step 4: Run focused and regression tests**

Run:

```powershell
node --test test/spend-records-api.test.js test/spend-timeseries-api.test.js test/token-plan-refresh.test.js test/token-plans-api.test.js
npm --prefix dashboard test -- --run src/lib/date-range.test.ts src/hooks/use-cost-accumulation.test.jsx src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx src/pages/SpendPage.test.jsx src/ui/dashboard/components/TokenServiceList.test.jsx
git diff --check
```

Expected: all tests PASS and `git diff --check` reports no errors.

- [ ] **Step 5: Verify in the development calling window**

Run the existing dashboard development server, open the Cost page, and verify current month, a historical month, previous/next navigation, direct month selection, dynamic labels, Other AI group amounts, comparison copy, real zero, and lifetime invariance. Do not run `tauri build`, do not install an installer, and do not claim installation acceptance.

- [ ] **Step 6: Git checkpoint**

Stage only the files belonging to this feature after inspecting the dirty worktree and staged diff. Commit with:

```powershell
git commit -m "feat: 新增成本月度查看功能"
```

If target files contain inseparable pre-existing uncommitted changes, do not silently include them; leave the implementation uncommitted and report the exact overlap.
