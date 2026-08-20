const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { collectClaudeRequestUsageRecords } = require("../src/lib/claude-request-usage");
const {
  computeRecordTotals,
  createLocalApiHandler,
} = require("./helpers/local-api.cjs");

const SECRET_BODY = "TOP-SECRET-CONVERSATION-BODY-NEVER-LEAK";

function assistantLine({
  msgId,
  reqId,
  timestamp = "2026-08-10T03:12:45.000Z",
  model = "claude-opus-4-6",
  usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 300, cache_creation_input_tokens: 20 },
  omitUsage = false,
} = {}) {
  const entry = {
    type: "assistant",
    timestamp,
    message: {
      id: msgId,
      model,
      role: "assistant",
      content: [{ type: "text", text: SECRET_BODY }],
    },
  };
  if (reqId) entry.requestId = reqId;
  if (!omitUsage) entry.message.usage = usage;
  return JSON.stringify(entry);
}

async function writeClaudeFixture(lines, { home, project = "-home-user-proj", file = "session-a.jsonl" } = {}) {
  const projectDir = path.join(home, "projects", project);
  await fs.mkdir(projectDir, { recursive: true });
  const filePath = path.join(projectDir, file);
  await fs.writeFile(filePath, lines.join("\n") + "\n", "utf8");
  return filePath;
}

async function makeTmpHome() {
  return fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-claude-rur-"));
}

