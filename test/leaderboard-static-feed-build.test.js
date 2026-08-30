"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  listLeaderboardStaticDimensions,
} = require("../src/lib/leaderboard-static-snapshot");
const { verifySignedStaticFeed } = require("../src/lib/signed-static-feed");

test("complete static leaderboard build emits exactly 285 signed fixed objects", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-leaderboard-static-"));
  try {
    const keys = crypto.generateKeyPairSync("ed25519");
    const privatePath = path.join(tempRoot, "private.pem");
    const inputPath = path.join(tempRoot, "input.json");
    const outputPath = path.join(tempRoot, "output");
    fs.writeFileSync(privatePath, keys.privateKey.export({ type: "pkcs8", format: "pem" }));
    fs.writeFileSync(inputPath, JSON.stringify({
      generated_at: "2026-08-30T08:00:00.123456+00:00",
      dimensions: listLeaderboardStaticDimensions().map((dimension) => ({ ...dimension, rows: [] })),
    }));

    const result = spawnSync(process.execPath, [
      "scripts/build-leaderboard-static-feeds.mjs",
      "--private", privatePath,
      "--input", inputPath,
      "--output", outputPath,
      "--key-id", "token-eyes-static-test",
      "--require-complete", "true",
    ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Built 285 signed leaderboard objects/);

    const manifest = JSON.parse(fs.readFileSync(
      path.join(outputPath, "leaderboard", "manifest.json"),
      "utf8",
    ));
    assert.equal(manifest.object_count, 285);
    assert.equal(manifest.generated_at, "2026-08-30T08:00:00.123Z");
    assert.equal(new Set(manifest.objects.map((item) => item.key)).size, 285);
    const envelope = JSON.parse(fs.readFileSync(
      path.join(outputPath, "leaderboard", "30d", "tokens", "all.json"),
      "utf8",
    ));
    const payload = verifySignedStaticFeed(envelope, {
      publicKey: keys.publicKey,
      expectedSchema: "token-eyes.leaderboard-snapshot/v1",
      expectedSnapshotKey: "30d/tokens/all",
      nowMs: Date.parse("2026-08-30T08:00:00.000Z"),
      maxEntries: 50,
    });
    assert.deepEqual(payload.entries, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
