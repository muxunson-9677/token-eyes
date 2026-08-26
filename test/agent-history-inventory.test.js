"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildAgentHistoryInventory, sixMonthsAgo } = require("../src/lib/agent-history-inventory");

test("builds a six-month inventory with real registered names and no fabricated agent", () => {
  const inventory = buildAgentHistoryInventory({
    now: new Date("2026-08-22T00:00:00.000Z"),
    rows: [
      { source: "codex", hour_start: "2026-08-20T01:00:00.000Z", total_tokens: 10, cost_usd: 0.2 },
      { source: "workbuddy", hour_start: "2026-06-01T01:00:00.000Z", total_tokens: 20, cost_usd: null },
      { source: "cursor", hour_start: "2026-01-01T01:00:00.000Z", total_tokens: 99, cost_usd: 9 },
      { source: "not-registered", hour_start: "2026-08-20T01:00:00.000Z", total_tokens: 99, prompt: "must never escape" },
    ],
    installedSources: ["trae", "codebuddy"],
  });

  assert.deepEqual(inventory.map((item) => item.source), ["codex", "workbuddy", "trae", "codebuddy"]);
  assert.deepEqual(inventory.map((item) => item.agent_label), ["Codex", "WorkBuddy", "Trae", "CodeBuddy"]);
  assert.equal(inventory[0].history_state, "historical_usage");
  assert.equal(inventory[0].record_count, 1);
  assert.equal(inventory[0].total_tokens.value, 10);
  assert.equal(inventory[0].api_equivalent_usd.value, 0.2);
  assert.equal(inventory[1].api_equivalent_usd.value, null);
  assert.equal(inventory[2].history_state, "installed_no_history");
  assert.equal(inventory[2].total_tokens.value, null);
  assert.equal(JSON.stringify(inventory).includes("prompt"), false);
});

test("uses the last valid calendar day for the six-month boundary", () => {
  const since = sixMonthsAgo(new Date("2026-08-31T12:00:00.000Z"));

  assert.equal(since.toISOString(), "2026-02-28T12:00:00.000Z");
});
