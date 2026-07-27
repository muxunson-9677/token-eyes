"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { afterEach, beforeEach, test } = require("node:test");

let tmpHome;
let previousHome;
let previousUserProfile;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-leaderboard-cost-"));
  previousHome = process.env.HOME;
  previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  delete require.cache[require.resolve("../src/lib/local-api")];
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function setupHandler() {
  const trackerDir = path.join(tmpHome, ".tokentracker", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const isolatedCodexHome = path.join(tmpHome, "empty-codex");
  const today = shanghaiToday();
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.mkdirSync(isolatedCodexHome, { recursive: true });
  fs.writeFileSync(queuePath, `${JSON.stringify({
    hour_start: new Date().toISOString(),
    source: "codex",
    model: "leaderboard-test-model",
    input_tokens: 1,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 1,
    project: "private-project",
    conversation_count: 7,
  })}\n`);
  fs.writeFileSync(path.join(trackerDir, "config.json"), JSON.stringify({
    machineId: "stable-machine-id",
    dataDirectories: { codex: isolatedCodexHome },
    pricingRules: [{
      source: "codex",
      model: "leaderboard-test-model",
      inputPricePer1M: 1_000_000,
      outputPricePer1M: 0,
      currency: "USD",
    }],
    spendRecords: [
      {
        id: "private-subscription-id",
        source: "codex",
        plan_label: "Private Codex Plan",
        amount: 10,
        currency: "USD",
        billing_cycle: "monthly",
        start_date: today,
        note: "private subscription note",
      },
      {
        id: "private-one-time-id",
        source: "setup",
        plan_label: "Private Setup",
        amount: 2,
        currency: "USD",
        billing_cycle: "one_time",
        start_date: today,
        merchant: "private merchant",
      },
      {
        id: "private-other-ai-id",
        source: "other-ai",
        plan_label: "Private Other AI",
        amount: 3,
        currency: "USD",
        billing_cycle: "one_time",
        start_date: today,
        payment_method: "private card",
      },
    ],
  }));

  delete require.cache[require.resolve("../src/lib/local-api")];
  const { createLocalApiHandler } = require("../src/lib/local-api");
  return createLocalApiHandler({ queuePath, trackerDataDir: trackerDir });
}

function response() {
  const chunks = [];
  const headers = {};
  return {
    statusCode: 200,
    headers,
    writeHead(status, values = {}) {
      this.statusCode = status;
      for (const [key, value] of Object.entries(values)) headers[key.toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
    },
    body() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

async function call(handler, method = "GET", headers = {}) {
  const req = Readable.from([]);
  req.method = method;
  req.headers = { host: "127.0.0.1", ...headers };
  const res = response();
  const handled = await handler(
    req,
    res,
    new URL("http://127.0.0.1/functions/tokentracker-leaderboard-actual-cost"),
  );
  assert.equal(handled, true);
  return res;
}

test("returns API, recurring, one-time, and other-AI cost as four private-free totals", async () => {
  const res = await call(setupHandler());
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  const body = JSON.parse(res.body());
  assert.deepEqual(body.period_costs_usd, {
    today: 16,
    week: 16,
    "30d": 16,
    month: 16,
    total: 16,
  });

  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "private-subscription-id",
    "private-one-time-id",
    "private-other-ai-id",
    "Private Codex Plan",
    "Private Setup",
    "Private Other AI",
    "private subscription note",
    "private merchant",
    "private card",
    "by_source",
    "series",
    "records",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `must omit ${forbidden}`);
  }
});

test("rejects actual-cost reads from non-local web origins", async () => {
  const res = await call(setupHandler(), "GET", {
    origin: "https://malicious.example",
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(JSON.parse(res.body()), {
    ok: false,
    error: "Forbidden",
  });
});

test("rejects non-GET actual-cost requests", async () => {
  const res = await call(setupHandler(), "POST");
  assert.equal(res.statusCode, 405);
  assert.deepEqual(JSON.parse(res.body()), {
    ok: false,
    error: "Method Not Allowed",
  });
});
