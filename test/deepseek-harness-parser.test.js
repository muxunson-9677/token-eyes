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

function readQueue(queuePath) {
  return fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function usageEvent({ turn, time, usage, final = true }) {
  return final
    ? { type: "assistant/message", seq: turn * 2, time, data: { turn, step: 1, message: { role: "assistant", content: [] }, usage } }
    : { type: "assistant/chunk", seq: turn * 2, time, data: { turn, step: 1, chunk: { type: "usage", usage } } };
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
    for (const entry of Object.values(file.byBucket)) {
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

test("keeps one model's usage in each event half-hour bucket", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-buckets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const model = "deepseek-v4-flash";
  const events = [
    { type: "request/context", seq: 1, time: "2026-08-16T10:00:00.000Z", data: { model } },
    usageEvent({ turn: 1, time: "2026-08-16T10:05:00.000Z", usage: { inputTokens: 10, outputTokens: 1 } }),
    usageEvent({ turn: 2, time: "2026-08-16T10:35:00.000Z", usage: { inputTokens: 20, outputTokens: 2 } }),
    usageEvent({ turn: 3, time: "2026-08-16T11:05:00.000Z", usage: { inputTokens: 30, outputTokens: 3 } }),
  ];
  const sessionFile = await writeSession(root, "three-buckets", events, false);
  const queuePath = path.join(root, "queue.jsonl");
  const cursors = {};

  const first = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(first, { filesProcessed: 1, eventsAggregated: 3, bucketsQueued: 3 });
  assert.deepEqual(readQueue(queuePath).map((row) => [row.hour_start, row.total_tokens]), [
    ["2026-08-16T10:00:00.000Z", 11],
    ["2026-08-16T10:30:00.000Z", 22],
    ["2026-08-16T11:00:00.000Z", 33],
  ]);

  const repeated = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(repeated, { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(readQueue(queuePath).length, 3);
});

test("keeps DeepSeek Harness usage on opposite sides of UTC midnight separate", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-midnight-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = [
    { type: "request/context", seq: 1, time: "2026-08-16T23:50:00.000Z", data: { model: "deepseek-v4-chat" } },
    usageEvent({ turn: 1, time: "2026-08-16T23:55:00.000Z", usage: { inputTokens: 40, outputTokens: 4 } }),
    usageEvent({ turn: 2, time: "2026-08-17T00:05:00.000Z", usage: { inputTokens: 50, outputTokens: 5 } }),
  ];
  const sessionFile = await writeSession(root, "midnight", events, false);
  const queuePath = path.join(root, "queue.jsonl");

  await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors: {}, queuePath });

  assert.deepEqual(readQueue(queuePath).map((row) => [row.hour_start, row.total_tokens]), [
    ["2026-08-16T23:30:00.000Z", 44],
    ["2026-08-17T00:00:00.000Z", 55],
  ]);
});

test("appending usage in a new bucket enqueues only that bucket", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-append-bucket-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = [
    { type: "request/context", seq: 1, time: "2026-08-16T10:00:00.000Z", data: { model: "deepseek-v4-flash" } },
    usageEvent({ turn: 1, time: "2026-08-16T10:05:00.000Z", usage: { inputTokens: 10, outputTokens: 1 } }),
  ];
  const sessionFile = await writeSession(root, "append", events, false);
  const queuePath = path.join(root, "queue.jsonl");
  const cursors = {};
  await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });

  fs.appendFileSync(sessionFile, `${JSON.stringify(usageEvent({
    turn: 2,
    time: "2026-08-16T10:35:00.000Z",
    usage: { inputTokens: 20, outputTokens: 2 },
  }))}\n`);
  const appended = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });

  assert.deepEqual(appended, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 1 });
  assert.deepEqual(readQueue(queuePath).map((row) => [row.hour_start, row.total_tokens]), [
    ["2026-08-16T10:00:00.000Z", 11],
    ["2026-08-16T10:30:00.000Z", 22],
  ]);
});

