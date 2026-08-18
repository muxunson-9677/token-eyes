# Cost Page Stability and Token Plan Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate cost-page collapse jumps, present up to ten usable Token plans as a five-column compact grid, surface expired paid plans in subscription history, separate active and expired plans in cost settings, and remove the subscription comparison background.

**Architecture:** Keep Token plans as the single source of truth. The cost hook derives read-only subscription-list rows from paid Token plans instead of writing duplicate spend records; the cost overview filters expired plans while settings retains both lifecycle groups. Foldable sections keep details mounted in an animated overflow container and preserve the scroll anchor during height changes.

**Tech Stack:** React 18, Vitest and Testing Library, Vite, Tailwind plus route-scoped CSS, existing local API contracts.

---

### Task 1: Lock the lifecycle and density contracts with failing tests

**Files:**
- Modify: `dashboard/src/hooks/use-cost-accumulation.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/TokenServiceList.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- Modify: `test/dashboard-layout-adjustments.test.js`

- [ ] Add a hook test proving a paid Token plan appears once in `subscriptionRecords`, carries `origin: "token_plan"`, becomes `expired` from its end/expiry date, and does not require a duplicate spend record.
- [ ] Add TokenServiceList tests proving `pageSize={10}` renders ten active plans, filters expired plans, and paginates the eleventh.
- [ ] Add cost-section tests proving the embedded plan list uses the compact-grid contract and derived subscription rows are read-only.
- [ ] Add settings tests proving active plans render full details while expired plans live in a collapsed expired group with an explicit expired label.
- [ ] Add a CSS contract test for five columns, at most two visible rows, animated details, stable scroll handling, and text-only subscription comparison.
- [ ] Run the targeted tests and confirm each new assertion fails for the missing behavior.

### Task 2: Derive Token-plan subscription history without duplicate costs

**Files:**
- Modify: `dashboard/src/hooks/use-cost-accumulation.js`
- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] Add pure expiry/status helpers using `subscription_end_date` first and `expires_at` as the fallback.
- [ ] Merge eligible paid Token plans into `subscriptionRecords` as deterministic read-only rows while preserving manually recorded subscriptions.
- [ ] Mark derived rows as Token-plan records and suppress edit/delete actions so the UI cannot call spend-record CRUD for synthetic IDs.
- [ ] Add registered copy for the Token-plan source label and expired-plan grouping.
- [ ] Run hook and cost-component tests until green.

### Task 3: Build the five-column, ten-card active-plan grid

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/TokenServiceList.jsx`
- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`
- Modify: `dashboard/src/ui/foundation/apple-glass.css`
- Test: `dashboard/src/ui/dashboard/components/TokenServiceList.test.jsx`
- Test: `dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx`

- [ ] Add a `pageSize` prop with the existing list default unchanged.
- [ ] Configure the cost overview to paginate ten active plans per page.
- [ ] Apply a route-scoped five-column compact card grid; retain every quota window, reset time, status, and validity field without changing the usage-detail list.
- [ ] Keep pagination controls visible only when more than ten active plans exist.
- [ ] Run TokenServiceList and cost-component tests until green.

### Task 4: Separate active and expired plans in cost settings

**Files:**
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `dashboard/src/ui/foundation/apple-glass.css`

- [ ] Split loaded records with one shared expiry helper.
- [ ] Render active plans with full quota, cost, sync, and validity details.
- [ ] Render expired plans inside a default-collapsed group; when opened, show compact provider/plan/end-date/cost rows with an explicit expired status.
- [ ] Keep edit/delete ownership in Token-plan settings and preserve drag ordering for active plans.
- [ ] Run settings tests until green.

### Task 5: Remove the comparison background and stabilize fold transitions

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`
- Modify: `dashboard/src/ui/foundation/apple-glass.css`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx`
- Modify: `test/dashboard-layout-adjustments.test.js`

- [ ] Keep fold details mounted inside a grid-row transition container with reduced-motion fallback and no focusable hidden controls.
- [ ] Preserve the clicked header's viewport position through expand/collapse and prevent scroll-range disappearance from forcing an instantaneous reset.
- [ ] Keep section title, count, and four summary metrics geometrically identical in both states.
- [ ] Remove the subscription comparison background, border radius, and extra padding while retaining green text and the same structure as the left card.
- [ ] Run component and layout-contract tests until green.

### Task 6: Two-pass acceptance and production verification

**Files:**
- No production files beyond the tasks above.
- Evidence: repository-local screenshots and measurement output only.

- [ ] Run targeted Vitest suites, root layout/provider tests, dashboard typecheck, lint, production build, copy validation, guardrails, and `git diff --check`.
- [ ] First pass: verify each approved requirement at the real desktop viewport with 0, 1, 2, 5, and 10 active plans plus expired plans.
- [ ] Exercise normal mouse input through expand, scroll, collapse, reopen, pagination, and settings expired-group toggling; compare element rectangles and scroll offsets before/after.
- [ ] Second independent pass: use a different dense fixture including 11 plans, long labels, stale/error states, and mixed expiry dates; inspect screenshots for clipping, jump, overflow, inconsistent height, and misleading status.
- [ ] Build and run the actual Tauri production runtime only after source-level acceptance passes. Do not create an installer until the user asks for a new preview package.
- [ ] Re-read the acceptance matrix and report any remaining gap; do not claim completion while a row lacks real evidence.

No commit, push, merge, or installer step is included because the user has not authorized those actions for this checkpoint.
