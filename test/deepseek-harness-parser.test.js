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
const { readQueueBatch } = require("../src/commands/sync");

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
    delete row.dsh_bucket_migration_id;
    delete row.dsh_bucket_migration_index;
    delete row.dsh_bucket_migration_count;
  }
  fs.writeFileSync(queuePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return rows;
}

test("resolveDeepSeekHarnessHome follows explicit override, DSH_HOME, then ~/.dsh", () => {
  const explicitOverride = path.resolve("dsh-explicit-override");
  const dshHome = path.resolve("dsh-home-override");
  const homeDir = path.resolve("dsh-user-home");
  assert.equal(resolveDeepSeekHarnessHome({ TOKENTRACKER_DSH_HOME: explicitOverride }, homeDir), explicitOverride);
  assert.equal(resolveDeepSeekHarnessHome({ DSH_HOME: dshHome }, homeDir), dshHome);
  assert.equal(resolveDeepSeekHarnessHome({}, homeDir), path.join(homeDir, ".dsh"));
});

test("lists compressed and raw DeepSeek Harness session logs recursively", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-list-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const compressed = await writeSession(root, "compressed", fixtureEvents(), true);
  const raw = await writeSession(root, "raw", fixtureEvents({ sessionId: "session-dsh-2" }), false);

  assert.deepEqual(await listDeepSeekHarnessSessionFiles(root), [compressed, raw].sort((a, b) => a.localeCompare(b)));
});

