"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const EDGE_PATH = path.join(
  __dirname,
  "../dashboard/edge-patches/tokentracker-codex-reset-collector.ts",
);

test("collector discovers Tibo posts without a paid search dependency and verifies each match through X", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");

  assert.match(source, /LEADERBOARD_SCHEDULER_SECRET/u);
  assert.match(source, /Authorization/u);
  assert.match(source, /https:\/\/status\.openai\.com\/api\/v2\/incidents\.json/u);
  assert.match(source, /https:\/\/api\.fxtwitter\.com\/2\/profile\/thsottiaux\/statuses/u);
  assert.match(source, /https:\/\/publish\.x\.com\/oembed/u);
  assert.match(source, /author_url/u);
  assert.match(source, /https:\/\/x\.com\/thsottiaux/u);
  assert.doesNotMatch(source, /TAVILY_API_KEY/u);
  assert.match(source, /CODEX_RESET_SIGNING_KEY_PKCS8_B64/u);
  assert.match(source, /Ed25519/u);
  assert.match(source, /tokentracker_codex_reset_feed_state/u);
  assert.match(source, /x_status:\s*xStatus/u);
  assert.doesNotMatch(source, /pay-as-you-go|billing|credit card/iu);
});

test("collector backfills and retains exact Tibo reset announcements for 30 days", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");

  assert.match(source, /url\.pathname\.match\(\/\^\\\/thsottiaux\\\/status\\\//u);
  assert.match(source, /\(\[0-9\]\+\)/u);
  assert.match(source, /X_WINDOW_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60_000/u);
  assert.match(source, /ANNOUNCEMENT_RETENTION_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60_000/u);
  assert.match(source, /cursor\?\.bottom/u);
  assert.match(source, /searchParams\.set\("cursor"/u);
  assert.match(source, /MAX_X_PAGES/u);
  assert.match(source, /\.slice\(0,\s*100\)/u);
  assert.match(source, /RESET_CONCEPT/u);
  assert.match(source, /CODEX_CONCEPT/u);
  assert.match(source, /reset_kind/u);
  assert.match(source, /reset_scope/u);
  assert.match(source, /classifyResetKind/u);
  assert.match(source, /classifyResetScope/u);
});
