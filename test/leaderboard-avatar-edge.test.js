"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const EDGE = fs.readFileSync(
  path.resolve("dashboard/edge-patches/tokentracker-avatar.ts"),
  "utf8",
);
const SQL = fs.readFileSync(
  path.resolve("scripts/ops/leaderboard-avatar-storage.sql"),
  "utf8",
);
const PUBLIC_EDGE = fs.readFileSync(
  path.resolve("dashboard/edge-patches/tokentracker-avatar-public.ts"),
  "utf8",
);

test("avatar edge accepts only a tiny authenticated WebP body", () => {
  assert.match(EDGE, /req\.method\s*!==\s*"PUT"[^;]+req\.method\s*!==\s*"DELETE"/s);
  assert.match(EDGE, /content-type[^;]+image\/webp/is);
  assert.match(EDGE, /16\s*\*\s*1024/);
  assert.match(EDGE, /RIFF/);
  assert.match(EDGE, /WEBP/);
  assert.match(EDGE, /crypto\.subtle\.digest\("SHA-256"/);
  assert.doesNotMatch(EDGE, /multipart|image\/svg|text\/html/i);
  assert.doesNotMatch(EDGE, /body\.(?:user_id|filename|url)/i);
});

test("server owns the immutable object path and switches metadata before cleanup", () => {
  assert.match(EDGE, /\$\{userId\}\/\$\{hash\}\.webp/);
  const upload = EDGE.search(/\.upload\(/);
  const metadata = EDGE.search(/\.upsert\(\{/);
  const removePrevious = EDGE.search(/remove\(previous/);
  assert.ok(upload >= 0 && metadata > upload);
  assert.ok(removePrevious > metadata);
  assert.match(EDGE, /cache-control[^;]+immutable/is);
  assert.match(EDGE, /`\$\{publicBase\}\?hash=\$\{hash\}`/);
});

test("InsForge storage stays edge-owned and metadata is user-scoped", () => {
  assert.match(SQL, /tokentracker-leaderboard-avatars/);
  assert.match(SQL, /create the bucket as private with the insforge cli/i);
  assert.match(SQL, /tokentracker_leaderboard_avatar_metadata/i);
  assert.match(SQL, /enable row level security/i);
  assert.match(SQL, /auth\.uid\(\)\s*=\s*user_id/i);
  assert.doesNotMatch(SQL, /insert into storage\.buckets/i);
  assert.doesNotMatch(SQL, /create policy[^;]+on storage\.objects/is);
});

test("public avatar edge resolves only metadata-backed SHA-256 WebP objects", () => {
  assert.match(PUBLIC_EDGE, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(PUBLIC_EDGE, /\.eq\("content_hash",\s*hash\)/);
  assert.match(PUBLIC_EDGE, /\.limit\(1\)/);
  assert.match(PUBLIC_EDGE, /\.select\("object_key"\)/);
  assert.match(PUBLIC_EDGE, /\.download\(metadata\.object_key\)/);
  assert.match(PUBLIC_EDGE, /image\/webp/);
  assert.match(PUBLIC_EDGE, /max-age=31536000,\s*immutable/);
  assert.doesNotMatch(PUBLIC_EDGE, /searchParams\.get\("user_id"\)/);
});
