# Codex Reset History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a local-only Codex reset history page that highlights today's actual reset and retains the latest five actual reset timestamps.

**Architecture:** Extend the existing reset state machine with one pure history selector and bounded event compaction, expose sanitized history through the existing loopback API and React context, then add one sidebar route and page. Keep unread notifications independent from history and do not change leaderboard periods.

**Tech Stack:** Node.js CommonJS, React 18, TypeScript, Vitest, Node test runner, Tauri/Vite.

---

### Task 1: Specify and test reset-history semantics

**Files:**
- Modify: `test/codex-reset-monitor.test.js`
- Modify: `test/codex-reset-monitor-service.test.js`

1. Add a test containing completed, unexpected restore, upcoming, and official events.
2. Assert that only completed and unexpected restore events enter history.
3. Assert descending occurrence order, correct occurrence timestamp semantics, and a five-record limit.
4. Assert persisted event compaction keeps no more than five actual reset events without deleting unrelated unread event types.
5. Run:

```powershell
node --test test/codex-reset-monitor.test.js test/codex-reset-monitor-service.test.js
```

Expected before implementation: failure because history APIs do not exist.

### Task 2: Implement bounded reset history

**Files:**
- Modify: `src/lib/codex-reset-monitor.js`
- Modify: `src/lib/codex-reset-monitor-service.js`

1. Add a pure `listCodexResetHistory` selector.
2. Derive occurrence time from `resetAt` for completed resets and `createdAt` for unexpected restores.
3. Compact actual reset events to the latest five while preserving other event categories under the existing global cap.
4. Expose `listHistory()` on the monitor service.
5. Re-run Task 1 tests and confirm they pass.

### Task 3: Test and expose local API history

**Files:**
- Modify: `test/local-api-codex-reset-events.test.js`
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/lib/api.ts`

1. Extend the injected service fixture with actual reset history.
2. Assert GET returns a sanitized `history` array with `occurred_at` and no private fields.
3. Add `history` to the response DTO and client parser.
4. Run:

```powershell
node --test test/local-api-codex-reset-events.test.js test/codex-reset-privacy-contract.test.js
```

### Task 4: Test and implement the page, context, route, and navigation

**Files:**
- Modify: `dashboard/src/hooks/use-codex-reset-events.ts`
- Modify: `dashboard/src/hooks/__tests__/use-codex-reset-events.test.tsx`
- Create: `dashboard/src/pages/ResetHistoryPage.tsx`
- Create: `dashboard/src/pages/ResetHistoryPage.test.tsx`
- Modify: `dashboard/src/ui/components/Sidebar.jsx`
- Modify: `dashboard/src/ui/components/__tests__/Sidebar.nav.test.jsx`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/App.routes.test.jsx`
- Modify: `dashboard/src/App.preload.test.jsx`
- Modify: `dashboard/src/content/copy.csv`

1. Add failing tests for:
   - an independent reset-history navigation item;
   - route rendering inside the desktop shell;
   - prominent today reset with exact local date/time;
   - empty today content when no reset happened today;
   - past history excluding the already highlighted today event;
   - no relative day labels.
2. Expose `history` from the existing context.
3. Implement the page with registered copy only.
4. Move the reset-attention dot to the new navigation item.
5. Lazy-load and gate `/reset-history`.
6. Run focused Vitest files.

### Task 5: Regression and release verification

**Files:**
- Modify version manifests only after tests pass.

1. Assert leaderboard period controls remain exactly `today`, `week`, `month`, and `total`.
2. Run:

```powershell
npm test
npm run validate:copy
npm run validate:ui-hardcode
npm run dashboard:build
```

3. Bump all release manifests in lockstep to the next patch version.
4. Build the Windows NSIS installer.
5. Run adversarial acceptance checks against the packaged dashboard and report the exact installer path and checksum.
