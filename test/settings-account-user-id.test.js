"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("Settings account section exposes the signed-in user id for README badges", () => {
  const hookSrc = read("dashboard/src/components/settings/useAccountProfileSettings.js");
  const sectionSrc = read("dashboard/src/components/settings/AccountSection.jsx");
  const copyCsv = read("dashboard/src/content/copy.csv");

  assert.match(hookSrc, /userId: state\.userId/, "expected account settings hook to expose userId");
  assert.match(sectionSrc, /<UserIdRow userId=\{settings\.userId\}/, "expected account section to render user id row");
  assert.doesNotMatch(sectionSrc, /CloudSyncRow/, "cloud sync row should not be visible in Token Eyes MVP");
  assert.doesNotMatch(sectionSrc, /PublicProfileToggleRow/, "public profile row should not be visible in Token Eyes MVP");
  assert.match(sectionSrc, /navigator\.clipboard\.writeText\(userId\)/, "expected copy button to copy userId");
  assert.match(copyCsv, /settings\.account\.userId,/, "expected user id label in copy registry");
  assert.match(copyCsv, /settings\.account\.copyUserId,/, "expected copy aria label in copy registry");
});
