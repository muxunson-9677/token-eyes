# Reliable Codex Reset History and Windows Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably detect normal and manually redeemed Codex quota resets, backfill the last 30 days from privacy-safe local snapshots, and deliver one prominent Windows alert per new reset.

**Architecture:** Upgrade the persisted reset state into a 30-day event ledger. Merge live `wham/usage` observations with Codex rollout `token_count.rate_limits` snapshots, using the new window end as the stable identity for manual resets and the prior scheduled reset time for normal resets. The dashboard consumes one sanitized local API, while Tauri supplies native Windows notifications and the tray surface.

**Tech Stack:** Node.js 20+ CommonJS, streamed JSONL parsing, React 18 + TypeScript + Vitest, Tauri 2 + Rust, `@tauri-apps/plugin-notification`.

---

## Scope boundary

This plan delivers the reset ledger, 30-day history, main-window banner, Windows native notification, and tray unread state as independently testable software.

The desktop widget shell does not exist in the product yet. Its confirmed six-second in-capsule alert and unread dot are implemented in the desktop-widget plan, consuming the `events`, `history`, and acknowledgement API defined here. Do not create a temporary second widget or a mock-only widget shell in this plan.

## File map

**Create**

- `test/fixtures/codex/wham-usage-reset-credits.json` — redacted official response shape containing reset-credit counters only.
- `src/lib/codex-reset-rollout-reader.js` — privacy-safe streamed extraction of rate-limit snapshots.
- `test/codex-reset-rollout-reader.test.js` — JSONL parsing, cursor, cutoff, and privacy tests.
- `dashboard/src/lib/codex-reset-notifications.ts` — native notification permission, delivery, and fallback classification.
- `dashboard/src/lib/__tests__/codex-reset-notifications.test.ts` — native/fallback/dedup tests.

**Modify**

- `src/lib/usage-limits.js` — allowlist and return reset-credit counters plus a hashed account key.
- `test/codex-usage-limits.test.js` — fixture-driven schema and sanitization tests.
- `src/lib/codex-reset-monitor.js` — state v2, event fusion, 30-day retention, delivery state.
- `test/codex-reset-monitor.test.js` — normal/manual/backfill/dedup/retention tests.
- `src/lib/codex-reset-monitor-service.js` — background backfill and faster successful polling.
- `test/codex-reset-monitor-service.test.js` — startup backfill, delivery, and scheduling tests.
- `src/lib/codex-reset-monitor-store.js` — migrate v1 state without losing existing events.
- `test/codex-reset-monitor-store.test.js` — migration and atomic persistence tests.
- `src/lib/local-api.js` — inject Codex homes, expose sanitized event fields, add delivery endpoint.
- `test/local-api-codex-reset-events.test.js` — API contract and authorization tests.
- `test/local-api-codex-reset-lifecycle.test.js` — end-to-end backfill and live reset lifecycle.
- `test/codex-reset-privacy-contract.test.js` — prohibit prompt bodies and full paths.
- `dashboard/src/lib/api.ts` — event types, history fields, delivery API.
- `dashboard/src/hooks/use-codex-reset-events.ts` — native delivery coordinator and one shared unread state.
- `dashboard/src/hooks/__tests__/use-codex-reset-events.test.tsx` — delivery once and acknowledgement tests.
- `dashboard/src/pages/ResetHistoryPage.tsx` — grouped 30-day history with type/account/window/change.
- `dashboard/src/pages/ResetHistoryPage.test.tsx` — month range and grouping tests.
- `dashboard/src/components/CodexResetBanner.tsx` — green completed-reset treatment and history link.
- `dashboard/src/components/CodexResetBanner.test.tsx` — prominent live reset behavior.
- `dashboard/src/pages/WidgetsPage.jsx` — hide macOS-only controls outside the macOS bridge.
- `dashboard/src/pages/WidgetsPage.test.jsx` — Windows/macOS visibility test.
- `dashboard/src/content/copy.csv` — reset labels, account fallback, and notification text.
- `dashboard/package.json`, `dashboard/package-lock.json` — Tauri notification JavaScript package.
- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` — Tauri notification Rust plugin.
- `src-tauri/src/lib.rs` — register notification plugin.
- `src-tauri/src/tray.rs` — clickable reset-history item and unread wording.
- `src-tauri/capabilities/default.json` — notification permissions.

### Task 1: Parse the official reset-credit fields

**Files:**
- Create: `test/fixtures/codex/wham-usage-reset-credits.json`
- Modify: `src/lib/usage-limits.js`
- Test: `test/codex-usage-limits.test.js`

- [ ] **Step 1: Add the redacted fixture**

```json
{
  "rate_limit": {
    "primary_window": {
      "used_percent": 21,
      "limit_window_seconds": 604800,
      "reset_at": 1785814743
    }
  },
  "rate_limit_reset_credits": {
    "available_count": 2,
    "applicable_available_count": 1
  },
  "additional_rate_limits": []
}
```

- [ ] **Step 2: Replace the disabled-schema assertions with failing allowlist tests**

```js
test("allowlists only official reset-credit counters", () => {
  const fixture = require("./fixtures/codex/wham-usage-reset-credits.json");
  assert.deepEqual(CODEX_RESET_CREDIT_ALLOWLIST, [
    "rate_limit_reset_credits.available_count",
    "rate_limit_reset_credits.applicable_available_count",
  ]);
  assert.deepEqual(parseCodexResetCreditFields(fixture), {
    available_count: 2,
    applicable_available_count: 1,
  });
  assert.equal(parseCodexResetCreditFields({
    rate_limit_reset_credits: { available_count: -1, applicable_available_count: "secret" },
  }), null);
});
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run: `node --test test/codex-usage-limits.test.js`

