const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  createLocalApiHandler,
  clearQueueDataCacheForTests,
  readQueueData,
} = require("../src/lib/local-api");

function queueRow(totalTokens, hourStart = "2026-05-09T10:00:00Z") {
  return {
    hour_start: hourStart,
    source: "claude",
    model: "claude-sonnet-4",
    input_tokens: totalTokens,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: totalTokens,
    billable_total_tokens: totalTokens,
    conversation_count: 1,
    billing_mode: "api_key",
    billing_mode_confidence: "provider_receipt",
    provider_id: "anthropic",
  };
}

async function writeRows(queuePath, rows) {
  await fs.promises.writeFile(
    queuePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
}

async function callHandler(handler, endpoint) {
  const url = new URL(`http://localhost${endpoint}`);
  const req = {
    method: "GET",
    url: url.pathname + url.search,
    headers: { host: "localhost" },
  };
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead(code) {
      this.statusCode = code;
    },
    write(chunk) {
      chunks.push(chunk);
    },
    end(chunk) {
      if (chunk) chunks.push(chunk);
    },
  };
  const handled = await handler(req, res, url);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  return JSON.parse(chunks.join(""));
}

async function callHandlerWithHeaders(handler, endpoint) {
  const url = new URL(`http://localhost${endpoint}`);
  const req = {
    method: "GET",
    url: url.pathname + url.search,
    headers: { host: "localhost" },
  };
  const chunks = [];
  let responseHeaders = {};
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead(code, headers = {}) {
      this.statusCode = code;
      responseHeaders = headers;
    },
    write(chunk) {
      chunks.push(chunk);
    },
    end(chunk) {
      if (chunk) chunks.push(chunk);
    },
  };
  const handled = await handler(req, res, url);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  return {
    body: JSON.parse(chunks.join("")),
    headers: responseHeaders,
  };
}

test("readQueueData reuses an unchanged parsed queue and invalidates on file change", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-queue-cache-"));
  const queuePath = path.join(tmp, "queue.jsonl");
  const originalReadFileSync = fs.readFileSync;
  let queueReads = 0;
  try {
    clearQueueDataCacheForTests();
    await writeRows(queuePath, [queueRow(100)]);
    fs.readFileSync = function patchedRead(filePath, ...args) {
      if (path.resolve(String(filePath)) === path.resolve(queuePath)) queueReads += 1;
      return originalReadFileSync.call(this, filePath, ...args);
    };

    assert.equal(readQueueData(queuePath)[0].total_tokens, 100);
    assert.equal(readQueueData(queuePath)[0].total_tokens, 100);
    assert.equal(queueReads, 1);

    await writeRows(queuePath, [
      queueRow(1000),
      queueRow(2000, "2026-05-09T10:30:00Z"),
    ]);
    assert.equal(
      readQueueData(queuePath).reduce((total, row) => total + row.total_tokens, 0),
      3000,
    );
    assert.equal(queueReads, 2);
  } finally {
    fs.readFileSync = originalReadFileSync;
    clearQueueDataCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("usage aggregations reuse one Intl.DateTimeFormat instance per time zone", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-timezone-cache-"));
  const queuePath = path.join(tmp, "queue.jsonl");
  const OriginalDateTimeFormat = Intl.DateTimeFormat;
  let formatterConstructions = 0;
  try {
    await writeRows(queuePath, [
      queueRow(100, "2026-05-09T10:00:00Z"),
      queueRow(200, "2026-05-09T10:30:00Z"),
    ]);
    Intl.DateTimeFormat = function CountingDateTimeFormat(...args) {
      formatterConstructions += 1;
      return new OriginalDateTimeFormat(...args);
    };
    Intl.DateTimeFormat.prototype = OriginalDateTimeFormat.prototype;

    const handler = createLocalApiHandler({ queuePath, trackerDataDir: tmp });
    const result = await callHandler(
      handler,
      "/functions/tokentracker-usage-summary?from=2026-05-10&to=2026-05-10&tz=Pacific%2FKiritimati&sources=claude",
    );

    assert.equal(result.totals.total_tokens, 300);
    assert.equal(formatterConstructions, 1);
  } finally {
    Intl.DateTimeFormat = OriginalDateTimeFormat;
    clearQueueDataCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("usage endpoints reuse zoned parts for unchanged timestamps", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-zoned-parts-cache-"));
  const queuePath = path.join(tmp, "queue.jsonl");
  const OriginalDateTimeFormat = Intl.DateTimeFormat;
  let formatCalls = 0;
  try {
    await writeRows(queuePath, [
      queueRow(100, "2026-05-09T10:00:00Z"),
      queueRow(200, "2026-05-09T10:30:00Z"),
    ]);
    Intl.DateTimeFormat = function CountingDateTimeFormat(...args) {
      const formatter = new OriginalDateTimeFormat(...args);
      return {
        formatToParts(value) {
          formatCalls += 1;
          return formatter.formatToParts(value);
        },
      };
    };
    Intl.DateTimeFormat.prototype = OriginalDateTimeFormat.prototype;

    const handler = createLocalApiHandler({ queuePath, trackerDataDir: tmp });
    const endpoint = "/functions/tokentracker-provider-stats?from=2026-05-09&to=2026-05-09&tz=America%2FNuuk&sources=claude";
    await callHandler(handler, endpoint);
    const firstPassCalls = formatCalls;
    assert.ok(firstPassCalls > 0);

    await callHandler(handler, endpoint);
    assert.equal(formatCalls, firstPassCalls);
  } finally {
    Intl.DateTimeFormat = OriginalDateTimeFormat;
    clearQueueDataCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("aggregate response cache hits repeat requests and invalidates on queue change", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-aggregate-response-cache-"));
  const queuePath = path.join(tmp, "queue.jsonl");
  try {
    await writeRows(queuePath, [queueRow(100)]);
    await fs.promises.writeFile(path.join(tmp, "config.json"), JSON.stringify({
      pricingRules: [{
        source: "claude",
        model: "claude-sonnet-4",
        inputPricePer1M: 1,
        outputPricePer1M: 1,
        currency: "USD",
      }],
    }), "utf8");
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: tmp });
    const endpoint = "/functions/tokentracker-provider-stats?from=2026-05-03&to=2026-05-09&tz=UTC&sources=claude";

    const first = await callHandlerWithHeaders(handler, endpoint);
    const repeated = await callHandlerWithHeaders(handler, endpoint);
    assert.equal(first.body.totals.total_tokens, 100);
    assert.equal(repeated.body.totals.total_tokens, 100);
    assert.equal(repeated.headers["X-TokenTracker-Usage-Cache"], "hit");

    await writeRows(queuePath, [
      queueRow(1000),
      queueRow(2000, "2026-05-09T10:30:00Z"),
    ]);
    const changed = await callHandlerWithHeaders(handler, endpoint);
    assert.equal(changed.body.totals.total_tokens, 3000);
    assert.equal(changed.headers["X-TokenTracker-Usage-Cache"], undefined);
  } finally {
    clearQueueDataCacheForTests();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
