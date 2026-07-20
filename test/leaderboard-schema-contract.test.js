"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const DEVICE_SQL_PATH = path.resolve("scripts/ops/leaderboard-device-state.sql");
const ACTUAL_COST_SQL_PATH = path.resolve("scripts/ops/leaderboard-actual-cost-state.sql");

function readSql(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\s+/g, " ").toLowerCase();
}

test("device state schema is compact, user-bound, and has no anonymous write path", () => {
  const sql = readSql(DEVICE_SQL_PATH);

  assert.match(sql, /create table if not exists public\.tokentracker_leaderboard_device_state/);
  assert.match(sql, /primary key \(user_id, device_id\)/);
  assert.match(sql, /payload jsonb not null/);
  assert.match(sql, /octet_length\(payload::text\) <= 8192/);
  assert.match(sql, /captured_at timestamptz not null/);
  assert.match(sql, /summary_hash text not null/);
  assert.match(sql, /state_version smallint not null/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /auth\.uid\(\) = user_id/);
  assert.doesNotMatch(sql, /to anon/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all).* to anon/);
});

test("device upsert RPC derives the user from auth and never accepts user_id", () => {
  const sql = readSql(DEVICE_SQL_PATH);
  const signature = sql.match(
    /create or replace function public\.upsert_my_leaderboard_device_state\((.*?)\) returns/s,
  );
  assert.ok(signature, "missing upsert_my_leaderboard_device_state RPC");
  assert.doesNotMatch(signature[1], /user_id/);
  for (const parameter of [
    "p_device_id text",
    "p_state_version smallint",
    "p_summary_hash text",
    "p_captured_at timestamptz",
    "p_payload jsonb",
  ]) {
    assert.match(signature[1], new RegExp(parameter.replace(/[()]/g, "\\$&")));
  }
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public, pg_temp/);
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(sql, /if v_user_id is null then/);
  assert.match(sql, /values \(\s*v_user_id,\s*p_device_id/);
});

test("actual-cost schema stores consent atomically and keeps disabled amounts null", () => {
  const sql = readSql(ACTUAL_COST_SQL_PATH);

  assert.match(sql, /create table if not exists public\.tokentracker_actual_cost_state/);
  assert.match(sql, /user_id uuid primary key/);
  assert.match(sql, /share_actual_cost boolean not null default false/);
  for (const column of ["today_usd", "week_usd", "month_usd", "total_usd"]) {
    assert.match(sql, new RegExp(`${column} numeric\\(20,6\\)`));
  }
  assert.match(sql, /enable row level security/);
  assert.match(sql, /auth\.uid\(\) = user_id/);
  assert.match(sql, /not p_share then null/);
  assert.doesNotMatch(sql, /to anon/);

  const signature = sql.match(
    /create or replace function public\.set_my_leaderboard_actual_cost\((.*?)\) returns/s,
  );
  assert.ok(signature, "missing set_my_leaderboard_actual_cost RPC");
  assert.doesNotMatch(signature[1], /user_id/);
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(sql, /if v_user_id is null then/);
});

test("cleanup RPC removes all leaderboard-owned data without deleting the auth user", () => {
  const combinedSql = `${readSql(DEVICE_SQL_PATH)} ${readSql(ACTUAL_COST_SQL_PATH)}`;

  assert.match(combinedSql, /create or replace function public\.delete_my_leaderboard_data\(\)/);
  assert.match(combinedSql, /delete from public\.tokentracker_leaderboard_device_state/);
  assert.match(combinedSql, /delete from public\.tokentracker_actual_cost_state/);
  assert.match(combinedSql, /delete from public\.tokentracker_leaderboard_snapshots/);
  assert.match(combinedSql, /delete from public\.tokentracker_user_settings/);
  assert.match(combinedSql, /tokentracker_leaderboard_avatar_metadata/);
  assert.match(combinedSql, /where user_id = v_user_id/);
  assert.doesNotMatch(combinedSql, /delete from auth\.users/);
});
