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

test("spend records API creates, lists, deletes, and totals USD/CNY", async () => {
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

    const usd = await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST",
      headers,
      body: JSON.stringify({ source: "claude", plan_label: "Max", amount: 10, currency: "USD" }),
    });
    const usdBody = readJsonResponse(usd);
    assert.equal(usdBody.totals.total_usd, 10);
    assert.equal(usdBody.totals.total_cny, 72);

    const cny = await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST",
      headers,
      body: JSON.stringify({ source: "codex", plan_label: "Plus", amount: 72, currency: "CNY" }),
    });
    const cnyBody = readJsonResponse(cny);
    assert.equal(cnyBody.records.length, 2);
    assert.equal(cnyBody.totals.total_usd, 20);
    assert.equal(cnyBody.totals.total_cny, 144);

    const deleted = await call(handler, "/functions/tokentracker-spend-records", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ id: usdBody.record.id }),
    });
    const deletedBody = readJsonResponse(deleted);
    assert.equal(deletedBody.records.length, 1);
    assert.equal(deletedBody.totals.total_usd, 10);
    assert.equal(deletedBody.totals.total_cny, 72);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