Expected: FAIL because the allowlist is empty and the parser returns `null`.

- [ ] **Step 4: Implement strict non-negative integer parsing and return it from `getCodexUsageLimits`**

```js
const CODEX_RESET_CREDIT_ALLOWLIST = Object.freeze([
  "rate_limit_reset_credits.available_count",
  "rate_limit_reset_credits.applicable_available_count",
]);

function parseCodexResetCreditFields(body) {
  const source = body?.rate_limit_reset_credits;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const available = Number(source.available_count);
  const applicable = Number(source.applicable_available_count);
  if (
    !Number.isSafeInteger(available)
    || available < 0
    || !Number.isSafeInteger(applicable)
    || applicable < 0
  ) {
    return null;
  }
  return {
    available_count: available,
    applicable_available_count: applicable,
  };
}
```

In the successful `getCodexUsageLimits` return, add:

```js
reset_credits: parseCodexResetCreditFields(body),
```

- [ ] **Step 5: Run the focused tests**

Run: `node --test test/codex-usage-limits.test.js`

Expected: PASS, including an assertion that unrelated body fields never enter the returned object.

- [ ] **Step 6: Commit**

```bash
git add src/lib/usage-limits.js test/codex-usage-limits.test.js test/fixtures/codex/wham-usage-reset-credits.json
git commit -m "feat: parse Codex reset credit counters"
```

### Task 2: Extract privacy-safe reset snapshots from Codex rollouts

**Files:**
- Create: `src/lib/codex-reset-rollout-reader.js`
- Create: `test/codex-reset-rollout-reader.test.js`

- [ ] **Step 1: Write fixtures inside the test and assert only rate metadata is returned**

```js
test("extracts nested and direct rate-limit snapshots without message content", async () => {
  const direct = {
    timestamp: "2026-07-29T04:19:11.000Z",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: "codex",
        primary: { used_percent: 21, window_minutes: 10080, resets_at: 1785814743 },
        secondary: null,
      },
      user_message: "must never be returned",
    },
  };
  const nested = {
    timestamp: "2026-07-29T04:19:12.000Z",
    payload: {
      msg: {
        type: "token_count",
        rate_limits: {
          limit_id: "codex",
          primary: { used_percent: 0, window_minutes: 10080, resets_at: 1785903549 },
        },
      },
    },
  };
  const result = await collectCodexResetSnapshots({
    codexHomes: [fixtureHome],
    sinceMs: Date.parse("2026-06-29T00:00:00Z"),
  });
  assert.deepEqual(result.snapshots.map((item) => item.usedPercent), [21, 0]);
  assert.doesNotMatch(JSON.stringify(result), /must never be returned|user_message/u);
});
```

