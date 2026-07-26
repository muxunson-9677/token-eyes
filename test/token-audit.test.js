"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

require("./helpers/home-shim.cjs");

const {
  auditRows,
  readJsonlRows,
  bucketSnapshotKey,
  stableEventKey,
} = require("../scripts/audit-token-correctness.cjs");
const { createLocalApiHandler } = require("./helpers/local-api.cjs");
const { parseRolloutIncremental } = require("../src/lib/rollout");

const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(__dirname, "fixtures", "token-audit");
const AUDIT = path.join(ROOT, "scripts", "audit-token-correctness.cjs");
const TOKEN_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "reasoning_output_tokens",
  "total_tokens",
];

function load(name) {
  return readJsonlRows(path.join(FIXTURES, name)).rows;
}

function strict(name) {
  return spawnSync(process.execPath, [AUDIT, "--strict", "--input", path.join(FIXTURES, name)], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

async function callSummary(queuePath) {
  const handler = createLocalApiHandler({ queuePath, trackerDataDir: path.dirname(queuePath) });
  const endpoint = "/functions/tokentracker-usage-summary?from=2026-07-26&to=2026-07-26&tz=UTC";
  const url = new URL(`http://localhost${endpoint}`);
  const req = { method: "GET", url: endpoint, headers: { host: "localhost" } };
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead() {},
    write(chunk) { chunks.push(chunk); },
    end(body) { if (body) chunks.push(body); },
  };
  assert.equal(await handler(req, res, url), true);
  assert.equal(res.statusCode, 200);
  return JSON.parse(chunks.join(""));
}

function independentlyRecomputeFixtureTotals(rows) {
  const latestSnapshots = new Map();
  for (const row of rows) {
    assert.notEqual(row.record_kind, "event", "production queue fixture must contain snapshots only");
    const key = `${String(row.source || "").trim().toLowerCase()}|${String(row.model || "").trim().toLowerCase()}|${row.hour_start || ""}`;
    latestSnapshots.set(key, row);
  }
  const totals = Object.fromEntries(TOKEN_FIELDS.map((field) => [field, 0]));
  for (const row of latestSnapshots.values()) {
    for (const field of TOKEN_FIELDS) totals[field] += row[field];
  }
  return totals;
}

function tokenCountLine({ timestamp, last, total }) {
  return JSON.stringify({
    type: "event_msg",
    timestamp,
    payload: { type: "token_count", info: { last_token_usage: last, total_token_usage: total } },
  });
}

test("snapshot key and stable event key are deliberately different", () => {
  const row = load("normal.jsonl")[0];
  assert.equal(bucketSnapshotKey(row), "claude|claude-sonnet-4-5|2026-07-26T00:00:00.000Z");
  assert.equal(stableEventKey(row), "claude|event_id|normal-1");
});

test("canonical total is exactly the sum of all five token parts", () => {
  const result = auditRows(load("normal.jsonl"));
  assert.equal(result.raw.invariant_failures, 0);
  assert.equal(result.sources.claude.sum_parts, 165);
  assert.equal(result.sources.claude.total_tokens, 165);
  assert.equal(strict("normal.jsonl").status, 0);
});

test("same-bucket increasing snapshots are allowed and latest wins", () => {
  const result = auditRows(load("allowed-snapshot.jsonl"));
  assert.equal(result.raw.allowed_snapshot_bucket_keys, 1);
  assert.equal(result.raw.real_duplicate_event_keys, 0);
  assert.equal(result.raw.snapshot_regression_bucket_keys, 0);
  assert.equal(result.sources.gemini.total_tokens, 30);
  assert.equal(strict("allowed-snapshot.jsonl").status, 0);
});
test("an identical repeated snapshot fails strict mode", () => {
  const result = auditRows(load("duplicate-snapshot.jsonl"));
  assert.equal(result.raw.duplicate_snapshot_bucket_keys, 1);
  assert.notEqual(strict("duplicate-snapshot.jsonl").status, 0);
});

test("an explicitly marked correction snapshot may decrease and latest wins", () => {
  const result = auditRows(load("correction-snapshot.jsonl"));
  assert.equal(result.raw.correction_snapshot_bucket_keys, 1);
  assert.equal(result.raw.snapshot_regression_bucket_keys, 0);
  assert.equal(result.sources["every-code"].total_tokens, 0);
  assert.equal(strict("correction-snapshot.jsonl").status, 0);
});

test("different events in the same bucket are both counted, not treated as snapshots", () => {
  const result = auditRows(load("same-bucket-events.jsonl"));
  assert.equal(result.raw.allowed_snapshot_bucket_keys, 0);
  assert.equal(result.raw.real_duplicate_event_keys, 0);
  assert.equal(result.sources.claude.rows, 2);
  assert.equal(result.sources.claude.total_tokens, 41);
  assert.equal(strict("same-bucket-events.jsonl").status, 0);
});
test("a repeated stable event id is a real duplicate and strict mode fails", () => {
  const result = auditRows(load("duplicate-event.jsonl"));
  assert.equal(result.raw.real_duplicate_event_keys, 1);
  const run = strict("duplicate-event.jsonl");
  assert.notEqual(run.status, 0, run.stdout);
});

test("parts mismatch fails strict mode", () => {
  const result = auditRows(load("parts-mismatch.jsonl"));
  assert.equal(result.raw.invariant_failures, 1);
  assert.notEqual(strict("parts-mismatch.jsonl").status, 0);
});

test("negative token fields fail strict mode", () => {
  const result = auditRows(load("negative.jsonl"));
  assert.equal(result.raw.invalid_negative_rows, 1);
  assert.equal(result.raw.invariant_failures, 0);
  assert.notEqual(strict("negative.jsonl").status, 0);
});
test("malformed JSON and unsafe integers fail strict mode", () => {
  assert.notEqual(strict("malformed.jsonl").status, 0);
  const unsafe = auditRows(load("unsafe-integer.jsonl"));
  assert.equal(unsafe.raw.invalid_token_value_rows, 1);
  assert.notEqual(strict("unsafe-integer.jsonl").status, 0);
});

test("large safe integers preserve the exact invariant", () => {
  const result = auditRows(load("large-integer.jsonl"));
  assert.equal(result.raw.invalid_token_value_rows, 0);
  assert.equal(result.raw.invariant_failures, 0);
  assert.equal(result.sources.goose.total_tokens, 9000000000000000);
  assert.equal(strict("large-integer.jsonl").status, 0);
});

test("strict schema rejects non-objects, missing fields, and boolean token values", () => {
  const result = auditRows(load("invalid-schema.jsonl"));
  assert.equal(result.raw.invalid_schema_rows, 3);
  assert.notEqual(strict("invalid-schema.jsonl").status, 0);
});

test("prototype-like source names are aggregated without mutating Object.prototype", () => {
  const row = {
    source: "__proto__",
    model: "safe-model",
    hour_start: "2026-07-26T10:30:00.000Z",
    input_tokens: 1,
    output_tokens: 2,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 3,
    conversation_count: 1,
  };
  const result = auditRows([row]);
  assert.equal(result.raw.invalid_schema_rows, 0);
  assert.equal(result.sources.__proto__.total_tokens, 3);
  assert.equal(({}).rows, undefined);
});
test("strict valid aggregate fixture passes without reading real HOME", () => {
  const run = strict("queue.jsonl");
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(run.stdout);
  assert.equal(path.resolve(report.queue_path), path.join(FIXTURES, "queue.jsonl"));
  assert.equal(report.raw.allowed_snapshot_bucket_keys, 1);
});

test("strict mode requires an explicit input fixture", () => {
  const run = spawnSync(process.execPath, [AUDIT, "--strict"], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /--input is required in strict mode/);
});

test("local API aggregate matches a golden recomputation from latest fixture snapshots", async () => {
  const queuePath = path.join(FIXTURES, "queue.jsonl");
  const rows = readJsonlRows(queuePath).rows;
  const expected = independentlyRecomputeFixtureTotals(rows);
  const summary = await callSummary(queuePath);
  for (const field of TOKEN_FIELDS) {
    assert.equal(summary.totals[field], expected[field], `${field} must match raw golden recomputation`);
  }
});

test("the real Codex parser writes a canonical total that includes the reasoning column", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "token-audit-codex-reasoning-"));
  try {
    const rolloutPath = path.join(tmp, "rollout-2026-07-26T05-00-00-11111111-2222-3333-4444-555555555555.jsonl");
    const queuePath = path.join(tmp, "queue.jsonl");
    const usage = {
      input_tokens: 1000,
      cached_input_tokens: 950,
      cache_creation_input_tokens: 0,
      output_tokens: 10,
      reasoning_output_tokens: 4,
      total_tokens: 1010,
    };
    fs.writeFileSync(
      rolloutPath,
      tokenCountLine({ timestamp: "2026-07-26T05:00:00.000Z", last: usage, total: usage }) + "\n",
      "utf8",
    );
    const cursors = { files: {}, hourly: { version: 3, buckets: {}, groupQueued: {} } };
    await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath, source: "codex" });
    const row = readJsonlRows(queuePath).rows[0];
    assert.equal(row.input_tokens, 50);
    assert.equal(row.cached_input_tokens, 950);
    assert.equal(row.output_tokens, 10);
    assert.equal(row.reasoning_output_tokens, 4);
    assert.equal(row.total_tokens, 1014);
    assert.equal(auditRows([row]).raw.invariant_failures, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
test("the real Codex parser and queue writer are idempotent across two sync passes", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "token-audit-sync-twice-"));
  try {
    const rolloutPath = path.join(tmp, "rollout-2026-07-26T06-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl");
    const queuePath = path.join(tmp, "queue.jsonl");
    const firstUsage = {
      input_tokens: 60,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 40,
      reasoning_output_tokens: 0,
      total_tokens: 100,
    };
    const secondUsage = {
      input_tokens: 90,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 60,
      reasoning_output_tokens: 0,
      total_tokens: 150,
    };
    const cumulative = {
      input_tokens: 150,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 100,
      reasoning_output_tokens: 0,
      total_tokens: 250,
    };
    fs.writeFileSync(rolloutPath, [
      tokenCountLine({ timestamp: "2026-07-26T06:00:00.000Z", last: firstUsage, total: firstUsage }),
      tokenCountLine({ timestamp: "2026-07-26T06:00:01.000Z", last: secondUsage, total: cumulative }),
    ].join("\n") + "\n", "utf8");
    const cursors = { files: {}, hourly: { version: 3, buckets: {}, groupQueued: {} } };

    const firstRun = await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath, source: "codex" });
    assert.equal(firstRun.eventsAggregated, 2);
    assert.equal(firstRun.bucketsQueued, 1);
    const firstQueue = fs.readFileSync(queuePath, "utf8");
    const firstSummary = await callSummary(queuePath);
    assert.equal(firstSummary.totals.total_tokens, 250);

    const secondRun = await parseRolloutIncremental({ rolloutFiles: [rolloutPath], cursors, queuePath, source: "codex" });
    assert.equal(secondRun.eventsAggregated, 0);
    assert.equal(secondRun.bucketsQueued, 0);
    assert.equal(fs.readFileSync(queuePath, "utf8"), firstQueue);
    assert.equal((await callSummary(queuePath)).totals.total_tokens, 250);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("README provider counts and product boundaries are registry-checked", () => {
  const manifest = require("../shared/provider-capabilities.json");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const collectors = manifest.providers.filter((provider) => provider.token_usage_collection).length;
  const officialRateLimits = manifest.providers.filter((provider) => provider.official_rate_limit).length;
  assert.match(readme, new RegExp(`provider-registry-count: ${manifest.providers.length}`));
  assert.match(readme, new RegExp(`token-collector-count: ${collectors}`));
  assert.match(readme, new RegExp(`official-rate-limit-count: ${officialRateLimits}`));
  assert.match(readme, new RegExp(`Rate-limit adapters[^\n]*${officialRateLimits} providers`));
  assert.match(readme, new RegExp(`Rate-limit tracking[^\n]*${officialRateLimits} registry-declared providers`));
  assert.doesNotMatch(readme, /Beautiful dashboard[^\n]*heatmap/);
  assert.doesNotMatch(readme, /dedups on a composite key/);
  for (const phrase of [
    "Currently visible",
    "MVP-hidden",
    "Optional cloud",
    "Legacy shells",
    "Network access",
    "Leaderboard",
  ]) {
    assert.ok(readme.includes(phrase), `README must explain: ${phrase}`);
  }
});