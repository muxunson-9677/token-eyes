"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const EDGE_PATH = path.resolve(
  "dashboard/edge-patches/tokentracker-public-visibility.ts",
);

test("profile edge cannot write actual-cost rows with its service role", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  assert.doesNotMatch(source, /period_costs_usd/);
  assert.doesNotMatch(
    source,
    /\.from\("tokentracker_actual_cost_state"\)\s*\.upsert/s,
  );
  assert.match(source, /\.select\("share_actual_cost"\)/);
});

test("unchanged profile writes do not dirty or wake static leaderboard publication", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  const currentRead = source.indexOf(
    '.select("leaderboard_public, display_name, github_url, show_github_url, updated_at")',
  );
  const settingsWrite = source.indexOf(".upsert(", currentRead);
  assert.ok(currentRead >= 0 && settingsWrite > currentRead);
  assert.match(source, /normalizedDisplayName !== \(currentSettings\?\.display_name \?\? null\)/);
  assert.match(source, /normalizedGithubUrl !== \(currentSettings\?\.github_url \?\? null\)/);
  assert.match(source, /Boolean\(body\.show_github_url\) !== Boolean\(currentSettings\?\.show_github_url\)/);
  assert.match(source, /body\.leaderboard_public === true && currentSettings\?\.leaderboard_public !== true/);
});
