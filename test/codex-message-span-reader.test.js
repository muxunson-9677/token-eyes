"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectCodexMessageSpans,
} = require("../src/lib/codex-message-span-reader");

function writeRollout(home, name, lines, folder = "sessions") {
  const directory = path.join(home, folder, "2026", "08", "21");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), `${lines.join("\n")}\n`, "utf8");
}

function userMessageTimestampFirst(timestamp, message) {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: { type: "user_message", message },
  });
}

function userMessageTypeFirst(timestamp, message) {
  return JSON.stringify({
    type: "event_msg",
    timestamp,
    payload: { type: "user_message", message },
  });
}

function responseItemUserMessage(timestamp, content) {
  return JSON.stringify({
    timestamp,
    type: "response_item",
    payload: { type: "message", role: "user", content },
  });
}

test("counts response-item user messages without exposing their content", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-message-span-response-item-"));
  const sentinel = "PRIVATE_RESPONSE_ITEM_SENTINEL";
  try {
    writeRollout(home, "rollout-response-item.jsonl", [
      JSON.stringify({ type: "session_meta", timestamp: "2026-08-21T00:00:00.000Z", payload: { id: "session-response-item" } }),
      responseItemUserMessage("2026-08-21T06:00:00.000Z", [{ type: "input_text", text: sentinel.repeat(300) }]),
      responseItemUserMessage("2026-08-21T22:00:00.000Z", [{ type: "input_text", text: sentinel.repeat(300) }]),
      JSON.stringify({ timestamp: "2026-08-21T23:00:00.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: sentinel } }),
    ]);

    const result = await collectCodexMessageSpans({
      homes: [home],
      from: "2026-08-21",
      to: "2026-08-21",
      timeZoneContext: { timeZone: "UTC", offsetMinutes: 0 },
    });

    assert.deepEqual(result, [{
      sessionId: "session-response-item",
      firstMessageAt: "2026-08-21T06:00:00.000Z",
      lastMessageAt: "2026-08-21T22:00:00.000Z",
      messageCount: 2,
      activityDay: "2026-08-21",
    }]);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel, "u"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("collects the first and last user-message timestamps for one local activity day without exposing bodies", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-message-span-"));
  const sentinel = "PRIVATE_BODY_SENTINEL";
  const captured = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  try {
    console.log = (...args) => captured.push(args.join(" "));
    console.warn = (...args) => captured.push(args.join(" "));
    console.error = (...args) => captured.push(args.join(" "));
    writeRollout(home, "rollout-safe.jsonl", [
      JSON.stringify({
        timestamp: "2026-08-20T15:00:00.000Z",
        type: "session_meta",
        payload: { id: "session-alpha", cwd: `C:/private/${sentinel}`, thread_source: "user" },
      }),
      userMessageTimestampFirst("2026-08-20T15:59:59.000Z", sentinel.repeat(400)),
      userMessageTimestampFirst("2026-08-20T22:00:00.000Z", sentinel.repeat(400)),
      JSON.stringify({
        timestamp: "2026-08-21T06:00:00.000Z",
        type: "event_msg",
        payload: { type: "token_count", info: { total_tokens: 12, note: sentinel } },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "user_message", message: "synthetic payload-before-timestamp fixture" },
        timestamp: "2026-08-21T12:00:00.000Z",
      }),
      userMessageTypeFirst("2026-08-21T14:00:00.000Z", sentinel.repeat(400)),
      userMessageTimestampFirst("2026-08-21T16:00:00.000Z", sentinel.repeat(400)),
    ]);

    const result = await collectCodexMessageSpans({
      homes: [home],
      from: "2026-08-21",
      to: "2026-08-21",
      timeZoneContext: { timeZone: "Asia/Shanghai", offsetMinutes: 480 },
    });

    assert.deepEqual(result, [{
      sessionId: "session-alpha",
      firstMessageAt: "2026-08-20T22:00:00.000Z",
      lastMessageAt: "2026-08-21T14:00:00.000Z",
      messageCount: 3,
      activityDay: "2026-08-21",
    }]);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel, "u"));
    assert.doesNotMatch(captured.join("\n"), new RegExp(sentinel, "u"));
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("returns one span per session and activity day across an inclusive range", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-message-span-range-"));
  try {
    writeRollout(home, "rollout-range.jsonl", [
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-08-19T20:00:00.000Z",
        payload: { id: "session-beta", thread_source: "user" },
      }),
      userMessageTypeFirst("2026-08-19T22:00:00.000Z", "synthetic one"),
      userMessageTimestampFirst("2026-08-20T02:00:00.000Z", "synthetic two"),
      userMessageTimestampFirst("2026-08-20T23:00:00.000Z", "synthetic three"),
    ], "archived_sessions");

    const result = await collectCodexMessageSpans({
      homes: [home],
      from: "2026-08-20",
      to: "2026-08-21",
      timeZoneContext: { offsetMinutes: 480 },
    });

    assert.deepEqual(result, [
      {
        sessionId: "session-beta",
        firstMessageAt: "2026-08-19T22:00:00.000Z",
        lastMessageAt: "2026-08-20T02:00:00.000Z",
        messageCount: 2,
        activityDay: "2026-08-20",
      },
      {
        sessionId: "session-beta",
        firstMessageAt: "2026-08-20T23:00:00.000Z",
        lastMessageAt: "2026-08-20T23:00:00.000Z",
        messageCount: 1,
        activityDay: "2026-08-21",
      },
    ]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("filters to lifecycle-approved session ids before scanning unrelated message bodies", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-message-span-session-filter-"));
  try {
    writeRollout(home, "rollout-approved.jsonl", [
      JSON.stringify({ type: "session_meta", timestamp: "2026-08-21T00:00:00.000Z", payload: { id: "session-approved" } }),
      userMessageTypeFirst("2026-08-21T06:00:00.000Z", "approved synthetic body"),
      userMessageTypeFirst("2026-08-21T22:00:00.000Z", "approved synthetic body"),
    ]);
    writeRollout(home, "rollout-unrelated.jsonl", [
      JSON.stringify({ type: "session_meta", timestamp: "2026-08-21T00:00:00.000Z", payload: { id: "session-unrelated" } }),
      userMessageTypeFirst("2026-08-21T07:00:00.000Z", "unrelated synthetic body".repeat(2_000)),
    ]);

    const result = await collectCodexMessageSpans({
      homes: [home],
      from: "2026-08-21",
      to: "2026-08-21",
      timeZoneContext: { timeZone: "UTC", offsetMinutes: 0 },
      sessionIds: ["session-approved"],
    });

    assert.deepEqual(result, [{
      sessionId: "session-approved",
      firstMessageAt: "2026-08-21T06:00:00.000Z",
      lastMessageAt: "2026-08-21T22:00:00.000Z",
      messageCount: 2,
      activityDay: "2026-08-21",
    }]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("fails closed for malformed or over-limit metadata and ignores body lookalikes", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-message-span-closed-"));
  try {
    const fakeEnvelope = "\\\"timestamp\\\":\\\"2026-08-21T09:00:00.000Z\\\",\\\"type\\\":\\\"user_message\\\"";
    const metadataPastLimit = JSON.stringify({
      padding: "x".repeat(4_200),
      timestamp: "2026-08-21T08:00:00.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "must be skipped" },
    });
    writeRollout(home, "rollout-closed.jsonl", [
      JSON.stringify({
        timestamp: "2026-08-21T00:00:00.000Z",
        type: "session_meta",
        payload: { id: "session-closed", thread_source: "user" },
      }),
      metadataPastLimit,
      "{\"timestamp\":\"2026-08-21T08:30:00.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":",
      "{\"timestamp\":\"2026-08-21T08:40:00.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\" \"message\":\"balanced but invalid\"}}",
      JSON.stringify({
        timestamp: "2026-08-21T08:45:00.000Z",
        type: "event_msg",
        payload: { type: "notice", message: fakeEnvelope },
      }),
      userMessageTimestampFirst("not-a-timestamp", "must be skipped"),
      userMessageTimestampFirst("2026-08-21", "date-only values are not rollout timestamps"),
      userMessageTypeFirst("2026-08-21T10:00:00.000Z", "the only valid message"),
    ]);
    writeRollout(home, "rollout-id-past-limit.jsonl", [
      JSON.stringify({
        padding: "x".repeat(4_200),
        type: "session_meta",
        payload: { id: "session-hidden", thread_source: "user" },
      }),
      userMessageTimestampFirst("2026-08-21T11:00:00.000Z", "must have no session"),
    ]);

    const result = await collectCodexMessageSpans({
      homes: [home],
      from: "2026-08-21",
      to: "2026-08-21",
      timeZoneContext: { timeZone: "UTC", offsetMinutes: 0 },
    });

    assert.deepEqual(result, [{
      sessionId: "session-closed",
      firstMessageAt: "2026-08-21T10:00:00.000Z",
      lastMessageAt: "2026-08-21T10:00:00.000Z",
      messageCount: 1,
      activityDay: "2026-08-21",
    }]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("keeps rollout parsing prefix-bounded and avoids full-line JSON or readline", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "codex-message-span-reader.js"),
    "utf8",
  );
  assert.match(source, /MAX_LINE_PREFIX_BYTES\s*=\s*4096/u);
  assert.match(source, /MAX_ROLLOUT_FILES\s*=\s*400/u);
  assert.doesNotMatch(source, /node:readline|\breadline\b/u);
  assert.doesNotMatch(source, /JSON\.parse/u);
});
