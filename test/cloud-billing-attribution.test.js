"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const esbuild = require("esbuild");

const syncCommand = require("../src/commands/sync");

async function importIngestEdge() {
  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, "../dashboard/edge-patches/tokentracker-ingest.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    plugins: [{
      name: "mock-insforge",
      setup(build) {
        build.onResolve({ filter: /^npm:@insforge\/sdk$/ }, () => ({ path: "insforge", namespace: "mock" }));
        build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: "export const createClient = (...args) => globalThis.__billingIngestCreateClient(...args);",
          loader: "js",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

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

test("cloud schema keeps the legacy base identity and adds rolling-safe attribution", async () => {
  const root = path.join(__dirname, "..");
  const [migration, ingest, profile, badge, vite] = await Promise.all([
    fs.readFile(path.join(root, "migrations", "20260818120000_add-hourly-billing-mode.sql"), "utf8"),
    fs.readFile(path.join(root, "dashboard", "edge-patches", "tokentracker-ingest.ts"), "utf8"),
    fs.readFile(path.join(root, "dashboard", "edge-patches", "tokentracker-leaderboard-profile.ts"), "utf8"),
    fs.readFile(path.join(root, "dashboard", "edge-patches", "tokentracker-badge.ts"), "utf8"),
    fs.readFile(path.join(root, "dashboard", "vite.config.js"), "utf8"),
  ]);
  assert.match(migration, /add column if not exists billing_mode_slices jsonb/iu);
  assert.doesNotMatch(migration, /drop constraint[^;]+user_id/iu);
  assert.doesNotMatch(migration, /unique[^;]+billing_mode/iu);
  assert.match(ingest, /billing_mode:\s*normalizeBillingMode/u);
  assert.match(ingest, /rpc\("tokentracker_hourly_ingest_v2"/u);
  assert.match(migration, /revoke all on function public\.tokentracker_hourly_ingest_v2\(text,text,jsonb\) from public,anon,authenticated/iu);
  assert.match(migration, /grant execute on function public\.tokentracker_hourly_ingest_v2\(text,text,jsonb\) to service_role/iu);
  assert.match(ingest, /onConflict:\s*"user_id,device_id,hour_start,source,model"/u);
  for (const consumer of [profile, badge]) {
    assert.doesNotMatch(consumer, /\.order\("billing_mode"/u);
  }
  assert.match(vite, /queueUsageIdentity\(row\)/u);
});

test("edge-first deployment falls back to one legacy base row without losing api and plan totals", async (t) => {
  let fallbackRows = null;
  let fallbackConflict = null;
  globalThis.Deno = { env: { get: (key) => ({
    TOKENTRACKER_LEGACY_HOURLY_INGEST_ENABLED: "true",
    INSFORGE_BASE_URL: "https://cloud.example",
    INSFORGE_SERVICE_ROLE_KEY: "service-role",
  })[key] } };
  globalThis.__billingIngestCreateClient = () => ({
    database: {
      from(table) {
        if (table === "tokentracker_device_tokens") {
          const chain = {
            select: () => chain,
            eq: () => chain,
            is: () => chain,
            maybeSingle: async () => ({ data: { user_id: "user-1", device_id: "device-1" }, error: null }),
          };
          return chain;
        }
        return {
          async upsert(rows, options) {
            fallbackRows = rows;
            fallbackConflict = options.onConflict;
            return { error: null };
          },
        };
      },
      async rpc() {
        return { data: null, error: { message: "function tokentracker_hourly_ingest_v2 does not exist" } };
      },
    },
  });
  t.after(() => {
    delete globalThis.Deno;
    delete globalThis.__billingIngestCreateClient;
  });

  const edge = await importIngestEdge();
  const response = await edge.default(new Request("https://cloud.example/functions/tokentracker-ingest", {
    method: "POST",
    headers: { Authorization: "Bearer device-token", "Content-Type": "application/json" },
    body: JSON.stringify({ buckets: [row("api_key", 11), row("token_plan", 22)] }),
  }));
  assert.equal(response.status, 200);
  assert.equal(fallbackConflict, "user_id,device_id,hour_start,source,model");
  assert.equal(fallbackRows.length, 1);
  assert.equal(fallbackRows[0].total_tokens, 33);
  assert.equal("billing_mode" in fallbackRows[0], false);
  assert.equal("billing_mode_slices" in fallbackRows[0], false);
});

test("rolling migration preserves old writes and downgrades stale attribution to unknown", async () => {
  const migration = await fs.readFile(
    path.join(__dirname, "..", "migrations", "20260818120000_add-hourly-billing-mode.sql"),
    "utf8",
  );
  assert.match(migration, /add column if not exists billing_mode_slices jsonb/iu);
  assert.match(migration, /billing_mode_slices is null[\s\S]+<> total_tokens[\s\S]+<> input_tokens[\s\S]+<> output_tokens/iu);
  assert.match(migration, /then jsonb_build_object\('api_key',0,'token_plan',0,'unknown',total_tokens\)/iu);
  assert.doesNotMatch(migration, /drop constraint if exists tokentracker_hourly.*(?:user_id|billing_mode)/iu);

  const classify = (baseTotal, slices) => {
    const sliceTotal = slices && Object.values(slices).reduce((sum, value) => sum + value, 0);
    return !slices || sliceTotal !== baseTotal
      ? { api_key: 0, token_plan: 0, unknown: baseTotal }
      : slices;
  };
  assert.deepEqual(classify(33, null), { api_key: 0, token_plan: 0, unknown: 33 });
  assert.deepEqual(classify(33, { api_key: 11, token_plan: 22, unknown: 0 }), { api_key: 11, token_plan: 22, unknown: 0 });
  assert.deepEqual(classify(44, { api_key: 11, token_plan: 22, unknown: 0 }), { api_key: 0, token_plan: 0, unknown: 44 });
});
