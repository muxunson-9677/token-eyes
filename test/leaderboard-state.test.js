"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  COMPACT_STATE_MAX_BYTES,
  assertCompactStateSize,
  buildLeaderboardDeviceState,
  stableStateHash,
} = require("../src/lib/leaderboard-state");

const CAPTURED_AT = "2026-07-20T08:00:00.000Z";

function row(hourStart, overrides = {}) {
  return {
    hour_start: hourStart,
    source: "codex",
    model: "gpt-5.4",
    input_tokens: 100,
    output_tokens: 20,
    cached_input_tokens: 10,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 130,
    ...overrides,
  };
}

test("builds UTC+8 today, Monday week, month, and total periods at exact boundaries", () => {
  const state = buildLeaderboardDeviceState([
    row("2026-06-30T15:30:00.000Z", { input_tokens: 1 }),
    row("2026-06-30T16:00:00.000Z", { input_tokens: 2 }),
    row("2026-07-19T15:30:00.000Z", { input_tokens: 4 }),
    row("2026-07-19T16:00:00.000Z", { input_tokens: 8 }),
  ], {
    deviceId: "stable-machine-id",
    capturedAt: CAPTURED_AT,
  });

  assert.deepEqual(state, {
    version: 1,
    device_id: "stable-machine-id",
    captured_at: CAPTURED_AT,
    periods: {
      today: [["codex", "gpt-5.4", "8", "20", "10", "0", "0"]],
      week: [["codex", "gpt-5.4", "8", "20", "10", "0", "0"]],
      month: [["codex", "gpt-5.4", "14", "60", "30", "0", "0"]],
      total: [["codex", "gpt-5.4", "15", "80", "40", "0", "0"]],
    },
  });
});

test("groups cumulative rows by source and model and serializes exact decimal strings", () => {
  const state = buildLeaderboardDeviceState([
    row("2026-07-20T01:00:00.000Z", {
      input_tokens: "9007199254740993",
      output_tokens: "2",
      project: "secret-project",
      cwd: "C:\\private",
      conversation_count: 99,
      skill: "private-skill",
      mcp: "private-mcp",
      path: "C:\\private\\chat.jsonl",
      quota: { remaining: 1 },
    }),
    row("2026-07-20T01:30:00.000Z", {
      input_tokens: "7",
      output_tokens: null,
      cached_input_tokens: "",
    }),
    row("2026-07-20T02:00:00.000Z", {
      source: "claude",
      model: "claude-opus-4-1",
      input_tokens: 3,
      output_tokens: 0,
      cached_input_tokens: 0,
    }),
    row("2026-07-20T02:30:00.000Z", {
      source: "empty",
      model: "ignored",
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
    }),
  ], {
    deviceId: "stable-machine-id",
    capturedAt: CAPTURED_AT,
  });

  const expectedRows = [
    ["claude", "claude-opus-4-1", "3", "0", "0", "0", "0"],
    ["codex", "gpt-5.4", "9007199254741000", "2", "10", "0", "0"],
  ];
  assert.deepEqual(state.periods.today, expectedRows);
  assert.equal(JSON.stringify(state).includes("empty"), false);

  const serialized = JSON.stringify(state);
  for (const forbidden of [
    "secret-project",
    "private-skill",
    "private-mcp",
    "conversation_count",
    "quota",
    "chat.jsonl",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `must omit ${forbidden}`);
  }
});

test("produces a stable SHA-256 hash for semantically identical row order", () => {
  const rows = [
    row("2026-07-20T01:00:00.000Z", { source: "claude", model: "claude-sonnet-4", input_tokens: 1 }),
    row("2026-07-20T02:00:00.000Z", { input_tokens: 2 }),
  ];
  const options = { deviceId: "stable-machine-id", capturedAt: CAPTURED_AT };
  const first = buildLeaderboardDeviceState(rows, options);
  const second = buildLeaderboardDeviceState([...rows].reverse(), options);

  assert.deepEqual(first, second);
  assert.match(stableStateHash(first), /^[a-f0-9]{64}$/);
  assert.equal(stableStateHash(first), stableStateHash(second));
});

test("stable hash ignores capture time when usage and device identity are unchanged", () => {
  const rows = [row("2026-07-20T01:00:00.000Z", { input_tokens: 2 })];
  const first = buildLeaderboardDeviceState(rows, {
    deviceId: "stable-machine-id",
    capturedAt: "2026-07-20T08:00:00.000Z",
  });
  const second = buildLeaderboardDeviceState(rows, {
    deviceId: "stable-machine-id",
    capturedAt: "2026-07-20T08:15:00.000Z",
  });

  assert.notEqual(first.captured_at, second.captured_at);
  assert.equal(stableStateHash(first), stableStateHash(second));
});

test("enforces the compact state byte limit exactly", () => {
  assert.equal(COMPACT_STATE_MAX_BYTES, 8192);
  assert.equal(assertCompactStateSize("a".repeat(8192)), 8192);
  assert.throws(
    () => assertCompactStateSize("a".repeat(8193)),
    /8193 bytes exceeds 8192-byte limit/,
  );
});
