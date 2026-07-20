# Token Eyes Codex Reset Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect normal Codex quota resets, confirmed early quota restoration, and signed official reset/credit announcements, then show a prominent in-app alert without requesting operating-system notification permission.

**Architecture:** The bundled local Node runtime reuses the existing Codex `wham/usage` integration and credentials already used by Token Eyes, but runs a Codex-only poller rather than refreshing every provider. A pure local state machine persists only quota percentages, reset times, event IDs, and acknowledgements. The dashboard reads local events and drives the banner, red dot, and Tauri tray label. A central candidate pipeline watches the exact X accounts `@OpenAI` and Codex head Tibo's `@thsottiaux` when optional X API access is configured, with manual URL intake as the free fallback; only reviewed candidates enter the separately signed static feed.

**Tech Stack:** Node.js CommonJS + `node:test`, existing local API and Codex auth refresh code, Node `crypto` Ed25519 verification, React 18 + Vitest, minimal Tauri 2 Rust tray command and unit tests.

---

## Delivery invariants

- No Codex quota, reset time, token, cookie, credential, or event state is uploaded to InsForge or the leaderboard.
- No DOM, `document.cookie`, remote-page `localStorage`, or remote-page `sessionStorage` is read.
- The official quota request is at most once every 10 minutes while Codex is configured.
- Startup check waits 30 seconds; focus/manual checks are suppressed when the last success is newer than 5 minutes.
- Failures back off 10 minutes, 30 minutes, then 2 hours; stale data never produces a reset event.
- Early restoration requires two consecutive valid observations at least 5 minutes apart.
- The same event is shown once across restarts until the user acknowledges it.
- Client applications never scrape X or receive an X API credential.
- X candidates never publish automatically: exact-author validation, relevance filtering, deduplication, and human approval precede signing.
- Version 1 does not claim that a user owns a reset coupon unless a stable, explicitly allowlisted official numeric field is proven by a captured redacted fixture.
- No OS notification plugin or new system permission is part of version 1.

## Phase 0: Isolate and baseline

### Task 1: Create the implementation worktree and reset-notification runbook

**Files:**
- Read: `CLAUDE.md`
- Read: `src/lib/usage-limits.js`
- Read: `src-tauri/src/codex_session.rs`
- Create: `docs/operations/codex-reset-notifications-runbook.md`

- [ ] **Step 1: Use the required worktree skill**

Invoke `superpowers:using-git-worktrees` and create branch `codex/codex-reset-notifications`. Do not implement in a checkout containing unrelated user edits.

- [ ] **Step 2: Run the baseline**

```powershell
node --test test/usage-limits.test.js test/local-api-security.test.js
npm --prefix dashboard test -- src/components/settings/TokenPlanSection.test.jsx
cargo test --manifest-path src-tauri/Cargo.toml codex_session
```

Expected: selected tests pass. Record any pre-existing failure without weakening tests.

- [ ] **Step 3: Create the runbook**

Use:

```markdown
# Codex Reset Notifications Runbook

## Polling contract
- First check: 30 seconds after local runtime starts
- Success cadence: 10 minutes
- Focus/manual freshness gate: 5 minutes
- Failure backoff: 10 minutes → 30 minutes → 2 hours
- Announcement cache: 30 minutes
- Upcoming alert: once within 30 minutes of reset
- Unexpected restore: at least 20 percentage-point drop, confirmed twice

## Privacy contract
Persist only percentages, reset timestamps, check timestamps, event IDs, acknowledgement timestamps, and sanitized error codes.

## Incident controls
The monitor can be disabled with TOKEN_EYES_CODEX_RESET_MONITOR_ENABLED=0.
The signed feed can be disabled independently with TOKEN_EYES_CODEX_RESET_FEED_ENABLED=0.
Neither switch disables the existing quota display.

## Evidence
Add dated fixture, staging, packaged-app, and tray verification records here.
```

- [ ] **Step 4: Commit**

```powershell
git add docs/operations/codex-reset-notifications-runbook.md
git commit -m "docs: add Codex reset notification runbook"
```

## Phase 1: Focused Codex quota reader

### Task 2: Extract a Codex-only quota refresh path

**Files:**
- Modify: `src/lib/usage-limits.js`
- Modify: `test/usage-limits.test.js`
- Create: `test/codex-usage-limits.test.js`