- [ ] **Step 2: Add cursor, cutoff, malformed-line, archived-session, and duplicate-file tests**

The cursor assertion must use hashed keys:

```js
assert.ok(Object.keys(result.cursor.files).every((key) => /^[a-f0-9]{32}$/u.test(key)));
assert.doesNotMatch(JSON.stringify(result.cursor), /sessions|rollout|Users|AgentData/u);
```

- [ ] **Step 3: Run the tests and verify the module is missing**

Run: `node --test test/codex-reset-rollout-reader.test.js`

Expected: FAIL with `Cannot find module '../src/lib/codex-reset-rollout-reader'`.

- [ ] **Step 4: Implement the streamed reader**

The exported interface is:

```js
async function collectCodexResetSnapshots({
  codexHomes,
  sinceMs,
  cursor = { files: {} },
}) {
  return {
    snapshots: [{
      observedAt: "2026-07-29T04:19:11.000Z",
      window: "rolling_weekly",
      usedPercent: 21,
      resetAt: "2026-08-04T03:39:03.000Z",
      accountKey: null,
      source: "codex_rollout",
    }],
    cursor: { files: { "0123456789abcdef0123456789abcdef": { offset: 1234, size: 1234, mtimeMs: 0 } } },
  };
}
```

Implementation constraints:

```js
const payload = object?.payload?.type === "token_count"
  ? object.payload
  : object?.payload?.msg?.type === "token_count"
    ? object.payload.msg
    : null;
const rateLimits = payload?.rate_limits;
if (rateLimits?.limit_id !== "codex") return null;
```

Map `window_minutes === 300` to `rolling_5_hour` and `10080` to `rolling_weekly`. Stream with `readline.createInterface`; skip every line that does not contain both `"token_count"` and `"rate_limits"` before parsing JSON. Enumerate only `sessions` and `archived_sessions`, and never return message fields or raw paths.

- [ ] **Step 5: Run reader and privacy tests**

Run: `node --test test/codex-reset-rollout-reader.test.js test/codex-reset-privacy-contract.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/codex-reset-rollout-reader.js test/codex-reset-rollout-reader.test.js test/codex-reset-privacy-contract.test.js
git commit -m "feat: read Codex reset snapshots locally"
```

### Task 3: Upgrade the reset state into a 30-day event ledger

**Files:**
- Modify: `src/lib/codex-reset-monitor.js`
- Modify: `src/lib/codex-reset-monitor-store.js`
- Test: `test/codex-reset-monitor.test.js`
- Test: `test/codex-reset-monitor-store.test.js`

- [ ] **Step 1: Replace the three-item assertions with 30-day retention tests**

```js
test("history keeps every actual reset in the last 30 days", () => {
  const nowMs = Date.parse("2026-07-29T12:00:00Z");
  const events = [
    resetEvent({ id: "inside-1", occurredAt: "2026-07-01T12:00:00Z" }),
    resetEvent({ id: "inside-2", occurredAt: "2026-07-29T11:00:00Z" }),
    resetEvent({ id: "expired", occurredAt: "2026-06-28T11:59:59Z" }),
  ];
  assert.deepEqual(
    listCodexResetHistory({ events }, { nowMs }).map((event) => event.id),
    ["inside-2", "inside-1"],
  );
});
```

- [ ] **Step 2: Add normal, manual, multi-source, and backfill alert-eligibility tests**

```js
test("credit decrease plus a new window emits one manual reset", () => {
  const before = evaluateCodexResetSnapshot(null, liveSnapshot({
    used: 21,
    resetAt: "2026-08-04T03:39:03Z",
    credits: 2,
  }), { nowMs: BASE });
  const after = evaluateCodexResetSnapshot(before, liveSnapshot({
    used: 0,
    resetAt: "2026-08-05T04:19:09Z",
    credits: 1,
  }), { nowMs: BASE + 60_000 });
  const event = after.events.find((item) => item.type === "manual_reset");
  assert.equal(event.previousUsedPercent, 21);
  assert.equal(event.currentUsedPercent, 0);
  assert.equal(event.alertEligible, true);
});

test("rollout backfill merges with the live event and never alerts", () => {
  const next = mergeCodexResetSnapshots(existing, rolloutSnapshots, {
    nowMs: BASE,
    backfill: true,
  });
  assert.equal(next.events.filter((event) => event.type === "manual_reset").length, 1);
  assert.equal(next.events[0].alertEligible, false);
});
```

