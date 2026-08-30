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
  assert.match(EDGE, /\/v1\/avatars\/\$\{hash\}\.webp/);
  assert.match(EDGE, /publishStaticAvatar\(hash,\s*"PUT",\s*bytes\)/);
  assert.match(EDGE, /Static avatar publication failed/);
  assert.match(EDGE, /mark_leaderboard_dimensions_dirty/);
});

test("uploading the same avatar hash returns without storage or dirty publication writes", () => {
  assert.match(EDGE, /select\("object_key, content_hash, avatar_url"\)/);
  const unchanged = EDGE.search(/previous\?\.content_hash === hash/);
  const upload = EDGE.search(/\.upload\(/);
  assert.ok(unchanged >= 0 && unchanged < upload);
  assert.match(EDGE, /unchanged:\s*true/);
});

test("deleting an absent avatar returns without storage or dirty publication writes", () => {
  const deleteRead = EDGE.indexOf('.select("object_key, content_hash")');
  const unchanged = EDGE.indexOf("if (!previous)", deleteRead);
  const metadataDelete = EDGE.indexOf(".delete()", deleteRead);
  assert.ok(deleteRead >= 0 && unchanged > deleteRead && metadataDelete > unchanged);
  assert.match(EDGE.slice(unchanged, metadataDelete), /unchanged:\s*true/);
});

test("InsForge storage stays edge-owned and metadata is user-scoped", () => {
  assert.match(SQL, /tokentracker-leaderboard-avatars/);
  assert.match(SQL, /create the bucket as private with the insforge cli/i);
  assert.match(SQL, /tokentracker_leaderboard_avatar_metadata/i);
  assert.match(SQL, /enable row level security/i);
  assert.match(SQL, /auth\.uid\(\)\s*=\s*user_id/i);
  assert.match(
    SQL,
    /revoke\s+all\s+on table public\.tokentracker_leaderboard_avatar_metadata\s+from authenticated/i,
  );
  assert.doesNotMatch(SQL, /grant\s+(?:select|insert|update|delete|all)[^;]+to authenticated/i);
  assert.doesNotMatch(SQL, /insert into storage\.buckets/i);
  assert.doesNotMatch(SQL, /create policy[^;]+on storage\.objects/is);
});

test("public avatars are content-addressed Worker objects, never an InsForge read edge", () => {
  assert.match(EDGE, /LEADERBOARD_AVATAR_PUBLISH_ORIGIN/);
  assert.match(EDGE, /x-leaderboard-publisher-secret/);
  assert.match(EDGE, /publishStaticAvatar\(previous\.content_hash,\s*"DELETE"\)/);
  assert.equal(fs.existsSync(
    path.resolve("dashboard/edge-patches/tokentracker-avatar-public.ts"),
  ), false);
});
