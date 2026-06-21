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

test("G04: spend records API POST/GET/PUT/DELETE full CRUD", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-spend-"));
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

    // POST: create record with full fields
    const created = await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "claude",
        plan_label: "Max",
        amount: 20,
        currency: "USD",
        billing_cycle: "monthly",
        start_date: "2026-06-01",
        end_date: "",
        note: "test record",
      }),
    });
    const createdBody = readJsonResponse(created);
    assert.equal(createdBody.ok, true);
    assert.equal(createdBody.record.source, "claude");
    assert.equal(createdBody.record.plan_label, "Max");
    assert.equal(createdBody.record.amount, 20);
    assert.equal(createdBody.record.currency, "USD");
    assert.equal(createdBody.record.billing_cycle, "monthly");
    assert.equal(createdBody.record.start_date, "2026-06-01");
    assert.equal(createdBody.record.end_date, "");
    assert.equal(createdBody.record.note, "test record");
    assert.ok(createdBody.record.id);
    assert.ok(createdBody.record.created_at);
    assert.ok(createdBody.record.updated_at);
    const recordId = createdBody.record.id;

    // GET: list includes the record
    const list = await call(handler, "/functions/tokentracker-spend-records", { method: "GET" });
    const listBody = readJsonResponse(list);
    assert.equal(listBody.records.length, 1);
    assert.equal(listBody.records[0].id, recordId);

    // GET: response includes totals and by_source
    assert.ok(listBody.totals);
    assert.ok(listBody.totals.subscription_usd !== undefined);
    assert.ok(listBody.totals.subscription_cny !== undefined);
    assert.ok(listBody.totals.api_usd !== undefined);
    assert.ok(listBody.totals.api_cny !== undefined);
    assert.ok(listBody.totals.combined_usd !== undefined);
    assert.ok(listBody.totals.combined_cny !== undefined);
    assert.ok(listBody.totals.lifetime_subscription_usd !== undefined);
    assert.ok(listBody.totals.lifetime_combined_usd !== undefined);
    // Legacy backward-compat
    assert.ok(listBody.totals.total_usd !== undefined);
    assert.ok(listBody.totals.total_cny !== undefined);
    assert.equal(listBody.totals.total_usd, listBody.totals.combined_usd);
    assert.equal(listBody.totals.total_cny, listBody.totals.combined_cny);
    assert.ok(Array.isArray(listBody.by_source));

    // PUT: update the record
    const updated = await call(handler, "/functions/tokentracker-spend-records", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        id: recordId,
        source: "claude",
        plan_label: "Max",
        amount: 30,
        currency: "USD",
        billing_cycle: "yearly",
        start_date: "2026-01-01",
        end_date: "",
        note: "updated record",
      }),
    });
    const updatedBody = readJsonResponse(updated);
    assert.equal(updatedBody.ok, true);
    assert.equal(updatedBody.record.amount, 30);
    assert.equal(updatedBody.record.billing_cycle, "yearly");
    assert.equal(updatedBody.record.start_date, "2026-01-01");
    assert.equal(updatedBody.record.note, "updated record");
    assert.equal(updatedBody.record.id, recordId);

    // PUT: update non-existent record returns 404
    const badUpdate = await call(handler, "/functions/tokentracker-spend-records", {
      method: "PUT",
      headers,
      body: JSON.stringify({ id: "nonexistent-id", source: "test", plan_label: "test", amount: 1 }),
    });
    assert.equal(badUpdate.statusCode, 404);

    // DELETE: remove the record
    const deleted = await call(handler, "/functions/tokentracker-spend-records", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ id: recordId }),
    });
    const deletedBody = readJsonResponse(deleted);
    assert.equal(deletedBody.records.length, 0);

    // POST: reject missing source/plan_label
    const badCreate = await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST",
      headers,
      body: JSON.stringify({ amount: 10 }),
    });
    assert.equal(badCreate.statusCode, 400);

    // POST: reject amount <= 0
    const zeroAmount = await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST",
      headers,
      body: JSON.stringify({ source: "test", plan_label: "test", amount: 0 }),
    });
    assert.equal(zeroAmount.statusCode, 400);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("G04: billing_cycle monthly/yearly/one_time monthly summary", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-spend-"));
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
    const nextMonth = (() => {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      return d.toISOString().slice(0, 10);
    })();

    // monthly: $10/month, active this month
    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "claude", plan_label: "Max", amount: 10, currency: "USD",
        billing_cycle: "monthly", start_date: thisMonth, end_date: "",
      }),
    });

    // yearly: $120/year = $10/month, active this month
    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "openai", plan_label: "Plus", amount: 120, currency: "USD",
        billing_cycle: "yearly", start_date: thisMonth, end_date: "",
      }),
    });

    // one_time: $5, start_date this month -> should count
    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "codex", plan_label: "OneTime", amount: 5, currency: "USD",
        billing_cycle: "one_time", start_date: thisMonth, end_date: "",
      }),
    });

    // one_time: $100, start_date last year -> should NOT count this month
    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "codex", plan_label: "OldOneTime", amount: 100, currency: "USD",
        billing_cycle: "one_time", start_date: "2025-01-01", end_date: "",
      }),
    });

    const result = await call(handler, "/functions/tokentracker-spend-records", { method: "GET" });
    const body = readJsonResponse(result);
    assert.equal(body.records.length, 4);

    // subscription_usd = 10 (monthly) + 10 (yearly/12) + 5 (one_time this month) = 25
    // The old one_time from 2025 should NOT be counted
    assert.equal(body.totals.subscription_usd, 25);

    // API cost should be 0 (no queue data)
    assert.equal(body.totals.api_usd, 0);
    assert.equal(body.totals.combined_usd, 25);

    // Lifetime: monthly=$10(1mo overlap) + yearly=$10(1mo overlap at $10/mo) + one_time=$5 + old_one_time=$100 = $125
    assert.equal(body.totals.lifetime_subscription_usd, 125);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("G04: CNY records converted using D07 currencySettings.usdToCny", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-spend-"));
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

    // Set usdToCny = 6
    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ currencySettings: { usdToCny: 6 } }),
    });

    const thisMonth = new Date().toISOString().slice(0, 7) + "-01";

    // CNY 60 = USD 10
    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "claude", plan_label: "Max", amount: 60, currency: "CNY",
        billing_cycle: "monthly", start_date: thisMonth, end_date: "",
      }),
    });

    const result = await call(handler, "/functions/tokentracker-spend-records", { method: "GET" });
    const body = readJsonResponse(result);
    assert.equal(body.totals.subscription_usd, 10); // 60/6 = 10
    assert.equal(body.totals.subscription_cny, 60); // 10 * 6 = 60
    assert.equal(body.totals.combined_usd, 10);
    assert.equal(body.totals.combined_cny, 60);
    // Legacy compat
    assert.equal(body.totals.total_usd, 10);
    assert.equal(body.totals.total_cny, 60);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("G04: API cost + subscription combined totals", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-spend-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queueFile = path.join(trackerDir, "queue.jsonl");
    // Ensure queue directory exists
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

    // Set agentDefaultPricing for claude so API cost is non-zero
    // $3/MTok input, $15/MTok output for kiro-agent through built-in pricing
    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ agentDefaultPricing: { claude: { inputUsdPer1M: 3, outputUsdPer1M: 15 } } }),
    });

    // Use kiro-agent model (has curated pricing at $3/$15 per MTok)
    // 1M input + 0.5M output = 3 + 7.5 = 10.5 USD
    const now = new Date();
    const thisMonthHour = now.toISOString().slice(0, 13) + ":00:00.000Z";
    const queueEntry = JSON.stringify({
      hour_start: thisMonthHour,
      source: "claude",
      model: "kiro-agent",
      input_tokens: 1000000,
      output_tokens: 500000,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      total_tokens: 1500000,
    }) + "\n";
    await fs.writeFile(queueFile, queueEntry, "utf8");

    const thisMonth = new Date().toISOString().slice(0, 7) + "-01";

    // Add subscription: $10/month
    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "claude", plan_label: "Max", amount: 10, currency: "USD",
        billing_cycle: "monthly", start_date: thisMonth, end_date: "",
      }),
    });

    const result = await call(handler, "/functions/tokentracker-spend-records", { method: "GET" });
    const body = readJsonResponse(result);
    assert.equal(body.totals.subscription_usd, 10);
    // agentDefaultPricing: $3/MTok input, $15/MTok output
    // 1M input * 3 + 0.5M output * 15 = 10.5 USD
    assert.ok(body.totals.api_usd > 0, "API cost should be > 0 when queue has data");
    assert.equal(body.totals.combined_usd, body.totals.subscription_usd + body.totals.api_usd);
    assert.equal(body.totals.combined_cny, body.totals.combined_usd * 7.2); // default rate

    // Legacy compat
    assert.equal(body.totals.total_usd, body.totals.combined_usd);
    assert.equal(body.totals.total_cny, body.totals.combined_cny);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("G04: by_source breakdown", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-spend-"));
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

    // Claude: $10/month
    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "claude", plan_label: "Max", amount: 10, currency: "USD",
        billing_cycle: "monthly", start_date: thisMonth, end_date: "",
      }),
    });

    // OpenAI: $5/month
    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "openai", plan_label: "Plus", amount: 5, currency: "USD",
        billing_cycle: "monthly", start_date: thisMonth, end_date: "",
      }),
    });

    const result = await call(handler, "/functions/tokentracker-spend-records", { method: "GET" });
    const body = readJsonResponse(result);
    assert.ok(Array.isArray(body.by_source));
    assert.ok(body.by_source.length >= 2);

    const claudeEntry = body.by_source.find((s) => s.source === "claude");
    const openaiEntry = body.by_source.find((s) => s.source === "openai");
    assert.ok(claudeEntry);
    assert.ok(openaiEntry);
    assert.equal(claudeEntry.subscription_usd, 10);
    assert.equal(openaiEntry.subscription_usd, 5);

    // Each entry should have all expected fields
    for (const entry of body.by_source) {
      assert.ok(entry.subscription_usd !== undefined);
      assert.ok(entry.subscription_cny !== undefined);
      assert.ok(entry.api_usd !== undefined);
      assert.ok(entry.api_cny !== undefined);
      assert.ok(entry.combined_usd !== undefined);
      assert.ok(entry.combined_cny !== undefined);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("G04: legacy total_usd/total_cny backward compatibility", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-spend-"));
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
        source: "claude", plan_label: "Max", amount: 20, currency: "USD",
        billing_cycle: "monthly", start_date: thisMonth, end_date: "",
      }),
    });

    const result = await call(handler, "/functions/tokentracker-spend-records", { method: "GET" });
    const body = readJsonResponse(result);

    // Legacy fields must equal combined
    assert.equal(body.totals.total_usd, body.totals.combined_usd);
    assert.equal(body.totals.total_cny, body.totals.combined_cny);
    assert.equal(body.totals.total_usd, 20); // subscription only, no API
    assert.equal(body.totals.total_cny, 144); // 20 * 7.2
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// G04 Rework: API-only source must appear in by_source
// ─────────────────────────────────────────────────────────────────────────────

