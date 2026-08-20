const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  createLocalApiHandler,
  clearRequestUsageRecordsListCacheForTests,
  computeRecordTotals,
} = require("../src/lib/local-api");

async function writeQueue(queuePath, rows) {
  await fs.promises.writeFile(
    queuePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

async function callEndpoint(queuePath, endpoint, configOverrides = {}) {
  const trackerDataDir = path.dirname(queuePath);
  await fs.promises.writeFile(
    path.join(trackerDataDir, "config.json"),
    JSON.stringify({
      dataDirectories: {
        claude: path.join(trackerDataDir, "claude"),
        codex: path.join(trackerDataDir, "codex"),
      },
      ...configOverrides,
    }),
  );
  const handler = createLocalApiHandler({ queuePath, trackerDataDir });
  return callEndpointWithHandler(handler, endpoint);
}

async function callEndpointWithHandler(handler, endpoint) {
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

function buildCodexTokenCountLine({ ts, usage }) {
  return JSON.stringify({
    type: "event_msg",
    timestamp: ts,
    payload: {
      type: "token_count",
      info: {
        last_token_usage: usage,
        total_token_usage: usage,
      },
    },
  });
}

const FIXED_DAY = "2026-07-06";
const FIXED_HOUR = `${FIXED_DAY}T12:00:00.000Z`;
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

test("request totals separate interrupted turns from provider failures", () => {
  const totals = computeRecordTotals([
    { record_kind: "request_event", status: 200 },
    { record_kind: "request_event", status: 499 },
    { record_kind: "request_event", status: 500 },
    { record_kind: "request_event", status: null },
  ]);

  assert.equal(totals.status_sample_count, 3);
  assert.equal(totals.success_count, 1);
  assert.equal(totals.interrupted_count, 1);
  assert.equal(totals.failure_count, 1);
  assert.equal(totals.success_rate, 50);
});

test("TICKET-06: queue-derived sources return explicit aggregate bucket records", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-aggregate-bucket-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow({ conversation_count: 3 })]);

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC`,
    );

    assert.ok(Array.isArray(body.records), "response should have records array");
    assert.equal(body.records.length, 1, "aggregate queue bucket should be represented as one record");
    assert.equal(body.records[0].record_kind, "aggregate_bucket");
    assert.equal(body.records[0].request_source, "queue_aggregate");
    assert.equal(body.records[0].source, "claude");
    assert.equal(body.records[0].total_tokens, 1700);
    assert.equal(body.records[0].conversation_count, 3);
    assert.ok(Array.isArray(body.aggregate_only_sources), "response should have aggregate_only_sources");
    assert.ok(body.aggregate_only_sources.includes("claude"), "aggregate_only_sources should include claude");
    assert.equal(body.availability.request_records, "aggregate_only", "request_records availability should be aggregate_only");
    assert.equal(body.availability.status, "unavailable", "status availability should be unavailable");
    assert.equal(body.availability.latency, "unavailable", "latency availability should be unavailable");
    assert.equal(body.totals.total_tokens, 1700);
    assert.equal(body.totals.request_count, 3, "aggregate bucket totals should use conversation_count as request display count");
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

    assert.equal(body.granularity, "aggregate_bucket", "response should have granularity=aggregate_bucket");
    assert.ok(body.page, "response should have page object");
    assert.equal(body.page.limit, 10, "page.limit should match request limit");
    assert.equal(body.page.returned_count, 1, "page.returned_count should include aggregate bucket");
    assert.equal(body.page.total_count, 1, "page.total_count should include aggregate bucket");
    assert.equal(body.page.totals_scope, "all_matching", "page.totals_scope should be all_matching");
    assert.ok(body.availability, "response should have availability object");
    assert.ok(["measured", "aggregate_only", "unavailable"].includes(body.availability.request_records));
    assert.ok(["measured", "aggregate_only", "unavailable"].includes(body.availability.status));
    assert.ok(["measured", "aggregate_only", "unavailable"].includes(body.availability.latency));
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-06: request usage records limit is capped at 1000", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-limit-cap-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow()]);

    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=claude&tz=UTC&limit=5000`,
    );

    assert.equal(body.page.limit, 1000, "page.limit should be capped at 1000");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("request usage records total count is capped at 1000 for codex logs", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-codex-limit-"));
  try {
    const trackerDataDir = path.join(tmp, "tracker");
    const queuePath = path.join(trackerDataDir, "queue.jsonl");
    const codexHome = path.join(tmp, ".codex");
    const sessionsDir = path.join(codexHome, "sessions", "2025", "12", "17");
    const configPath = path.join(trackerDataDir, "config.json");
    const rolloutPath = path.join(sessionsDir, "rollout-2025-12-17T00-00-00.jsonl");

    await fs.promises.mkdir(sessionsDir, { recursive: true });
    await fs.promises.mkdir(trackerDataDir, { recursive: true });
    await fs.promises.writeFile(queuePath, "", "utf8");
    await fs.promises.writeFile(
      configPath,
      JSON.stringify({ dataDirectories: { codex: codexHome } }, null, 2) + "\n",
      "utf8",
    );

    const usage = {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 5,
      reasoning_output_tokens: 0,
      total_tokens: 15,
    };
    const baseMs = Date.parse("2025-12-17T00:00:00.000Z");
    const lines = Array.from({ length: 1005 }, (_, i) => (
      buildCodexTokenCountLine({
        ts: new Date(baseMs + i * 1000).toISOString(),
        usage,
      })
    ));
    await fs.promises.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");

    const handler = createLocalApiHandler({ queuePath, trackerDataDir });
    const body = await callEndpointWithHandler(
      handler,
      "/functions/tokentracker-request-usage-records?from=2025-12-17&to=2025-12-17&sources=codex&tz=UTC&limit=5000&pageSize=10",
    );

    assert.equal(body.page.limit, 1000, "page.limit should be capped at 1000");
    assert.equal(body.page.total, 1000, "page.total should not expose more than 1000 records");
    assert.equal(body.page.total_count, 1000, "page.total_count should not expose more than 1000 records");
    assert.equal(body.records.length, 10, "default page should still return the requested page size");
    assert.equal(body.totals.request_count, 1000, "totals should be scoped to the capped record set");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("request usage records pagination reuses cached list across pages", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-records-page-cache-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const rows = Array.from({ length: 25 }, (_, i) => makeRow({
      hour_start: new Date(Date.parse(FIXED_HOUR) - i * 30 * 60 * 1000).toISOString(),
      model: `claude-sonnet-${i}`,
      total_tokens: 100 + i,
      input_tokens: 100 + i,
      output_tokens: 0,
    }));
    await writeQueue(queuePath, rows);
    clearRequestUsageRecordsListCacheForTests();

    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: path.dirname(queuePath),
    });
    const base = `/functions/tokentracker-request-usage-records?from=${FIXED_DAY}&to=${FIXED_DAY}&sources=claude&tz=UTC&limit=1000&pageSize=5`;

    const page1 = await callEndpointWithHandler(handler, `${base}&page=1`);
    const page2 = await callEndpointWithHandler(handler, `${base}&page=2`);

    assert.equal(page1.page.page, 1);
    assert.equal(page1.records.length, 5);
    assert.equal(page2.page.page, 2);
    assert.equal(page2.records.length, 5);
    assert.equal(page1.page.total, page2.page.total, "total count should match across pages");
    assert.notDeepEqual(
      page1.records.map((r) => r.id),
      page2.records.map((r) => r.id),
      "pages should return different records",
    );
  } finally {
    clearRequestUsageRecordsListCacheForTests();
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

test("pricing provenance API: user override fields survive from config to aggregate record and totals", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-pricing-override-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow({
      source: "custom-agent",
      model: "custom-model",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cached_input_tokens: 0,
      total_tokens: 2_000_000,
    })]);
    const updatedAt = "2026-01-01T00:00:00.000Z";
    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=custom-agent&tz=UTC`,
      {
        pricingRules: [{
          source: "custom-agent",
          model: "custom-model",
          inputPricePer1M: 1.5,
          outputPricePer1M: 10,
          currency: "USD",
          updated_at: updatedAt,
        }],
      },
    );

    const record = body.records[0];
    for (const field of [
      "pricing_source", "pricing_version", "source_kind", "source_url",
      "source_updated_at", "observed_at", "is_stale", "estimated",
      "match_kind", "matched_model", "note_code",
    ]) {
      assert.ok(Object.hasOwn(record, field), `record must expose ${field}`);
    }
    assert.equal(record.cost_usd, 11.5);
    assert.equal(record.source_kind, "user_override");
    assert.equal(record.source_updated_at, updatedAt);
    assert.equal(record.estimated, false);
    assert.equal(record.is_stale, false);
    assert.equal(body.totals.source_kind, "user_override");
  } finally {
    clearRequestUsageRecordsListCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("pricing provenance API: unpriced records and totals keep cost null instead of fake zero", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-pricing-unpriced-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [makeRow({
      source: "custom-agent",
      model: "definitely-unpriced-model-2099",
    })]);
    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=custom-agent&tz=UTC`,
    );

    assert.equal(body.records[0].cost_usd, null);
    assert.equal(body.records[0].source_kind, "unpriced");
    assert.equal(body.records[0].pricing_coverage, "unpriced");
    assert.equal(body.totals.cost_usd, null);
    assert.equal(body.totals.source_kind, "unpriced");
  } finally {
    clearRequestUsageRecordsListCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("pricing provenance API: mixed aggregates identify user override and curated composition", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-req-pricing-mixed-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [
      makeRow({
        source: "custom-agent",
        model: "custom-model",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        total_tokens: 2_000_000,
      }),
      makeRow({
        source: "custom-agent",
        model: "kiro-agent",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        total_tokens: 2_000_000,
      }),
    ]);
    const body = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records?from=${TODAY_STR}&to=${TODAY_STR}&sources=custom-agent&tz=UTC`,
      {
        pricingRules: [{
          source: "custom-agent",
          model: "custom-model",
          inputPricePer1M: 1.5,
          outputPricePer1M: 10,
          currency: "USD",
          updated_at: "2026-08-01T00:00:00.000Z",
        }],
      },
    );

    assert.equal(body.totals.source_kind, "mixed");
    assert.deepEqual(
      body.totals.pricing_components.map((component) => component.source_kind).sort(),
      ["curated", "user_override"],
    );
    assert.equal(
      body.totals.pricing_components.reduce(
        (sum, component) => sum + component.priced_tokens,
        0,
      ),
      4_000_000,
    );
  } finally {
    clearRequestUsageRecordsListCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
