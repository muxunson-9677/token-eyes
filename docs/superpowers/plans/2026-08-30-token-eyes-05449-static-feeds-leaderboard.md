# Token Eyes 0.54.49 Static Feeds and Leaderboard Implementation Plan

> Execute in the existing `token-eyes-05449-final` worktree. Preserve all pre-existing dirty changes. The user authorizes the minimum required changes and redeployments to this worktree, the isolated InsForge staging project, and the staging Worker. Do not push, merge, deploy production, purchase/enable a paid service, reset, clean, or overwrite an installed build.

**Goal:** Remove Plan Market, Reset feed, and public leaderboard reads from the InsForge availability boundary while enforcing explicit leaderboard consent, fixed signed Top 50 snapshots, compact participant uploads, bounded refresh, and `$0` degradation gates.

**Architecture:** Public data is emitted as Ed25519-signed versioned JSON objects, stored in the staging Worker's existing SQLite-backed Durable Object, and read anonymously through the same `workers.dev` origin with a globally coherent same-DO memory cache. Mutable JSON responses require revalidation; Cache API is used only for immutable content-addressed avatars. The desktop local API verifies and atomically retains last-known-good snapshots. InsForge remains only for auth, compact participant writes, authenticated `me`, dirty-key refresh coordination, and daily reconciliation. R2, checkout, payment methods, paid subscriptions, KV, D1, and other separately billable resources are prohibited.

**Tech:** Node.js CommonJS local runtime, React/Vite dashboard, InsForge Edge/SQL patches, Cloudflare Workers Free + SQLite Durable Objects, Cache API only for content-addressed avatars, Node test runner, Vitest, TypeScript, ESLint, Tauri/NSIS.

---

## Task 1: Freeze the acceptance and architecture contract

**Files:**
- Create: `docs/0.54.49-static-feeds-leaderboard-design.md`
- Modify: `docs/0.54.49-scope-matrix.md`
- Modify: `docs/0.54.49-progress.md`
- Modify: `docs/0.54.49-final-delivery-report.md`

1. Record AC-01 through AC-09 as blocking user-visible journeys.
2. Record fixed 285 leaderboard keys, signing/LKG, consent state machine, dirty refresh, daily reconciliation, deletion, cost assumptions, degradation, and migration.
3. Mark old “restore InsForge for all public reads” status withdrawn and keep stage `REPAIRING`.
4. Verify with `rg` that no delivery document calls the old public-read restoration a current blocker.

## Task 2: Signed static feed primitives and leaderboard local API

**Files:**
- Create: `test/signed-static-feed.test.js`
- Create: `src/lib/signed-static-feed.js`
- Replace tests: `test/local-api-leaderboard-public.test.js`
- Modify: `src/lib/local-api.js`

1. RED: require canonical Base64URL, Ed25519 signature, exact snapshot key, ISO generated time, max payload bytes, max 50 entries, and replay rejection.
2. RED: local public endpoint maps only fixed period/metric/source to `/v1/leaderboard/...json`, ignores/rejects pagination, sends no credentials, verifies signature, atomically persists LKG, and serves stale LKG on network/validation failure.
3. GREEN: add the smallest shared verifier and disk-backed snapshot store; remove InsForge Function/database fallback and embedded public anon credential from this path.
4. Verify focused Node tests and guardrail contract.

## Task 3: Dashboard static Top 50 read contract

