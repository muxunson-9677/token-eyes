"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SQL_PATH = path.resolve(__dirname, "../scripts/ops/leaderboard-dirty-queue.sql");

test("dirty dimensions are due immediately for the durable refresh coordinator", () => {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  assert.match(sql, /create table if not exists public\.tokentracker_leaderboard_dirty_dimensions/i);
  assert.match(sql, /primary key\s*\(period,\s*metric,\s*source\)/i);
  assert.match(sql, /not_before timestamptz not null default now\(\)/i);
  assert.doesNotMatch(sql, /not_before[^;]+interval '60 seconds'/is);
  assert.match(sql, /least\s*\([^)]*not_before[^)]*excluded\.not_before/is);
  assert.match(sql, /create extension if not exists pgcrypto/i);
  assert.match(sql, /mark_leaderboard_dimensions_dirty/i);
  assert.match(sql, /payload\s*->\s*'periods'[^;]+jsonb_array_elements/is);
  assert.match(sql, /item\.value\s*->>\s*0\s*=\s*any\(array\[/i);
  assert.match(sql, /array\['today',\s*'week',\s*'30d',\s*'month',\s*'total'\]/i);
  assert.match(sql, /actual_cost[^;]+all/is);
});

test("coordinator claims due keys with locking and can enqueue all 285 daily reconciliation keys", () => {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  assert.match(sql, /claim_leaderboard_dirty_dimensions/i);
  assert.match(sql, /claim_id uuid/i);
  assert.match(sql, /claim_id\s*=\s*v_claim_id/i);
  assert.match(sql, /not_before\s*<=\s*now\(\)/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /dirty\.claim_id::text\s*=\s*dimension\s*->>\s*'claim_id'/i);
  assert.match(sql, /claim_id\s*=\s*null[^;]+claimed_until\s*=\s*null/is);
  assert.match(sql, /enqueue_leaderboard_daily_reconciliation/i);
  const sourceArray = sql.match(/with fixed_sources\(source\) as \(\s*select unnest\(array\[([^\]]+)]::text\[\]\)/i);
  assert.ok(sourceArray, "daily reconciliation must declare its fixed source array");
  const sources = [...sourceArray[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.equal(sources.length, 28, "all plus the 27 supported agents must appear exactly once");
  assert.equal(new Set(sources).size, 28, "daily reconciliation source keys must be unique");
  assert.equal(5 * 2 * sources.length + 5, 285);
  assert.match(sql, /jsonb_array_length/i);
  assert.match(sql, /285/);
  assert.match(sql, /revoke all[^;]+from public/is);
  assert.match(sql, /grant execute[^;]+to project_admin/is);
  assert.doesNotMatch(sql, /set search_path\s*=\s*public,\s*pg_temp/i);
  assert.match(sql, /set search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/i);
});

test("Cloudflare uses an alarm coalescer and keeps only the daily reconciliation cron", () => {
  const worker = fs.readFileSync(path.resolve(__dirname, "../cloudflare/leaderboard-cache/src/index.ts"), "utf8");
  const wrangler = fs.readFileSync(path.resolve(__dirname, "../cloudflare/leaderboard-cache/wrangler.toml"), "utf8");
  assert.match(worker, /class LeaderboardRefreshCoordinator/);
  assert.match(worker, /REFRESH_COOLDOWN_MS\s*=\s*60_000/);
  assert.match(worker, /setAlarm/);
  assert.match(worker, /lastSuccessfulRefreshAt/);
  assert.match(wrangler, /new_sqlite_classes\s*=\s*\["LeaderboardRefreshCoordinator"\]/);
  assert.match(wrangler, /crons\s*=\s*\["5 16 \* \* \*"\]/);
  assert.doesNotMatch(wrangler, /crons\s*=\s*\["\* \* \* \* \*"\]/);
});

test("Cloudflare staging targets the isolated InsForge project without changing production defaults", () => {
  const wrangler = fs.readFileSync(path.resolve(__dirname, "../cloudflare/leaderboard-cache/wrangler.toml"), "utf8");
  const [production, staging = ""] = wrangler.split("[env.staging]");
  assert.match(
    production,
    /LEADERBOARD_REFRESH_URL\s*=\s*"https:\/\/replace-with-production\.insforge\.app\/functions\/tokentracker-leaderboard-refresh"/,
  );
  assert.match(
    production,
    /PUBLIC_FEED_ORIGIN\s*=\s*"https:\/\/replace-with-production-feeds\.example"/,
  );
  assert.match(
    staging,
    /LEADERBOARD_REFRESH_URL\s*=\s*"https:\/\/wm59q8gm\.ap-southeast\.insforge\.app\/functions\/tokentracker-leaderboard-refresh"/,
  );
  assert.doesNotMatch(staging, /replace-with-staging\.insforge\.app/);
});

test("the local compact state endpoint caches aggregation by queue fingerprint and Shanghai day", () => {
  const localApi = fs.readFileSync(path.resolve(__dirname, "../src/lib/local-api.js"), "utf8");
  assert.match(localApi, /leaderboardCompactStateCache/);
  assert.match(localApi, /queueFileMtimeKey\(qp\)/);
  assert.match(localApi, /leaderboardCacheDayFormatter\.format\(capturedAt\)/);
});
