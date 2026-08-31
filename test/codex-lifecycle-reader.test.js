"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectCodexLifecycleSessions,
} = require("../src/lib/codex-lifecycle-reader");

test("reads the safe Codex thread name without returning prompts, bodies, or paths", async () => {
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
          thread_source: "user",
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-29T08:01:00.000Z",
        type: "turn_context",
        payload: {
          model: "gpt-5.6-sol",
          user_prompt: "private prompt that must never be returned",
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
        payload: { type: "task_started", turn_id: "turn-safe" },
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
      sessionId: "019-safe-session",
      taskLabel: "执行代码修复",
      taskId: "turn-safe",
      model: "gpt-5.6-sol",
      status: "running",
      updatedAt: "2026-07-29T08:02:00.000Z",
    });
    assert.match(result[0].projectId, /^project-[a-f0-9]{12}$/u);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /Users|Secret Project|private prompt|private first message|user_prompt|message|cwd/iu);
    assert.equal(result[0].taskId, "turn-safe");

    const widgetResult = await collectCodexLifecycleSessions({
      homes: [root],
      nowMs: Date.parse("2026-07-29T09:00:00.000Z"),
      includeProjectLabels: true,
    });
    assert.equal(widgetResult[0].projectLabel, "Secret Project");
    assert.equal(widgetResult[0].taskLabel, "执行代码修复");
    assert.equal(widgetResult[0].model, "gpt-5.6-sol");
    assert.equal(widgetResult[0].taskId, "turn-safe");
    const rolloutPath = Symbol.for("token-eyes.codex-rollout-path");
    assert.equal(widgetResult[0][rolloutPath], path.join(sessions, "rollout-safe.jsonl"));
    assert.equal(Object.getOwnPropertyDescriptor(widgetResult[0], rolloutPath)?.enumerable, false);
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
          payload: { id, cwd: `D:\\Projects\\${id}`, thread_source: "user" },
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

test("excludes generated subagent rollouts from project conversation counts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-lifecycle-"));
  try {
    const sessions = path.join(root, "sessions");
    fs.mkdirSync(sessions, { recursive: true });
    const fixture = (id, threadSource, eventType) => [
      JSON.stringify({
        timestamp: "2026-07-29T08:00:00.000Z",
        type: "session_meta",
        payload: {
          id,
          cwd: "D:\\Projects\\One Conversation",
          thread_source: threadSource,
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-29T08:10:00.000Z",
        type: "event_msg",
        payload: { type: eventType },
      }),
    ].join("\n");
    fs.writeFileSync(path.join(sessions, "rollout-user.jsonl"), fixture(
      "user-conversation",
      "user",
      "task_complete",
    ));
    fs.writeFileSync(path.join(sessions, "rollout-subagent.jsonl"), fixture(
      "generated-child-work",
      "subagent",
      "task_complete",
    ));

    const result = await collectCodexLifecycleSessions({
      homes: [root],
      nowMs: Date.parse("2026-07-29T09:00:00.000Z"),
    });

    assert.deepEqual(result.map((item) => item.sessionId), ["user-conversation"]);
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

test("reads only a bounded asynchronous tail of the Codex session title index", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "codex-lifecycle-reader.js"),
    "utf8",
  );
  assert.match(source, /SESSION_INDEX_READ_BYTES/u);
  assert.match(source, /fs\.promises\.open\(path\.join\(home, "session_index\.jsonl"\), "r"\)/u);
  assert.match(source, /Math\.min\(stat\.size, SESSION_INDEX_READ_BYTES\)/u);
  assert.doesNotMatch(source, /fs\.readFileSync\(path\.join\(home, "session_index\.jsonl"\)/u);
});
