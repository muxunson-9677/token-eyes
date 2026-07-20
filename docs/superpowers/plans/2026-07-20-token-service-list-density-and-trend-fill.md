# Token Service List Density and Trend Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display five complete, clearly separated token-service cards per page while making the adjacent usage-trend plot fill the shared desktop row height.

**Architecture:** Keep pagination and service normalization inside `TokenServiceList`, changing only its presentation and deriving one shared reset footer when every lane has the same reset. Turn `UsageTrendChart` into a full-height flex card whose plot container is measured in both dimensions by `ResizeObserver`; keep the existing `SpendPage` stretched grid as the alignment owner.

**Tech Stack:** React 18, Tailwind CSS, Vitest, Testing Library, Tauri desktop diagnostic build.

---

### Task 1: Record the layout failure baseline

**Files:**
- Create: `docs/test-reports/provider-api/_token-service-layout-baseline.log`
- Reference: `dashboard/src/ui/dashboard/components/TokenServiceList.jsx`
- Reference: `dashboard/src/ui/dashboard/components/UsageTrendChart.jsx`

- [ ] **Step 1: Record the current structural evidence**

Run:

```powershell
rg -n 'divide-y|data-testid="token-service-row"|CHART_HEIGHT|height=\{CHART_HEIGHT\}|minHeight: CHART_HEIGHT|usage-chart-token-services-layout' dashboard/src/ui/dashboard/components/TokenServiceList.jsx dashboard/src/ui/dashboard/components/UsageTrendChart.jsx dashboard/src/pages/SpendPage.jsx | Tee-Object docs/test-reports/provider-api/_token-service-layout-baseline.log
```

Expected: the log shows divider-only service rows and a fixed `440`-pixel chart inside an independently stretched grid row.

- [ ] **Step 2: Record the current focused-test baseline**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/TokenServiceList.test.jsx src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx src/pages/SpendPage.test.jsx 2>&1 | Tee-Object -Append docs/test-reports/provider-api/_token-service-layout-baseline.log
```

Expected: existing tests pass, demonstrating that they do not yet protect independent card boundaries or height-responsive plotting.

### Task 2: Add failing compact-card contract tests

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/TokenServiceList.test.jsx`
- Test: `dashboard/src/ui/dashboard/components/TokenServiceList.test.jsx`

- [ ] **Step 1: Add the independent-card and shared-reset assertions**

Add a test that renders one Cursor record and four single-lane records, then asserts five rows, a gapped list, independently bordered rows, all three Cursor lanes, full used/total values, and one shared reset footer:

```jsx
it("renders five compact independent cards without hiding multi-lane quota values", () => {
  const sharedReset = "2026-08-06T14:31:29.000Z";
  const cursor = plan("cursor-live", 0, 0, {
    provider_id: "cursor",
    plan_label: "Pro",
    notes: "eve***@hotmail.com",
    quota_source: "official",
    quota_unit: "percent",
    detection_method: "official_account",
    sync_status: "success",
    expires_at: null,
    quota_windows: [
      { kind: "total", unit: "percent", total: 100, used: 33.522, percentage: 33.522, resets_at: sharedReset },
      { kind: "auto_composer", unit: "percent", total: 100, used: 27.82, percentage: 27.82, resets_at: sharedReset },
      { kind: "api", unit: "percent", total: 100, used: 71.533, percentage: 71.533, resets_at: sharedReset },
    ],
  });
  render(<TokenServiceList plans={[cursor, plan("A", 90), plan("B", 80), plan("C", 70), plan("D", 60)]} />);

  const list = screen.getByTestId("token-service-cards");
  const rows = within(list).getAllByTestId("token-service-row");
  expect(rows).toHaveLength(5);
  expect(list).toHaveClass("gap-1.5");
  for (const row of rows) expect(row).toHaveClass("border");
  expect(within(rows[0]).getByTestId("token-service-window-total")).toHaveTextContent("33.522");
  expect(within(rows[0]).getByTestId("token-service-window-auto_composer")).toHaveTextContent("27.82");
  expect(within(rows[0]).getByTestId("token-service-window-api")).toHaveTextContent("71.533");
  expect(within(rows[0]).getAllByTestId("token-service-shared-reset")).toHaveLength(1);
});
```

