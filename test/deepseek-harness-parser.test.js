"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const zstd = require("@mongodb-js/zstd");

const {
  listDeepSeekHarnessSessionFiles,
  parseDeepSeekHarnessIncremental,
  resolveDeepSeekHarnessHome,
} = require("../src/lib/rollout");

function fixtureEvents({
  sessionId = "session-dsh-1",
  cwd = "D:\\projects\\token-eyes",
  model = "deepseek-v4-flash",
  usage = { inputTokens: 120, cacheReadTokens: 30, outputTokens: 40, reasoningTokens: 10 },
} = {}) {
  return [
    { type: "session", version: 0, id: sessionId, createdAt: "2026-08-16T10:00:00.000Z", cwd },
    { type: "request/context", seq: 1, time: "2026-08-16T10:01:00.000Z", data: { provider: "deepseek", model, contextWindow: 128000 } },
    { type: "assistant/chunk", seq: 2, time: "2026-08-16T10:01:10.000Z", data: { turn: 1, step: 1, chunk: { type: "usage", usage: { inputTokens: 90, outputTokens: 20 } } } },
    { type: "assistant/message", seq: 3, time: "2026-08-16T10:01:11.000Z", data: { turn: 1, step: 1, message: { role: "assistant", content: [] }, usage } },
  ];
}

async function writeSession(root, name, events, compressed = true) {
  const sessionDir = path.join(root, "sessions", name);
  fs.mkdirSync(sessionDir, { recursive: true });
  const text = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
  const filePath = path.join(sessionDir, compressed ? "session.jsonl.zstd" : "session.jsonl");
  fs.writeFileSync(filePath, compressed ? Buffer.from(await zstd.compress(Buffer.from(text))) : text);
  return filePath;
}

function serializedTotalsKey(totals) {
  return [
    totals.input_tokens,
    totals.cached_input_tokens,
    totals.cache_creation_input_tokens,
    totals.output_tokens,
    totals.reasoning_output_tokens,
    totals.total_tokens,
    totals.billable_total_tokens,
    totals.conversation_count,
  ].join("|");
}

async function seedPreFixHarnessState({ sessionFiles, cursors, queuePath }) {
  await parseDeepSeekHarnessIncremental({ sessionFiles, cursors, queuePath });
  delete cursors.deepseekHarness.normalizationVersion;
  for (const file of Object.values(cursors.deepseekHarness.files)) {
    delete file.normalizationVersion;
    for (const entry of Object.values(file.byModel)) {
      entry.totals.total_tokens -= entry.totals.reasoning_output_tokens;
      entry.totals.billable_total_tokens -= entry.totals.reasoning_output_tokens;
    }
  }
  for (const [key, bucket] of Object.entries(cursors.hourly.buckets)) {
    bucket.totals.total_tokens -= bucket.totals.reasoning_output_tokens;
    bucket.totals.billable_total_tokens -= bucket.totals.reasoning_output_tokens;
    const queuedKey = serializedTotalsKey(bucket.totals);
    bucket.queuedKey = queuedKey;
    if (bucket.attributionQueuedKeys?.unknown) {
      const model = key.split("|")[1];
      bucket.attributionQueuedKeys.unknown = `${queuedKey}|${model}|unknown`;
    }
  }
  const rows = fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  for (const row of rows) {
    row.total_tokens -= row.reasoning_output_tokens;
    row.billable_total_tokens -= row.reasoning_output_tokens;
  }
  fs.writeFileSync(queuePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return rows;
}

test("resolveDeepSeekHarnessHome follows explicit override, DSH_HOME, then ~/.dsh", () => {
  assert.equal(resolveDeepSeekHarnessHome({ TOKENTRACKER_DSH_HOME: "D:\\override" }, "C:\\Users\\tester"), "D:\\override");
  assert.equal(resolveDeepSeekHarnessHome({ DSH_HOME: "D:\\dsh" }, "C:\\Users\\tester"), "D:\\dsh");
  assert.equal(resolveDeepSeekHarnessHome({}, "C:\\Users\\tester"), path.join("C:\\Users\\tester", ".dsh"));
});

test("lists compressed and raw DeepSeek Harness session logs recursively", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-list-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const compressed = await writeSession(root, "compressed", fixtureEvents(), true);
  const raw = await writeSession(root, "raw", fixtureEvents({ sessionId: "session-dsh-2" }), false);

  assert.deepEqual(await listDeepSeekHarnessSessionFiles(root), [compressed, raw].sort((a, b) => a.localeCompare(b)));
});

