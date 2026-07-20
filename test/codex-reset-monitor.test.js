"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  acknowledgeCodexResetEvent,
  evaluateCodexResetSnapshot,
  listUnreadCodexResetEvents,
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
  assert.equal(
    confirmed.events.filter((event) => event.type === "unexpected_quota_restore").length,
    1,
  );
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
