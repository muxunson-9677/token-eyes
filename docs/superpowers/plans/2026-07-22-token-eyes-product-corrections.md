# Token Eyes Product Corrections Implementation Plan

> Implement against commit `d247d297` in the existing `codex/leaderboard-provider-api` worktree. Make surgical changes only; preserve 0.54.6 data and internal compatibility names.

**Goal:** Fix the eight confirmed product regressions and ship a verified Windows NSIS installer without requiring users to re-enter data or credentials.

**Architecture:** Keep local-first storage and the existing compact leaderboard backend. Correct the Tauri-to-embedded-server ownership boundary, make leaderboard participation/account state observable, enrich Token Plan records as the canonical plan-cost source, and unify cost calculations at the local API boundary.

**Stack:** Tauri/Rust, Node.js local API, React/Vite, Vitest, Node test runner, Cargo tests, InsForge edge functions/PostgreSQL.

---

## Task 1: Isolate the packaged backend from stale development servers

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `dashboard/src/lib/local-api-url.ts`
- Modify: `src/lib/local-api.js`
- Test: existing Rust command tests in `src-tauri/src/commands.rs`
- Test: `dashboard/src/lib/local-api-url.test.ts`
- Test: `test/local-api-security.test.js`

1. Add failing tests proving a release build does not adopt a nearby development server and rejects a health response with the wrong product/build identity.
2. Add product/build identity to local health metadata without exposing filesystem paths.
3. Restrict nearby-server reuse and frontend port fallback to development mode; release startup owns its bundled child.
4. Run the focused Rust, frontend, and Node tests.

## Task 2: Restore provider API refresh behavior and diagnostics

**Files:**
- Modify: `src/lib/provider-api-balance.js`
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/hooks/use-provider-api-balances.js`
- Modify: `dashboard/src/components/settings/ProviderApiConfigSection.jsx`
- Test: `test/provider-api-balance.test.js`
- Test: `dashboard/src/hooks/use-provider-api-balances.test.js`
- Test: `dashboard/src/components/settings/ProviderApiConfigSection.test.jsx`

1. Add regression tests for startup with an old server, credential-missing vs provider-unauthorized, and insertion of a newly refreshed balance when no cached row exists.
2. Keep credential references and DPAPI vault untouched.
3. Make refresh/test states observable and preserve the last good value on transient failures.
4. Verify DeepSeek bearer, Volcengine HMAC, and Aliyun RPC request contracts and perform one sanitized live read-only check.

## Task 3: Keep authentication inside the leaderboard

**Files:**
- Modify: `dashboard/src/pages/SettingsPage.jsx`
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: leaderboard profile/account components as needed
- Test: `dashboard/src/pages/SettingsPage.test.jsx`
- Test: `dashboard/src/pages/LeaderboardPage.test.jsx`

1. Add a failing settings test asserting no account/login card is rendered.
2. Ensure leaderboard signed-out, signed-in, profile edit, and sign-out actions remain reachable.
3. Run focused page tests.

## Task 4: Make leaderboard first participation immediate and observable

**Files:**
- Modify: `dashboard/src/lib/leaderboard-state-client.ts`
- Modify: `dashboard/src/lib/leaderboard-sync-state.ts`
- Modify: `dashboard/src/hooks/use-leaderboard-participation-sync.ts`
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: `dashboard/edge-patches/tokentracker-leaderboard-refresh.ts` only if response contract needs status detail
- Test: matching `dashboard/src/lib/__tests__`, hook tests, and page tests

1. Add failing tests for account-scoped hashes, first-login upload, one-time refresh, list invalidation, visible failure, and retry.
2. Return a participation sync state/event from the hook rather than swallowing errors.
3. After successful upload, invoke one lightweight authenticated refresh and reload the list/me query.
4. Preserve the daily scheduled refresh for normal operation.
5. Run focused tests; inspect cloud row counts without writing user data manually.

## Task 5: Auto-refresh connected Codex plans

**Files:**
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Modify: `src/lib/token-plan-refresh.js`
- Modify: `src/commands/serve.js`
- Modify: app-level hook/component chosen from existing refresh architecture
- Test: Token Plan frontend tests and `test/token-plan-refresh.test.js`

1. Add failing tests for persisted automatic refresh, startup refresh, focus refresh, timer refresh, deduplication, and last-good snapshot retention.
2. Stop forcing connected Codex native sessions to `manual`.
3. Refresh only while Token Eyes is running, with a conservative interval and focus trigger.
4. Display reset and last-sync timestamps.

## Task 6: Add Token Plan timestamps and canonical subscription cost

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Modify: `dashboard/src/hooks/use-cost-accumulation.js`
- Modify: cost ledger helpers/tests
- Test: local API Token Plan/spend tests and Token Plan UI tests

1. Add failing normalization/CRUD tests for created/updated timestamps, subscription dates, cycle, amount, and currency.
2. Add fields to Token Plan forms/cards and preserve old records by additive normalization.
3. Include cost-bearing Token Plans directly in cost aggregation without creating duplicate spend records.
4. Reject future exact duplicates in Other AI spend; keep ambiguous historical data untouched.
5. Add tests for one-time/monthly/yearly ranges and duplicate detection.

## Task 7: Correct cost filtering, currency, comparison, and folding

**Files:**
- Modify: `dashboard/src/hooks/use-cost-accumulation.js`
- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`
- Modify: translation copy
- Test: relevant hook/component/date-range tests

1. Add failing tests proving timeseries requests receive `sources` and frontend totals do not use a divergent hard-coded exchange rate.
2. Add low-baseline comparison tests and correct increase/decrease colors.
3. Pass source filters consistently and consume backend currency totals/rate.
4. Keep summary open; make detail sections collapsible with locally remembered state.
5. Run focused cost tests and reconcile current/previous totals against the local API.

## Task 8: Remove user-visible legacy branding

**Files:**
- Modify: user-facing dashboard copy/i18n, share cards, HTML metadata, and device display strings
- Test: add a branding contract test scanning user-visible assets

1. Add a failing contract test for visible `Token Tracker`, `tokentracker.cc`, and other borrowed product labels.
2. Replace visible product branding with Token Eyes.
3. Explicitly allow internal compatibility paths, table names, storage keys, package identifiers, and historical docs.
4. Run the branding test and UI tests touched by copy changes.

## Task 9: Full verification and release

1. Run `git diff --check` and inspect the complete diff for unrelated changes.
2. Run dashboard test suite and production build.
3. Run Node tests and targeted security/privacy contracts.
4. Run Cargo format/check/tests and architecture checks required by `CLAUDE.md`.
5. Bump the patch version only after all tests pass, build the Windows NSIS installer, and verify artifact metadata/hash.
6. Perform an installed-app smoke test proving the app uses its bundled backend, existing local data remains present, provider refresh works, Codex refresh works, and the logged-in user appears in the leaderboard.
7. Commit intentionally, push `codex/leaderboard-provider-api`, and report only the installer and user-relevant outcome.
