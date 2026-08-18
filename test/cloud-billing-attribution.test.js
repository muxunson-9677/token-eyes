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
  assert.equal(typeof syncCommand.createCloudQueueReadContext, "function");
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

function applyLegacyFiveKeyEdge(cloud, buckets) {
  const requestRows = new Map();
  for (const bucket of buckets) {
    const key = `${bucket.source}|${bucket.model}|${bucket.hour_start}`;
    const previous = requestRows.get(key);
    if (!previous || Number(bucket.total_tokens) > Number(previous.total_tokens)) requestRows.set(key, bucket);
  }
  for (const [key, bucket] of requestRows) cloud.set(key, bucket);
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
    const modeBuckets = result.buckets.filter((bucket) => !bucket.billing_mode_compat_summary);
    const compat = result.buckets.filter((bucket) => bucket.billing_mode_compat_summary === "base_total_v1");
    assert.deepEqual(
      modeBuckets.map((bucket) => [bucket.billing_mode, bucket.total_tokens]).sort(),
      [["api_key", 11], ["token_plan", 22]],
    );
    assert.equal(modeBuckets.reduce((sum, bucket) => sum + bucket.total_tokens, 0), 33);
    assert.equal(compat.length, 1);
    assert.equal(compat[0].total_tokens, 33);
    assert.equal(compat[0].billing_mode_compat_slices.api_key.total_tokens, 11);
    assert.equal(compat[0].billing_mode_compat_slices.token_plan.total_tokens, 22);

    // Exact behavior of the already-deployed five-key Edge: MAX wins after
    // billing_mode is discarded. The compatibility row must therefore win.
    const legacy = new Map();
    applyLegacyFiveKeyEdge(legacy, result.buckets);
    applyLegacyFiveKeyEdge(legacy, result.buckets);
    assert.equal(legacy.values().next().value.total_tokens, 33);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("cloud wire rows and compatibility summaries use a strict non-secret allowlist", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-cloud-attribution-secrets-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const secretRow = {
      ...row("api_key", 11),
      authorization: "Bearer cloud-secret-value",
      cookie: "session=cloud-cookie-value",
      credential_ref: "ghp_cloud_secret_value",
      endpoint: "https://api.example/v1/chat?api_key=query-secret-value",
      api_key: "plaintext-api-secret-value",
      arbitrary: { token: "nested-secret-value" },
    };
    await fs.writeFile(queuePath, `${JSON.stringify(secretRow)}\n`);
    const result = await syncCommand.readQueueBatch(queuePath, 0, 10);
    const serialized = JSON.stringify(result.buckets);
    for (const forbidden of [
      "cloud-secret-value",
      "cloud-cookie-value",
      "ghp_cloud_secret_value",
      "query-secret-value",
      "plaintext-api-secret-value",
      "nested-secret-value",
      "authorization",
      "cookie",
      "credential_ref",
      "endpoint",
      "arbitrary",
    ]) {
      assert.equal(serialized.includes(forbidden), false, `cloud payload leaked ${forbidden}`);
    }
    assert.equal(result.buckets.some((bucket) => Object.hasOwn(bucket, "api_key")), false);
    assert.equal(result.buckets[0].total_tokens, 11);
    assert.equal(result.buckets[1].billing_mode_compat_summary, "base_total_v1");
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

    const firstBatch = await syncCommand.readQueueBatch(queuePath, 0, 4);
    assert.deepEqual(
      firstBatch.buckets.filter((bucket) => !bucket.billing_mode_compat_summary)
        .map((bucket) => [bucket.billing_mode, bucket.total_tokens]).sort(),
      [["api_key", 11], ["token_plan", 22]],
    );

    const cloud = new Map();
    const uploadFrom = async (startOffset) => {
      let offset = startOffset;
      while (true) {
        const batch = await syncCommand.readQueueBatch(queuePath, offset, 4);
        if (batch.buckets.length === 0) break;
        for (const bucket of batch.buckets.filter((row) => !row.billing_mode_compat_summary)) {
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

test("migration parser ignores partial prefixes and publishes only the final complete frame", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-cloud-attribution-replayed-migration-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const rebuilt = [row("api_key", 0), row("token_plan", 0), row("api_key", 11), row("token_plan", 22)];
    const frame = rebuilt.map((bucket, index) => ({
      ...bucket,
      dsh_bucket_migration_id: "migration-replayed",
      dsh_bucket_migration_index: index,
      dsh_bucket_migration_count: rebuilt.length,
    }));
    await fs.writeFile(queuePath, `${[frame[0], ...frame].map(JSON.stringify).join("\n")}\n`);

    const context = await syncCommand.createCloudQueueReadContext(queuePath, 0);
    const result = await syncCommand.readQueueBatch(queuePath, 0, 20, null, context);
    const replay = await syncCommand.readQueueBatch(queuePath, 0, 20, null, context);
    assert.deepEqual(replay, result, "crash replay must reuse the one complete transaction");
    assert.deepEqual(
      result.buckets.filter((bucket) => !bucket.billing_mode_compat_summary)
        .map((bucket) => [bucket.billing_mode, bucket.total_tokens]).sort(),
      [["api_key", 11], ["token_plan", 22]],
    );
    assert.equal(result.buckets.find((bucket) => bucket.billing_mode_compat_summary)?.total_tokens, 33);
    assert.equal(context.rowsParsed, 5, "each physical migration row must be parsed once");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("migration parser rejects duplicate, out-of-order, and truncated frames", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-cloud-attribution-malformed-migration-"));
  try {
    const makeFrame = (id) => [row("api_key", 0), row("token_plan", 0), row("api_key", 11), row("token_plan", 22)]
      .map((bucket, index, rows) => ({
        ...bucket,
        dsh_bucket_migration_id: id,
        dsh_bucket_migration_index: index,
        dsh_bucket_migration_count: rows.length,
      }));
    const frame = makeFrame("migration-malformed");
    const otherFrame = makeFrame("migration-other-partial");
    const queuePath = path.join(tmp, "queue.jsonl");
    await fs.writeFile(
      queuePath,
      `${[
        frame[0], frame[0], frame[2],
        otherFrame[0], otherFrame[1],
        frame[0], frame[1], frame[2], frame[3],
      ].map(JSON.stringify).join("\n")}\n`,
    );
    const result = await syncCommand.readQueueBatch(queuePath, 0, 20);
    assert.equal(result.buckets.find((bucket) => bucket.billing_mode_compat_summary)?.total_tokens, 33);

    const truncatedPath = path.join(tmp, "truncated.jsonl");
    await fs.writeFile(truncatedPath, `${frame.slice(0, 2).map(JSON.stringify).join("\n")}\n`);
    const truncated = await syncCommand.readQueueBatch(truncatedPath, 0, 20);
    assert.deepEqual(truncated.buckets, []);
    assert.equal(truncated.nextOffset, 0, "an incomplete tail must remain available for a later append");
    await fs.appendFile(truncatedPath, `${frame.slice(2).map(JSON.stringify).join("\n")}\n`);
    const completed = await syncCommand.readQueueBatch(truncatedPath, truncated.nextOffset, 20);
    assert.equal(completed.buckets.find((bucket) => bucket.billing_mode_compat_summary)?.total_tokens, 33);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("migration parser keeps consecutive complete transactions separate", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-cloud-attribution-consecutive-migrations-"));
  try {
    const makeFrame = (id, total) => [row("api_key", 0), row("api_key", total)].map((bucket, index, rows) => ({
      ...bucket,
      dsh_bucket_migration_id: id,
      dsh_bucket_migration_index: index,
      dsh_bucket_migration_count: rows.length,
    }));
    const firstFrame = makeFrame("migration-first", 11);
    const secondFrame = makeFrame("migration-second", 19);
    const queuePath = path.join(tmp, "queue.jsonl");
    await fs.writeFile(queuePath, `${[...firstFrame, ...secondFrame].map(JSON.stringify).join("\n")}\n`);

    const context = await syncCommand.createCloudQueueReadContext(queuePath, 0);
    const first = await syncCommand.readQueueBatch(queuePath, 0, 20, null, context);
    const second = await syncCommand.readQueueBatch(queuePath, first.nextOffset, 20, null, context);
    assert.equal(first.buckets.find((bucket) => bucket.billing_mode === "api_key")?.total_tokens, 11);
    assert.equal(second.buckets.find((bucket) => bucket.billing_mode === "api_key")?.total_tokens, 19);
    assert.equal(context.rowsParsed, 4);
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
    const context = await syncCommand.createCloudQueueReadContext(queuePath, offset);
    while (true) {
      const inputCursor = migrationCursor;
      const result = await syncCommand.readQueueBatch(queuePath, offset, 200, inputCursor, context);
      if (result.buckets.length === 0) break;
      assert.ok(result.buckets.length <= 200);
      if (batchNumber === 0) {
        const replay = await syncCommand.readQueueBatch(queuePath, offset, 200, inputCursor, context);
        assert.deepEqual(replay, result, "crash before cursor persistence must replay idempotently");
      }
      const bases = new Set();
      for (const bucket of result.buckets.filter((row) => !row.billing_mode_compat_summary)) {
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
    assert.equal(context.rowsParsed, migrationRows.length, "migration paging must parse its transaction once");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("normal queue paging counts compatibility summaries without splitting base buckets", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-cloud-attribution-normal-pages-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const rows = Array.from({ length: 300 }, (_value, index) => ({
      ...row("api_key", index + 1),
      model: `model-${String(index).padStart(3, "0")}`,
    }));
    await fs.writeFile(queuePath, `${rows.map(JSON.stringify).join("\n")}\n`);

    let offset = 0;
    const context = await syncCommand.createCloudQueueReadContext(queuePath, offset);
    const seen = new Set();
    while (true) {
      const batch = await syncCommand.readQueueBatch(queuePath, offset, 200, null, context);
      if (batch.buckets.length === 0) break;
      assert.ok(batch.buckets.length <= 200);
      const byBase = new Map();
      for (const bucket of batch.buckets) {
        const key = `${bucket.source}|${bucket.model}|${bucket.hour_start}`;
        if (!byBase.has(key)) byBase.set(key, []);
        byBase.get(key).push(bucket);
      }
      for (const [key, group] of byBase) {
        assert.equal(seen.has(key), false, `base bucket split across normal requests: ${key}`);
        assert.equal(group.length, 2);
        assert.equal(group.filter((item) => item.billing_mode_compat_summary === "base_total_v1").length, 1);
        seen.add(key);
      }
      assert.ok(batch.nextOffset > offset);
      offset = batch.nextOffset;
    }
    assert.equal(seen.size, 300);
    assert.equal(context.rowsParsed, 300, "a multi-page drain must parse each queue row exactly once");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("compatibility summaries carry prior mode slices across normal batch boundaries", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-cloud-attribution-prior-slices-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const first = { ...row("api_key", 11), model: "shared-model" };
    const fillers = Array.from({ length: 55 }, (_value, index) => ({
      ...row("api_key", 1), model: `filler-${String(index).padStart(2, "0")}`,
    }));
    const later = { ...row("token_plan", 22), model: "shared-model" };
    await fs.writeFile(queuePath, `${[first, ...fillers, later].map(JSON.stringify).join("\n")}\n`);

    const legacy = new Map();
    let offset = 0;
    while (true) {
      const batch = await syncCommand.readQueueBatch(queuePath, offset, 200);
      if (batch.buckets.length === 0) break;
      applyLegacyFiveKeyEdge(legacy, batch.buckets);
      offset = batch.nextOffset;
    }
    const shared = legacy.get("deepseek-harness|shared-model|2026-08-18T00:00:00.000Z");
    assert.equal(shared.billing_mode_compat_summary, "base_total_v1");
    assert.equal(shared.total_tokens, 33);
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
  assert.match(ingest, /rpc\("tokentracker_hourly_ingest_v3"/u);
  assert.match(migration, /revoke all on function public\.tokentracker_hourly_ingest_v3\(text,text,jsonb\) from public,anon,authenticated/iu);
  assert.match(migration, /grant execute on function public\.tokentracker_hourly_ingest_v3\(text,text,jsonb\) to service_role/iu);
  assert.match(migration, /pg_advisory_xact_lock/iu);
  assert.match(migration, /hashtextextended/iu);
  assert.match(migration, /billing_mode_snapshot/iu);
  assert.match(migration, /processed_snapshots/iu);
  assert.match(migration, /v_user_id uuid/iu);
  assert.match(migration, /v_device_id uuid/iu);
  assert.match(migration, /h\.user_id=v_user_id/iu);
  assert.match(migration, /h\.device_id=v_device_id/iu);
  assert.match(migration, /invalid token tracker uuid/iu);
  const lockAt = migration.indexOf("pg_advisory_xact_lock");
  const firstReadAt = migration.indexOf("select h.billing_mode_slices");
  assert.ok(lockAt >= 0 && lockAt < firstReadAt, "missing-row identities must lock before SELECT FOR UPDATE");
  assert.match(migration, /select distinct[\s\S]+order by lock_key/iu);
  assert.match(migration, /concat_ws\(E'\\x1f',v_user_id::text,v_device_id::text,[\s\S]+extract\(epoch from x\.hour_start\)::text/iu);
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
        return { data: null, error: { message: "function tokentracker_hourly_ingest_v3 does not exist" } };
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
  assert.equal("billing_mode_snapshot" in fallbackRows[0], false);
  assert.equal("billing_mode_slices" in fallbackRows[0], false);
});

test("new Edge excludes compatibility summaries while preserving exact mode slices", async (t) => {
  let rpcRows = null;
  globalThis.Deno = { env: { get: (key) => ({
    TOKENTRACKER_LEGACY_HOURLY_INGEST_ENABLED: "true",
    INSFORGE_BASE_URL: "https://cloud.example",
    INSFORGE_SERVICE_ROLE_KEY: "service-role",
  })[key] } };
  globalThis.__billingIngestCreateClient = () => ({
    database: {
      from() {
        const chain = { select: () => chain, eq: () => chain, is: () => chain,
          maybeSingle: async () => ({ data: { user_id: "user-1", device_id: "device-1" }, error: null }) };
        return chain;
      },
      async rpc(_name, args) { rpcRows = args.p_rows; return { data: 2, error: null }; },
    },
  });
  t.after(() => { delete globalThis.Deno; delete globalThis.__billingIngestCreateClient; });
  const edge = await importIngestEdge();
  const compat = {
    ...row("unknown", 35),
    billing_mode_compat_summary: "base_total_v1",
    billing_mode_compat_slices: {
      api_key: { input_tokens: 11, total_tokens: 11 },
      token_plan: { input_tokens: 24, total_tokens: 24 },
    },
  };
  const response = await edge.default(new Request("https://cloud.example/functions/tokentracker-ingest", {
    method: "POST", headers: { Authorization: "Bearer device-token", "Content-Type": "application/json" },
    body: JSON.stringify({ buckets: [{ ...row("token_plan", 24) }, compat] }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(rpcRows.map((item) => [item.billing_mode, item.total_tokens]).sort(), [["api_key", 11], ["token_plan", 24]]);
  assert.equal(rpcRows.every((item) => item.billing_mode_snapshot === true), true);
  assert.equal(rpcRows.reduce((sum, item) => sum + item.total_tokens, 0), 35);
});

test("authoritative snapshots replace legacy and stale base totals idempotently", async () => {
  const migration = await fs.readFile(
    path.join(__dirname, "..", "migrations", "20260818120000_add-hourly-billing-mode.sql"),
    "utf8",
  );
  assert.match(migration, /if coalesce\(r\.billing_mode_snapshot,false\) then[\s\S]+jsonb_object_agg[\s\S]+else[\s\S]+select h\.billing_mode_slices/iu);
  const applySnapshot = (_existing, snapshot) => ({ ...snapshot });
  let slices = { unknown: 100 };
  slices = applySnapshot(slices, { api_key: 120 });
  assert.deepEqual(slices, { api_key: 120 });
  slices = applySnapshot(slices, { api_key: 40, token_plan: 80 });
  assert.deepEqual(slices, { api_key: 40, token_plan: 80 });
  slices = applySnapshot(slices, { api_key: 40, token_plan: 80 });
  assert.equal(Object.values(slices).reduce((sum, value) => sum + value, 0), 120);
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