test("parses exact DeepSeek Harness usage and does not double count final messages", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-parse-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionFile = await writeSession(root, "session-one", fixtureEvents(), true);
  const queuePath = path.join(root, "queue.jsonl");
  const cursors = {};

  const first = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(first, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 1 });

  const rows = fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "deepseek-harness");
  assert.equal(rows[0].model, "deepseek-v4-flash");
  assert.deepEqual({
    input_tokens: rows[0].input_tokens,
    cached_input_tokens: rows[0].cached_input_tokens,
    cache_creation_input_tokens: rows[0].cache_creation_input_tokens,
    output_tokens: rows[0].output_tokens,
    reasoning_output_tokens: rows[0].reasoning_output_tokens,
    total_tokens: rows[0].total_tokens,
    billable_total_tokens: rows[0].billable_total_tokens,
    conversation_count: rows[0].conversation_count,
  }, {
    input_tokens: 120,
    cached_input_tokens: 30,
    cache_creation_input_tokens: 0,
    output_tokens: 40,
    reasoning_output_tokens: 10,
    total_tokens: 200,
    billable_total_tokens: 200,
    conversation_count: 1,
  });
  assert.equal(rows[0].total_tokens, [
    rows[0].input_tokens,
    rows[0].cached_input_tokens,
    rows[0].cache_creation_input_tokens,
    rows[0].output_tokens,
    rows[0].reasoning_output_tokens,
  ].reduce((sum, value) => sum + value, 0));

  const second = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(second, { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).length, 1);
});

test("keeps a streamed usage sample when a DeepSeek Harness request has no final message", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-stream-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = fixtureEvents({ sessionId: "session-dsh-stream" }).slice(0, 3);
  events[2].data.chunk.usage = { inputTokens: 50, cacheReadTokens: 12, outputTokens: 8, reasoningTokens: 3 };
  const sessionFile = await writeSession(root, "stream-only", events, false);
  const queuePath = path.join(root, "queue.jsonl");
  const cursors = {};

  const result = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.equal(result.eventsAggregated, 1);
  const [row] = fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(row.total_tokens, 73);
  assert.equal(row.reasoning_output_tokens, 3);
});

test("keeps pure reasoning DeepSeek Harness usage", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-reasoning-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = fixtureEvents({
    sessionId: "session-dsh-reasoning",
    usage: { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 9 },
  }).filter((event) => event.type !== "assistant/chunk");
  const sessionFile = await writeSession(root, "reasoning-only", events, false);
  const queuePath = path.join(root, "queue.jsonl");

  const result = await parseDeepSeekHarnessIncremental({
    sessionFiles: [sessionFile],
    cursors: {},
    queuePath,
  });

  assert.deepEqual(result, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 1 });
  const [row] = fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(row.total_tokens, 9);
  assert.equal(row.reasoning_output_tokens, 9);
  assert.equal(row.billable_total_tokens, 9);
});

test("reparses unchanged pre-fix DeepSeek Harness files once to correct totals", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-normalization-upgrade-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionFile = await writeSession(root, "pre-fix", fixtureEvents({
    sessionId: "session-dsh-pre-fix",
  }), false);
  const queuePath = path.join(root, "queue.jsonl");
  const cursors = {};

  const [preFixRow] = await seedPreFixHarnessState({
    sessionFiles: [sessionFile],
    cursors,
    queuePath,
  });

  const upgraded = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(upgraded, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 1 });
  const upgradedRows = fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(upgradedRows.length, 2);
  assert.deepEqual(upgradedRows[1], {
    ...preFixRow,
    total_tokens: 200,
    billable_total_tokens: 200,
  });

  const repeated = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(repeated, { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).length, 2);
});

