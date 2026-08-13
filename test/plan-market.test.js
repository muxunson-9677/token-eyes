const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("./helpers/local-api.cjs");

const ALLOWED_CURRENCIES = new Set(["CNY", "USD"]);
const ALLOWED_CYCLES = new Set(["monthly", "quarterly", "yearly", "one_time"]);
const ALLOWED_STATUS = new Set(["available", "discontinued"]);

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

async function call(handler, pathName, options) {
  const req = createRequest(options);
  const res = createResponse();
  const handled = await handler(req, res, new URL(`http://127.0.0.1:7680${pathName}`));
  assert.equal(handled, true);
  return res;
}

function readJsonResponse(res) {
  return JSON.parse(res.body.toString("utf8") || "{}");
}

test("plan market catalog exposes validated, sourced provider plan data", () => {
  const { getPlanMarketCatalog } = require("../src/lib/plan-market");
  const catalog = getPlanMarketCatalog();

  assert.ok(catalog.updated_at, "catalog must carry updated_at");
  assert.ok(Array.isArray(catalog.providers) && catalog.providers.length >= 4);

  const seenIds = new Set();
  for (const provider of catalog.providers) {
    assert.ok(provider.id && typeof provider.id === "string", "provider id required");
    assert.ok(!seenIds.has(provider.id), `duplicate provider id ${provider.id}`);
    seenIds.add(provider.id);
    assert.ok(provider.display_name, `provider ${provider.id} needs display_name`);
    assert.match(
      String(provider.last_verified || ""),
      /^\d{4}-\d{2}-\d{2}$/,
      `provider ${provider.id} needs last_verified date`,
    );
    assert.ok(
      Array.isArray(provider.sources) && provider.sources.length >= 1,
      `provider ${provider.id} needs at least one source link`,
    );
    for (const source of provider.sources) {
      assert.ok(source.label, `provider ${provider.id} source needs label`);
      assert.match(String(source.url || ""), /^https:\/\//, `provider ${provider.id} source URL must be https`);
    }
    assert.ok(Array.isArray(provider.plans) && provider.plans.length >= 1);
    const seenPlanIds = new Set();
    for (const plan of provider.plans) {
      assert.ok(plan.plan_id, `provider ${provider.id} plan needs plan_id`);
      assert.ok(!seenPlanIds.has(plan.plan_id), `duplicate plan id ${provider.id}/${plan.plan_id}`);
      seenPlanIds.add(plan.plan_id);
      assert.ok(plan.display_name, `plan ${provider.id}/${plan.plan_id} needs display_name`);
      assert.ok(plan.price && typeof plan.price === "object");
      assert.ok(Number(plan.price.amount) > 0, `plan ${provider.id}/${plan.plan_id} price must be > 0`);
      assert.ok(
        ALLOWED_CURRENCIES.has(plan.price.currency),
        `plan ${provider.id}/${plan.plan_id} currency must be CNY or USD`,
      );
      assert.ok(
        ALLOWED_CYCLES.has(plan.price.cycle),
        `plan ${provider.id}/${plan.plan_id} cycle invalid: ${plan.price.cycle}`,
      );
      assert.ok(plan.quota_summary, `plan ${provider.id}/${plan.plan_id} needs quota_summary`);
      assert.ok(
        ALLOWED_STATUS.has(plan.status),
        `plan ${provider.id}/${plan.plan_id} status invalid: ${plan.status}`,
      );
    }
  }

  const providerIds = catalog.providers.map((p) => p.id);
  for (const expected of ["glm", "aliyun-bailian", "claude", "openai"]) {
    assert.ok(providerIds.includes(expected), `catalog must include seed provider ${expected}`);
  }
});

test("plan market catalog returns defensive copies", () => {
  const { getPlanMarketCatalog } = require("../src/lib/plan-market");
  const first = getPlanMarketCatalog();
  first.providers[0].display_name = "mutated";
  first.providers[0].plans[0].price.amount = -1;
  const second = getPlanMarketCatalog();
  assert.notEqual(second.providers[0].display_name, "mutated");
  assert.ok(Number(second.providers[0].plans[0].price.amount) > 0);
});

test("local API serves plan market catalog read-only", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const res = await call(handler, "/functions/tokentracker-plan-market");
    assert.equal(res.statusCode, 200);
    const body = readJsonResponse(res);
    assert.ok(body.updated_at);
    assert.ok(Array.isArray(body.providers) && body.providers.length >= 4);
    assert.ok(body.providers.every((p) => Array.isArray(p.sources) && p.sources.length >= 1));

    const rejected = await call(handler, "/functions/tokentracker-plan-market", { method: "POST" });
    assert.equal(rejected.statusCode, 405);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
