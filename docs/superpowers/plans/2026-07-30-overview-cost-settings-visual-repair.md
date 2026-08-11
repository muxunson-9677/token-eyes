# Token Eyes Overview, Cost, and Settings Visual Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Token Eyes 0.54.34 with the approved overview layout, compact month-over-month cost text, corrected statistic icon placement, and restrained icon/color hierarchy on cost and settings pages.

**Architecture:** Restore the existing two-column component ownership instead of introducing a new layout system. Extend the existing reusable settings and cost-heading components with optional semantic icon tones so unrelated callers retain their current rendering. Keep every data source, calculation, event handler, and persistence path unchanged.

**Tech Stack:** React 18, Vite 7, Tailwind CSS, Lucide React, Vitest, Node test runner, Tauri 2, NSIS.

---

## File map

- `dashboard/src/ui/dashboard/views/DashboardView.jsx`: restores `TrendMonitor` and `ModelUsageDonut` to the overview left column.
- `test/dashboard-layout-adjustments.test.js`: protects the approved overview column ownership.
- `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`: keeps compact CNY and complete monthly comparison on one row, moves the request icon to the value, and removes the redundant cost icon.
- `dashboard/src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx`: protects comparison copy, row structure, and icon placement.
- `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`: applies matching comparison text plus semantic summary and section icon tones.
- `dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx`: protects cost comparison and visual hierarchy contracts.
- `dashboard/src/components/settings/Controls.jsx`: adds optional `icon` and `iconTone` support to `SectionCard`.
- `dashboard/src/components/settings/Controls.test.jsx`: verifies icon rendering remains opt-in.
- `dashboard/src/components/settings/AppearanceSection.jsx`: assigns the blue appearance icon.
- `dashboard/src/components/settings/MenuBarSection.jsx`: assigns the violet menu-bar icon.
- `dashboard/src/components/settings/DataDirectoriesSection.jsx`: assigns the green directory icon.
- `dashboard/src/components/settings/AgentPricingSection.jsx`: assigns the orange pricing icon.
- `dashboard/src/components/settings/TokenPlanSection.jsx`: assigns the violet plan icon.
- `dashboard/src/components/settings/ProviderApiConfigSection.jsx`: applies the blue provider-API heading icon treatment to its custom section.
- `dashboard/src/components/settings/OtherAiSpendSection.jsx`: assigns the rose other-spend icon.
- `dashboard/src/pages/SettingsPage.jsx`: assigns the green limits icon.
- Version files and Tauri embedded runtime: move the complete installed product from 0.54.33 to 0.54.34.

### Task 1: Restore the approved overview column ownership

**Files:**
- Modify: `test/dashboard-layout-adjustments.test.js`
- Modify: `dashboard/src/ui/dashboard/views/DashboardView.jsx`

- [ ] **Step 1: Write the failing layout contract**

Replace the current wider-column assertions with an explicit left-column boundary check:

```js
test("DashboardPage keeps trend and model usage in the left column", () => {
  const src = readFile(viewPath);
  const leftStart = src.indexOf("lg:col-span-4");
  const rightStart = src.indexOf("lg:col-span-8", leftStart + 1);
  const leftColumn = src.slice(leftStart, rightStart);

  assert.ok(leftColumn.includes("<StatsPanel"), "expected stats in left column");
  assert.ok(leftColumn.includes("<TrendMonitor"), "expected usage trend in left column");
  assert.ok(leftColumn.includes("<ModelUsageDonut"), "expected model usage in left column");
  assert.ok(
    leftColumn.indexOf("<TrendMonitor") < leftColumn.indexOf("<ModelUsageDonut"),
    "expected model usage directly after trend",
  );
});
```

- [ ] **Step 2: Run the test and verify the installed regression is reproduced**

Run:

```powershell
node --test test/dashboard-layout-adjustments.test.js
```

Expected: FAIL because `TrendMonitor` and `ModelUsageDonut` currently occur after the `lg:col-span-8` boundary.

- [ ] **Step 3: Move only the two approved panels**

In `DashboardView.jsx`, move the existing `TrendMonitor` and `ModelUsageDonut` blocks from the right column to the left column after the install prompt. Preserve every prop, conditional, delay call, and screenshot-mode check. Do not change the `lg:col-span-4` / `lg:col-span-8` ratio or move `UsageOverview` and `DataDetails`.