- [ ] **Step 1: Write failing focused-reader tests**

Tests must prove:

- `getCodexUsageLimits()` reads/refreshed the existing `~/.codex/auth.json` bundle using current helpers;
- sends only `Authorization`, `Accept`, and optional `ChatGPT-Account-Id`;
- normalizes 18,000-second and 604,800-second windows by duration, not slot;
- returns only sanitized fields;
- 401/403 produce `auth_action_required: "reauth"`;
- 404/shape drift produce `unsupported: true`;
- network/5xx produce a sanitized error code;
- invoking it does not call Claude, Cursor, Kimi, Gemini, Kiro, Antigravity, Copilot, or Grok readers.

Use this result contract:

```js
{
  configured: true,
  checked_at: "2026-07-20T08:00:00.000Z",
  primary_window: {
    used_percent: 37,
    reset_at: "2026-07-20T10:30:00.000Z"
  },
  secondary_window: {
    used_percent: 64,
    reset_at: "2026-07-24T00:00:00.000Z"
  },
  spark_primary_window: null,
  spark_secondary_window: null
}
```

Run:

```powershell
node --test test/codex-usage-limits.test.js
```

Expected: FAIL because `getCodexUsageLimits` is not exported.

- [ ] **Step 2: Extract shared Codex auth/refresh logic**

Refactor the existing Codex branch into an internal function used by both `getUsageLimits()` and:

```js
async function getCodexUsageLimits(options = {})
```

Do not change the response shape currently consumed by `getUsageLimits().codex`. Do not log auth JSON, access tokens, refresh tokens, raw bodies, account IDs, or filesystem paths.

- [ ] **Step 3: Add strict optional reset-credit parsing gate**

Export:

```js
function parseCodexResetCreditFields(body)
```

For version 1 it returns `null` unless all of these are true:

- the exact field path is in `CODEX_RESET_CREDIT_ALLOWLIST`;
- the value is a finite non-negative integer;
- a redacted fixture for that exact schema exists under `test/fixtures/codex/`;
- the fixture test names the official response version/date.

Ship the allowlist empty initially. Global signed announcements cover promotions until a reliable official field is observed.

- [ ] **Step 4: Test and commit**

```powershell
node --test test/codex-usage-limits.test.js test/usage-limits.test.js
git add src/lib/usage-limits.js test/usage-limits.test.js test/codex-usage-limits.test.js
git commit -m "refactor: add focused Codex quota reader"
```

## Phase 2: Pure local event state machine

### Task 3: Detect upcoming, completed, and confirmed unexpected restoration events

**Files:**
- Create: `src/lib/codex-reset-monitor.js`
- Create: `test/codex-reset-monitor.test.js`

- [ ] **Step 1: Write failing state-machine tests**

Use injected `nowMs` and test:

1. `reset_upcoming` appears once when `0 < resetAt-now <= 30 minutes`.
2. Restarting with the same persisted event ID does not re-emit it.
3. `reset_completed` appears after crossing the old reset time when the new valid window has a later reset time and a lower used percentage.
4. A 20-point early drop produces no event on the first observation.
5. The same early drop confirmed at least 5 minutes later produces `unexpected_quota_restore`.
6. A bounce back, missing window, stale check, error, 404, or unsupported response clears the candidate and produces no event.
7. An acknowledgement removes the event from unread results without deleting history.
8. 5-hour and weekly windows have independent IDs.
9. Event history is capped at 100 and acknowledged IDs at 200.

Run:

```powershell
node --test test/codex-reset-monitor.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement pure state transitions**

Export:

```js
module.exports = {
  MONITOR_STATE_VERSION,
  acknowledgeCodexResetEvent,
  buildCodexResetEventId,
  evaluateCodexResetSnapshot,
  listUnreadCodexResetEvents,
  normalizeCodexResetSnapshot,
};
```

Persisted shape:

```json
{
  "version": 1,
  "lastCheckedAt": "2026-07-20T08:00:00.000Z",
  "lastSuccessfulAt": "2026-07-20T08:00:00.000Z",
  "windows": {
    "rolling_5_hour": { "usedPercent": 37, "resetAt": "2026-07-20T10:30:00.000Z" },
    "rolling_weekly": { "usedPercent": 64, "resetAt": "2026-07-24T00:00:00.000Z" }
  },
  "restoreCandidates": {},
  "events": [],
  "acknowledgedEventIds": []
}
```

Event contract:

```json
{
  "id": "sha256-kind-window-resetAt",
  "type": "reset_upcoming",
  "window": "rolling_5_hour",
  "createdAt": "ISO-8601",
  "resetAt": "ISO-8601",
  "officialUrl": "https://chatgpt.com/codex",
  "source": "local_quota"
}
```

No title/body copy is persisted; the UI resolves copy keys from `type`.

- [ ] **Step 3: Run tests and commit**

```powershell
node --test test/codex-reset-monitor.test.js
git add src/lib/codex-reset-monitor.js test/codex-reset-monitor.test.js
git commit -m "feat: detect Codex reset events locally"
```

### Task 4: Persist state atomically and enforce the polling/backoff schedule

**Files:**
- Create: `src/lib/codex-reset-monitor-store.js`
- Create: `src/lib/codex-reset-monitor-service.js`
- Create: `test/codex-reset-monitor-store.test.js`
- Create: `test/codex-reset-monitor-service.test.js`
- Modify: `src/lib/local-api.js`

- [ ] **Step 1: Write failing store and scheduler tests**

Test:

- state path is inside Token Eyes' existing tracker data directory;
- writes use temp-file + rename;
- corrupt state is quarantined and replaced with an empty state;
- private file mode is requested where supported;
- startup delay is 30 seconds;
- success interval is 10 minutes;
- backoff is 10/30/120 minutes and caps at 2 hours;
- focus/manual checks newer than 5 minutes are suppressed;
- single-flight prevents concurrent requests;
- `configured:false` waits without raising an error event;
- only valid fresh results enter the state machine;
- service stop clears timers.

Run:

```powershell
node --test test/codex-reset-monitor-store.test.js test/codex-reset-monitor-service.test.js
```

Expected: FAIL.

- [ ] **Step 2: Implement the store and service**

Public service contract:

```js
function createCodexResetMonitorService({
  getCodexUsageLimits,
  loadState,
  saveState,
  now,
  setTimer,
  clearTimer,
  enabled,
})
```

Methods:

```text
start()
stop()
check({ reason, force })
getStatus()
listUnread()
acknowledge(eventId)
```

`getStatus()` returns sanitized metadata only:

```json
{
  "enabled": true,
  "configured": true,
  "last_checked_at": "ISO-8601",
  "last_successful_at": "ISO-8601",
  "next_check_at": "ISO-8601",
  "last_error_code": null,
  "unread_count": 1
}
```

- [ ] **Step 3: Start and stop with the local API process**

Create one service instance when `createLocalApiServer` starts. Call `start()` after the server is listening and `stop()` during server close. Respect:

```text
TOKEN_EYES_CODEX_RESET_MONITOR_ENABLED=0
```

Default is enabled.

- [ ] **Step 4: Test and commit**

```powershell
node --test test/codex-reset-monitor-store.test.js test/codex-reset-monitor-service.test.js test/local-api-security.test.js
git add src/lib/codex-reset-monitor-store.js src/lib/codex-reset-monitor-service.js src/lib/local-api.js test/codex-reset-monitor-store.test.js test/codex-reset-monitor-service.test.js
git commit -m "feat: schedule and persist Codex reset checks"
```

## Phase 3: Signed global announcement feed

### Task 5A: Collect X candidates centrally without making X a client dependency

**Files:**
- Create: `scripts/lib/codex-announcement-sources.mjs`
- Create: `scripts/collect-codex-reset-candidates.mjs`
- Create: `test/codex-announcement-sources.test.js`
- Create: `.github/workflows/codex-reset-candidates.yml`
- Modify: `docs/operations/codex-reset-notifications-runbook.md`

- [ ] **Step 1: Write failing source-validation and relevance tests**

Lock the initial author allowlist to:

```js
[
  { username: "OpenAI", role: "company" },
  { username: "thsottiaux", role: "head_of_codex" }
]
```

Tests must prove:

- only `https://x.com/OpenAI/status/<numeric-id>` and `https://x.com/thsottiaux/status/<numeric-id>` pass;
- usernames are matched case-insensitively but the numeric status ID is mandatory;
- display name “Tibo”, verified badges, reposts, quotes, replies, and lookalike usernames do not establish authorship;
- a candidate must mention Codex and at least one allowlisted reset concept: `reset`, `rate limit`, `usage limit`, `quota`, `credit`, `extra usage`, `additional usage`, or an explicitly reviewed Chinese equivalent;
- posts older than 48 hours at collection time are rejected in both API and manual modes;
- unrelated product launches and general Codex posts are rejected;
- `source_post_id` deduplicates repeated scans;
- multiple posts assigned the same `campaign_key` produce one review item;
- the sanitized candidate contains public source metadata only and never an API bearer token or response headers.

