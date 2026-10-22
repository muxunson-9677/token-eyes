"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

async function callResponse(handler, endpoint) {
  const url = new URL(`http://127.0.0.1${endpoint}`);
  const chunks = [];
  let statusCode = 200;
  const handled = await handler(
    { method: "GET", headers: { host: "127.0.0.1" } },
    { writeHead(status) { statusCode = status; }, end(body) { if (body) chunks.push(body); } },
    url,
  );
  assert.equal(handled, true);
  return { statusCode, body: JSON.parse(chunks.join("")) };
}

async function call(handler, endpoint) {
  return (await callResponse(handler, endpoint)).body;
}

test("realtime keeps completed child rollout usage across state changes and filters each selected range", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-completed-child-"));
  const reads = new Map();
  const createReadStream = fs.promises.open;
  t.mock.method(fs.promises, "open", function (file, ...args) {
    if (String(file).startsWith(root)) reads.set(String(file), (reads.get(String(file)) || 0) + 1);
    return createReadStream.call(this, file, ...args);
  });
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, JSON.stringify({ source: "codex", model: "gpt-5", hour_start: "2026-09-21T08:00:00Z", input_tokens: 500, total_tokens: 500 }));
    fs.writeFileSync(path.join(root, "config.json"), "{}");
    const sessions = Array.from({ length: 23 }, (_, i) => {
      const session = { sessionId: `session-${i}`, agent: "codex", status: i ? "completed" : "running", updatedAt: "2026-09-21T08:05:00Z", ...(i ? { parentSessionId: "session-0" } : {}) };
      const file = path.join(root, `rollout-2026-08-31T08-00-00-${i}.jsonl`);
      Object.defineProperty(session, Symbol.for("token-eyes.codex-rollout-path"), { value: file });
      fs.writeFileSync(file, [
        { type: "session_meta", payload: { id: session.sessionId, model: "gpt-5" } },
        ...[["2026-08-31", 1000], ["2026-09-20", 100], ["2026-09-21", 10]].map(([day, tokens]) => ({ timestamp: `${day}T08:04:00Z`, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: tokens, total_tokens: tokens } } } })),
      ].map(JSON.stringify).join("\n"));
      return session;
    });
    const unrelated = { sessionId: "unrelated", agent: "codex", status: "completed", updatedAt: "2026-09-21T07:00:00Z" };
    const unrelatedFile = path.join(root, "unrelated.jsonl");
    Object.defineProperty(unrelated, Symbol.for("token-eyes.codex-rollout-path"), { value: unrelatedFile });
    fs.writeFileSync(unrelatedFile, "");
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: root,
      now: () => new Date("2026-09-21T10:00:00Z"), codexLifecycleProvider: async () => [...sessions, unrelated],
      dataDirectoryPathsResolver: () => ({ codexHome: root, codexHomes: [root] }),
      tokenOnlyDirectoryStatesProvider: () => ({}), workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });
    for (const status of ["running", "completed"]) {
      sessions[1].status = status;
      const data = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC");
      const children = data.session_tree.find((session) => session.children.length)?.children;
      assert.equal(children.length, 22);
      for (const child of children) {
        assert.equal(child.total_tokens.value, 10, "every displayed child retains today's exact usage");
        assert.equal(child.last_activity_at, "2026-09-21T08:05:00Z");
      }
      assert.equal(data.summary.realtime_tokens.value, 500, "anonymous queue bucket covers detailed child usage");
    }
    for (const [month, expected] of [["2026-09", 110], ["2026-08", 1000]]) {
      const data = await call(handler, `/functions/tokentracker-realtime-sessions?range=month&month=${month}&tz=UTC`);
      assert.equal(data.sessions.filter((session) => session.total_tokens.value !== null).length, 23);
      for (const session of data.sessions.filter((session) => session.total_tokens.value !== null)) assert.equal(session.total_tokens.value, expected);
      assert.equal(data.summary.realtime_tokens.value, month === "2026-09" ? 2800 : 23000);
    }
    const parentFile = sessions[0][Symbol.for("token-eyes.codex-rollout-path")];
    for (let update = 1; update <= 129; update += 1) {
      fs.appendFileSync(parentFile, `\n${JSON.stringify({ timestamp: new Date(Date.parse("2026-09-21T09:04:00Z") + update * 1000).toISOString(), type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 7, total_tokens: 7 } } } })}`);
      const refreshed = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC");
      assert.equal(refreshed.sessions.find((session) => session.state === "running").total_tokens.value, 10 + update * 7, "changed file signature invalidates live usage");
    }
    for (const session of sessions.slice(2)) {
      assert.equal(reads.get(session[Symbol.for("token-eyes.codex-rollout-path")]), 1, "completed rollout is parsed once across ranges and parent updates");
    }
    assert.equal(reads.has(unrelatedFile), false, "unrelated lifecycle history must not expand the usage scan");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("realtime with no lifecycle file paths reads queue only without scanning Codex history", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-no-lifecycle-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, JSON.stringify({ source: "hermes", model: "test", hour_start: "2026-09-21T08:00:00Z", total_tokens: 3 }));
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ dataDirectories: { codex: root } }));
    let scans = 0;
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: root,
      now: () => new Date("2026-09-21T10:00:00Z"), codexLifecycleProvider: async () => [],
      dataDirectoryPathsResolver: () => ({ codexHome: root, codexHomes: [root] }),
      codexRolloutRowsProvider: async () => { scans += 1; return []; },
      tokenOnlyDirectoryStatesProvider: () => ({}), workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });
    const data = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC");
    assert.equal(scans, 0);
    assert.equal(data.summary.realtime_tokens.value, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("realtime uses event-local days when Kathmandu midnight splits one UTC half-hour bucket", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-kathmandu-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, JSON.stringify({ source: "codex", model: "gpt-5", hour_start: "2026-08-31T18:00:00Z", input_tokens: 100, total_tokens: 100 }));
    const file = path.join(root, "rollout-2026-08-31T18-00-00-session.jsonl");
    fs.writeFileSync(file, [
      { type: "session_meta", payload: { id: "boundary", model: "gpt-5" } },
      ...[["18:10", 100], ["18:20", 10]].map(([time, tokens]) => ({ timestamp: `2026-08-31T${time}:00Z`, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: tokens, total_tokens: tokens } } } })),
    ].map(JSON.stringify).join("\n"));
    const session = { sessionId: "boundary", agent: "codex", status: "running", updatedAt: "2026-08-31T18:20:00Z" };
    Object.defineProperty(session, Symbol.for("token-eyes.codex-rollout-path"), { value: file });
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: root,
      now: () => new Date("2026-08-31T19:00:00Z"), codexLifecycleProvider: async () => [session],
      dataDirectoryPathsResolver: () => ({ codexHome: root, codexHomes: [root] }),
      tokenOnlyDirectoryStatesProvider: () => ({}), workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });
    for (const [query, expected] of [["range=today", 10], ["range=month&month=2026-08", 100], ["range=month&month=2026-09", 10]]) {
      const data = await call(handler, `/functions/tokentracker-realtime-sessions?${query}&tz=Asia%2FKathmandu`);
      assert.equal(data.summary.realtime_tokens.value, expected);
      assert.equal(data.sessions[0].total_tokens.value, expected);
      assert.equal(data.usage_records.filter((row) => row.range_included !== false).reduce((sum, row) => sum + row.total_tokens.value, 0), expected);
      assert.equal(data.agent_range_summary[0].total_tokens.value, expected);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("realtime retains full-range totals beyond 100 buckets and requests subagent metadata", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-full-range-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, Array.from({ length: 101 }, (_, i) => JSON.stringify({ source: "hermes", model: `model-${i}`, hour_start: "2026-09-21T08:00:00Z", input_tokens: 1, total_tokens: 1 })).join("\n"));
    fs.writeFileSync(path.join(root, "config.json"), "{}");
    let includesChildren;
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: root,
      now: () => new Date("2026-09-21T10:00:00Z"),
      codexLifecycleProvider: async (options) => { includesChildren = options.includeSubagents; return [
        { sessionId: "parent", agent: "codex", status: "running" },
        { sessionId: "child", parentSessionId: "parent", agent: "codex", status: "running" },
      ]; },
      codexRolloutRowsProvider: async () => [], tokenOnlyDirectoryStatesProvider: () => ({}),
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });
    const data = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC");
    assert.equal(includesChildren, true);
    assert.equal(data.agent_range_summary.find((item) => item.source === "hermes").total_tokens.value, 101);
    assert.equal(data.summary.realtime_tokens.value, 101);
    assert.equal(data.session_tree.find((item) => item.children.length).children.length, 1);
    assert.equal(data.usage_records.length, 101);
    assert.equal(data.requests.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("bounded realtime rollouts replace only their sessions and do not add detail over authoritative model buckets", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-merge-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    const row = (session, model, hour, tokens) => ({ source: "codex", ...(session ? { session_id: session } : {}), model, hour_start: `2026-09-21T${hour}:00:00Z`, input_tokens: tokens, total_tokens: tokens });
    fs.writeFileSync(queuePath, [row("active", "gpt-5", "08", 10), row("other", "gpt-5", "08", 20), row(null, "gpt-5", "09", 100)].map(JSON.stringify).join("\n"));
    fs.writeFileSync(path.join(root, "config.json"), "{}");
    const active = { sessionId: "active", agent: "codex", status: "running", updatedAt: "2026-09-21T10:00:00Z" };
    Object.defineProperty(active, Symbol.for("token-eyes.codex-rollout-path"), { value: path.join(root, "selected-rollout.jsonl") });
    let calls = 0;
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: root,
      now: () => new Date("2026-09-21T12:00:00Z"), codexLifecycleProvider: async () => [active],
      codexRolloutRowsProvider: async (options) => {
        calls += 1;
        assert.equal(options.rolloutFiles.length, 1, "must retain the bounded file selection");
        return [row("active", "gpt-5", "08", 30), row("active", "gpt-5", "09", 40), row("active", "gpt-5", "10", 50), row("active", "gpt-5.6-sol", "09", 60)];
      }, tokenOnlyDirectoryStatesProvider: () => ({}),
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });
    const data = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC");
    assert.equal(calls, 1);
    assert.equal(data.summary.realtime_tokens.value, 260, "30 replacement + 20 other + 100 authoritative + 50 next hour + 60 other model");
    assert.equal(data.sessions.find((item) => item.state === "running").total_tokens.value, 180);
    assert.equal(data.sessions.find((item) => item.state !== "running").total_tokens.value, 20);
    assert.equal(data.agent_range_summary[0].total_tokens.value, 260);
    assert.equal(data.usage_records.filter((item) => item.range_included === false).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("anonymous realtime buckets cover unknown billing details without dropping known separate billing modes", async () => {
  for (const [aggregateMode, detailMode, expected] of [
    ["unknown", undefined, 100], ["token_plan", undefined, 100], ["api_key", undefined, 100],
    [undefined, "unknown", 100], ["token_plan", "api_key", 140], ["api_key", "token_plan", 140],
    ["unknown", "token_plan", 100], ["token_plan", "token_plan", 100],
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-billing-"));
    try {
      const queuePath = path.join(root, "queue.jsonl");
      const base = { source: "codex", model: "gpt-5", hour_start: "2026-09-21T08:00:00Z" };
      fs.writeFileSync(queuePath, JSON.stringify({ ...base, billing_mode: aggregateMode, input_tokens: 100, total_tokens: 100 }));
      fs.writeFileSync(path.join(root, "config.json"), "{}");
      const active = { sessionId: "active", agent: "codex", status: "running" };
      Object.defineProperty(active, Symbol.for("token-eyes.codex-rollout-path"), { value: path.join(root, "selected.jsonl") });
      const handler = createLocalApiHandler({ queuePath, trackerDataDir: root,
        now: () => new Date("2026-09-21T12:00:00Z"), codexLifecycleProvider: async () => [active],
        codexRolloutRowsProvider: async () => [{ ...base, session_id: "active", billing_mode: detailMode, input_tokens: 40, total_tokens: 40 }],
        tokenOnlyDirectoryStatesProvider: () => ({}), workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
      });
      const data = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC");
      assert.equal(data.summary.realtime_tokens.value, expected, `aggregate ${aggregateMode}, detail ${detailMode}`);
      assert.equal(data.sessions[0].total_tokens.value, 40, "coverage must preserve the separate session detail");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test("realtime range selection changes anonymous Agent totals and preserves real request event kinds", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-range-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, [
      { source: "hermes", model: "unknown", hour_start: "2026-09-20T08:00:00Z", input_tokens: 10, total_tokens: 10 },
      { source: "hermes", model: "unknown", hour_start: "2026-09-21T08:00:00Z", timestamp: "2026-09-21T08:01:00Z", input_tokens: 20, total_tokens: 20, record_kind: "request_event", id: "request-a" },
      { source: "hermes", model: "unknown", hour_start: "2026-09-21T08:00:00Z", timestamp: "2026-09-21T08:02:00Z", input_tokens: 30, total_tokens: 30, record_kind: "request_event", id: "request-b" },
    ].map(JSON.stringify).join("\n"));
    fs.writeFileSync(path.join(root, "config.json"), "{}");
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: root,
      now: () => new Date("2026-09-21T12:00:00Z"), codexLifecycleProvider: async () => [],
      codexRolloutRowsProvider: async () => [], tokenOnlyDirectoryStatesProvider: () => ({}),
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });
    const today = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC");
    const week = await call(handler, "/functions/tokentracker-realtime-sessions?range=7d&tz=UTC");
    assert.equal(today.agent_range_summary[0].total_tokens.value, 50);
    assert.equal(week.agent_range_summary[0].total_tokens.value, 60);
    assert.equal(today.agent_range_summary[0].request_count.value, 2);
    assert.equal(week.agent_range_summary[0].request_count.value, null);
    assert.equal(today.requests.length, 2);
    assert.equal(week.usage_records.length, 3);
    assert.equal(week.sessions.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("realtime pricing reads configuration per request, not once per usage row", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-pricing-"));
  const originalRead = fs.readFileSync;
  try {
    const queuePath = path.join(root, "queue.jsonl");
    const configPath = path.join(root, "config.json");
    fs.writeFileSync(configPath, "{}");
    fs.writeFileSync(queuePath, Array.from({ length: 100 }, (_, i) => JSON.stringify({
      source: "hermes", model: `model-${i}`, hour_start: "2026-08-21T08:00:00Z",
      input_tokens: 10, total_tokens: 10,
    })).join("\n"));
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00Z"), codexLifecycleProvider: async () => [],
      tokenOnlyDirectoryStatesProvider: () => ({}),
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });
    let reads = 0;
    fs.readFileSync = function (file, ...args) {
      if (String(file) === configPath) reads += 1;
      return originalRead.call(this, file, ...args);
    };
    await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC");
    assert.ok(reads < 20, `configuration read ${reads} times for 100 rows`);
  } finally {
    fs.readFileSync = originalRead;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("realtime range clamps future months and returns its actual local date window", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-range-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, "");
    fs.writeFileSync(path.join(root, "config.json"), "{}");
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      detectAllAgentEnvironments: () => [],
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=month&month=2027-01&tz=Asia%2FShanghai&tz_offset_minutes=480");
    assert.equal(realtime.requested_month, "2027-01");
    assert.equal(realtime.data_month, "2026-08");
    assert.equal(realtime.range, "month");
    assert.equal(realtime.range_from, "2026-08-01");
    assert.equal(realtime.range_to, "2026-08-21");
    assert.deepEqual(realtime.month_options, ["2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("realtime view retains the Codex session identifier from the live rollout instead of downgrading its focus card to unknown", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-session-id-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    const codexHome = path.join(root, "codex");
    const sessionDir = path.join(codexHome, "sessions", "2026", "08", "21");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "rollout-2026-08-21T08-00-00-session.jsonl"), [
      JSON.stringify({ timestamp: "2026-08-21T08:00:00.000Z", type: "session_meta", payload: { id: "live-session", cwd: "C:/safe-project" } }),
      JSON.stringify({ timestamp: "2026-08-21T05:59:00.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "raw-turn-id" } }),
      JSON.stringify({ timestamp: "2026-08-21T06:00:00.000Z", type: "event_msg", payload: { type: "user_message", message: "private first body" } }),
      JSON.stringify({ timestamp: "2026-08-21T08:05:00.000Z", type: "turn_context", payload: { model: "gpt-5.6-terra" } }),
      JSON.stringify({ timestamp: "2026-08-21T22:00:00.000Z", type: "event_msg", payload: { type: "user_message", message: "private last body with fake timestamp 2028-01-01T00:00:00.000Z" } }),
      JSON.stringify({ timestamp: "2026-08-21T22:01:00.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } } } }),
    ].join("\n"));
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ dataDirectories: { codex: codexHome } }));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T22:30:00.000Z"),
      codexLifecycleProvider: async () => [{ agent: "codex", sessionId: "live-session", taskId: "raw-turn-id", model: "gpt-5.6-terra", status: "running", updatedAt: "2026-08-21T22:20:00.000Z", [Symbol.for("token-eyes.codex-rollout-path")]: path.join(sessionDir, "rollout-2026-08-21T08-00-00-session.jsonl") }],
    });

    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC&tz_offset_minutes=0");
    const running = realtime.sessions.find((session) => session.state === "running");
    assert.equal(running.source, "codex");
    assert.equal(running.total_tokens.value, 50);
    assert.equal(running.request_count.value, null);
    assert.equal(running.duration_minutes.value, 16 * 60);
    assert.equal(running.duration_minutes.evidence_state, "exact");
    assert.match(running.task_ref, /^task-[a-f0-9]{12}$/u);
    const serialized = JSON.stringify(realtime);
    assert.equal(serialized.includes("raw-turn-id"), false);
    assert.equal(serialized.includes("private first body"), false);
    assert.equal(serialized.includes("private last body"), false);
    assert.equal(serialized.includes("2028-01-01"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("realtime view includes a late-UTC Codex rollout in the user's local day", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-local-day-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    const codexHome = path.join(root, "codex");
    const sessionDir = path.join(codexHome, "sessions", "2026", "08", "24");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "rollout-2026-08-24T17-00-00-local-day.jsonl"), [
      JSON.stringify({ timestamp: "2026-08-24T17:00:00.000Z", type: "session_meta", payload: { id: "local-day-session" } }),
      JSON.stringify({ timestamp: "2026-08-24T17:05:00.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } } } }),
    ].join("\n"));
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ dataDirectories: { codex: codexHome } }));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-25T01:30:00.000Z"),
      codexLifecycleProvider: async () => [{ agent: "codex", sessionId: "local-day-session", status: "running", updatedAt: "2026-08-25T01:20:00.000Z", [Symbol.for("token-eyes.codex-rollout-path")]: path.join(sessionDir, "rollout-2026-08-24T17-00-00-local-day.jsonl") }],
    });

    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=Asia%2FShanghai&tz_offset_minutes=480");
    const running = realtime.sessions.find((session) => session.state === "running");
    assert.equal(running.total_tokens.value, 50);
    assert.equal(running.request_count.value, null);
    assert.equal(realtime.summary.realtime_tokens.value, 50);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("realtime non-month ranges ignore a stale month and honor the requested timezone across a month boundary", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-boundary-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, "");
    fs.writeFileSync(path.join(root, "config.json"), "{}");
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-07-31T16:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      detectAllAgentEnvironments: () => [],
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=30d&month=2025-12&tz=Asia%2FShanghai&tz_offset_minutes=480");
    assert.equal(realtime.requested_month, null);
    assert.equal(realtime.data_month, "2026-08");
    assert.equal(realtime.range, "30d");
    assert.equal(realtime.range_from, "2026-07-03");
    assert.equal(realtime.range_to, "2026-08-01");
    assert.equal(realtime.month_options[0], "2026-08");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a historical realtime month excludes current lifecycle sessions while preserving their live Agent badge", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-historical-lifecycle-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, `${JSON.stringify({
      source: "codex",
      model: "gpt-5",
      hour_start: "2026-07-18T08:00:00.000Z",
      input_tokens: 40,
      output_tokens: 10,
      total_tokens: 50,
    })}\n`);
    fs.writeFileSync(path.join(root, "config.json"), "{}");
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [{
        agent: "codex",
        sessionId: "current-live-session",
        status: "running",
        updatedAt: "2026-08-21T08:25:00.000Z",
      }],
      detectAllAgentEnvironments: () => [],
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=month&month=2026-07&tz=UTC&tz_offset_minutes=0");
    assert.equal(realtime.sessions.length, 0, "the current live task is outside the selected historical month");
    assert.equal(realtime.agent_history.find((agent) => agent.source === "codex")?.runtime_state, "running");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("realtime endpoint returns a privacy-safe, explicit evidence payload", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-value-realtime-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    const traeHome = path.join(root, "trae");
    const codexHome = path.join(root, "codex");
    fs.mkdirSync(path.join(traeHome, "ModularData", "ai-agent"), { recursive: true });
    fs.mkdirSync(path.join(codexHome, "sessions", "2026", "08", "21"), { recursive: true });
    fs.writeFileSync(path.join(traeHome, "ModularData", "ai-agent", "token_usage.jsonl"), "{}\n");
    fs.writeFileSync(path.join(codexHome, "sessions", "2026", "08", "21", "rollout-2026-08-21T08-00-00-history-only.jsonl"), `${JSON.stringify({
      timestamp: "2026-08-21T08:00:00.000Z",
      type: "session_meta",
      payload: { id: "local-session", cwd: "C:/safe-project" },
    })}\n${JSON.stringify({
      timestamp: "2026-08-21T08:15:00.000Z",
      type: "event_msg",
      payload: { type: "token_count", info: { total_token_usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } } },
    })}\n`);
    fs.writeFileSync(queuePath, `${JSON.stringify({
      source: "claude", model: "claude-sonnet", hour_start: "2026-08-21T08:00:00.000Z",
      input_tokens: 80, output_tokens: 20, total_tokens: 100, conversation_count: 1,
    })}\n`);
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({
      dataDirectories: { trae: traeHome, codex: codexHome },
      tokenPlans: [{
        id: "codex-plan", provider_id: "codex", source: "codex", plan_id: "codex_pro_20x", plan_label: "Pro 20x",
        detection_method: "official_account", sync_status: "success",
        detection_config: { official_account: { account_binding_id: "account/codex/local" } },
      }],
      spendRecords: [{ source: "subscription", amount_usd: 8, start_date: "2026-08-01", end_date: "2026-08-31" }],
    }));
    let rolloutFallbackCalls = 0;
    const lifecycleCalls = [];
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async (options) => {
        lifecycleCalls.push(options);
        return [{
          agent: "codex", sessionId: "local-session", model: "unpriced-lifecycle-model", status: "running", updatedAt: "2026-08-21T08:25:00.000Z",
          projectLabel: "Secret Project",
          taskLabel: "完善实时会话",
          sessionLabel: "must not be copied into a prompt or body",
          [Symbol.for("token-eyes.codex-rollout-path")]: path.join(codexHome, "sessions", "2026", "08", "21", "rollout-2026-08-21T08-00-00-history-only.jsonl"),
        }];
      },
      codexRolloutRowsProvider: async () => {
        rolloutFallbackCalls += 1;
        return [{
          source: "codex", hour_start: "2026-08-21T08:00:00.000Z", model: "fallback-only",
          total_tokens: 50, input_tokens: 40, output_tokens: 10,
        }];
      },
      detectAllAgentEnvironments: () => [{ agent: "codebuddy", status: "detected" }],
      workbuddyQuotaProvider: async () => ({
        signed_in: true,
        error: null,
        groups: [{ id: "activity", used: 120, total: 300, remain: 180 }],
      }),
    });

    rolloutFallbackCalls = 0;
    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=today");
    assert.equal(typeof realtime.revision, "string");
    assert.equal(realtime.sessions.some((item) => item.state === "running"), true);
    const runningSession = realtime.sessions.find((item) => item.state === "running");
    assert.equal(runningSession?.task_label, "完善实时会话");
    assert.equal(runningSession?.project_label, null);
    assert.equal(lifecycleCalls[0].includeProjectLabels, undefined);
    assert.equal(realtime.activity_points.length, 2);
    assert.deepEqual(realtime.pricing_coverage, {
      covered_models: 0,
      total_models: 3,
      percent: 0,
      uncovered_models: ["claude-sonnet", "fallback-only", "unpriced-lifecycle-model"],
    });
    assert.equal(realtime.activity_points.find((point) => point.source === "codex").api_equivalent_usd, null);
    assert.equal(Array.isArray(realtime.requests), true);
    assert.equal(realtime.requests.length, 0);
    assert.equal(realtime.sessions.some((item) => item.source === "claude"), false);
    assert.deepEqual(realtime.agent_history.map((item) => [item.source, item.agent_label, item.history_state]), [
      ["claude", "Claude Code", "historical_usage"],
      ["trae", "Trae", "installed_no_history"],
      ["codebuddy", "CodeBuddy", "installed_no_history"],
    ]);
    assert.equal(realtime.agent_history.some((item) => item.source === "codex"), false);
    assert.equal(rolloutFallbackCalls, 1);
    assert.equal(realtime.agent_history[1].total_tokens.value, null);
    assert.deepEqual(realtime.native_resources, [
      { provider: "workbuddy", label: "remaining", value: 180, unit: "Credits", evidence_state: "exact" },
      { provider: "workbuddy", label: "today_consumed", value: 0, unit: "Credits", evidence_state: "observed" },
    ]);
    const publicPayload = JSON.stringify(realtime);
    for (const forbiddenField of ["\"prompt\":", "\"authorization\":", "\"cwd\":", "\"accessToken\":", "\"cookie\":", "\"api_key\":"]) {
      assert.equal(publicPayload.includes(forbiddenField), false);
    }
    assert.equal(publicPayload.includes("safe-project"), false);
    assert.equal(publicPayload.includes("Secret Project"), false);
    assert.equal(publicPayload.includes("must not be copied into a prompt or body"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("slow quota does not block realtime and its eventual result is reused", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-slow-quota-"));
  let release;
  let reads = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  try {
    const handler = createLocalApiHandler({
      queuePath: path.join(root, "queue.jsonl"),
      trackerDataDir: root,
      codexLifecycleProvider: async () => [],
      workbuddyQuotaProvider: () => { reads += 1; return pending; },
    });
    const timeout = setTimeout(() => release({ signed_in: false, groups: [] }), 2000);
    const started = Date.now();
    const first = await call(handler, "/functions/tokentracker-realtime-sessions?range=today");
    clearTimeout(timeout);
    assert.ok(Date.now() - started < 1500, "local sessions must not await remote quota");
    assert.equal(first.native_resources[0].evidence_state, "unavailable");
    release({ signed_in: true, groups: [{ id: "activity", used: 120, total: 300, remain: 180 }] });
    await new Promise((resolve) => setImmediate(resolve));
    const second = await call(handler, "/functions/tokentracker-realtime-sessions?range=today");
    assert.equal(second.native_resources[0].value, 180);
    assert.equal(reads, 1);
  } finally {
    release({ signed_in: false, groups: [] });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("WorkBuddy quota read failure keeps realtime available with an explicit unreadable Credits state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-workbuddy-unreadable-"));
  try {
    const handler = createLocalApiHandler({
      queuePath: path.join(root, "queue.jsonl"),
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      workbuddyQuotaProvider: async () => { throw new Error("injected quota reader failure"); },
    });

    const realtime = await callResponse(handler, "/functions/tokentracker-realtime-sessions?range=today");
    const unreadableCredits = [
      { provider: "workbuddy", label: "remaining", value: null, unit: "Credits", evidence_state: "unavailable" },
      { provider: "workbuddy", label: "today_consumed", value: null, unit: "Credits", evidence_state: "unavailable" },
    ];

    assert.equal(realtime.statusCode, 200);
    assert.deepEqual(realtime.body.native_resources, unreadableCredits);
    assert.equal(JSON.stringify(realtime.body).includes("injected quota reader failure"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("realtime view reuses an in-range tracked Codex aggregate instead of rescanning rollout history", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-queue-fast-path-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, `${JSON.stringify({
      source: "codex", model: "gpt-5.6-sol", hour_start: "2026-08-21T08:00:00.000Z",
      input_tokens: 80, output_tokens: 20, total_tokens: 100, conversation_count: 1,
    })}\n`);
    let rolloutFallbackCalls = 0;
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      codexRolloutRowsProvider: async () => {
        rolloutFallbackCalls += 1;
        return [];
      },
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC&tz_offset_minutes=0");
    assert.equal(realtime.agent_history.find((item) => item.source === "codex")?.total_tokens.value, 100);
    assert.equal(rolloutFallbackCalls, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("realtime view reads the active default lifecycle rollout directly for current-session tokens", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-realtime-active-rollout-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    const codexHome = path.join(root, "codex");
    const sessionDir = path.join(codexHome, "sessions", "2026", "08", "21");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(queuePath, "");
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ dataDirectories: { codex: codexHome } }));
    fs.writeFileSync(path.join(sessionDir, "rollout-2026-08-18T08-00-00-active.jsonl"), [
      JSON.stringify({ timestamp: "2026-08-21T08:00:00.000Z", type: "session_meta", payload: { id: "active-session", thread_source: "user" } }),
      JSON.stringify({ timestamp: "2026-08-21T08:01:00.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "private-turn" } }),
      JSON.stringify({ timestamp: "2026-08-21T08:02:00.000Z", type: "turn_context", payload: { model: "gpt-5.6-sol" } }),
      JSON.stringify({ timestamp: "2026-08-21T08:03:00.000Z", type: "event_msg", payload: { type: "user_message", message: "private body" } }),
      JSON.stringify({ timestamp: "2026-08-21T08:04:00.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } } } }),
    ].join("\n"));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      dataDirectoryPathsResolver: () => ({ codexHome, codexHomes: [codexHome] }),
      workbuddyQuotaProvider: async () => ({ signed_in: false, groups: [] }),
    });

    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=today&tz=UTC&tz_offset_minutes=0");
    const running = realtime.sessions.find((session) => session.state === "running");
    assert.equal(running.total_tokens.value, 50);
    assert.equal(running.last_activity_at, "2026-08-21T08:04:00.000Z", "safe token events advance activity beyond task_started");
    assert.equal(running.activity_points[0].observed_at, "2026-08-21T08:00:00.000Z", "activity detail must not move the usage bucket");
    assert.equal(realtime.summary.realtime_tokens.value, 50);
    assert.equal(JSON.stringify(realtime).includes("private body"), false);
    assert.equal(JSON.stringify(realtime).includes(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("WorkBuddy connected quota with a missing used value stays unknown instead of becoming exact zero Credits", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-workbuddy-missing-used-"));
  try {
    const handler = createLocalApiHandler({
      queuePath: path.join(root, "queue.jsonl"),
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [],
      workbuddyQuotaProvider: async () => ({
        signed_in: true,
        error: null,
        groups: [{ id: "activity", used: null, total: 300, remain: null }],
      }),
    });

    const realtime = await callResponse(handler, "/functions/tokentracker-realtime-sessions?range=today");
    const connectedUnknownCredits = [
      { provider: "workbuddy", label: "remaining", value: null, unit: "Credits", evidence_state: "connected_no_exact_data" },
      { provider: "workbuddy", label: "today_consumed", value: null, unit: "Credits", evidence_state: "connected_no_exact_data" },
    ];

    assert.equal(realtime.statusCode, 200);
    assert.deepEqual(realtime.body.native_resources, connectedUnknownCredits);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
