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

test("local settings API saves machine-only data directory and pricing overrides", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-local-settings-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: trackerDir });

    const initial = await call(handler, "/functions/tokentracker-local-settings");
    assert.deepEqual(readJsonResponse(initial).dataDirectories, { claude: "", codex: "", hermes: "" });
    assert.deepEqual(readJsonResponse(initial).agentDefaultPricing, {
      claude: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
      codex: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
      hermes: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
    });
    assert.deepEqual(readJsonResponse(initial).pricingRules, []);

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    assert.ok(token);

    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    const dataDirectories = {
      claude: "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude",
      codex: "C:\\Users\\admin\\.codex",
      hermes: "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.hermes",
    };
    const saved = await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({ dataDirectories }),
    });

    assert.equal(saved.statusCode, 200);
    assert.deepEqual(readJsonResponse(saved).dataDirectories, dataDirectories);

    const agentDefaultPricing = {
      claude: { inputUsdPer1M: 1.25, outputUsdPer1M: 5 },
      codex: { inputUsdPer1M: 2, outputUsdPer1M: 8 },
      hermes: { inputUsdPer1M: 0.5, outputUsdPer1M: 3 },
    };
    const pricingSaved = await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({ agentDefaultPricing }),
    });

    assert.equal(pricingSaved.statusCode, 200);
    assert.deepEqual(readJsonResponse(pricingSaved).dataDirectories, dataDirectories);
    assert.deepEqual(readJsonResponse(pricingSaved).agentDefaultPricing, agentDefaultPricing);

    const config = JSON.parse(await fs.readFile(path.join(trackerDir, "config.json"), "utf8"));
    assert.deepEqual(config.dataDirectories, dataDirectories);
    assert.deepEqual(config.agentDefaultPricing, agentDefaultPricing);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("local settings API persists and normalizes pricingRules", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-local-settings-rules-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: trackerDir });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    const pricingRules = [
      {
        id: "codex:gpt-5.2-codex",
        source: "codex",
        model: "gpt-5.2-codex",
        inputPricePer1M: 1.75,
        outputPricePer1M: 14,
        currency: "USD",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
      {
        source: "hermes",
        model: "mimo-v2.5-pro",
        inputPricePer1M: 7.2,
        outputPricePer1M: 36,
        currency: "CNY",
      },
      // invalid: missing model → dropped
      { source: "claude", model: "", inputPricePer1M: 3, outputPricePer1M: 15 },
    ];

    const saved = await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({ pricingRules }),
    });

    assert.equal(saved.statusCode, 200);
    const savedBody = readJsonResponse(saved);
    assert.equal(savedBody.pricingRules.length, 2);
    assert.equal(savedBody.pricingRules[0].id, "codex:gpt-5.2-codex");
    assert.equal(savedBody.pricingRules[0].source, "codex");
    assert.equal(savedBody.pricingRules[0].model, "gpt-5.2-codex");
    assert.equal(savedBody.pricingRules[0].currency, "USD");
    // second rule gets an auto-generated id from source:model.
    assert.equal(savedBody.pricingRules[1].id, "hermes:mimo-v2.5-pro");
    assert.equal(savedBody.pricingRules[1].currency, "CNY");
    assert.ok(savedBody.pricingRules[1].updated_at, "updated_at auto-filled when missing");

    // Verify it round-trips on a fresh GET.
    const reread = await call(handler, "/functions/tokentracker-local-settings");
    assert.equal(readJsonResponse(reread).pricingRules.length, 2);

    // Verify it landed in config.json.
    const config = JSON.parse(await fs.readFile(path.join(trackerDir, "config.json"), "utf8"));
    assert.ok(Array.isArray(config.pricingRules));
    assert.equal(config.pricingRules.length, 2);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("local settings API getPricingOptions includes pricingRules for cost calc", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-local-settings-opts-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: trackerDir });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        pricingRules: [
          { source: "codex", model: "gpt-5.2-codex", inputPricePer1M: 1.75, outputPricePer1M: 14, currency: "USD" },
        ],
      }),
    });

    // The usage-summary endpoint uses getPricingOptions internally; verify a
    // queue row for the ruled model produces the rule's cost, not 0.
    const queueLine = JSON.stringify({
      hour_start: "2026-06-20T00:00:00.000Z",
      source: "codex",
      model: "gpt-5.2-codex",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 2_000_000,
      conversation_count: 1,
    });
    await fs.writeFile(queuePath, queueLine + "\n");

    const summary = await call(handler, "/functions/tokentracker-usage-summary?from=2026-06-20&to=2026-06-20");
    const body = readJsonResponse(summary);
    // 1M input * 1.75 + 1M output * 14 = 15.75 USD.
    const cost = body?.totals?.total_cost_usd ?? 0;
    assert.ok(
      Math.abs(cost - 15.75) < 1e-9,
      `expected 15.75, got ${cost}`,
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