- [ ] **Step 3: Run focused tests and verify failures**

Run: `node --test test/codex-reset-monitor.test.js test/codex-reset-monitor-store.test.js`

Expected: FAIL on the three-item cap, missing `manual_reset`, and state version mismatch.

- [ ] **Step 4: Define state version 2 and the normalized event shape**

```js
const MONITOR_STATE_VERSION = 2;
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

{
  id,
  type: "reset_completed" | "manual_reset",
  agent: "codex",
  accountKey: null,
  window: "rolling_5_hour" | "rolling_weekly",
  occurredAt,
  observedAt,
  previousUsedPercent,
  currentUsedPercent,
  previousResetAt,
  currentResetAt,
  source: "live_usage" | "codex_rollout",
  confidence: "confirmed" | "recovered",
  alertEligible,
  deliveredChannels: [],
}
```

Generate stable IDs as:

```js
const identityTime = type === "manual_reset" ? currentResetAt : previousResetAt;
sha256(`${type}|${accountKey || "default"}|${window}|${identityTime}`);
```

- [ ] **Step 5: Implement chronological transition evaluation and source merging**

Rules:

```js
const normalReset = previousResetMs <= observedMs
  && currentResetMs > previousResetMs
  && currentUsed < previousUsed;

const manualReset = currentResetMs > previousResetMs
  && currentUsed < previousUsed
  && (
    currentCredits < previousCredits
    || currentResetMs - observedMs >= windowDurationMs - 5 * 60_000
  );
```

When both are possible, `manual_reset` wins if the old scheduled time had not arrived. Merge duplicate IDs by unioning sources and keeping the earliest `occurredAt`, latest `observedAt`, strongest confidence, and `alertEligible === true` only when at least one live observation created the event.

- [ ] **Step 6: Migrate v1 state and prune by time, not count**

Existing `reset_completed` and `unexpected_quota_restore` events remain readable. Convert `unexpected_quota_restore` to `manual_reset` during normalization while preserving its ID in `legacyIds`. Do not send alerts for migrated events.

- [ ] **Step 7: Run focused tests**

Run: `node --test test/codex-reset-monitor.test.js test/codex-reset-monitor-store.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/codex-reset-monitor.js src/lib/codex-reset-monitor-store.js test/codex-reset-monitor.test.js test/codex-reset-monitor-store.test.js
git commit -m "feat: retain thirty days of Codex resets"
```

### Task 4: Backfill and poll through the monitor service

**Files:**
- Modify: `src/lib/codex-reset-monitor-service.js`
- Modify: `src/lib/local-api.js`
- Test: `test/codex-reset-monitor-service.test.js`
- Test: `test/local-api-codex-reset-lifecycle.test.js`

- [ ] **Step 1: Write failing startup-backfill and live-poll tests**

```js
test("starts a background 30-day backfill before live checks", async () => {
  const calls = [];
  const h = harness(reader, {
    collectCodexResetSnapshots: async ({ sinceMs }) => {
      calls.push(sinceMs);
      return { snapshots: recoveredSnapshots, cursor: { files: {} } };
    },
  });
  await h.service.backfill();
  assert.equal(calls[0], BASE - 30 * 24 * 60 * 60_000);
  assert.equal(h.service.listHistory().length, recoveredSnapshotsExpectedEvents);
  assert.equal(h.service.listNotificationPending().length, 0);
});
```

Also change the success interval expectation to:

```js
assert.equal(SUCCESS_INTERVAL_MS, 30_000);
```

- [ ] **Step 2: Run tests and verify failures**

Run: `node --test test/codex-reset-monitor-service.test.js test/local-api-codex-reset-lifecycle.test.js`

Expected: FAIL because there is no backfill dependency and successful polling is still two minutes.

- [ ] **Step 3: Inject the rollout reader and Codex homes**

Extend `createCodexResetMonitorService` with:

