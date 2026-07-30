# Widget Session Title and Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop widget identify Codex sessions by their official task title and stop treating ordinary interrupted turns as red errors.

**Architecture:** Read only `id` and `thread_name` from Codex's local `session_index.jsonl`, then join that metadata to the existing rollout lifecycle records. Keep lifecycle evidence semantic (`error`, `waiting_approval`, `interrupted`, and so on) and let the widget view model derive both a traffic-light color and an exact localized state label.

**Tech Stack:** CommonJS Node.js, React 18, TypeScript, Node test runner, Vitest.

---

### Task 1: Read privacy-safe official Codex task titles

**Files:**
- Modify: `test/codex-lifecycle-reader.test.js`
- Modify: `src/lib/codex-lifecycle-reader.js`

- [ ] **Step 1: Write the failing title test**

Create a temporary `session_index.jsonl` containing:

```json
{"id":"019-safe-session","thread_name":"执行代码修复","first_user_message":"must not leak"}
```

Assert that the lifecycle result uses `执行代码修复` as `sessionLabel` and still excludes `first_user_message`, prompt text, raw paths, and other conversation content.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node --test test/codex-lifecycle-reader.test.js
```

Expected: FAIL because the reader currently sets `sessionLabel` to the UUID.

- [ ] **Step 3: Implement the minimum title join**

Add a bounded parser for `<CODEX_HOME>/session_index.jsonl` that reads only `id` and `thread_name`, sanitizes the title to 80 characters, and passes the resulting map into `readLifecycleFile`. Return `null` when no official title is available so the UI can provide a localized time-based fallback.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```powershell
node --test test/codex-lifecycle-reader.test.js
```

Expected: PASS.

### Task 2: Separate interrupted sessions from real red alerts

**Files:**
- Modify: `test/widget-view-model.test.js`
- Modify: `src/lib/widget-view-model.js`
- Modify: `dashboard/src/lib/api.ts`

- [ ] **Step 1: Write failing semantic-status tests**

Assert these mappings:

```text
waiting_approval -> red + waiting_approval
error            -> red + error
interrupted      -> stopped + stopped
running          -> yellow + running
completed        -> green + completed
```

Also assert that an interrupted session contributes zero to the red count and keeps the official Chinese session label.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node --test test/widget-view-model.test.js
```

Expected: FAIL because `interrupted` currently maps to red and the output has no exact state.

- [ ] **Step 3: Implement the minimum semantic mapping**

Add a `state` field to each session, map `interrupted`/`aborted` to neutral `stopped`, and count it under the existing non-traffic `unknown` bucket. Keep the three top traffic lights unchanged and reserve red for `waiting_approval` and `error`.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```powershell
node --test test/widget-view-model.test.js
```

Expected: PASS.

### Task 3: Render readable localized session identity

**Files:**
- Modify: `dashboard/src/pages/DesktopWidgetPage.test.tsx`
- Modify: `dashboard/src/pages/DesktopWidgetPage.tsx`
- Modify: `dashboard/src/pages/desktop-widget.css`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `dashboard/src/content/i18n/zh/dashboard.json`

- [ ] **Step 1: Write the failing widget test**

Expand a project containing a stopped session titled `执行代码修复` and assert that:

```text
执行代码修复
copy:widget.session_state.stopped
```

are rendered, while the row tooltip contains the localized state, timestamp, and shortened session ID.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/DesktopWidgetPage.test.tsx
```

Expected: FAIL because the widget currently uses a generic color label and has no session detail tooltip.

- [ ] **Step 3: Implement localized labels and the fallback**

Render the official title when present. Otherwise render:

```tsx
copy("widget.session.untitled", { time: formattedLocalTime })
```

Use exact state copy keys for `等待批准`, `运行异常`, `运行中`, `已完成`, `已中止`, and `未知`. Add an explicit gray style for stopped sessions and a native tooltip containing state, local time, and the final eight ID characters.

- [ ] **Step 4: Run the widget test to verify it passes**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/DesktopWidgetPage.test.tsx
```

Expected: PASS.

### Task 4: Verify the installed-data path without altering other widget behavior

**Files:**
- No additional production files.

- [ ] **Step 1: Run focused regressions**

```powershell
node --test test/codex-lifecycle-reader.test.js test/widget-view-model.test.js test/local-api-desktop-widget.test.js
npm --prefix dashboard test -- --run src/pages/DesktopWidgetPage.test.tsx
```

Expected: all PASS.

- [ ] **Step 2: Run build and guardrails**

```powershell
npm run dashboard:build
npm run validate:copy
npm run validate:ui-hardcode
```

Expected: all PASS.

- [ ] **Step 3: Inspect the scoped diff**

Confirm every functional change is limited to official session titles, exact session state, interrupted-session neutral treatment, and their tests/copy. Do not commit the existing dirty worktree without explicit user instruction.
