const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

function request() {
  const req = Readable.from([]);
  req.method = "GET";
  req.headers = {};
  return req;
}

function response() {
  return {
    statusCode: null,
    headers: {},
    body: Buffer.alloc(0),
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) { this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0); },
  };
}

async function withQueue(rows, run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-observability-api-"));
  const queuePath = path.join(dir, "queue.jsonl");
  await fs.writeFile(queuePath, `${rows.map(JSON.stringify).join("\n")}\n`, "utf8");
  try { await run({ dir, queuePath }); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test("observability APIs expose diagnostics, redacted export, and compact tray data", async () => {
  await withQueue([{
    request_id: "r-1", source: "codex", record_kind: "request_event", timestamp: "2026-07-27T00:00:00.000Z",
    model: "gpt-5", input_tokens: 10, output_tokens: 5, status: 200, prompt: "private prompt",
    dimensions: { device_id: "d1", environment_id: "native", environment_kind: "native", agent_id: "codex", session_key: "secret-session", project_key: "C:\\private\\project" },
  }], async ({ dir, queuePath }) => {
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: dir,
      limitAccountsProvider: async () => ({
        accounts: [{ provider_id: "codex", account_key: "hashed", account_label: "private", status: "ok", windows: [{ kind: "five_hour", label: "5h", used_percent: 80, reset_at: "2026-07-27T02:00:00.000Z" }] }],
        forecasts: [{ account_key: "hashed", window_kind: "five_hour", window_label: "5h", advice: "danger" }],
      }),
    });

    const diagnostics = response();
    await handler(request(), diagnostics, new URL("http://127.0.0.1:7680/functions/tokentracker-request-diagnostics"));
    const diagnosticBody = JSON.parse(diagnostics.body.toString("utf8"));
    assert.equal(diagnosticBody.diagnostics.length, 1);
    assert.equal(JSON.stringify(diagnosticBody).includes("private prompt"), false);

    const exported = response();
    await handler(request(), exported, new URL("http://127.0.0.1:7680/functions/tokentracker-observability-export?format=json"));
    assert.equal(exported.body.toString("utf8").includes("private prompt"), false);
    assert.equal(exported.body.toString("utf8").includes("secret-session"), false);

    const tray = response();
    await handler(request(), tray, new URL("http://127.0.0.1:7680/functions/tokentracker-tray-compact"));
    const trayBody = JSON.parse(tray.body.toString("utf8"));
    assert.equal(trayBody.status, "danger");
    assert.equal(trayBody.title.includes("private"), false);
  });
});
