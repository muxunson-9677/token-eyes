"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const EDGE_PATH = path.join(
  __dirname,
  "../dashboard/edge-patches/tokentracker-codex-reset-collector.ts",
);

test("collector is scheduler-only and never falls through to paid search", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");

  assert.match(source, /LEADERBOARD_SCHEDULER_SECRET/u);
  assert.match(source, /Authorization/u);
  assert.match(source, /https:\/\/status\.openai\.com\/api\/v2\/incidents\.json/u);
  assert.match(source, /https:\/\/api\.tavily\.com\/search/u);
  assert.match(source, /TAVILY_API_KEY/u);
  assert.match(source, /TAVILY_INTERVAL_MS\s*=\s*60\s*\*\s*60_000/u);
  assert.match(source, /search_depth:\s*"basic"/u);
  assert.match(source, /max_results:\s*10/u);
  assert.match(source, /include_domains:\s*\["x\.com"\]/u);
  assert.match(source, /CODEX_RESET_SIGNING_KEY_PKCS8_B64/u);
  assert.match(source, /Ed25519/u);
  assert.match(source, /tokentracker_codex_reset_feed_state/u);
  assert.match(source, /tavily_status:\s*tavilyStatus/u);
  assert.doesNotMatch(source, /pay-as-you-go|billing|credit card/iu);
});

test("collector accepts only exact recent Tibo X status URLs", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");

  assert.match(source, /url\.pathname\.match\(\/\^\\\/thsottiaux\\\/status\\\//u);
  assert.match(source, /\(\[0-9\]\+\)/u);
  assert.match(source, /X_WINDOW_MS\s*=\s*48\s*\*\s*60\s*\*\s*60_000/u);
  assert.match(source, /RESET_CONCEPT/u);
  assert.match(source, /CODEX_CONCEPT/u);
});
