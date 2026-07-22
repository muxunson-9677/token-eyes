"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SQL_PATH = path.resolve(
  __dirname,
  "../scripts/ops/leaderboard-refresh-rpc.sql",
);

function readSql() {
  return fs.readFileSync(SQL_PATH, "utf8");
}

test("refresh RPC has bounded periods, server pricing, and public-only ranking", () => {
  const sql = readSql();
  assert.match(
    sql,
    /function public\.refresh_leaderboard_snapshots\(\s*p_refresh_month boolean,\s*p_refresh_total boolean\s*\)/i,
  );
  assert.match(sql, /array\['today',\s*'week',\s*'month',\s*'total'\]/i);
  assert.match(sql, /jsonb_array_elements\([^;]+payload\s*->\s*'periods'/is);
  assert.match(sql, /group by\s+[^;]*user_id[^;]*source[^;]*model/is);
  assert.match(sql, /left join lateral[^;]+tokentracker_model_pricing/is);
  assert.match(sql, /coalesce\(pricing\.input_usd_per_token,\s*0\)/i);
  assert.match(sql, /order by[^;]+candidate\.pricing_key\s*=\s*grouped\.model[^;]+desc/is);
  assert.match(sql, /unpriced_tokens/i);
  assert.doesNotMatch(sql, /client_(?:cost|amount|spend)/i);
  assert.match(sql, /leaderboard_public\s*=\s*true/i);
  assert.match(sql, /dense_rank\(\)\s*over/i);
  assert.match(sql, /at time zone\s+'Asia\/Shanghai'/i);
  assert.match(
    sql,
    /state\.captured_at\s+at time zone\s+'Asia\/Shanghai'[^;]+selected\.period/is,
  );
  assert.match(sql, /selected\.period\s*=\s*'total'/i);
  assert.match(sql, /extract\(isodow from v_shanghai_day\)/i);
  assert.match(sql, /extract\(day from v_shanghai_day\)/i);
  assert.match(
    sql,
    /actual\.captured_at\s+at time zone\s+'Asia\/Shanghai'[^;]+totals\.period/is,
  );
  assert.match(sql, /count\(distinct pricing_version\)/i);
  assert.match(sql, /pricing seed must contain exactly one active version/i);
});

test("snapshot schema supports all metrics, exact tokens, and atomic run replacement", () => {
  const sql = readSql();
  assert.match(sql, /create table if not exists public\.tokentracker_leaderboard_snapshots_v2/i);
  assert.doesNotMatch(sql, /alter table public\.tokentracker_leaderboard_snapshots\b/i);
  assert.match(sql, /total_tokens numeric\(30,0\)/i);
  assert.match(sql, /from_day date not null/i);
  assert.match(sql, /to_day date not null/i);
  assert.match(sql, /metric text[^;]+tokens[^;]+estimated_spend[^;]+actual_cost/is);
  assert.match(sql, /actual_cost_usd numeric/i);
  assert.match(sql, /source_breakdown jsonb/i);
  assert.match(sql, /snapshot_run_id uuid/i);
  assert.match(
    sql,
    /create index[^;]+\(\s*period,\s*metric,\s*source,\s*snapshot_run_id,\s*rank\s*\)/i,
  );
  assert.match(
    sql,
    /create index[^;]+\(\s*user_id,\s*period,\s*metric,\s*source,\s*snapshot_run_id\s*\)/i,
  );

  const insertAt = sql.search(/insert into public\.tokentracker_leaderboard_snapshots_v2/i);
  const deleteAt = sql.search(/delete from public\.tokentracker_leaderboard_snapshots_v2/i);
  assert.ok(insertAt >= 0, "must insert a complete new run");
  assert.ok(deleteAt > insertAt, "old rows may only be deleted after the insert succeeds");
  assert.match(sql, /actual_cost_usd\s+is\s+not\s+null/i);
});

test("refresh RPC is executable only by the scheduler service role", () => {
  const sql = readSql();
  assert.match(
    sql,
    /revoke all on function public\.refresh_leaderboard_snapshots\(boolean,\s*boolean\)\s+from public/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.refresh_leaderboard_snapshots\(boolean,\s*boolean\)\s+to project_admin/i,
  );
});

test("refresh RPC returns operational metadata", () => {
  const sql = readSql();
  assert.match(sql, /row_counts/i);
  assert.match(sql, /duration_ms/i);
  assert.match(sql, /pricing_version/i);
  assert.match(sql, /generated_at/i);
  assert.match(sql, /returns jsonb/i);
});