Run:

```powershell
node --test test/codex-announcement-sources.test.js
```

Expected: FAIL because the source module does not exist.

- [ ] **Step 2: Implement the validator and optional X recent-search adapter**

Export:

```js
export const CODEX_ANNOUNCEMENT_X_AUTHORS;
export function parseAllowlistedXStatusUrl(url);
export function classifyCodexResetCandidate(post);
export function mergeCodexResetCandidates(existing, incoming);
export async function collectXRecentCandidates({ bearerToken, sinceId, fetchImpl });
```

The X query is fixed to:

```text
(from:OpenAI OR from:thsottiaux) Codex
(reset OR "rate limit" OR "usage limit" OR quota OR credit OR "extra usage" OR "additional usage")
-is:retweet
```

Request only `id`, `text`, `author_id`, `created_at`, and expanded username. Bound each run to 100 results and set `start_time` to exactly 48 hours before the injected/current clock; reject older posts again after parsing. Never log the bearer token or raw authorization header.

- [ ] **Step 3: Provide the zero-cost manual fallback**

The CLI supports both:

```powershell
node scripts/collect-codex-reset-candidates.mjs --x-api --output "$env:TEMP\\codex-reset-candidates.json"
node scripts/collect-codex-reset-candidates.mjs --manual "https://x.com/thsottiaux/status/1234567890123456789" --text-file "$env:TEMP\\post.txt" --output "$env:TEMP\\codex-reset-candidates.json"
```

`--x-api` requires `X_BEARER_TOKEN` and exits with code 2 plus a neutral setup message when absent. `--manual` still runs exact URL, author, keyword, size, and deduplication checks; a maintainer visually verifies the public post before signing. Neither mode commits candidate text to the repository.

- [ ] **Step 4: Add a central workflow, disabled unless explicitly configured**

The GitHub workflow:

- runs only by `workflow_dispatch` by default;
- offers an optional schedule block documented but commented out;
- uses `X_BEARER_TOKEN` only when a repository secret exists;
- uploads the sanitized candidate JSON as a short-lived artifact;
- never commits, signs, publishes, opens a PR, or deploys automatically;
- explains that X API access may be pay-per-use and must not be enabled without an approved zero-cost/paid budget.

- [ ] **Step 5: Test and commit**

```powershell
node --test test/codex-announcement-sources.test.js
git add scripts/lib/codex-announcement-sources.mjs scripts/collect-codex-reset-candidates.mjs test/codex-announcement-sources.test.js .github/workflows/codex-reset-candidates.yml docs/operations/codex-reset-notifications-runbook.md
git commit -m "feat: collect trusted Codex announcement candidates"
```

### Task 5: Define, sign, and verify the static feed without storing a private key

**Files:**
- Create: `scripts/generate-codex-reset-feed-keypair.mjs`
- Create: `scripts/sign-codex-reset-feed.mjs`
- Create: `src/lib/codex-reset-feed.js`
- Create during the task: `src/lib/codex-reset-feed-public-key.pem`
- Create: `dashboard/public/.well-known/token-eyes/codex-reset-feed.json`
- Create: `test/codex-reset-feed.test.js`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing verifier tests**

Feed envelope:

```json
{
  "version": 1,
  "payload_b64": "base64url-of-exact-utf8-json-bytes",
  "signature_b64": "base64url-ed25519-signature"
}
```

Decoded payload:

