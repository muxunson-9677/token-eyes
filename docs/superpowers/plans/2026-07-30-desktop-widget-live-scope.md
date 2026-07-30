# Desktop Widget Live Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the installed Windows widget honor selected project folders and enabled providers, show only the newest 10 sessions active within 30 minutes, and open compact controls as external vertical popovers.

**Architecture:** Correct session scope in the shared Node view-model, persist structured local project selections in Tauri preferences, and render selected empty projects in the dashboard. Keep popovers in the widget WebView but temporarily expand its transparent native window without persisting that geometry. Restore Usage statistics to the existing Limits visibility source of truth.

**Tech Stack:** Node.js CommonJS, React 18/Vitest, Tauri 2/Rust, CSS, NSIS.

---

### Task 1: Enforce live project-session scope

**Files:**
- Modify: `src/lib/widget-view-model.js`
- Test: `test/widget-view-model.test.js`
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-desktop-widget.test.js`

- [ ] **Step 1: Write failing view-model tests**

Add tests that pass a fixed `nowMs`, include stale red/yellow/green rows plus 12 fresh rows, and assert that stale rows disappear and only the newest 10 remain:

```js
const model = buildWidgetViewModel({
  nowMs: Date.parse("2026-07-30T00:30:00.000Z"),
  sessions: [
    staleSession("red", "2026-07-29T23:59:59.999Z"),
    ...freshSessions(12),
  ],
});
assert.equal(model.projectStatus.red, 0);
assert.equal(
  model.projectStatus.projects.flatMap((project) => project.sessions).length,
  10,
);
```

- [ ] **Step 2: Verify the tests fail for stale counts and more than 10 rows**

Run:

```powershell
node --test test/widget-view-model.test.js
```

Expected: the new assertions fail because `buildProjectStatus` currently keeps 30 days of lifecycle rows.

- [ ] **Step 3: Implement the time and count boundary**

Add:

```js
const ACTIVE_SESSION_MS = 30 * 60_000;
const MAX_ACTIVE_SESSIONS = 10;
```

Pass `nowMs` into `buildProjectStatus`, deduplicate, reject invalid timestamps, retain timestamps in `[nowMs - ACTIVE_SESSION_MS, nowMs]`, sort newest first, and slice to `MAX_ACTIVE_SESSIONS` before aggregation.

- [ ] **Step 4: Pass the local API clock into the view model**

Update the desktop-widget endpoint to call:

```js
const now = nowProvider();
const viewModel = buildWidgetViewModel({
  nowMs: now.getTime(),
  agent: url.searchParams.get("agent") || "all",
  usage,
  sessions,
  limits: flattenUsageLimitsPayload(usageLimits),
  pendingResets: codexResetMonitorService.listUnread("widget"),
});
```

- [ ] **Step 5: Verify focused Node tests pass**

Run:

```powershell
node --test test/widget-view-model.test.js test/local-api-desktop-widget.test.js
```

Expected: all focused tests pass with zero failures.

### Task 2: Persist multiple selected project folders safely

**Files:**
- Modify: `src-tauri/src/widget_window.rs`
- Modify: `dashboard/src/lib/api.ts`
- Create: `dashboard/src/lib/desktop-widget-projects.ts`
- Create: `dashboard/src/lib/desktop-widget-projects.test.ts`
- Modify: `dashboard/src/pages/WidgetsPage.jsx`
- Test: `dashboard/src/pages/WidgetsPage.test.jsx`
- Modify: `dashboard/src/pages/DesktopWidgetPage.tsx`
- Test: `dashboard/src/pages/DesktopWidgetPage.test.tsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Write failing preference and helper tests**

Cover preference migration/deduplication in Rust and path-to-project metadata in Vitest:

```ts
const project = await widgetProjectFromPath("D:\\Work\\Example");
expect(project.id).toMatch(/^project-[a-f0-9]{12}$/);
expect(project.label).toBe("Example");
expect(project.path).toBe("D:\\Work\\Example");
```

