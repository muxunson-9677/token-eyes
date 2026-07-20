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
  assert.match(EDGE, /cache-control[^;]+immutable/is);
});

test("storage bucket is private and object policies are user-folder scoped", () => {
  assert.match(SQL, /tokentracker-leaderboard-avatars/);
  assert.match(SQL, /public\s*=\s*false/i);
  assert.match(SQL, /auth\.uid\(\)::text\s*=\s*\(storage\.foldername\(name\)\)\[1\]/i);
  assert.match(SQL, /tokentracker_leaderboard_avatar_metadata/i);
  assert.match(SQL, /enable row level security/i);
});
