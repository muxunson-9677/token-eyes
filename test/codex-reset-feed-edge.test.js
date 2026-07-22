const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { verifyCodexResetFeed } = require("../src/lib/codex-reset-feed");

test("reset feed edge reads a private singleton and keeps a signed fallback", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../dashboard/edge-patches/tokentracker-codex-reset-feed.ts"),
    "utf8",
  );
  const envelope = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../dashboard/public/.well-known/token-eyes/codex-reset-feed.json"),
    "utf8",
  ));
  const publicKey = fs.readFileSync(
    path.join(__dirname, "../src/lib/codex-reset-feed-public-key.pem"),
    "utf8",
  );

  assert.match(source, /codex-reset-feed\.json/u);
  assert.match(source, /Deno\.env\.get\("API_KEY"\)/u);
  assert.match(source, /tokentracker_codex_reset_feed_state/u);
  assert.match(source, /\.eq\("singleton", true\)/u);
  assert.match(source, /if-none-match/u);
  assert.doesNotMatch(source, /SIGNING_KEY|PRIVATE_KEY/u);
  assert.deepEqual(verifyCodexResetFeed(envelope, {
    publicKey,
    nowMs: Date.parse("2026-07-22T05:00:00.000Z"),
  }), {
    generated_at: "2026-07-22T04:27:28.361Z",
    announcements: [],
  });
});
