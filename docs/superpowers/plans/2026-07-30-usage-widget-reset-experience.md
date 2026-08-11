# Token Eyes 0.54.31 Usage, Widget, and Reset Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeat usage-page visits immediate, redesign official reset history as a compact timeline, make project selection explicitly saved and instantly synchronized to the floating widget, and fix material-panel contrast.

**Architecture:** Keep last successful local usage metadata available through synchronous browser caches, then refresh real data in the background. Treat widget project checkboxes as a draft and use the existing Tauri preference command as the single commit point; after a successful native save, dispatch a DOM event into the widget WebView so it reloads preferences immediately. Render reset announcements through a deterministic timeline/source-index view model.

**Tech Stack:** React 18, TypeScript/JavaScript, Vitest + Testing Library, Tauri 2/Rust, CSS, NSIS installer acceptance through WebView2 CDP.

---

### Task 1: Make the usage page show local data before background refresh

**Files:**
- Modify: `dashboard/src/hooks/use-token-service-plans.js`
- Modify: `dashboard/src/hooks/use-token-service-plans.test.js`
- Modify: `dashboard/src/hooks/use-usage-date-bounds.ts`
- Create: `dashboard/src/hooks/use-usage-date-bounds.test.tsx`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/lib/usage-cache.ts`
- Create: `dashboard/src/lib/usage-cache.test.ts`

- [ ] **Step 1: Write a failing test proving saved token plans do not wait for account refresh**

Add a deferred `syncCodexConsoleQuota` result and assert:

```js
const pendingQuota = new Promise(() => {});
getTokenPlans.mockResolvedValue({ records: [{ id: "codex-local", provider_id: "codex" }] });
getConsoleSessions.mockResolvedValue({ sessions: [] });
syncCodexConsoleQuota.mockReturnValue(pendingQuota);

const { result } = renderHook(() => useTokenServicePlans());
await waitFor(() => expect(result.current.plans).toHaveLength(1));
expect(result.current.loading).toBe(false);
```

- [ ] **Step 2: Run the token-plan test and confirm RED**

Run:

```powershell
npm --prefix dashboard test -- --run src/hooks/use-token-service-plans.test.js
```

Expected: FAIL because `loading` remains true until connected-plan refresh completes.

- [ ] **Step 3: Implement local-first token-plan loading**

In `use-token-service-plans.js`:

```js
const TOKEN_PLAN_CACHE_KEY = "token-eyes:token-service-plans:v1";
const TOKEN_PLAN_CACHE_TTL_MS = 60_000;