test("G04 rework: API-only source appears in by_source breakdown", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-spend-"));
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

    // Configure agentDefaultPricing for codex so API cost is non-zero
    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ agentDefaultPricing: { codex: { inputUsdPer1M: 3, outputUsdPer1M: 15 } } }),
    });

    // Write queue row for codex (no codex subscription record exists)
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

    // Also add a claude subscription record (has both sub + API potentially)
    const thisMonth = new Date().toISOString().slice(0, 7) + "-01";
    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST", headers,
      body: JSON.stringify({
        source: "claude", plan_label: "Max", amount: 10, currency: "USD",
        billing_cycle: "monthly", start_date: thisMonth, end_date: "",
      }),
    });

    const result = await call(handler, "/functions/tokentracker-spend-records", { method: "GET" });
    const body = readJsonResponse(result);

    // totals.api_usd should be > 0 (codex queue data)
    assert.ok(body.totals.api_usd > 0, "API cost should be > 0 when queue has data");

    // by_source must include both claude and codex
    assert.ok(Array.isArray(body.by_source));
    const claudeEntry = body.by_source.find((s) => s.source === "claude");
    const codexEntry = body.by_source.find((s) => s.source === "codex");
    assert.ok(claudeEntry, "claude should appear in by_source (has subscription)");
    assert.ok(codexEntry, "codex should appear in by_source (API-only source)");

    // codex: subscription = 0, api > 0, combined = api
    assert.equal(codexEntry.subscription_usd, 0);
    assert.equal(codexEntry.subscription_cny, 0);
    assert.ok(codexEntry.api_usd > 0, "codex API cost should be > 0");
    assert.ok(codexEntry.api_cny > 0, "codex API CNY should be > 0");
    assert.equal(codexEntry.combined_usd, codexEntry.api_usd);
    assert.equal(codexEntry.combined_cny, codexEntry.api_cny);

    // claude: subscription = 10, api may be 0 or >0
    assert.equal(claudeEntry.subscription_usd, 10);

    // Each entry should have all expected fields
    for (const entry of [claudeEntry, codexEntry]) {
      assert.ok(entry.subscription_usd !== undefined);
      assert.ok(entry.subscription_cny !== undefined);
      assert.ok(entry.api_usd !== undefined);
      assert.ok(entry.api_cny !== undefined);
      assert.ok(entry.combined_usd !== undefined);
      assert.ok(entry.combined_cny !== undefined);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// G04 Rework 2: timezone-aware source breakdown — API-only source must appear
// when a queue row falls into the requested date window only after TZ adjustment.
// ─────────────────────────────────────────────────────────────────────────────

test("G04 rework 2: timezone-adjusted API-only source appears in by_source", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-spend-"));
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

    // Configure agentDefaultPricing for codex so API cost is non-zero
    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ agentDefaultPricing: { codex: { inputUsdPer1M: 3, outputUsdPer1M: 15 } } }),
    });

    // Write a queue row whose hour_start is 2026-06-01T00:30:00.000Z.
    // In UTC this is June 1, but in UTC-8 (tz_offset_minutes=-480) the local
    // date is 2026-05-31.  The source=codex row must appear in by_source when
    // querying from=2026-05-31&to=2026-05-31 with tz_offset_minutes=-480.
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

    // No codex subscription/spend record — it is an API-only source.

    // Query with tz_offset_minutes=-480 (UTC-8).
    // The UTC hour 2026-06-01T00:30 maps to local date 2026-05-31.
    const result = await call(
      handler,
      "/functions/tokentracker-spend-records?from=2026-05-31&to=2026-05-31&tz_offset_minutes=-480",
      { method: "GET" },
    );
    const body = readJsonResponse(result);

    // totals.api_usd must be > 0 (codex queue usage falls into the window)
    assert.ok(body.totals.api_usd > 0, "totals.api_usd should be > 0 (codex usage in TZ-adjusted window)");

    // by_source must include codex
    assert.ok(Array.isArray(body.by_source), "by_source should be an array");
    const codexEntry = body.by_source.find((s) => s.source === "codex");
    assert.ok(codexEntry, "codex should appear in by_source (API-only source with TZ-adjusted usage)");

    // codex has no subscription, only API cost
    assert.equal(codexEntry.subscription_usd, 0, "codex subscription_usd should be 0");
    assert.equal(codexEntry.subscription_cny, 0, "codex subscription_cny should be 0");
    assert.ok(codexEntry.api_usd > 0, "codex api_usd should be > 0");
    assert.ok(codexEntry.api_cny > 0, "codex api_cny should be > 0");
    assert.equal(codexEntry.combined_usd, codexEntry.api_usd, "codex combined_usd should equal api_usd");
    assert.equal(codexEntry.combined_cny, codexEntry.api_cny, "codex combined_cny should equal api_cny");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// G04 Rework 3: default period (current month) must NOT include API-only