test("discovers v3 logs and replaces the prior generation without double counting migrated usage", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-v3-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const oldFile = await writeSession(root, "migrated", fixtureEvents(), true);
  const queuePath = path.join(root, "queue.jsonl");
  const cursors = {};
  await parseDeepSeekHarnessIncremental({ sessionFiles: [oldFile], cursors, queuePath });
  const events = fixtureEvents();
  events[0].version = 3;
  events[0].createdAt = Date.parse(events[0].createdAt);
  for (const event of events.slice(1)) event.time = Date.parse(event.time);
  events.push(usageEvent({ turn: 2, time: Date.parse("2026-08-16T10:10:00Z"), usage: { inputTokens: 5, outputTokens: 7, cacheReadTokens: 2, cacheWriteTokens: 3, reasoningTokens: 4 } }));
  const v3 = path.join(path.dirname(oldFile), "session.v3.jsonl.zstd");
  fs.writeFileSync(v3, Buffer.from(await zstd.compress(Buffer.from(events.map(JSON.stringify).join("\n")))));
  const files = await listDeepSeekHarnessSessionFiles(root);
  assert.deepEqual(files, [v3]);
  await parseDeepSeekHarnessIncremental({ sessionFiles: files, cursors, queuePath });
  const last = readQueue(queuePath).at(-1);
  assert.equal(last.total_tokens, 221);
  assert.equal(last.input_tokens, 125);
  assert.equal(last.reasoning_output_tokens, 14);
  assert.equal(last.conversation_count, 2);
  assert.equal(cursors.deepseekHarness.files[oldFile], undefined);
  const repeat = await parseDeepSeekHarnessIncremental({ sessionFiles: files, cursors, queuePath });
  assert.equal(repeat.bucketsQueued, 0);
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
  assert.equal(rows[0].billing_mode, "api_key");
  assert.equal(rows[0].billing_mode_confidence, "provider_receipt");
  assert.equal(rows[0].provider_id, "deepseek");
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
  assert.equal(cursors.deepseekHarness.bucketStateVersion, 4);
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

test("preserves exact api_key and token_plan slices when the rebuilt bucket matches trusted history", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-mode-upgrade-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const model = "deepseek-v4-flash";
  const hourStart = "2026-08-16T10:00:00.000Z";
  const events = [
    { type: "request/context", seq: 1, time: hourStart, data: { model } },
    usageEvent({ turn: 1, time: "2026-08-16T10:05:00.000Z", usage: { inputTokens: 10, outputTokens: 1 } }),
    usageEvent({ turn: 2, time: "2026-08-16T10:15:00.000Z", usage: { inputTokens: 20, outputTokens: 2 } }),
  ];
  const sessionFile = await writeSession(root, "mode-migration", events, false);
  const queuePath = path.join(root, "queue.jsonl");
  const modeRows = [
    { billing_mode: "api_key", billing_mode_confidence: "provider_receipt", input_tokens: 10, output_tokens: 1, total_tokens: 11, billable_total_tokens: 11, conversation_count: 1 },
    { billing_mode: "token_plan", billing_mode_confidence: "provider_receipt", input_tokens: 20, output_tokens: 2, total_tokens: 22, billable_total_tokens: 22, conversation_count: 1 },
  ].map((row) => ({
    source: "deepseek-harness", model, hour_start: hourStart,
    cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
    ...row,
  }));
  const otherRow = {
    source: "claude", model: "claude-sonnet-4", hour_start: hourStart,
    input_tokens: 90, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens: 9, reasoning_output_tokens: 0, total_tokens: 99,
    billable_total_tokens: 99, conversation_count: 1,
    billing_mode: "api_key", billing_mode_confidence: "provider_receipt",
  };
  fs.writeFileSync(queuePath, `${[...modeRows, otherRow].map(JSON.stringify).join("\n")}\n`);
  const aggregate = modeRows.reduce((totals, row) => {
    for (const key of Object.keys(totals)) totals[key] += Number(row[key] || 0);
    return totals;
  }, {
    input_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0,
    billable_total_tokens: 0, conversation_count: 0,
  });
  const cursors = {
    deepseekHarness: { normalizationVersion: 2, files: {} },
    hourly: {
      version: 3,
      buckets: {
        [`deepseek-harness|${model}|${hourStart}`]: { totals: aggregate, queuedKey: serializedTotalsKey(aggregate) },
        [`claude|${otherRow.model}|${hourStart}`]: { totals: { ...otherRow }, queuedKey: serializedTotalsKey(otherRow) },
      },
      groupQueued: {}, attributionMigrationVersion: 1, pendingAttributionRetractions: {},
    },
  };

  const rebuilt = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.equal(rebuilt.filesProcessed, 1);
  const rows = readQueue(queuePath);
  const latest = new Map(rows.map((row) => [`${row.source}|${row.model}|${row.hour_start}|${row.billing_mode}`, row]));
  assert.equal(latest.get(`deepseek-harness|${model}|${hourStart}|api_key`).total_tokens, 11);
  assert.equal(latest.get(`deepseek-harness|${model}|${hourStart}|token_plan`).total_tokens, 22);
  assert.equal(latest.has(`deepseek-harness|${model}|${hourStart}|unknown`), false);
  assert.equal([...latest.values()].filter((row) => row.source === "deepseek-harness").reduce((sum, row) => sum + row.total_tokens, 0), 33);
  assert.deepEqual(latest.get(`claude|${otherRow.model}|${hourStart}|api_key`), otherRow);

  const repeated = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(repeated, { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(readQueue(queuePath).length, rows.length);
});

test("keeps rebuilt usage unknown when historical billing-mode slices do not exactly reconcile", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-mode-mismatch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const model = "deepseek-v4-flash";
  const hourStart = "2026-08-16T10:00:00.000Z";
  const sessionFile = await writeSession(root, "mode-mismatch", [
    { type: "request/context", seq: 1, time: hourStart, data: { model } },
    usageEvent({ turn: 1, time: "2026-08-16T10:05:00.000Z", usage: { inputTokens: 10, outputTokens: 1 } }),
    usageEvent({ turn: 2, time: "2026-08-16T10:15:00.000Z", usage: { inputTokens: 20, outputTokens: 2 } }),
  ], false);
  const queuePath = path.join(root, "queue.jsonl");
  const historicalRows = [
    { billing_mode: "api_key", input_tokens: 10, output_tokens: 1, total_tokens: 11 },
    { billing_mode: "token_plan", input_tokens: 30, output_tokens: 3, total_tokens: 33 },
  ].map((row) => ({
    source: "deepseek-harness", model, hour_start: hourStart,
    cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
    billable_total_tokens: row.total_tokens, conversation_count: 1,
    billing_mode_confidence: "provider_receipt", ...row,
  }));
  fs.writeFileSync(queuePath, `${historicalRows.map(JSON.stringify).join("\n")}\n`);
  const aggregate = {
    input_tokens: 40, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens: 4, reasoning_output_tokens: 0, total_tokens: 44,
    billable_total_tokens: 44, conversation_count: 2,
  };
  const cursors = {
    deepseekHarness: { normalizationVersion: 2, files: {} },
    hourly: {
      version: 3,
      buckets: {
        [`deepseek-harness|${model}|${hourStart}`]: { totals: aggregate, queuedKey: serializedTotalsKey(aggregate) },
      },
      groupQueued: {}, attributionMigrationVersion: 1, pendingAttributionRetractions: {},
    },
  };

  await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });

  const latest = new Map(readQueue(queuePath).map((row) => [row.billing_mode, row]));
  assert.equal(latest.get("api_key").total_tokens, 0);
  assert.equal(latest.get("token_plan").total_tokens, 0);
  assert.equal(latest.get("unknown").total_tokens, 33);
  assert.equal([...latest.values()].reduce((sum, row) => sum + row.total_tokens, 0), 33);
});

