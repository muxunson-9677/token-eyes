# Token Eyes Adjustments 14–21 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and verify leaderboard, Token service list, usage layout, Token plan interaction, and Windows startup requirements 14–21 without changing anything outside the Token Eyes repository.

**Architecture:** Keep the local-first application boundary intact. Leaderboard aggregation remains server-authored and gains stable summary fields while the client renders compact per-user `agent_metrics`; Token-plan order is persisted atomically through the local API; route-level code splitting removes cloud-only work from the desktop startup path. Existing data formats remain readable through explicit fallbacks and migration defaults.

**Tech Stack:** React 18, React Router 7, Vitest/Testing Library, Node.js CommonJS local API, SQL/InsForge edge patches, Tauri 2/Rust, Vite 7, Playwright/PowerShell startup verification.

---

## Scope and file map

- Leaderboard UI/data: `dashboard/src/pages/LeaderboardPage.jsx`, its tests, `dashboard/src/lib/leaderboard-agent-metrics.js`, leaderboard RPC/Edge SQL and contract tests.
- Desktop navigation: `dashboard/src/App.jsx`, `dashboard/src/App.routes.test.jsx`, leaderboard rule-page tests.
- Token service list and statistics layout: `TokenServiceList.jsx`, `SpendPage.jsx`, `DashboardView.jsx`, and focused component/page tests.
- Token-plan persistence and interaction: `src/lib/local-api.js`, `dashboard/src/lib/api.ts`, `TokenPlanSection.jsx`, `SettingsPage.jsx`, and API/component/route tests.
- Startup: `dashboard/src/main.jsx`, auth provider/config modules, `dashboard/src/App.jsx`, `dashboard/vite.config.*`, a repository-contained benchmark script, and Tauri release output.
- Progress tracking: `docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md`.

## Task 1: Per-user Agent distribution and compact leaderboard rows (item 14)

**Status:** Completed and verified on 2026-07-14.

**Files:**
- Create: `dashboard/src/lib/leaderboard-agent-metrics.js`
- Create: `dashboard/src/lib/__tests__/leaderboard-agent-metrics.test.js`
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: `dashboard/src/pages/LeaderboardPage.test.jsx`
- Delete after callers are removed: `dashboard/src/components/LeaderboardProviderColumnHeader.jsx`, `dashboard/src/components/LeaderboardProviderColumnHeader.test.jsx`
- Modify or delete after callers are removed: `dashboard/src/lib/leaderboard-columns.js`, `dashboard/src/lib/__tests__/leaderboard-columns.test.js`

- [ ] **Step 1: Write failing normalization tests**

Add tests for this public API:

```js
normalizeAgentMetrics({
  agent_metrics: {
    codex: { with_cache_tokens: 30, without_cache_tokens: 10 },
    claude: { with_cache_tokens: 0, without_cache_tokens: 0 },
    cursor: { with_cache_tokens: 20, without_cache_tokens: 15 },
  },
}, "with_cache")
// => [{ id: "codex", tokens: 30 }, { id: "cursor", tokens: 20 }]
```

Cover descending order, zero omission, `without_cache`, and legacy fallback fields.

- [ ] **Step 2: Verify RED**

Run: `npm --prefix dashboard test -- src/lib/__tests__/leaderboard-agent-metrics.test.js`

Expected: FAIL because `leaderboard-agent-metrics.js` does not exist.

- [ ] **Step 3: Implement the minimal normalizer**

Export `normalizeAgentMetrics(entry, metric)` and a stable display-label map. Return only finite positive values, sort descending, and use legacy columns only when `agent_metrics` is absent.

- [ ] **Step 4: Write and verify failing page tests**

Assert that the top Agent tabs and fixed Agent headers are absent; a user with Codex and Cursor renders only those two labels and no zero-value Claude label; metric and date controls remain present.

Run: `npm --prefix dashboard test -- src/pages/LeaderboardPage.test.jsx`

Expected: FAIL on the old top tabs/fixed columns.

- [ ] **Step 5: Replace the wide table**

Remove horizontal DnD/column-order imports and render columns `rank`, `user`, `agent distribution`, `total token`, `estimated cost`. The new client must always request `agent: "all"`, while query parsing remains backward compatible.

- [ ] **Step 6: Verify GREEN and remove orphans**

Run both focused test files and delete only files/imports made unused by this change.

## Task 2: Stable leaderboard summaries (item 15)

**Status:** Completed and verified on 2026-07-14.

**Files:**
- Modify: `scripts/ops/leaderboard-ranking-rpc.sql`
- Modify: `dashboard/edge-patches/tokentracker-leaderboard.ts`
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: `dashboard/src/pages/LeaderboardPage.test.jsx`
- Modify: `test/leaderboard-ranking-contract.test.js`
- Modify: leaderboard mock fixture that supplies summary fields.

- [ ] **Step 1: Write failing contract tests**

Require the RPC/Edge response to include:

```json
{
  "participant_count": 2,
  "ranked_entry_count": 1,
  "aggregate_total_tokens": 300,
  "aggregate_total_cost_usd": 4.25
}
```