test("discovers pure reasoning in an unchanged pre-fix DeepSeek Harness file once", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-reasoning-upgrade-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = fixtureEvents({
    sessionId: "session-dsh-reasoning-upgrade",
    usage: { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 9 },
  }).filter((event) => event.type !== "assistant/chunk");
  const sessionFile = await writeSession(root, "reasoning-pre-fix", events, false);
  const queuePath = path.join(root, "queue.jsonl");
  const stat = fs.statSync(sessionFile);
  const cursors = {
    deepseekHarness: {
      files: {
        [sessionFile]: { signature: `${stat.size}:${stat.mtimeMs}`, byModel: {} },
      },
    },
  };

  const upgraded = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(upgraded, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 1 });
  const [row] = fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(row.total_tokens, 9);
  assert.equal(row.reasoning_output_tokens, 9);

  const repeated = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(repeated, { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).length, 1);
});

test("retries an unchanged pre-fix DeepSeek Harness file after a transient read failure", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-upgrade-retry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionFile = await writeSession(root, "retry", fixtureEvents({
    sessionId: "session-dsh-upgrade-retry",
  }), false);
  const queuePath = path.join(root, "queue.jsonl");
  const cursors = {};
  await seedPreFixHarnessState({ sessionFiles: [sessionFile], cursors, queuePath });

  const originalReadFile = fsPromises.readFile;
  fsPromises.readFile = async (filePath, ...args) => {
    if (filePath === sessionFile) throw new Error("transient read failure");
    return originalReadFile(filePath, ...args);
  };
  let failed;
  try {
    failed = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  } finally {
    fsPromises.readFile = originalReadFile;
  }
  assert.deepEqual(failed, { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).length, 1);

  const retried = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(retried, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 1 });
  const retriedRows = fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(retriedRows.length, 2);
  assert.equal(retriedRows[1].total_tokens, 200);

  const repeated = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(repeated, { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
});

test("does not reparse an upgraded DeepSeek Harness file while another file remains pending", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-partial-upgrade-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const successfulFile = await writeSession(root, "successful", fixtureEvents({
    sessionId: "session-dsh-upgrade-successful",
    model: "deepseek-v4-flash",
  }), false);
  const pendingFile = await writeSession(root, "pending", fixtureEvents({
    sessionId: "session-dsh-upgrade-pending",
    model: "deepseek-v4-chat",
  }), false);
  const sessionFiles = [successfulFile, pendingFile];
  const queuePath = path.join(root, "queue.jsonl");
  const cursors = {};
  await seedPreFixHarnessState({ sessionFiles, cursors, queuePath });

  const originalReadFile = fsPromises.readFile;
  fsPromises.readFile = async (filePath, ...args) => {
    if (filePath === pendingFile) throw new Error("transient read failure");
    return originalReadFile(filePath, ...args);
  };
  let partial;
  try {
    partial = await parseDeepSeekHarnessIncremental({ sessionFiles, cursors, queuePath });
  } finally {
    fsPromises.readFile = originalReadFile;
  }
  assert.deepEqual(partial, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 1 });

  const retried = await parseDeepSeekHarnessIncremental({ sessionFiles, cursors, queuePath });
  assert.deepEqual(retried, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 1 });
  const rows = fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((row) => row.model === "deepseek-v4-flash").length, 2);
  assert.equal(rows.filter((row) => row.model === "deepseek-v4-chat").length, 2);

  const repeated = await parseDeepSeekHarnessIncremental({ sessionFiles, cursors, queuePath });
  assert.deepEqual(repeated, { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
});

test("reads concatenated zstd frames written by live DeepSeek Harness sessions", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-frames-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionDir = path.join(root, "sessions", "multi-frame");
  fs.mkdirSync(sessionDir, { recursive: true });
  const frames = [];
  for (const event of fixtureEvents({ sessionId: "session-dsh-frames" })) {
    frames.push(Buffer.from(await zstd.compress(Buffer.from(`${JSON.stringify(event)}\n`))));
  }
  const sessionFile = path.join(sessionDir, "session.jsonl.zstd");
  fs.writeFileSync(sessionFile, Buffer.concat(frames));
  const queuePath = path.join(root, "queue.jsonl");

  const result = await parseDeepSeekHarnessIncremental({
    sessionFiles: [sessionFile],
    cursors: {},
    queuePath,
  });

  assert.equal(result.eventsAggregated, 1);
  const [row] = fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(row.total_tokens, 200);
});