```json
{
  "generated_at": "2026-07-20T00:00:00.000Z",
  "announcements": [
    {
      "id": "codex-reset-promo-2026-07",
      "type": "official_reset_announcement",
      "title": "Codex 重置或额外额度活动",
      "summary": "可能适用于你的账户，请前往官方页面确认。",
      "source_author": "thsottiaux",
      "source_post_id": "1234567890123456789",
      "source_url": "https://x.com/thsottiaux/status/1234567890123456789",
      "official_url": "https://help.openai.com/en/articles/20001271",
      "published_at": "2026-07-20T00:00:00.000Z",
      "expires_at": "2026-08-20T00:00:00.000Z"
    }
  ]
}
```

Tests reject:

- changed payload bytes;
- malformed Base64URL;
- invalid signature;
- expired announcements;
- duplicate IDs;
- more than 20 announcements;
- title over 80 characters or summary over 240;
- non-HTTPS links;
- links outside `help.openai.com`, `openai.com`, `chatgpt.com`, and exact allowlisted X status URLs;
- X source author/URL/post-ID mismatches;
- X sources outside `@OpenAI` and `@thsottiaux`;
- unsupported event types.

Run:

```powershell
node --test test/codex-reset-feed.test.js
```

Expected: FAIL.

- [ ] **Step 2: Generate the release key pair outside the repository**

Run:

```powershell
node scripts/generate-codex-reset-feed-keypair.mjs --private "$env:USERPROFILE\\.token-eyes-secrets\\codex-reset-feed-ed25519-private.pem" --public "src/lib/codex-reset-feed-public-key.pem"
```

The script must:

- create the secret directory if absent;
- refuse to overwrite an existing private key;
- write PKCS#8 private and SPKI public PEM;
- set restrictive permissions best-effort;
- never print private key material.

Add `.token-eyes-secrets/` and `*-private.pem` to `.gitignore`. Commit only the public key.

- [ ] **Step 3: Implement exact-byte verification**

Use Node built-in `crypto.verify(null, payloadBytes, publicKey, signature)`. Parse the payload only after signature verification. Do not JSON-canonicalize and do not verify reserialized JSON.

- [ ] **Step 4: Sign the initial empty feed**

The initial decoded payload must contain:

```json
{
  "generated_at": "current ISO-8601 at signing time",
  "announcements": []
}
```

Run:

```powershell
node scripts/sign-codex-reset-feed.mjs --private "$env:USERPROFILE\\.token-eyes-secrets\\codex-reset-feed-ed25519-private.pem" --output "dashboard/public/.well-known/token-eyes/codex-reset-feed.json"
node --test test/codex-reset-feed.test.js
```

Expected: PASS. The signer must refuse an announcement without an allowlisted official source, must require review metadata for X candidates, and must never read directly from the unreviewed workflow artifact.

- [ ] **Step 5: Commit**

```powershell
git add .gitignore scripts/generate-codex-reset-feed-keypair.mjs scripts/sign-codex-reset-feed.mjs src/lib/codex-reset-feed.js src/lib/codex-reset-feed-public-key.pem dashboard/public/.well-known/token-eyes/codex-reset-feed.json test/codex-reset-feed.test.js
git commit -m "feat: verify signed Codex reset announcements"
```

### Task 6: Merge verified announcements into the local event store

**Files:**
- Modify: `src/lib/codex-reset-monitor-service.js`
- Modify: `test/codex-reset-monitor-service.test.js`
- Modify: `docs/operations/codex-reset-notifications-runbook.md`

- [ ] **Step 1: Write failing feed-service tests**

Prove:

- feed URL is fixed to `https://www.tokentracker.cc/.well-known/token-eyes/codex-reset-feed.json` unless a test-only injected URL is provided;
- fetch cadence is no more than once per 30 minutes;
- `If-None-Match` and `If-Modified-Since` are honored;
- 304 keeps existing verified announcements;
- offline mode keeps unexpired previously verified events;
- signature failure, expiry, invalid official URL, and HTTP errors add no event;
- the feed path can be disabled independently;
- local quota checks continue when feed checks fail.

- [ ] **Step 2: Implement the feed poller**

Respect:

```text
TOKEN_EYES_CODEX_RESET_FEED_ENABLED=0
```

Persist only the verified announcement payload, ETag, Last-Modified, fetch time, and event acknowledgement. Never persist the unverified response.

- [ ] **Step 3: Test, document publishing, and commit**

```powershell
node --test test/codex-reset-monitor-service.test.js test/codex-reset-feed.test.js
git add src/lib/codex-reset-monitor-service.js test/codex-reset-monitor-service.test.js docs/operations/codex-reset-notifications-runbook.md
git commit -m "feat: poll signed Codex announcements"
```

