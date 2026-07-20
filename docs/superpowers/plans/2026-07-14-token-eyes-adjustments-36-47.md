# Token Eyes Adjustments 36–47 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the confirmed Token Eyes grouping, navigation, provider balance, data discovery, pricing, service ordering, icon, cost comparison, and installer requirements without touching project-external software.

**Architecture:** Extend the existing local-first APIs with a two-level group relation and persistent display-order settings. Keep provider balance parsing provider-specific, preserve the existing successful Aliyun RAM flow, and keep all UI changes within the current React/Tauri surfaces. Derive pricing and cost summaries from canonical project data rather than duplicated UI values.

**Tech Stack:** CommonJS Node local API, React 18/Vite/Tailwind, dnd-kit, Tauri 2 Rust/WebView2, Node test runner, Vitest/Testing Library.

---

### Task 1: Freeze adjustment contracts and reproduce regressions

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-token-eyes-adjustments-36-47-design.md`
- Modify: `dashboard/src/components/settings/OtherAiSpendSection.test.jsx`
- Modify: `dashboard/src/components/settings/ProviderApiConfigSection.test.jsx`
- Modify: `dashboard/src/ui/components/__tests__/Sidebar.nav.test.jsx`
- Modify: `test/provider-api-balance.test.js`

- [ ] Add failing tests proving nested group collapse, drag-to-group, inline editing, sidebar manual collapse, fixed provider actions including refresh, and Aliyun success/error exclusivity.
- [ ] Run the focused tests and confirm each failure is caused by the missing behavior rather than test setup.

### Task 2: Implement nested spend groups and inline editing

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/components/settings/OtherAiSpendSection.jsx`
- Modify: `test/spend-records-api.test.js`
- Modify: `dashboard/src/components/settings/OtherAiSpendSection.test.jsx`

- [ ] Add failing API tests for `parent_id`, depth validation, safe parent deletion, cross-group reorder, and persistence.
- [ ] Run `node --test test/spend-records-api.test.js` and verify RED.
- [ ] Implement the minimal normalized two-level group schema and atomic record move/reorder contract.
- [ ] Run the Node test and verify GREEN.
- [ ] Implement nested sortable group rendering, collapsible headers, drop targets, and row-local editors.
- [ ] Run `npm --prefix dashboard exec vitest run src/components/settings/OtherAiSpendSection.test.jsx` and verify GREEN.

### Task 3: Restore navigation and add directory ordering/discovery

**Files:**
- Modify: `dashboard/src/ui/components/Sidebar.jsx`
- Modify: `dashboard/src/ui/components/Sidebar.test.jsx`
- Modify: `src/lib/data-directories.js`
- Modify: `src/lib/rollout.js`
- Modify: `dashboard/src/components/settings/DataDirectoriesSection.jsx`
- Modify: `dashboard/src/components/settings/DataDirectoriesSection.test.jsx`
- Modify: `test/data-directories.test.js`
- Modify: `test/agent-adapters.test.js`

- [ ] Add failing tests for manual parent-nav collapse persistence, TRAE/CodeBuddy installation-to-data resolution, readable usage fixtures, and directory display order.
- [ ] Run focused Node and Vitest tests and verify RED.
- [ ] Implement explicit sidebar disclosure state that is not overwritten by active-route auto expansion.
- [ ] Implement Windows data-root candidates and installation-directory resolution without treating installation as readable usage.
- [ ] Add sortable directory rows with a local display-order setting.
- [ ] Re-run focused tests and verify GREEN.

### Task 4: Simplify provider rows and remove the Aliyun false error

**Files:**
- Modify: `src/lib/provider-api-balance.js`
- Modify: `src/lib/provider-api-configs.js`
- Modify: `dashboard/src/components/settings/ProviderApiConfigSection.jsx`
- Modify: `dashboard/src/components/settings/ProviderApiConfigSection.test.jsx`
- Modify: `test/provider-api-balance.test.js`

- [ ] Add an Aliyun fixture where `Data.AvailableAmount` is valid while optional generic spend paths are absent; assert successful balance has no response-format error.
- [ ] Run the provider tests and verify RED.
- [ ] Stop optional missing fields from overriding a valid required balance result; preserve the working Aliyun signed request and RAM credentials.
- [ ] Replace per-row disclosure with a two-line aligned grid whose first line keeps test, refresh, edit, and delete actions.
- [ ] Hide unsupported optional metrics instead of presenting them as failed automatic queries.
- [ ] Run focused Node and Vitest tests and verify GREEN.

### Task 5: Pricing table, provider assets, and service ordering

**Files:**
- Modify: `dashboard/src/components/settings/AgentPricingSection.jsx`
- Modify: `dashboard/src/components/settings/AgentPricingSection.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/ProviderIcon.jsx`
- Create: `dashboard/src/assets/providers/SOURCES.md`
- Modify: `dashboard/src/ui/dashboard/components/TokenServiceList.jsx`
- Modify: `dashboard/src/ui/dashboard/components/TokenServiceList.test.jsx`
- Modify: `src/lib/pricing/curated-overrides.json`

- [ ] Add failing tests for the “模型定价表” disclosure/table columns, peak tags sourced from explicit metadata, official asset mapping, and unfinished-before-exhausted service ordering.
- [ ] Run focused tests and verify RED.
- [ ] Implement the read-only pricing table from canonical price data and keep custom overrides separate.
- [ ] Add only verified official provider assets and record each source URL in `SOURCES.md`.
- [ ] Implement the exact non-expired service sort tuple: unfinished first, used descending, then exhausted, used descending.
- [ ] Re-run focused tests and verify GREEN.

### Task 6: Add category-specific month-over-month comparisons

**Files:**
- Modify: `dashboard/src/pages/SpendPage.jsx`
- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx`
- Modify: `dashboard/src/pages/SpendPage.test.jsx`

- [ ] Add failing tests for API, subscription, and combined previous-month values and the CNY-line placement.
- [ ] Run the focused tests and verify RED.
- [ ] Compute all three comparisons from the same current/previous month aggregation and currency basis.
- [ ] Render the rate beside CNY; render “本月新增” for a zero previous-month denominator.
- [ ] Re-run focused tests and verify GREEN.

### Task 7: Adversarial verification and installer

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-token-eyes-adjustments-36-47-design.md`

- [ ] Run all focused Node and Dashboard tests for tasks 1–6.
- [ ] Run the complete Dashboard test suite, TypeScript check, production build, copy validation, UI hardcode validation, and guardrails.
- [ ] Run the relevant complete Node test suite and Tauri Rust tests.
- [ ] Build the Tauri NSIS release installer inside `src-tauri/target/release/bundle/nsis`.
- [ ] Record the installer path, byte size, and SHA-256 in the design document only after all commands exit successfully.
- [ ] Update every adjustment status with fresh verification evidence and report completed versus remaining items.
