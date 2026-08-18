"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  RESET_HISTORY_DAYS,
  acknowledgeCodexResetEvent,
  compactCodexResetEvents,
  evaluateCodexResetSnapshot,
  listCodexResetHistory,
  listUnreadCodexResetEvents,
  mergeCodexResetSnapshots,
} = require("../src/lib/codex-reset-monitor");

const MINUTE = 60_000;
const BASE = Date.parse("2026-07-20T08:00:00.000Z");

function snapshot({
  nowMs = BASE,
  primaryUsed = 60,
  primaryResetMs = BASE + 60 * MINUTE,
  secondaryUsed = 40,
  secondaryResetMs = BASE + 4 * 24 * 60 * MINUTE,
  ...extra
} = {}) {
  return {
    configured: true,
    checked_at: new Date(nowMs).toISOString(),
    primary_window: {
      used_percent: primaryUsed,
      reset_at: new Date(primaryResetMs).toISOString(),
    },
    secondary_window: {
      used_percent: secondaryUsed,
      reset_at: new Date(secondaryResetMs).toISOString(),
    },
    spark_primary_window: null,
    spark_secondary_window: null,
    ...extra,
  };
}

test("upcoming event appears once and survives restart without duplication", () => {
  const first = evaluateCodexResetSnapshot(
    null,
    snapshot({ primaryResetMs: BASE + 29 * MINUTE }),
    { nowMs: BASE },
  );
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].type, "reset_upcoming");
  assert.equal(first.events[0].window, "rolling_5_hour");

  const restarted = JSON.parse(JSON.stringify(first));
  const second = evaluateCodexResetSnapshot(
    restarted,
    snapshot({ nowMs: BASE + MINUTE, primaryResetMs: BASE + 29 * MINUTE }),
    { nowMs: BASE + MINUTE },
  );
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].id, first.events[0].id);
});

test("crossing a reset emits completed only for a later window with lower usage", () => {
  const before = evaluateCodexResetSnapshot(
    null,
    snapshot({ nowMs: BASE, primaryUsed: 91, primaryResetMs: BASE + MINUTE }),
    { nowMs: BASE },
  );
  const after = evaluateCodexResetSnapshot(
    before,
    snapshot({
      nowMs: BASE + 2 * MINUTE,
      primaryUsed: 4,
      primaryResetMs: BASE + 5 * 60 * MINUTE,
    }),
    { nowMs: BASE + 2 * MINUTE },
  );
  assert.equal(after.events.filter((event) => event.type === "reset_completed").length, 1);
});

test("credit decrease plus a new future window emits one manual reset", () => {
  const before = evaluateCodexResetSnapshot(
    null,
    snapshot({
      primaryUsed: 21,
      primaryResetMs: BASE + 7 * 24 * 60 * MINUTE,
      reset_credits: { available_count: 2, applicable_available_count: 2 },
    }),
    { nowMs: BASE },
  );
  const after = evaluateCodexResetSnapshot(
    before,
    snapshot({
      nowMs: BASE + MINUTE,
      primaryUsed: 0,
      primaryResetMs: BASE + 8 * 24 * 60 * MINUTE,
      reset_credits: { available_count: 1, applicable_available_count: 1 },
    }),
    { nowMs: BASE + MINUTE },
  );

  const event = after.events.find((item) => item.type === "manual_reset");
  assert.ok(event);
  assert.equal(event.agent, "codex");
  assert.equal(event.previousUsedPercent, 21);
  assert.equal(event.currentUsedPercent, 0);
  assert.equal(event.alertEligible, true);
  assert.deepEqual(event.deliveredChannels, []);
});

test("rollout backfill records a recovered manual reset without alerting", () => {
  assert.equal(typeof mergeCodexResetSnapshots, "function");
  const snapshots = [
    {
      observedAt: new Date(BASE).toISOString(),
      window: "rolling_weekly",
      usedPercent: 21,
      resetAt: new Date(BASE + 6 * 24 * 60 * MINUTE).toISOString(),
      accountKey: null,
      source: "codex_rollout",
    },
    {
      observedAt: new Date(BASE + MINUTE).toISOString(),
      window: "rolling_weekly",
      usedPercent: 0,
      resetAt: new Date(BASE + 7 * 24 * 60 * MINUTE + MINUTE).toISOString(),
      accountKey: null,
      source: "codex_rollout",
    },
  ];
  const state = mergeCodexResetSnapshots(null, snapshots, {
    nowMs: BASE + 2 * MINUTE,
    backfill: true,
  });
  const event = state.events.find((item) => item.type === "manual_reset");
  assert.ok(event);
  assert.equal(event.source, "codex_rollout");
  assert.equal(event.confidence, "recovered");
  assert.equal(event.alertEligible, false);
});

