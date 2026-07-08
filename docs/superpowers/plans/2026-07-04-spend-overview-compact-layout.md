# Spend Overview Compact Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the four spend summary cards into the usage statistics panel, compact them into the existing four-column rhythm, and right-align the complete usage-filter group.

**Architecture:** `SpendUsagePage` continues to own the fetched spend totals and passes the raw totals to the presentational `UsageStatsPanel`. `UsageStatsPanel` formats and renders a second compact four-column row beneath the token-dimension row. `UsageFilterBar` retains its children and behavior and changes only its flex alignment.

**Tech Stack:** React 18, JSX, Tailwind CSS, Vitest, Testing Library, Vite, Tauri 2

---

### Task 1: Right-align the filter controls

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/__tests__/UsageFilterBar.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageFilterBar.jsx`

- [ ] **Step 1: Write the failing alignment test**

Add this test inside the existing `UsageFilterBar` describe block:

```jsx
it("right-aligns the complete filter group while preserving wrapping", () => {
  renderBar();

  const toolbar = screen.getByRole("toolbar");
  expect(toolbar).toHaveClass("justify-end", "flex-wrap");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/UsageFilterBar.test.jsx
```

Expected: FAIL because the toolbar does not yet contain `justify-end`.

- [ ] **Step 3: Implement the minimum alignment change**

Change the toolbar class list in `UsageFilterBar.jsx` to:

```jsx
"flex flex-wrap items-center justify-end gap-2 rounded-xl border border-oai-gray-200 bg-white p-2 dark:border-oai-gray-800 dark:bg-oai-gray-900"
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run the same Vitest command. Expected: all `UsageFilterBar` tests PASS.

### Task 2: Render compact cost summaries inside the statistics panel

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`

- [ ] **Step 1: Write the failing compact-row test**

Import `within` from Testing Library and add a test that renders this prop:

```jsx
costSummary={{
  api_usd: 5,
  api_cny: 36,
  subscription_usd: 10,
  subscription_cny: 72,
  combined_usd: 15,
  combined_cny: 108,
  lifetime_combined_usd: 170,
  lifetime_combined_cny: 1224,
}}
```

Assert the intended structure and values:

```jsx
const row = screen.getByTestId("usage-cost-summary");
expect(row).toHaveClass("grid-cols-2", "sm:grid-cols-4");
expect(within(row).getByText("USD 5.00")).toBeInTheDocument();
expect(within(row).getByText("CNY 36.00")).toBeInTheDocument();
expect(within(row).getByText("USD 170.00")).toBeInTheDocument();
```

- [ ] **Step 2: Write the failing missing-versus-zero test**

Render `costSummary` with `api_usd: null`, `api_cny: null`, and real zero values for the other totals. Assert that the missing API value renders em dashes and a real zero renders `USD 0.00`.

```jsx
const row = screen.getByTestId("usage-cost-summary");
expect(within(row).getAllByText("—")).toHaveLength(2);
expect(within(row).getAllByText("USD 0.00").length).toBeGreaterThanOrEqual(1);
```

- [ ] **Step 3: Run the tests to verify both fail for the missing feature**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx
```

Expected: FAIL because `UsageStatsPanel` does not accept or render `costSummary` and `usage-cost-summary` is absent.

- [ ] **Step 4: Implement currency formatting and the compact row**

Add a local formatter that preserves the existing semantics:

```jsx
function formatCurrencyAmount(value, currency) {
  if (value === null || value === undefined) return "—";
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return "—";
  return `${currency} ${numberValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
```

Extend the component signature with `costSummary = null`. Beneath the token-dimension grid, conditionally render `data-testid="usage-cost-summary"` with `mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4`. Render four compact cards using the existing copy keys `spend.monthly_api`, `spend.monthly_subscription`, `spend.monthly_combined`, and `spend.lifetime_combined`; each card uses `rounded-lg border p-2.5`, a `text-xs` label, a `text-base` USD value, and a `text-[11px]` CNY value.

- [ ] **Step 5: Run the focused tests to verify they pass**

Run the same `UsageStatsPanel` Vitest command. Expected: all tests PASS.

### Task 3: Wire the fetched totals into the panel and remove the old row

**Files:**
- Modify: `dashboard/src/pages/SpendPage.test.jsx`
- Modify: `dashboard/src/pages/SpendPage.jsx`

- [ ] **Step 1: Write the failing integration assertion**

In the existing test that displays monthly API, subscription, combined, and lifetime costs, assert that the values are inside the panel-owned row:

```jsx
const costRow = await screen.findByTestId("usage-cost-summary");
expect(within(costRow).getByText("USD 5.00")).toBeInTheDocument();
expect(within(costRow).getByText("USD 170.00")).toBeInTheDocument();
expect(screen.getAllByTestId("usage-cost-summary")).toHaveLength(1);
```

Update the Testing Library import to include `within`.

- [ ] **Step 2: Run the integration test to verify it fails**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/SpendPage.test.jsx
```

Expected: FAIL because the panel-owned cost row is not wired yet.

- [ ] **Step 3: Implement the page wiring and remove obsolete presentation code**

Pass `costSummary={totals}` to `UsageStatsPanel`. Delete the sibling `SummaryTile` grid and remove the now-unused page-local `formatAmount`, `formatDualAmount`, and `SummaryTile` functions. Do not change fetching, totals, hooks, or copy.

- [ ] **Step 4: Run the integration test to verify it passes**

Run the same `SpendPage.test.jsx` command. Expected: all tests PASS.

### Task 4: Regression and visual verification

**Files:**
- Verify only: `dashboard/src/ui/dashboard/components/UsageFilterBar.jsx`
- Verify only: `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`
- Verify only: `dashboard/src/pages/SpendPage.jsx`

- [ ] **Step 1: Run the affected test set together**

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/UsageFilterBar.test.jsx src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx src/pages/SpendPage.test.jsx
```

Expected: all affected tests PASS with no unhandled errors.

- [ ] **Step 2: Build the dashboard**

```powershell
npm run dashboard:build
```

Expected: Vite build exits with code 0.

- [ ] **Step 3: Launch the current Tauri workspace**

```powershell
npm run tauri:dev
```

Expected: the `Token Eyes` window opens and the usage page shows the cost row inside the left statistics column, the unchanged right status column, and a right-aligned toolbar.

- [ ] **Step 4: Check responsive behavior**

At the desktop viewport, verify both metric rows use four aligned columns. At a narrow viewport, verify both rows use two columns and the toolbar wraps while every wrapped line remains right-aligned.

## Working-tree constraint

The target files already contain user changes. Do not commit or stage the implementation automatically; keep the edits surgical and report the exact modified files after verification.
