"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const pairs = [
  ["leaderboard-bootstrap.sql", "20260829225432_leaderboard-bootstrap.sql"],
  ["leaderboard-avatar-storage.sql", "20260829225436_leaderboard-avatar-storage.sql"],
  ["leaderboard-device-state.sql", "20260829225440_leaderboard-device-state.sql"],
  ["leaderboard-actual-cost-state.sql", "20260829225449_leaderboard-actual-cost-state.sql"],
  ["leaderboard-model-pricing.sql", "20260829225453_leaderboard-model-pricing.sql"],
  ["leaderboard-refresh-rpc.sql", "20260829225457_leaderboard-refresh-rpc.sql"],
  ["leaderboard-ranking-rpc.sql", "20260829225501_leaderboard-ranking-decommission.sql"],
];

// Only these migrations have public, tracked ops counterparts. Dirty-queue
// contracts live in leaderboard-dirty-refresh-contract.test.js; follow-up SQL
// below is verified directly, without requiring ignored private ops files.
const migrationRoot = path.resolve(__dirname, "../insforge/leaderboard-v2/migrations");

function readMigration(suffix) {
  const names = fs.readdirSync(migrationRoot).filter(name => name.endsWith(`_${suffix}.sql`));
  assert.equal(names.length, 1, `expected one tracked migration for ${suffix}`);
  const sql = fs.readFileSync(path.join(migrationRoot, names[0]), "utf8");
  assert.doesNotMatch(sql, /^\s*(?:begin|commit)\s*;/im);
  return sql;
}

function withoutTransactionControl(sql) {
  return sql
    .replace(/^begin;\r?\n\r?\n/m, "")
    .replace(/\r?\n(?:\r?\n)?commit;\r?\n?$/m, "\n");
}

function normalizeEol(sql) {
  return sql.replace(/\r\n/g, "\n");
}

function asOriginallyApplied(sourceName, sql) {
  if (sourceName === "leaderboard-model-pricing.sql") {
    return sql.replace(
      /alter table public\.tokentracker_model_pricing enable row level security;\r?\nrevoke all on table public\.tokentracker_model_pricing from public, anon, authenticated;\r?\ngrant all on table public\.tokentracker_model_pricing to project_admin;\r?\n\r?\n/,
      "",
    );
  }
  if (sourceName === "leaderboard-refresh-rpc.sql") {
    return sql.replace(
      /\r?\nalter table public\.tokentracker_leaderboard_snapshots_v2 enable row level security;\r?\nrevoke all on table public\.tokentracker_leaderboard_snapshots_v2 from public, anon, authenticated;\r?\ngrant all on table public\.tokentracker_leaderboard_snapshots_v2 to project_admin;\r?\n/,
      "",
    ).replace(
      "copied to the public Worker object store by the authenticated avatar upload edge.",
      "copied to R2 by the authenticated avatar upload edge.",
    );
  }
  if (sourceName === "leaderboard-actual-cost-state.sql") {
    return sql.replace(
      /  if to_regclass\('public\.tokentracker_leaderboard_avatar_metadata'\) is not null then\r?\n/,
      `  if to_regclass('public.tokentracker_leaderboard_avatar_metadata') is not null then
    if to_regclass('storage.objects') is not null then
      execute
        'delete from storage.objects
         where bucket = ''tokentracker-leaderboard-avatars''
           and key in (
             select object_key
             from public.tokentracker_leaderboard_avatar_metadata
             where user_id = $1
           )'
        using v_user_id;
    end if;
`,
    );
  }
  return sql;
}

test("isolated InsForge migrations only remove platform-owned transaction control", () => {
  for (const [sourceName, migrationName] of pairs) {
    const source = fs.readFileSync(path.resolve("scripts/ops", sourceName), "utf8");
    const migration = fs.readFileSync(
      path.resolve("insforge/leaderboard-v2/migrations", migrationName),
      "utf8",
    );
    assert.equal(
      normalizeEol(migration),
      normalizeEol(withoutTransactionControl(asOriginallyApplied(sourceName, source))),
      `${migrationName} drifted from ${sourceName}`,
    );
    assert.doesNotMatch(migration, /^\s*(?:begin|commit)\s*;/im);
  }
});

test("the follow-up hardening migration isolates server-owned tables", () => {
  const source = readMigration("leaderboard-table-access-hardening");
  for (const table of ["tokentracker_model_pricing", "tokentracker_leaderboard_snapshots_v2"]) {
    assert.ok(source.includes(`alter table public.${table} enable row level security;`));
    assert.ok(source.includes(`revoke all on table public.${table} from public, anon, authenticated;`));
    assert.ok(source.includes(`grant all on table public.${table} to project_admin;`));
  }
  assert.doesNotMatch(source, /grant\s+[^;]+\s+to\s+(?:public|anon|authenticated)\b/i);
});

test("the avatar cleanup permission migration is isolated to the service role", () => {
  const source = readMigration("leaderboard-avatar-cleanup-permission");
  assert.match(source, /grant delete on table storage\.objects to project_admin/i);
  assert.doesNotMatch(source, /grant\s+[^;]+\s+to\s+(?:anon|authenticated)\b/i);
});

test("the storage-independent delete RPC retains auth-bound cleanup", () => {
  const source = readMigration("leaderboard-delete-rpc-storage-fix");
  assert.match(source, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(source, /if v_user_id is null then\s+raise exception 'authentication required' using errcode = '42501'/);
  assert.match(source, /perform public\.mark_leaderboard_dimensions_dirty\(v_user_id, true\)/);
  for (const table of ["tokentracker_leaderboard_device_state", "tokentracker_actual_cost_state", "tokentracker_user_settings"]) {
    assert.ok(source.includes(`delete from public.${table}\n  where user_id = v_user_id;`) || source.includes(`delete from public.${table}\r\n  where user_id = v_user_id;`));
  }
  for (const table of ["tokentracker_leaderboard_snapshots", "tokentracker_leaderboard_snapshots_v2", "tokentracker_leaderboard_avatar_metadata"]) {
    assert.ok(source.includes(`'delete from public.${table} where user_id = $1'`));
  }
  assert.match(source, /revoke all on function public\.delete_my_leaderboard_data\(\) from anon/);
  assert.match(source, /grant execute on function public\.delete_my_leaderboard_data\(\) to authenticated/);
  assert.match(source, /set search_path = pg_catalog, public, pg_temp/);
  assert.doesNotMatch(source, /storage\.objects/i);
});
