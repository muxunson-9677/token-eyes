"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert");

const ROOT = path.join(__dirname, "..");
const read = (name) =>
  fs.readFileSync(path.join(ROOT, "dashboard", "edge-patches", name), "utf8");

test("legacy public InsForge leaderboard reader is removed", () => {
  assert.equal(
    fs.existsSync(path.join(ROOT, "dashboard", "edge-patches", "tokentracker-leaderboard.ts")),
    false,
  );
  const api = fs.readFileSync(path.join(ROOT, "dashboard", "src", "lib", "api.ts"), "utf8");
  assert.match(api, /\$\{publicBaseUrl\}\/leaderboard\/\$\{safePeriod\}\/\$\{safeMetric\}\/\$\{safeSource\}\.json/);
  assert.doesNotMatch(api, /fetchInsforgeFunction\("tokentracker-leaderboard"/);
  for (const retired of [
    "tokentracker-badge-svg.ts",
    "tokentracker-badge.ts",
    "tokentracker-embed-svg.ts",
    "tokentracker-profile-likes.ts",
  ]) {
    assert.equal(
      fs.existsSync(path.join(ROOT, "dashboard", "edge-patches", retired)),
      false,
      `${retired} must not restore an anonymous per-user InsForge read`,
    );
  }
});

test("non-leaderboard share flows never fetch a public leaderboard snapshot", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "dashboard", "src", "ui", "share", "use-share-card-data.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /getLeaderboard/);
  assert.doesNotMatch(source, /lib\/api/);
});

test("dashboard route preloading cannot read a leaderboard snapshot before the page opens", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "dashboard", "src", "lib", "dashboard-preload.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /import\s+\{\s*getLeaderboard\s*\}/);
  assert.doesNotMatch(source, /getLeaderboard\s*\(/);
});

test("authenticated self-rank endpoint derives identity only from a verified JWT", () => {
  const source = read("tokentracker-leaderboard-me.ts");

  assert.match(source, /\.from\("tokentracker_leaderboard_snapshots_v2"\)/);
  assert.match(source, /Authorization/);
  assert.match(source, /verifiedUserIdFromJwt|verifiedUserId/);
  assert.match(source, /auth\.getCurrentUser\(\)/);
  assert.match(source, /const PERIODS\s*=\s*new Set\(\["today", "week", "30d", "month", "total"\]\)/);
  for (const sourceName of [
    "every-code", "trae", "kilo-cli", "kilocode", "roocode", "kimi-code",
    "codebuddy", "workbuddy", "omp", "pi", "craft", "grok", "zed",
    "goose", "droid", "antigravity", "deepseek-harness",
  ]) {
    assert.match(source, new RegExp(`"${sourceName}"`));
  }
  assert.doesNotMatch(source, /"other"/);
  assert.match(source, /\.eq\("user_id",\s*userId\)/);
  assert.doesNotMatch(source, /searchParams\.get\("user_id"\)/);
  assert.match(source, /Cache-Control":\s*"private, no-store"/);
});

test("direct leaderboard consumers read the v2 snapshot table", () => {
  for (const name of [
    "tokentracker-leaderboard-me.ts",
    "tokentracker-leaderboard-profile.ts",
  ]) {
    const source = read(name);
    assert.match(source, /tokentracker_leaderboard_snapshots_v2/, name);
    assert.doesNotMatch(
      source,
      /\.from\("tokentracker_leaderboard_snapshots"\)/,
      name,
    );
  }
});

test("detailed leaderboard profiles are authenticated self-only, not a public per-user read", () => {
  const source = read("tokentracker-leaderboard-profile.ts");
  assert.match(source, /if \(!callerUserId\) return json\(\{ error: "Unauthorized" \}, 401\)/);
  assert.match(source, /if \(callerUserId !== userId\) return json\(\{ error: "Forbidden" \}, 403\)/);
  assert.doesNotMatch(source, /if \(!isSelf\)/);
});