- [ ] **Step 4: Run the layout contract**

Run:

```powershell
node --test test/dashboard-layout-adjustments.test.js
```

Expected: PASS.

### Task 2: Repair monthly comparison copy and statistic icon placement

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`

- [ ] **Step 1: Update the component test to the approved structure**

Add assertions to the existing populated-summary case:

```jsx
const comparison = screen.getAllByTestId("monthly-cost-comparison")[0];
expect(comparison).toHaveTextContent("较上月新增");
expect(comparison.parentElement).toHaveAttribute("data-testid", "monthly-cost-cny-row");
expect(comparison.parentElement).toHaveClass("flex-row", "items-center", "justify-between");

const requestSummary = screen.getByTestId("usage-request-summary");
expect(within(requestSummary).getByText("64,105").previousElementSibling?.tagName).toBe("svg");
expect(within(requestSummary).getByText("ticket02.stats.requests").querySelector("svg")).toBeNull();

const costSummary = screen.getByTestId("usage-total-cost-summary");
expect(costSummary.querySelector('[data-icon="dollar-sign"]')).toBeNull();
expect(within(costSummary).getByText(/\$/)).toBeInTheDocument();
```

Use the test suite’s existing copy mock value if it returns keys instead of Chinese text; the assertion must verify the rendered `spend.monthly_change.increase` result, not an aria-only label.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx
```

Expected: FAIL because comparison text currently contains only the percentage, the request icon is in the label row, and a `DollarSign` icon is rendered before the cost title.

- [ ] **Step 3: Implement the approved compact row**

Keep `getMonthlyCostComparison` returning `kind` and `percent`, and render the existing copy template visibly:

```jsx
<div
  className="mt-0.5 flex min-w-0 flex-row items-center justify-between gap-1 text-[10px] leading-tight tabular-nums"
  data-testid={comparison ? "monthly-cost-cny-row" : undefined}
>
  <span className="shrink-0 text-oai-gray-500 dark:text-oai-gray-400">
    {cnyText || unavailableText}
  </span>
  {comparison ? (
    <span
      data-testid="monthly-cost-comparison"
      data-direction={comparison.kind}
      className={cn(
        "min-w-0 whitespace-nowrap text-[9px] font-medium",
        comparison.kind === "increase" && "text-green-600 dark:text-green-400",
        comparison.kind === "decrease" && "text-green-600 dark:text-green-400",
        comparison.kind === "flat" && "text-oai-gray-400 dark:text-oai-gray-500",
      )}
    >
      {copy(comparisonLabelKey, { value: comparison.percent })}
    </span>
  ) : null}
</div>
```

Move `<Activity>` into the request number line immediately before the formatted request value. Add `data-testid="usage-total-cost-summary"` to the cost card, remove its `<DollarSign>` title icon, and remove `DollarSign` from the import only if no other use remains.

- [ ] **Step 4: Run the focused component suite**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx
```

Expected: PASS with complete visible month-over-month copy and no duplicate cost icon.

### Task 3: Add opt-in icon hierarchy to settings

**Files:**
- Create: `dashboard/src/components/settings/Controls.test.jsx`
- Modify: `dashboard/src/components/settings/Controls.jsx`
- Modify: `dashboard/src/components/settings/AppearanceSection.jsx`
- Modify: `dashboard/src/components/settings/MenuBarSection.jsx`
- Modify: `dashboard/src/components/settings/DataDirectoriesSection.jsx`
- Modify: `dashboard/src/components/settings/AgentPricingSection.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Modify: `dashboard/src/components/settings/ProviderApiConfigSection.jsx`
- Modify: `dashboard/src/components/settings/OtherAiSpendSection.jsx`
- Modify: `dashboard/src/pages/SettingsPage.jsx`

- [ ] **Step 1: Add the failing opt-in icon test**

Create `Controls.test.jsx`:

```jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Palette } from "lucide-react";
import { SectionCard } from "./Controls.jsx";

describe("SectionCard visual identity", () => {
  it("renders an optional semantic icon without changing iconless cards", () => {
    const { rerender } = render(
      <SectionCard title="外观" icon={Palette} iconTone="blue">
        <div>内容</div>
      </SectionCard>,
    );
    expect(screen.getByTestId("settings-section-icon")).toHaveAttribute("data-tone", "blue");
    expect(screen.getByTestId("settings-section-icon").querySelector("svg")).not.toBeNull();

    rerender(
      <SectionCard title="普通">
        <div>内容</div>
      </SectionCard>,
    );
    expect(screen.queryByTestId("settings-section-icon")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```powershell
npm --prefix dashboard test -- --run src/components/settings/Controls.test.jsx
```

Expected: FAIL because `SectionCard` does not accept or render `icon` and `iconTone`.

- [ ] **Step 3: Add the minimal shared icon API**

In `Controls.jsx`, add a fixed tone map:

```jsx
const SECTION_ICON_TONES = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  orange: "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
};
```

Extend `SectionCard` with `icon: Icon` and `iconTone = "blue"`. Render this immediately before the title content in both collapsible and non-collapsible headings:

```jsx
{Icon ? (
  <span
    data-testid="settings-section-icon"
    data-tone={iconTone}
    className={cn(
      "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
      SECTION_ICON_TONES[iconTone] || SECTION_ICON_TONES.blue,
    )}
  >
    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
  </span>
) : null}
```

Keep iconless callers unchanged.

- [ ] **Step 4: Assign the approved icons and tones**

Use existing Lucide imports where possible and add only the missing icon:

```jsx
<SectionCard title={...} icon={Monitor} iconTone="blue">
<SectionCard title={...} icon={Activity} iconTone="violet">
<SectionCard title={...} icon={FolderOpen} iconTone="green">
<SectionCard title={...} icon={DollarSign} iconTone="orange">
<SectionCard title={...} icon={Package} iconTone="violet">
<SectionCard title={...} icon={Sparkles} iconTone="rose">
```

For the limits card in `SettingsPage.jsx`, use `Gauge` with `iconTone="green"`.

`ProviderApiConfigSection` uses a custom card rather than `SectionCard`; wrap its existing `PlugZap` icon in the same blue `h-7 w-7 rounded-lg bg-blue-50 text-blue-600` tile. Do not alter its open state, actions, form, or API calls.

- [ ] **Step 5: Run settings tests**

Run:

```powershell
npm --prefix dashboard test -- --run src/components/settings/Controls.test.jsx src/pages/SettingsPage.test.jsx src/components/settings/TokenPlanSection.test.jsx src/components/settings/ProviderApiConfigSection.test.jsx src/components/settings/OtherAiSpendSection.test.jsx
```

Expected: PASS. Existing mocked `SectionCard` implementations continue accepting the props object and ignore the additional optional props; no functional assertion changes.

### Task 4: Apply the same hierarchy to cost accumulation

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`

- [ ] **Step 1: Add failing visual contracts**

Extend the contract test:

```jsx
expect(screen.getAllByTestId("cost-summary-icon")).toHaveLength(4);
expect(screen.getByTestId("cost-summary-icon-api")).toHaveAttribute("data-tone", "blue");
expect(screen.getByTestId("cost-summary-icon-subscription")).toHaveAttribute("data-tone", "violet");
expect(screen.getByTestId("cost-summary-icon-total")).toHaveAttribute("data-tone", "green");
expect(screen.getByTestId("cost-summary-icon-lifetime")).toHaveAttribute("data-tone", "orange");

const comparison = screen.getByTestId("monthly-cost-comparison-api");
expect(comparison).toHaveTextContent("较上月新增");
expect(comparison.parentElement).toHaveClass("justify-between");

for (const id of ["token-packages", "provider-api-accounts", "api-billing", "subscriptions"]) {
  expect(document.querySelector(`[data-cost-section="${id}"] [data-testid="cost-section-icon"]`))
    .not.toBeNull();
}
```

- [ ] **Step 2: Run the focused contract and verify failure**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx
```

Expected: FAIL because summary cards lack icon metadata, comparisons show percentage-only text, and section icons are plain gray.

- [ ] **Step 3: Implement semantic summary cards**

Add a fixed tone map and pass icon metadata from `CostSummaryCards`:

```jsx
const COST_ICON_TONES = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  orange: "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
};
```

Use `BarChart3`, `Package`, `CreditCard`, and `Globe` for API, subscription, monthly total, and lifetime total. Extend `SummaryCard` to render the icon tile before the label and keep the existing white card body and monthly-total highlight.

- [ ] **Step 4: Restore complete comparison copy on the same row**

In `formatDualAmount`, replace percentage-only output with:

```jsx
<span
  data-testid={`monthly-cost-comparison-${comparison.id}`}
  data-direction={comparison.kind}
  className={cn("whitespace-nowrap text-[9px] font-medium", comparison.className)}
