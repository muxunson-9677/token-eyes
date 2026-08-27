"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

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
  assert.match(source, /CONFIRMED_RESET_CONCEPT/u);
  assert.match(source, /SCHEDULED_RESET_CONCEPT/u);
  assert.match(source, /correlateTiboResetPosts/u);
  assert.match(source, /state\s*!==\s*"confirmed"/u);
  assert.match(source, /body:\s*candidate\.text/u);
  assert.match(source, /summary:\s*candidate\.text\.slice\(0,\s*240\)/u);
  assert.match(source, /filter\(isConfirmedRetainedAnnouncement\)/u);
  assert.doesNotMatch(source, /!CODEX_CONCEPT\.test\(text\)[\s\S]{0,120}!GLOBAL_RESET_CONCEPT\.test\(text\)/u);
});

test("collector semantics classify the real schedule and landing states separately", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  const readRegex = (name) => {
    const line = source.split(/\r?\n/u).find((value) => value.startsWith(`const ${name} = /`));
    assert.ok(line, `${name} must exist`);
    return vm.runInNewContext(line.slice(line.indexOf("=") + 1, -1).trim());
  };
  const confirmed = readRegex("CONFIRMED_RESET_CONCEPT");
  const scheduled = readRegex("SCHEDULED_RESET_CONCEPT");
  const scheduleText = "The banked reset will be there by 8pm PST. For all paid users of ChatGPT Work and Codex.";
  const landedText = "The banked reset has landed, I repeat, the banked reset has landed. Have an amazing weekend.";
  assert.equal(scheduled.test(scheduleText), true);
  assert.equal(confirmed.test(scheduleText), false);
  assert.equal(confirmed.test(landedText), true);
});