**Files:**
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/__tests__/api-public-visibility.test.ts`
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: `dashboard/src/pages/LeaderboardPage.test.jsx`
- Modify: `dashboard/src/lib/dashboard-preload.ts`
- Modify related preload tests as required.

1. RED: public read always requests exactly limit 50/offset 0 through local signed endpoint in Tauri; web reads a static URL without auth.
2. RED: page has no page-size selector, pagination, setInterval, focus polling, or hidden page requests; open/filter/manual refresh are the only reads.
3. GREEN: remove hedged InsForge public read/database fallback and pagination state; retain generated time and independent authenticated `me` display.
4. Verify signed-out and signed-in UI tests.

## Task 4: Explicit leaderboard consent and account controls

**Files:**
- Modify: `dashboard/src/lib/leaderboard-sync-state.ts`
- Modify: `dashboard/src/lib/__tests__/leaderboard-sync-state.test.ts`
- Modify: `dashboard/src/hooks/use-leaderboard-participation-sync.ts`
- Modify: `dashboard/src/hooks/__tests__/use-leaderboard-participation-sync.test.tsx`
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: `dashboard/src/components/settings/useAccountProfileSettings.js`
- Modify: `dashboard/src/components/settings/useAccountProfileSettings.test.jsx`
- Modify: `dashboard/src/components/settings/AccountSectionParts.jsx`
- Modify: `dashboard/src/components/settings/AccountSection.test.jsx`

1. RED: other-page login and cold session restore do not enable participation or upload.
2. RED: leaderboard login records one-time intent; only its authenticated completion enables `leaderboard_public` and initial upload.
3. RED: existing participant resumes without new consent; unchanged hash dedups; signOut never deletes; confirmed exit deletes remote data while retaining local stats.
4. RED: signed-out settings has no login action; leaderboard is the only login entry.
5. GREEN: implement the minimal intent/participation state changes and remove both automatic-public writes.
6. Verify lifecycle, settings, and page journeys.

## Task 5: Dirty dimensions, Top 50 publisher, and daily reconciliation

**Files:**
- Modify: `dashboard/src/lib/leaderboard-state-client.ts`
- Modify: `dashboard/src/lib/__tests__/leaderboard-state-client.test.ts`
- Create/modify SQL under `scripts/ops/`
- Modify: `dashboard/edge-patches/tokentracker-leaderboard-refresh.ts`
- Add/modify contract tests under `test/leaderboard-*.test.js`
- Replace: `cloudflare/leaderboard-cache/src/index.ts`
- Replace: `cloudflare/leaderboard-cache/src/index.test.ts`
- Modify: `cloudflare/leaderboard-cache/wrangler.toml`

1. RED: meaningful compact-state/profile/actual-cost/delete writes mark a bounded whitelist of dirty keys and do not invoke a full public read refresh.
2. RED: refresher debounces dirty keys to at most 60 seconds, publishes only Top 50 signed objects when content changes, and supports a daily all-key reconciliation.
3. RED: public Worker/static layer never contacts InsForge and accepts no arbitrary query, offset, limit, user ID, auth, or cookie.
4. GREEN: implement SQL/Edge contracts and a SQLite Durable Object serving/publishing boundary on the existing staging Worker.
5. Verify schema, privacy, refresh, read, and Cloudflare tests.

## Task 6: Plan Market and Reset static URLs/signing

**Files:**
- Modify: `src/lib/plan-market/refresh.js`
- Modify: `test/plan-market-refresh.test.js`
- Replace/remove old InsForge public feed patch and tests as appropriate.
- Modify: `src/lib/codex-reset-monitor-service.js`
- Modify: `test/codex-reset-monitor-service.test.js`
- Add static feed generation/upload scripts and workflow without deployment credentials.

1. RED: exact staging Worker paths, no credential headers, canonical signature verification, replay protection, and LKG retention.
2. GREEN: move fixed URLs to the static origin and add signature validation for Plan Market while preserving Reset validation.
3. Add generation/upload commands that require the Worker's publisher secret and perform no network write by default.
4. Verify feed failure injection and privacy tests.

## Task 7: Capacity model and `$0` degradation

**Files:**
- Modify: `scripts/leaderboard-capacity-model.cjs`
- Modify: `test/leaderboard-capacity-model.test.js`
- Update design/progress evidence.

1. RED: model the Workers Free, SQLite Durable Object request/read/write/storage limits without any paid fallback.
2. RED: require code-locked 70,000 warning / 90,000 stop ceilings below the platform's 100,000 daily request/write limits, and keep local-core unaffected.
3. GREEN: implement transparent calculations and a fail-closed public read/write state; deployment variables may only lower limits.
4. Verify over-limit behavior and document that Cloudflare itself rejects Free-tier excess instead of billing it.

## Task 8: Full local verification and two reviews

1. Run focused tests after every RED/GREEN cycle.
2. Run `npm run ci:local`; fix every failure without weakening tests/gates.
3. First review: map every design and original 0.54.49 requirement to code/test/UI/evidence and inspect the complete diff.
4. Build production dashboard/Tauri candidate from a frozen clean SHA only after local source is green.
5. Second review: start from the exact artifact, install in isolation without touching Token Eyes 0.54.48 or Clash Verge, and execute AC-01 through AC-09 as a user.
6. Deploy only to the already authorized isolated InsForge staging and staging Worker; never request R2 checkout or restore the old InsForge project.
7. Do not use completion wording or provide an installer as accepted delivery until both reviews and every acceptance row pass.