Document the exact publication sequence: collect candidate, verify the exact `@OpenAI`/`@thsottiaux` public post or OpenAI page manually, merge duplicate campaign posts, write conservative copy, sign offline, review decoded payload, deploy website, fetch production envelope, and verify it with the committed public key.

## Phase 4: Local API and dashboard alerts

### Task 7: Add local read, acknowledgement, and manual-check endpoints

**Files:**
- Modify: `src/lib/local-api.js`
- Create: `test/local-api-codex-reset-events.test.js`
- Modify: `test/local-api-security.test.js`
- Modify: `dashboard/src/lib/api.ts`
- Create: `dashboard/src/lib/__tests__/api-codex-reset-events.test.ts`

- [ ] **Step 1: Write failing API tests**

Endpoints:

```text
GET  /functions/tokentracker-codex-reset-events
POST /functions/tokentracker-codex-reset-events/ack
POST /functions/tokentracker-codex-reset-events/check
```

Assert:

- GET is `Cache-Control: no-store`;
- GET returns status plus unread sanitized events;
- POST endpoints require the existing local mutation authorization;
- acknowledgement accepts one bounded event ID;
- manual check respects the 5-minute freshness gate unless the existing trusted local UI sends `force:true`;
- no endpoint returns credentials, raw official responses, local paths, or persisted file names;
- non-local origins are rejected by existing CORS/CSRF rules.

Run:

```powershell
node --test test/local-api-codex-reset-events.test.js test/local-api-security.test.js
npm --prefix dashboard test -- src/lib/__tests__/api-codex-reset-events.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement local endpoints and typed dashboard API**

Add:

```ts
export type CodexResetEventType =
  | "reset_upcoming"
  | "reset_completed"
  | "unexpected_quota_restore"
  | "banked_reset_available"
  | "official_reset_announcement";

