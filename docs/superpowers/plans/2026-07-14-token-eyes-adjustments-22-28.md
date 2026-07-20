# Token Eyes Adjustments 22–28 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the seven verified Token Eyes adjustments covering compact leaderboard rows, Chinese Token units, service quota cards, collapsible settings, stronger state styling, aligned cost cards, and perceptually immediate startup.

**Architecture:** Add one token-specific Chinese formatter and reuse it across the active dashboard surfaces. Keep data semantics in pure normalization helpers, presentation in existing React components, and directory support in the existing adapter registry. Fix startup at the React suspense and route dependency boundaries instead of adding arbitrary delays or hiding the native window.

**Tech Stack:** React 18, Vite 7, Vitest/Testing Library, Node test runner, CommonJS local backend, Tauri 2/Rust, Tailwind utility classes.

---

### Task 1: Chinese Token formatter

**Files:**
- Modify: `dashboard/src/lib/format.ts`
- Modify: `dashboard/src/lib/format.test.ts`

- [ ] Write table-driven failing tests for 9,999 / 10,000 / 9,999,999 / 10,000,000 / 99,999,999 / 100,000,000 and invalid values.
- [ ] Run `npm --prefix dashboard test -- --run src/lib/format.test.ts` and confirm the missing export failure.
- [ ] Add `formatChineseTokenCount(value, options)` with 万/千万/亿 thresholds, bounded decimals, trailing-zero trimming and no currency/request semantics.
- [ ] Run the formatter test and confirm all cases pass.

### Task 2: Compact leaderboard rows

**Files:**
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: `dashboard/src/pages/LeaderboardPage.test.jsx`
- Modify: `dashboard/src/components/LeaderboardSkeleton.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] Add failing tests proving there is no “返回概览” link, no standalone Agent column, and Agent metrics appear as gray secondary content beneath each user.
- [ ] Add failing assertions for Chinese aggregate and row Token totals.
- [ ] Run the focused leaderboard tests and confirm requirement failures.
- [ ] Replace the five-column table with compact semantic rows while preserving row click, keyboard access, pinned-me behavior, pagination and error/empty states.
- [ ] Use the shared Chinese formatter for aggregate totals, scores and per-Agent Token values.
- [ ] Update skeleton geometry and copy registration, then rerun focused tests.

### Task 3: Chinese units across active usage surfaces

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageTrendChart.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageOverview.jsx`
- Modify: `dashboard/src/ui/dashboard/components/ProviderUsageTable.jsx`
- Modify: `dashboard/src/ui/dashboard/components/ModelUsageTable.jsx`
- Modify: `dashboard/src/pages/DashboardPage.jsx`
- Modify relevant component/page tests.

- [ ] Update focused tests to expect 万/千万/亿 rather than K/M/B or long grouped Token values.
- [ ] Run focused tests and confirm expected failures.
- [ ] Replace token-specific local formatters with `formatChineseTokenCount`; leave money, percentages, participants and request counts unchanged.
- [ ] Rerun focused tests and verify tooltip and axis boundaries.

### Task 4: Token service quota cards

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/TokenServiceList.jsx`
- Modify: `dashboard/src/ui/dashboard/components/TokenServiceList.test.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] Add failing normalization tests for one quota, 5-hour + weekly windows, expiry, exhausted-but-valid and unconfigured states.
- [ ] Add failing UI tests for ProviderIcon, provider/plan hierarchy, Chinese quota values, percent, expiry and reset labels.
- [ ] Run focused tests and confirm failures.
- [ ] Normalize all supported quota windows instead of selecting only one, and render compact provider cards with truthful time metadata.
- [ ] Preserve five-per-page paging and rerun tests.

### Task 5: Directory registry parity and collapsible settings

**Files:**
- Modify: `src/lib/agent-adapters.js`
- Modify: `src/lib/data-directories.js`
- Modify: `src/lib/agent-env-detect.js`
- Modify: `src/commands/sync.js`
- Modify: `dashboard/src/components/settings/Controls.jsx`
- Modify: `dashboard/src/components/settings/DataDirectoriesSection.jsx`
- Modify: `dashboard/src/components/settings/AgentPricingSection.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `test/data-directories.test.js`
- Modify: `test/agent-env-detect.test.js`
- Modify relevant settings component tests.

- [ ] Add failing backend tests asserting directory keys match the ten limits providers and configured Gemini/Antigravity/CodeBuddy/Trae paths reach resolved sync paths.
- [ ] Add failing UI tests for ten directory inputs and default-collapsed, keyboard-accessible data/pricing sections.
- [ ] Run focused Node and Vitest tests and confirm failures.
- [ ] Extend the canonical adapter/directory registry and evidence inspection for the four missing visible providers without changing unrelated adapters.
- [ ] Add an accessible collapsible mode to `SectionCard`, then enable it only for data directories and Agent pricing.
- [ ] Rerun focused tests.

### Task 6: Card hierarchy, selected states and monthly comparison alignment

**Files:**
- Modify: `dashboard/src/ui/components/Card.jsx`
- Modify: `dashboard/src/components/settings/Controls.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: `dashboard/src/pages/SpendPage.jsx`
- Modify relevant tests.

- [ ] Add failing DOM assertions for `aria-pressed`/`aria-selected` and monthly comparison residing in the combined-cost header/value row.
- [ ] Run focused tests and confirm failures.
- [ ] Add restrained surface shadow/background hierarchy and consistent brand-tinted active states.
- [ ] Move comparison text out of its standalone row and align all four cost cards.
- [ ] Rerun tests at desktop and narrow DOM layouts.

### Task 7: Perceptually immediate startup

**Files:**
- Modify: `dashboard/index.html`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/main.jsx`
- Modify: `dashboard/src/pages/SettingsPage.jsx`
- Modify: `test/token-eyes-startup-contract.test.js`
- Modify: `scripts/benchmark-token-eyes-startup.ps1`

- [ ] Extend the startup contract so it fails when the static boot shell can be cleared into `Suspense fallback={null}` or the basic settings route statically loads cost-only components.
- [ ] Run the startup contract and confirm both failures.
- [ ] Add a reusable React boot fallback matching the static shell and keep it visible until the lazy page resolves.
- [ ] Lazy-load cost-only settings components so `/settings/basic` excludes TokenPlan/provider-finance dependencies.
- [ ] Record separate process-window and first-content limitations in the benchmark output; do not label `Process.Responding` as DOM interactive.
- [ ] Run contract, dashboard production build, Tauri release benchmark and compare chunks.

### Task 8: Full verification and installer

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-token-eyes-adjustments-22-28-design.md`

- [ ] Run all focused Node/Vitest suites from Tasks 1–7.
- [ ] Run dashboard typecheck, copy validation, guardrails, changed-file lint and `git diff --check`.
- [ ] Run `npm run dashboard:build` and inspect generated chunk sizes.
- [ ] Run the safe repository-only startup benchmark against `src-tauri/target/release/token-eyes.exe`.
- [ ] Build the NSIS installer and calculate SHA-256.
- [ ] Update the 22–28 status table with exact evidence, remaining external validation and installer path.
