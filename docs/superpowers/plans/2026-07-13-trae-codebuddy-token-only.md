# Trae and CodeBuddy Token-Only Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include Trae and CodeBuddy in overview and limits while guaranteeing that both sources report real token consumption only and never fabricate quota or monetary cost.

**Architecture:** Keep the existing Trae and CodeBuddy parsers and queue rows as the only token source. Add a small local usage-limits summary derived from the deduplicated queue, render it as token-only status rather than a percentage bar, and enforce a source-level zero-cost rule in the shared pricing function.

**Tech Stack:** Node.js CommonJS local API and pricing, React/Vite dashboard, Vitest, Node test runner, Swift preference parity.

---

### Task 1: Lock the token-only backend contract

**Files:**
- Modify: `test/pricing.test.js`
- Modify: `test/local-api-source-scope.test.js`
- Modify: `src/lib/pricing/index.js`
- Modify: `src/lib/local-api.js`

- [ ] Write a pricing regression proving Trae and CodeBuddy return `cost_usd: 0` even when their model has built-in, custom-rule, or agent-default pricing.
- [ ] Run the focused pricing test and verify RED because known model names are currently priced.
- [ ] Add a `TOKEN_ONLY_SOURCES` guard at the start of `computeRowCostDetailed`; return zero cost with all tokens marked unpriced.
- [ ] Write a local API regression with deduplicated Trae/CodeBuddy queue rows and an injected usage-limits provider; assert `token_only`, `configured`, and exact `total_tokens` values.
- [ ] Run the local API regression and verify RED because the endpoint does not yet append local token-only summaries.
- [ ] Add `summarizeTokenOnlyUsage(rows)` and merge it into `/functions/tokentracker-usage-limits`; use the existing queue reader and an optional test-only provider override.
- [ ] Run focused Node tests and verify GREEN.
- [ ] Commit with `feat: add token-only usage limit summaries`.

### Task 2: Render token-only providers without fake quota bars

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/UsageLimitsPanel.test.jsx`
- Modify: `dashboard/src/ui/dashboard/components/UsageLimitsPanel.jsx`
- Modify: `dashboard/src/ui/dashboard/components/usage-limits-provider-specs.js`
- Modify: `dashboard/src/lib/limits-providers.js`
- Modify: `dashboard/src/hooks/use-usage-limits.ts`
- Modify: `dashboard/src/pages/LimitsPage.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `TokenTrackerBar/TokenTrackerBar/Models/LimitsSettingsStore.swift`
- Modify: `test/limits-providers-parity.test.js`

- [ ] Write a component test proving Trae and CodeBuddy display exact compact token totals plus the token-only explanation and render no percentage bar.
- [ ] Run the component test and verify RED because CodeBuddy is absent and token-only rendering does not exist.
- [ ] Add both ids/names/icons to the canonical provider list, extend the limits payload type/page props, and add token-only provider specs.
- [ ] Render token-only summaries through a dedicated status line using copy-registry text; do not reuse quota windows or percentages.
- [ ] Update macOS/dashboard provider preference parity so saved order/visibility keys are not dropped.
- [ ] Run component, parity, copy, and dashboard build verification.
- [ ] Commit with `feat: show Trae and CodeBuddy token usage`.

### Task 3: Verify overview inclusion and update progress

**Files:**
- Modify: `dashboard/src/lib/model-breakdown.test.ts`
- Modify: `docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md`

- [ ] Add a fleet-data regression proving Trae and CodeBuddy remain separate sources with real token totals and zero cost.
- [ ] Run the regression; if existing behavior already passes, record it as characterization rather than claiming a RED cycle.
- [ ] Run focused Node/Vitest tests, dashboard build, copy validation, and `git diff --check`.
- [ ] Update item 11 to complete only when the backend, limits UI, zero-cost contract, and overview characterization all pass.
- [ ] Commit with `docs: record token-only provider verification`.