test("does not revive billing modes superseded by formal unmarked zero rows", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-formal-zero-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const model = "deepseek-v4-flash";
  const hourStart = "2026-08-16T10:00:00.000Z";
  const sessionFile = await writeSession(root, "formal-zero", [
    { type: "request/context", seq: 1, time: hourStart, data: { model } },
    usageEvent({ turn: 1, time: "2026-08-16T10:05:00.000Z", usage: { inputTokens: 10, outputTokens: 1 } }),
    usageEvent({ turn: 2, time: "2026-08-16T10:15:00.000Z", usage: { inputTokens: 20, outputTokens: 2 } }),
  ], false);
  const queuePath = path.join(root, "queue.jsonl");
  const positiveRows = [
    { billing_mode: "api_key", input_tokens: 10, output_tokens: 1, total_tokens: 11, billable_total_tokens: 11, conversation_count: 1 },
    { billing_mode: "token_plan", input_tokens: 20, output_tokens: 2, total_tokens: 22, billable_total_tokens: 22, conversation_count: 1 },
  ].map((row) => ({
    source: "deepseek-harness", model, hour_start: hourStart,
    cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
    billing_mode_confidence: "provider_receipt", ...row,
  }));
  const zeroRows = positiveRows.map((row) => ({
    ...row,
    input_tokens: 0, output_tokens: 0, total_tokens: 0,
    billable_total_tokens: 0, conversation_count: 0,
  }));
  fs.writeFileSync(queuePath, `${[...positiveRows, ...zeroRows].map(JSON.stringify).join("\n")}\n`);
  const aggregate = {
    input_tokens: 30, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens: 3, reasoning_output_tokens: 0, total_tokens: 33,
    billable_total_tokens: 33, conversation_count: 2,
  };
  const cursors = {
    deepseekHarness: { normalizationVersion: 2, files: {} },
    hourly: {
      version: 3,
      buckets: {
        [`deepseek-harness|${model}|${hourStart}`]: { totals: aggregate, queuedKey: serializedTotalsKey(aggregate) },
      },
      groupQueued: {}, attributionMigrationVersion: 1, pendingAttributionRetractions: {},
    },
  };

  await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });

  const latest = new Map(readQueue(queuePath).map((row) => [row.billing_mode, row]));
  assert.equal(latest.get("api_key").total_tokens, 0);
  assert.equal(latest.get("token_plan").total_tokens, 0);
  assert.equal(latest.get("unknown").total_tokens, 33);
  assert.equal([...latest.values()].reduce((sum, row) => sum + row.total_tokens, 0), 33);
});

