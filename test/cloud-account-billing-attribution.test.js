"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const esbuild = require("esbuild");

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
  assert.match(migration, /group by[^;]+billing_mode/isu);
  assert.match(migration, /partition by[^\n]+source[^\n]+model[^\n]+hour_start[^\n]+billing_mode/iu);
  assert.match(migration, /where f\.source = 'cursor'/iu);
  assert.match(migration, /device_id::text = any/iu);
  for (const name of EDGE_NAMES) {
    const source = await fs.readFile(path.join(root, "dashboard", "edge-patches", `tokentracker-account-${name}.ts`), "utf8");
    assert.match(source, /rpc\("account_usage_grouped_v2"/u, name);
    assert.match(source, /billing_mode:\s*string\s*\|\s*null/u, name);
    assert.match(source, /billing_mode_token_totals/u, name);
  }
});

test("account daily conserves api and plan slices in its cloud response", async (t) => {
  const secret = "account-billing-test-secret";
  const groupedRows = [
    { bucket: "2026-08-18", source: "deepseek-harness", model: "deepseek-v4", billing_mode: "api_key", total_tokens: 11 },
    { bucket: "2026-08-18", source: "deepseek-harness", model: "deepseek-v4", billing_mode: "token_plan", total_tokens: 22 },
  ];
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
