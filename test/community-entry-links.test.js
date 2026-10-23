const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const publicEntryFiles = [
  "dashboard/index.html",
  "dashboard/share.html",
  "dashboard/public/llms.txt",
  "dashboard/src/ui/components/HeaderGithubStar.jsx",
  "src/commands/init.js",
];

test("community download and contribution entry points use the Token Eyes repository", () => {
  const content = publicEntryFiles
    .map((relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8"))
    .join("\n");

  assert.match(content, /https:\/\/github\.com\/muxunson-9677\/token-eyes/);
  assert.match(content, /https:\/\/github\.com\/muxunson-9677\/token-eyes\/issues/);
  assert.doesNotMatch(content, /https:\/\/github\.com\/mm7894215\/TokenTracker(?:\/issues)?/);
});
