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

    const firstBatch = await syncCommand.readQueueBatch(queuePath, 0, 2);
    assert.deepEqual(
      firstBatch.buckets.map((bucket) => [bucket.billing_mode, bucket.total_tokens]).sort(),
      [["api_key", 11], ["token_plan", 22]],
    );

    const cloud = new Map();
    const uploadFrom = async (startOffset) => {
      let offset = startOffset;
      while (true) {
        const batch = await syncCommand.readQueueBatch(queuePath, offset, 2);
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

test("large migration transactions page by whole base bucket and resume deterministically", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-cloud-attribution-large-migration-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const rebuilt = [];
    for (let index = 0; index < 1000; index += 1) {
      rebuilt.push({ ...row("api_key", index + 1), model: `deepseek-${String(index).padStart(3, "0")}` });
    }
    rebuilt.splice(200, 0, { ...rebuilt[199], billing_mode: "token_plan", total_tokens: 22 });
    const migrationRows = [
      ...rebuilt.map((bucket) => ({ ...bucket, total_tokens: 0, input_tokens: 0 })),
      ...rebuilt,
    ].map((bucket, index, rows) => ({
      ...bucket,
      dsh_bucket_migration_id: "migration-large",
      dsh_bucket_migration_index: index,
      dsh_bucket_migration_count: rows.length,
    }));
    await fs.writeFile(queuePath, `${migrationRows.map(JSON.stringify).join("\n")}\n`);

    const cloud = new Map();
    const basesByBatch = [];
    let offset = 0;
    let migrationCursor = null;
    let batchNumber = 0;
    while (true) {
      const inputCursor = migrationCursor;
      const result = await syncCommand.readQueueBatch(queuePath, offset, 200, inputCursor);
      if (result.buckets.length === 0) break;
      assert.ok(result.buckets.length <= 200);
      if (batchNumber === 0) {
        const replay = await syncCommand.readQueueBatch(queuePath, offset, 200, inputCursor);
        assert.deepEqual(replay, result, "crash before cursor persistence must replay idempotently");
      }
      const bases = new Set();
      for (const bucket of result.buckets) {
        const base = `${bucket.source}|${bucket.model}|${bucket.hour_start}`;
        bases.add(base);
        cloud.set(`${base}|${bucket.billing_mode}`, bucket);
        assert.notEqual(bucket.total_tokens, 0, "zero/rebuild must fold before upload");
      }
      basesByBatch.push(bases);
      offset = result.nextOffset;
      migrationCursor = result.migrationCursor || null;
      batchNumber += 1;
    }

    const seenBases = new Set();
    for (const bases of basesByBatch) {
      for (const base of bases) {
        assert.equal(seenBases.has(base), false, `base bucket split across requests: ${base}`);
        seenBases.add(base);
      }
    }
    assert.ok(batchNumber > 5, "migration must resume beyond one normal five-batch drain");
    assert.equal(cloud.size, 1001);
    assert.equal(cloud.get("deepseek-harness|deepseek-199|2026-08-18T00:00:00.000Z|api_key")?.total_tokens, 200);
    assert.equal(cloud.get("deepseek-harness|deepseek-199|2026-08-18T00:00:00.000Z|token_plan")?.total_tokens, 22);
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
