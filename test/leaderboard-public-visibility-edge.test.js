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
