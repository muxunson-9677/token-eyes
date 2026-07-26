const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

function createRequest() {
  const req = Readable.from([]);
  req.method = "GET";
  req.headers = {};
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    body: Buffer.alloc(0),
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

test("usage attribution API keeps same-hour native and WSL rows separate", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-attribution-api-"));
  const queuePath = path.join(tempDir, "queue.jsonl");
  const rows = [
    { source: "codex", model: "gpt-5", hour_start: "2026-07-27T00:00:00Z", total_tokens: 40, conversation_count: 1, dimensions: { device_id: "device-a", environment_id: "native", environment_kind: "native", agent_id: "codex", account_scope: null, project_key: null, session_key: null, model_id: "gpt-5" } },
    { source: "codex", model: "gpt-5", hour_start: "2026-07-27T00:00:00Z", total_tokens: 60, conversation_count: 1, dimensions: { device_id: "device-a", environment_id: "wsl:Ubuntu", environment_kind: "wsl", agent_id: "codex", account_scope: null, project_key: null, session_key: null, model_id: "gpt-5" } },
  ];
  await fs.writeFile(queuePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

  try {
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: tempDir });
    const req = createRequest();
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1:7680/functions/tokentracker-usage-attribution?from=2026-07-27&to=2026-07-27&group_by=environment"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body.toString("utf8"));
    assert.equal(body.attribution.total_tokens, 100);
    assert.equal(body.snapshots.length, 2);
    assert.deepEqual(Object.hasOwn(body.snapshots[0].dimensions, "session_key"), false);
    assert.deepEqual(body.attribution.groups.map((group) => [group.key, group.tokens.total_tokens]), [
      ["native", 40],
      ["wsl:Ubuntu", 60],
    ]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("usage attribution API keeps the latest cumulative row for one v2 bucket", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-attribution-api-"));
  const queuePath = path.join(tempDir, "queue.jsonl");
  const rows = [
    { source: "codex", model: "gpt-5", hour_start: "2026-07-27T00:00:00Z", total_tokens: 40, conversation_count: 1, dimensions: { device_id: "device-a", environment_id: "native", environment_kind: "native", agent_id: "codex", account_scope: null, project_key: null, session_key: "old-session", model_id: "gpt-5" } },
    { source: "codex", model: "gpt-5", hour_start: "2026-07-27T00:00:00Z", total_tokens: 60, conversation_count: 1, dimensions: { device_id: "device-a", environment_id: "native", environment_kind: "native", agent_id: "codex", account_scope: null, project_key: null, session_key: "new-session", model_id: "gpt-5" } },
  ];
  await fs.writeFile(queuePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

  try {
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: tempDir });
    const res = createResponse();
    await handler(
      createRequest(),
      res,
      new URL("http://127.0.0.1:7680/functions/tokentracker-usage-attribution?group_by=environment"),
    );

    const body = JSON.parse(res.body.toString("utf8"));
    assert.equal(body.attribution.total_tokens, 60);
    assert.deepEqual(body.attribution.groups.map((group) => [group.key, group.tokens.total_tokens]), [["native", 60]]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("usage attribution API applies the same source and model filters as usage statistics", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-attribution-api-"));
  const queuePath = path.join(tempDir, "queue.jsonl");
  const rows = [
    { source: "codex", model: "gpt-5", hour_start: "2026-07-27T00:00:00Z", total_tokens: 40, dimensions: { device_id: "device-a", environment_id: "native", agent_id: "codex", model_id: "gpt-5" } },
    { source: "claude", model: "claude-4", hour_start: "2026-07-27T00:00:00Z", total_tokens: 60, dimensions: { device_id: "device-a", environment_id: "native", agent_id: "claude", model_id: "claude-4" } },
  ];
  await fs.writeFile(queuePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

  try {
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: tempDir });
    const res = createResponse();
    await handler(
      createRequest(),
      res,
      new URL("http://127.0.0.1:7680/functions/tokentracker-usage-attribution?sources=codex&models=gpt-5"),
    );

    const body = JSON.parse(res.body.toString("utf8"));
    assert.equal(body.attribution.total_tokens, 40);
    assert.equal(body.snapshots_count, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
