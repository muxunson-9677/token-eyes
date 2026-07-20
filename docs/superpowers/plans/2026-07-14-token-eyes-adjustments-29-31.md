# Token Eyes Adjustments 29–31 Implementation Plan

> **For agentic workers:** Execute inline in the existing `provider-api` worktree. Do not mutate project-external files.

**Goal:** Fix clipped Chinese Token units, add a model-usage donut below the trend card, and make the Token Eyes workspace visibly adopt the approved Cockpit-inspired surface hierarchy.

**Architecture:** Keep the current data API and page information architecture. Fix character measurement in the reusable Counter, derive chart rows with a pure model-breakdown helper, render the donut as an accessible SVG component, and strengthen shared AppLayout/Card surfaces plus the two visible overview/cost page surfaces.

**Tech Stack:** React 18, Vite, Tailwind CSS, SVG, Vitest, Testing Library.

---

### Task 1: Counter Chinese unit width

**Files:**
- Modify: `dashboard/src/ui/components/Counter.jsx`
- Test: `dashboard/src/ui/components/__tests__/Counter.test.jsx`

- [x] Add a failing test asserting that `33.76亿` keeps a full-width static unit token and an unclipped root.
- [x] Run the focused test and confirm it fails against the current shared `digitStyle` override.
- [x] Separate numeric digit styling from static-token width and make the counter root max-width safe.
- [x] Re-run the focused test and the UsageOverview tests.

### Task 2: Model distribution data and donut

**Files:**
- Modify: `dashboard/src/lib/model-breakdown.ts`
- Modify: `dashboard/src/lib/model-breakdown.test.ts`
- Create: `dashboard/src/ui/dashboard/components/ModelUsageDonut.jsx`
- Create: `dashboard/src/ui/dashboard/components/__tests__/ModelUsageDonut.test.jsx`
- Modify: `dashboard/src/pages/DashboardPage.jsx`
- Modify: `dashboard/src/ui/dashboard/views/DashboardView.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [x] Add failing aggregation tests for cross-provider same-name models and top-five-plus-other behavior.
- [x] Implement `buildModelUsageDistribution` as a pure helper.
- [x] Add a failing component test for accessible chart title, total and legend.
- [x] Implement the SVG donut with Chinese Token formatting and empty state.
- [x] Wire the derived distribution below TrendMonitor without another network request.

### Task 3: Cockpit-inspired surface hierarchy

**Files:**
- Modify: `dashboard/src/ui/components/Sidebar.jsx`
- Modify: `dashboard/src/ui/components/Card.jsx`
- Modify: `dashboard/src/ui/dashboard/views/DashboardView.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageOverview.jsx`
- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`
- Test: `test/dashboard-layout-adjustments.test.js`

- [x] Add failing source-contract assertions for workspace wash, elevated main surface and interactive card state.
- [x] Implement a cool-gray workspace layer, stronger main content surface, consistent card radius/shadow and visible selected states.
- [x] Keep routine information as rows/dividers where cards do not improve interaction.
- [x] Run layout, overview and cost tests.

### Task 4: Verification and packaging

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-token-eyes-adjustments-29-31-design.md`

- [x] Run dashboard tests and typecheck.
- [x] Run Node tests excluding only missing-workflow baseline contracts; isolate `CODEX_HOME` for credential-sensitive usage-limit suites.
- [x] Run copy, UI hardcode, architecture and diff checks.
- [x] Build Tauri and NSIS, record path, size and SHA-256.
- [x] Mark requirements 29–31 with truthful completion status.

Build artifact: `src-tauri/target/release/bundle/nsis/Token Eyes_0.54.0_x64-setup.exe` (34.03 MB, SHA-256 `DBBD82A65779DCC2D3D15C41BA6C1F7985EC8CF989C1C754B34F0E66FA553850`).
