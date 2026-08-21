"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

async function call(handler, endpoint) {
  const url = new URL(`http://127.0.0.1${endpoint}`);
  const chunks = [];
  const handled = await handler(
    { method: "GET", headers: { host: "127.0.0.1" } },
    { writeHead() {}, end(body) { if (body) chunks.push(body); } },
    url,
  );
  assert.equal(handled, true);
  return JSON.parse(chunks.join(""));
}

test("value and realtime endpoints return privacy-safe, explicit evidence payloads", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-value-realtime-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(queuePath, `${JSON.stringify({
      source: "claude", model: "claude-sonnet", hour_start: "2026-08-21T08:00:00.000Z",
      input_tokens: 80, output_tokens: 20, total_tokens: 100, conversation_count: 1,
    })}\n`);
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({
      spendRecords: [{ source: "subscription", amount_usd: 8, start_date: "2026-08-01", end_date: "2026-08-31" }],
    }));
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-08-21T08:30:00.000Z"),
      codexLifecycleProvider: async () => [{
        agent: "codex", sessionId: "local-session", status: "running", updatedAt: "2026-08-21T08:25:00.000Z",
        sessionLabel: "must not be copied into a prompt or body",
      }],
    });

    const value = await call(handler, "/functions/tokentracker-value-comparison?range=month");
    assert.equal(value.range, "month");
    assert.equal(value.actual_spend.total_usd.evidence_state, "partial");
    assert.equal(value.api_equivalent_value.unit, "USD");

    const realtime = await call(handler, "/functions/tokentracker-realtime-sessions?range=today");
    assert.equal(typeof realtime.revision, "string");
    assert.equal(realtime.sessions.some((item) => item.state === "running"), true);
    assert.equal(JSON.stringify(realtime).includes("prompt"), false);
    assert.equal(JSON.stringify(realtime).includes("authorization"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

