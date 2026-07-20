# Token Eyes Adjustments 61–71 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair Token Eyes local usage detection, account quota synchronization, statistics presentation, pricing/settings layout, service ordering, branding, and Windows installer delivery for adjustments 61–71.

**Architecture:** Keep the existing local-first pipeline. Fix source discovery and local sync at the source, make native OAuth state the authority instead of stale database flags, and keep presentation components pure by feeding them normalized status/metrics. No external application or file is mutated; external product folders and the supplied icon are read-only inputs.

**Tech Stack:** Node.js CommonJS, React 18/Vite/Vitest, Tauri 2/Rust, Tailwind CSS, NSIS.

## 2026-07-17 completion report

- Completed 61/68: Trae and CodeBuddy install-folder inputs now resolve to their real roaming data stores, and the dashboard performs a throttled background local refresh on first open and focus so recent daily rows are not left stale.
- Completed 62/63/64: the pricing table is compact and non-clipping, the three default fallback editors are removed while custom rules remain, official price auto-verification is retained, and all three cost-setting sections use the shared card shell.
- Completed 65/66: native session verification is authoritative; stale Cursor/Codex/Claude/Kimi/Xiaomi sessions no longer produce fake connected states, and retries recreate orphaned sessions.
- Completed 67: request count, success rate, and average latency are visible above the request log.
- Completed 69: the supplied orange icon was copied into the repository-only asset folder, its baked checkerboard background was converted to transparency, and all Tauri/NSIS/dashboard icon targets were regenerated.
- Completed 70: version 0.54.3 was built and only `Token Eyes_0.54.3_x64-setup.exe` remains in the NSIS output directory.
- Completed 71: expired, failed, and unconfigured services are hidden; usable services sort first by consumed quota descending, exhausted-but-unexpired services sort second; notes, five-row pagination, and continuous ranks are preserved.
- Verification: dashboard 93 files / 824 tests passed; Rust 147 tests passed; focused Node contract suite 35 tests passed; typecheck, production build, copy validation, UI hardcode validation, and architecture guardrails passed.
- Known source limitation: the current Trae CN and CodeBuddy CN stores on this machine expose detectable application/session data but no readable exact token fields. Token Eyes reports this honestly instead of inventing zero or fabricated usage; exact token totals require a provider-readable export or official quota endpoint.

---

## Safety and baseline

- Work only in `D:\04-AI-Project\010-Token eye\.worktrees\provider-api`.
- Preserve all pre-existing dirty changes. Stage or commit nothing because several touched files already contain approved earlier work that cannot be separated safely.
- Never fabricate Trae/CodeBuddy token counts. A directory can be “已检测” while its native storage is not token-readable.
- Delete only obsolete `Token Eyes_*_x64-setup.exe` files under `src-tauri/target/release/bundle/nsis` after a newer installer has been verified.

### Task 1: Data-directory discovery and local refresh (61, 68)

**Files:**
- Modify: `src/lib/data-directories.js`
- Modify: `src/lib/rollout.js`
- Modify: `src/commands/sync.js`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/pages/DashboardPage.jsx`
- Modify: `dashboard/src/components/settings/DataDirectoriesSection.jsx`
- Test: `test/data-directories.test.js`
- Test: `test/agent-adapters.test.js`
- Test: `dashboard/src/lib/api.test.ts`
- Test: `dashboard/src/pages/DashboardPage.test.jsx`

- [ ] Add failing fixtures proving Trae/CodeBuddy installation paths redirect to actual user-data candidates on C:/E: profiles and that CodeBuddy detection does not stop at `~/.codebuddy` when a readable Roaming candidate exists.
- [ ] Run `node --test test/data-directories.test.js test/agent-adapters.test.js` and confirm the new cases fail because current resolution ignores those candidates.
- [ ] Implement deterministic candidate discovery and the statuses `connected_ready`, `connected_no_tokens`, and `not_detected`; accept only explicit token fields from readable logs/exports.
- [ ] Add a failing dashboard/API test proving local activation invokes `POST /functions/tokentracker-local-sync` without cloud login and refreshes usage queries after success.
- [ ] Implement a throttled, de-duplicated local sync trigger on dashboard activation; surface stale/sync failure instead of manufacturing zero rows.
- [ ] Run the focused Node and dashboard tests and confirm they pass.

### Task 2: Native account-session truth and quota snapshots (65, 66)

**Files:**
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- Modify: `src-tauri/src/cursor_session.rs`
- Modify: `src-tauri/src/codex_session.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- Test: Rust unit tests in `src-tauri/src/cursor_session.rs` and `src-tauri/src/codex_session.rs`

- [ ] Add failing tests for a persisted `connected` record whose native session returns `session_not_found`; assert the UI starts a fresh authorization instead of saving stale state.
- [ ] Add failing tests for pending Codex/Cursor sessions lost after restart; assert retry clears the orphan and creates a new native session.
- [ ] Run focused Vitest and `cargo test --lib cursor_session codex_session` equivalents and confirm expected failures.
- [ ] Make native verification authoritative, persist the returned quota snapshot only after verified success, and expose loading/error/timeout states on every connect button.
- [ ] Verify quota snapshots update the bound plan/account only and are consumed by cost accumulation.
- [ ] Run focused tests and the Rust library suite.

