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

test("token plans API persists F03 refresh fields", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "codex",
        plan_label: "ChatGPT Plus",
        total_quota: 0,
        used_quota: 0,
        remaining_quota: 0,
        expires_at: "2026-07-20",
        refresh_enabled: true,
        refresh_interval_minutes: 60,
        refresh_method: "official_api",
        credential_ref: "codex_auth_json",
      }),
    });
    const record = readJsonResponse(created).record;
    assert.equal(record.refresh_enabled, true);
    assert.equal(record.refresh_interval_minutes, 60);
    assert.equal(record.refresh_method, "official_api");
    assert.equal(record.credential_ref, "codex_auth_json");
    // official_api 启用后应自动安排 next_refresh_at
    assert.ok(record.next_refresh_at, "next_refresh_at should be set when refresh_enabled && method != manual");

    // GET 应该回传相同的刷新字段
    const listed = await call(handler, "/functions/tokentracker-token-plans");
    const listedRecord = readJsonResponse(listed).records[0];
    assert.equal(listedRecord.refresh_enabled, true);
    assert.equal(listedRecord.refresh_method, "official_api");
    assert.equal(listedRecord.credential_ref, "codex_auth_json");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("token plans refresh endpoint writes failed status when no provider API", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "codex",
        plan_label: "ChatGPT Plus",
        refresh_enabled: true,
        refresh_interval_minutes: 60,
        refresh_method: "official_api",
        credential_ref: "codex_auth_json",
      }),
    });
    const id = readJsonResponse(created).record.id;

    const refreshRes = await call(handler, "/functions/tokentracker-token-plans-refresh", {
      method: "POST",
      headers,
      body: JSON.stringify({ id }),
    });
    const refreshBody = readJsonResponse(refreshRes);
    assert.equal(refreshRes.statusCode, 200);
    assert.equal(refreshBody.ok, true);
    assert.equal(refreshBody.plan.last_refresh_status, "failed");
    assert.ok(refreshBody.plan.last_refresh_error);
    assert.ok(refreshBody.plan.last_refresh_at);

    // 状态应已持久化
    const listed = await call(handler, "/functions/tokentracker-token-plans");
    const listedRecord = readJsonResponse(listed).records[0];
    assert.equal(listedRecord.last_refresh_status, "failed");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("token plans refresh endpoint handles manual method as success no-op", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "claude",
        plan_label: "Max",
        total_quota: 1000,
        used_quota: 200,
        remaining_quota: 800,
        refresh_method: "manual",
      }),
    });
    const id = readJsonResponse(created).record.id;

    const refreshRes = await call(handler, "/functions/tokentracker-token-plans-refresh", {
      method: "POST",
      headers,
      body: JSON.stringify({ id }),
    });
    const refreshBody = readJsonResponse(refreshRes);
    assert.equal(refreshBody.ok, true);
    assert.equal(refreshBody.plan.last_refresh_status, "success");
    // manual 不应安排 next_refresh_at
    assert.equal(refreshBody.plan.next_refresh_at, "");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
