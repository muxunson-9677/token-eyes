# Token Eyes leaderboard v2 InsForge migrations

This directory is the isolated migration chain for the compact-state leaderboard backend.
It intentionally excludes the repository-root legacy hourly-ingest migrations.

Run InsForge CLI migration commands from this directory after linking the intended project in
`.insforge/project.json`. Never link this directory to the paused legacy Token-Eyes project.

The numbered migrations are exact deployment copies of the matching reviewed SQL files under
`scripts/ops/`; `test/leaderboard-insforge-migrations.test.js` prevents drift.
