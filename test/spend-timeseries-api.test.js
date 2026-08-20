const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

function createRequest({ method = "GET", headers = {}, body = "" } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.headers = headers;
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

function readJsonResponse(res) {
  return JSON.parse(res.body.toString("utf8") || "{}");
}

async function call(handler, pathName, options) {
  const req = createRequest(options);
  const res = createResponse();
  const handled = await handler(req, res, new URL(`http://127.0.0.1:7680${pathName}`));
  assert.equal(handled, true);
  return res;
}

test("P02: timeseries returns series, totals, by_source, sources with default current month", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const result = await call(handler, "/functions/tokentracker-spend-timeseries", { method: "GET" });
    const body = readJsonResponse(result);

    assert.equal(result.statusCode, 200);
    assert.ok(body.from, "response should have from");
    assert.ok(body.to, "response should have to");
    assert.ok(body.bucket, "response should have bucket");
    assert.ok(body.timezone, "response should have timezone");
    assert.ok(body.currency, "response should have currency");
    assert.ok(Array.isArray(body.sources), "response should have sources array");
    assert.ok(body.totals, "response should have totals");
    assert.ok(Array.isArray(body.by_source), "response should have by_source array");
    assert.ok(Array.isArray(body.series), "response should have series array");

    assert.ok(body.totals.api_cost_usd !== undefined);
    assert.ok(body.totals.api_cost_cny !== undefined);
    assert.ok(body.totals.subscription_cost_usd !== undefined);
    assert.ok(body.totals.subscription_cost_cny !== undefined);
    assert.ok(body.totals.combined_usd !== undefined);
    assert.ok(body.totals.combined_cny !== undefined);

    for (const entry of body.by_source) {
      assert.ok(entry.source);
      assert.ok(entry.api_cost_usd !== undefined);
      assert.ok(entry.subscription_cost_usd !== undefined);
      assert.ok(entry.combined_usd !== undefined);
    }

    for (const entry of body.series) {
      assert.ok(entry.bucket_start);
      assert.ok(entry.bucket_end);
      assert.ok(entry.label);
      assert.ok(entry.source);
      assert.ok(entry.api_cost_usd !== undefined);
      assert.ok(entry.subscription_cost_usd !== undefined);
      assert.ok(entry.combined_usd !== undefined);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("P02: subscription cost allocation sums match spend-records totals", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    const thisMonth = new Date().toISOString().slice(0, 7) + "-01";

    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "claude", plan_label: "Max", amount: 30, currency: "USD",
        billing_cycle: "monthly", start_date: thisMonth, end_date: "",
      }),
    });

    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "openai", plan_label: "Plus", amount: 120, currency: "USD",
        billing_cycle: "yearly", start_date: thisMonth, end_date: "",
      }),
    });

    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "codex", plan_label: "OneTime", amount: 5, currency: "USD",
        billing_cycle: "one_time", start_date: thisMonth, end_date: "",
      }),
    });

    const spendResult = await call(handler, "/functions/tokentracker-spend-records", { method: "GET" });
    const spendBody = readJsonResponse(spendResult);

    const tsResult = await call(handler, "/functions/tokentracker-spend-timeseries", { method: "GET" });
    const tsBody = readJsonResponse(tsResult);

    const seriesSubUsdSum = tsBody.series.reduce((sum, s) => sum + s.subscription_cost_usd, 0);
    const bySourceSubUsdSum = tsBody.by_source.reduce((sum, s) => sum + s.subscription_cost_usd, 0);

    // Use rounding to avoid floating-point accumulation differences (e.g. 45.000000000000014).
    assert.equal(Math.round(seriesSubUsdSum * 1e6), Math.round(tsBody.totals.subscription_cost_usd * 1e6));
    assert.equal(Math.round(bySourceSubUsdSum * 1e6), Math.round(tsBody.totals.subscription_cost_usd * 1e6));
    assert.equal(Math.round(tsBody.totals.subscription_cost_usd * 1e6), Math.round(spendBody.totals.subscription_usd * 1e6));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("OTHER-AI: filtered timeseries includes manual cost with zero tokens", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-other-ai-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const create = (record) => call(handler, "/functions/tokentracker-spend-records", {
      method: "POST",
      headers,
      body: JSON.stringify(record),
    });

    await create({
      source: "other_ai",
      plan_label: "历史 AI 充值",
      amount: 12,
      currency: "USD",
      billing_cycle: "one_time",
      start_date: "2026-07-10",
      note: "",
    });
    await create({
      source: "claude",
      plan_label: "unrelated provider subscription",
      amount: 50,
      currency: "USD",
      billing_cycle: "one_time",
      start_date: "2026-07-10",
      note: "",
    });

    const result = await call(
      handler,
      "/functions/tokentracker-spend-timeseries?from=2026-07-01&to=2026-07-31&bucket=day&sources=other_ai",
      { method: "GET" },
    );
    const body = readJsonResponse(result);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(body.sources, ["other_ai"]);
    assert.deepEqual(body.by_source.map((entry) => entry.source), ["other_ai"]);
    assert.equal(body.totals.subscription_cost_usd, 0);
    assert.equal(body.totals.other_ai_cost_usd, 12);
    assert.equal(body.totals.combined_usd, 12);
    assert.equal(body.totals.input_tokens, 0);
    assert.equal(body.totals.output_tokens, 0);
    assert.equal(body.totals.cached_input_tokens, 0);
    assert.equal(body.totals.cache_creation_input_tokens, 0);
    assert.equal(body.totals.reasoning_output_tokens, 0);
    assert.equal(body.totals.total_tokens, 0);
    const seriesCost = body.series.reduce((sum, entry) => sum + entry.combined_usd, 0);
    assert.ok(Math.abs(seriesCost - 12) < 1e-10);
    assert.ok(body.series.every((entry) => entry.source === "other_ai"));
    assert.ok(body.series.every((entry) => entry.total_tokens === 0));
    assert.ok(body.series.every((entry) => entry.subscription_cost_usd === 0));
    const seriesOtherAiCost = body.series.reduce(
      (sum, entry) => sum + entry.other_ai_cost_usd,
      0,
    );
    assert.ok(Math.abs(seriesOtherAiCost - 12) < 1e-10);
    const chargedBuckets = body.series.filter((entry) => entry.other_ai_cost_usd > 0);
    assert.deepEqual(
      chargedBuckets.map((entry) => [entry.bucket_start, entry.other_ai_cost_usd]),
      [["2026-07-10", 12]],
      "a one-time charge must stay in its spend-date bucket",
    );
    assert.equal(body.by_source[0].subscription_cost_usd, 0);
    assert.equal(body.by_source[0].other_ai_cost_usd, 12);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("P02: API-only source appears in sources, series, by_source", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });

    const handler = createLocalApiHandler({
      queuePath: queueFile,
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ agentDefaultPricing: { codex: { inputUsdPer1M: 3, outputUsdPer1M: 15 } } }),
    });

    const now = new Date();
    const thisMonthHour = now.toISOString().slice(0, 13) + ":00:00.000Z";
    const queueEntries = [{
      hour_start: thisMonthHour,
      source: "codex",
      model: "other-agent",
      input_tokens: 1000000,
      output_tokens: 500000,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      total_tokens: 1500000,
      billing_mode: "api_key",
      provider_id: "deepseek",
    }, {
      hour_start: thisMonthHour,
      source: "codex",
      model: "kiro-agent",
      input_tokens: 10,
      output_tokens: 0,
      total_tokens: 10,
      billing_mode: "api_key",
      provider_id: "openai",
    }];
    await fs.writeFile(queueFile, `${queueEntries.map(JSON.stringify).join("\n")}\n`, "utf8");

    const thisMonth = new Date().toISOString().slice(0, 7) + "-01";
    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "claude", plan_label: "Max", amount: 10, currency: "USD",
        billing_cycle: "monthly", start_date: thisMonth, end_date: "",
      }),
    });

    const result = await call(handler, "/functions/tokentracker-spend-timeseries", { method: "GET" });
    const body = readJsonResponse(result);

    assert.ok(body.sources.includes("codex"), "codex should be in sources");
    assert.ok(body.sources.includes("claude"), "claude should be in sources");

    const codexBySource = body.by_source.find((s) => s.source === "codex");
    assert.ok(codexBySource, "codex should be in by_source");
    assert.equal(codexBySource.subscription_cost_usd, 0);
    assert.ok(codexBySource.api_cost_usd > 0);
    assert.ok(codexBySource.combined_usd > 0);
    assert.deepEqual(codexBySource.billing_mode_token_totals, {
      api_key: 1500010,
      token_plan: 0,
      unknown: 0,
    });
    assert.deepEqual(codexBySource.billing_provider_token_totals, [
      { provider_id: "deepseek", api_key: 1500000, token_plan: 0, unknown: 0 },
      { provider_id: "openai", api_key: 10, token_plan: 0, unknown: 0 },
    ]);

    const codexSeries = body.series.filter((s) => s.source === "codex");
    assert.ok(codexSeries.length > 0, "codex should have series entries");
    const codexApiSum = codexSeries.reduce((sum, s) => sum + s.api_cost_usd, 0);
    assert.ok(codexApiSum > 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("P02: timezone-adjusted queue row is counted in correct local date", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });

    const handler = createLocalApiHandler({
      queuePath: queueFile,
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ agentDefaultPricing: { codex: { inputUsdPer1M: 3, outputUsdPer1M: 15 } } }),
    });

    const queueEntry = JSON.stringify({
      hour_start: "2026-06-01T00:30:00.000Z",
      source: "codex",
      model: "gpt-5.2-codex",
      input_tokens: 1000000,
      output_tokens: 1000000,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 2000000,
      conversation_count: 1,
    }) + "\n";
    await fs.writeFile(queueFile, queueEntry, "utf8");

    const result = await call(
      handler,
      "/functions/tokentracker-spend-timeseries?from=2026-05-31&to=2026-05-31&tz_offset_minutes=-480",
      { method: "GET" },
    );
    const body = readJsonResponse(result);

    assert.equal(result.statusCode, 200, `Expected status 200, got ${result.statusCode}`);
    assert.ok(body.totals.api_cost_usd > 0, `api_cost_usd should be > 0 for TZ-adjusted row, got ${body.totals.api_cost_usd}`);
    assert.ok(body.sources.includes("codex"), "codex should be in sources");

    const codexBySource = body.by_source.find((s) => s.source === "codex");
    assert.ok(codexBySource, "codex should be in by_source");
    assert.ok(codexBySource.api_cost_usd > 0, "codex api_cost_usd should be > 0");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("P02: CNY subscription records use usdToCny conversion", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ currencySettings: { usdToCny: 6 } }),
    });

    const thisMonth = new Date().toISOString().slice(0, 7) + "-01";

    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "claude", plan_label: "Max", amount: 60, currency: "CNY",
        billing_cycle: "monthly", start_date: thisMonth, end_date: "",
      }),
    });

    const result = await call(handler, "/functions/tokentracker-spend-timeseries", { method: "GET" });
    const body = readJsonResponse(result);

    assert.equal(body.totals.subscription_cost_usd, 10);
    assert.equal(body.totals.subscription_cost_cny, 60);
    assert.equal(body.currency.usd_to_cny, 6);

    const claudeBySource = body.by_source.find((s) => s.source === "claude");
    assert.equal(claudeBySource.subscription_cost_usd, 10);
    assert.equal(claudeBySource.subscription_cost_cny, 60);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("P02: bucket limit exceeded returns 400", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const hourResult = await call(
      handler,
      "/functions/tokentracker-spend-timeseries?from=2026-01-01&to=2026-02-15&bucket=hour",
      { method: "GET" },
    );
    const hourBody = readJsonResponse(hourResult);
    assert.equal(hourResult.statusCode, 400);
    assert.equal(hourBody.ok, false);
    assert.equal(hourBody.error, "spend timeseries range is too large for requested bucket");

    const dayResult = await call(
      handler,
      "/functions/tokentracker-spend-timeseries?from=2025-01-01&to=2026-01-15&bucket=day",
      { method: "GET" },
    );
    const dayBody = readJsonResponse(dayResult);
    assert.equal(dayResult.statusCode, 400);
    assert.equal(dayBody.ok, false);
    assert.equal(dayBody.error, "spend timeseries range is too large for requested bucket");

    const validDayResult = await call(
      handler,
      "/functions/tokentracker-spend-timeseries?from=2026-01-01&to=2026-01-02&bucket=day",
      { method: "GET" },
    );
    assert.equal(validDayResult.statusCode, 200);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("P02: total range clamps to the earliest real ledger bucket instead of 1970", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(queueFile, `${JSON.stringify({
      source: "claude",
      model: "claude-sonnet",
      hour_start: "2026-02-14T08:00:00.000Z",
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      conversation_count: 1,
    })}\n`);
    const handler = createLocalApiHandler({
      queuePath: queueFile,
      trackerDataDir: trackerDir,
    });

    const result = await call(
      handler,
      "/functions/tokentracker-spend-timeseries?from=1970-01-01&to=2026-07-29",
      { method: "GET" },
    );
    const body = readJsonResponse(result);

    assert.equal(result.statusCode, 200);
    assert.equal(body.from, "2026-02-14");
    assert.equal(body.to, "2026-07-29");
    assert.equal(body.bucket, "week");
    assert.equal(body.totals.total_tokens, 120);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("P02: auto bucket selection", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const sameDay = await call(
      handler,
      "/functions/tokentracker-spend-timeseries?from=2026-06-15&to=2026-06-15",
      { method: "GET" },
    );
    const sameDayBody = readJsonResponse(sameDay);
    assert.equal(sameDayBody.bucket, "hour");

    const twoDays = await call(
      handler,
      "/functions/tokentracker-spend-timeseries?from=2026-06-15&to=2026-06-16",
      { method: "GET" },
    );
    const twoDaysBody = readJsonResponse(twoDays);
    assert.equal(twoDaysBody.bucket, "day");

    const oneHundredDays = await call(
      handler,
      "/functions/tokentracker-spend-timeseries?from=2026-01-01&to=2026-04-10",
      { method: "GET" },
    );
    const oneHundredDaysBody = readJsonResponse(oneHundredDays);
    assert.equal(oneHundredDaysBody.bucket, "day");

    const oneHundredTwentyOneDays = await call(
      handler,
      "/functions/tokentracker-spend-timeseries?from=2026-01-01&to=2026-05-02",
      { method: "GET" },
    );
    const oneHundredTwentyOneDaysBody = readJsonResponse(oneHundredTwentyOneDays);
    assert.equal(oneHundredTwentyOneDaysBody.bucket, "week");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("P02: each source in each bucket has a row (including zero cost)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });

    const handler = createLocalApiHandler({
      queuePath: queueFile,
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ agentDefaultPricing: { codex: { inputUsdPer1M: 3, outputUsdPer1M: 15 } } }),
    });

    const now = new Date();
    const todayHour = now.toISOString().slice(0, 13) + ":00:00.000Z";
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayHour = yesterday.toISOString().slice(0, 13) + ":00:00.000Z";

    const queueEntries = [
      JSON.stringify({
        hour_start: todayHour,
        source: "codex",
        model: "kiro-agent",
        input_tokens: 1000000,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        total_tokens: 1000000,
      }),
      JSON.stringify({
        hour_start: yesterdayHour,
        source: "codex",
        model: "kiro-agent",
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        total_tokens: 0,
      }),
    ].join("\n") + "\n";
    await fs.writeFile(queueFile, queueEntries, "utf8");

    const thisMonth = new Date().toISOString().slice(0, 7) + "-01";
    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "claude", plan_label: "Max", amount: 10, currency: "USD",
        billing_cycle: "monthly", start_date: thisMonth, end_date: "",
      }),
    });

    const result = await call(
      handler,
      `/functions/tokentracker-spend-timeseries?from=${yesterday.toISOString().slice(0, 10)}&to=${now.toISOString().slice(0, 10)}&bucket=day`,
      { method: "GET" },
    );
    const body = readJsonResponse(result);

    const sources = body.sources.sort();
    assert.deepEqual(sources, ["claude", "codex"]);

    const buckets = [...new Set(body.series.map((s) => s.bucket_start))].sort();
    assert.equal(buckets.length, 2);

    for (const source of sources) {
      for (const bucketStart of buckets) {
        const entry = body.series.find((s) => s.source === source && s.bucket_start === bucketStart);
        assert.ok(entry, `${source} should have row for bucket ${bucketStart}`);
        assert.ok(entry.api_cost_usd !== undefined);
        assert.ok(entry.subscription_cost_usd !== undefined);
      }
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("P02: sum(series.combined_usd) equals totals.combined_usd", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });

    const handler = createLocalApiHandler({
      queuePath: queueFile,
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ agentDefaultPricing: { codex: { inputUsdPer1M: 3, outputUsdPer1M: 15 } } }),
    });

    const now = new Date();
    const thisMonthHour = now.toISOString().slice(0, 13) + ":00:00.000Z";
    const queueEntry = JSON.stringify({
      hour_start: thisMonthHour,
      source: "codex",
      model: "kiro-agent",
      input_tokens: 1000000,
      output_tokens: 500000,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      total_tokens: 1500000,
    }) + "\n";
    await fs.writeFile(queueFile, queueEntry, "utf8");

    const thisMonth = new Date().toISOString().slice(0, 7) + "-01";
    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "claude", plan_label: "Max", amount: 10, currency: "USD",
        billing_cycle: "monthly", start_date: thisMonth, end_date: "",
      }),
    });

    const result = await call(handler, "/functions/tokentracker-spend-timeseries", { method: "GET" });
    const body = readJsonResponse(result);

    const seriesCombinedUsdSum = body.series.reduce((sum, s) => sum + s.combined_usd, 0);
    const bySourceCombinedUsdSum = body.by_source.reduce((sum, s) => sum + s.combined_usd, 0);

    assert.ok(Math.abs(seriesCombinedUsdSum - body.totals.combined_usd) < 1e-10,
      `series combined_usd sum ${seriesCombinedUsdSum} != totals combined_usd ${body.totals.combined_usd}`);
    assert.ok(Math.abs(bySourceCombinedUsdSum - body.totals.combined_usd) < 1e-10,
      `by_source combined_usd sum ${bySourceCombinedUsdSum} != totals combined_usd ${body.totals.combined_usd}`);

    const seriesApiSum = body.series.reduce((sum, s) => sum + s.api_cost_usd, 0);
    const seriesSubSum = body.series.reduce((sum, s) => sum + s.subscription_cost_usd, 0);
    assert.ok(Math.abs(seriesApiSum + seriesSubSum - body.totals.combined_usd) < 1e-10,
      `series api+sub sum ${seriesApiSum + seriesSubSum} != totals combined_usd ${body.totals.combined_usd}`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-01: series entry contains 5-dimension token fields + cost_usd + models[]", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });

    const handler = createLocalApiHandler({
      queuePath: queueFile,
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ agentDefaultPricing: { codex: { inputUsdPer1M: 3, outputUsdPer1M: 15 } } }),
    });

    const now = new Date();
    const todayHour = now.toISOString().slice(0, 13) + ":00:00.000Z";
    const todayStr = now.toISOString().slice(0, 10);
    const queueEntry = JSON.stringify({
      hour_start: todayHour,
      source: "codex",
      model: "gpt-5-codex",
      input_tokens: 1000,
      output_tokens: 500,
      cached_input_tokens: 200,
      cache_creation_input_tokens: 50,
      reasoning_output_tokens: 100,
      total_tokens: 1850,
    }) + "\n";
    await fs.writeFile(queueFile, queueEntry, "utf8");

    const result = await call(
      handler,
      `/functions/tokentracker-spend-timeseries?from=${todayStr}&to=${todayStr}&bucket=day`,
      { method: "GET" },
    );
    const body = readJsonResponse(result);

    assert.ok(body.series.length > 0, "series should have at least one entry");
    const entry = body.series[0];
    assert.ok(entry.input_tokens !== undefined, "series entry should have input_tokens");
    assert.ok(entry.output_tokens !== undefined, "series entry should have output_tokens");
    assert.ok(entry.cached_input_tokens !== undefined, "series entry should have cached_input_tokens");
    assert.ok(entry.cache_creation_input_tokens !== undefined, "series entry should have cache_creation_input_tokens");
    assert.ok(entry.reasoning_output_tokens !== undefined, "series entry should have reasoning_output_tokens");
    assert.ok(entry.total_tokens !== undefined, "series entry should have total_tokens");
    assert.ok(entry.cost_usd !== undefined, "series entry should have cost_usd");
    assert.equal(entry.input_tokens, 1000);
    assert.equal(entry.output_tokens, 500);
    assert.equal(entry.cached_input_tokens, 200);
    assert.equal(entry.cache_creation_input_tokens, 50);
    assert.equal(entry.reasoning_output_tokens, 100);
    assert.equal(entry.total_tokens, 1850);
    assert.ok(entry.cost_usd > 0, "cost_usd should be positive with pricing set");

    assert.ok(Array.isArray(entry.models), "series entry should have models array");
    assert.ok(entry.models.length > 0, "models array should have at least one entry");
    const modelEntry = entry.models[0];
    assert.ok(modelEntry.model, "model entry should have model name");
    assert.ok(modelEntry.input_tokens !== undefined, "model entry should have input_tokens");
    assert.ok(modelEntry.output_tokens !== undefined, "model entry should have output_tokens");
    assert.ok(modelEntry.total_tokens !== undefined, "model entry should have total_tokens");
    assert.ok(modelEntry.cost_usd !== undefined, "model entry should have cost_usd");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-01: sources=codex,claude filters series + by_source + totals", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });

    const handler = createLocalApiHandler({
      queuePath: queueFile,
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({
        agentDefaultPricing: {
          codex: { inputUsdPer1M: 3, outputUsdPer1M: 15 },
          claude: { inputUsdPer1M: 3, outputUsdPer1M: 15 },
          gemini: { inputUsdPer1M: 3, outputUsdPer1M: 15 },
        },
      }),
    });

    const now = new Date();
    const todayHour = now.toISOString().slice(0, 13) + ":00:00.000Z";
    const todayStr = now.toISOString().slice(0, 10);
    const queueEntries = [
      JSON.stringify({
        hour_start: todayHour, source: "codex", model: "gpt-5-codex",
        input_tokens: 1000, output_tokens: 0, cached_input_tokens: 0,
        cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1000,
      }),
      JSON.stringify({
        hour_start: todayHour, source: "claude", model: "claude-sonnet-4",
        input_tokens: 2000, output_tokens: 0, cached_input_tokens: 0,
        cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 2000,
      }),
      JSON.stringify({
        hour_start: todayHour, source: "gemini", model: "gemini-pro",
        input_tokens: 4000, output_tokens: 0, cached_input_tokens: 0,
        cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 4000,
      }),
    ].join("\n") + "\n";
    await fs.writeFile(queueFile, queueEntries, "utf8");

    const result = await call(
      handler,
      `/functions/tokentracker-spend-timeseries?from=${todayStr}&to=${todayStr}&bucket=day&sources=codex,claude`,
      { method: "GET" },
    );
    const body = readJsonResponse(result);

    const sources = body.sources.sort();
    assert.deepEqual(sources, ["claude", "codex"]);

    const seriesSources = [...new Set(body.series.map((s) => s.source))].sort();
    assert.deepEqual(seriesSources, ["claude", "codex"]);

    const bySourceSources = body.by_source.map((s) => s.source).sort();
    assert.deepEqual(bySourceSources, ["claude", "codex"]);

    assert.equal(body.totals.total_tokens, 3000);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-01: models=<name> filters by model name (case-insensitive)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });

    const handler = createLocalApiHandler({
      queuePath: queueFile,
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ agentDefaultPricing: { codex: { inputUsdPer1M: 3, outputUsdPer1M: 15 } } }),
    });

    const now = new Date();
    const todayHour = now.toISOString().slice(0, 13) + ":00:00.000Z";
    const todayStr = now.toISOString().slice(0, 10);
    const queueEntries = [
      JSON.stringify({
        hour_start: todayHour, source: "codex", model: "gpt-4o",
        input_tokens: 1000, output_tokens: 0, cached_input_tokens: 0,
        cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1000,
      }),
      JSON.stringify({
        hour_start: todayHour, source: "codex", model: "claude-3.5",
        input_tokens: 2000, output_tokens: 0, cached_input_tokens: 0,
        cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 2000,
      }),
    ].join("\n") + "\n";
    await fs.writeFile(queueFile, queueEntries, "utf8");

    const result = await call(
      handler,
      `/functions/tokentracker-spend-timeseries?from=${todayStr}&to=${todayStr}&bucket=day&models=GPT-4O`,
      { method: "GET" },
    );
    const body = readJsonResponse(result);

    for (const entry of body.series) {
      for (const m of entry.models) {
        assert.equal(
          m.model.toLowerCase(),
          "gpt-4o",
          `expected only gpt-4o model, got ${m.model}`,
        );
      }
    }
    assert.equal(body.totals.total_tokens, 1000);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-01: agent_ids=codex equivalent to sources=codex", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-timeseries-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });

    const handler = createLocalApiHandler({
      queuePath: queueFile,
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ agentDefaultPricing: { codex: { inputUsdPer1M: 3, outputUsdPer1M: 15 } } }),
    });

    const now = new Date();
    const todayHour = now.toISOString().slice(0, 13) + ":00:00.000Z";
    const todayStr = now.toISOString().slice(0, 10);
    const queueEntries = [
      JSON.stringify({
        hour_start: todayHour, source: "codex", model: "gpt-5-codex",
        input_tokens: 1500, output_tokens: 0, cached_input_tokens: 0,
        cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1500,
      }),
      JSON.stringify({
        hour_start: todayHour, source: "claude", model: "claude-sonnet-4",
        input_tokens: 5000, output_tokens: 0, cached_input_tokens: 0,
        cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 5000,
      }),
    ].join("\n") + "\n";
    await fs.writeFile(queueFile, queueEntries, "utf8");

    const result = await call(
      handler,
      `/functions/tokentracker-spend-timeseries?from=${todayStr}&to=${todayStr}&bucket=day&agent_ids=codex`,
      { method: "GET" },
    );
    const body = readJsonResponse(result);

    assert.ok(
      body.sources.includes("codex"),
      `sources should include codex via agent_ids mapping, got ${JSON.stringify(body.sources)}`,
    );
    assert.equal(body.totals.total_tokens, 1500);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("TICKET-01: empty queue returns empty series array + zero totals (A1 空值处理)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-ts-empty-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });
    // Empty queue file — no rows at all.
    await fs.writeFile(queueFile, "", "utf8");

    const handler = createLocalApiHandler({
      queuePath: queueFile,
      trackerDataDir: trackerDir,
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const result = await call(
      handler,
      `/functions/tokentracker-spend-timeseries?from=${todayStr}&to=${todayStr}&bucket=day`,
      { method: "GET" },
    );
    const body = readJsonResponse(result);

    // 工单 A1 §3: 空值处理 — 没有数据的时间桶返回0。这里验证完全无数据时
    // series 是数组（可能为空或含零值行），totals 全为零，且不抛错。
    assert.equal(result.statusCode, 200);
    assert.ok(Array.isArray(body.series), "series should be an array even when queue is empty");
    assert.ok(body.totals, "totals should still be present on empty data");
    assert.equal(body.totals.total_tokens, 0, "totals.total_tokens should be 0 on empty data");
    assert.equal(Number(body.totals.cost_usd), 0, "totals.cost_usd should be 0 on empty data");
    assert.ok(Array.isArray(body.sources), "sources should be an array even when empty");
    assert.ok(Array.isArray(body.by_source), "by_source should be an array even when empty");

    // Every series entry (if any) must have zero tokens — no phantom data.
    for (const entry of body.series) {
      assert.equal(entry.total_tokens, 0, `series entry ${entry.bucket_start} should have 0 tokens on empty data`);
      assert.equal(Number(entry.cost_usd), 0, `series entry ${entry.bucket_start} should have 0 cost on empty data`);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("pricing provenance timeseries: totals expose mixed user-override and curated composition", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-ts-pricing-mixed-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });
    const handler = createLocalApiHandler({ queuePath: queueFile, trackerDataDir: trackerDir });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        pricingRules: [{
          source: "custom-agent",
          model: "custom-model",
          inputPricePer1M: 1.5,
          outputPricePer1M: 10,
          currency: "USD",
          updated_at: "2026-07-08T00:00:00.000Z",
        }],
      }),
    });
    const now = new Date();
    const todayHour = `${now.toISOString().slice(0, 13)}:00:00.000Z`;
    const todayStr = now.toISOString().slice(0, 10);
    await fs.writeFile(queueFile, [
      JSON.stringify({
        hour_start: todayHour,
        source: "custom-agent",
        model: "custom-model",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        total_tokens: 2_000_000,
      }),
      JSON.stringify({
        hour_start: todayHour,
        source: "custom-agent",
        model: "kiro-agent",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        total_tokens: 2_000_000,
      }),
    ].join("\n") + "\n", "utf8");

    const response = await call(
      handler,
      `/functions/tokentracker-spend-timeseries?from=${todayStr}&to=${todayStr}&bucket=day&sources=custom-agent`,
      { method: "GET" },
    );
    const body = readJsonResponse(response);

    assert.equal(body.totals.source_kind, "mixed");
    assert.equal(body.totals.pricing_source, "mixed");
    assert.deepEqual(
      body.totals.pricing_components.map((component) => component.source_kind).sort(),
      ["curated", "user_override"],
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("pricing provenance timeseries: an entirely unpriced API total remains null", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-ts-pricing-null-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });
    const today = new Date().toISOString();
    await fs.writeFile(queueFile, `${JSON.stringify({
      hour_start: `${today.slice(0, 13)}:00:00.000Z`,
      source: "custom-agent",
      model: "definitely-unpriced-model-2099",
      input_tokens: 1_000,
      output_tokens: 500,
      total_tokens: 1_500,
    })}\n`, "utf8");
    const handler = createLocalApiHandler({ queuePath: queueFile, trackerDataDir: trackerDir });
    const day = today.slice(0, 10);
    const response = await call(
      handler,
      `/functions/tokentracker-spend-timeseries?from=${day}&to=${day}&bucket=day&sources=custom-agent`,
      { method: "GET" },
    );
    const body = readJsonResponse(response);

    assert.equal(body.totals.api_usd, null);
    assert.equal(body.totals.cost_usd, null);
    assert.equal(body.totals.source_kind, "unpriced");
    assert.equal(body.totals.pricing_coverage, "unpriced");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
