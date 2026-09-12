"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  createSignedCodexResetFeedEnvelope,
  isConfirmedResetAnnouncement,
  validateCodexResetFeedPayload,
  verifyCodexResetFeed,
} = require("../src/lib/codex-reset-feed");

const NOW = Date.parse("2026-07-20T08:00:00.000Z");
const X_POST_ID = "2078990367241046272";
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");

function announcement(overrides = {}) {
  return {
    id: "codex-reset-promo-2026-07",
    type: "official_reset_announcement",
    title: "Codex 重置或额外额度活动",
    summary: "可能适用于你的账户，请前往官方页面确认。",
    body: "完整的官方重置声明正文。\n第二段保留原始换行。",
    source_author: "thsottiaux",
    source_post_id: X_POST_ID,
    source_url: `https://x.com/thsottiaux/status/${X_POST_ID}`,
    reset_kind: "hard",
    reset_scope: "all_codex_work_users",
    official_url: "https://help.openai.com/en/articles/20001271",
    published_at: "2026-07-20T07:00:00.000Z",
    expires_at: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function payload(announcements = [announcement()]) {
  return {
    generated_at: "2026-07-20T07:30:00.000Z",
    announcements,
  };
}

function envelope(value = payload()) {
  return createSignedCodexResetFeedEnvelope(value, privateKey);
}

test("verifies exact signed bytes before parsing and returns the validated payload", () => {
  assert.deepEqual(
    verifyCodexResetFeed(envelope(), { publicKey, nowMs: NOW }),
    payload(),
  );
  const changed = envelope();
  const bytes = Buffer.from(changed.payload_b64, "base64url");
  bytes[bytes.length - 2] ^= 1;
  changed.payload_b64 = bytes.toString("base64url");
  assert.throws(
    () => verifyCodexResetFeed(changed, { publicKey, nowMs: NOW }),
    /signature/i,
  );
});

test("day-only official announcements cannot claim an exact time", () => {
  const day = announcement({ published_at: "2026-07-20T00:00:00.000Z", published_precision: "day" });
  assert.equal(validateCodexResetFeedPayload(payload([day]), { nowMs: NOW }).announcements[0].published_precision, "day");
  assert.throws(() => validateCodexResetFeedPayload(payload([{ ...day, published_at: "2026-07-20T01:00:00.000Z" }]), { nowMs: NOW }), /precision/);
  assert.throws(() => validateCodexResetFeedPayload(payload([{ ...day, published_precision: "guess" }]), { nowMs: NOW }), /precision/);
});

test("rejects malformed Base64URL, bad signatures, and unsupported envelopes", () => {
  const malformed = envelope();
  malformed.payload_b64 += "=";
  assert.throws(() => verifyCodexResetFeed(malformed, { publicKey, nowMs: NOW }), /base64url/i);

  const badSignature = envelope();
  badSignature.signature_b64 = Buffer.alloc(64).toString("base64url");
  assert.throws(() => verifyCodexResetFeed(badSignature, { publicKey, nowMs: NOW }), /signature/i);

  assert.throws(
    () => verifyCodexResetFeed({ ...envelope(), version: 2 }, { publicKey, nowMs: NOW }),
    /version/i,
  );
});

test("rejects expired, duplicate, oversized, and unsupported announcements", () => {
  const invalidPayloads = [
    payload([announcement({ expires_at: "2026-07-20T07:59:59.999Z" })]),
    payload([announcement(), announcement()]),
    payload([announcement({ title: "x".repeat(81) })]),
    payload([announcement({ summary: "x".repeat(241) })]),
    payload([announcement({ body: "x".repeat(4001) })]),
    payload([announcement({ type: "banked_reset_available" })]),
    payload([announcement({ reset_kind: "weekly" })]),
    payload([announcement({ reset_scope: "everyone_maybe" })]),
    payload(Array.from({ length: 21 }, (_, index) => announcement({
      id: `announcement-${index}`,
      source_post_id: String(BigInt(X_POST_ID) + BigInt(index)),
      source_url: `https://x.com/thsottiaux/status/${BigInt(X_POST_ID) + BigInt(index)}`,
    }))),
  ];
  for (const value of invalidPayloads) {
    assert.throws(
      () => verifyCodexResetFeed(envelope(value), { publicKey, nowMs: NOW }),
      /feed|announcement|expired|duplicate|length|type/i,
    );
  }
});

test("accepts a signed rolling feed by dropping expired history when live announcements remain", () => {
  const expired = announcement({
    id: "expired-history",
    source_post_id: "2000000000000000001",
    source_url: "https://x.com/thsottiaux/status/2000000000000000001",
    expires_at: "2026-07-20T07:59:59.999Z",
  });
  const live = announcement({
    id: "live-announcement",
    source_post_id: "2000000000000000002",
    source_url: "https://x.com/thsottiaux/status/2000000000000000002",
  });
  const verified = verifyCodexResetFeed(
    envelope(payload([expired, live])),
    { publicKey, nowMs: NOW },
  );
  assert.deepEqual(verified.announcements, [live]);
});

test("retains full announcement bodies and deduplicates the canonical X post", () => {
  const longBody = `${"完整正文 ".repeat(300)}\n最后一段。`;
  const item = announcement({ body: longBody });
  assert.equal(
    verifyCodexResetFeed(envelope(payload([item])), { publicKey, nowMs: NOW })
      .announcements[0].body,
    longBody,
  );

  assert.throws(
    () => validateCodexResetFeedPayload(payload([
      announcement(),
      announcement({ id: "same-post-different-feed-id" }),
    ]), { nowMs: NOW }),
    /duplicate.*source|duplicate.*post/i,
  );
});

test("distinguishes a scheduled reset from its confirmed landing without guessing a timestamp", () => {
  const scheduled = announcement({
    body: "The banked reset will be there by 8pm PST. For all paid users of ChatGPT Work and Codex.",
  });
  const landed = announcement({
    body: "The banked reset has landed, I repeat, the banked reset has landed. Have an amazing weekend.",
  });
  assert.equal(isConfirmedResetAnnouncement(scheduled), false);
  assert.equal(isConfirmedResetAnnouncement(landed), true);
  assert.equal(isConfirmedResetAnnouncement({
    ...scheduled,
    announcement_state: "confirmed",
  }), true);
  assert.throws(
    () => validateCodexResetFeedPayload(payload([
      announcement({ announcement_state: "scheduled" }),
    ]), { nowMs: NOW }),
    /state/i,
  );
});

test("allows only exact official HTTPS links and matching X source metadata", () => {
  const invalidAnnouncements = [
    announcement({ official_url: "http://help.openai.com/article" }),
    announcement({ official_url: "https://help.openai.com.evil.example/article" }),
    announcement({ official_url: "https://platform.openai.com/docs" }),
    announcement({ source_url: `https://x.com/OpenAI/status/${X_POST_ID}` }),
    announcement({ source_author: "OpenAI" }),
    announcement({ source_post_id: "123" }),
    announcement({ source_url: `https://x.com/thsottiaux_/status/${X_POST_ID}` }),
    announcement({ source_url: `https://x.com/thsottiaux/status/${X_POST_ID}?s=20` }),
  ];
  for (const item of invalidAnnouncements) {
    assert.throws(
      () => validateCodexResetFeedPayload(payload([item]), { nowMs: NOW }),
      /url|source|author|post|official/i,
    );
  }

  assert.doesNotThrow(() => validateCodexResetFeedPayload(payload([
    announcement({
      source_author: undefined,
      source_post_id: undefined,
      source_url: "https://openai.com/index/introducing-codex/",
    }),
  ]), { nowMs: NOW }));
  assert.doesNotThrow(() => validateCodexResetFeedPayload(payload([
    announcement({
      source_author: undefined,
      source_post_id: undefined,
      source_url: "https://status.openai.com/incidents/example",
      official_url: "https://status.openai.com/",
    }),
  ]), { nowMs: NOW }));
});

test("rejects invalid generated timestamps and accepts an empty signed feed", () => {
  assert.throws(
    () => validateCodexResetFeedPayload({ generated_at: "not-a-date", announcements: [] }, { nowMs: NOW }),
    /generated/i,
  );
  const empty = {
    generated_at: "2026-07-20T08:00:00.000Z",
    announcements: [],
  };
  assert.deepEqual(
    verifyCodexResetFeed(envelope(empty), { publicKey, nowMs: NOW }),
    empty,
  );
});

test("rejects missing or invalid signed publication timestamps without guessing", () => {
  const missing = announcement();
  delete missing.published_at;
  assert.throws(
    () => validateCodexResetFeedPayload(payload([missing]), { nowMs: NOW }),
    /published/i,
  );
  assert.throws(
    () => validateCodexResetFeedPayload(payload([
      announcement({ published_at: "not-a-date" }),
    ]), { nowMs: NOW }),
    /published/i,
  );
});

test("key generator and signer create a verifiable empty feed without exposing the private key", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-feed-sign-"));
  try {
    const privatePath = path.join(root, "secrets", "feed-private.pem");
    const publicPath = path.join(root, "feed-public.pem");
    const outputPath = path.join(root, "feed.json");
    const keygen = spawnSync(process.execPath, [
      "scripts/generate-codex-reset-feed-keypair.mjs",
      "--private", privatePath,
      "--public", publicPath,
    ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    assert.equal(keygen.status, 0, keygen.stderr);
    assert.doesNotMatch(keygen.stdout, /BEGIN PRIVATE KEY/);

    const overwrite = spawnSync(process.execPath, [
      "scripts/generate-codex-reset-feed-keypair.mjs",
      "--private", privatePath,
      "--public", publicPath,
    ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    assert.equal(overwrite.status, 1);
    assert.match(overwrite.stderr, /refusing to overwrite/i);

    const signer = spawnSync(process.execPath, [
      "scripts/sign-codex-reset-feed.mjs",
      "--private", privatePath,
      "--output", outputPath,
    ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    assert.equal(signer.status, 0, signer.stderr);
    const signed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const verified = verifyCodexResetFeed(signed, {
      publicKey: fs.readFileSync(publicPath, "utf8"),
      nowMs: Date.now(),
    });
    assert.deepEqual(verified.announcements, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("signer refuses raw candidate artifacts and unreviewed X announcements", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-feed-review-"));
  try {
    const privatePath = path.join(root, "private.pem");
    const publicPath = path.join(root, "public.pem");
    const outputPath = path.join(root, "feed.json");
    spawnSync(process.execPath, [
      "scripts/generate-codex-reset-feed-keypair.mjs",
      "--private", privatePath,
      "--public", publicPath,
    ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });

    const rawPath = path.join(root, "raw.json");
    fs.writeFileSync(rawPath, JSON.stringify({ review_items: [] }), "utf8");
    const raw = spawnSync(process.execPath, [
      "scripts/sign-codex-reset-feed.mjs",
      "--private", privatePath,
      "--input", rawPath,
      "--output", outputPath,
    ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    assert.equal(raw.status, 1);
    assert.match(raw.stderr, /cannot be signed directly/i);

    const reviewedPath = path.join(root, "missing-review.json");
    fs.writeFileSync(reviewedPath, JSON.stringify({
      announcements: [announcement()],
    }), "utf8");
    const unreviewed = spawnSync(process.execPath, [
      "scripts/sign-codex-reset-feed.mjs",
      "--private", privatePath,
      "--input", reviewedPath,
      "--output", outputPath,
    ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    assert.equal(unreviewed.status, 1);
    assert.match(unreviewed.stderr, /approved review metadata/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
