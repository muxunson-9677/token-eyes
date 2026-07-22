"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(ROOT, "scripts", "build-pricing-seed.cjs");
const SQL_PATH = path.join(ROOT, "scripts", "ops", "leaderboard-model-pricing.sql");

function sqlRow(sql, pricingKey) {
  const escaped = pricingKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(new RegExp(
    `\\('${escaped}',\\s*([0-9.]+),\\s*([0-9.]+),\\s*([0-9.]+),\\s*([0-9.]+),\\s*'([a-f0-9]{64})'\\)`,
  ));
  assert.ok(match, `missing generated pricing row for ${pricingKey}`);
  return {
    input: match[1],
    output: match[2],
    cacheRead: match[3],
    cacheWrite: match[4],
    version: match[5],
  };
}

test("generated SQL creates the pricing table and keeps regression-prone mappings", () => {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  assert.match(sql, /create table if not exists public\.tokentracker_model_pricing/i);
  assert.match(sql, /pricing_key text primary key/i);
  assert.match(sql, /input_usd_per_token numeric\(24,12\) not null/i);
  assert.match(sql, /output_usd_per_token numeric\(24,12\) not null/i);
  assert.match(sql, /cache_read_usd_per_token numeric\(24,12\) not null/i);
  assert.match(sql, /cache_write_usd_per_token numeric\(24,12\) not null/i);
  assert.match(sql, /pricing_version text not null/i);
  assert.match(sql, /on conflict \(pricing_key\) do update/i);
  assert.match(
    sql,
    /delete from public\.tokentracker_model_pricing\s+where pricing_version <> '[a-f0-9]{64}'/i,
  );

  const expected = {
    "gpt-5.4": ["0.000002500000", "0.000015000000", "0.000000250000", "0.000000000000"],
    "kimi-k2.6": ["0.000000950000", "0.000004000000", "0.000000160000", "0.000000000000"],
    "mimo-v2.5-pro": ["0.000001000000", "0.000003000000", "0.000000200000", "0.000000000000"],
    "mimo-v2.5": ["0.000000400000", "0.000002000000", "0.000000080000", "0.000000000000"],
    "mimo-v2-flash": ["0.000000100000", "0.000000300000", "0.000000020000", "0.000000000000"],
  };
  const versions = new Set();
  for (const [key, values] of Object.entries(expected)) {
    const row = sqlRow(sql, key);
    assert.deepEqual(
      [row.input, row.output, row.cacheRead, row.cacheWrite],
      values,
      `${key} must match the canonical local pricing resolver`,
    );
    versions.add(row.version);
  }
  assert.equal(versions.size, 1, "all rows must share one content-hash pricing version");
});

test("offline generation is deterministic, sorted, and never calls fetch", () => {
  const tempDir = fs.mkdtempSync(path.join(ROOT, ".tmp-pricing-seed-"));
  const firstPath = path.join(tempDir, "first.sql");
  const secondPath = path.join(tempDir, "second.sql");
  const invoke = (outputPath) => childProcess.spawnSync(
    process.execPath,
    [
      "-e",
      [
        "global.fetch = () => { throw new Error('network forbidden in offline mode'); };",
        "process.argv.push('--from-existing-snapshot', '--sql-out', process.env.SQL_OUT);",
        "require('./scripts/build-pricing-seed.cjs');",
      ].join(""),
    ],
    {
      cwd: ROOT,
      env: { ...process.env, SQL_OUT: outputPath },
      encoding: "utf8",
    },
  );

  try {
    const first = invoke(firstPath);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const second = invoke(secondPath);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const firstSql = fs.readFileSync(firstPath, "utf8");
    const secondSql = fs.readFileSync(secondPath, "utf8");
    assert.equal(firstSql, secondSql);
    assert.equal(
      firstSql.replace(/\r\n/g, "\n"),
      fs.readFileSync(SQL_PATH, "utf8").replace(/\r\n/g, "\n"),
    );

    const keys = [...firstSql.matchAll(/^\s*\('((?:''|[^'])+)'/gm)]
      .map((match) => match[1].replace(/''/g, "'"));
    assert.ok(keys.length > 1000, "server seed should cover the bundled model catalog");
    assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