Add a Widgets-page test that resolves two folder selections before the first native write completes and expects the final write to contain both selections.

- [ ] **Step 2: Verify the new tests fail**

Run:

```powershell
npm --prefix dashboard test -- --run src/lib/desktop-widget-projects.test.ts src/pages/WidgetsPage.test.jsx
cargo test --manifest-path src-tauri/Cargo.toml widget_window --lib
```

Expected: TypeScript test fails because the helper and `selectedProjects` contract do not exist; Rust test fails because preferences are still version 3.

- [ ] **Step 3: Add structured project preferences**

Add this Rust shape and bump `PREFS_VERSION` to 4:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetProjectSelection {
    pub id: String,
    pub label: String,
    pub path: String,
}
```

Add `selected_projects: Vec<WidgetProjectSelection>` to `WidgetPrefs`. Normalize IDs, labels, paths, duplicates, and maximum count without discarding legacy `selected_project_ids`.

- [ ] **Step 4: Add stable folder metadata**

Implement `widgetProjectFromPath()` with the same normalization and SHA-256 first-12-hex rule as `codex-lifecycle-reader.js`. Reject empty paths and derive the display label from the final path component.

- [ ] **Step 5: Make selection updates atomic and serialized**

Use `prefsRef` and a promise queue in `WindowsWidgetProjectSettings`:

```js
const queuePreferenceWrite = (buildNext) => {
  const next = buildNext(prefsRef.current);
  prefsRef.current = next;
  setPrefs(next);
  writeQueueRef.current = writeQueueRef.current.then(() =>
    invoke("set_desktop_widget_prefs", { prefs: next })
  );
  return writeQueueRef.current;
};
```

Checkbox changes and folder additions must use functional builders so rapid updates form a union instead of competing snapshots.

- [ ] **Step 6: Add the native folder-picker action**

Use `selectDirectoryViaTauri()` first and `selectLocalDirectory()` as fallback. On selection, create structured metadata, append it if unique, and keep its ID in `selectedProjectIds`. Add copy keys for “添加项目文件夹”, “已选择的文件夹”, cancellation, and save failure.

- [ ] **Step 7: Merge selected empty projects into widget display**

Replace the ID-only filter with a helper that:

```ts
selectedProjects.map((selection) =>
  liveById.get(selection.id) ?? emptyProject(selection)
)
```

Legacy IDs still match live projects. Empty selected folders render the project label and the existing “无数据” empty state with all three lights gray.

- [ ] **Step 8: Verify folder selection tests pass**

Run the Vitest and Rust commands from Step 2.

Expected: all focused tests pass, including simultaneous selections and empty-project rendering.

### Task 3: Open controls as vertical external popovers

**Files:**
- Modify: `src-tauri/src/widget_window.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `dashboard/src/pages/DesktopWidgetPage.tsx`
- Modify: `dashboard/src/pages/desktop-widget.css`
- Test: `dashboard/src/pages/DesktopWidgetPage.test.tsx`
- Test: `test/windows-widget-contract.test.js`

- [ ] **Step 1: Write failing widget interaction tests**

Assert:

```ts
expect(agentMenu).toHaveAttribute("data-layout", "vertical");
expect(agentMenu.parentElement).toBe(document.body);
expect(appearance.parentElement).toBe(document.body);
expect(within(card).queryByRole("slider")).not.toBeInTheDocument();
```

Also assert that opening and closing a menu invokes `set_desktop_widget_popover` with a panel height and then `null`.