test("metadata-only snapshots do not erase the last reset-credit counters", () => {
  const live = evaluateCodexResetSnapshot(
    null,
    snapshot({
      reset_credits: { available_count: 2, applicable_available_count: 2 },
    }),
    { nowMs: BASE },
  );
  const merged = mergeCodexResetSnapshots(live, [{
    observedAt: new Date(BASE + MINUTE).toISOString(),
    window: "rolling_weekly",
    usedPercent: 39,
    resetAt: new Date(BASE + 5 * 24 * 60 * MINUTE).toISOString(),
    source: "codex_rollout",
  }], {
    nowMs: BASE + MINUTE,
    backfill: true,
  });
  assert.deepEqual(merged.resetCredits, {
    availableCount: 2,
    applicableAvailableCount: 2,
  });
});

test("early 20-point drop requires two observations at least five minutes apart", () => {
  const baseline = evaluateCodexResetSnapshot(
    null,
    snapshot({ primaryUsed: 75 }),
    { nowMs: BASE },
  );
  const candidate = evaluateCodexResetSnapshot(
    baseline,
    snapshot({ nowMs: BASE + MINUTE, primaryUsed: 50 }),
    { nowMs: BASE + MINUTE },
  );
  assert.equal(
    candidate.events.filter((event) => event.type === "unexpected_quota_restore").length,
    0,
  );

  const tooSoon = evaluateCodexResetSnapshot(
    candidate,
    snapshot({ nowMs: BASE + 4 * MINUTE, primaryUsed: 49 }),
    { nowMs: BASE + 4 * MINUTE },
  );
  assert.equal(
    tooSoon.events.filter((event) => event.type === "unexpected_quota_restore").length,
    0,
  );

  const confirmed = evaluateCodexResetSnapshot(
    tooSoon,
    snapshot({ nowMs: BASE + 7 * MINUTE, primaryUsed: 48 }),
    { nowMs: BASE + 7 * MINUTE },
  );
  const event = confirmed.events.find(
    (item) => item.type === "unexpected_quota_restore",
  );
  assert.ok(event);
  assert.equal(event.alertEligible, true);
  assert.equal(event.previousUsedPercent, 75);
  assert.equal(event.currentUsedPercent, 48);
});

test("bounce, missing, stale, error, and unsupported snapshots clear restore candidates", () => {
  const baseline = evaluateCodexResetSnapshot(
    null,
    snapshot({ primaryUsed: 80 }),
    { nowMs: BASE },
  );
  const candidate = evaluateCodexResetSnapshot(
    baseline,
    snapshot({ nowMs: BASE + MINUTE, primaryUsed: 50 }),
    { nowMs: BASE + MINUTE },
  );
  assert.ok(candidate.restoreCandidates.rolling_5_hour);

  const bounced = evaluateCodexResetSnapshot(
    candidate,
    snapshot({ nowMs: BASE + 7 * MINUTE, primaryUsed: 79 }),
    { nowMs: BASE + 7 * MINUTE },
  );
  assert.deepEqual(bounced.restoreCandidates, {});

  for (const invalid of [
    { configured: true, checked_at: new Date(BASE + 8 * MINUTE).toISOString() },
    snapshot({ nowMs: BASE - 60 * MINUTE }),
    { configured: true, checked_at: new Date(BASE + 8 * MINUTE).toISOString(), error_code: "network_error" },
    { configured: true, checked_at: new Date(BASE + 8 * MINUTE).toISOString(), unsupported: true },
  ]) {
    const result = evaluateCodexResetSnapshot(candidate, invalid, { nowMs: BASE + 8 * MINUTE });
    assert.deepEqual(result.restoreCandidates, {});
    assert.equal(
      result.events.filter((event) => event.type === "unexpected_quota_restore").length,
      0,
    );
  }
});

test("acknowledgement hides unread event but retains bounded history", () => {
  let state = evaluateCodexResetSnapshot(
    null,
    snapshot({
      primaryResetMs: BASE + 29 * MINUTE,
      secondaryResetMs: BASE + 28 * MINUTE,
    }),
    { nowMs: BASE },
  );
  assert.equal(listUnreadCodexResetEvents(state).length, 2);
  const firstId = state.events[0].id;
  state = acknowledgeCodexResetEvent(state, firstId, {
    channels: ["widget", "tray"],
    nowMs: BASE + MINUTE,
  });
  assert.deepEqual(state.events[0].acknowledgedChannels, ["widget", "tray"]);
  assert.equal(listUnreadCodexResetEvents(state, { channel: "banner" }).length, 2);
  assert.equal(listUnreadCodexResetEvents(state, { channel: "widget" }).length, 1);
  assert.equal(listUnreadCodexResetEvents(state, { channel: "tray" }).length, 1);

  state = acknowledgeCodexResetEvent(state, firstId, { nowMs: BASE + MINUTE });
  assert.equal(state.events.length, 2);
  assert.equal(listUnreadCodexResetEvents(state).length, 1);

  state.events = Array.from({ length: 130 }, (_, index) => ({
    ...state.events[0],
    id: `event-${index}`,
    createdAt: new Date(BASE + index).toISOString(),
  }));
  state.acknowledgedEventIds = Array.from({ length: 230 }, (_, index) => `ack-${index}`);
  state = evaluateCodexResetSnapshot(
    state,
    snapshot({ nowMs: BASE + 10 * MINUTE }),
    { nowMs: BASE + 10 * MINUTE },
  );
  assert.equal(state.events.length, 100);
  assert.equal(state.acknowledgedEventIds.length, 200);
});

