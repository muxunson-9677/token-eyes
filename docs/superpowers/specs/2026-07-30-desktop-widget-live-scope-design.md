# Desktop Widget Live Scope Design

## Goal

Make the Windows desktop widget reflect the user's selected project folders and enabled limit providers, while showing only genuinely recent task activity in a compact card whose controls open as usable dropdowns outside the card surface.

## Confirmed user rules

- A task session is active for widget purposes only when its latest activity is within the last 30 minutes.
- At most 10 active sessions are shown across the selected projects.
- When a selected project has no active session, the widget shows the project with an empty state rather than historical traffic-light counts.
- Usage statistics follow the same provider visibility switches used by the Limits display.
- Agent and module controls are vertical dropdowns.
- Material and opacity controls open outside the visible capsule instead of covering its content.

## Root causes

1. The Widgets page derives checkbox updates from a rendered `selectedIds` array. Rapid selections can issue overlapping full-preference writes based on stale state, so a later write removes an earlier selection.
2. `buildProjectStatus` accepts every lifecycle record from the 30-day collector. Old `task_started`, interrupted, error, and completed records remain counted indefinitely.
3. The compact-height CSS media query intentionally changes menus into horizontal strips. The appearance panel is absolutely positioned inside the card.
4. `SpendUsagePageInner` constructs visibility from every dashboard agent instead of `useLimitsDisplayPrefs().visibleOrdered`, overriding the user's saved provider switches.

## Considered approaches

### A. Frontend-only filtering

Filter old sessions in `DesktopWidgetPage`, keep only project IDs, and change the CSS menus.

This is small but leaves incorrect counts in the local API, cannot represent a user-selected folder with no session history, and keeps other widget consumers exposed to stale data.

### B. Shared data-contract correction (selected)

Filter and cap sessions in the widget view-model builder, represent selected folders as structured native preferences, and let the settings page add folders through the existing native directory picker. Render dropdowns and appearance controls in document-level portals while temporarily expanding the transparent native window.

This fixes the data once at its source, supports empty selected folders, preserves local privacy, and keeps the capsule compact when controls are closed.

### C. Separate native popup windows

Create independent Tauri windows for agent, mode, and appearance popovers.

This gives native-like window boundaries but adds window lifecycle, focus, positioning, and multi-monitor complexity that is unnecessary for these small controls.

## Data model

`WidgetPrefs` moves to version 4 and adds `selectedProjects`, an array of:

```text
{
  id: stable project hash,
  label: folder name,
  path: local absolute folder path
}
```

Existing `selectedProjectIds` are retained during migration so current choices do not disappear. Newly selected folders populate both the structured entries and the ID allowlist. Preference normalization removes duplicate IDs, caps entries, rejects control characters, and keeps all data local.

The settings page uses functional state updates plus serialized preference writes. Selecting two folders rapidly therefore produces the union of both choices instead of two competing snapshots.

## Activity calculation

The widget view-model receives the current time and applies these rules before project aggregation:

1. Deduplicate by agent and session ID, keeping the newest record.
2. Drop sessions with missing/invalid timestamps.
3. Drop sessions older than 30 minutes.
4. Sort the remaining sessions by newest activity first.
5. Keep at most 10 sessions across all projects.
6. Aggregate traffic-light counts from only those sessions.

Selected folder placeholders are merged after filtering. A selected folder with no matching recent session has zero red, yellow, green, and unknown counts and an empty session list.

## Widget interaction

- Clicking the Agent or Module icon opens a vertical portal menu anchored under the control.
- Clicking Material opens a portal panel containing four material choices and the opacity slider.
- Opening a portal asks the Tauri host to enlarge the transparent widget window enough to contain the panel. If the widget is near a monitor edge, the native geometry helper shifts the temporary window inside the visible monitor.
- Closing the portal, choosing an item, pressing Escape, or losing focus restores the saved widget size and position.
- Temporary popup geometry is never persisted as the user's capsule or expanded-card size.

## Usage visibility

`SpendUsagePageInner` reads `visibleOrdered` from `useLimitsDisplayPrefs`, normalizes that allowlist, and supplies it to summaries, trend data, request logs, provider statistics, and model statistics. When no provider is enabled, usage panels show the existing empty allowlist state and do not silently fall back to all providers.

## Failure behavior

- Cancelling the folder picker changes nothing.
- A selected folder that has no tracked history remains selectable and shows an empty project state.
- Preference persistence failure restores the last confirmed preferences and shows the existing load/save failure treatment rather than pretending the selection succeeded.
- If temporary window expansion fails, the menu remains keyboard accessible and the capsule preferences remain unchanged.

## Verification

Automated regression coverage must reproduce:

- two rapid project selections persist together;
- an arbitrary picked folder with no history appears as an empty selected project;
- stale red/yellow/green sessions are excluded;
- only the newest 10 sessions within 30 minutes are returned;
- menus remain vertical at the default 72-pixel capsule height;
- appearance controls are portaled outside the card;
- usage queries include only enabled limit providers, including the empty-provider case.

Final acceptance is performed against a newly built and overwrite-installed Windows package using the real local preference file and local Token Eyes data:

- select two project folders and observe both in the widget;
- verify inactive projects show no false traffic lights;
- open and close all three external dropdown/panels near a screen edge;
- toggle providers in Limits display and confirm Usage statistics changes to the same set;
- restart Token Eyes and confirm all selections persist.