Participant count is based on users with positive Token usage, independent of ranking metric; `ranked_entry_count` drives pagination.

- [ ] **Step 2: Verify RED**

Run: `node --test test/leaderboard-ranking-contract.test.js`

Expected: FAIL because cost and ranked-entry fields are missing.

- [ ] **Step 3: Add SQL/Edge aggregation**

Compute the two aggregates from the same eligible snapshot CTE and return them without repurposing `total_score`.

- [ ] **Step 4: Add failing UI summary tests, then implement**

Test and render three compact facts: total participants, cumulative Token, cumulative estimated spend. Use `total_entries = ranked_entry_count` for page count and retain safe fallbacks for old snapshots.

- [ ] **Step 5: Verify GREEN**

Run the contract and leaderboard page tests.

## Task 3: Desktop leaderboard return route (item 16)

**Status:** Completed and verified on 2026-07-14.

**Files:**
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/App.routes.test.jsx`
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: `dashboard/src/pages/LeaderboardPage.test.jsx`
- Modify: `dashboard/src/pages/LeaderboardRulesPage.jsx`
- Modify: `dashboard/src/pages/LeaderboardRulesPage.test.jsx`

- [ ] **Step 1: Write failing route tests**

In native/hash-router mode, assert `/leaderboard` and `/leaderboard/rules` render inside `AppLayout`. Assert the explicit return control targets `/dashboard`; anonymous public routes remain readable.

- [ ] **Step 2: Verify RED**

Run: `npm --prefix dashboard test -- src/App.routes.test.jsx src/pages/LeaderboardPage.test.jsx src/pages/LeaderboardRulesPage.test.jsx`

Expected: FAIL because leaderboard is excluded from `showSidebar` and lacks the link.

- [ ] **Step 3: Implement minimal host-aware navigation**

Include leaderboard index/rules in desktop `showSidebar`, keep profile/public standalone behavior, and use `<Link to="/dashboard">` instead of history back.

- [ ] **Step 4: Verify GREEN**

Run the same focused suite and confirm no auth gate was introduced.

## Task 4: Token service filtering, naming, and layout (items 17–18)

**Status:** Completed and verified on 2026-07-14.

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/TokenServiceList.jsx`
- Modify: `dashboard/src/ui/dashboard/components/TokenServiceList.test.jsx`
- Modify: `dashboard/src/pages/SpendPage.jsx`
- Modify: `dashboard/src/pages/SpendPage.test.jsx`
- Modify: `dashboard/src/ui/dashboard/views/DashboardView.jsx`
- Modify: the closest DashboardView test or create `dashboard/src/ui/dashboard/views/DashboardView.test.jsx`

- [ ] **Step 1: Write failing Token service tests**

Use records for success, failed, unconfigured, exhausted, expired, and valid manual plans. Assert only successful/valid manual non-expired plans render; exhausted remains. Assert visible labels are `xiaomi` + `Standard` and `Codex` + `Plus`, with plan text styled as secondary metadata.

- [ ] **Step 2: Verify RED**

Run: `npm --prefix dashboard test -- src/ui/dashboard/components/TokenServiceList.test.jsx`

- [ ] **Step 3: Implement the filter and label resolver**

Add small pure helpers local to the component: automatic records require `last_refresh_status === "success"`; manual records require a non-empty service/source and positive quota; all records exclude expired dates. Preserve used-descending sort and five-per-page pagination.

- [ ] **Step 4: Write failing layout/duplication tests**

Assert `DashboardView` no longer mounts `RequestUsageLog`; assert the lower SpendPage grid uses the same `13rem` right column as `UsageStatsPanel` and remains one-column below `lg`.

- [ ] **Step 5: Verify RED, implement, and verify GREEN**

Delete the duplicate import/render and change the lower grid from `17rem` to `13rem`. Tighten only Token-service internal spacing needed to avoid clipping.

Run: `npm --prefix dashboard test -- src/pages/SpendPage.test.jsx src/ui/dashboard/components/TokenServiceList.test.jsx`

## Task 5: Atomic Token-plan order persistence (item 19 backend)

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `test/token-plans-api.test.js`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/api.test.ts`

- [ ] **Step 1: Write failing API tests**

Create three plans, call `PUT /functions/tokentracker-token-plans-order` with `{ ids: ["c", "a", "b"] }`, then assert GET returns that order with `display_order` 0/1/2. Add rejection tests for duplicate, missing, and unknown IDs and verify the stored file is unchanged after rejection.

- [ ] **Step 2: Verify RED**

Run: `node --test test/token-plans-api.test.js`

- [ ] **Step 3: Implement minimal normalization and atomic endpoint**

Preserve `display_order` in normalized records; migrate old arrays by index; validate the submitted ID set exactly equals the stored ID set; write once through the existing atomic JSON persistence path.

- [ ] **Step 4: Add dashboard API client through TDD**

Expose `reorderTokenPlans(ids: string[])` using the new endpoint and verify URL/method/body in `api.test.ts`.

- [ ] **Step 5: Verify GREEN**

Run Node API and dashboard API tests.

## Task 6: Collapsible, sortable Token-plan cards (item 19 frontend)

**Files:**
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.collapsible.test.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`

