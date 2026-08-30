"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");

const {
  createSignedStaticFeedEnvelope,
  verifySignedStaticFeed,
} = require("../src/lib/signed-static-feed");

const NOW = Date.parse("2026-08-30T08:00:00.000Z");

function leaderboardPayload(overrides = {}) {
  return {
    schema_version: "token-eyes.leaderboard-snapshot/v1",
    snapshot_key: "total/tokens/all",
    generated_at: new Date(NOW).toISOString(),
    entries: [{ rank: 1, display_name: "Anonymous", total_tokens: "42" }],
    participant_count: 1,
    aggregate_total_tokens: 42,
    aggregate_total_cost_usd: 0.01,
    ...overrides,
  };
}

test("verifies exact signed leaderboard bytes and the requested fixed snapshot key", () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const envelope = createSignedStaticFeedEnvelope(leaderboardPayload(), keys.privateKey, {
    keyId: "token-eyes-static-2026-01",
  });

  const payload = verifySignedStaticFeed(envelope, {
    publicKey: keys.publicKey,
    expectedSchema: "token-eyes.leaderboard-snapshot/v1",
    expectedSnapshotKey: "total/tokens/all",
    nowMs: NOW,
    maxEntries: 50,
  });

  assert.equal(payload.entries[0].display_name, "Anonymous");
  assert.equal(envelope.algorithm, "Ed25519");
  assert.equal(envelope.key_id, "token-eyes-static-2026-01");
});

test("rejects a mismatched dimension, bad signature, replay, oversized list, and private identifiers", () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const options = {
    publicKey: keys.publicKey,
    expectedSchema: "token-eyes.leaderboard-snapshot/v1",
    expectedSnapshotKey: "total/tokens/all",
    nowMs: NOW,
    maxEntries: 50,
  };
  const sign = (payload) => createSignedStaticFeedEnvelope(payload, keys.privateKey, {
    keyId: "token-eyes-static-2026-01",
  });

  assert.throws(
    () => verifySignedStaticFeed(sign(leaderboardPayload({ snapshot_key: "today/tokens/all" })), options),
    /snapshot key/u,
  );

  const tampered = sign(leaderboardPayload());
  tampered.payload_b64 = Buffer.from(JSON.stringify(leaderboardPayload({ participant_count: 2 })))
    .toString("base64url");
  assert.throws(() => verifySignedStaticFeed(tampered, options), /signature/u);

  assert.throws(
    () => verifySignedStaticFeed(sign(leaderboardPayload({
      generated_at: new Date(NOW - 60_000).toISOString(),
    })), { ...options, minimumGeneratedAt: new Date(NOW).toISOString() }),
    /older than/u,
  );

  assert.throws(
    () => verifySignedStaticFeed(sign(leaderboardPayload({
      entries: Array.from({ length: 51 }, (_, index) => ({ rank: index + 1 })),
    })), options),
    /entry count/u,
  );

  assert.throws(
    () => verifySignedStaticFeed(sign(leaderboardPayload({
      entries: [{ rank: 1, source_breakdown: [{ user_id: "private-account-id" }] }],
    })), options),
    /private identifier/u,
  );
});
