const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

async function writeQueue(queuePath, rows) {
  await fs.promises.writeFile(
    queuePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

async function callEndpoint(queuePath, endpoint) {
  const handler = createLocalApiHandler({ queuePath });
  const url = new URL(`http://localhost${endpoint}`);
  const req = {
    method: "GET",
    url: url.pathname + url.search,
    headers: { host: "localhost" },
  };
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead() {},
    write(chunk) {
      chunks.push(chunk);
    },
    end(body) {
      if (body) chunks.push(body);
    },
  };
  const handled = await handler(req, res, url);
  assert.ok(handled, `endpoint must be handled: ${endpoint}`);
  return JSON.parse(chunks.join(""));
}

const NOW = new Date();
const TODAY_HOUR = NOW.toISOString().slice(0, 13) + ":00:00.000Z";
const TODAY_STR = NOW.toISOString().slice(0, 10);
const YESTERDAY = new Date(NOW);
YESTERDAY.setUTCDate(YESTERDAY.getUTCDate() - 1);
const YESTERDAY_HOUR = YESTERDAY.toISOString().slice(0, 13) + ":00:00.000Z";
const YESTERDAY_STR = YESTERDAY.toISOString().slice(0, 10);

function makeRow(overrides = {}) {
  return {
    hour_start: TODAY_HOUR,
    source: "claude",
    model: "claude-sonnet-4",
    input_tokens: 1000,
    output_tokens: 500,
    cached_input_tokens: 200,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 1700,
    conversation_count: 1,
    ...overrides,
  };
}

test("TICKET-06: queue-derived sources should NOT synthesize fake records", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-no-fake-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow()]);

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC`,
    );

    assert.ok(Array.isArray(body.records), "response should have records array");
    assert.equal(body.records.length, 0, "records should be empty for non-codex sources");
    assert.ok(Array.isArray(body.aggregate_only_sources), "response should have aggregate_only_sources");
    assert.ok(body.aggregate_only_sources.includes("claude"), "aggregate_only_sources should include claude");
    assert.equal(body.availability.request_records, "unavailable", "request_records availability should be unavailable");
    assert.equal(body.availability.status, "unavailable", "status availability should be unavailable");
    assert.equal(body.availability.latency, "unavailable", "latency availability should be unavailable");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-06: totals contain nullable success_count, success_rate, avg_latency_ms", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-totals-null-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow()]);

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC`,
    );

    const t = body.totals;
    assert.ok(t, "response should have totals");
    assert.equal(t.success_count, null, "success_count should be null for aggregate-only sources");
    assert.equal(t.success_rate, null, "success_rate should be null for aggregate-only sources");
    assert.equal(t.avg_latency_ms, null, "avg_latency_ms should be null for aggregate-only sources");
    assert.equal(t.status_sample_count, 0, "status_sample_count should be 0");
    assert.equal(t.latency_sample_count, 0, "latency_sample_count should be 0");
    assert.ok(["complete", "partial", "unpriced"].includes(t.pricing_coverage), "pricing_coverage should be valid");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-06: queue_baseline_totals still present for caliber consistency", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-baseline-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [
      makeRow({ hour_start: TODAY_HOUR, source: "claude", total_tokens: 1500, input_tokens: 1000, output_tokens: 500 }),
      makeRow({ hour_start: TODAY_HOUR, source: "gemini", total_tokens: 3000, input_tokens: 2000, output_tokens: 1000 }),
    ]);

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC`,
    );

    assert.ok(body.queue_baseline_totals, "response should have queue_baseline_totals");
    assert.equal(body.queue_baseline_totals.total_tokens, 1500, "queue_baseline_totals should count claude");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-06: response includes granularity, page, and availability fields", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-fields-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow()]);

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC&limit=10`,
    );

    assert.equal(body.granularity, "request_event", "response should have granularity=request_event");
    assert.ok(body.page, "response should have page object");
    assert.equal(body.page.limit, 10, "page.limit should match request limit");
    assert.equal(body.page.returned_count, 0, "page.returned_count should be 0 for non-codex");
    assert.equal(body.page.total_count, 0, "page.total_count should be 0 for non-codex");
    assert.equal(body.page.totals_scope, "all_matching", "page.totals_scope should be all_matching");
    assert.ok(body.availability, "response should have availability object");
    assert.ok(["measured", "aggregate_only", "unavailable"].includes(body.availability.request_records));
    assert.ok(["measured", "aggregate_only", "unavailable"].includes(body.availability.status));
    assert.ok(["measured", "aggregate_only", "unavailable"].includes(body.availability.latency));
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-06: empty queue.jsonl returns empty records with proper fields", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-empty-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await fs.promises.writeFile(queuePath, "");

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC`,
    );

    assert.ok(Array.isArray(body.records), "response should have records array");
    assert.equal(body.records.length, 0, "records should be empty");
    assert.equal(body.totals.total_tokens, 0, "totals.total_tokens should be 0");
    assert.equal(body.totals.request_count, 0, "totals.request_count should be 0");
    assert.equal(body.totals.success_count, null, "totals.success_count should be null");
    assert.equal(body.totals.success_rate, null, "totals.success_rate should be null");
    assert.equal(body.totals.avg_latency_ms, null, "totals.avg_latency_ms should be null");
    assert.ok(body.queue_baseline_totals, "queue_baseline_totals should still be present");
    assert.equal(body.queue_baseline_totals.total_tokens, 0, "queue_baseline_totals.total_tokens should be 0");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});