```js
collectCodexResetSnapshots,
getCodexHomes,
```

Expose:

```js
backfill,
listNotificationPending,
markDelivered,
```

Call `backfill()` from `start()` without blocking server startup. Persist the hashed rollout cursor in monitor state. Continue live polling even when backfill fails, recording only `backfill_error_code`.

- [ ] **Step 4: Use a 30-second success interval with existing failure backoff**

```js
const SUCCESS_INTERVAL_MS = 30_000;
const FAILURE_BACKOFF_MS = Object.freeze([2 * 60_000, 10 * 60_000, 30 * 60_000]);
```

Do not increase polling when Codex is unconfigured or authentication requires action.

- [ ] **Step 5: Wire the configured Codex homes in `local-api.js`**

Reuse `resolveDataDirectoryPaths` and pass all `codexHomes` to the reader. Do not inspect the default home twice when configured and default paths resolve to the same canonical path.

- [ ] **Step 6: Run focused lifecycle tests**

Run: `node --test test/codex-reset-monitor-service.test.js test/local-api-codex-reset-lifecycle.test.js`

Expected: PASS, including server startup with a failed backfill.

- [ ] **Step 7: Commit**

```bash
git add src/lib/codex-reset-monitor-service.js src/lib/local-api.js test/codex-reset-monitor-service.test.js test/local-api-codex-reset-lifecycle.test.js
git commit -m "feat: backfill Codex reset history"
```

### Task 5: Expose the sanitized ledger and notification delivery API

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `test/local-api-codex-reset-events.test.js`
- Modify: `test/codex-reset-privacy-contract.test.js`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/__tests__/api-codex-reset-events.test.ts`

- [ ] **Step 1: Write failing API contract tests**

Expected history DTO:

```json
{
  "id": "hex",
  "type": "manual_reset",
  "agent": "codex",
  "account_key": "default",
  "window": "rolling_weekly",
  "occurred_at": "2026-07-29T04:19:11.000Z",
  "observed_at": "2026-07-29T04:19:11.000Z",
  "previous_used_percent": 21,
  "current_used_percent": 0,
  "source": "codex_rollout",
  "confidence": "confirmed"
}
```

Assert that raw auth IDs, paths, prompts, and rollout filenames are absent.

- [ ] **Step 2: Add an authorized delivery endpoint test**

```js
POST /functions/tokentracker-codex-reset-events/delivered
{ "event_id": "hex", "channel": "windows_notification" }
```

Expected: `200`, the channel is persisted once, and a request without local mutation auth returns `403`.

- [ ] **Step 3: Run the API tests and verify failures**

Run: `node --test test/local-api-codex-reset-events.test.js test/codex-reset-privacy-contract.test.js`

Expected: FAIL on missing fields and endpoint.

- [ ] **Step 4: Extend sanitizers and route handling**

Allow only:

```js
const CODEX_RESET_EVENT_TYPES = new Set([
  "reset_upcoming",
  "reset_completed",
  "manual_reset",
  "banked_reset_available",
  "official_reset_announcement",
]);
const CODEX_RESET_DELIVERY_CHANNELS = new Set([
  "windows_notification",
]);
```

Clamp percentages to integers from 0 through 100. Account keys must match `/^[a-z0-9_-]{1,32}$/u`. Sources must be one of `live_usage`, `codex_rollout`, or `signed_feed`.

The response contract is:

```js
{
  ok: true,
  status,
  events: unreadEvents,
  notification_events: notificationPendingEvents,
  history,
}
```

Only live `reset_completed` and `manual_reset` events with `alertEligible === true` may enter `notification_events`. Sanitized events expose this as `alert_eligible`; backfilled and migrated history exposes `false`.

- [ ] **Step 5: Update dashboard types and API call**

```ts
export type CodexResetEventType =
  | "reset_upcoming"
  | "reset_completed"
  | "manual_reset"
  | "banked_reset_available"
  | "official_reset_announcement";

export interface CodexResetEvent {
  // existing safe fields
  alert_eligible: boolean;
}

export interface CodexResetEventsResponse {
  ok: boolean;
  status: CodexResetMonitorStatus;
  events: CodexResetEvent[];
  notification_events: CodexResetEvent[];
  history: CodexResetHistoryEvent[];
}

