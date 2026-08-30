const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

function apiRow(overrides = {}) {
  return {
    source: "codex",
    model: "shared-model",
    hour_start: "2026-05-03T00:00:00.000Z",
    input_tokens: 1_000_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 1_000_000,
    conversation_count: 1,
    billing_mode: "api_key",
    billing_mode_confidence: "provider_receipt",
    provider_id: "deepseek",
    actual_cost_usd: 1,
    spend_authority: "official_invoice",
    ...overrides,
  };
}

async function withProviderFixture(rows, run, config = {}) {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-provider-api-stats-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await fs.promises.writeFile(
      queuePath,
      rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
      "utf8",
    );
    await fs.promises.writeFile(
      path.join(tmp, "config.json"),
      `${JSON.stringify({
        pricingRules: [
          { source: "codex", model: "shared-model", inputPricePer1M: 1, outputPricePer1M: 0, currency: "USD" },
          { source: "claude", model: "claude-model", inputPricePer1M: 2, outputPricePer1M: 0, currency: "USD" },
          { source: "hermes", model: "hermes-model", inputPricePer1M: 3, outputPricePer1M: 0, currency: "USD" },
          ...(config.pricingRules || []),
        ],
        ...config,
      }, null, 2)}\n`,
      "utf8",
    );
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: tmp,
      tokenOnlyDirectoryStatesProvider: () => ({}),
      now: () => new Date(config.nowIso || "2026-05-09T12:00:00.000Z"),
    });
    await run((endpoint) => callEndpoint(handler, endpoint), handler);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
}

async function callEndpoint(handler, endpoint) {
  const url = new URL(`http://localhost${endpoint}`);
  const chunks = [];
  const req = { method: "GET", url: `${url.pathname}${url.search}`, headers: { host: "localhost" } };
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead(code) { this.statusCode = code; },
    write(chunk) { chunks.push(chunk); },
    end(body) { if (body) chunks.push(body); },
  };
  assert.equal(await handler(req, res, url), true);
  assert.equal(res.statusCode, 200);
  return JSON.parse(chunks.join(""));
}

async function callWithOptions(handler, endpoint, { method = "GET", headers = {}, body = "" } = {}) {
  const url = new URL(`http://127.0.0.1:7680${endpoint}`);
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = `${url.pathname}${url.search}`;
  req.headers = { host: "127.0.0.1:7680", ...headers };
  const chunks = [];
  const res = {
    statusCode: 200,
    headers: {},
    setHeader() {},
    writeHead(code, responseHeaders = {}) {
      this.statusCode = code;
      this.headers = { ...responseHeaders };
    },
    write(chunk) { chunks.push(chunk); },
    end(chunk) { if (chunk) chunks.push(chunk); },
  };
  assert.equal(await handler(req, res, url), true);
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: JSON.parse(chunks.join("") || "{}"),
  };
}

