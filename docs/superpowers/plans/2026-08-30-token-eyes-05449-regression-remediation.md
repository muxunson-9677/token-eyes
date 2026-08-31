# Token Eyes 0.54.49 Regression Remediation Implementation Plan

> **For agentic workers:** Execute each task with RED → GREEN → focused regression. Do not claim completion from component tests; the final installer and two fresh user journeys are blocking.

**Goal:** Repair every user-reported 0.54.49 regression without changing the 0.54.47/0.54.48 worktrees, then bind a final clean source SHA to a production NSIS installer and independently re-run the full real-user contract twice.

**Architecture:** Preserve 0.54.48 outside the reopened contract. Restore the 0.54.47 widget behavior through its data/view-model contract, not by copying unrelated files. Keep quota reset, credential expiry, subscription entitlement, API activity, and official billed cost as separate facts. Preserve last-good financial snapshots on refresh failures. Allow Clash fake-IP only through an explicit known-provider hostname boundary while retaining the general SSRF deny rules.

**Tech Stack:** Node.js `node:test`, React/Vitest/Testing Library, TypeScript/Vite, Rust/Tauri, Playwright/Windows UI automation, NSIS.

---

### Task 1: Reopen the delivery gate and preserve isolation

**Files:**
- Modify: `docs/0.54.49-progress.md`
- Modify: `docs/0.54.49-final-delivery-report.md`
- Modify: `docs/0.54.49-scope-matrix.md`
- Create: `docs/0.54.49-regression-remediation-acceptance.md`

1. Record exact target worktree, branch, starting SHA and clean status.
2. Mark old acceptance evidence invalid and state `REPAIRING`.
3. Encode every user-visible item as REG-OV/LB/RR/WG/UD/CQ/CS/DD/ALL blocking rows.
4. Verify with `git diff --check` and `git status --short --branch`.

### Task 2: Keep overview Agent shadows inside the desktop scroller

**Files:**
- Modify: `dashboard/src/ui/dashboard/views/__tests__/DashboardView.test.jsx`
- Modify: `dashboard/src/ui/foundation/apple-glass.css`

1. Add a failing desktop layout contract proving the horizontal Agent strip reserves vertical shadow space instead of clipping it with `overflow-y: hidden` at the card edge.
2. Run the focused Vitest file and capture RED.
3. Add the minimum scrollport padding/margin or wrapper rule that keeps the existing shadow and horizontal scrolling.
4. Re-run the focused test and browser rect/screenshot checks at 1348/1600 and a narrow width.

### Task 3: Make leaderboard navigation immediate and registration valid

**Files:**
- Modify after diagnosis: `dashboard/src/pages/LeaderboardPage.test.jsx`
- Modify after diagnosis: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify after diagnosis: `dashboard/src/components/LoginModal.test.jsx`
- Modify after diagnosis: `dashboard/src/components/LoginModal.jsx`
- Modify only if required by the traced request contract: leaderboard/auth context and API helpers

1. Add RED timing/state tests: cached/LKG content paints synchronously and slow refresh cannot blank it; registration mode does not request a session token before signup.
2. Remove the blocking request chain on route entry and keep refresh in the background with explicit freshness/error state.
3. Route create-account submissions through the real signup API and surface only the server's actual validation reason.
4. Run focused leaderboard/login/auth tests, then use the isolated staging account journey in both final installer rounds.

### Task 4: Correct reset feed freshness and inline details

**Files:**
- Modify: `test/codex-reset-feed.test.js`
- Modify: `test/codex-reset-monitor-service.test.js`
- Modify: `test/codex-reset-local-api.test.js`
- Modify: `dashboard/src/pages/ResetHistoryPage.test.tsx`
- Modify as root cause requires: `src/lib/codex-reset-feed.js`, `src/lib/codex-reset-monitor-service.js`, `src/lib/codex-reset-monitor-store.js`, `src/lib/local-api.js`, `dashboard/src/pages/ResetHistoryPage.tsx`, `dashboard/src/ui/foundation/apple-glass.css`

1. Add RED fixtures for a newer remote feed versus older built-in/LKG, complete announcement fields/body, and the third/fourth/fifth row detail geometry.
2. Make source precedence monotonic by observed/published time and retain explicit last-check/error metadata.
3. Render one detail region immediately after its owning row; scroll the opened row/detail into view without an absolute top overlay.
4. Run the full reset chain tests and click rows 1/3/4/5 in each final installer review.

### Task 5: Restore the 0.54.47 widget result contract and floating widget

**Files:**
- Modify: `test/widget-view-model.test.js`
- Modify: `test/local-api-desktop-widget.test.js`
- Modify: `dashboard/src/lib/desktop-widget-projects.test.ts`
- Modify: `dashboard/src/pages/DesktopWidgetPage.test.tsx`
- Modify: `dashboard/src/pages/WidgetsPage.test.jsx`
- Modify as required: `src/lib/local-api.js`, `src/lib/widget-view-model.js`, `dashboard/src/lib/desktop-widget-projects.ts`, `dashboard/src/pages/DesktopWidgetPage.tsx`, `dashboard/src/pages/WidgetsPage.jsx`
- Verify, and modify only if a real native defect remains: `src-tauri/src/widget_window.rs`

1. Add RED tests for lifecycle `projectLabel`/`sessionLabel`, readable grouped sessions, accurate project nesting, expired-plan disclosure, and the floating-window command/visibility contract.
2. Restore the missing lifecycle labels at the local DTO boundary and consume them with the 0.54.47 grouping/UI semantics.
3. Add the shared active/expired/scheduled plan grouping to WidgetsPage without changing unrelated widget behavior.
4. Verify the floating widget source was not deleted; repair only the broken entry/visibility bridge and prove persistence across app restart.

