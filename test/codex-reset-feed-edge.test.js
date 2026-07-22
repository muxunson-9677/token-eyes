const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { verifyCodexResetFeed } = require("../src/lib/codex-reset-feed");

test("reset feed edge serves the committed signed envelope without secrets", () => {
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
  assert.doesNotMatch(source, /API_KEY|JWT_SECRET|PRIVATE_KEY/u);
  assert.deepEqual(verifyCodexResetFeed(envelope, {
    publicKey,
    nowMs: Date.parse("2026-07-22T00:00:00.000Z"),
  }), {
    generated_at: "2026-07-20T14:29:11.951Z",
    announcements: [],
  });
});
