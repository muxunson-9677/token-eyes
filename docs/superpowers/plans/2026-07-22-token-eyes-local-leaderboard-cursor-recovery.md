# Token Eyes Local Leaderboard and Cursor Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Cursor quota refresh, remove the redundant Codex reset panel, restore green comparison text, and immediately insert the signed-in user's local usage into the public leaderboard.

**Architecture:** Keep the existing public/cloud leaderboard and daily compact-state upload. Add one local-row adapter that reads the existing compact state and local cost endpoints, then merge that row with cloud entries by user ID. Cursor keeps its stored OAuth session and retries a forced refresh only after the usage endpoint explicitly rejects the access token.

**Tech Stack:** Rust/Tauri 2, React 18, TypeScript/JavaScript, Vitest, Node test runner, NSIS.

---

### Task 1: Recover Cursor quota refresh

**Files:**
- Modify: `src-tauri/src/cursor_session.rs`
- Test: `src-tauri/src/cursor_session.rs`

- [ ] **Step 1: Write the failing tests**

Add unit tests that require normal valid tokens to avoid proactive exchange, require `force_refresh` to exchange even before expiry, and require a 401 usage result to select exactly one refresh retry.

```rust
#[test]
fn forced_cursor_retry_exchanges_an_unexpired_access_token() {
    assert!(!should_exchange_refresh_token(&future_token(), false, true));
    assert!(should_exchange_refresh_token(&future_token(), true, true));
}

#[test]
fn cursor_usage_unauthorized_requests_one_refresh_retry() {
    assert_eq!(next_cursor_auth_action("REAUTH_REQUIRED", true, false), CursorAuthAction::RefreshAndRetry);
    assert_eq!(next_cursor_auth_action("REAUTH_REQUIRED", true, true), CursorAuthAction::RequireLogin);
}
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cargo test cursor_session --lib`

Expected: FAIL because the new decision helpers and retry behavior do not exist.

- [ ] **Step 3: Implement the minimal retry**

Change `refresh_cursor_auth_bundle` to accept `force_refresh: bool`, exchange when forced or near expiry, and change `fetch_cursor_quota` to retry the usage call once after an explicit `REAUTH_REQUIRED`. Preserve stored credentials on network or parse failures.

```rust
let should_exchange = !refresh_token.trim().is_empty()
    && (force_refresh || access_token_needs_refresh(&access_token));

match fetch_usage_summary_payload(client, &auth.access_token).await {
    Err(error) if error == "REAUTH_REQUIRED" && !auth.refresh_token.trim().is_empty() => {
        let refreshed = refresh_cursor_auth_bundle(client, auth.access_token, auth.refresh_token, known_account_id, true).await?;
        fetch_usage_summary_payload(client, &refreshed.access_token).await
    }
    result => result,
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cargo test cursor_session --lib`

Expected: all Cursor session tests pass.

### Task 2: Remove the redundant Codex reset panel

**Files:**
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Test: `dashboard/src/components/settings/TokenPlanSection.test.jsx`

- [ ] **Step 1: Replace the old positive test with a failing absence test**

```jsx
expect(screen.queryByText(copy("codex_reset.monitor.title"))).not.toBeInTheDocument();
expect(screen.getByText(new RegExp(copy("settings.token_plan.codex_quota.reset")))).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm --prefix dashboard test -- --run src/components/settings/TokenPlanSection.test.jsx`

Expected: FAIL because the standalone monitor panel still renders.

- [ ] **Step 3: Remove only the card-level monitor UI**

Remove `CodexResetMonitorStatus` props/rendering and the unused component. Keep `useCodexResetEvents`, the global provider, sidebar banner, tray state, and `CodexQuotaBlock` reset timestamps intact.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same Vitest command and expect all tests in the file to pass.

### Task 3: Restore green comparison text

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`
- Test: `dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx`
- Test: `dashboard/src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx`

- [ ] **Step 1: Write failing color assertions**

Assert both increase and decrease render `text-emerald-600`/`text-green-600`, while flat remains gray. Retain assertions for low-baseline absolute-value labels.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx`

