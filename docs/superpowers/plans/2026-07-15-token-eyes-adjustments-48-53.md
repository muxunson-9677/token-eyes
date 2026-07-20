# Token Eyes Adjustments 48–53 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the six installation-visible regressions and ship a locally verified Windows installer.

**Architecture:** Fix each behavior at its actual consumer boundary: usage cards in `UsageStatsPanel`, account/session behavior in the Tauri session layer plus token-plan UI, nested spend groups through the existing two-level API, data discovery in the shared directory resolver and parsers, and model catalog rendering through a curated catalog merged with observed models. Third-party data remains read-only and no external application is modified.

**Tech Stack:** React 18, Vitest/Testing Library, Node.js CommonJS/node:test, Rust/Tauri 2, NSIS.

---

### Task 1: Correct monthly comparisons on usage cards

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx`

- [ ] Add a failing test asserting API, subscription, and combined comparisons exist in the CNY row and not the heading row.
- [ ] Run the focused Vitest file and confirm the new assertion fails.
- [ ] Add previous-period field mapping for the three monthly cards and render comparison beside CNY.
- [ ] Run the focused test and confirm it passes.

### Task 2: Replace Cursor blank-window flow with verifiable session paths

**Files:**
- Modify: `src-tauri/src/cursor_session.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`

- [ ] Add Rust tests for timeout/close behavior and accepted official callback/session states.
- [ ] Add UI tests that a failed/blocked session leaves no indefinite “登录中” state.
- [ ] Run focused Rust and Vitest tests to confirm failure.
- [ ] Implement the smallest official-session/system-browser flow supported by current Cursor state, with automatic close and explicit failure codes.
- [ ] Run focused tests and a manual window lifecycle smoke check.

### Task 3: Add usage-only multi-account bindings

**Files:**
- Modify: `src/lib/subscriptions.js`
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Modify: `test/token-plans-api.test.js`
- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`

- [ ] Add failing API tests for two accounts of one provider and per-plan `account_id` binding.
- [ ] Add failing UI tests for add/select/remove account without launch/switch controls.
- [ ] Implement local account records and plan binding with backward-compatible migration.
- [ ] Run focused API and UI tests.

### Task 4: Make second-level spend groups visible and droppable

**Files:**
- Modify: `dashboard/src/components/settings/OtherAiSpendSection.jsx`
- Modify: `dashboard/src/components/settings/OtherAiSpendSection.test.jsx`
- Modify: `test/spend-records-api.test.js`

- [ ] Add a failing UI test for “新增子分组” inside a root group and dragging a record into it.
- [ ] Confirm the focused test fails for the missing action.
- [ ] Add the per-root-group action, nested collapse state, and nested drop target.
- [ ] Run focused UI and API tests.

### Task 5: Diagnose and fix Trae/CodeBuddy data discovery

**Files:**
- Modify: `src/lib/data-directories.js`
- Modify: `src/lib/rollout.js`
- Modify: `dashboard/src/components/settings/DataDirectoriesSection.jsx`
- Modify: `test/data-directories.test.js`
- Modify: `test/agent-adapters.test.js`

- [ ] Record read-only evidence for the selected install paths and their actual user-data candidates.
- [ ] Add failing resolver tests for non-system-drive `Programs\\Trae CN` and `Programs\\CodeBuddy CN` paths.
- [ ] Add parser fixtures only for observed, explicit token fields; add capability-state tests for encrypted/metadata-only databases.
- [ ] Implement resolver/parser/status changes without estimates.
- [ ] Run focused Node and dashboard tests.

### Task 6: Expand pricing catalog and mark observed new models

**Files:**
- Modify: `dashboard/src/components/settings/AgentPricingSection.jsx`
- Modify: `dashboard/src/components/settings/AgentPricingSection.test.jsx`
- Modify: `src/lib/pricing/curated-overrides.json` only for officially verified prices needed by cost calculation

- [ ] Add a failing test covering every screenshot model and an observed unknown model badge.
- [ ] Verify official pricing sources and distinguish verified from unverified catalog rows.
- [ ] Implement the complete display catalog and merge observed model IDs.
- [ ] Run focused pricing tests and parity validation when curated overrides change.

### Task 7: Full verification and installer

**Files:**
- Modify: `package.json` and Tauri version files only if a patch-version bump is required by packaging.

- [ ] Run focused tests for all six tasks.
- [ ] Run the complete dashboard and Node test suites.
- [ ] Run `cargo test` for the Tauri library/affected session modules.
- [ ] Build the dashboard and Tauri NSIS installer.
- [ ] Verify installer existence, size, timestamp, version metadata, and SHA-256.
- [ ] Re-read the 48–53 spec and report each acceptance result separately.