test("retracts restored billing modes when a reasoning turn moves across buckets", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-mode-move-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const model = "deepseek-v4-flash";
  const oldHour = "2026-08-16T10:00:00.000Z";
  const newHour = "2026-08-16T10:30:00.000Z";
  const sessionFile = await writeSession(root, "mode-move", [
    { type: "request/context", seq: 1, time: oldHour, data: { model } },
    usageEvent({
      turn: 1,
      time: "2026-08-16T10:29:00.000Z",
      usage: { inputTokens: 4, outputTokens: 2, reasoningTokens: 5 },
      final: false,
    }),
  ], false);
  const queuePath = path.join(root, "queue.jsonl");
  const historicalRows = [
    { billing_mode: "api_key", input_tokens: 4, output_tokens: 0, reasoning_output_tokens: 1, total_tokens: 5 },
    { billing_mode: "token_plan", input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 4, total_tokens: 6 },
  ].map((row) => ({
    source: "deepseek-harness", model, hour_start: oldHour,
    cached_input_tokens: 0, cache_creation_input_tokens: 0,
    billable_total_tokens: row.total_tokens, conversation_count: row.billing_mode === "api_key" ? 1 : 0,
    billing_mode_confidence: "provider_receipt", ...row,
  }));
  fs.writeFileSync(queuePath, `${historicalRows.map(JSON.stringify).join("\n")}\n`);
  const aggregate = {
    input_tokens: 4, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens: 2, reasoning_output_tokens: 5, total_tokens: 11,
    billable_total_tokens: 11, conversation_count: 1,
  };
  const cursors = {
    deepseekHarness: { normalizationVersion: 2, files: {} },
    hourly: {
      version: 3,
      buckets: {
        [`deepseek-harness|${model}|${oldHour}`]: { totals: aggregate, queuedKey: serializedTotalsKey(aggregate) },
      },
      groupQueued: {}, attributionMigrationVersion: 1, pendingAttributionRetractions: {},
    },
  };
  await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });

  fs.appendFileSync(sessionFile, `${JSON.stringify(usageEvent({
    turn: 1,
    time: "2026-08-16T10:31:00.000Z",
    usage: { inputTokens: 7, outputTokens: 3, reasoningTokens: 8 },
  }))}\n`);
  const moved = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });

  assert.deepEqual(moved, { filesProcessed: 1, eventsAggregated: 2, bucketsQueued: 4 });
  const rows = readQueue(queuePath);
  const latest = new Map(rows.map((row) => [
    `${row.source}|${row.model}|${row.hour_start}|${row.billing_mode}`,
    row,
  ]));
  assert.equal(latest.get(`deepseek-harness|${model}|${oldHour}|api_key`).total_tokens, 0);
  assert.equal(latest.get(`deepseek-harness|${model}|${oldHour}|token_plan`).total_tokens, 0);
  assert.equal(latest.get(`deepseek-harness|${model}|${oldHour}|unknown`).total_tokens, 0);
  assert.equal(latest.get(`deepseek-harness|${model}|${newHour}|unknown`).total_tokens, 18);
  assert.equal([...latest.values()].reduce((sum, row) => sum + row.total_tokens, 0), 18);
  assert.equal([...latest.values()].every((row) => Object.values(row).every((value) => typeof value !== "number" || value >= 0)), true);

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
  const oldHour = "2026-08-16T10:00:00.000Z";
  const oldRow = {
    source: "deepseek-harness", model: "deepseek-v4-flash", hour_start: oldHour,
    input_tokens: 120, cached_input_tokens: 30, cache_creation_input_tokens: 0,
    output_tokens: 40, reasoning_output_tokens: 10, total_tokens: 200,
    billable_total_tokens: 200, conversation_count: 1,
    billing_mode: "api_key", billing_mode_confidence: "provider_receipt",
  };
  const oldQueueText = `${JSON.stringify(oldRow)}\n`;
  fs.writeFileSync(queuePath, oldQueueText);
  const cursors = {
    deepseekHarness: { normalizationVersion: 2, files: {} },
    hourly: {
      version: 3,
      buckets: {
        [`deepseek-harness|${oldRow.model}|${oldHour}`]: {
          totals: { ...oldRow }, queuedKey: serializedTotalsKey(oldRow),
        },
      },
      groupQueued: {}, attributionMigrationVersion: 1, pendingAttributionRetractions: {},
    },
  };
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
  assert.deepEqual(partial, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 0 });
  assert.equal(cursors.deepseekHarness.bucketStateVersion, 4);
  assert.equal(cursors.deepseekHarness.bucketMigrationComplete, false);
  assert.equal(fs.readFileSync(queuePath, "utf8"), oldQueueText);
  assert.equal(readQueue(queuePath)[0].total_tokens, 200);

  const retried = await parseDeepSeekHarnessIncremental({ sessionFiles: [successfulFile, pendingFile], cursors, queuePath });
  assert.deepEqual(retried, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 3 });
  assert.equal(cursors.deepseekHarness.bucketMigrationComplete, true);
  const rows = readQueue(queuePath);
  const latest = new Map(rows.map((row) => [
    `${row.source}|${row.model}|${row.hour_start}|${row.billing_mode}`,
    row,
  ]));
  assert.equal(latest.get(`deepseek-harness|deepseek-v4-flash|${oldHour}|api_key`).total_tokens, 200);
  assert.equal(rows.length, 4);

  const repeated = await parseDeepSeekHarnessIncremental({ sessionFiles: [successfulFile, pendingFile], cursors, queuePath });
  assert.deepEqual(repeated, { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(readQueue(queuePath).length, rows.length);
});