test("acknowledgement compacts history against the caller clock", () => {
  const previous = {
    id: "official:previous",
    type: "official_reset_announcement",
    createdAt: new Date(BASE - 24 * 60 * MINUTE).toISOString(),
    acknowledgedChannels: [],
  };
  const latest = {
    ...previous,
    id: "official:latest",
    createdAt: new Date(BASE).toISOString(),
  };

  const state = acknowledgeCodexResetEvent({
    events: [previous, latest],
    acknowledgedEventIds: [],
  }, latest.id, { nowMs: BASE });

  assert.deepEqual(state.events.map((event) => event.id), [previous.id, latest.id]);
});

test("reset history retains local and official resets from the last 30 days in occurrence order", () => {
  const completed = Array.from({ length: 6 }, (_, index) => ({
    id: `completed-${index}`,
    type: "reset_completed",
    window: "rolling_5_hour",
    createdAt: new Date(BASE - (index + 1) * 24 * 60 * MINUTE).toISOString(),
    resetAt: new Date(BASE - (index + 1) * 24 * 60 * MINUTE).toISOString(),
    officialUrl: "https://chatgpt.com/codex",
    source: "local_quota",
  }));
  const restored = {
    id: "restored-latest",
    type: "unexpected_quota_restore",
    window: "rolling_weekly",
    createdAt: new Date(BASE - 10 * MINUTE).toISOString(),
    resetAt: new Date(BASE + 24 * 60 * MINUTE).toISOString(),
    officialUrl: "https://chatgpt.com/codex",
    source: "local_quota",
  };
  const ignored = [
    {
      ...completed[0],
      id: "upcoming",
      type: "reset_upcoming",
      createdAt: new Date(BASE + 20 * MINUTE).toISOString(),
    },
    {
      ...completed[0],
      id: "official",
      type: "official_reset_announcement",
      createdAt: new Date(BASE + 30 * MINUTE).toISOString(),
    },
  ];

  const expired = {
    ...completed[0],
    id: "expired",
    createdAt: new Date(BASE - 31 * 24 * 60 * MINUTE).toISOString(),
    resetAt: new Date(BASE - 31 * 24 * 60 * MINUTE).toISOString(),
  };
  const history = listCodexResetHistory(
    { events: [...completed, restored, expired, ...ignored] },
    { nowMs: BASE },
  );

  assert.equal(RESET_HISTORY_DAYS, 30);
  assert.equal(history.length, 8);
  assert.deepEqual(
    history.map((event) => event.id),
    [
      "official",
      "restored-latest",
      "completed-0",
      "completed-1",
      "completed-2",
      "completed-3",
      "completed-4",
      "completed-5",
    ],
  );
  assert.equal(history[0].occurredAt, ignored[1].createdAt);
  assert.equal(history[1].occurredAt, restored.createdAt);
  assert.equal(history[2].occurredAt, completed[0].resetAt);
});

test("event compaction keeps all 30-day resets without deleting other reminder types", () => {
  const actual = Array.from({ length: 130 }, (_, index) => ({
    id: `actual-${index}`,
    type: "reset_completed",
    window: "rolling_5_hour",
    createdAt: new Date(BASE - index * 60 * MINUTE).toISOString(),
    resetAt: new Date(BASE - index * 60 * MINUTE).toISOString(),
  }));
  const other = [
    {
      id: "upcoming",
      type: "reset_upcoming",
      createdAt: new Date(BASE + 20 * MINUTE).toISOString(),
      resetAt: new Date(BASE + 30 * MINUTE).toISOString(),
    },
    {
      id: "official",
      type: "official_reset_announcement",
      createdAt: new Date(BASE + 21 * MINUTE).toISOString(),
      resetAt: null,
    },
  ];

  const compacted = compactCodexResetEvents([...actual, ...other], { nowMs: BASE });

  assert.equal(
    compacted.filter((event) => event.type === "reset_completed").length,
    130,
  );
  assert.equal(compacted.some((event) => event.id === "upcoming"), true);
  assert.equal(compacted.some((event) => event.id === "official"), true);
  assert.equal(compacted.some((event) => event.id === "actual-0"), true);
  assert.equal(compacted.some((event) => event.id === "actual-129"), true);
});
