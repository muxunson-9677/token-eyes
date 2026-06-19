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
