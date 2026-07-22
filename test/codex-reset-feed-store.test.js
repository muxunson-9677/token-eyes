"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SQL_PATH = path.join(__dirname, "../scripts/ops/codex-reset-feed-store.sql");

test("reset feed store is a private service-owned singleton", () => {
  const sql = fs.readFileSync(SQL_PATH, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS tokentracker_codex_reset_feed_state/i);
  assert.match(sql, /singleton boolean PRIMARY KEY[\s\S]*CHECK \(singleton\)/i);
  assert.match(sql, /envelope jsonb NOT NULL/i);
  assert.match(sql, /last_openai_checked_at timestamptz/i);
  assert.match(sql, /last_tavily_checked_at timestamptz/i);
  assert.match(sql, /REVOKE ALL[\s\S]*FROM anon, authenticated/i);
  assert.doesNotMatch(sql, /GRANT (SELECT|INSERT|UPDATE|DELETE)[\s\S]*TO (anon|authenticated)/i);
});