test("replaces cumulative usage for one turn-step in the same bucket without duplication", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-same-bucket-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = [
    { type: "request/context", seq: 1, time: "2026-08-16T10:00:00.000Z", data: { model: "deepseek-v4-flash" } },
    usageEvent({ turn: 1, time: "2026-08-16T10:05:00.000Z", usage: { inputTokens: 10, outputTokens: 1 }, final: false }),
  ];
  const sessionFile = await writeSession(root, "same-bucket", events, false);
  const queuePath = path.join(root, "queue.jsonl");
  const cursors = {};
  await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });

  fs.appendFileSync(sessionFile, `${JSON.stringify(usageEvent({
    turn: 1,
    time: "2026-08-16T10:06:00.000Z",
    usage: { inputTokens: 15, outputTokens: 3 },
  }))}\n`);
  const replaced = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });

  assert.deepEqual(replaced, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 1 });
  const rows = readQueue(queuePath);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.total_tokens), [11, 18]);
  assert.equal(new Map(rows.map((row) => [`${row.source}|${row.model}|${row.hour_start}|${row.billing_mode}`, row])).size, 1);
});

test("moves a turn-step contribution when its final usage crosses a bucket boundary", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-move-bucket-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = [
    { type: "request/context", seq: 1, time: "2026-08-16T10:00:00.000Z", data: { model: "deepseek-v4-flash" } },
    usageEvent({ turn: 1, time: "2026-08-16T10:29:00.000Z", usage: { inputTokens: 10, outputTokens: 1 }, final: false }),
  ];
  const sessionFile = await writeSession(root, "move-bucket", events, false);
  const queuePath = path.join(root, "queue.jsonl");
  const cursors = {};
  await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });

  fs.appendFileSync(sessionFile, `${JSON.stringify(usageEvent({
    turn: 1,
    time: "2026-08-16T10:31:00.000Z",
    usage: { inputTokens: 15, outputTokens: 3 },
  }))}\n`);
  const moved = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });

  assert.deepEqual(moved, { filesProcessed: 1, eventsAggregated: 2, bucketsQueued: 2 });
  const latest = new Map(readQueue(queuePath).map((row) => [row.hour_start, row]));
  assert.equal(latest.get("2026-08-16T10:00:00.000Z").total_tokens, 0);
  assert.equal(latest.get("2026-08-16T10:30:00.000Z").total_tokens, 18);
});

