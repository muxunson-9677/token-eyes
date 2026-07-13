# Token Eyes Other AI Spend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third cost-settings category, “Other AI spend”, whose user-entered historical charges participate in real monthly and lifetime cost totals without changing Token usage totals.

**Architecture:** Reuse the existing spend-record ledger with the invariant `source = "other_ai"` and `billing_cycle = "one_time"`. A focused settings component owns CRUD for amount, currency, date, name, and note. Cost queries append `other_ai` to their provider source filter, while usage queries continue using provider sources only. Existing spend normalization and currency conversion remain the single calculation path.

**Tech Stack:** React 18, Vitest, Testing Library, CommonJS local API, Node test runner.

---

## File map

- Create `dashboard/src/components/settings/OtherAiSpendSection.jsx`: focused CRUD UI for historical AI charges.
- Create `dashboard/src/components/settings/OtherAiSpendSection.test.jsx`: verify load/create/edit/delete payloads and invariants.
- Modify `dashboard/src/pages/SettingsPage.jsx`: render the third cost-settings section once.
- Modify `dashboard/src/pages/SettingsPage.test.jsx`: verify placement and non-duplication.
- Create `dashboard/src/lib/cost-sources.js`: append the reserved manual-cost source without mutating provider visibility.
- Create `dashboard/src/lib/cost-sources.test.js`: verify deduplication and usage-source separation.
- Modify `dashboard/src/pages/SpendPage.jsx`: use cost sources only for financial queries; keep Token and request queries provider-only.
- Modify the cost-accumulation hook used by `SpendPage.jsx`: include manual charges in summaries and timelines, but exclude them from the subscription-management list.
- Modify focused dashboard tests: prove financial calls include `other_ai` and usage calls do not.
- Modify `test/spend-records-api.test.js`: prove `other_ai` month/lifetime totals, CNY conversion, edit, delete, and source isolation.
- Modify `test/spend-timeseries-api.test.js`: prove `other_ai` contributes cost but zero tokens.
- Modify `dashboard/src/content/copy.csv`: add registered copy stating that records enter real cost totals.
- Modify `docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md`: record repository evidence and remaining manual acceptance.

### Task 1: Lock the financial boundary with failing tests

- [ ] Add API tests for one-time `other_ai` records in current month, previous month, and lifetime totals.
- [ ] Add API tests for CNY conversion plus edit/delete behavior.
- [ ] Add a timeseries test requiring manual cost with zero Token usage.
- [ ] Add dashboard tests requiring financial source filters to contain `other_ai` while usage filters exclude it.
- [ ] Run focused tests and confirm the missing behavior fails.
- [ ] Commit the red tests.

### Task 2: Add the shared cost-source policy

- [ ] Implement a minimal immutable helper that appends and deduplicates `other_ai`.
- [ ] Use it in usage-page cost totals and cost-accumulation queries only.
- [ ] Exclude `other_ai` from the subscription-record management list.
- [ ] Run focused source-policy and page tests.
- [ ] Commit the financial wiring.

### Task 3: Implement the third settings section

- [ ] Add failing component tests for load, create, edit, and delete.
- [ ] Implement the smallest CRUD form with required name, positive amount, CNY/USD currency, spend date, and optional note.
- [ ] Force the reserved source and one-time billing cycle in every mutation payload.
- [ ] Render the section once on cost settings and register all user-facing copy.
- [ ] Run component and settings-page tests.
- [ ] Commit the settings UI.

### Task 4: Verify and record completion

- [ ] Run focused Node spend API and timeseries tests with project-local temporary storage.
- [ ] Run focused Vitest suites for settings, source policy, cost accumulation, and Spend pages.
- [ ] Run the dashboard production build.
- [ ] Run copy and UI-hardcode validation against the branch baseline.
- [ ] Update the 1–6 tracking document with completed evidence and manual acceptance still required.
- [ ] Run `git diff --check` and verify the feature worktree is clean.
- [ ] Commit verification documentation.

## Acceptance criteria

1. A user can create, edit, and delete a historical AI charge with name, amount, currency, date, and optional note.
2. The charge affects the correct month and lifetime cost summaries using the configured currency conversion path.
3. The charge contributes zero input/output/cache/total Tokens and never appears as a provider usage source.
4. Token package, API-account, and other-AI cost records remain separately manageable.
5. No file or software outside the Token Eyes repository is modified.
