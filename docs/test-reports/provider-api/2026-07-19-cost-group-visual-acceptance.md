# Cost group visual acceptance — 2026-07-19

Worktree: `D:\04-AI-Project\010-Token eye\.worktrees\provider-api`  
Branch: `codex/token-eyes-provider-api`  
As-of: 2026-07-19 (local)

## Goal

Keep Other AI custom spend cards compact while ensuring USD/CNY amounts are fully readable (no truncation / overflow clipping).

## Change summary

| Area | Before | After |
|---|---|---|
| Card grid | `grid-cols-2` / `lg:grid-cols-4` | `repeat(auto-fit, minmax(240px, 1fr))` |
| Amount wrapper | `truncate` | no truncate / overflow-hidden / whitespace-nowrap; `leading-snug break-words` |
| Group title | `truncate` | unchanged (`truncate` allowed on names only) |
| Density | `data-density="ultra-compact"` | unchanged |

## Verification mode

Live `/spend` was not used for this acceptance run (auth / local server coupling). Instead:

1. `npm --prefix dashboard run build` — produces Tailwind CSS that includes the utilities from `CostAccumulation.jsx`.
2. `node dashboard/scripts/verify-cost-group-layout.mjs` — serves a self-contained fixture that mirrors `OtherAiGroupCostSection` markup + `data-testid`s, linked to the built CSS.

Optional live override: `COST_GROUP_LAYOUT_URL=http://127.0.0.1:<port>/spend node dashboard/scripts/verify-cost-group-layout.mjs`.

## Contract tests

```text
npm --prefix dashboard test -- src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx --run
```

Result: **15 passed** (includes new assertion that amount wrappers must not use `truncate` / `overflow-hidden` / `whitespace-nowrap`, and grid uses `minmax(240px,…)`).

## Playwright layout check

```text
npm --prefix dashboard run build
node dashboard/scripts/verify-cost-group-layout.mjs
```

| Width | Status | Screenshot |
|---:|---|---|
| 1280 | PASS | `artifacts/cost-group-layout/cost-group-1280.png` |
| 1440 | PASS | `artifacts/cost-group-layout/cost-group-1440.png` |
| 1920 | PASS | `artifacts/cost-group-layout/cost-group-1920.png` |

Checks per amount (`[data-testid="compact-cost-group-amount"]`):

- Forbidden classes absent (`truncate`, `overflow-hidden`, `whitespace-nowrap`)
- No `text-overflow: ellipsis`
- `scrollWidth <= clientWidth` (wrapping allowed; height may grow one line)
- Both `USD` and `CNY` lines present in text

Screenshots are local-only under `/artifacts/` (gitignored); paths above are relative to the worktree root.

## Acceptance

- [x] Amounts never truncate
- [x] Long group names may still truncate
- [x] Cards remain compact (`ultra-compact`); no return to oversized card layout
- [x] Adaptive columns with `minmax(240px, 1fr)`
- [x] 1280 / 1440 / 1920 PASS with screenshots