test("collects assistant message.usage into normalized request-event records without reading bodies", async () => {
  const home = await makeTmpHome();
  try {
    const filePath = await writeClaudeFixture([
      assistantLine({ msgId: "msg_01", reqId: "req_01" }),
    ], { home });

    const result = await collectClaudeRequestUsageRecords({
      claudeProjectFiles: [filePath],
      pricingOptions: {},
    });

    assert.equal(result.source, "claude");
    assert.equal(result.records.length, 1);
    const rec = result.records[0];
    assert.equal(rec.source, "claude");
    assert.equal(rec.model, "claude-opus-4-6");
    assert.equal(rec.record_kind, "request_event");
    // Token normalization convention: input = non-cached only, cache read →
    // cached_input_tokens, cache write → cache_creation_input_tokens.
    assert.equal(rec.input_tokens, 100);
    assert.equal(rec.output_tokens, 50);
    assert.equal(rec.cached_input_tokens, 300);
    assert.equal(rec.cache_creation_input_tokens, 20);
    assert.equal(rec.reasoning_output_tokens, 0);
    assert.equal(rec.total_tokens, 100 + 50 + 300 + 20);
    assert.equal(rec.cost_usd, null);
    assert.equal(rec.priced_tokens, 0);
    assert.equal(rec.unpriced_tokens, rec.total_tokens);
    assert.equal(rec.pricing_coverage, "unpriced");
    // Privacy red line: no conversation content may appear anywhere in output.
    assert.ok(!JSON.stringify(result).includes(SECRET_BODY));

    const totals = result.totals;
    assert.equal(totals.total_tokens, rec.total_tokens);
    assert.equal(totals.cost_usd, null);
    assert.equal(totals.pricing_coverage, "unpriced");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("preserves priced and unpriced Claude provenance through production totals", async () => {
  const home = await makeTmpHome();
  try {
    const usage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    const filePath = await writeClaudeFixture([
      assistantLine({
        msgId: "msg_priced",
        reqId: "req_priced",
        model: "review-priced-claude",
        usage,
      }),
      assistantLine({
        msgId: "msg_unpriced",
        reqId: "req_unpriced",
        model: "review-unpriced-claude",
        timestamp: "2026-08-10T03:13:45.000Z",
        usage,
      }),
    ], { home });

    const result = await collectClaudeRequestUsageRecords({
      claudeProjectFiles: [filePath],
      pricingOptions: {
        pricingRules: [{
          source: "claude",
          model: "review-priced-claude",
          inputPricePer1M: 1,
          outputPricePer1M: 2,
          currency: "USD",
          updated_at: "2026-08-20T00:00:00.000Z",
        }],
        nowMs: Date.parse("2026-08-21T00:00:00.000Z"),
      },
    });

    const priced = result.records.find((record) => record.model === "review-priced-claude");
    const unpriced = result.records.find((record) => record.model === "review-unpriced-claude");
    assert.equal(priced.source_kind, "user_override");
    assert.equal(priced.pricing_coverage, "complete");
    assert.equal(unpriced.source_kind, "unpriced");
    assert.equal(unpriced.cost_usd, null);

    assert.equal(result.totals.cost_usd, priced.cost_usd);
    assert.equal(result.totals.pricing_coverage, "partial");
    assert.equal(result.totals.source_kind, "mixed");
    assert.deepEqual(
      result.totals.pricing_components.map((component) => component.source_kind).sort(),
      ["unpriced", "user_override"],
    );

    const productionTotals = computeRecordTotals(result.records);
    assert.equal(productionTotals.cost_usd, priced.cost_usd);
    assert.equal(productionTotals.pricing_coverage, "partial");
    assert.equal(productionTotals.source_kind, "mixed");
    assert.deepEqual(
      productionTotals.pricing_components.map((component) => component.source_kind).sort(),
      ["unpriced", "user_override"],
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("dedups repeated msgId via claudeMessageDedupKey across files", async () => {
  const home = await makeTmpHome();
  try {
    const fileA = await writeClaudeFixture([
      assistantLine({ msgId: "msg_dup", reqId: "req_1" }),
      assistantLine({ msgId: "msg_dup", reqId: "req_1" }),
    ], { home, file: "session-a.jsonl" });
    const fileB = await writeClaudeFixture([
      assistantLine({ msgId: "msg_dup", reqId: "req_1" }),
      assistantLine({ msgId: "msg_other", reqId: "req_2", timestamp: "2026-08-10T04:00:01.000Z" }),
    ], { home, file: "session-b.jsonl" });

    const result = await collectClaudeRequestUsageRecords({
      claudeProjectFiles: [fileA, fileB],
      pricingOptions: {},
    });

    assert.equal(result.records.length, 2);
    const ids = result.records.map((r) => r.message_id ?? null);
    assert.ok(!ids.includes(undefined));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("sub-agent messages without requestId are collected once (msgId-only dedup)", async () => {
  const home = await makeTmpHome();
  try {
    const filePath = await writeClaudeFixture([
      // Sub-agent / DeepSeek-style entries carry no requestId at all. A bare
      // `msgId && reqId` guard would fail open here and double count.
      assistantLine({ msgId: "msg_sub_1" }),
      assistantLine({ msgId: "msg_sub_1" }),
      assistantLine({ msgId: "msg_sub_2", timestamp: "2026-08-10T03:40:00.000Z" }),
    ], { home });

    const result = await collectClaudeRequestUsageRecords({
      claudeProjectFiles: [filePath],
      pricingOptions: {},
    });

    assert.equal(result.records.length, 2);
    assert.equal(result.totals.input_tokens, 200);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("skips entries with missing or all-zero usage", async () => {
  const home = await makeTmpHome();
  try {
    const filePath = await writeClaudeFixture([
      assistantLine({ msgId: "msg_no_usage", omitUsage: true }),
      assistantLine({ msgId: "msg_zero_usage", usage: {} }),
      assistantLine({ msgId: "msg_ok", timestamp: "2026-08-10T05:00:00.000Z" }),
      "not-json-at-all",
    ], { home });

    const result = await collectClaudeRequestUsageRecords({
      claudeProjectFiles: [filePath],
      pricingOptions: {},
    });

    assert.equal(result.records.length, 1);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("respects from/to boundaries and limit", async () => {
  const home = await makeTmpHome();
  try {
    const filePath = await writeClaudeFixture([
      assistantLine({ msgId: "msg_early", timestamp: "2026-08-01T00:00:00.000Z" }),
      assistantLine({ msgId: "msg_in_1", timestamp: "2026-08-10T01:00:00.000Z" }),
      assistantLine({ msgId: "msg_in_2", timestamp: "2026-08-10T02:00:00.000Z" }),
      assistantLine({ msgId: "msg_late", timestamp: "2026-08-20T00:00:00.000Z" }),
    ], { home });

    const result = await collectClaudeRequestUsageRecords({
      claudeProjectFiles: [filePath],
      from: "2026-08-10",
      to: "2026-08-11",
      pricingOptions: {},
    });
    assert.equal(result.records.length, 2);

    const limited = await collectClaudeRequestUsageRecords({
      claudeProjectFiles: [filePath],
      limit: 1,
      pricingOptions: {},
    });
    assert.equal(limited.records.length, 1);
    // Newest first, like the codex collector.
    assert.equal(limited.records[0].timestamp, "2026-08-20T00:00:00.000Z");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Endpoint integration: request-usage-records serves claude message events
// and stops double counting claude aggregates when events exist.
// ---------------------------------------------------------------------------

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

test("local API request-usage-records merges claude message events without aggregate double count", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-claude-rur-api-"));
  try {
    const claudeHome = path.join(tmp, "claude-home");
    await writeClaudeFixture([
      assistantLine({ msgId: "msg_api_1", reqId: "req_api_1", timestamp: "2026-08-10T03:12:45.000Z" }),
    ], { home: claudeHome });

    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(
      path.join(trackerDir, "config.json"),
      JSON.stringify({ dataDirectories: { claude: claudeHome } }),
      "utf8",
    );
    const queuePath = path.join(trackerDir, "queue.jsonl");
    await fs.writeFile(
      queuePath,
      JSON.stringify({
        hour_start: "2026-08-10T03:00:00.000Z",
        source: "claude",
        model: "claude-opus-4-6",
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 300,
        cache_creation_input_tokens: 20,
        reasoning_output_tokens: 0,
        total_tokens: 470,
        conversation_count: 1,
      }) + "\n",
      "utf8",
    );

    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: trackerDir,
    });

    const res = await call(
      handler,
      "/functions/tokentracker-request-usage-records?sources=claude&from=2026-08-10&to=2026-08-10",
    );
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body.toString("utf8"));
    assert.equal(body.ok, true);

    const claudeEvents = body.records.filter(
      (r) => r.source === "claude" && r.record_kind === "request_event",
    );
    assert.equal(claudeEvents.length, 1);
    assert.equal(claudeEvents[0].request_source, "claude_session_log");
    // Message-level events replace the aggregate rows — claude must not be
    // listed as aggregate-only, and no aggregate_bucket rows may remain.
    assert.ok(!body.aggregate_only_sources.includes("claude"));
    assert.equal(body.records.filter((r) => r.record_kind === "aggregate_bucket").length, 0);
    // Totals therefore count the message exactly once.
    assert.equal(body.totals.total_tokens, 470);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("local API falls back to claude aggregates when no message-level logs exist", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-claude-rur-fallback-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(
      path.join(trackerDir, "config.json"),
      JSON.stringify({ dataDirectories: { claude: path.join(tmp, "empty-claude-home") } }),
      "utf8",
    );
    const queuePath = path.join(trackerDir, "queue.jsonl");
    await fs.writeFile(
      queuePath,
      JSON.stringify({
        hour_start: "2026-08-10T03:00:00.000Z",
        source: "claude",
        model: "claude-opus-4-6",
        input_tokens: 10,
        output_tokens: 5,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 15,
        conversation_count: 1,
      }) + "\n",
      "utf8",
    );

    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: trackerDir,
    });

    const res = await call(
      handler,
      "/functions/tokentracker-request-usage-records?sources=claude&from=2026-08-10&to=2026-08-10",
    );
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body.toString("utf8"));
    assert.equal(body.ok, true);
    assert.ok(body.aggregate_only_sources.includes("claude"));
    assert.equal(body.records.filter((r) => r.record_kind === "aggregate_bucket").length, 1);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
