"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Reset candidate collection is local/reviewable and no longer an InsForge Edge collector", () => {
  const collector = fs.readFileSync(
    path.resolve(__dirname, "../scripts/collect-codex-reset-candidates.mjs"),
    "utf8",
  );
  const signer = fs.readFileSync(
    path.resolve(__dirname, "../scripts/sign-codex-reset-feed.mjs"),
    "utf8",
  );
  assert.equal(fs.existsSync(
    path.resolve(__dirname, "../dashboard/edge-patches/tokentracker-codex-reset-collector.ts"),
  ), false);
  assert.match(collector, /review_items/);
  assert.match(collector, /--manual/);
  assert.match(collector, /X_BEARER_TOKEN/);
  assert.match(signer, /review\.status\s*!==\s*"approved"/);
  assert.match(signer, /source_verified\s*!==\s*true/);
  assert.doesNotMatch(`${collector}\n${signer}`, /@insforge|INSFORGE_BASE_URL|API_KEY/);
});
