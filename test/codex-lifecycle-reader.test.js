"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectCodexLifecycleSessions,
} = require("../src/lib/codex-lifecycle-reader");

test("reads only Codex lifecycle metadata and returns privacy-safe project sessions", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-lifecycle-"));
  try {
    fs.writeFileSync(path.join(root, "session_index.jsonl"), JSON.stringify({
      id: "019-safe-session",
      thread_name: "执行代码修复",
      first_user_message: "private first message that must never be returned",
    }), "utf8");
    const sessions = path.join(root, "sessions", "2026", "07", "29");
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, "rollout-safe.jsonl"), [
      JSON.stringify({
        timestamp: "2026-07-29T08:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "019-safe-session",
          cwd: "C:\\Users\\alice\\Secret Project",
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-29T08:01:00.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "private prompt that must never be returned",
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-29T08:02:00.000Z",
        type: "event_msg",
        payload: { type: "task_started" },
      }),
    ].join("\n"), "utf8");

    const result = await collectCodexLifecycleSessions({
      homes: [root],
      nowMs: Date.parse("2026-07-29T09:00:00.000Z"),
    });

    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
      agent: "codex",
      projectId: result[0].projectId,
      projectLabel: "Secret Project",
      sessionId: "019-safe-session",
      sessionLabel: "执行代码修复",
      status: "running",
      updatedAt: "2026-07-29T08:02:00.000Z",
    });
    assert.match(result[0].projectId, /^project-[a-f0-9]{12}$/u);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /Users|private prompt|private first message|message|cwd/iu);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("maps completion, interruption, and error evidence without stale-time guesses", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-lifecycle-"));
  try {
    const sessions = path.join(root, "archived_sessions");
    fs.mkdirSync(sessions, { recursive: true });
    const cases = [
      ["complete", "task_complete", "completed"],
      ["abort", "turn_aborted", "interrupted"],
      ["failed", "error", "error"],
    ];
    for (const [id, eventType] of cases) {
      fs.writeFileSync(path.join(sessions, `rollout-${id}.jsonl`), [
        JSON.stringify({
          timestamp: "2026-07-29T08:00:00.000Z",
          type: "session_meta",
          payload: { id, cwd: `D:\\Projects\\${id}` },
        }),
        JSON.stringify({
          timestamp: "2026-07-29T08:10:00.000Z",
          type: "event_msg",
          payload: { type: eventType },
        }),
      ].join("\n"), "utf8");
    }

    const result = await collectCodexLifecycleSessions({
      homes: [root],
      nowMs: Date.parse("2026-07-29T09:00:00.000Z"),
    });
    const byId = new Map(result.map((item) => [item.sessionId, item.status]));
    for (const [id, , status] of cases) assert.equal(byId.get(id), status);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reads lifecycle evidence from bounded file slices instead of streaming whole rollouts", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "codex-lifecycle-reader.js"),
    "utf8",
  );
  assert.match(source, /TAIL_READ_CHUNK_BYTES/u);
  assert.match(source, /readLatestLifecycleEvidence/u);
  assert.doesNotMatch(source, /for await\s*\(const line of lines\)/u);
});
