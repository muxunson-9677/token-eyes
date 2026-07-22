"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SQL_PATH = path.resolve("scripts/ops/leaderboard-bootstrap.sql");

function sql() {
  return fs.readFileSync(SQL_PATH, "utf8").replace(/\s+/g, " ").toLowerCase();
}

test("bootstrap creates only the public profile primitives needed by compact leaderboard state", () => {
  const source = sql();

  assert.match(source, /create table if not exists public\.tokentracker_user_settings/);
  assert.match(source, /user_id uuid primary key references auth\.users\(id\) on delete cascade/);
  assert.match(source, /leaderboard_public boolean not null default true/);
  assert.match(source, /create or replace view public\.tokentracker_user_profiles/);
  assert.match(source, /left join public\.tokentracker_user_settings/);
  assert.match(source, /enable row level security/);
  assert.match(source, /auth\.uid\(\) = user_id/);

  assert.doesNotMatch(source, /create table[^;]+tokentracker_hourly/);
  assert.doesNotMatch(source, /create table[^;]+tokentracker_device_tokens/);
  assert.doesNotMatch(
    source,
    /\b(project_name|conversation|code_content|file_path)\s+(text|jsonb|varchar|character varying)/,
  );
});

test("bootstrap keeps anonymous readers away from writable profile settings", () => {
  const source = sql();

  assert.match(source, /revoke all on table public\.tokentracker_user_settings from anon/);
  assert.match(source, /grant select, insert, update, delete on table public\.tokentracker_user_settings to authenticated/);
  assert.doesNotMatch(source, /grant (insert|update|delete|all)[^;]+ to anon/);
});
