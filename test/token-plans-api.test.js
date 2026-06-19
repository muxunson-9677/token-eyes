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

test("token plans API creates, lists, and updates manual local records", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const initial = await call(handler, "/functions/tokentracker-token-plans");
    assert.deepEqual(readJsonResponse(initial).records, []);

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "claude",
        plan_label: "Max",
        total_quota: 1000,
        used_quota: 200,
        remaining_quota: 800,
        expires_at: "2026-12-31",
      }),
    });
    const createdBody = readJsonResponse(created);
    assert.equal(created.statusCode, 200);
    assert.equal(createdBody.records.length, 1);
    assert.ok(createdBody.record.id);

    const updated = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: createdBody.record.id,
        source: "claude",
        plan_label: "Max updated",
        remaining_quota: 700,
      }),
    });
    const updatedBody = readJsonResponse(updated);
    assert.equal(updatedBody.records.length, 1);
    assert.equal(updatedBody.record.plan_label, "Max updated");
    assert.equal(updatedBody.record.total_quota, 1000);
    assert.equal(updatedBody.record.remaining_quota, 700);

    const listed = await call(handler, "/functions/tokentracker-token-plans");
    assert.equal(readJsonResponse(listed).records[0].plan_label, "Max updated");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