function startBalanceServer() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { balance: 123.45, currency: "USD" } }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function startOfficialCostsServer() {
  const requests = [];
  const costs = [1, 0, 2, 0, 0, 0, 3];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url, "http://127.0.0.1");
      requests.push({
        pathname: requestUrl.pathname,
        search: Object.fromEntries(requestUrl.searchParams),
        authorization: req.headers.authorization,
      });
      const start = Number(requestUrl.searchParams.get("start_time"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        object: "page",
        data: costs.map((cost, index) => ({
          object: "bucket",
          start_time: start + index * 86400,
          end_time: start + (index + 1) * 86400,
          results: [{
            object: "organization.costs.result",
            amount: { value: cost, currency: "usd" },
          }],
        })),
        has_more: false,
        next_page: null,
      }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}`, requests });
    });
  });
}

test("provider-stats joins exact official Provider/day costs without inventing Agent or model cash attribution", async () => {
  const { server, url, requests } = await startOfficialCostsServer();
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-provider-api-official-daily-"));
  const secrets = new Map();
  const secret = "sk-official-daily-private";
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await fs.promises.writeFile(queuePath, [
      apiRow({
        provider_id: "openai",
        actual_cost_usd: undefined,
        spend_authority: undefined,
      }),
      apiRow({
        source: "claude",
        model: "claude-model",
        provider_id: "openai",
        hour_start: "2026-05-05T00:00:00.000Z",
        actual_cost_usd: undefined,
        spend_authority: undefined,
      }),
      apiRow({
        provider_id: "deepseek",
        actual_cost_usd: undefined,
        spend_authority: undefined,
      }),
    ].map(JSON.stringify).join("\n") + "\n", "utf8");
    await fs.promises.writeFile(path.join(tmp, "config.json"), "{}\n", "utf8");
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: tmp,
      providerApiTestMode: true,
      credentialStore: {
        isAvailable: () => true,
        saveSecret(ref, value) { secrets.set(ref, String(value)); return { ok: true, masked: "••••vate" }; },
        readSecret(ref) { return secrets.get(ref) || null; },
        deleteSecret(ref) { return secrets.delete(ref); },
        listRefs() { return Array.from(secrets.keys()); },
      },
      now: () => new Date("2026-05-09T12:00:00.000Z"),
    });
    const auth = await callWithOptions(handler, "/api/local-auth");
    const authHeaders = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": auth.body.token,
      origin: "http://127.0.0.1:7680",
    };
    const created = await callWithOptions(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        providerId: "openai",
        label: "OpenAI official costs",
        requestUrl: `${url}/v1/organization/costs`,
        requestMethod: "GET",
        authType: "bearer",
        balancePath: "data",
        refreshIntervalSeconds: 300,
        enabled: true,
      }),
    });
    assert.equal(created.statusCode, 200, JSON.stringify(created.body));
    await callWithOptions(handler, "/functions/tokentracker-provider-api-secrets", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ configId: created.body.config.id, secret }),
    });

    const body = await callEndpoint(
      handler,
      "/functions/tokentracker-provider-api-stats?from=2026-05-03&to=2026-05-09&tz=Asia%2FShanghai",
    );
    assert.deepEqual(body.period, {
      from: "2026-05-03",
      to: "2026-05-09",
      days: 7,
      time_zone: "UTC",
    });
    assert.deepEqual(body.providers.map((provider) => provider.provider_id), ["openai"]);
    const openai = body.providers[0];
    assert.equal(openai.cost_usd, 6);
    assert.deepEqual(openai.daily.map((day) => day.cost_usd), [1, 0, 2, 0, 0, 0, 3]);
    assert.ok(openai.agents.every((agent) => agent.cost_usd === null));
    assert.ok(openai.models.every((model) => model.cost_usd === null));
    assert.ok(openai.daily.every((day) => (
      day.agents.every((agent) => agent.cost_usd === null)
      && day.models.every((model) => model.cost_usd === null)
    )));
    assert.equal(body.totals.cost_usd, 6);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].search, {
      start_time: String(Date.parse("2026-05-03T00:00:00.000Z") / 1000),
      end_time: String(Date.parse("2026-05-10T00:00:00.000Z") / 1000),
      bucket_width: "1d",
      limit: "180",
    });
    assert.equal(requests[0].authorization, `Bearer ${secret}`);
    assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal(JSON.stringify(body).includes(url), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-stats merges agents by true Provider and splits one agent across Providers", async () => {
  const secret = "sk-provider-stats-must-not-leak";
  await withProviderFixture([
    apiRow({
      account_ref: "account/deepseek/main",
      api_key: secret,
      endpoint_origin: "https://api.deepseek.com/v1/chat/completions",
    }),
    apiRow({
      source: "claude",
      model: "claude-model",
      account_ref: "account/deepseek/main",
      input_tokens: 2_000_000,
      total_tokens: 2_000_000,
      actual_cost_usd: 4,
    }),
    // Same Agent/model/hour/mode, different Provider: neither row may overwrite the other.
    apiRow({ provider_id: "moonshot" }),
    apiRow({ billing_mode: "token_plan", provider_id: "minimax" }),
    apiRow({ billing_mode: "unknown", provider_id: "xiaomi_mimo" }),
    // Trusted API attribution alone is insufficient: a zero-cost Provider is hidden.
    apiRow({ source: "cursor", model: "unpriced-model", provider_id: "openai", actual_cost_usd: 0 }),
  ], async (call) => {
    const body = await call(
      "/functions/tokentracker-provider-api-stats?from=2020-01-01&to=2030-12-31&tz=UTC",
    );

    assert.deepEqual(body.providers.map((provider) => provider.provider_id), ["deepseek", "moonshot"]);
    const deepseek = body.providers[0];
    assert.equal(deepseek.display_name, "DeepSeek");
    assert.equal(deepseek.account_label, null);
    assert.equal(deepseek.account_ref, "account/deepseek/main");
    assert.deepEqual(deepseek.agents.map((agent) => agent.id), ["claude", "codex"]);
    assert.deepEqual(deepseek.models.map((model) => model.id), ["claude-model", "shared-model"]);
    assert.deepEqual(deepseek.period, { from: "2026-05-03", to: "2026-05-09", days: 7, time_zone: "UTC" });
    assert.equal(deepseek.tokens, 3_000_000);
    assert.equal(deepseek.request_count, null);
    assert.equal(deepseek.request_count_basis, "unavailable");
    assert.equal(deepseek.cost_usd, 5);
    assert.deepEqual(deepseek.cost_basis, {
      authority: "official_invoice",
      accuracy: "exact",
    });
    assert.equal(deepseek.balance, null);
    assert.equal(deepseek.daily.length, 7);
    assert.deepEqual(deepseek.daily.map((day) => day.date), [
      "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
      "2026-05-07", "2026-05-08", "2026-05-09",
    ]);
    assert.equal(deepseek.daily[0].tokens, 3_000_000);
    assert.equal(deepseek.daily[0].cost_usd, 5);
    assert.deepEqual(deepseek.daily[0].cost_basis, deepseek.cost_basis);
    assert.equal(deepseek.daily[0].request_count, null);
    assert.deepEqual(deepseek.daily[0].agents.map((agent) => agent.id), ["claude", "codex"]);
    assert.deepEqual(deepseek.daily[0].models.map((model) => model.id), ["claude-model", "shared-model"]);
    assert.equal(deepseek.daily[1].tokens, 0);
    assert.equal(body.totals.total_tokens, 4_000_000);
    assert.equal(body.totals.cost_usd, 6);
    assert.equal(body.totals.provider_count, 2);
    assert.equal(body.totals.request_count, null);
    assert.equal(body.totals_scope, "api_key_attributed_official_billed_cost_positive");
    assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal(JSON.stringify(body).includes("api.deepseek.com"), false);
    assert.equal(Object.hasOwn(deepseek, "source"), false);
    assert.equal(Object.hasOwn(deepseek, "source_display_name"), false);
  });
});

test("provider-stats excludes local price estimates and admits only explicit official billed cost facts", async () => {
  await withProviderFixture([
    apiRow({
      provider_id: "deepseek",
      actual_cost_usd: undefined,
      spend_authority: undefined,
    }),
    apiRow({
      provider_id: "openai",
      actual_cost_usd: 4.25,
      spend_authority: "official_invoice",
    }),
  ], async (call) => {
    const body = await call(
      "/functions/tokentracker-provider-api-stats?from=2026-05-03&to=2026-05-09&tz=UTC",
    );

    assert.deepEqual(body.providers.map((provider) => provider.provider_id), ["openai"]);
    assert.equal(body.providers[0].cost_usd, 4.25);
    assert.deepEqual(body.providers[0].cost_basis, {
      authority: "official_invoice",
      accuracy: "exact",
    });
    assert.equal(body.totals.cost_usd, 4.25);
    assert.equal(body.totals_scope, "api_key_attributed_official_billed_cost_positive");
  });
});

test("recent Provider API facts reject hostile web origins before aggregate-cache handling", async () => {
  await withProviderFixture([
    apiRow({
      actual_cost_usd: 4.25,
      spend_authority: "official_invoice",
      account_ref: "account/deepseek/private",
    }),
  ], async (_call, handler) => {
    const endpoint = "/functions/tokentracker-provider-api-stats?from=2026-05-03&to=2026-05-09&tz=UTC";
    const allowed = await callWithOptions(handler, endpoint, {
      headers: { origin: "http://127.0.0.1:4173" },
    });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:4173");
    assert.equal(allowed.body.providers[0].account_ref, "account/deepseek/private");

    const cachedAllowed = await callWithOptions(handler, endpoint, {
      headers: { origin: "http://localhost:4173" },
    });
    assert.equal(cachedAllowed.statusCode, 200);
    assert.equal(cachedAllowed.headers["Access-Control-Allow-Origin"], "http://localhost:4173");
    assert.equal(cachedAllowed.headers["X-TokenTracker-Usage-Cache"], "hit");

    const hostile = await callWithOptions(handler, endpoint, {
      headers: { origin: "https://hostile.example" },
    });
    assert.equal(hostile.statusCode, 403);
    assert.equal(Object.hasOwn(hostile.headers, "Access-Control-Allow-Origin"), false);
    assert.deepEqual(hostile.body, { ok: false, error: "Forbidden" });
    assert.equal(JSON.stringify(hostile.body).includes("account/deepseek/private"), false);
  });
});

test("public selected-range Provider stats never serialize private account references", async () => {
  const privateRef = "account/openai/private";
  await withProviderFixture([
    apiRow({ provider_id: "openai", account_ref: privateRef }),
  ], async (_call, handler) => {
    const response = await callWithOptions(
      handler,
      "/functions/tokentracker-provider-stats?from=2026-05-03&to=2026-05-09&tz=UTC",
      { headers: { origin: "https://hostile.example" } },
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Access-Control-Allow-Origin"], "*");
    assert.equal(response.body.providers[0].account_ref, null);
    assert.equal(JSON.stringify(response.body).includes(privateRef), false);
  });
});

test("provider-stats does not turn a positive local list-price estimate into billed spend", async () => {
  await withProviderFixture([
    apiRow({
      provider_id: "openai",
      model: "tiny-model",
      input_tokens: 1,
      total_tokens: 1,
      actual_cost_usd: undefined,
      spend_authority: undefined,
    }),
  ], async (call) => {
    const body = await call(
      "/functions/tokentracker-provider-api-stats?from=2026-05-03&to=2026-05-09&tz=UTC",
    );

    assert.deepEqual(body.providers, []);
    assert.equal(body.totals.cost_usd, 0);
  }, {
    pricingRules: [{
      source: "codex",
      model: "tiny-model",
      inputPricePer1M: 1,
      outputPricePer1M: 0,
      currency: "USD",
    }],
  });
});

test("provider-stats does not advertise a positive-cost card when the response precision rounds cost to zero", async () => {
  await withProviderFixture([
    apiRow({
      provider_id: "openai",
      model: "sub-micro-cost-model",
      input_tokens: 1,
      total_tokens: 1,
      actual_cost_usd: undefined,
      spend_authority: undefined,
    }),
  ], async (call) => {
    const body = await call(
      "/functions/tokentracker-provider-api-stats?tz=UTC",
    );

    assert.deepEqual(body.providers, []);
    assert.equal(body.totals.provider_count, 0);
    assert.equal(body.totals.cost_usd, 0);
  }, {
    pricingRules: [{
      source: "codex",
      model: "sub-micro-cost-model",
      inputPricePer1M: 0.4,
      outputPricePer1M: 0,
      currency: "USD",
    }],
  });
});

test("provider-stats computes status and latency only from Provider-attributed request samples", async () => {
  await withProviderFixture([
    apiRow({ hour_start: "2026-05-03T00:00:00.000Z", request_id: "req-200", record_kind: "request_event", status: 200, latency_ms: 100 }),
    apiRow({ hour_start: "2026-05-03T00:00:00.000Z", request_id: "req-201", record_kind: "request_event", status: 201, latency_ms: 300 }),
    apiRow({ hour_start: "2026-05-03T00:00:00.000Z", request_id: "req-499", record_kind: "request_event", status: 499, latency_ms: 200 }),
    apiRow({ hour_start: "2026-05-03T00:00:00.000Z", request_id: "req-500", record_kind: "request_event", status: 500, latency_ms: 400 }),
    apiRow({ hour_start: "2026-05-03T00:00:00.000Z", request_id: "req-no-status", record_kind: "request_event", status: null, latency_ms: null }),
    // A same-Provider/day aggregate row means request coverage is incomplete,
    // even though real request events exist for its status/latency metrics.
    apiRow({
      hour_start: "2026-05-03T01:00:00.000Z",
      record_kind: "aggregate_bucket",
      input_tokens: 0,
      total_tokens: 0,
      conversation_count: 10,
    }),
    // Same Agent but no Provider attribution: this request must not be inferred into DeepSeek.
    apiRow({ hour_start: "2026-05-03T05:00:00.000Z", provider_id: undefined, status: 200, latency_ms: 1 }),
    apiRow({
      hour_start: "2026-05-03T06:00:00.000Z",
      provider_id: "moonshot",
      record_kind: "aggregate_bucket",
      status: 200,
      latency_ms: 10,
    }),
  ], async (call) => {
    const body = await call(
      "/functions/tokentracker-provider-api-stats?from=2026-05-03&to=2026-05-09&tz=UTC",
    );
    const deepseek = body.providers.find((provider) => provider.provider_id === "deepseek");
    assert.equal(deepseek.status_sample_count, 4);
    assert.equal(deepseek.success_rate_sample_count, 3);
    assert.equal(deepseek.success_count, 2);
    assert.equal(deepseek.failure_count, 1);
    assert.equal(deepseek.interrupted_count, 1);
    assert.equal(deepseek.success_rate, 66.67);
    assert.equal(deepseek.latency_sample_count, 4);
    assert.equal(deepseek.avg_latency_ms, 250);
    assert.equal(deepseek.request_count, null);
    assert.equal(deepseek.request_count_basis, "unavailable");
    assert.equal(deepseek.daily[0].request_count, null);
    assert.equal(deepseek.daily[0].request_count_basis, "unavailable");
    assert.equal(deepseek.agents.find((agent) => agent.id === "codex").request_count, null);
    assert.equal(deepseek.models.find((model) => model.id === "shared-model").request_count, null);
    assert.deepEqual(deepseek.availability, { status: "measured", latency: "measured" });

    const moonshot = body.providers.find((provider) => provider.provider_id === "moonshot");
    assert.equal(moonshot.status_sample_count, 0);
    assert.equal(moonshot.success_rate_sample_count, 0);
    assert.equal(moonshot.latency_sample_count, 0);
    assert.equal(moonshot.success_rate, null);
    assert.equal(moonshot.avg_latency_ms, null);
    assert.deepEqual(moonshot.availability, { status: "unavailable", latency: "unavailable" });
  });
});

test("provider-stats keeps request counts null when no request-count fact exists", async () => {
  await withProviderFixture([
    apiRow({ conversation_count: undefined }),
  ], async (call) => {
    const body = await call(
      "/functions/tokentracker-provider-api-stats?from=2026-05-03&to=2026-05-09&tz=UTC",
    );
    const provider = body.providers[0];
    assert.equal(provider.request_count, null);
    assert.equal(provider.request_count_basis, "unavailable");
    assert.equal(provider.agents[0].request_count, null);
    assert.equal(provider.models[0].request_count, null);
    assert.equal(provider.daily[0].request_count, null);
    assert.equal(body.totals.request_count, null);
  });
});

test("provider-stats falls back safely when a date-shaped to value is invalid", async () => {
  await withProviderFixture([], async (call) => {
    const body = await call(
      "/functions/tokentracker-provider-api-stats?from=2026-05-03&to=2026-99-99&tz=UTC",
    );

    assert.equal(body.to, "2026-05-09");
    assert.equal(body.from, "2026-05-03");
    assert.equal(body.requested_to, "2026-99-99");
  });
});

test("provider-stats exposes only a freshly synced reliable balance and invalidates its prior response", async () => {
  const { server, url } = await startBalanceServer();
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-provider-api-balance-stats-"));
  const secrets = new Map();
  const secret = "sk-provider-balance-private-12345";
  let localNowMs = Date.now() + 1_000;
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await fs.promises.writeFile(queuePath, [
      JSON.stringify(apiRow({ provider_id: "openai", hour_start: new Date(localNowMs).toISOString() })),
      JSON.stringify(apiRow({
        provider_id: "anthropic",
        hour_start: new Date(localNowMs).toISOString(),
        input_tokens: 1,
        total_tokens: 1,
      })),
    ].join("\n") + "\n", "utf8");
    await fs.promises.writeFile(path.join(tmp, "config.json"), JSON.stringify({
      pricingRules: [{
        source: "codex",
        model: "shared-model",
        inputPricePer1M: 1,
        outputPricePer1M: 0,
        currency: "USD",
      }],
    }), "utf8");
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: tmp,
      providerApiTestMode: true,
      credentialStore: {
        isAvailable: () => true,
        saveSecret(ref, value) { secrets.set(ref, String(value)); return { ok: true, masked: "••••2345" }; },
        readSecret(ref) { return secrets.get(ref) || null; },
        deleteSecret(ref) { return secrets.delete(ref); },
        listRefs() { return Array.from(secrets.keys()); },
      },
      now: () => new Date(localNowMs),
    });
    const localAuth = await callWithOptions(handler, "/api/local-auth");
    const authHeaders = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": localAuth.body.token,
      origin: "http://127.0.0.1:7680",
    };
    const created = await callWithOptions(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        providerId: "openai",
        label: "OpenAI account",
        requestUrl: `${url}/balance`,
        requestMethod: "GET",
        authType: "bearer",
        apiKeyRef: "",
        balancePath: "data.balance",
        currencyPath: "data.currency",
        refreshIntervalSeconds: 300,
        enabled: true,
      }),
    });
    assert.equal(created.statusCode, 200, JSON.stringify(created.body));
    const configId = created.body.config.id;
    await callWithOptions(handler, "/functions/tokentracker-provider-api-secrets", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ configId, secret }),
    });

    const unsafeLabel = `Unsafe ${secret} ${url}`;
    const unsafeCreated = await callWithOptions(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        providerId: "anthropic",
        label: unsafeLabel,
        requestUrl: `${url}/balance`,
        requestMethod: "GET",
        authType: "bearer",
        apiKeyRef: "",
        balancePath: "data.balance",
        currencyPath: "data.currency",
        refreshIntervalSeconds: 300,
        enabled: true,
      }),
    });
    assert.equal(unsafeCreated.statusCode, 200, JSON.stringify(unsafeCreated.body));

    const endpoint = "/functions/tokentracker-provider-api-stats?from=2026-05-03&to=2026-05-09&tz=UTC";
    const before = await callWithOptions(handler, endpoint);
    assert.equal(before.body.providers[0].account_label, "OpenAI account");
    assert.equal(before.body.providers[0].balance, null);
    const anthropic = before.body.providers.find((provider) => provider.provider_id === "anthropic");
    assert.equal(anthropic.display_name, "Anthropic");
    assert.equal(anthropic.account_label, null);
    assert.equal(JSON.stringify(before.body).includes(unsafeLabel), false);

    const refreshed = await callWithOptions(
      handler,
      `/functions/tokentracker-provider-api-refresh?id=${encodeURIComponent(configId)}`,
      { method: "POST", headers: authHeaders },
    );
    assert.equal(refreshed.body.balance.status, "synced", JSON.stringify(refreshed.body));

    const after = await callWithOptions(handler, endpoint);
    assert.equal(after.body.providers[0].account_label, "OpenAI account");
    assert.equal(after.body.providers[0].balance.amount, 123.45);
    assert.equal(after.body.providers[0].balance.currency, "USD");
    assert.ok(Number.isFinite(Date.parse(after.body.providers[0].balance.observed_at)));
    const serialized = JSON.stringify(after.body);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes(url), false);
    assert.equal(serialized.includes("apiKeyRef"), false);

    localNowMs += 30_001;
    const expired = await callWithOptions(handler, endpoint);
    const expiredOpenAi = expired.body.providers.find((provider) => provider.provider_id === "openai");
    assert.equal(expiredOpenAi.balance, null);

    const second = await callWithOptions(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        providerId: "openai",
        label: `Backup ${secret} ${url}`,
        requestUrl: `${url}/balance`,
        requestMethod: "GET",
        authType: "bearer",
        apiKeyRef: "",
        balancePath: "data.balance",
        currencyPath: "data.currency",
        refreshIntervalSeconds: 300,
        enabled: true,
      }),
    });
    assert.equal(second.statusCode, 200, JSON.stringify(second.body));
    const ambiguous = await callWithOptions(handler, endpoint);
    assert.equal(ambiguous.body.providers[0].account_label, null);
    assert.equal(ambiguous.body.providers[0].balance, null);
    const ambiguousSerialized = JSON.stringify(ambiguous.body);
    assert.equal(ambiguousSerialized.includes(secret), false);
    assert.equal(ambiguousSerialized.includes(url), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-stats uses the explicit seven UTC billing days while preserving the requested Shanghai zone", async () => {
  await withProviderFixture([
    apiRow({ hour_start: "2026-05-02T15:59:59.999Z" }),
    apiRow({ hour_start: "2026-05-02T16:00:00.000Z", input_tokens: 2_000_000, total_tokens: 2_000_000 }),
    apiRow({ hour_start: "2026-05-09T15:59:59.999Z", input_tokens: 3_000_000, total_tokens: 3_000_000 }),
    apiRow({ hour_start: "2026-05-09T16:00:00.000Z", input_tokens: 4_000_000, total_tokens: 4_000_000 }),
  ], async (call) => {
    const body = await call(
      "/functions/tokentracker-provider-api-stats?from=2026-05-03&to=2026-05-09&tz=Asia%2FShanghai",
    );
    assert.deepEqual(body.period, { from: "2026-05-03", to: "2026-05-09", days: 7, time_zone: "UTC" });
    assert.equal(body.requested_time_zone, "Asia/Shanghai");
    assert.equal(body.providers[0].tokens, 7_000_000);
    assert.equal(body.providers[0].daily[0].tokens, 0);
    assert.equal(body.providers[0].daily[6].tokens, 7_000_000);
  });
});

test("provider-stats reports an explicit UTC offset without exposing raw minutes", async () => {
  await withProviderFixture([
    apiRow({ hour_start: "2026-05-03T00:00:00.000Z" }),
  ], async (call) => {
    const body = await call(
      "/functions/tokentracker-provider-api-stats?from=2026-05-03&to=2026-05-09&tz_offset_minutes=480",
    );
    assert.equal(body.period.time_zone, "UTC");
    assert.equal(body.providers[0].period.time_zone, "UTC");
    assert.equal(body.requested_time_zone, "UTC+08:00");
    assert.equal(body.providers[0].daily[0].date, "2026-05-03");
  });
});

test("provider-stats keeps official billing days in UTC across a requested New York DST boundary", async () => {
  await withProviderFixture([
    apiRow({ hour_start: "2026-03-03T04:59:59.999Z" }),
    apiRow({ hour_start: "2026-03-03T05:00:00.000Z", input_tokens: 2_000_000, total_tokens: 2_000_000 }),
    apiRow({ hour_start: "2026-03-08T05:00:00.000Z", input_tokens: 3_000_000, total_tokens: 3_000_000 }),
    apiRow({ hour_start: "2026-03-10T03:59:59.999Z", input_tokens: 4_000_000, total_tokens: 4_000_000 }),
    apiRow({ hour_start: "2026-03-10T04:00:00.000Z", input_tokens: 5_000_000, total_tokens: 5_000_000 }),
  ], async (call) => {
    const body = await call(
      "/functions/tokentracker-provider-api-stats?from=2026-03-03&to=2026-03-09&tz=America%2FNew_York",
    );
    assert.equal(body.requested_time_zone, "America/New_York");
    assert.equal(body.providers[0].tokens, 6_000_000);
    assert.deepEqual(body.providers[0].daily.map((day) => day.date), [
      "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06",
      "2026-03-07", "2026-03-08", "2026-03-09",
    ]);
    assert.equal(body.providers[0].daily[0].tokens, 3_000_000);
    assert.equal(body.providers[0].daily[5].tokens, 3_000_000);
    assert.equal(body.providers[0].daily[6].tokens, 0);
  }, { nowIso: "2026-03-09T12:00:00.000Z" });
});