function readPlanCache() {
  const parsed = JSON.parse(window.localStorage.getItem(TOKEN_PLAN_CACHE_KEY) || "null");
  return Array.isArray(parsed?.plans) ? parsed : null;
}
```

Initialize state from this cache. Fetch `getTokenPlans()` first, immediately update the list and clear the blocking loading state, then run connected Codex/Trae/Cursor quota refreshes in a detached background promise. Do not blank the list while background work is running. Bypass the freshness interval for manual refresh revisions and the token-plan-changed event.

- [ ] **Step 4: Write and run a failing stable-date-bounds test**

The test mounts, resolves one successful range, unmounts, remounts, and expects the cached range on the first render:

```tsx
expect(result.current).toMatchObject({
  from: "2026-03-16",
  to: "2026-07-30",
  loading: false,
});
```

Run:

```powershell
npm --prefix dashboard test -- --run src/hooks/use-usage-date-bounds.test.tsx
```

Expected: FAIL because the current hook always starts with `from: null`.

- [ ] **Step 5: Persist and reuse successful date bounds**

Use a timezone-specific localStorage key such as:

```ts
`token-eyes:usage-date-bounds:${timeZone || "local"}:${tzOffsetMinutes ?? "auto"}`
```

Initialize state synchronously from valid cached `YYYY-MM-DD` values, keep those values while refreshing, and only replace them after a successful response.

- [ ] **Step 6: Stop clearing real usage caches at application mount**

Replace the unconditional application-start purge with a helper that only removes explicitly tagged mock payloads. Because mock-mode hooks do not write real caches, the normal installed runtime must preserve real cached summaries, trends, request rows, provider data, model data, and project usage across restarts.

- [ ] **Step 7: Run focused usage tests**

Run:

```powershell
npm --prefix dashboard test -- --run src/hooks/use-token-service-plans.test.js src/hooks/use-usage-date-bounds.test.tsx src/lib/usage-cache.test.ts
```

Expected: PASS.

### Task 2: Replace reset announcement cards with a compact indexed timeline

**Files:**
- Modify: `dashboard/src/pages/ResetHistoryPage.tsx`
- Modify: `dashboard/src/pages/ResetHistoryPage.test.tsx`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `dashboard/src/content/i18n/zh/dashboard.json`

- [ ] **Step 1: Write failing timeline tests**

Add tests asserting:

```tsx
expect(screen.getByTestId("reset-history-timeline")).toBeInTheDocument();
expect(screen.getAllByTestId("reset-history-node")).toHaveLength(5);
expect(screen.queryByText(event.summary)).not.toBeInTheDocument();
expect(screen.getAllByRole("link", { name: "[1]" })).not.toHaveLength(0);
expect(screen.getByTestId("reset-history-sources")).toHaveTextContent("@thsottiaux");
```

Include two records sharing one URL and assert that both use `[1]`, while a second URL receives `[2]`.

- [ ] **Step 2: Run the reset page test and confirm RED**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/ResetHistoryPage.test.tsx
```

Expected: FAIL because the current page renders grouped large cards and full announcement summaries.

- [ ] **Step 3: Build a deterministic timeline view model**

Inside `ResetHistoryPage.tsx`, sort official events by `occurred_at`, assign source numbers by first URL occurrence, and create a short display sentence from existing localized author, kind, and scope labels:

```ts
const summary = copy("reset_history.timeline.summary", {
  author: sourceLabel,
  kind: kindLabel,
  scope: scopeLabel,
});
```

Do not render `event.summary`.

- [ ] **Step 4: Render the compact timeline and source list**

Use one narrow vertical rule, an emerald node for each record, a compact time column, one short summary line, and a `[n]` source link. Render unique source URLs once in a compact footer index. Keep exact local date and minute.

- [ ] **Step 5: Add localized timeline copy**

Add:

```text
reset_history.timeline.summary
reset_history.timeline.sources
reset_history.timeline.source
```

to `copy.csv` and the generated Chinese dashboard JSON, with a Chinese summary equivalent to `{{author}} · {{kind}} · {{scope}}`.

- [ ] **Step 6: Run reset and copy validation**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/ResetHistoryPage.test.tsx
npm run validate:copy
```

Expected: PASS.

### Task 3: Stage project selection and save it explicitly

**Files:**
- Modify: `dashboard/src/pages/WidgetsPage.jsx`
- Modify: `dashboard/src/pages/WidgetsPage.test.jsx`
- Modify: `dashboard/src/lib/desktop-widget-projects.ts`
- Modify: `dashboard/src/lib/desktop-widget-projects.test.ts`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `dashboard/src/content/i18n/zh/dashboard.json`

- [ ] **Step 1: Rewrite existing tests to require an explicit save**

Assert that checking a project does not call `set_desktop_widget_prefs`, then click the save button:

```jsx
await user.click(screen.getByRole("checkbox", { name: "Website" }));
expect(invoke).not.toHaveBeenCalledWith("set_desktop_widget_prefs", expect.anything());

await user.click(screen.getByRole("button", {
  name: copy("widgets.windows.projects.save"),
}));
expect(invoke).toHaveBeenCalledWith("set_desktop_widget_prefs", {
  prefs: expect.objectContaining({
    selectedProjectIds: ["project-a", "project-b"],
  }),
});
```

Add a test showing up to 10 recent projects and retaining a saved inactive custom folder.

- [ ] **Step 2: Run WidgetsPage tests and confirm RED**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/WidgetsPage.test.jsx src/lib/desktop-widget-projects.test.ts
```