// sources whose queue rows fall outside the effective fromDate→toDate window.
// ─────────────────────────────────────────────────────────────────────────────

test("G04 rework 3: default period filters out last-month API-only source", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-spend-"));
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

    // Configure agentDefaultPricing for codex so API cost would be non-zero
    // if the row were counted.
    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST", headers,
      body: JSON.stringify({ agentDefaultPricing: { codex: { inputUsdPer1M: 3, outputUsdPer1M: 15 } } }),
    });

    // Compute last month's 15th in UTC (unambiguous historical date).
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12, 0, 0));
    const lastMonthHour = lastMonth.toISOString().replace(/\.\d{3}Z$/, ".000Z");

    const queueEntry = JSON.stringify({
      hour_start: lastMonthHour,
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

    // No codex subscription/spend record.

    // Default request (no from/to) → current calendar month.
    const result = await call(handler, "/functions/tokentracker-spend-records", { method: "GET" });
    const body = readJsonResponse(result);

    // The queue row is in last month, so current month totals.api_usd must be 0.
    assert.equal(body.totals.api_usd, 0, "totals.api_usd should be 0 (last-month row outside current period)");

    // by_source must NOT include codex (it has no usage in the current period).
    assert.ok(Array.isArray(body.by_source), "by_source should be an array");
    const codexEntry = body.by_source.find((s) => s.source === "codex");
    assert.equal(codexEntry, undefined, "codex should NOT appear in by_source for default current-month request");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