>
  {comparison.label}
</span>
```

Keep compact CNY at the left and add `justify-between` to the shared metadata row. Remove unused comparison icon imports if no longer used.

- [ ] **Step 5: Style existing cost section icons**

Extend `FoldableSection` and `SectionHeader` with a tone passed by each existing section. Render each icon inside the same small semantic tile used by the summary. Preserve section order, local-storage keys, open state, counts, actions, and all children.

- [ ] **Step 6: Run the cost contract**

Run:

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx
```

Expected: PASS.

### Task 5: Full regression, installed-window acceptance, and 0.54.34 package

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `TokenTrackerBar/project.yml`
- Modify: `TokenTrackerWin/TokenTrackerWin.csproj`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Generate: `TokenTrackerWin/EmbeddedServer-0.54.34/`
- Generate: `src-tauri/target/release/bundle/nsis/Token Eyes_0.54.34_x64-setup.exe`
- Create: `.acceptance/verify-05434-ui.mjs`
- Generate: `.acceptance/ui-0.54.34/*.png`

- [ ] **Step 1: Run focused and full source verification**

Run:

```powershell
npm --prefix dashboard test -- --run
npm test
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
```

Expected: all suites pass with only repository-approved skips.

- [ ] **Step 2: Bump all product versions to 0.54.34**

Update every required version location in lockstep, including both `MARKETING_VERSION` entries and Tauri’s embedded runtime path. Verify:

```powershell
rg -n '0\.54\.(33|34)' package.json package-lock.json TokenTrackerBar/project.yml TokenTrackerWin/TokenTrackerWin.csproj src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
```

Expected: active version values and embedded runtime references are 0.54.34; no active 0.54.33 value remains in those files.

- [ ] **Step 3: Build dashboard, embedded runtime, and NSIS**

Run:

```powershell
npm run dashboard:build
npm run tauri:prepare-runtime
npm run tauri:build
```

Expected: `Token Eyes_0.54.34_x64-setup.exe` exists and Tauri reports a successful NSIS build.

- [ ] **Step 4: Validate the exact embedded runtime with real local data**

Start `TokenTrackerWin/EmbeddedServer-0.54.34/node.exe` with the embedded `bin/tracker.js serve --no-sync` on an unused loopback port. Use Playwright in `.acceptance/verify-05434-ui.mjs` to navigate the real routes and capture:

```text
overview-1115x810.png
usage-900x800.png
usage-1115x810.png
cost-1115x810.png
settings-basic-1115x810.png
settings-cost-1115x810.png
```

The script must assert:

- overview left column contains stats, trend, and model panels;
- monthly comparison text contains the existing full copy and stays in the same metadata row as compact CNY;
- request icon is in the value row and total cost has no separate dollar icon;
- cost summary contains four semantic icon tones;
- basic and cost settings show semantic section icons;
- no horizontal page overflow occurs at either viewport.

- [ ] **Step 5: Perform visual review against the approved A mockups**

Open all six screenshots and inspect them visually. Reject the build if any of these are present:

- large empty left overview column;
- overlapping CNY and comparison copy;
- month comparison on its own vertical line;
- duplicate dollar symbol or icon;
- full-card color blocks instead of restrained icon tiles;
- clipped settings actions, text, or scroll containers.

- [ ] **Step 6: Run installer smoke verification**

Use the repository’s installer-smoke command against `Token Eyes_0.54.34_x64-setup.exe`. Expected: temporary install, launch/runtime check, and uninstall all succeed without altering the user’s normal installed copy.

- [ ] **Step 7: Calculate delivery checksum**

Run:

```powershell
Get-FileHash -Algorithm SHA256 'src-tauri/target/release/bundle/nsis/Token Eyes_0.54.34_x64-setup.exe'
```

Expected: a non-empty SHA-256 value for the exact installer delivered to the user.
