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

const CONSISTENCY_ROWS = [
  {
    source: "claude",
    model: "claude-sonnet-4-6",
    hour_start: "2026-05-09T10:00:00.000Z",
    input_tokens: 100,
    cached_input_tokens: 200,
    cache_creation_input_tokens: 0,
    output_tokens: 50,
    reasoning_output_tokens: 0,
    total_tokens: 350,
    conversation_count: 2,
  },
  {
    source: "claude",
    model: "claude-sonnet-4-6",
    hour_start: "2026-05-09T10:30:00.000Z",
    input_tokens: 10,
    cached_input_tokens: 20,
    cache_creation_input_tokens: 0,
    output_tokens: 5,
    reasoning_output_tokens: 0,
    total_tokens: 35,
    conversation_count: 1,
  },
  {
    source: "gemini",
    model: "gemini-2.5-pro",
    hour_start: "2026-05-09T11:00:00.000Z",
    input_tokens: 1000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 500,
    reasoning_output_tokens: 0,
    total_tokens: 1500,
    conversation_count: 3,
  },
];

const CALIBER_TOLERANCE = 1e-6;

test("three-caliber consistency: usage-summary === spend-timeseries totals === provider-stats totals (non-codex)", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC";

    const summary = await callEndpoint(
      queuePath,
      `/functions/tokentracker-usage-summary${qs}`,
    );
    const timeseries = await callEndpoint(
      queuePath,
      `/functions/tokentracker-spend-timeseries${qs}`,
    );
    const providerStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-provider-stats${qs}`,
    );
    const modelStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-model-stats${qs}`,
    );

    // total_tokens must be identical across all four endpoints
    const summaryTokens = summary.totals.total_tokens;
    const tsTokens = timeseries.totals.total_tokens;
    const psTokens = providerStats.totals.total_tokens;
    const msTokens = modelStats.totals.total_tokens;

    assert.equal(
      summaryTokens,
      tsTokens,
      `usage-summary(${summaryTokens}) !== spend-timeseries(${tsTokens})`,
    );
    assert.equal(
      summaryTokens,
      psTokens,
      `usage-summary(${summaryTokens}) !== provider-stats(${psTokens})`,
    );
    assert.equal(
      summaryTokens,
      msTokens,
      `usage-summary(${summaryTokens}) !== model-stats(${msTokens})`,
    );

    // Expected: 350 + 35 + 1500 = 1885
    assert.equal(summaryTokens, 1885);

    // cost_usd must also match (within tolerance for float rounding)
    const summaryCost = Number(summary.totals.cost_usd);
    const tsCost = Number(timeseries.totals.cost_usd);
    const psCost = Number(providerStats.totals.cost_usd);
    const msCost = Number(modelStats.totals.cost_usd);

    assert.ok(
      Math.abs(summaryCost - tsCost) < CALIBER_TOLERANCE,
      `cost_usd: usage-summary(${summaryCost}) !== spend-timeseries(${tsCost})`,
    );
    assert.ok(
      Math.abs(summaryCost - psCost) < CALIBER_TOLERANCE,
      `cost_usd: usage-summary(${summaryCost}) !== provider-stats(${psCost})`,
    );
    assert.ok(
      Math.abs(summaryCost - msCost) < CALIBER_TOLERANCE,
      `cost_usd: usage-summary(${summaryCost}) !== model-stats(${msCost})`,
    );

    // conversation_count consistency
    assert.equal(summary.totals.conversation_count, 6);
    assert.equal(providerStats.totals.conversation_count, 6);
    assert.equal(modelStats.totals.conversation_count, 6);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("three-caliber consistency: filtered by sources param", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-filter-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC&sources=claude";

    const summary = await callEndpoint(
      queuePath,
      `/functions/tokentracker-usage-summary${qs}`,
    );
    const timeseries = await callEndpoint(
      queuePath,
      `/functions/tokentracker-spend-timeseries${qs}`,
    );
    const providerStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-provider-stats${qs}`,
    );
    const modelStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-model-stats${qs}`,
    );

    // Filtered to claude only: 350 + 35 = 385 tokens
    assert.equal(summary.totals.total_tokens, 385);
    assert.equal(timeseries.totals.total_tokens, 385);
    assert.equal(providerStats.totals.total_tokens, 385);
    assert.equal(modelStats.totals.total_tokens, 385);

    // cost_usd consistency
    const sCost = Number(summary.totals.cost_usd);
    const tCost = Number(timeseries.totals.cost_usd);
    const pCost = Number(providerStats.totals.cost_usd);
    const mCost = Number(modelStats.totals.cost_usd);
    assert.ok(Math.abs(sCost - tCost) < CALIBER_TOLERANCE);
    assert.ok(Math.abs(sCost - pCost) < CALIBER_TOLERANCE);
    assert.ok(Math.abs(sCost - mCost) < CALIBER_TOLERANCE);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("three-caliber consistency: filtered by models param", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-model-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC&models=gemini-2.5-pro";

    const summary = await callEndpoint(
      queuePath,
      `/functions/tokentracker-usage-summary${qs}`,
    );
    const timeseries = await callEndpoint(
      queuePath,
      `/functions/tokentracker-spend-timeseries${qs}`,
    );
    const providerStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-provider-stats${qs}`,
    );
    const modelStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-model-stats${qs}`,
    );

    // Filtered to gemini-2.5-pro only: 1500 tokens
    assert.equal(summary.totals.total_tokens, 1500);
    assert.equal(timeseries.totals.total_tokens, 1500);
    assert.equal(providerStats.totals.total_tokens, 1500);
    assert.equal(modelStats.totals.total_tokens, 1500);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("three-caliber consistency: empty data returns zeros across all endpoints", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-empty-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, []);
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC";

    const summary = await callEndpoint(
      queuePath,
      `/functions/tokentracker-usage-summary${qs}`,
    );
    const timeseries = await callEndpoint(
      queuePath,
      `/functions/tokentracker-spend-timeseries${qs}`,
    );
    const providerStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-provider-stats${qs}`,
    );
    const modelStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-model-stats${qs}`,
    );

    assert.equal(summary.totals.total_tokens, 0);
    assert.equal(timeseries.totals.total_tokens, 0);
    assert.equal(providerStats.totals.total_tokens, 0);
    assert.equal(modelStats.totals.total_tokens, 0);

    assert.equal(Number(summary.totals.cost_usd), 0);
    assert.equal(Number(timeseries.totals.cost_usd), 0);
    assert.equal(Number(providerStats.totals.cost_usd), 0);
    assert.equal(Number(modelStats.totals.cost_usd), 0);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("three-caliber consistency: provider-stats sum of providers === totals", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-sum-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC";

    const providerStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-provider-stats${qs}`,
    );
    const modelStats = await callEndpoint(
      queuePath,
      `/functions/tokentracker-model-stats${qs}`,
    );

    // Sum of provider tokens === totals.total_tokens
    const psSum = providerStats.providers.reduce((a, p) => a + p.tokens, 0);
    assert.equal(psSum, providerStats.totals.total_tokens);

    // Sum of model tokens === totals.total_tokens
    const msSum = modelStats.models.reduce((a, m) => a + m.tokens, 0);
    assert.equal(msSum, modelStats.totals.total_tokens);

    // Both sums equal the same value
    assert.equal(psSum, msSum);
    assert.equal(psSum, 1885);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("three-caliber consistency: request-usage-records queue_baseline_totals matches usage-summary (non-codex)", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-records-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC&sources=claude";

    const summary = await callEndpoint(
      queuePath,
      `/functions/tokentracker-usage-summary${qs}`,
    );
    const records = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records${qs}`,
    );

    // For non-codex sources, request-usage-records synthesizes records from
    // queue.jsonl. The `queue_baseline_totals` field must match usage-summary
    // totals (both come from computeQueueTotals over the same rows + filters).
    assert.ok(records.queue_baseline_totals, "queue_baseline_totals should exist");

    assert.equal(
      records.queue_baseline_totals.total_tokens,
      summary.totals.total_tokens,
      "queue_baseline_totals.total_tokens must match usage-summary",
    );
    assert.ok(
      Math.abs(
        Number(records.queue_baseline_totals.cost_usd) - Number(summary.totals.cost_usd),
      ) < CALIBER_TOLERANCE,
      "queue_baseline_totals.cost_usd must match usage-summary",
    );
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("three-caliber consistency: request-usage-records totals in main chain (TICKET-06 truthful metrics)", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-caliber-records-totals-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, CONSISTENCY_ROWS);
    // sources=claude,gemini avoids the codex rollout branch.
    // TICKET-06: Non-codex sources no longer synthesize fake request records,
    // so records.totals will be 0 while queue_baseline_totals preserves
    // the three-way consistency baseline.
    const qs = "?from=2026-05-09&to=2026-05-09&tz=UTC&sources=claude,gemini";

    const summary = await callEndpoint(
      queuePath,
      `/functions/tokentracker-usage-summary${qs}`,
    );
    const records = await callEndpoint(
      queuePath,
      `/functions/tokentracker-request-usage-records${qs}`,
    );

    // TICKET-06: Non-codex sources return empty records array, so
    // records.totals should reflect the absence of request-level data.
    assert.equal(records.totals.total_tokens, 0,
      "request-usage-records totals.total_tokens should be 0 for non-codex (no request-level records)");
    assert.equal(records.totals.request_count, 0,
      "request-usage-records totals.request_count should be 0 for non-codex");
    assert.equal(records.totals.success_count, null,
      "request-usage-records totals.success_count should be null for non-codex");
    assert.equal(records.totals.success_rate, null,
      "request-usage-records totals.success_rate should be null for non-codex");
    assert.equal(records.totals.avg_latency_ms, null,
      "request-usage-records totals.avg_latency_ms should be null for non-codex");

    // Expected: 350 + 35 + 1500 = 1885 (from usage-summary)
    assert.equal(summary.totals.total_tokens, 1885);

    // queue_baseline_totals (computeQueueTotals path) must match usage-summary —
    // this is the explicit three-way consistency baseline for non-codex sources.
    assert.equal(
      records.queue_baseline_totals.total_tokens,
      summary.totals.total_tokens,
      "queue_baseline_totals.total_tokens must match usage-summary",
    );
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