test("replays a completed billing migration after queue append but before cursor persistence", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-dsh-migration-crash-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const model = "deepseek-v4-flash";
  const hourStart = "2026-08-16T10:00:00.000Z";
  const sessionFile = await writeSession(root, "migration-crash", [
    { type: "request/context", seq: 1, time: hourStart, data: { model } },
    usageEvent({ turn: 1, time: "2026-08-16T10:05:00.000Z", usage: { inputTokens: 10, outputTokens: 1 } }),
    usageEvent({ turn: 2, time: "2026-08-16T10:15:00.000Z", usage: { inputTokens: 20, outputTokens: 2 } }),
  ], false);
  const queuePath = path.join(root, "queue.jsonl");
  const modeRows = [
    { billing_mode: "api_key", input_tokens: 10, output_tokens: 1, total_tokens: 11, billable_total_tokens: 11, conversation_count: 1 },
    { billing_mode: "token_plan", input_tokens: 20, output_tokens: 2, total_tokens: 22, billable_total_tokens: 22, conversation_count: 1 },
  ].map((row) => ({
    source: "deepseek-harness", model, hour_start: hourStart,
    cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
    billing_mode_confidence: "provider_receipt", ...row,
  }));
  fs.writeFileSync(queuePath, `${modeRows.map(JSON.stringify).join("\n")}\n`);
  const aggregate = {
    input_tokens: 30, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens: 3, reasoning_output_tokens: 0, total_tokens: 33,
    billable_total_tokens: 33, conversation_count: 2,
  };
  const oldCursors = {
    deepseekHarness: { normalizationVersion: 2, files: {} },
    hourly: {
      version: 3,
      buckets: {
        [`deepseek-harness|${model}|${hourStart}`]: { totals: aggregate, queuedKey: serializedTotalsKey(aggregate) },
      },
      groupQueued: {}, attributionMigrationVersion: 1, pendingAttributionRetractions: {},
    },
  };
  const firstCursors = structuredClone(oldCursors);
  const first = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors: firstCursors, queuePath });
  assert.equal(first.bucketsQueued, 4);
  const afterAppend = fs.readFileSync(queuePath, "utf8");

  const restartedCursors = structuredClone(oldCursors);
  const restarted = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors: restartedCursors, queuePath });

  assert.deepEqual(restarted, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 0 });
  assert.equal(fs.readFileSync(queuePath, "utf8"), afterAppend);
  const latest = new Map(readQueue(queuePath).map((row) => [row.billing_mode, row]));
  assert.equal(latest.get("api_key").total_tokens, 11);
  assert.equal(latest.get("token_plan").total_tokens, 22);
  assert.equal(latest.has("unknown"), false);
  assert.equal(restartedCursors.deepseekHarness.bucketMigrationComplete, true);

  const partialTransaction = afterAppend.trim().split(/\r?\n/).slice(0, -1).join("\n") + "\n";
  fs.writeFileSync(queuePath, partialTransaction);
  const partialRestartCursors = structuredClone(oldCursors);
  const replayed = await parseDeepSeekHarnessIncremental({
    sessionFiles: [sessionFile], cursors: partialRestartCursors, queuePath,
  });
  assert.equal(replayed.bucketsQueued, 4);
  const replayedRows = readQueue(queuePath);
  const replayedLatest = new Map(replayedRows.map((row) => [row.billing_mode, row]));
  assert.equal(replayedLatest.get("api_key").total_tokens, 11);
  assert.equal(replayedLatest.get("token_plan").total_tokens, 22);
  const replayedAgain = await parseDeepSeekHarnessIncremental({
    sessionFiles: [sessionFile], cursors: partialRestartCursors, queuePath,
  });
  assert.deepEqual(replayedAgain, { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });

  fs.writeFileSync(queuePath, `${modeRows.map(JSON.stringify).join("\n")}\n{"unterminated":`);
  const tornTailCursors = structuredClone(oldCursors);
  const tornTailReplay = await parseDeepSeekHarnessIncremental({
    sessionFiles: [sessionFile], cursors: tornTailCursors, queuePath,
  });
  assert.equal(tornTailReplay.bucketsQueued, 4);
  assert.doesNotMatch(fs.readFileSync(queuePath, "utf8"), /\{"unterminated":/u);
  const fragment = fs.readdirSync(root).find(name => name.startsWith("queue.jsonl.torn-"));
  assert.ok(fragment, "torn bytes must be retained before queue recovery");
  assert.equal(fs.readFileSync(path.join(root, fragment), "utf8"), '{"unterminated":');
  const ordinaryBatch = await readQueueBatch(queuePath, 0, 20);
  const cloudBatch = await readQueueBatch(queuePath, ordinaryBatch.nextOffset, 20);
  assert.deepEqual(
    cloudBatch.buckets.filter((row) => !row.billing_mode_compat_summary)
      .map((row) => [row.billing_mode, row.total_tokens]).sort(),
    [["api_key", 11], ["token_plan", 22]],
  );
  assert.equal(cloudBatch.buckets.find((row) => row.billing_mode_compat_summary)?.total_tokens, 33);
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
  assert.deepEqual(upgraded, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 2 });
  const upgradedRows = fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(upgradedRows.length, 3);
  const {
    dsh_bucket_migration_id: _migrationId,
    dsh_bucket_migration_index: _migrationIndex,
    dsh_bucket_migration_count: _migrationCount,
    ...upgradedRow
  } = upgradedRows.at(-1);
  assert.deepEqual(upgradedRow, {
    ...preFixRow,
    total_tokens: 200,
    billable_total_tokens: 200,
  });

  const repeated = await parseDeepSeekHarnessIncremental({ sessionFiles: [sessionFile], cursors, queuePath });
  assert.deepEqual(repeated, { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).length, 3);
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
  assert.deepEqual(retried, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 2 });
  const retriedRows = fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(retriedRows.length, 3);
  assert.equal(retriedRows.at(-1).total_tokens, 200);

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
  assert.deepEqual(partial, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 0 });

  const retried = await parseDeepSeekHarnessIncremental({ sessionFiles, cursors, queuePath });
  assert.deepEqual(retried, { filesProcessed: 1, eventsAggregated: 1, bucketsQueued: 4 });
  const rows = fs.readFileSync(queuePath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(rows.length, 6);
  assert.equal(rows.filter((row) => row.model === "deepseek-v4-flash").length, 3);
  assert.equal(rows.filter((row) => row.model === "deepseek-v4-chat").length, 3);

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