### Task 6: Keep the Token service card fixed while showing all real API activity

**Files:**
- Modify: `dashboard/src/pages/SpendPage.test.jsx`
- Modify: `dashboard/src/pages/SpendPage.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/ProviderApiServiceList.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/ProviderApiServiceList.jsx`
- Modify: `test/provider-api-stats.test.js`
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/hooks/use-provider-stats.ts`
- Modify: `dashboard/src/types/api.ts`
- Modify copy files only for explicit unavailable-cost wording

1. Add RED tests proving the chart and outer grid span/geometry remain unchanged across Subscription/API.
2. Add RED backend/UI fixtures for DSH and Hermes API-key-attributed usage with tokens/requests but no official bill.
3. Aggregate all explicit API-key activity; set cost to unavailable unless backed by official billed cost, and never filter a provider solely because cost is absent/zero.
4. Render a compact API list inside the existing card and retain Agent/model breakdown facts.
5. Run focused root/UI tests and compare actual local DSH/Hermes source-to-screen totals.

### Task 7: Separate subscription entitlement from resets and credential expiry

**Files:**
- Modify: `src-tauri/src/cursor_session.rs`
- Modify: `dashboard/src/hooks/use-token-service-plans.test.js`
- Modify: `dashboard/src/hooks/use-token-service-plans.js`
- Modify: `dashboard/src/lib/token-plan-validity.test.js`
- Modify: `dashboard/src/lib/token-plan-validity.js`
- Modify: `dashboard/src/ui/dashboard/components/TokenServiceList.test.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.collapsible.test.jsx`
- Modify as needed for migration: `src/lib/local-api.js` and token-plan API tests

1. Replace the existing incorrect Rust test with RED assertions that Cursor `billingCycleEnd` is only a quota reset and that official membership `free` is preserved as entitlement evidence.
2. Add JS RED tests: an official Cursor Pro selection with current membership `free` is expired; quota reset and Codex credential expiry never become plan expiry.
3. Stop writing reset/auth expiry into `expires_at`; migrate records whose provider-reported expiry exactly equals a quota reset/credential-expiry artifact.
4. Use official membership mismatch as an explicit expired state without inventing an exact expiry timestamp; use the shared state in usage, cost, settings and widgets.
5. Run Rust cursor tests plus all token-plan focused tests.

### Task 8: Preserve provider balances and support Clash fake-IP without weakening SSRF

**Files:**
- Modify: `test/provider-api-security.test.js`
- Modify: `test/provider-api-balance.test.js`
- Modify: `dashboard/src/hooks/use-provider-api-balances.test.js`
- Modify: `src/lib/safe-outbound-request.js`
- Modify: `src/lib/provider-api-executor.js`
- Modify: `src/lib/provider-api-configs.js` only if a shared preset-host helper is needed
- Modify: `src/lib/provider-api-balance.js`
- Modify: `dashboard/src/hooks/use-provider-api-balances.js`

1. Add RED security tests: arbitrary/private/metadata/rebinding targets remain rejected; `198.18.0.0/15` is accepted only for an exact built-in financial-provider hostname explicitly passed by the validated preset boundary.
2. Add RED refresh tests proving a successful snapshot survives DNS/network/timeout/rate-limit/auth failures as stale data with the new diagnostic; never replace it with nulls.
3. Implement the narrow fake-IP option and keep hostname/SNI pinning, financial-path allowlist, redirect validation and secret redaction intact.
4. Merge failed refresh diagnostics onto the last-good snapshot in backend persistence and UI cache.
5. Run all provider API security/balance/config tests and execute read-only live refreshes against the configured accounts.

### Task 9: Resolve WorkBuddy's detected path before health inspection

**Files:**
- Modify: `test/agent-env-detect.test.js`
- Modify: `src/lib/agent-env-detect.js`
- Modify only if DTO rendering needs it: `dashboard/src/pages/DataSourcesPage.test.jsx`, `dashboard/src/pages/DataSourcesPage.jsx`

1. Add a RED fixture with blank `dataDirectories.workbuddy` and a real default `.workbuddy/projects/*.jsonl`; require `ready`, evidence count and latest activity.
2. Map each adapter to `resolveDataDirectoryPaths`' resolved home instead of the raw override field.
3. Run focused agent/data-directory/DataSources tests and compare the live page with the current 32 WorkBuddy evidence files.

### Task 10: Full verification, frozen SHA and two independent installer reviews

**Files:**
- Update: `docs/0.54.49-progress.md`
- Update only after every row passes: `docs/0.54.49-final-delivery-report.md`
- Generate new evidence only under ignored acceptance/artifact locations

1. Run all affected focused suites, dashboard typecheck/build, full dashboard tests, full root tests, Rust tests and `npm run ci:local`.
2. Run an independent code review against the acceptance matrix; repair every Critical/Major/semantic mismatch/test failure.
3. Commit source and docs, verify clean worktree, freeze exact SHA, then build the production Tauri/NSIS artifact with matching runtime manifest/provenance.
4. Isolated-install the exact artifact without touching the user's existing installation; verify installer/runtime layer only.
5. First independent review: ordinary mouse/keyboard, all REG rows, real local data and authorized staging auth; capture rects, screenshots, console/network and persistence/restart evidence.
6. Clear first-round runtime state, reinstall the same exact artifact fresh, and perform the second independent full journey without reusing first-round conclusions.
7. If any row fails, return to `REPAIRING`; do not provide a completion link. Do not push, merge or production-publish.