export function getCodexResetEvents(): Promise<CodexResetEventsResponse>;
export function acknowledgeCodexResetEvent(eventId: string): Promise<void>;
export function checkCodexResetEvents(force?: boolean): Promise<CodexResetEventsResponse>;
```

`banked_reset_available` remains a type for forward compatibility but is not emitted while the allowlist is empty.

- [ ] **Step 3: Test and commit**

```powershell
node --test test/local-api-codex-reset-events.test.js test/local-api-security.test.js
npm --prefix dashboard test -- src/lib/__tests__/api-codex-reset-events.test.ts
git add src/lib/local-api.js test/local-api-codex-reset-events.test.js test/local-api-security.test.js dashboard/src/lib/api.ts dashboard/src/lib/__tests__/api-codex-reset-events.test.ts
git commit -m "feat: expose local Codex reset events"
```

### Task 8: Add the global banner, unread red dot, and navigation actions

**Files:**
- Create: `dashboard/src/hooks/use-codex-reset-events.ts`
- Create: `dashboard/src/hooks/__tests__/use-codex-reset-events.test.tsx`
- Create: `dashboard/src/components/CodexResetBanner.tsx`
- Create: `dashboard/src/components/CodexResetBanner.test.tsx`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/ui/components/Sidebar.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Write failing hook and component tests**

Prove:

- hook fetches immediately and every 60 seconds from local API only;
- window focus requests a check only through the 5-minute gate;
- first unread event is shown in the banner;
- same event is not shown after acknowledgement;
- reset events show “查看额度” and “前往 Codex”;
- announcement events additionally show “查看官方说明”;
- official links use the existing safe opener and allowlist;
- X announcement actions open only the exact signed `source_url`;
- unread events put a red dot on the Token 套餐/额度 entry;
- no alert appears on the public website where the local API is unavailable;
- quota-read errors show only in settings/status and never masquerade as restoration.

Run:

```powershell
npm --prefix dashboard test -- src/hooks/__tests__/use-codex-reset-events.test.tsx src/components/CodexResetBanner.test.tsx
```

Expected: FAIL.

- [ ] **Step 2: Implement one provider mounted in `App.jsx`**

The provider exposes:

```ts
{
  events,
  unreadCount,
  status,
  acknowledge,
  checkNow
}
```

Mount `CodexResetBanner` inside the local dashboard shell but above routed page content. The feature does not depend on Token Eyes cloud login; it depends only on local Codex configuration.

- [ ] **Step 3: Add canonical copy**

Add distinct copy for:

- upcoming 5-hour/weekly reset;
- reset completed;
- confirmed early restoration;
- official announcement uncertainty;
- connect/reauth/unsupported states;
- last checked time and manual refresh;
- acknowledge action.

Run:

```powershell
npm run copy:pull
npm run validate:copy
```

- [ ] **Step 4: Test and commit**

```powershell
npm --prefix dashboard test -- src/hooks/__tests__/use-codex-reset-events.test.tsx src/components/CodexResetBanner.test.tsx
git add dashboard/src/hooks/use-codex-reset-events.ts dashboard/src/hooks/__tests__/use-codex-reset-events.test.tsx dashboard/src/components/CodexResetBanner.tsx dashboard/src/components/CodexResetBanner.test.tsx dashboard/src/App.jsx dashboard/src/ui/components/Sidebar.jsx dashboard/src/content
git commit -m "feat: show Codex reset alerts in app"
```

### Task 9: Surface monitor status beside the existing Codex quota block

**Files:**
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx`
- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`

- [ ] **Step 1: Write failing settings tests**

Assert the Codex quota block shows:

- last successful check;
- next scheduled check;
- a manual “立即检查” action;
- neutral “连接 Codex 后可检测重置” when unconfigured;
- reauth action for 401/403;
- “暂时无法读取额度” for unsupported/404;
- no repeated banner/error event for failure status.

- [ ] **Step 2: Implement using the shared hook**

Do not add a second timer or direct upstream request in `TokenPlanSection`. Use the global event context and call the local manual-check endpoint.

- [ ] **Step 3: Test and commit**

```powershell
npm --prefix dashboard test -- src/components/settings/TokenPlanSection.test.jsx
git add dashboard/src/components/settings/TokenPlanSection.jsx dashboard/src/components/settings/TokenPlanSection.test.jsx
git commit -m "feat: show Codex reset monitor status"
```

## Phase 5: Tauri tray status without notification permission

### Task 10: Add a narrow tray-status command

**Files:**
- Modify: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `dashboard/src/lib/codex-reset-tray.ts`
- Create: `dashboard/src/lib/__tests__/codex-reset-tray.test.ts`
- Modify: `dashboard/src/hooks/use-codex-reset-events.ts`

- [ ] **Step 1: Write failing pure Rust and dashboard tests**

Rust tests cover:

```text
0 unread → "Codex 重置通知：无新提醒"
1 unread reset_completed → "Codex 额度已恢复"
N unread → "Codex 重置通知：N 条新提醒"
```

Dashboard tests prove Tauri invoke is called only when the derived tray label changes and is skipped outside Tauri.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml tray
npm --prefix dashboard test -- src/lib/__tests__/codex-reset-tray.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Store and update one disabled tray menu item**

Add a managed tray state containing the cloned disabled status `MenuItem`. Register:

```rust
#[tauri::command]
pub fn set_codex_reset_tray_status(
    state: tauri::State<'_, CodexTrayState>,
    unread_count: u32,
    latest_type: Option<String>,
) -> Result<(), String>
```

Bound `unread_count` to 999 and map `latest_type` through a fixed enum. Never accept an arbitrary menu label from JavaScript.

The menu order becomes:

```text
Codex 重置通知：…
打开主窗口
退出
```

- [ ] **Step 3: Connect the dashboard bridge**

`dashboard/src/lib/codex-reset-tray.ts` detects Tauri and invokes only `{ unreadCount, latestType }`. It does not send event text, quota values, reset timestamps, or official URLs.

- [ ] **Step 4: Test and commit**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml tray
npm --prefix dashboard test -- src/lib/__tests__/codex-reset-tray.test.ts src/hooks/__tests__/use-codex-reset-events.test.tsx
git add src-tauri/src/tray.rs src-tauri/src/lib.rs dashboard/src/lib/codex-reset-tray.ts dashboard/src/lib/__tests__/codex-reset-tray.test.ts dashboard/src/hooks/use-codex-reset-events.ts
git commit -m "feat: show Codex reset status in tray"
```

## Phase 6: End-to-end verification and release gate