Expected: FAIL because checkboxes currently persist immediately and no save button exists.

- [ ] **Step 3: Introduce saved and draft project state**

Maintain:

```js
const [draftSelectedIds, setDraftSelectedIds] = useState([]);
const [draftProjects, setDraftProjects] = useState([]);
const [saveStatus, setSaveStatus] = useState("idle");
```

Initialize both draft collections from native preferences. Checkbox changes and folder picking update only the draft. Compute a stable dirty flag from ordered IDs and structured project metadata.

- [ ] **Step 4: Separate recent projects from saved inactive folders**

Add a helper returning:

```ts
{
  recent: detected.slice(0, 10),
  savedInactive: selected.filter((item) => !detectedIds.has(item.id)),
}
```

Render “最近活跃项目” and “已选择文件夹” sections. Search filters both sections.

- [ ] **Step 5: Add save and feedback controls**

The “保存并同步” button writes `selectedProjectIds` and `selectedProjects` once, waits for the Tauri command, then shows “已同步到桌面小组件”. On failure keep the draft and show the existing error treatment. “恢复最近活跃项目” changes the draft to current recent IDs but does not persist until save.

- [ ] **Step 6: Add localized project-setting copy**

Add keys for:

```text
widgets.windows.projects.recent_title
widgets.windows.projects.saved_title
widgets.windows.projects.save
widgets.windows.projects.saved
widgets.windows.projects.no_recent
```

- [ ] **Step 7: Run focused widget settings tests**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/WidgetsPage.test.jsx src/lib/desktop-widget-projects.test.ts
```

Expected: PASS.

### Task 4: Synchronize saved preferences into the floating WebView immediately

**Files:**
- Modify: `src-tauri/src/widget_window.rs`
- Modify: `dashboard/src/hooks/use-desktop-widget.ts`
- Create: `dashboard/src/hooks/use-desktop-widget.test.tsx`
- Modify: `test/windows-widget-contract.test.js`
- Modify: `dashboard/src/pages/DesktopWidgetPage.test.tsx`

- [ ] **Step 1: Write a failing hook test for preference reload**

Mock Tauri invoke so the first preference read selects `project-a` and the second selects `project-b`. Dispatch:

```ts
window.dispatchEvent(new Event("token-eyes:desktop-widget-prefs-changed"));
```

Assert the hook reloads preferences and refreshes the widget model without waiting for the 30-second poll.

- [ ] **Step 2: Run the hook test and confirm RED**

Run:

```powershell
npm --prefix dashboard test -- --run src/hooks/use-desktop-widget.test.tsx
```

Expected: FAIL because the hook currently reads native preferences only during initialization.

- [ ] **Step 3: Add a reusable preference reload function**

In `use-desktop-widget.ts`, add `reloadPrefs()` that invokes `get_desktop_widget_prefs`, merges defaults, updates `prefsRef`, updates React state, and refreshes with the restored agent. Register and clean up a listener for `token-eyes:desktop-widget-prefs-changed`.

- [ ] **Step 4: Dispatch the event from Tauri after a successful save**

After `save(&app, &prefs)?` in `set_desktop_widget_prefs`, evaluate this only in the desktop widget WebView:

```rust
let _ = window.eval(
    "window.dispatchEvent(new Event('token-eyes:desktop-widget-prefs-changed'));",
);
```

Update the contract test so the event name and dispatch path cannot silently disappear.

- [ ] **Step 5: Verify inactive selected folders remain visible**

Keep `selectedProjects` as the fallback source for zero-session project rows and change the empty copy to “暂无活跃会话”. Add a regression assertion that the selected label is present after the preference-change event.

- [ ] **Step 6: Run widget hook, page, contract, and Rust tests**

Run:

```powershell
npm --prefix dashboard test -- --run src/hooks/use-desktop-widget.test.tsx src/pages/DesktopWidgetPage.test.tsx
node --test test/windows-widget-contract.test.js
cargo test --manifest-path src-tauri/Cargo.toml widget_window
```

Expected: PASS.

### Task 5: Fix material-panel contrast and bump 0.54.31

**Files:**
- Modify: `dashboard/src/pages/desktop-widget.css`
- Modify: `dashboard/src/pages/DesktopWidgetPage.test.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `TokenTrackerBar/project.yml`
- Modify: `TokenTrackerWin/TokenTrackerWin.csproj`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add a failing material contrast assertion**

