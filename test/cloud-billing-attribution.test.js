"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const syncCommand = require("../src/commands/sync");

test("sync exposes its queue batch reader for cloud identity coverage", () => {
  assert.equal(typeof syncCommand.readQueueBatch, "function");
});

function row(billingMode, totalTokens) {
  return {
    source: "deepseek-harness",
    model: "deepseek-v4",
    hour_start: "2026-08-18T00:00:00.000Z",
    billing_mode: billingMode,
    input_tokens: totalTokens,
    output_tokens: 0,
    total_tokens: totalTokens,
  };
}

test("queue batches retain api_key and token_plan slices in the same bucket", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-cloud-attribution-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await fs.writeFile(
      queuePath,
      [row("api_key", 11), row("token_plan", 22)].map(JSON.stringify).join("\n") + "\n",
    );
    const result = await syncCommand.readQueueBatch(queuePath, 0, 10);
    assert.deepEqual(
      result.buckets.map((bucket) => [bucket.billing_mode, bucket.total_tokens]).sort(),
      [["api_key", 11], ["token_plan", 22]],
    );
    assert.equal(result.buckets.reduce((sum, bucket) => sum + bucket.total_tokens, 0), 33);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("batch boundaries preserve zero/rebuild slices, idempotence, and legacy unknown", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-cloud-attribution-batches-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const legacy = { ...row(undefined, 4) };
    delete legacy.billing_mode;
    const migrationRows = [row("api_key", 0), row("token_plan", 0), row("api_key", 11), row("token_plan", 22)]
      .map((bucket, index, rows) => ({
        ...bucket,
        dsh_bucket_migration_id: "migration-1",
        dsh_bucket_migration_index: index,
        dsh_bucket_migration_count: rows.length,
      }));
    const rows = [...migrationRows, legacy];
    await fs.writeFile(queuePath, rows.map(JSON.stringify).join("\n") + "\n");

    const firstBatch = await syncCommand.readQueueBatch(queuePath, 0, 1);
    assert.deepEqual(
      firstBatch.buckets.map((bucket) => [bucket.billing_mode, bucket.total_tokens]).sort(),
      [["api_key", 11], ["token_plan", 22]],
    );

    const cloud = new Map();
    const uploadFrom = async (startOffset) => {
      let offset = startOffset;
      while (true) {
        const batch = await syncCommand.readQueueBatch(queuePath, offset, 1);
        if (batch.buckets.length === 0) break;
        for (const bucket of batch.buckets) {
          const key = `${bucket.source}|${bucket.model}|${bucket.hour_start}|${bucket.billing_mode}`;
          cloud.set(key, bucket);
        }
        if (batch.nextOffset === offset) break;
        offset = batch.nextOffset;
      }
    };

    await uploadFrom(0);
    await uploadFrom(0);
    assert.equal(cloud.get("deepseek-harness|deepseek-v4|2026-08-18T00:00:00.000Z|api_key")?.total_tokens, 11);
    assert.equal(cloud.get("deepseek-harness|deepseek-v4|2026-08-18T00:00:00.000Z|token_plan")?.total_tokens, 22);
    assert.equal(cloud.get("deepseek-harness|deepseek-v4|2026-08-18T00:00:00.000Z|unknown")?.total_tokens, 4);
    assert.equal([...cloud.values()].reduce((sum, bucket) => sum + bucket.total_tokens, 0), 37);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("cloud schema, ingest, and all queue/hourly consumers use billing-mode identity", async () => {
  const root = path.join(__dirname, "..");
  const [migration, ingest, profile, badge, vite] = await Promise.all([
    fs.readFile(path.join(root, "migrations", "20260818120000_add-hourly-billing-mode.sql"), "utf8"),
    fs.readFile(path.join(root, "dashboard", "edge-patches", "tokentracker-ingest.ts"), "utf8"),
    fs.readFile(path.join(root, "dashboard", "edge-patches", "tokentracker-leaderboard-profile.ts"), "utf8"),
    fs.readFile(path.join(root, "dashboard", "edge-patches", "tokentracker-badge.ts"), "utf8"),
    fs.readFile(path.join(root, "dashboard", "vite.config.js"), "utf8"),
  ]);
  assert.match(migration, /add column if not exists billing_mode[^;]+default 'unknown'/iu);
  assert.match(migration, /user_id[^\n]+device_id[^\n]+hour_start[^\n]+source[^\n]+model[^\n]+billing_mode/iu);
  assert.match(ingest, /billing_mode:\s*normalizeBillingMode/u);
  assert.match(ingest, /onConflict:\s*"user_id,device_id,hour_start,source,model,billing_mode"/u);
  for (const consumer of [profile, badge]) {
    assert.match(consumer, /billing_mode/u);
    assert.match(consumer, /row\.source[^\n]+row\.model[^\n]+row\.hour_start[^\n]+row\.billing_mode/u);
  }
  assert.match(vite, /queueUsageIdentity\(row\)/u);
});
