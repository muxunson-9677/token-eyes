"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("anonymous per-user leaderboard badge edges stay retired", () => {
  const edgeRoot = path.resolve(__dirname, "../dashboard/edge-patches");
  for (const file of [
    "tokentracker-badge-svg.ts",
    "tokentracker-badge.ts",
    "tokentracker-embed-svg.ts",
    "tokentracker-profile-likes.ts",
  ]) {
    assert.equal(fs.existsSync(path.join(edgeRoot, file)), false, file);
  }

  const modal = fs.readFileSync(
    path.resolve(__dirname, "../dashboard/src/components/leaderboard/LeaderboardProfileModal.jsx"),
    "utf8",
  );
  assert.doesNotMatch(modal, /tokentracker-(?:badge|embed)/u);
  assert.doesNotMatch(modal, /Copy README badge/u);
  assert.doesNotMatch(modal, /LikeButton/u);
});
