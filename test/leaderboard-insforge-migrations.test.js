"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const pairs = [
  ["leaderboard-bootstrap.sql", "20260829225432_leaderboard-bootstrap.sql"],
  ["leaderboard-avatar-storage.sql", "20260829225436_leaderboard-avatar-storage.sql"],
  ["leaderboard-device-state.sql", "20260829225440_leaderboard-device-state.sql"],
  ["leaderboard-dirty-queue.sql", "20260829225444_leaderboard-dirty-queue.sql"],
  ["leaderboard-actual-cost-state.sql", "20260829225449_leaderboard-actual-cost-state.sql"],
  ["leaderboard-model-pricing.sql", "20260829225453_leaderboard-model-pricing.sql"],
  ["leaderboard-refresh-rpc.sql", "20260829225457_leaderboard-refresh-rpc.sql"],
  ["leaderboard-ranking-rpc.sql", "20260829225501_leaderboard-ranking-decommission.sql"],
];

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

test("the follow-up hardening migration matches its reviewed source", () => {
  const source = fs.readFileSync(
    path.resolve("scripts/ops/leaderboard-table-access-hardening.sql"),
    "utf8",
  );
  const migrations = fs.readdirSync(path.resolve("insforge/leaderboard-v2/migrations"));
  const migrationName = migrations.find((name) => name.endsWith("_leaderboard-table-access-hardening.sql"));
  assert.ok(migrationName, "missing table-access hardening migration");
  assert.equal(
    fs.readFileSync(path.resolve("insforge/leaderboard-v2/migrations", migrationName), "utf8"),
    source,
  );
});

test("the avatar cleanup permission migration is isolated to the service role", () => {
  const sourcePath = path.resolve("scripts/ops/leaderboard-avatar-cleanup-permission.sql");
  const source = fs.readFileSync(sourcePath, "utf8");
  const migrations = fs.readdirSync(path.resolve("insforge/leaderboard-v2/migrations"));
  const migrationName = migrations.find((name) => name.endsWith("_leaderboard-avatar-cleanup-permission.sql"));
  assert.ok(migrationName, "missing avatar-cleanup permission migration");
  assert.equal(
    fs.readFileSync(path.resolve("insforge/leaderboard-v2/migrations", migrationName), "utf8"),
    source,
  );
  assert.match(source, /grant delete on table storage\.objects to project_admin/i);
  assert.doesNotMatch(source, /grant\s+[^;]+\s+to\s+(?:anon|authenticated)\b/i);
});

test("the storage-independent delete RPC migration matches its reviewed source", () => {
  const source = fs.readFileSync(
    path.resolve("scripts/ops/leaderboard-delete-rpc-storage-fix.sql"),
    "utf8",
  );
  const migrations = fs.readdirSync(path.resolve("insforge/leaderboard-v2/migrations"));
  const migrationName = migrations.find((name) => name.endsWith("_leaderboard-delete-rpc-storage-fix.sql"));
  assert.ok(migrationName, "missing storage-independent delete RPC migration");
  assert.equal(
    fs.readFileSync(path.resolve("insforge/leaderboard-v2/migrations", migrationName), "utf8"),
    source,
  );
  assert.doesNotMatch(source, /storage\.objects/i);
});
