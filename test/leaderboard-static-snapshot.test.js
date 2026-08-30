"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  buildSignedLeaderboardStaticSnapshot,
} = require("../src/lib/leaderboard-static-snapshot");
const { verifySignedStaticFeed } = require("../src/lib/signed-static-feed");

test("static leaderboard publisher signs a fixed Top 50 without account identifiers", () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const rows = Array.from({ length: 55 }, (_, index) => ({
    rank: index + 1,
    user_id: `private-${index}`,
    public_entry_id: `public-${index}`,
    display_name: `User ${index}`,
    avatar_url: index === 0
      ? "https://insforge.example/functions/tokentracker-avatar-public?hash=secret"
      : null,
    total_tokens: String(1000 - index),
    estimated_cost_usd: index / 100,
    actual_cost_usd: null,
    github_url: index === 0 ? "https://evil.example/private" : null,
    source_breakdown: index === 0 ? [{
      source: "codex",
      total_tokens: 5,
      estimated_cost_usd: 0.1,
      unpriced_tokens: 0,
      user_id: "nested-private-id",
      raw_prompt: "nested-private-prompt",
    }] : [],
    generated_at: "2026-08-30T08:00:00.000Z",
    pricing_version: "2026-08-30",
  }));

  const envelope = buildSignedLeaderboardStaticSnapshot({
    period: "total",
    metric: "tokens",
    source: "all",
    rows,
    privateKey: keys.privateKey,
    keyId: "token-eyes-static-test",
    generatedAt: "2026-08-30T08:00:00.000Z",
  });
  const payload = verifySignedStaticFeed(envelope, {
    publicKey: keys.publicKey,
    expectedSchema: "token-eyes.leaderboard-snapshot/v1",
    expectedSnapshotKey: "total/tokens/all",
    nowMs: Date.parse("2026-08-30T08:00:00.000Z"),
    maxEntries: 50,
  });

  assert.equal(payload.entries.length, 50);
  assert.equal(payload.entries[0].public_entry_id, "public-0");
  assert.equal(payload.participant_count, 55);
  assert.equal(payload.ranked_entry_count, 50);
  assert.equal(payload.aggregate_total_tokens, rows.slice(0, 50).reduce((sum, row) => sum + Number(row.total_tokens), 0));
  assert.doesNotMatch(JSON.stringify(envelope), /private-/);
  assert.equal(payload.entries[0].user_id, undefined);
  assert.equal(payload.entries[0].avatar_url, null);
  assert.equal(payload.entries[0].github_url, null);
  assert.deepEqual(payload.entries[0].source_breakdown, [{
    source: "codex",
    total_tokens: "5",
    estimated_cost_usd: 0.1,
    unpriced_tokens: "0",
  }]);
  assert.doesNotMatch(JSON.stringify(envelope), /nested-private/u);
});

test("static leaderboard publisher rejects non-whitelisted dimensions and missing public ids", () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  assert.throws(() => buildSignedLeaderboardStaticSnapshot({
    period: "forever",
    metric: "tokens",
    source: "all",
    rows: [],
    privateKey: keys.privateKey,
    keyId: "token-eyes-static-test",
    generatedAt: "2026-08-30T08:00:00.000Z",
  }), /dimension/u);
  assert.throws(() => buildSignedLeaderboardStaticSnapshot({
    period: "total",
    metric: "tokens",
    source: "all",
    rows: [{ rank: 1, user_id: "private", display_name: "No public id" }],
    privateKey: keys.privateKey,
    keyId: "token-eyes-static-test",
    generatedAt: "2026-08-30T08:00:00.000Z",
  }), /public entry id/u);
});

test("static leaderboard publisher canonicalizes the PostgreSQL timestamptz returned by InsForge", () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const envelope = buildSignedLeaderboardStaticSnapshot({
    period: "today",
    metric: "tokens",
    source: "all",
    rows: [],
    privateKey: keys.privateKey,
    keyId: "token-eyes-static-test",
    generatedAt: "2026-08-29T23:25:31.453014+00:00",
  });
  const payload = verifySignedStaticFeed(envelope, {
    publicKey: keys.publicKey,
    expectedSchema: "token-eyes.leaderboard-snapshot/v1",
    expectedSnapshotKey: "today/tokens/all",
    nowMs: Date.parse("2026-08-29T23:25:31.453Z"),
    maxEntries: 50,
  });
  assert.equal(payload.generated_at, "2026-08-29T23:25:31.453Z");
});
