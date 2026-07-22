# Free Reset Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex quota restoration detection near-real-time without paid services and reduce leaderboard refreshes to once per day.

**Architecture:** The desktop client checks aggregate Codex quota every two minutes and polls a signed public feed every five minutes. A scheduler-authenticated InsForge collector checks OpenAI's free public status source every five minutes, consumes at most one Tavily free Basic Search credit per hour, signs the sanitized feed, and stores one singleton envelope for the existing public feed edge.

**Tech Stack:** CommonJS/Node tests, TypeScript Deno edge functions, PostgreSQL, InsForge schedules/secrets, Tauri v2 NSIS.

---

### Task 1: Increase the client detection cadence

**Files:**
- Modify: `test/codex-reset-monitor-service.test.js`
- Modify: `src/lib/codex-reset-monitor-service.js`

- [ ] **Step 1: Change the schedule contract test to expect the free near-real-time cadence**

```js
assert.equal(STARTUP_DELAY_MS, 10_000);
assert.equal(SUCCESS_INTERVAL_MS, 2 * 60_000);
assert.equal(FOCUS_FRESHNESS_MS, 60_000);
assert.equal(FEED_CACHE_MS, 5 * 60_000);
assert.deepEqual(FAILURE_BACKOFF_MS, [2 * 60_000, 10 * 60_000, 30 * 60_000]);
```

- [ ] **Step 2: Run the monitor service test and confirm it fails on the old constants**

Run: `node --test test/codex-reset-monitor-service.test.js`
Expected: FAIL with schedule assertion differences.

- [ ] **Step 3: Update only the exported timing constants**

```js
const STARTUP_DELAY_MS = 10_000;
const SUCCESS_INTERVAL_MS = 2 * 60_000;
const FOCUS_FRESHNESS_MS = 60_000;
const FEED_CACHE_MS = 5 * 60_000;
const FAILURE_BACKOFF_MS = Object.freeze([2 * 60_000, 10 * 60_000, 30 * 60_000]);
```

- [ ] **Step 4: Run the reset monitor tests**

Run: `node --test test/codex-reset*.test.js`
Expected: all selected tests pass.

### Task 2: Add a private singleton feed store

**Files:**
- Create: `scripts/ops/codex-reset-feed-store.sql`
- Create: `test/codex-reset-feed-store.test.js`

- [ ] **Step 1: Write a schema contract test**

The test must require one singleton row, `jsonb` envelope, last OpenAI/Tavily check timestamps, revoked anonymous/authenticated access, and service-role-only mutation.

- [ ] **Step 2: Run the schema test and confirm the migration is missing**

Run: `node --test test/codex-reset-feed-store.test.js`
Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Create the minimal private table**

```sql
CREATE TABLE IF NOT EXISTS tokentracker_codex_reset_feed_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  envelope jsonb NOT NULL,
  last_openai_checked_at timestamptz,
  last_tavily_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON tokentracker_codex_reset_feed_state FROM anon, authenticated;
```

- [ ] **Step 4: Run the schema test**

Run: `node --test test/codex-reset-feed-store.test.js`
Expected: PASS.

### Task 3: Make the public feed edge read the signed singleton

**Files:**
- Modify: `dashboard/edge-patches/tokentracker-codex-reset-feed.ts`
- Modify: `test/codex-reset-feed-edge.test.js`

- [ ] **Step 1: Extend the edge contract test**

Require `API_KEY`, `tokentracker_codex_reset_feed_state`, `.eq("singleton", true)`, ETag support, and no private signing key reference.

- [ ] **Step 2: Run the edge test and confirm it fails**

Run: `node --test test/codex-reset-feed-edge.test.js`
Expected: FAIL because the edge still embeds a static envelope.

- [ ] **Step 3: Read the singleton using the InsForge service credential**

The edge returns the stored envelope with public CORS, five-minute browser caching, and an ETag derived only from `payload_b64`. If the database read fails, it returns the committed empty signed envelope so clients remain safe.