### Task 3: Statistics completeness and request health (67, 68)

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx`
- Modify: `dashboard/src/hooks/use-request-usage-records.ts`
- Modify: `dashboard/src/ui/dashboard/components/UsageOverview.jsx`
- Test: `dashboard/src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx`

- [ ] Add failing tests requiring visible request count, success count, success rate, and average latency even when the request table is empty.
- [ ] Assert missing samples render `无采样` rather than numeric zero.
- [ ] Implement one compact summary strip above the request table and remove no existing actionable log fields.
- [ ] Add a regression test showing refreshed July 16/17 queue rows appear in daily details after local sync.
- [ ] Run the focused tests and confirm they pass.

### Task 4: Pricing and cost-settings UI (62, 63, 64)

**Files:**
- Modify: `dashboard/src/components/settings/AgentPricingSection.jsx`
- Modify: `dashboard/src/components/settings/AgentPricingSection.test.jsx`
- Modify: `dashboard/src/components/settings/ProviderApiConfigSection.jsx`
- Modify: `dashboard/src/components/settings/ProviderApiConfigSection.test.jsx`
- Modify: `dashboard/src/components/settings/Controls.jsx`
- Test: `dashboard/src/pages/SettingsPage.test.jsx`

- [ ] Add failing tests that the pricing table uses fixed compact column widths and exposes status/actions without horizontal clipping.
- [ ] Add a failing test that Claude Code, Codex, and Hermes default-fallback editors are absent while `新增规则` remains.
- [ ] Add a failing settings test proving all three cost cards share the same `SectionCard` shell and collapse behavior.
- [ ] Implement the smallest responsive table, remove only the default editor UI, and move Provider API configuration into the shared shell without changing its data behavior.
- [ ] Run focused component/page tests and confirm they pass.

### Task 5: Token service ordering and pagination (71)

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/TokenServiceList.jsx`
- Modify: `dashboard/src/ui/dashboard/components/TokenServiceList.test.jsx`

- [ ] Add failing tests for expired-plan removal; available-before-exhausted ordering; consumption-ratio ordering across heterogeneous units; absolute-usage ordering within equal units; five rows per page; continuous numbering; account-note display; and failed/unconfigured exclusion.
- [ ] Implement a pure normalization/filter/sort pipeline before pagination.
- [ ] Preserve manual order only as the final stable tie-breaker.
- [ ] Run `npm --prefix dashboard test -- TokenServiceList.test.jsx` and confirm all focused cases pass.

### Task 6: Complete icon replacement and version alignment (69)

**Files:**
- Copy into: `src-tauri/icons/token-eyes-orange/source.png`
- Regenerate: `src-tauri/icons/*.png`, `src-tauri/icons/icon.ico`, `src-tauri/icons/icon.icns`
- Regenerate: `dashboard/public/app-icon.png`, `apple-touch-icon.png`, `favicon-*`, `icon-192.png`, `icon-512.png`
- Modify: `package.json`
- Modify: `TokenTrackerBar/project.yml`
- Modify: `TokenTrackerWin/TokenTrackerWin.csproj`
- Modify: `src-tauri/tauri.conf.json`
- Test: `test/windows-installer-icon-config.test.js`

- [ ] Inspect the supplied PNG and copy it read-only into the project asset folder.
- [ ] Add/update a failing icon-contract test requiring every configured icon target to derive from the new source and all release versions to match.
- [ ] Regenerate the Tauri/dashboard icon set, then bump all release version locations to one patch version.
- [ ] Run the icon contract test and inspect generated image dimensions/alpha.

### Task 7: Full verification and installer retention (70)

**Files:**
- Update: `docs/superpowers/plans/2026-07-17-token-eyes-adjustments-61-71.md`
- Delete after successful build only: obsolete `src-tauri/target/release/bundle/nsis/Token Eyes_*_x64-setup.exe`

- [ ] Run all focused red-green tests again.
- [ ] Run `npm --prefix dashboard test -- --run` and record pass/fail counts.
- [ ] Run `npm test` and record pass/fail counts.
- [ ] Run `npm --prefix dashboard run typecheck`, `npm --prefix dashboard run build`, `npm run validate:copy`, `npm run validate:ui-hardcode`, and `npm run validate:guardrails`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml --lib`.
- [ ] Run `npx tauri build --bundles nsis`.
- [ ] Verify product name, version, icon, size, and SHA-256 of the new installer.
- [ ] Remove only older setup installers, assert exactly one latest setup EXE remains, and mark every completed checkbox with evidence.

## Self-review coverage

- Adjustments 61/68: Tasks 1 and 3.
- Adjustments 65/66: Task 2.
- Adjustment 67: Task 3.
- Adjustments 62/63/64: Task 4.
- Adjustment 71: Task 5.
- Adjustments 69/70: Tasks 6 and 7.
- No placeholder implementation steps remain; each requirement maps to a focused test and verification command.
