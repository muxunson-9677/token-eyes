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

test("device upsert is the only write path and validates the complete compact payload", () => {
  const sql = readSql(DEVICE_SQL_PATH);

  assert.doesNotMatch(
    sql,
    /grant\s+select,\s*insert,\s*update,\s*delete\s+on table public\.tokentracker_leaderboard_device_state/i,
  );
  assert.match(
    sql,
    /grant\s+select,\s*delete\s+on table public\.tokentracker_leaderboard_device_state\s+to authenticated/i,
  );
  assert.match(sql, /p_payload\s*-\s*array\['version',\s*'device_id',\s*'captured_at',\s*'periods'\]/i);
  assert.match(sql, /p_payload\s*\?\&\s*array\['version',\s*'device_id',\s*'captured_at',\s*'periods'\]/i);
  assert.match(sql, /p_captured_at\s*>\s*now\(\)\s*\+\s*interval\s*'5 minutes'/i);
  assert.match(sql, /array\['today',\s*'week',\s*'month',\s*'total'\]/i);
  assert.match(sql, /jsonb_array_length\(v_rows\)\s*>\s*100/i);
  assert.match(sql, /jsonb_array_length\(v_item\)\s*<>\s*7/i);
  assert.match(sql, /char_length\(v_item\s*->>\s*0\)\s+not\s+between\s+1\s+and\s+64/i);
  assert.match(sql, /char_length\(v_item\s*->>\s*1\)\s+not\s+between\s+1\s+and\s+256/i);
  assert.match(sql, /\^\[0-9\]\{1,15\}\$/i);
  assert.match(sql, /v_period_token_total\s*:=\s*v_period_token_total\s*\+\s*\(v_item\s*->>\s*v_token_index\)::numeric/i);
  assert.match(sql, /v_period_token_total\s*>\s*10000000000000000/i);
});

test("device upsert serializes and enforces the three-device user cap", () => {
  const sql = readSql(DEVICE_SQL_PATH);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(
    sql,
    /select count\(\*\)[^;]+tokentracker_leaderboard_device_state[^;]+user_id\s*=\s*v_user_id/is,
  );
  assert.match(sql, />=\s*3/i);
  assert.match(sql, /device limit exceeded/i);
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
  assert.doesNotMatch(
    sql,
    /grant\s+select,\s*insert,\s*update,\s*delete\s+on table public\.tokentracker_actual_cost_state/i,
  );
  assert.match(
    sql,
    /grant\s+select,\s*delete\s+on table public\.tokentracker_actual_cost_state\s+to authenticated/i,
  );

  const signature = sql.match(
    /create or replace function public\.set_my_leaderboard_actual_cost\((.*?)\) returns/s,
  );
  assert.ok(signature, "missing set_my_leaderboard_actual_cost RPC");
  assert.doesNotMatch(signature[1], /user_id/);
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(sql, /if v_user_id is null then/);
  assert.match(sql, /p_captured_at\s*>\s*now\(\)\s*\+\s*interval\s*'5 minutes'/i);
  assert.match(sql, /function public\.refresh_my_leaderboard_actual_cost\(/i);
  assert.match(
    sql,
    /update public\.tokentracker_actual_cost_state[^;]+where user_id = v_user_id[^;]+share_actual_cost = true/is,
  );
  const refreshSignature = sql.match(
    /create or replace function public\.refresh_my_leaderboard_actual_cost\((.*?)\) returns boolean/s,
  );
  assert.ok(refreshSignature, "missing refresh_my_leaderboard_actual_cost RPC");
  assert.doesNotMatch(refreshSignature[1], /p_share|user_id/);
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