test("rebuilds old DeepSeek Harness bucket state while preserving other sources", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-bucket-upgrade-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const model = "deepseek-v4-flash";
  const events = [
    { type: "request/context", seq: 1, time: "2026-08-16T10:00:00.000Z", data: { model } },
    usageEvent({ turn: 1, time: "2026-08-16T10:05:00.000Z", usage: { inputTokens: 10, outputTokens: 1 } }),
    usageEvent({ turn: 2, time: "2026-08-16T10:35:00.000Z", usage: { inputTokens: 20, outputTokens: 2 } }),
  ];
  const sessionFile = await writeSession(root, "migration", events, false);
  const stat = fs.statSync(sessionFile);
  const queuePath = path.join(root, "queue.jsonl");
  const oldHours = ["2026-08-15T09:00:00.000Z", "2026-08-16T11:30:00.000Z"];
  const oldRows = oldHours.map((hour_start, index) => ({
    source: "deepseek-harness", model, hour_start,
    input_tokens: 100 + index, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 110 + index,
    billable_total_tokens: 110 + index, conversation_count: 1,
    billing_mode: "unknown", billing_mode_confidence: "unavailable",
  }));
  const otherRow = {
    source: "claude", model: "claude-sonnet-4", hour_start: oldHours[0],
    input_tokens: 700, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens: 70, reasoning_output_tokens: 0, total_tokens: 770,
    billable_total_tokens: 770, conversation_count: 1,
    billing_mode: "unknown", billing_mode_confidence: "unavailable",
  };
  fs.writeFileSync(queuePath, `${[...oldRows, otherRow].map(JSON.stringify).join("\n")}\n`);
  const cursors = {
    deepseekHarness: {
      normalizationVersion: 2,
      files: {
        [sessionFile]: {
          signature: `${stat.size}:${stat.mtimeMs}`,
          normalizationVersion: 2,
          byModel: { [model]: { totals: { ...oldRows[1] }, timestamp: "2026-08-16T10:35:00.000Z" } },
        },
      },
    },
    hourly: {
      version: 3,
      buckets: Object.fromEntries(oldRows.map((row) => [
        `${row.source}|${row.model}|${row.hour_start}`,
        { totals: { ...row }, queuedKey: serializedTotalsKey(row) },
      ]).concat([[
        `${otherRow.source}|${otherRow.model}|${otherRow.hour_start}`,
        { totals: { ...otherRow }, queuedKey: serializedTotalsKey(otherRow) },
      ]])),
      groupQueued: {},
      attributionMigrationVersion: 1,
      pendingAttributionRetractions: {},
    },
  };

  const rebuilt = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(rebuilt, { filesProcessed: 1, eventsAggregated: 2, bucketsQueued: 4 });
  assert.equal(cursors.deepseekHarness.bucketStateVersion, 3);
  assert.equal(cursors.deepseekHarness.bucketMigrationComplete, true);
  const rows = readQueue(queuePath);
  const latest = new Map(rows.map((row) => [`${row.source}|${row.model}|${row.hour_start}|${row.billing_mode}`, row]));
  assert.deepEqual(oldHours.map((hour) => latest.get(`deepseek-harness|${model}|${hour}|unknown`)?.total_tokens), [0, 0]);
  assert.equal(latest.get(`deepseek-harness|${model}|2026-08-16T10:00:00.000Z|unknown`).total_tokens, 11);
  assert.equal(latest.get(`deepseek-harness|${model}|2026-08-16T10:30:00.000Z|unknown`).total_tokens, 22);
  assert.deepEqual(latest.get(`claude|claude-sonnet-4|${oldHours[0]}|unknown`), otherRow);

  const repeated = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(repeated, { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(readQueue(queuePath).length, rows.length);
});

test("keeps an unreadable bucket migration pending without replaying successful files", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-bucket-retry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const successfulFile = await writeSession(root, "migration-success", fixtureEvents({ sessionId: "success" }), false);
  const pendingFile = await writeSession(root, "migration-pending", fixtureEvents({ sessionId: "pending", model: "deepseek-v4-chat" }), false);
  const queuePath = path.join(root, "queue.jsonl");
  const cursors = { deepseekHarness: { normalizationVersion: 2, files: {} } };
  const originalReadFile = fsPromises.readFile;
  fsPromises.readFile = async (filePath, ...args) => {
    if (filePath === pendingFile) throw new Error("transient read failure");
    return originalReadFile(filePath, ...args);
  };
  let partial;
  try {
    partial = await parseDeepSeekHarnessIncremental({ sessionFiles: [successfulFile, pendingFile], cursors, queuePath });
  } finally {
    fsPromises.readFile = originalReadFile;
  }
  assert.deepEqual(partial, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 1 });
  assert.equal(cursors.deepseekHarness.bucketStateVersion, 3);
  assert.equal(cursors.deepseekHarness.bucketMigrationComplete, false);
  const partialRows = readQueue(queuePath);

  const retried = await parseDeepSeekHarnessIncremental({ sessionFiles: [successfulFile, pendingFile], cursors, queuePath });
  assert.deepEqual(retried, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 1 });
  assert.equal(cursors.deepseekHarness.bucketMigrationComplete, true);
  const rows = readQueue(queuePath);
  assert.equal(rows.filter((row) => row.model === "deepseek-v4-flash").length, 1);
  assert.equal(rows.length, partialRows.length + 1);
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