- [ ] **Step 2: Run the card test and verify RED**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/TokenServiceList.test.jsx
```

Expected: FAIL because `token-service-cards`, bordered row cards, and the shared reset footer do not exist.

- [ ] **Step 3: Implement the smallest compact-card presentation**

In `TokenServiceList.jsx`:

- keep `TOKEN_SERVICE_PAGE_SIZE = 5` unchanged;
- replace the divider list with `data-testid="token-service-cards"` and a compact gap;
- give each row its own border, background, rounded corners, and compact padding;
- render each quota lane as one compact label/value row plus a thin progress bar;
- keep exact formatted used and total values in visible text;
- compute a shared reset only when every metric has the same non-empty `resetsAt`, omit per-lane reset repetition in that case, and render one `data-testid="token-service-shared-reset"` footer;
- keep different per-lane reset times visible on their own lanes;
- make the outer panel `h-full` and keep pagination after the flexible card list.

The lane markup must retain existing `token-service-window-${metric.kind}` test IDs and use this visible value structure:

```jsx
<span className="tabular-nums">
  {formatQuota(metric.used, metric.unit)} / {formatQuota(metric.total, metric.unit)} · {roundedPercentage}%
</span>
```

- [ ] **Step 4: Run the focused card tests and verify GREEN**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/TokenServiceList.test.jsx
```

Expected: PASS, including existing ordering, page clamping, provider visibility, note, and Cursor-lane tests.