- [ ] **Step 1: Write failing collapsed-card tests**

Assert initial cards show drag handle, Agent/service, plan, and gray usage only; details such as note/sync timestamp/live quota are absent until the named expand button is activated. Assert `aria-expanded` changes.

- [ ] **Step 2: Verify RED**

Run: `npm --prefix dashboard test -- src/components/settings/TokenPlanSection.collapsible.test.jsx`

- [ ] **Step 3: Implement collapsed details**

Keep an `expandedPlanIds` set and move existing detailed markup behind the expanded branch. Do not duplicate form or sync logic.

- [ ] **Step 4: Write failing sortable tests**

Use keyboard movement through `@dnd-kit/sortable`; assert optimistic order, `reorderTokenPlans([id...])`, persisted reload order, and rollback/error message on rejection.

- [ ] **Step 5: Implement vertical sortable context and verify GREEN**

Use `verticalListSortingStrategy`, a dedicated handle, and `arrayMove`. Reuse the server response as canonical order after success.

## Task 7: Token-plan child routes (item 20)

**Files:**
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/pages/SettingsPage.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Create: `dashboard/src/pages/TokenPlanEditorPage.jsx`
- Create: `dashboard/src/pages/TokenPlanEditorPage.test.jsx`
- Modify: `dashboard/src/App.routes.test.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`

- [ ] **Step 1: Write failing navigation tests**

Assert “新增套餐” navigates to `/settings/cost/token-plans/new`, edit to `/settings/cost/token-plans/:id/edit`, and the list page no longer contains the editor form.

- [ ] **Step 2: Verify RED**

Run the Settings/TokenPlan route and component tests.

- [ ] **Step 3: Extract the existing editor without duplicating behavior**

Move the current form body into a reusable editor component or child page API. The child page loads by route ID, keeps secrets out of URL/state, and returns to `/settings/cost` after successful save or cancel. Missing ID renders an error plus return link.

- [ ] **Step 4: Verify GREEN**

Cover create, edit, cancel, failed-save preservation, refresh on edit route, and nonexistent ID.

## Task 8: Measured Windows startup optimization and release EXE (item 21)

**Files:**
- Create: `scripts/benchmark-token-eyes-startup.ps1`
- Create: `test/token-eyes-startup-contract.test.js`
- Modify: `dashboard/src/main.jsx`
- Modify: `dashboard/src/contexts/InsforgeAuthContext.jsx`
- Modify: `dashboard/src/lib/insforge-config.ts`
- Modify: `dashboard/src/App.jsx`
- Modify: Vite configuration only if manual chunking is needed after route-level lazy loading.
- Modify: `docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md`

- [ ] **Step 1: Add a failing startup contract**

Assert local desktop entry does not statically import `@insforge/sdk`, analytics, speed insights, login modal, or command palette into the synchronous `main.jsx` path; preserve the eager `NativeAuthCallbackPage` invariant from `CLAUDE.md`.

- [ ] **Step 2: Verify RED**

Run: `node --test test/token-eyes-startup-contract.test.js`

- [ ] **Step 3: Capture the baseline inside the repository**

Build release and run the benchmark for 10 starts. The script may launch only the repository-built `src-tauri/target/release/token-eyes.exe`, records process creation/window-handle timestamps to a repository-local JSON file, and closes only the process IDs it launched. It must never inspect or control CC Switch.

- [ ] **Step 4: Split cloud-only work**

Dynamically load the InsForge client/provider after the local shell is interactive or when a cloud-only route/login action needs it. Lazy-load command palette and analytics. Keep `NativeAuthCallbackPage` eagerly imported and add a regression assertion for OAuth callback capture order.

- [ ] **Step 5: Build and verify bundle evidence**

Run `npm --prefix dashboard run build`; record initial chunk size before/after. Re-run focused auth/callback/navigation tests.

- [ ] **Step 6: Benchmark the optimized release**

Rebuild Tauri release and run 10 daily starts. Pass only when P95 visible ≤1s, P95 visible-to-interactive ≤500ms, and total ≤1.5s. If system-level WebView2/Defender dominates, report the measured gap instead of marking complete.

- [ ] **Step 7: Full verification and installer**

Run focused Node/Vitest tests, `npm run dashboard:build`, `npm run validate:copy`, `npm run validate:guardrails`, `git diff --check`, and the Tauri release/NSIS build. Update items 14–21 individually with evidence and deliver the new repository-contained installer plus SHA-256.

## Final self-review checklist

- [ ] Every item 14–21 maps to at least one task and a failing test.
- [ ] No code or process mutation occurred outside the repository.
- [ ] No Agent zero values or unsuccessful services are exposed.
- [ ] Exhausted non-expired services remain visible.
- [ ] Token-plan order survives reload/restart and rejects invalid permutations atomically.
- [ ] OAuth callback remains intact despite startup code splitting.
- [ ] Completion status is based on fresh test/build/benchmark output, not screenshots or assumptions.
