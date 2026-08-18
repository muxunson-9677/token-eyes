"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const esbuild = require("esbuild");
const { loadDashboardModule } = require("./helpers/load-dashboard-module");

const EDGE_NAMES = ["summary", "daily", "hourly", "monthly", "heatmap", "model-breakdown"];

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signedJwt(secret) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 3600 }));
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function importEdge(name) {
  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, `../dashboard/edge-patches/tokentracker-account-${name}.ts`)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    plugins: [{
      name: "mock-insforge",
      setup(build) {
        build.onResolve({ filter: /^npm:@insforge\/sdk$/ }, () => ({ path: "insforge", namespace: "mock" }));
        build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: "export const createClient = (...args) => globalThis.__accountBillingCreateClient(...args);",
          loader: "js",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("all six account APIs request billing-aware grouped rows and expose mode totals", async () => {
  const root = path.resolve(__dirname, "..");
  const migration = await fs.readFile(path.join(root, "migrations", "20260818120000_add-hourly-billing-mode.sql"), "utf8");
  assert.match(migration, /account_usage_grouped_v2/iu);
  assert.match(migration, /billing_mode_slices/iu);
  assert.match(migration, /billing_mode_usage_totals/iu);
  assert.match(migration, /group by bucket,source,model/iu);
  assert.match(migration, /source='cursor'/iu);
  assert.match(migration, /h\.device_id=any\(v_device_ids\)/iu);
  assert.match(migration, /v_device_ids := coalesce\(p_device_ids,array\[\]::text\[\]\)::uuid\[\]/iu);
  assert.doesNotMatch(migration, /h\.user_id::text\s*=\s*p_user_id/iu);
  assert.doesNotMatch(migration, /h\.device_id::text\s*=\s*any/iu);
  assert.match(migration, /set search_path = pg_catalog, public/iu);
  const compactMigration = migration.replace(/\s+/gu, " ");
  const signature = String.raw`public\.account_usage_grouped_v2\(\s*text\s*,\s*text\[\]\s*,\s*timestamptz\s*,\s*timestamptz\s*,\s*text\s*,\s*text\s*,\s*integer\s*\)`;
  assert.match(
    compactMigration,
    new RegExp(`revoke all on function ${signature} from public\s*,\s*anon\s*,\s*authenticated`, "iu"),
  );
  assert.match(
    compactMigration,
    new RegExp(`grant execute on function ${signature} to service_role`, "iu"),
  );
  assert.doesNotMatch(
    compactMigration,
    new RegExp(`grant execute on function ${signature} to (?:public|anon|authenticated)`, "iu"),
  );
  for (const name of EDGE_NAMES) {
    const source = await fs.readFile(path.join(root, "dashboard", "edge-patches", `tokentracker-account-${name}.ts`), "utf8");
    assert.match(source, /rpc\("account_usage_grouped_v2"/u, name);
    assert.match(source, /billing_mode_token_totals:\s*BillingModeTokenTotals\s*\|\s*null/u, name);
    assert.match(source, /billing_mode_token_totals/u, name);
    assert.match(source, /INSFORGE_SERVICE_ROLE_KEY/u, name);
    assert.match(source, /edgeFunctionToken:\s*serviceRoleKey/u, name);
  }
});

test("account daily conserves api and plan slices in its cloud response", async (t) => {
  const secret = "account-billing-test-secret";
  const groupedRows = [{
    bucket: "2026-08-18", source: "deepseek-harness", model: "deepseek-v4", total_tokens: 33,
    billing_mode_token_totals: { api_key: 11, token_plan: 22, unknown: 0 },
  }];
  let rpcName = null;
  globalThis.Deno = { env: { get: (key) => ({
    INSFORGE_BASE_URL: "https://cloud.example",
    INSFORGE_SERVICE_ROLE_KEY: "service-role",
    JWT_SECRET: secret,
  })[key] } };
  globalThis.__accountBillingCreateClient = () => ({
    database: {
      from() {
        const result = { data: [{ id: "device-1" }], error: null };
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
        };
        return chain;
      },
      async rpc(name) {
        rpcName = name;
        return { data: groupedRows, error: null };
      },
    },
  });
  t.after(() => {
    delete globalThis.Deno;
    delete globalThis.__accountBillingCreateClient;
  });

  const edge = await importEdge("daily");
  const response = await edge.default(new Request(
    "https://cloud.example/functions/tokentracker-account-daily?from=2026-08-18&to=2026-08-18&tz=UTC",
    { headers: { Authorization: `Bearer ${signedJwt(secret)}` } },
  ));
  assert.equal(response.status, 200);
  assert.equal(rpcName, "account_usage_grouped_v2");
  const body = await response.json();
  assert.equal(body.data[0].total_tokens, 33);
  assert.deepEqual(body.data[0].billing_mode_token_totals, { api_key: 11, token_plan: 22, unknown: 0 });
  assert.equal(Object.values(body.data[0].billing_mode_token_totals).reduce((sum, value) => sum + value, 0), 33);
});

test("account model breakdown preserves mixed attribution through buildFleetData", async (t) => {
  const secret = "account-model-billing-test-secret";
  const groupedRows = [{
    bucket: "2026-08-18", source: "codex", model: "gpt-5",
    total_tokens: 1_000_000, input_tokens: 1_000_000, output_tokens: 0, cached_input_tokens: 0,
    cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversations: 1,
    billing_mode_token_totals: { api_key: 400_000, token_plan: 600_000, unknown: 0 },
    billing_mode_usage_totals: {
      api_key: { input_tokens: 400_000, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 400_000, billable_total_tokens: 400_000 },
      token_plan: { input_tokens: 600_000, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 600_000, billable_total_tokens: 600_000 },
      unknown: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0, billable_total_tokens: 0 },
    },
  }];
  globalThis.Deno = { env: { get: (key) => ({
    INSFORGE_BASE_URL: "https://cloud.example",
    INSFORGE_SERVICE_ROLE_KEY: "service-role",
    JWT_SECRET: secret,
  })[key] } };
  globalThis.__accountBillingCreateClient = () => ({
    database: {
      from() {
        const result = { data: [{ id: "device-1" }], error: null };
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
        };
        return chain;
      },
      async rpc() { return { data: groupedRows, error: null }; },
    },
  });
  t.after(() => {
    delete globalThis.Deno;
    delete globalThis.__accountBillingCreateClient;
  });

  const edge = await importEdge("model-breakdown");
  const response = await edge.default(new Request(
    "https://cloud.example/functions/tokentracker-account-model-breakdown?from=2026-08-18&to=2026-08-18&tz=UTC",
    { headers: { Authorization: `Bearer ${signedJwt(secret)}` } },
  ));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sources[0].billing_mode, "mixed");
  assert.deepEqual(body.sources[0].billing_modes, ["api_key", "token_plan"]);
  assert.deepEqual(body.sources[0].billing_mode_token_totals, { api_key: 400_000, token_plan: 600_000, unknown: 0 });
  assert.deepEqual(body.sources[0].billing_mode_cost_totals, { api_key: 0.5, token_plan: 0.75, unknown: 0 });
  assert.equal(body.sources[0].totals.billing_mode_token_totals, undefined);
  assert.equal(body.sources[0].models[0].billing_mode, "mixed");
  assert.equal(body.sources[0].models[0].billing_mode_confidence, "unavailable");
  assert.deepEqual(body.sources[0].models[0].billing_mode_token_totals, { api_key: 400_000, token_plan: 600_000, unknown: 0 });
  assert.deepEqual(body.sources[0].models[0].billing_mode_cost_totals, { api_key: 0.5, token_plan: 0.75, unknown: 0 });
  assert.equal(body.sources[0].models[0].totals.billing_mode_token_totals, undefined);

  const { buildFleetData, filterFleetByBillingMode } = await loadDashboardModule("dashboard/src/lib/model-breakdown.ts");
  const fleet = buildFleetData(body);
  assert.equal(fleet[0].billingMode, "mixed");
  assert.equal(fleet[0].models[0].billingMode, "mixed");
  assert.equal(fleet[0].models[0].billingModeConfidence, "unavailable");
  assert.equal(filterFleetByBillingMode(fleet, "api_key")[0].models[0].cost, 0.5);
  assert.equal(filterFleetByBillingMode(fleet, "token_plan")[0].models[0].cost, 0.75);
});

