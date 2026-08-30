const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { verifyCodexResetFeed } = require("../src/lib/codex-reset-feed");

test("reset feed is signed static content and has no public InsForge read edge", () => {
  const envelope = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../dashboard/public/.well-known/token-eyes/codex-reset-feed.json"),
    "utf8",
  ));
  const publicKey = fs.readFileSync(
    path.join(__dirname, "../src/lib/codex-reset-feed-public-key.pem"),
    "utf8",
  );

  assert.equal(fs.existsSync(
    path.join(__dirname, "../dashboard/edge-patches/tokentracker-codex-reset-feed.ts"),
  ), false);
  assert.deepEqual(verifyCodexResetFeed(envelope, {
    publicKey,
    nowMs: Date.parse("2026-07-22T05:00:00.000Z"),
  }), {
    generated_at: "2026-07-22T04:27:28.361Z",
    announcements: [],
  });
});