Expected: increase assertions fail on the current amber class.

- [ ] **Step 3: Restore the original green classes**

```jsx
comparison.kind === "increase" && "text-green-600 dark:text-green-400"
```

Use emerald green for the CostAccumulation label in both increase and decrease branches; do not change calculations.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same Vitest command and expect all tests to pass.

### Task 4: Build and merge the immediate local leaderboard row

**Files:**
- Create: `dashboard/src/lib/leaderboard-local-row.ts`
- Create: `dashboard/src/lib/__tests__/leaderboard-local-row.test.ts`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: `dashboard/src/pages/LeaderboardPage.test.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Write failing local-row unit tests**

Test compact rows shaped as `[source, model, input, output, cached, cacheCreation, reasoning]` and require period/source filtering, total calculation, source breakdown, actual-cost privacy, and local pending identity.

```ts
expect(buildLocalLeaderboardRow(payload, {
  period: "week",
  source: "all",
  userId: "user-1",
  displayName: "我",
})).toMatchObject({
  user_id: "user-1",
  total_tokens: 150,
  is_me: true,
  is_local_pending: true,
});
```

- [ ] **Step 2: Run the unit test and verify RED**

Run: `npm --prefix dashboard test -- --run src/lib/__tests__/leaderboard-local-row.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the local adapter**

Export `getLocalLeaderboardState()` from `api.ts` using the existing `/functions/tokentracker-leaderboard-state` local route. In `leaderboard-local-row.ts`, aggregate the selected compact period and source without reading prompts, projects, or content. Add estimated cost from `getUsageSummary` for the same date range and optional actual cost from `getLocalLeaderboardActualCost` only when sharing is enabled.

- [ ] **Step 4: Write the failing page merge tests**

Mock a public cloud row plus a local row. Require both to render immediately after login. Then return a cloud `me` row with the same user ID and require only one user row, with the cloud rank replacing the pending placeholder.

- [ ] **Step 5: Run the page test and verify RED**

Run: `npm --prefix dashboard test -- --run src/pages/LeaderboardPage.test.jsx`

Expected: local-me assertions fail because the page currently depends entirely on cloud rank/profile endpoints.

- [ ] **Step 6: Merge the local row in the page**

Load local state whenever the user is signed in or filters change. Prefer cloud `me` when it contains data; otherwise use local `me`. Pass the selected row through existing `prependMeRowToPage`, which removes duplicates by user ID. Render the copy-registry label `leaderboard.rank_pending` for a local row without a formal rank.

- [ ] **Step 7: Run local-row and page tests and verify GREEN**

Run both focused Vitest files and expect all tests to pass.

### Task 5: Verify and package

**Files:**
- Modify: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `TokenTrackerWin/TokenTrackerWin.csproj`, `TokenTrackerBar/project.yml`

- [ ] **Step 1: Run relevant regression suites**

Run Cursor Rust tests, Token Plan tests, comparison tests, local leaderboard tests, local API leaderboard tests, validators, and dashboard build. Expected: zero focused failures.

- [ ] **Step 2: Bump the patch version consistently**

Update all release version locations from `0.54.8` to `0.54.9`.

- [ ] **Step 3: Build the Windows installer**

Run: `npm run tauri:build -- --bundles nsis`

Expected artifact: `src-tauri/target/release/bundle/nsis/Token Eyes_0.54.9_x64-setup.exe`.

- [ ] **Step 4: Verify artifact and repository state**

Run SHA-256, version, `git diff --check`, focused tests after the version bump, and inspect `git status`.

- [ ] **Step 5: Commit and push**

```bash
git add -u dashboard/src/lib/leaderboard-local-row.ts dashboard/src/lib/__tests__/leaderboard-local-row.test.ts
git commit -m "fix: restore Cursor and local leaderboard data"
git push origin codex/leaderboard-provider-api
```
