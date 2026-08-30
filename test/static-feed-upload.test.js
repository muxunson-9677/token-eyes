"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("static feed Worker upload is a fixed-path dry run unless execute is explicit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-static-upload-"));
  const plan = path.join(root, "plan.json");
  const reset = path.join(root, "reset.json");
  fs.writeFileSync(plan, "{}\n");
  fs.writeFileSync(reset, "{}\n");
  const result = spawnSync(process.execPath, [
    "scripts/upload-static-feeds-worker.mjs",
    "--origin", "https://staging.example.workers.dev",
    "--plan-market", plan,
    "--codex-reset", reset,
  ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, "dry-run");
  assert.deepEqual(output.uploads.map((entry) => entry.url), [
    "https://staging.example.workers.dev/internal/static-feed/plan-market",
    "https://staging.example.workers.dev/internal/static-feed/codex-reset",
  ]);
  assert.doesNotMatch(result.stdout, /insforge/i);
  assert.doesNotMatch(result.stdout, /r2/i);
});

test("execute fails closed before network access when the Worker publisher secret is absent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-static-upload-auth-"));
  const plan = path.join(root, "plan.json");
  fs.writeFileSync(plan, "{}\n");
  const env = { ...process.env };
  delete env.LEADERBOARD_PUBLISHER_SECRET;
  const result = spawnSync(process.execPath, [
    "scripts/upload-static-feeds-worker.mjs",
    "--origin", "https://staging.example.workers.dev",
    "--plan-market", plan,
    "--execute",
  ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires LEADERBOARD_PUBLISHER_SECRET/);
});

test("staging Worker config contains only the SQLite Durable Object storage binding", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../cloudflare/leaderboard-cache/wrangler.toml"), "utf8");
  assert.match(source, /new_sqlite_classes/);
  assert.doesNotMatch(source, /r2_buckets|LEADERBOARD_BUCKET|bucket_name/);
  assert.doesNotMatch(source, /\[\[env\.staging\.(?:kv_namespaces|d1_databases|queues)/);
});