export async function markCodexResetEventDelivered(
  eventId: string,
  channel: "windows_notification",
): Promise<void> {
  // POST through fetchLocalJson with local auth headers.
}
```

- [ ] **Step 6: Run backend and dashboard API tests**

Run: `node --test test/local-api-codex-reset-events.test.js test/codex-reset-privacy-contract.test.js`

Run: `npm --prefix dashboard test -- --run src/lib/__tests__/api-codex-reset-events.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-api.js test/local-api-codex-reset-events.test.js test/codex-reset-privacy-contract.test.js dashboard/src/lib/api.ts dashboard/src/lib/__tests__/api-codex-reset-events.test.ts
git commit -m "feat: expose reset ledger delivery state"
```

### Task 6: Render the full 30-day history

**Files:**
- Modify: `dashboard/src/pages/ResetHistoryPage.tsx`
- Modify: `dashboard/src/pages/ResetHistoryPage.test.tsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Write failing grouping and metadata tests**

```tsx
expect(screen.getByRole("heading", { name: "2026年7月29日" })).toBeInTheDocument();
expect(screen.getByText("手动重置")).toBeInTheDocument();
expect(screen.getByText("21% → 0%")).toBeInTheDocument();
expect(screen.getByText("Codex · 默认账号 · 7天额度")).toBeInTheDocument();
expect(screen.getAllByTestId("reset-history-item")).toHaveLength(8);
```

The fixture must contain multiple records on one day and records across the full 30-day range. The test must prove the page no longer slices past events to three.

- [ ] **Step 2: Run the page test and verify it fails**

Run: `npm --prefix dashboard test -- --run src/pages/ResetHistoryPage.test.tsx`

Expected: FAIL because the page renders at most three past events and lacks event metadata.

- [ ] **Step 3: Group by local calendar day**

Use a `Map<string, CodexResetHistoryEvent[]>` keyed by an `Intl.DateTimeFormat` local date key. Keep events descending within each group and groups descending by their first event.

Render each row as:

```tsx
<p>{event.type === "manual_reset"
  ? copy("reset_history.type.manual")
  : copy("reset_history.type.scheduled")}</p>
<p>{`${event.previous_used_percent}% → ${event.current_used_percent}%`}</p>
<time dateTime={event.occurred_at}>{formatResetTime(event.occurred_at)}</time>
```

The primary list remains compact. Do not show diagnostic source/confidence unless a disclosure is opened.

- [ ] **Step 4: Add all user-facing strings through `copy.csv`**

Add keys for manual reset, scheduled reset, default account, 5-hour window, weekly window, diagnostic source, and empty history. Do not hardcode Chinese strings in TSX.

- [ ] **Step 5: Run page, type, copy, and hardcode validation**

Run: `npm --prefix dashboard test -- --run src/pages/ResetHistoryPage.test.tsx`

Run: `npm --prefix dashboard run typecheck`

Run: `npm run validate:copy`

Run: `npm run validate:ui-hardcode`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/pages/ResetHistoryPage.tsx dashboard/src/pages/ResetHistoryPage.test.tsx dashboard/src/content/copy.csv
git commit -m "feat: show thirty-day reset history"
```

### Task 7: Deliver native Windows notifications exactly once

**Files:**
- Create: `dashboard/src/lib/codex-reset-notifications.ts`
- Create: `dashboard/src/lib/__tests__/codex-reset-notifications.test.ts`
- Modify: `dashboard/src/hooks/use-codex-reset-events.ts`
- Modify: `dashboard/src/hooks/__tests__/use-codex-reset-events.test.tsx`
- Modify: `dashboard/package.json`
- Modify: `dashboard/package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add failing native, denied-permission, web, and duplicate tests**

```ts
it("sends one native notification and marks delivery after success", async () => {
  permission.isPermissionGranted.mockResolvedValue(true);
  await deliverResetNotification(event);
  expect(sendNotification).toHaveBeenCalledWith({
    title: "Codex 额度已重置",
    body: "12:19 已恢复，21% → 0%",
    sound: "default",
  });
  expect(markCodexResetEventDelivered).toHaveBeenCalledWith(
    event.id,
    "windows_notification",
  );
});
```

