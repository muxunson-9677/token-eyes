"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

async function call(handler, endpoint) {
  const url = new URL(`http://localhost${endpoint}`);
  const chunks = [];
  const req = {
    method: "GET",
    url: url.pathname + url.search,
    headers: { host: "localhost" },
  };
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead() {},
    write(chunk) {
      chunks.push(chunk);
    },
    end(body) {
      if (body) chunks.push(body);
    },
  };
  assert.equal(await handler(req, res, url), true);
  return JSON.parse(chunks.join(""));
}

test("usage summary reports ledger provenance, deduplication and reconciliation", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "token-eyes-integrity-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const first = {
      source: "claude",
      model: "claude-sonnet-4-6",
      hour_start: "2026-07-29T08:00:00.000Z",
      input_tokens: 100,
      output_tokens: 20,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 120,
      billable_total_tokens: 120,
      conversation_count: 1,
    };
    const latest = {
      ...first,
      input_tokens: 150,
      output_tokens: 30,
      total_tokens: 180,
      billable_total_tokens: 180,
      conversation_count: 2,
    };
    await fs.promises.writeFile(
      queuePath,
      `${JSON.stringify(first)}\n${JSON.stringify(latest)}\n{broken\n`,
      "utf8",
    );

    const payload = await call(
      createLocalApiHandler({ queuePath, trackerDataDir: tmp }),
      "/functions/tokentracker-usage-summary?from=2026-07-29&to=2026-07-29&tz=UTC&sources=claude",
    );

    assert.equal(payload.totals.total_tokens, 180);
    assert.deepEqual(payload.data_integrity, {
      raw_records: 3,
      valid_records: 1,
      duplicate_records: 1,
      malformed_records: 1,
      ignored_synthetic_records: 0,
      updated_at: payload.data_integrity.updated_at,
      dedupe_basis: "latest_cumulative_bucket",
      visible_records: 1,
      visible_from: "2026-07-29T08:00:00.000Z",
      visible_to: "2026-07-29T08:00:00.000Z",
      displayed_total_tokens: 180,
      reconciled_total_tokens: 180,
      token_delta: 0,
      component_token_delta: 0,
      component_mismatch_records: 0,
      status: "attention",
      user_action_required: true,
    });
    assert.match(payload.data_integrity.updated_at, /^\d{4}-\d{2}-\d{2}T/u);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("usage summary flags totals whose token components do not reconcile", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "token-eyes-components-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await fs.promises.writeFile(queuePath, `${JSON.stringify({
      source: "codex",
      model: "gpt-5.5",
      hour_start: "2026-06-02T02:00:00.000Z",
      input_tokens: 43745,
      cached_input_tokens: 158848,
      cache_creation_input_tokens: 0,
      output_tokens: 1784,
      reasoning_output_tokens: 455,
      total_tokens: 214151,
      billable_total_tokens: 214151,
      conversation_count: 8,
    })}\n`, "utf8");

    const payload = await call(
      createLocalApiHandler({ queuePath, trackerDataDir: tmp }),
      "/functions/tokentracker-usage-summary?from=2026-06-02&to=2026-06-02&tz=UTC&sources=codex",
    );

    assert.equal(payload.data_integrity.token_delta, 0);
    assert.equal(payload.data_integrity.component_token_delta, 9774);
    assert.equal(payload.data_integrity.component_mismatch_records, 1);
    assert.equal(payload.data_integrity.status, "verified");
    assert.equal(payload.data_integrity.user_action_required, false);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
