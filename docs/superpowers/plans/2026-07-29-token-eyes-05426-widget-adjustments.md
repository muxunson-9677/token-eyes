# Token Eyes 0.54.26 Widget Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every requirement in `docs/adjustments/2026-07-29-token-eyes-05425-widget-adjustments.md` and produce a verified Windows NSIS installer for Token Eyes 0.54.26.

**Architecture:** Add one dedicated `/desktop-widget` route to the existing dashboard bundle and host it in one independent, frameless Tauri webview window. The widget consumes privacy-safe projections of the existing session, usage-limit, model-usage, and reset-event data; it does not collect or persist a second copy of those data. Upgrade the current Codex reset monitor to a deduplicated 30-day event ledger, with local `token_count.rate_limits` backfill and delivery state shared by the dashboard banner, Windows notification, tray, and widget.

**Tech Stack:** Node.js 20 CommonJS, React 18, TypeScript, Vitest, Tauri 2, Rust 1.85, WebView2, Windows NSIS.

---

## Confirmed implementation decisions

- The referenced adjustment document is the authoritative, already-approved design. Conflicting six-second auto-dismiss behavior in older files must not be restored.
- The Windows widget is a single Tauri window and a single visual card. Expanded and collapsed states are React states inside that window.
- The widget is opened from the existing Widgets page. Once the user has enabled it, its visible state is restored on restart. It defaults to always-on-top and exposes a compact toggle.
- The widget route stays inside the existing dashboard build so it can reuse copy, provider icons, formatting, API authentication, and query behavior.
- A widget view-model endpoint may aggregate existing data for a smaller payload, but it may not scan logs or create another persisted statistics channel.
- Codex project/conversation status uses reliable local lifecycle evidence. Agents without equivalent evidence expose an unknown/empty state.
- Reset records use a provider-neutral DTO, while 0.54.26 detection is backed by the available Codex official and local snapshot evidence.
- Historical backfill writes ledger records only. Only a newly observed live reset is deliverable as an alert.

## File map

### New files

- `src/lib/codex-reset-rollout-reader.js` — streamed, metadata-only extraction of Codex `token_count.rate_limits` snapshots.
- `test/codex-reset-rollout-reader.test.js` — privacy, cursor, cutoff, malformed-line, and multiple-window coverage.
- `src/lib/widget-view-model.js` — pure aggregation of existing session, limits, model, and reset DTOs.
- `test/widget-view-model.test.js` — agent filtering, status counting, empty states, sorting, and sanitization.
- `dashboard/src/pages/DesktopWidgetPage.tsx` — the one-card capsule/expanded widget.
- `dashboard/src/pages/DesktopWidgetPage.test.tsx` — interaction and persistent-reset-alert behavior.
- `dashboard/src/pages/desktop-widget.css` — scoped glass material, compact layout, one-scroll-region, and menu layers.
- `dashboard/src/hooks/use-desktop-widget.ts` — shared polling and Tauri preference bridge.
- `dashboard/src/hooks/__tests__/use-desktop-widget.test.tsx` — polling, persisted selection, and acknowledgement tests.
- `src-tauri/src/widget_window.rs` — window creation, preference persistence, display clamping, show/hide, and always-on-top commands.
- `test/windows-widget-contract.test.js` — static release contract for route, window flags, privacy, and installer inclusion.

### Modified files

