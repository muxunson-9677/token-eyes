# Widget Active Window and Reset Statistics Design

## Scope

This change adds only:

1. A configurable active-session window for the Windows desktop widget.
2. Compact statistics for the existing 30-day official Codex extra-reset timeline.

It does not change the widget layout, project selection behavior, modes, materials, reset alerts, leaderboard, usage statistics, or any previously approved behavior.

## Active-session window

The desktop-widget preferences gain `activeSessionWindow` with the allowed values `1h`, `3h`, `5h`, `1d`, and `3d`. The default is `1h`; the old 30-minute window is removed. Invalid and legacy values normalize to `1h`.

The Widgets page displays a compact select control inside the existing project-settings card. Changing it only updates the draft. The existing **Save and sync** action persists the selected projects and active-session window together, then notifies the open floating widget.

The floating widget passes the selected value to the local widget endpoint. The endpoint and shared widget view-model builder use the same validated value when deciding which sessions are active. Recent-project suggestions remain independent of this window, so users can still select inactive folders.

## Reset statistics

The reset-history page continues to show only official extra-reset announcements from the most recent 30 days. A compact statistics strip appears above the timeline with:

- period: last 30 days;
- official reset count;
- average adjacent-event interval;
- shortest adjacent-event interval;
- longest adjacent-event interval.

Intervals use valid `occurred_at` timestamps, sorted chronologically, and are calculated only between adjacent official reset events. With fewer than two valid events, all interval values show the same insufficient-data state. Durations are rendered in minutes, hours, or days plus hours.

## Verification

- Rust preference tests cover the new default, allowlist normalization, and merge behavior.
- Node view-model and local API tests cover every allowed window and rejection of invalid values to the one-hour default.
- React hook and Widgets-page tests cover restoration, draft changes, Save-and-sync persistence, and immediate widget refresh.
- Reset statistics have pure calculation tests plus page rendering tests.
- The full local CI and Windows Tauri installer/runtime smoke checks must pass before delivery.