- [ ] **Step 4: Run the edge test**

Run: `node --test test/codex-reset-feed-edge.test.js`
Expected: PASS.

### Task 4: Add the free collector edge

**Files:**
- Create: `dashboard/edge-patches/tokentracker-codex-reset-collector.ts`
- Create: `test/codex-reset-collector-edge.test.js`

- [ ] **Step 1: Write source-level security and quota tests**

Require scheduler bearer authentication, exact OpenAI/Tibo URL allowlists, a 48-hour cutoff, OpenAI checks on every invocation, Tavily checks only after 60 minutes, `search_depth: "basic"`, `max_results <= 10`, optional `TAVILY_API_KEY`, Ed25519 signing, and database upsert of one envelope.

- [ ] **Step 2: Run the collector test and confirm the file is missing**

Run: `node --test test/codex-reset-collector-edge.test.js`
Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Implement deterministic collection and signing**

The collector fetches `https://status.openai.com/api/v2/incidents.json`, searches Tavily only when the persisted timestamp is at least 60 minutes old, accepts only exact official URLs and reset-related Codex text, derives X post time from the Snowflake ID, removes items older than 48 hours, signs the JSON payload with `CODEX_RESET_SIGNING_KEY_PKCS8_B64`, and upserts the singleton. Missing Tavily configuration is a successful degraded run, never a paid fallback.

- [ ] **Step 4: Run collector and feed tests**

Run: `node --test test/codex-reset-collector-edge.test.js test/codex-reset-feed-edge.test.js test/codex-reset-feed.test.js`
Expected: PASS.

### Task 5: Deploy database, functions, secrets, and schedules

**Files:**
- Modify: InsForge project `Token-Eyes` only.

- [ ] **Step 1: Generate a new Ed25519 key pair without printing private material**

Store the private PKCS8 DER as `CODEX_RESET_SIGNING_KEY_PKCS8_B64`, update `src/lib/codex-reset-feed-public-key.pem`, and sign the committed empty fallback feed.

- [ ] **Step 2: Apply the feed-store migration and seed its singleton envelope**

Expected: the table is private and contains exactly one signed fallback row.

- [ ] **Step 3: Deploy the collector and public feed functions**

Expected: public feed returns HTTP 200 JSON; collector rejects missing scheduler credentials with HTTP 401.

- [ ] **Step 4: Change the leaderboard schedule**

Run: `insforge schedules update 0db35167-c6b5-4eba-ae96-9f89947fe022 --cron "55 15 * * *"`
Expected: next run is 23:55 Asia/Shanghai.

- [ ] **Step 5: Create a five-minute collector schedule**

Use cron `*/5 * * * *`, POST, the existing scheduler secret, and no paid service configuration. Expected: OpenAI polling works; Tavily is reported as `not_configured` until the user supplies the free key.

### Task 6: Verify and package

**Files:**
- Build output: `src-tauri/target/release/bundle/nsis/Token Eyes_0.54.7_x64-setup.exe`

- [ ] **Step 1: Run feature tests and builds**

Run the reset/leaderboard Node tests, targeted dashboard leaderboard tests, `cargo check --manifest-path src-tauri/Cargo.toml`, and `npm run dashboard:build`.
Expected: selected tests and builds pass; unrelated legacy test failures remain out of scope.

- [ ] **Step 2: Build the NSIS installer**

Run: `npm run tauri:build`
Expected: one `Token Eyes_0.54.7_x64-setup.exe` bundle.

- [ ] **Step 3: Verify SHA-256, cloud endpoints, schedules, and Git cleanliness**

Expected: feed and leaderboard return HTTP 200; leaderboard cron is daily; collector cron is five-minute; no secret is staged; the installer hashes successfully.

- [ ] **Step 4: Commit and push**

Commit source changes without private keys and push `codex/leaderboard-provider-api`.