### Task 11: Verify privacy, cadence, deduplication, and packaged behavior

**Files:**
- Create: `test/codex-reset-privacy-contract.test.js`
- Modify: `docs/operations/codex-reset-notifications-runbook.md`

- [ ] **Step 1: Write the privacy-contract test**

Scan monitor DTOs, persisted state fixtures, local API responses, and Tauri payloads. Fail if they contain any of:

```text
access_token
refresh_token
authorization
cookie
raw_response
account_id
user_id
project
conversation
skill
mcp
path
x_bearer_token
```

Permit `official_url` only for allowlisted OpenAI HTTPS hosts. Permit `source_url` on X only when its exact author and numeric post ID match the signed `source_author` and `source_post_id`.

- [ ] **Step 2: Run the full focused suite**

```powershell
node --test test/codex-usage-limits.test.js test/codex-reset-monitor.test.js test/codex-reset-monitor-store.test.js test/codex-reset-monitor-service.test.js test/codex-announcement-sources.test.js test/codex-reset-feed.test.js test/local-api-codex-reset-events.test.js test/codex-reset-privacy-contract.test.js test/local-api-security.test.js test/usage-limits.test.js
npm --prefix dashboard test -- src/hooks/__tests__/use-codex-reset-events.test.tsx src/components/CodexResetBanner.test.tsx src/lib/__tests__/api-codex-reset-events.test.ts src/lib/__tests__/codex-reset-tray.test.ts src/components/settings/TokenPlanSection.test.jsx
cargo test --manifest-path src-tauri/Cargo.toml codex_session
cargo test --manifest-path src-tauri/Cargo.toml tray
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npm test
```

Expected: all pass.

- [ ] **Step 3: Run deterministic clock acceptance**

With fake quota responses:

1. approach reset by 29 minutes → one upcoming banner;
2. repeat check/restart → no duplicate;
3. cross reset with later `reset_at` and lower usage → completed banner;
4. early 25-point drop → no event;
5. same early state after 6 minutes → unexpected-restoration banner;
6. early drop followed by bounce → no event;
7. network error and stale cache → no event;
8. 401/403 → reauth state only;
9. invalid signed feed → no announcement;
10. valid unexpired feed → one announcement with official link;
11. lookalike X author/general Codex post → no candidate;
12. `@OpenAI` or `@thsottiaux` relevant post → review candidate only, never automatic publication;
13. duplicate campaign posts → one announcement;
14. acknowledge and restart → event stays read.

- [ ] **Step 4: Verify the packaged Windows app**

Build using the repository release workflow, then verify:

- local runtime starts the monitor after 30 seconds;
- closing to tray keeps the local runtime and cadence alive;
- tray menu label changes with unread events;
- clicking the banner opens the correct local settings section;
- official link opens externally;
- no Windows notification permission prompt appears;
- Process Monitor/network capture shows client quota traffic only to `chatgpt.com` and client feed traffic only to `www.tokentracker.cc`; clients never contact X;
- no event data is sent to InsForge.

Record versions, timestamps, and redacted request destinations in the runbook.

- [ ] **Step 5: Commit verification evidence**

```powershell
git add test/codex-reset-privacy-contract.test.js docs/operations/codex-reset-notifications-runbook.md
git commit -m "test: verify Codex reset notifications"
```

## Release stop conditions

Do not release if any of these is true:

- A stale/error response can produce a reset event.
- Early restoration fires from one observation.
- Credentials, raw responses, account IDs, or local paths enter monitor state or logs.
- The feed is parsed before signature verification.
- A non-official URL can appear in an announcement action.
- An X candidate can bypass exact `@OpenAI`/`@thsottiaux` author and status-ID validation.
- A candidate collector can sign or publish without human review.
- An X credential or candidate post body ships in the desktop client.
- The monitor refreshes all providers every 10 minutes.
- Restarting reproduces an acknowledged event.
- The packaged app requests OS notification permission.
- Codex quota/reset data reaches InsForge or the leaderboard.

## Final handoff

After every task passes, use `superpowers:requesting-code-review`, address findings with `superpowers:receiving-code-review`, then use `superpowers:verification-before-completion`. Follow the `CLAUDE.md` npm/Tauri release workflow because this plan changes both `src/` and `dashboard/`; publishing and production deployment still require explicit user authorization.
