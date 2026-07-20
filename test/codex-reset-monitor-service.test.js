"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FAILURE_BACKOFF_MS,
  FOCUS_FRESHNESS_MS,
  STARTUP_DELAY_MS,
  SUCCESS_INTERVAL_MS,
  createCodexResetMonitorService,
} = require("../src/lib/codex-reset-monitor-service");

const BASE = Date.parse("2026-07-20T08:00:00.000Z");

function validSnapshot(nowMs, used = 40) {
  return {
    configured: true,
    checked_at: new Date(nowMs).toISOString(),
    primary_window: {
      used_percent: used,
      reset_at: new Date(nowMs + 60 * 60_000).toISOString(),
    },
    secondary_window: {
      used_percent: 60,
      reset_at: new Date(nowMs + 4 * 24 * 60 * 60_000).toISOString(),
    },
    spark_primary_window: null,
    spark_secondary_window: null,
  };
}

function harness(reader) {
  let nowMs = BASE;
  const timers = [];
  const cleared = [];
  let saved = null;
  const service = createCodexResetMonitorService({
    getCodexUsageLimits: reader,
    loadState: () => saved,
    saveState: (state) => {
      saved = JSON.parse(JSON.stringify(state));
    },
    now: () => nowMs,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => cleared.push(timer),
    enabled: true,
  });
  return {
    service,
    timers,
    cleared,
    getNow: () => nowMs,
    getSaved: () => saved,
    setNow: (value) => {
      nowMs = value;
    },
  };
}

test("uses the exact startup, success, freshness, and failure schedules", async () => {
  assert.equal(STARTUP_DELAY_MS, 30_000);
  assert.equal(SUCCESS_INTERVAL_MS, 10 * 60_000);
  assert.equal(FOCUS_FRESHNESS_MS, 5 * 60_000);
  assert.deepEqual(FAILURE_BACKOFF_MS, [10 * 60_000, 30 * 60_000, 2 * 60 * 60_000]);

  const reads = [];
  const h = harness(async () => {
    reads.push(1);
    return validSnapshot(BASE);
  });
  h.service.start();
  assert.equal(h.timers.at(-1).delay, STARTUP_DELAY_MS);
  await h.service.check({ reason: "timer" });
  assert.equal(reads.length, 1);
  assert.equal(h.timers.at(-1).delay, SUCCESS_INTERVAL_MS);

  const skipped = await h.service.check({ reason: "focus" });
  assert.equal(skipped.skipped, "fresh");
  assert.equal(reads.length, 1);
});

test("backs off 10, 30, then 120 minutes and caps there", async () => {
  const h = harness(async () => {
    throw new Error("secret network detail");
  });
  h.service.start();
  for (const expected of [
    FAILURE_BACKOFF_MS[0],
    FAILURE_BACKOFF_MS[1],
    FAILURE_BACKOFF_MS[2],
    FAILURE_BACKOFF_MS[2],
  ]) {
    await h.service.check({ reason: "timer", force: true });
    assert.equal(h.timers.at(-1).delay, expected);
  }
  assert.equal(h.service.getStatus().last_error_code, "network_error");
  assert.doesNotMatch(JSON.stringify(h.service.getStatus()), /secret|detail/);
});

test("single-flight, unconfigured state, valid-only evaluation, and stop are safe", async () => {
  let release;
  let calls = 0;
  const h = harness(() => {
    calls += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  h.service.start();
  const first = h.service.check({ reason: "manual", force: true });
  const second = h.service.check({ reason: "manual", force: true });
  assert.equal(first, second);
  assert.equal(calls, 1);
  release({ configured: false, checked_at: new Date(BASE).toISOString() });
  await first;
  assert.equal(h.service.getStatus().configured, false);
  assert.equal(h.service.getStatus().unread_count, 0);
  assert.equal(h.service.listUnread().length, 0);

  h.service.stop();
  assert.ok(h.cleared.length >= 1);
});

test("valid snapshots enter the state machine and acknowledgement persists", async () => {
  const resetAt = new Date(BASE + 60 * 60_000).toISOString();
  const h = harness(async () => ({
    ...validSnapshot(BASE, 80),
    checked_at: new Date(h.getNow()).toISOString(),
    primary_window: {
      used_percent: 80,
      reset_at: resetAt,
    },
  }));
  await h.service.check({ reason: "manual", force: true });
  h.setNow(BASE + 31 * 60_000);
  await h.service.check({ reason: "manual", force: true });
  const unread = h.service.listUnread();
  assert.equal(unread.length, 1);
  h.service.acknowledge(unread[0].id);
  assert.equal(h.service.listUnread().length, 0);
  assert.ok(h.getSaved().acknowledgedEventIds.includes(unread[0].id));
});
