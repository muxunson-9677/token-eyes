const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const REFRESH_PATH = path.join(
  ROOT,
  "dashboard/edge-patches/tokentracker-leaderboard-refresh.ts",
);
const READER_PATH = path.join(
  ROOT,
  "dashboard/edge-patches/tokentracker-leaderboard.ts",
);
const SQL_PATH = path.join(ROOT, "scripts/ops/leaderboard-ranking-rpc.sql");
const AGENT_REGISTRY_PATH = path.join(
  ROOT,
  "dashboard/src/lib/agent-adapters-dashboard.ts",
);

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function extractQuotedValues(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `missing ${label}`);
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
}

function extractAgentSources() {
  return [...read(AGENT_REGISTRY_PATH).matchAll(/queueSource:\s*"([^"]+)"/g)].map(
    (match) => match[1],
  );
}

test("leaderboard periods use Asia/Shanghai natural-day boundaries", () => {
  const source = read(REFRESH_PATH);
  const match = source.match(
    /\/\/ LEADERBOARD_PERIOD_HELPERS_START([\s\S]*?)\/\/ LEADERBOARD_PERIOD_HELPERS_END/,
  );
  assert.ok(match, "refresh edge must expose its pure period helpers for contract tests");

  const context = { Date };
  const compiled = esbuild.transformSync(
    `${match[1]}; globalThis.helpers = { computeDateRange, toUtcTimestampRange };`,
    { loader: "ts", format: "iife", target: "es2022" },
  ).code;
  vm.runInNewContext(compiled, context);
  const now = new Date("2026-07-13T16:30:00.000Z");

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.helpers.computeDateRange("today", now))),
    { from_day: "2026-07-14", to_day: "2026-07-14" },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.helpers.computeDateRange("yesterday", now))),
    { from_day: "2026-07-13", to_day: "2026-07-13" },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.helpers.computeDateRange("7d", now))),
    { from_day: "2026-07-08", to_day: "2026-07-14" },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.helpers.computeDateRange("30d", now))),
    { from_day: "2026-06-15", to_day: "2026-07-14" },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.helpers.computeDateRange("total", now))),
    { from_day: "1970-01-01", to_day: "2026-07-14" },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        context.helpers.toUtcTimestampRange({
          from_day: "2026-07-14",
          to_day: "2026-07-14",
        }),
      ),
    ),
    {
      rangeStart: "2026-07-14T00:00:00+08:00",
      rangeEnd: "2026-07-15T00:00:00+08:00",
    },
  );
});

test("refresh edge snapshots all five periods and every registered Agent metric", () => {
  const refresh = read(REFRESH_PATH);
  const periods = extractQuotedValues(
    refresh,
    /const ALL_PERIODS[^=]*=\s*\[([\s\S]*?)\];/,
    "ALL_PERIODS",
  );
  assert.deepEqual(periods, ["today", "yesterday", "7d", "30d", "total"]);

  const refreshAgents = extractQuotedValues(
    refresh,
    /const LEADERBOARD_AGENT_SOURCES\s*=\s*new Set\(\[([\s\S]*?)\]\);/,
    "LEADERBOARD_AGENT_SOURCES",
  );
  assert.deepEqual(refreshAgents, extractAgentSources());
  assert.match(refresh, /total_without_cache_tokens/);
  assert.match(refresh, /agent_metrics/);
  assert.match(refresh, /Math\.max\(\s*0,[\s\S]*cached_input_tokens[\s\S]*cache_creation_input_tokens/);
  assert.match(refresh, /invalid leaderboard period/i);
});

test("ranking RPC selects the score dynamically and ranks before stable paging", () => {
  assert.ok(fs.existsSync(SQL_PATH), "leaderboard ranking migration must exist");
  const sql = read(SQL_PATH);

  assert.match(sql, /ADD COLUMN IF NOT EXISTS total_without_cache_tokens bigint/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS agent_metrics jsonb/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION leaderboard_ranked\s*\(/i);
  assert.match(sql, /agent_metrics\s*->\s*p_agent\s*->>\s*'with_cache_tokens'/i);
  assert.match(sql, /agent_metrics\s*->\s*p_agent\s*->>\s*'without_cache_tokens'/i);
  assert.match(sql, /agent_metrics\s*->\s*p_agent\s*->>\s*'estimated_cost_usd'/i);
  assert.match(sql, /ROW_NUMBER\(\)\s+OVER\s*\([\s\S]*score DESC[\s\S]*total_tokens DESC[\s\S]*user_id ASC/i);
  assert.match(sql, /WHERE\s+score\s*>\s*0/i);
  assert.match(sql, /OFFSET\s+GREATEST\(p_offset,\s*0\)/i);
  assert.match(sql, /participant_count/i);
  assert.match(sql, /ranked_entry_count/i);
  assert.match(sql, /aggregate_total_cost_usd/i);
  assert.match(sql, /WHERE\s+total_tokens\s*>\s*0/i);
  assert.match(sql, /total_score/i);
  assert.match(sql, /p_blocked_user_ids/i);
});

test("public reader validates dimensions and delegates ranking to the RPC", () => {
  const reader = read(READER_PATH);
  const readerAgents = extractQuotedValues(
    reader,
    /const LEADERBOARD_AGENT_SOURCES\s*=\s*new Set\(\[([\s\S]*?)\]\);/,
    "reader LEADERBOARD_AGENT_SOURCES",
  );
  assert.deepEqual(readerAgents, extractAgentSources());
  assert.match(reader, /const VALID_PERIODS\s*=\s*new Set\(\["today",\s*"yesterday",\s*"7d",\s*"30d",\s*"total"\]\)/);
  assert.match(reader, /const VALID_METRICS\s*=\s*new Set\(\["with_cache",\s*"without_cache",\s*"estimated_cost"\]\)/);
  assert.match(reader, /invalid leaderboard dimensions/i);
  assert.match(reader, /\.rpc\(\s*"leaderboard_ranked"/);
  assert.match(reader, /p_agent:\s*agent/);
  assert.match(reader, /p_metric:\s*metric/);
  assert.match(reader, /participant_count/);
  assert.match(reader, /ranked_entry_count/);
  assert.match(reader, /aggregate_total_cost_usd/);
  assert.match(reader, /total_entries:\s*rankedEntryCount/);
  assert.doesNotMatch(reader, /\.select\("\*",\s*\{\s*count:\s*"exact"\s*\}\)/);
});
