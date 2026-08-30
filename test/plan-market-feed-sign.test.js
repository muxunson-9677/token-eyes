"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const {
  PLAN_MARKET_FEED_SCHEMA,
  PLAN_MARKET_FEED_URL,
  hashPlanMarketCatalog,
} = require("../src/lib/plan-market");
const { verifySignedStaticFeed } = require("../src/lib/signed-static-feed");

test("Plan Market signer creates an offline-verifiable static object", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "token-eyes-plan-market-sign-"));
  const privatePath = path.join(tempDir, "private.pem");
  const outputPath = path.join(tempDir, "feed.json");
  const keys = crypto.generateKeyPairSync("ed25519");
  await fsp.writeFile(privatePath, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });

  try {
    execFileSync(process.execPath, [
      path.join(__dirname, "../scripts/sign-plan-market-feed.mjs"),
      "--private", privatePath,
      "--input", path.join(__dirname, "../shared/plan-market-catalog.json"),
      "--output", outputPath,
      "--generated-at", "2026-08-30T08:00:00.000Z",
    ]);
    const envelope = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const payload = verifySignedStaticFeed(envelope, {
      publicKey: keys.publicKey,
      expectedSchema: PLAN_MARKET_FEED_SCHEMA,
      nowMs: Date.parse("2026-08-30T08:00:00.000Z"),
    });
    assert.equal(payload.source_url, PLAN_MARKET_FEED_URL);
    assert.equal(payload.catalog_sha256, hashPlanMarketCatalog(payload.catalog));
    assert.equal(payload.generated_at, "2026-08-30T08:00:00.000Z");
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("Plan Market signer binds a safe staging object URL into the signed payload", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "token-eyes-plan-market-sign-staging-"));
  const privatePath = path.join(tempDir, "private.pem");
  const outputPath = path.join(tempDir, "feed.json");
  const sourceUrl = "https://token-eyes-leaderboard-cache-staging.example.workers.dev/v1/plan-market/feed.json";
  const keys = crypto.generateKeyPairSync("ed25519");
  await fsp.writeFile(privatePath, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });

  try {
    execFileSync(process.execPath, [
      path.join(__dirname, "../scripts/sign-plan-market-feed.mjs"),
      "--private", privatePath,
      "--input", path.join(__dirname, "../shared/plan-market-catalog.json"),
      "--output", outputPath,
      "--generated-at", "2026-08-30T08:00:00.000Z",
      "--source-url", sourceUrl,
    ]);
    const envelope = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const payload = verifySignedStaticFeed(envelope, {
      publicKey: keys.publicKey,
      expectedSchema: PLAN_MARKET_FEED_SCHEMA,
      nowMs: Date.parse("2026-08-30T08:00:00.000Z"),
    });
    assert.equal(payload.source_url, sourceUrl);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});