Denied permission and regular web mode must return `{ delivered: false, fallback: true }` without marking delivery.

- [ ] **Step 2: Install the official Tauri notification plugin**

Run:

```bash
npm --prefix dashboard install @tauri-apps/plugin-notification@^2
cd src-tauri
cargo add tauri-plugin-notification@2
```

Expected: dashboard lockfile and Cargo lockfile update.

- [ ] **Step 3: Register plugin and permission**

In `src-tauri/src/lib.rs`:

```rust
.plugin(tauri_plugin_notification::init())
```

In `src-tauri/capabilities/default.json`, add:

```json
"notification:default"
```

- [ ] **Step 4: Implement the delivery helper**

Only import the plugin in a Tauri runtime. Request permission at the first live reset, not application startup. Send only `reset_completed` and `manual_reset` events with `alert_eligible === true`.

Call the delivery endpoint only after `sendNotification` returns without throwing. The main-window banner, tray, and later widget remain available when permission is denied.

- [ ] **Step 5: Invoke delivery from the provider without acknowledging the event**

The provider processes `response.notification_events` sequentially. Native delivery changes only delivery state; the banner and unread dot remain until the user views or acknowledges the record.

- [ ] **Step 6: Run dashboard and Rust tests**

Run: `npm --prefix dashboard test -- --run src/lib/__tests__/codex-reset-notifications.test.ts src/hooks/__tests__/use-codex-reset-events.test.tsx`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/lib/codex-reset-notifications.ts dashboard/src/lib/__tests__/codex-reset-notifications.test.ts dashboard/src/hooks/use-codex-reset-events.ts dashboard/src/hooks/__tests__/use-codex-reset-events.test.tsx dashboard/package.json dashboard/package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat: notify Windows users after quota resets"
```

### Task 8: Make the in-app and tray alerts prominent and actionable

**Files:**
- Modify: `dashboard/src/components/CodexResetBanner.tsx`
- Modify: `dashboard/src/components/CodexResetBanner.test.tsx`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `src-tauri/src/tray.rs`
- Test: `src-tauri/src/tray.rs`

- [ ] **Step 1: Write failing banner behavior tests**

For a completed/manual reset, assert:

```tsx
expect(screen.getByRole("status")).toHaveClass("bg-emerald-50");
expect(screen.getByText("21% → 0%")).toBeInTheDocument();
expect(screen.getByRole("link", { name: "查看重置记录" })).toHaveAttribute(
  "href",
  "/reset-history",
);
```

Keep official announcements amber; only successful quota restoration is green.

- [ ] **Step 2: Implement the green live-reset banner**

Use `CheckCircle2` for successful resets, keep `BellRing` for announcements, and link to `/reset-history`. The banner must remain non-modal and must not automatically acknowledge the event.

- [ ] **Step 3: Make the tray reset item clickable**

Change `codex-reset-status` to an enabled menu item. On click:

```rust
restore_main_window(app);
if let Some(window) = app.get_webview_window("main") {
    let _ = window.eval(
        "window.location.hash.startsWith('#/') \
         ? window.location.hash = '#/reset-history' \
         : window.location.assign('/reset-history')"
    );
}
```

This handles both router modes configured in `dashboard/src/AppRuntime.jsx`. The tray label remains `Codex 额度已重置 · N 条未读`.

- [ ] **Step 4: Run banner and Rust tray tests**

Run: `npm --prefix dashboard test -- --run src/components/CodexResetBanner.test.tsx`

Run: `cargo test --manifest-path src-tauri/Cargo.toml tray`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/CodexResetBanner.tsx dashboard/src/components/CodexResetBanner.test.tsx dashboard/src/content/copy.csv src-tauri/src/tray.rs
git commit -m "feat: highlight unread reset events"
```

### Task 9: Hide macOS-only widget controls on Windows

**Files:**
- Modify: `dashboard/src/pages/WidgetsPage.jsx`
- Test: `dashboard/src/pages/WidgetsPage.test.jsx`

- [ ] **Step 1: Add platform visibility tests**

