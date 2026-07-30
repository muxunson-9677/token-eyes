# Widget Active Window and Reset Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a saved 1-hour-to-3-day active-session range for the floating widget and a compact 30-day interval summary for official reset history.

**Architecture:** Store a validated window key in the existing Tauri widget preferences, send it through the existing local widget API, and normalize it again in the shared view-model builder. Keep reset calculations in a pure dashboard helper so the statistics and edge cases are independently testable.

**Tech Stack:** Rust/Tauri 2, CommonJS Node.js local API, React 18, TypeScript, Vitest, Node test runner.

---

### Task 1: Persist and normalize the widget active-session range

**Files:**
- Modify: `src-tauri/src/widget_window.rs`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `test/windows-widget-contract.test.js`

- [ ] **Step 1: Write failing Rust and contract tests**

Assert that defaults and invalid values resolve to `1h`, valid `3d` survives normalization, display preference merging copies the value, and the TypeScript preference contract contains `activeSessionWindow`.

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
cargo test widget_window --manifest-path src-tauri/Cargo.toml --lib
node --test test/windows-widget-contract.test.js
```

Expected: failures because the preference field and schema version do not exist.

- [ ] **Step 3: Implement the preference field**

Add `active_session_window: String`, default it to `1h`, normalize through the exact allowlist `["1h", "3h", "5h", "1d", "3d"]`, copy it in `merge_display_prefs`, increment the preference schema version, and add the matching TypeScript union.

- [ ] **Step 4: Verify the tests pass**

Run the same Rust and Node commands and expect zero failures.

### Task 2: Apply the selected range to widget session status

**Files:**
- Modify: `src/lib/widget-view-model.js`
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/hooks/use-desktop-widget.ts`
- Test: `test/widget-view-model.test.js`
- Test: `test/local-api-desktop-widget.test.js`
- Test: `dashboard/src/hooks/__tests__/use-desktop-widget.test.tsx`

- [ ] **Step 1: Write failing data-flow tests**

Cover the one-hour default, a session included by `3h` but excluded by `1h`, invalid query fallback to `1h`, API query serialization, restored preference refresh, and polling with the current preference.

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
node --test test/widget-view-model.test.js test/local-api-desktop-widget.test.js
npm --prefix dashboard run test -- --run src/hooks/__tests__/use-desktop-widget.test.tsx
```

Expected: failures showing the range is not yet passed through.

- [ ] **Step 3: Implement the validated data flow**

Define the five window durations in the CommonJS view model, accept `activeSessionWindow`, add `active_window` to the local API query, and make the hook refresh with both selected agent and saved window.

- [ ] **Step 4: Verify the tests pass**

Run the same commands and expect zero failures.

### Task 3: Add the range selector to the Widgets settings page

**Files:**
- Modify: `dashboard/src/pages/WidgetsPage.jsx`
- Modify: `dashboard/src/pages/WidgetsPage.test.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `dashboard/src/content/i18n/zh/dashboard.json`

- [ ] **Step 1: Write a failing interaction test**

Restore a legacy preference without the field, expect `1h`, select `3d`, verify no native save occurs before the existing Save-and-sync button, then verify the save payload contains `activeSessionWindow: "3d"`.

- [ ] **Step 2: Verify the test fails**

Run:

```powershell
npm --prefix dashboard run test -- --run src/pages/WidgetsPage.test.jsx
```

Expected: failure because the select does not exist.

- [ ] **Step 3: Implement the compact selector**

Add a draft window state beside the existing project draft, render one labeled select with the five approved choices, include it in the existing save payload, and add copy registry entries.

- [ ] **Step 4: Verify the test passes**

Run the same Vitest command and expect zero failures.

### Task 4: Add compact 30-day reset statistics

**Files:**
- Create: `dashboard/src/lib/reset-history-stats.ts`
- Create: `dashboard/src/lib/reset-history-stats.test.ts`
- Modify: `dashboard/src/pages/ResetHistoryPage.tsx`
- Modify: `dashboard/src/pages/ResetHistoryPage.test.tsx`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `dashboard/src/content/i18n/zh/dashboard.json`

- [ ] **Step 1: Write failing calculation and rendering tests**

Use four events with known gaps to assert count, average, shortest, longest, 30-day filtering, invalid-date filtering, and the fewer-than-two-events empty interval state. Assert the page renders one compact statistics strip before the timeline.

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
npm --prefix dashboard run test -- --run src/lib/reset-history-stats.test.ts src/pages/ResetHistoryPage.test.tsx
```

Expected: failure because the helper and statistics strip do not exist.

- [ ] **Step 3: Implement calculation, formatting, and UI**

Create a pure `calculateResetStatistics(events, nowMs)` helper, add a compact duration formatter using copy keys, filter the displayed timeline to the same 30-day boundary, and render five restrained values above the history heading.

- [ ] **Step 4: Verify the tests pass**

Run the same Vitest command and expect zero failures.

### Task 5: Version, full verification, and installer

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `TokenTrackerBar/project.yml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

- [ ] **Step 1: Bump all desktop/runtime versions to `0.54.32`**

Keep all required version values identical.

- [ ] **Step 2: Run full verification**

```powershell
npm run ci:local
git diff --check
```

Expected: all tests, builds, copy validation, hardcode validation, guardrails, and diff checks pass.

- [ ] **Step 3: Build and verify the Windows installer**

```powershell
npm run tauri:build
```

Expected: Tauri release build, bundled runtime smoke, installed runtime smoke, and NSIS packaging all pass, producing `Token Eyes_0.54.32_x64-setup.exe`.
