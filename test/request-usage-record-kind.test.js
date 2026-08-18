const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("./helpers/local-api.cjs");

// V2-W3: request-usage-records supports a record_kind filter so the dashboard
// can show "仅看消息级" (request_event) vs half-hour aggregates, filtered
// server-side BEFORE pagination and totals.

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

async function setupQueueWithAggregateRow(tmp) {
  const trackerDir = path.join(tmp, ".tokentracker", "tracker");
  await fs.mkdir(trackerDir, { recursive: true });
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const hourStart = `${new Date().toISOString().slice(0, 13)}:00:00Z`;
  const row = {
    hour_start: hourStart,
    source: "claude",
    model: "claude-opus-4-6",
    input_tokens: 100,
    output_tokens: 50,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 150,
    conversation_count: 1,
  };
  await fs.writeFile(queuePath, `${JSON.stringify(row)}\n`);
  return { trackerDir, queuePath };
}

test("record_kind filter narrows request usage records before pagination", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-record-kind-"));
  try {
    const { trackerDir, queuePath } = await setupQueueWithAggregateRow(tmp);
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: trackerDir });

    const unfiltered = await call(
      handler,
      "/functions/tokentracker-request-usage-records?source=claude",
    );
    const unfilteredBody = readJsonResponse(unfiltered);
    assert.equal(unfiltered.statusCode, 200);
    assert.equal(unfilteredBody.records.length, 1);
    assert.equal(unfilteredBody.records[0].record_kind, "aggregate_bucket");

    const aggregates = await call(
      handler,
      "/functions/tokentracker-request-usage-records?source=claude&record_kind=aggregate_bucket",
    );
    const aggregatesBody = readJsonResponse(aggregates);
    assert.equal(aggregatesBody.records.length, 1);
    assert.equal(aggregatesBody.page.total, 1);

    const events = await call(
      handler,
      "/functions/tokentracker-request-usage-records?source=claude&record_kind=request_event",
    );
    const eventsBody = readJsonResponse(events);
    assert.equal(eventsBody.records.length, 0);
    assert.equal(eventsBody.page.total, 0);
    // Totals must follow the filtered set — never report aggregate tokens
    // while claiming to show only request events.
    assert.equal(Number(eventsBody.totals?.input_tokens || 0), 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
