"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const EDGE_FILES = [
  "tokentracker-leaderboard.ts",
  "tokentracker-leaderboard-me.ts",
  "tokentracker-leaderboard-profile.ts",
  "tokentracker-public-visibility.ts",
  "tokentracker-avatar.ts",
  "tokentracker-avatar-public.ts",
  "tokentracker-leaderboard-refresh.ts",
];

test("deployed leaderboard edges accept InsForge Cloud's reserved API_KEY", () => {
  for (const file of EDGE_FILES) {
    const source = fs.readFileSync(
      path.resolve("dashboard/edge-patches", file),
      "utf8",
    );
    assert.match(source, /Deno\.env\.get\("API_KEY"\)/, file);
  }
});

test("avatar URL uses the public edge hash query contract", () => {
  const source = fs.readFileSync(
    path.resolve("dashboard/edge-patches/tokentracker-avatar.ts"),
    "utf8",
  );
  assert.match(source, /`\$\{publicBase\}\?hash=\$\{hash\}`/);
});

test("authenticated edges ask InsForge to validate current asymmetric JWTs", () => {
  for (const file of [
    "tokentracker-leaderboard-me.ts",
    "tokentracker-leaderboard-profile.ts",
    "tokentracker-public-visibility.ts",
    "tokentracker-avatar.ts",
  ]) {
    const source = fs.readFileSync(
      path.resolve("dashboard/edge-patches", file),
      "utf8",
    );
    assert.match(source, /\.auth\.getCurrentUser\(\)/, file);
    assert.doesNotMatch(source, /Deno\.env\.get\("JWT_SECRET"\)/, file);
  }
});

test("profile edge falls back to privacy-safe snapshots without legacy hourly cloud data", () => {
  const source = fs.readFileSync(
    path.resolve("dashboard/edge-patches/tokentracker-leaderboard-profile.ts"),
    "utf8",
  );
  assert.match(source, /total_tokens, estimated_cost_usd, source_breakdown/);
  assert.doesNotMatch(source, /return json\(\{ error: \(e as Error\)\.message \|\| "scan failed" \}, 500\)/);
});