Give the dialog a contrast contract attribute:

```tsx
expect(dialog).toHaveAttribute("data-text-contrast", "light");
```

and assert each material label is inside the contrast-controlled dialog.

- [ ] **Step 2: Run the DesktopWidgetPage test and confirm RED**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/DesktopWidgetPage.test.tsx
```

Expected: FAIL because the contract attribute and explicit white foreground do not exist.

- [ ] **Step 3: Apply explicit white foreground styles**

Add:

```css
.widget-appearance {
  color: #fff;
}

.widget-material-option span {
  color: rgba(255, 255, 255, 0.92);
}
```

Keep the opacity label and value at high-contrast white. Add `data-text-contrast="light"` to the dialog.

- [ ] **Step 4: Bump all desktop version values to 0.54.31**

Update the npm package/lock entries, both macOS marketing values, the legacy Windows metadata, Tauri package/Cargo lock, Tauri config version, and versioned embedded runtime path.

- [ ] **Step 5: Run focused tests and validators**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/DesktopWidgetPage.test.tsx
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
```

Expected: PASS.

### Task 6: Full regression and installed-user acceptance

**Files:**
- Create temporarily under repository: `.acceptance/`
- Build output: `src-tauri/target/release/bundle/nsis/Token Eyes_0.54.31_x64-setup.exe`

- [ ] **Step 1: Run the complete local CI**

Run:

```powershell
npm run ci:local
```

Expected: exit code 0 with no failed test suites.

- [ ] **Step 2: Build the Windows installer**

Run:

```powershell
npm run tauri:build
```

Expected: dashboard build, bundled runtime smoke, Rust tests, and NSIS deploy/start smoke all succeed.

- [ ] **Step 3: Install inside a repository-local isolated acceptance directory**

Install `Token Eyes_0.54.31_x64-setup.exe` into `.acceptance/installed-0.54.31`, use a repository-local isolated user profile, and enable WebView2 CDP.

- [ ] **Step 4: Verify usage-page repeat entry**

Open usage statistics twice. Assert:

- first visit shows locally saved token services before delayed account refresh completes;
- second visit immediately renders cached summary, trend, and request log;
- background network refresh does not replace content with an empty spinner;
- no visible `1970-01-01` or `1970-01-01`-derived labels.

- [ ] **Step 5: Verify project draft/save synchronization**

Select one recent project and one arbitrary folder. Confirm the floating widget does not change before save, then click “保存并同步” and assert both labels appear within one second. Confirm an inactive folder displays “暂无活跃会话”.

- [ ] **Step 6: Verify reset timeline and material panel visually**

Capture and inspect screenshots confirming:

- at least six compact reset nodes fit in a normal desktop viewport when six records exist;
- source indices link to the correct official URLs;
- full announcement bodies are absent;
- all four material names, the opacity label, and the percentage are white.

- [ ] **Step 7: Record artifact integrity**

Run:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'src-tauri\target\release\bundle\nsis\Token Eyes_0.54.31_x64-setup.exe'
git diff --check
git status --short
```

Expected: installer exists, diff check exits 0, and only intended repository changes remain. Remove repository-local synthetic acceptance data after evidence is collected.