- [ ] **Step 2: Verify interaction tests fail**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/DesktopWidgetPage.test.tsx
```

Expected: the appearance panel is still inside the card and the compact CSS still has horizontal menu rules.

- [ ] **Step 3: Add transient native geometry**

Add a module-level transient flag so move/resize events do not persist popover geometry. Add:

```rust
#[tauri::command]
pub fn set_desktop_widget_popover(
    app: AppHandle,
    height: Option<u32>,
) -> Result<(), String>
```

When `height` is present, expand to at least that logical height and clamp the temporary geometry inside the current monitor. When absent, restore saved geometry. Register the command in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Portal all three panels**

Use one portal popover component for agent, mode, and appearance. Open agent/mode at about 235 logical pixels and appearance at about 190 pixels. Close on selection, Escape, outside click, or blur; every close restores native geometry.

- [ ] **Step 5: Remove compact horizontal rules**

Delete the `@media (max-height: 120px)` horizontal grid flow. Keep `.widget-menu` as a vertical grid and give the appearance portal its own fixed-width panel class. The closed widget remains 322×72.

- [ ] **Step 6: Verify interaction and Rust tests**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/DesktopWidgetPage.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml widget_window --lib
node --test test/windows-widget-contract.test.js
```

Expected: all commands pass and no popup geometry is persisted as capsule geometry.

### Task 4: Restore provider visibility as the Usage statistics scope

**Files:**
- Modify: `dashboard/src/pages/SpendPage.jsx`
- Test: `dashboard/src/pages/SpendPage.test.jsx`
- Test: `dashboard/src/hooks/__tests__/usage-visible-scope.test.tsx`

- [ ] **Step 1: Write the failing regression test**

Mock:

```js
useLimitsDisplayPrefs.mockReturnValue({ visibleOrdered: ["claude", "codex"] });
```

Render Usage statistics and assert that summary, trend, request, provider, and model queries are scoped to `claude,codex`, with no Cursor or Hermes source. Add an empty-visibility case that does not fetch all providers.

- [ ] **Step 2: Verify the test exposes the regression**

Run:

```powershell
npm --prefix dashboard test -- --run src/pages/SpendPage.test.jsx src/hooks/__tests__/usage-visible-scope.test.tsx
```

Expected: the new test fails because `SpendUsagePageInner` currently constructs all dashboard agents.

- [ ] **Step 3: Restore the existing source of truth**

Replace the all-agent constant with:

```js
const { visibleOrdered } = useLimitsDisplayPrefs();
const visibleProviderIds = useMemo(
  () => normalizeVisibleProviderIds(visibleOrdered),
  [visibleOrdered],
);
```

Do not add a fallback to all sources when the allowlist is empty.

- [ ] **Step 4: Verify focused usage tests pass**

Run the command from Step 2 and confirm zero failures.

### Task 5: Full build and installed-user acceptance

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `TokenTrackerBar/project.yml`
- Modify: `TokenTrackerWin/TokenTrackerWin.csproj`

- [ ] **Step 1: Run the full repository gate**

Run:

```powershell
npm run ci:local
npm run tauri:verify-runtime
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Bump all product versions in lockstep**

Increment 0.54.29 to the next patch version in every release location listed above and update lockfiles.

- [ ] **Step 3: Build the final Windows installer**

Run:

```powershell
npx tauri build
```

Expected: the matching NSIS setup executable is generated under `src-tauri/target/release/bundle/nsis`.

- [ ] **Step 4: Overwrite-install and launch the built package**

Install into a repository-local acceptance target, verify the registry uninstall entry points to the new version, and launch the installed executable rather than `npm run dev`.

- [ ] **Step 5: Exercise the four real user flows**

Using the installed Tauri app and real Token Eyes local data:

1. Pick two project folders rapidly and confirm both remain selected after restart.
2. Confirm only sessions active within 30 minutes appear, no more than 10, and inactive selected projects show “无”.
3. Open Agent, Module, and Appearance near the monitor edge; confirm vertical external panels and restored capsule size after close.
4. Toggle provider visibility and confirm Usage statistics, trend, request log, provider table, and model table contain only enabled sources.

- [ ] **Step 6: Capture evidence and hash the installer**

Save installed-app screenshots under `src-tauri/target/ux-acceptance-<version>/`, record installer size and SHA-256, and report any remaining mismatch instead of declaring completion.

No Git commit, push, or release is included without separate user authorization.
