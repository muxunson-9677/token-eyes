# Widget Press Rebound And Provider Overlay Implementation Plan

> **For agentic workers:** Execute inline in the current worktree. Do not commit or push without a later user instruction.

**Goal:** Make every clickable control on the Windows widgets page visibly press and rebound after a quick click, and render expanded overview Agent details as an overlay that does not change the surrounding grid height.

**Architecture:** Use one delegated pointer handler on `WidgetsPage` to apply and remove a short animation class, avoiding repetitive handlers on every button. Wrap the provider cards and expanded region in a positioned stage; the expanded region is absolutely positioned below the cards with an opaque surface and elevated stacking order.

**Tech Stack:** React, CSS keyframes, Vitest, Testing Library, Playwright runtime checks.

---

### Task 1: Widget press and rebound

**Files:**
- Modify: `src/pages/WidgetsPage.jsx`
- Modify: `src/ui/foundation/apple-glass.css`
- Test: `src/pages/WidgetsPage.test.jsx`
- Test: `src/ui/foundation/__tests__/AppleGlassFidelity.test.jsx`

- [x] Add a failing interaction test that requires `tt-widget-click-bounce` on pointer-down and removes it after `tt-widget-press-rebound` completes.
- [x] Run the test and verify it fails because the class and keyframes do not exist.
- [x] Add one page-level delegated pointer handler and animation-end cleanup handler.
- [x] Add a 300ms compositor-only keyframe sequence: rest → 2px down/0.94 scale → slight rebound → rest.
- [x] Run the focused tests and verify the complete click cycle passes.

### Task 2: Provider detail overlay

**Files:**
- Modify: `src/ui/dashboard/components/UsageOverview.jsx`
- Modify: `src/ui/foundation/apple-glass.css`
- Test: `src/ui/dashboard/components/__tests__/UsageOverview.test.jsx`
- Test: `src/ui/foundation/__tests__/AppleGlassFidelity.test.jsx`

- [x] Add failing tests requiring an overlay layout marker, positioned provider stage, and elevated expanded panel.
- [x] Run the tests and verify they fail against the current normal-flow layout.
- [x] Add a relative `tt-provider-card-stage` around cards and expanded details.
- [x] Position expanded details at `top: calc(100% + 8px)` with an opaque material, border, shadow, and z-index.
- [x] Keep the provider panel height unchanged while expanded and verify lower dashboard cards do not move.

### Task 3: Real runtime verification

- [x] Run focused unit/style tests, typecheck, build, and `git diff --check`.
- [x] At 1329×912, click—not hold—widget controls and verify the full press/rebound animation persists long enough to see.
- [x] Expand Agent cards; measure that the lower card position is unchanged and confirm the detail panel visually overlays it.
- [x] Repeat at 900×600 and inspect screenshots for clipping, overlap errors, and horizontal overflow.