### Task 3: Add failing responsive-height chart tests

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx`
- Test: `dashboard/src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx`

- [ ] **Step 1: Make the ResizeObserver stub controllable**

Replace the no-op stub with an instance registry:

```jsx
const resizeObservers = [];
class ResizeObserverStub {
  constructor(callback) {
    this.callback = callback;
    resizeObservers.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  resize(width, height) {
    this.callback([{ contentRect: { width, height } }]);
  }
}
```

Import `act`, clear `resizeObservers` before each height test, and replace the fixed-height test with:

```jsx
it("grows the plot SVG to the measured available height", () => {
  resizeObservers.length = 0;
  const { container } = render(<UsageTrendChart series={makeSeries()} />);
  const plot = screen.getByTestId("usage-trend-plot");
  expect(plot).toHaveClass("flex-1");

  act(() => resizeObservers.at(-1).resize(900, 620));

  const svg = container.querySelector('svg[role="img"]');
  expect(svg).toHaveAttribute("width", "900");
  expect(svg).toHaveAttribute("height", "620");
});
```

- [ ] **Step 2: Run the chart test and verify RED**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx
```

Expected: FAIL because the plot has no test ID or flex growth contract and the SVG remains `440` pixels high.

- [ ] **Step 3: Implement two-dimensional plot measurement**

In `UsageTrendChart.jsx`:

- rename `CHART_HEIGHT` to `MIN_CHART_HEIGHT` and retain `440` as the narrow/initial minimum;
- store `{ width, height }` from the plot container's `ResizeObserver`;
- attach the callback ref to the plot container instead of the outer card;
- make the outer card `flex h-full min-w-0 flex-col`;
- give the plot `data-testid="usage-trend-plot"` and `relative min-h-[440px] min-w-0 flex-1`;
- calculate `height = Math.max(MIN_CHART_HEIGHT, measuredHeight || MIN_CHART_HEIGHT)`;
- use the measured width and calculated height for SVG dimensions, chart bounds, baseline, paths, ticks, hover zones, and tooltip positioning;
- retain header and legend as fixed-height siblings.

Use one state value so width and height update atomically:

```jsx
const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
// ResizeObserver callback
setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
```

- [ ] **Step 4: Run chart tests and verify GREEN**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx
```

Expected: PASS with the SVG changing from its minimum height to the simulated 620-pixel plot height while existing tooltip, legend, axes, and path tests remain green.

### Task 4: Lock the two-panel alignment contract

**Files:**
- Modify: `dashboard/src/pages/SpendPage.jsx`
- Modify: `dashboard/src/pages/SpendPage.test.jsx`
- Test: `dashboard/src/pages/SpendPage.test.jsx`

- [ ] **Step 1: Add the integration assertions**

Extend the existing “places a compact paginated Token service list beside the usage trend” test:

```jsx
expect(layout).toHaveClass("lg:items-stretch");
expect(within(layout).getByTestId("token-service-list")).toHaveClass("h-full");
expect(within(layout).getByTestId("usage-trend-plot")).toHaveClass("flex-1");
```

- [ ] **Step 2: Run the SpendPage test and verify RED**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/SpendPage.test.jsx -t "places a compact paginated Token service list beside the usage trend"
```

Expected: FAIL until both child panels expose the full-height contracts.

- [ ] **Step 3: Apply the minimal grid-width adjustment**

Keep `lg:items-stretch` and widen only the desktop service track enough for full compact values:

```jsx
className="mb-6 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-stretch"
```

Do not introduce a fixed row height or change the narrow stacked layout.

- [ ] **Step 4: Run all three focused suites**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/TokenServiceList.test.jsx src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx src/pages/SpendPage.test.jsx
```

Expected: PASS.

### Task 5: Regression verification and diagnostic installed-app evidence

**Files:**
- Create: `docs/test-reports/provider-api/2026-07-20-token-service-layout-rework.md`
- Create: `artifacts/rework/token-service-layout/` screenshots
- Modify only if a regression is found: files from Tasks 2–4

- [ ] **Step 1: Run the dashboard build**

Run:

```powershell
npm --prefix dashboard run build
```

Expected: PASS with no build errors.

- [ ] **Step 2: Run repository layout guardrails**

Run:

```powershell
node --test test/dashboard-layout-adjustments.test.js
```

Expected: PASS.

- [ ] **Step 3: Build a diagnostic desktop installer only after automated verification**

Run:

```powershell
npm run tauri:prepare-runtime
npm run tauri:build -- --bundles nsis
```

Expected: a diagnostic NSIS installer from the current worktree. It is not the final release installer because the original TRAE live gate remains open.

- [ ] **Step 4: Verify the installed application with real service data**

Open the formal installed app and record screenshots showing:

- five services on page one when at least five valid services exist;
- page two when at least six valid services exist;
- clear independent service-card borders and gaps;
- every visible quota value uncropped;
- equal top and bottom edges for the trend and service panels;
- the plot filling the lower card space without the reported blank band.

If the real account currently has fewer than six valid services, record that pagination cannot yet receive live acceptance; do not fabricate records or claim PASS from fixtures.

- [ ] **Step 5: Write the evidence report**

Record test commands and outputs, executable path and SHA-256, installed-app steps, service count, page count, viewport/content width, timestamps, and screenshot paths in `docs/test-reports/provider-api/2026-07-20-token-service-layout-rework.md`. Mark the installed-app result only `PASS` or `FAIL/INCOMPLETE`.

### Task 6: Preserve the original rework gates

**Files:**
- Reference: `docs/superpowers/plans/2026-07-19-cursor-single-account-trae-oauth-rework.md`
- Reference: `docs/test-reports/provider-api/2026-07-19-final-adversarial-acceptance.md`

- [ ] **Step 1: Return to the TRAE OAuth task**

Continue the original plan's TRAE failure baseline, Cockpit implementation comparison, failing tests, minimal repair, and same-account live validation. Do not treat the layout implementation as completion of the four-item rework.

- [ ] **Step 2: Enforce release gating**

Do not commit a release candidate, build a final installer, request merge, or announce completion until cost comparison, custom spend cards, one-account Cursor, TRAE OAuth/live quota, and this layout's installed-app checks all pass from a reproducible committed HEAD.