```tsx
it("hides animated icon and confetti outside the macOS native bridge", () => {
  mockNativeSettings({ available: false });
  renderWidgetsPage();
  expect(screen.queryByText("动画图标")).not.toBeInTheDocument();
  expect(screen.queryByText("额度重置时撒花")).not.toBeInTheDocument();
});

it("keeps the controls in the macOS native bridge", () => {
  mockNativeSettings({ available: true });
  renderWidgetsPage();
  expect(screen.getByText("动画图标")).toBeInTheDocument();
  expect(screen.getByText("额度重置时撒花")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm --prefix dashboard test -- --run src/pages/WidgetsPage.test.jsx`

Expected: FAIL because both rows are currently always rendered.

- [ ] **Step 3: Gate only the two macOS-specific rows**

```jsx
{available ? (
  <>
    <MenuBarToggleRow
      label={copy("settings.menubar.animatedIcon")}
      hint={copy("settings.menubar.animatedIconHint")}
      checked={animatedIcon}
      disabled={false}
      onChange={() => setSetting("animatedIcon", !animatedIcon)}
    />
    <MenuBarToggleRow
      label={copy("settings.menubar.confettiOnReset")}
      hint={copy("settings.menubar.confettiOnResetHint")}
      checked={confettiOnReset}
      disabled={false}
      onChange={() => setSetting("confettiOnReset", !confettiOnReset)}
    />
  </>
) : null}
```

Do not hide unrelated desktop-widget controls or remove the macOS settings keys.

- [ ] **Step 4: Run the page test**

Run: `npm --prefix dashboard test -- --run src/pages/WidgetsPage.test.jsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/WidgetsPage.jsx dashboard/src/pages/WidgetsPage.test.jsx
git commit -m "fix: hide macOS widget settings on Windows"
```

### Task 10: End-to-end verification

**Files:**
- Modify only files required by failures directly caused by Tasks 1–9.

- [ ] **Step 1: Run all reset-specific backend tests**

Run:

```bash
node --test test/codex-usage-limits.test.js test/codex-reset-rollout-reader.test.js test/codex-reset-monitor.test.js test/codex-reset-monitor-store.test.js test/codex-reset-monitor-service.test.js test/local-api-codex-reset-events.test.js test/local-api-codex-reset-lifecycle.test.js test/codex-reset-privacy-contract.test.js
```

Expected: PASS.

- [ ] **Step 2: Run all reset-specific dashboard tests**

Run:

```bash
npm --prefix dashboard test -- --run src/lib/__tests__/api-codex-reset-events.test.ts src/lib/__tests__/codex-reset-notifications.test.ts src/hooks/__tests__/use-codex-reset-events.test.tsx src/pages/ResetHistoryPage.test.tsx src/components/CodexResetBanner.test.tsx src/pages/WidgetsPage.test.jsx
```

Expected: PASS.

- [ ] **Step 3: Run static validation and builds**

Run:

```bash
npm --prefix dashboard run typecheck
npm --prefix dashboard run build
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: every command exits 0.

- [ ] **Step 4: Run the full repository suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Verify an installed Windows build**

Build and install through the existing Tauri smoke workflow. Confirm:

1. A newly created synthetic live reset appears once in history.
2. Windows displays one native toast with sound.
3. The main-window banner is green and remains until viewed.
4. The tray shows an unread reset and opens reset history.
5. Restarting Token Eyes does not send the same native toast again.
6. A synthetic old rollout event enters history without any current notification.
7. The history contains all fixture events within 30 days and none older.
8. No prompt, message, auth token, account ID, or full local path appears in the reset-state JSON or API response.

- [ ] **Step 6: Commit verification-only corrections**

Run: `git status --short`

Expected: clean except for pre-existing unrelated files. If Task 10 required a correction, return to the task that owns the failing file, repeat its focused test and commit step, then rerun Task 10 from Step 1.

## Widget-plan contract

The desktop-widget implementation must consume these exact fields:

```ts
interface WidgetResetAlert {
  id: string;
  agent: "codex";
  type: "reset_completed" | "manual_reset";
  occurred_at: string;
  previous_used_percent: number;
  current_used_percent: number;
  alert_eligible: boolean;
}
```

It must use the existing acknowledgement call and must not create a widget-only reset store, poller, or notification-delivery flag.