test("account model breakdown filters repeated canonical source params before edge aggregation", async (t) => {
  const secret = "account-model-source-filter-secret";
  const groupedRows = [
    { bucket: "2026-08-18", source: "codex", model: "gpt-5", total_tokens: 10, billing_mode_token_totals: { api_key: 4, token_plan: 6, unknown: 0 } },
    { bucket: "2026-08-18", source: "claude", model: "opus", total_tokens: 20, billing_mode_token_totals: { api_key: 20, token_plan: 0, unknown: 0 } },
    { bucket: "2026-08-18", source: "gemini", model: "pro", total_tokens: 30, billing_mode_token_totals: { api_key: 0, token_plan: 30, unknown: 0 } },
  ];
  globalThis.Deno = { env: { get: (key) => ({
    INSFORGE_BASE_URL: "https://cloud.example",
    INSFORGE_SERVICE_ROLE_KEY: "service-role",
    JWT_SECRET: secret,
  })[key] } };
  globalThis.__accountBillingCreateClient = () => ({
    database: {
      from() {
        const result = { data: [{ id: "device-1" }], error: null };
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
        };
        return chain;
      },
      async rpc() { return { data: groupedRows, error: null }; },
    },
  });
  t.after(() => {
    delete globalThis.Deno;
    delete globalThis.__accountBillingCreateClient;
  });

  const edge = await importEdge("model-breakdown");
  const request = async (suffix) => {
    const response = await edge.default(new Request(
      `https://cloud.example/functions/tokentracker-account-model-breakdown?from=2026-08-18&to=2026-08-18&tz=UTC${suffix}`,
      { headers: { Authorization: `Bearer ${signedJwt(secret)}` } },
    ));
    assert.equal(response.status, 200);
    return response.json();
  };

  const multiple = await request("&source=%20CoDeX%20&source=CLAUDE&source=codex");
  assert.deepEqual(multiple.sources.map((entry) => entry.source).sort(), ["claude", "codex"]);
  const rollingCodex = multiple.sources.find((entry) => entry.source === "codex");
  assert.equal(rollingCodex.billing_mode, "mixed");
  assert.deepEqual(rollingCodex.billing_mode_token_totals, { api_key: 4, token_plan: 6, unknown: 0 });
  assert.equal(rollingCodex.billing_mode_cost_totals, undefined);
  assert.equal(rollingCodex.models[0].billing_mode_cost_totals, undefined);
  assert.deepEqual((await request("&source=gemini")).sources.map((entry) => entry.source), ["gemini"]);
  assert.deepEqual((await request("&source=missing")).sources, []);
  assert.deepEqual((await request("")).sources.map((entry) => entry.source).sort(), ["claude", "codex", "gemini"]);
  assert.deepEqual((await request("&source=")).sources.map((entry) => entry.source).sort(), ["claude", "codex", "gemini"]);
});
