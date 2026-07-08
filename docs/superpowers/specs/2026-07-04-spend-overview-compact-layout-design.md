# Spend Overview Compact Layout Design

**Status:** Approved on 2026-07-04

## Goal

Make the spend overview denser and better aligned without changing any data or interaction behavior:

- move the four cost summary cards into the empty lower-left area of the usage statistics panel;
- reduce those cards so they align with the four token-dimension cards above them;
- right-align the complete filter-control group inside the toolbar;
- leave the right-side request count, total cost, and cache hit rate cards unchanged.

## Visual direction

Treat token usage and cost as two compact rows in one statistics workspace. The four-column rhythm is the visual anchor; borders, typography, and spacing remain restrained so the numbers stay primary.

## Layout

### Usage statistics panel

The left column keeps its existing hierarchy:

1. real token total;
2. four token-dimension cards;
3. four compact cost cards.

The cost row uses the same responsive grid tracks as the token row: two columns on narrow screens and four columns from the small breakpoint upward. Each cost card uses reduced padding, a small label, a compact USD value, and a subordinate CNY value. The row occupies the space marked in blue in the approved screenshot.

The right column remains structurally and visually unchanged: total requests, total cost, and cache hit rate stay stacked at desktop widths and retain their current responsive behavior.

### Filter toolbar

The agent switcher, source filter, model filter, refresh interval, and date range remain one ordered control group. The toolbar aligns that complete group to the right edge with wrapping preserved for narrow widths. No control order, labels, or behavior changes.

## Component changes

- `SpendPage.jsx` passes the existing raw cost totals into `UsageStatsPanel` and removes the separate summary-card row below the panel.
- `UsageStatsPanel.jsx` owns the compact cost-summary presentation and existing currency formatting formerly used by the page-level summary tiles.
- `UsageFilterBar.jsx` changes only its main-axis alignment to right-align the existing children.

No new shared abstraction is required. The cost summary remains part of the usage overview only, and the separate cost-management page remains untouched.

## Data behavior

The existing totals are used without transformation changes:

- monthly API cost: `api_usd` / `api_cny`;
- monthly subscription cost: `subscription_usd` / `subscription_cny`;
- monthly combined cost: `combined_usd` / `combined_cny`;
- lifetime combined cost: `lifetime_combined_usd` / `lifetime_combined_cny`.

Missing values continue to render as an em dash; genuine zero values continue to render as `0.00`. Loading, error, filtering, and refresh behavior are unchanged.

## Verification

Automated tests will verify that:

- the four cost summaries render inside `UsageStatsPanel` when totals are available;
- the cost row uses the same responsive column count as the token row;
- missing and zero monetary values retain their existing display semantics;
- the standalone summary row is removed from `SpendPage`;
- the filter toolbar is right-aligned while retaining wrapping.

The final Tauri window will be checked at the desktop viewport shown in the screenshots and at a narrow viewport to confirm alignment and wrapping.

## Non-goals

- no changes to the right-side status cards;
- no changes to APIs, hooks, totals, copy, or currency conversion;
- no redesign of the cost-management page;
- no new animation or interaction;
- no unrelated cleanup or component refactoring.