- `src/lib/codex-reset-monitor.js` — state v2, 30-day retention, richer event DTO, manual reset and source dedup.
- `src/lib/codex-reset-monitor-service.js` — startup backfill and “persist before deliver” lifecycle.
- `src/lib/codex-reset-monitor-store.js` — v1 migration and bounded atomic persistence.
- `src/lib/usage-limits.js` — allowlisted reset-credit metadata and stable private account key.
- `src/lib/local-api.js` — sanitized 30-day reset history, delivery lifecycle, and widget view-model endpoint.
- `src/lib/rollout.js` — expose the already parsed rate-limit metadata to the reset reader without retaining message bodies.
- `test/codex-reset-monitor*.test.js` — normal/manual/backfill/dedup/retention tests.
- `test/local-api-codex-reset-*.test.js` — end-to-end history and delivery tests.
- `test/codex-reset-privacy-contract.test.js` — prohibit prompt, response, credentials, and full paths.
- `dashboard/src/lib/api.ts` — widget and richer reset DTO contracts.
- `dashboard/src/hooks/use-codex-reset-events.ts` — shared delivery/acknowledgement state.
- `dashboard/src/pages/ResetHistoryPage.tsx` — grouped local-time 30-day history.
- `dashboard/src/components/CodexResetBanner.tsx` — completed-reset-only green banner.
- `dashboard/src/pages/WidgetsPage.jsx` — Windows open/show/hide widget controls while retaining macOS content.
- `dashboard/src/App.jsx` — eager desktop-widget route branch without `AppLayout`.
- `dashboard/src/content/copy.csv` and generated locale JSON — all new user-facing strings.
- `dashboard/src/ui/dashboard/components/ProviderIcon.jsx` — reuse official provider and Token Eyes assets in the widget.
- `dashboard/src/ui/dashboard/components/UsageLimitsPanel.jsx` — clearer account label, refresh state, and per-account failure treatment without account switching.
- `src-tauri/src/lib.rs` — register widget commands, window lifecycle, and native notification handling.
- `src-tauri/src/tray.rs` — widget visibility entry and reset unread acknowledgement wiring.
- `src-tauri/src/window_control.rs` — keep main-window close behavior isolated from widget visibility.
- `src-tauri/tauri.conf.json` and `src-tauri/tauri.windows.conf.json` — widget capability/window configuration.
- `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` — notification dependency if not already present.
- `package.json`, `package-lock.json`, `TokenTrackerBar/project.yml`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` — lockstep 0.54.26 version.

## Task 1: Freeze failing acceptance contracts

- [ ] Add failing Node contracts for the authoritative requirements.

  Tests must assert:

  ```js
  assert.equal(RESET_HISTORY_DAYS, 30);
  assert.equal(history.length, 4, "history is not capped at three");
  assert.equal(unread[0].deliveryState.widgetAcknowledged, false);
  assert.equal(source.includes("setTimeout(() => dismiss"), false);
  assert.equal(tauriConfig.bundle.targets.includes("nsis"), true);
  ```

- [ ] Add failing React tests for one-card rendering, the three fixed traffic lights, independent agent/mode menus, single scroll region, appearance overlay, and a reset alert that remains until clicked.
- [ ] Add failing Rust tests for restoring position/size, clamping to a visible monitor, and excluding the widget from main-window close interception.
- [ ] Run the focused suites and confirm the new assertions fail for missing 0.54.26 behavior:

  ```powershell
  node --test test/codex-reset-monitor.test.js test/windows-widget-contract.test.js
  npm --prefix dashboard test -- --run src/pages/DesktopWidgetPage.test.tsx
  cargo test --manifest-path src-tauri/Cargo.toml --lib widget_window
  ```

## Task 2: Upgrade reset state to a 30-day ledger

- [ ] Add fixture-driven failing tests for normal cycle resets, reset-credit redemption, duplicate observations, clock changes, 30-day retention, and v1 migration.
- [ ] Replace count-based compaction with time-based retention:

  ```js
  const RESET_HISTORY_DAYS = 30;
  const RESET_HISTORY_MS = RESET_HISTORY_DAYS * 24 * 60 * 60 * 1000;
  ```

- [ ] Persist sanitized event fields: `id`, `agent`, `accountKey`, `window`, `kind`, `occurredAt`, `observedAt`, `beforeUsedPercent`, `afterUsedPercent`, `sources`, and per-channel delivery/acknowledgement state.
- [ ] Build event identity from normalized agent/account/window/kind and the authoritative occurrence window, so official polling and local rollout observations merge.
- [ ] Mark startup/backfill events as historical and non-deliverable; mark only newly confirmed live events deliverable.
- [ ] Run:

  ```powershell
  node --test test/codex-reset-monitor.test.js test/codex-reset-monitor-store.test.js
  ```

  Expected: all reset ledger and migration tests pass.

## Task 3: Parse privacy-safe local reset snapshots

- [ ] Write failing tests using JSONL fixtures that contain prompt and tool fields beside `token_count.rate_limits`; assert the returned objects contain only timestamp, account/window, usage percentage, reset time, and reset-credit count.
- [ ] Implement a streamed reader with a 30-day cutoff and byte cursor. It must ignore unrelated JSONL payloads without copying them into state or errors.
- [ ] Support both top-level and nested `payload.msg` `token_count` envelopes.
- [ ] Feed extracted snapshots into the same ledger evaluator used by official usage polling.
- [ ] Run:

  ```powershell
  node --test test/codex-reset-rollout-reader.test.js test/codex-reset-monitor-service.test.js test/codex-reset-privacy-contract.test.js
  ```

  Expected: snapshot recovery and privacy contracts pass.

## Task 4: Expose one sanitized reset lifecycle

- [ ] Add failing API tests for grouped 30-day history fields, live delivery claims, widget acknowledgement, tray acknowledgement, and idempotent duplicate requests.
- [ ] Extend the local reset DTO without exposing raw account IDs, authentication values, source paths, prompt text, response text, tool arguments, or command output.
- [ ] Persist an event before returning it as newly deliverable.
- [ ] Keep Windows notification failure independent of banner, tray, and widget unread state.
- [ ] Update the React hook so each channel observes the same event ID and acknowledgement only clears the requested unread surface.
- [ ] Run:

  ```powershell
  node --test test/local-api-codex-reset-events.test.js test/local-api-codex-reset-lifecycle.test.js test/codex-reset-privacy-contract.test.js
  npm --prefix dashboard test -- --run src/hooks/__tests__/use-codex-reset-events.test.tsx
  ```

## Task 5: Build the shared widget view model

- [ ] Write failing pure tests for:

  ```js
  {
    agents: ["all", "claude", "codex", "cursor", "hermes"],
    projectStatus: { red: 0, yellow: 0, green: 0, projects: [] },
    limits: [],
    totals: { tokens: 0, costUsd: 0, models: [] },
    pendingReset: null
  }
  ```

- [ ] Reuse current local usage summary, model stats, usage limits, and reliable session status inputs. Do not read queues or rollout files from this module.
- [ ] Normalize project/session/account display keys through existing privacy-safe identifiers.
- [ ] Sort project details by red, yellow, green urgency; keep only one expanded project in UI state.
- [ ] Sort models by token share and usage windows by product importance.
- [ ] Add a no-store local API route with optional `agent` filter and bounded payload sizes.
- [ ] Run:

  ```powershell
  node --test test/widget-view-model.test.js test/local-api-source-scope.test.js
  ```

## Task 6: Create and persist the independent Tauri window

- [ ] Write failing Rust tests for default `322 × 72` dimensions, minimum dimensions, resizability, decoration off, transparent background, always-on-top, monitor clamping, and JSON preference migration.
- [ ] Implement `widget_window.rs` with commands:

  ```rust
  show_desktop_widget
  hide_desktop_widget
  get_desktop_widget_prefs
  set_desktop_widget_prefs
  set_desktop_widget_always_on_top
  ```

- [ ] Persist visible state, position, physical size, scale factor, selected agent, mode, expanded state, material, opacity, and always-on-top.
- [ ] Clamp restored geometry against current monitors after monitor/DPI changes.
- [ ] Ensure closing or minimizing the main window does not hide or stop the widget.
- [ ] Add tray actions to show/hide the widget without opening the main window.
- [ ] Run:

  ```powershell
  cargo test --manifest-path src-tauri/Cargo.toml --lib widget_window
  cargo test --manifest-path src-tauri/Cargo.toml --lib window_control
  cargo test --manifest-path src-tauri/Cargo.toml --lib tray
  ```

## Task 7: Implement the one-card desktop capsule

- [ ] Use the UI/UX design skill and existing Token Eyes tokens before styling.
- [ ] Write failing component tests for:
  - main icon toggles expanded state;
  - adjacent arrow opens agent menu without toggling;
  - mode button opens exactly three modes;
  - menus render in an unclipped overlay layer;
  - red/yellow/green lights are always present and zero counts are gray;
  - limits combine a progress graphic and percentage;
  - model capsule contains only token total and cost;
  - expanded content has one `data-widget-scroll-region`;
  - agent/mode changes do not resize or add cards;
  - appearance overlay exposes four presets and an opacity slider;
  - long model names truncate at default width.
- [ ] Add the route before `AppLayout` selection so the widget does not inherit sidebar/header/footer.
- [ ] Use official icons through `ProviderIcon` and the existing Token Eyes product icon.
- [ ] Add keyboard focus, tooltips, reduced-motion handling, contrast-safe opacity, and non-overlapping drag/scroll/resize hit regions.
- [ ] Poll the shared view model without changing window geometry when data grows.
- [ ] Run:

  ```powershell
  npm --prefix dashboard test -- --run src/pages/DesktopWidgetPage.test.tsx src/hooks/__tests__/use-desktop-widget.test.tsx
  npm --prefix dashboard run build
  ```

## Task 8: Make reset alert persistent and deliver Windows surfaces

- [ ] Add failing tests proving there is no timer-based dismissal and hidden/restarted widgets restore the same pending alert.
- [ ] When a new live reset is persisted, trigger Windows native notification with sound, green main-window banner, tray unread state, and widget pending state using the same event ID.
- [ ] In the widget, replace the current capsule content in-place, keep dimensions unchanged, pulse twice, then stay highlighted indefinitely.
- [ ] On widget alert click: acknowledge widget and tray unread for that event; restore prior agent/mode/expanded state; do not open the main window, history, or another route.
- [ ] Keep the ledger record in 30-day history.
- [ ] Hide macOS-only animated-icon and confetti settings on Windows without changing macOS behavior.
- [ ] Run focused Node, React, and Rust alert tests.

## Task 9: Improve existing multi-account refresh presentation

- [ ] Add failing tests for distinct privacy-safe account labels, per-account refreshing state, aggregate refresh progress, and visible per-account errors.
- [ ] Update the existing usage-limit/service list only; do not add a new overview page or account switching.
- [ ] Keep successful accounts visible when one refresh fails.
- [ ] Run:

  ```powershell
  npm --prefix dashboard test -- --run src/ui/dashboard/components/UsageLimitsPanel.test.jsx
  node --test test/usage-limits.test.js test/usage-limits-singleflight.test.js
  ```

## Task 10: Version, verify, and build the installer

- [ ] Set all five release values to `0.54.26` and update lockfiles/runtime resource path.
- [ ] Run the complete validation suite:

  ```powershell
  npm run ci:local
  cargo test --manifest-path src-tauri/Cargo.toml
  npm --prefix dashboard test -- --run
  node --test test/release-version-consistency.test.js test/windows-installer-hooks.test.js test/windows-installer-icon-config.test.js
  ```

- [ ] Use Playwright/screenshot verification at default, minimum, widened, and tall widget sizes; verify menus are not clipped and the single-scroll-region behavior is visible.
- [ ] Build the release:

  ```powershell
  npm run tauri:build
  ```

- [ ] Verify the generated NSIS `.exe` version metadata, bundled `EmbeddedServer-0.54.26`, installer smoke tests, SHA-256, and file size.
- [ ] Deliver the absolute installer path and checksum for the user's cover-install verification.

## Plan self-review

- Spec coverage: sections 3–12 map to Tasks 5–9; sections 13–18 map to Tasks 2–4 and 8; release acceptance maps to Task 10.
- Conflict check: no task implements automatic reset-alert dismissal or click-through navigation.
- Privacy check: the only new rollout reader returns allowlisted metadata and never persists source paths or message bodies.
- Scope check: no budget, exhaustion alert, account/model/MCP/Skill switcher, hardware light, or second widget/statistics channel is included.
- Type consistency: reset event, widget view model, Tauri preferences, and channel acknowledgement each have one named contract used across backend, dashboard, and native code.
