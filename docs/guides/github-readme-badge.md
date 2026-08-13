# GitHub README badge (`tokentracker-badge`)

Status: **code-only deliverable — not deployed yet** (W10). The edge function lives at
`dashboard/edge-patches/tokentracker-badge.ts` and follows the same InsForge edge style as the
other `tokentracker-*` functions in that directory.

## What it renders

A self-contained SVG stat card for a public leaderboard profile, safe to embed in any
GitHub README:

- Weekly tokens (current ISO Monday-start week, same window as the leaderboard)
- Weekly estimated spend
- Top model of the week

Errors never break the image: every failure path renders a valid error-state SVG instead of
JSON. Responses are cached for 1 hour (`Cache-Control: public, max-age=3600`). The palette is
GitHub-dark based and reads fine on light backgrounds too.

## Embedding

```markdown
![Token Eyes](https://www.tokentracker.cc/functions/tokentracker-badge?profile=<public-profile-id>)
```

`profile` is the public profile id (the same `user_id` UUID the leaderboard profile endpoint
accepts). `user_id` is accepted as an alias for consistency with `tokentracker-badge-svg.ts`.

## Data access

- Weekly tokens / est. spend: `tokentracker_leaderboard_snapshots_v2` (period=week,
  metric=tokens, source=all), exactly like `tokentracker-badge-svg.ts`.
- Top model: single-user week-window scan of `tokentracker_hourly`, a simplified copy of
  `scanHourlyForUser` in `tokentracker-leaderboard-profile.ts` (account-level sources deduped
  across devices; machine-level sources summed across active devices only).
- Blocked users are excluded via `LEADERBOARD_BLOCKED_USER_IDS`, mirroring every other public
  read path.

## Deploying later

Deploy it the same way as the other edge patches in `dashboard/edge-patches/` (InsForge edge
function named `tokentracker-badge`). No schema changes are required.
