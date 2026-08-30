const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");
const { fetchOpenAiCostsInvoice, fetchOpenAiCostsPeriod, SPEND_AUTHORITIES } = require("../src/lib/api-billing");

function createRequest({ method = "GET", headers = {}, body = "" } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.headers = headers;
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

function readJsonResponse(res) {
  return JSON.parse(res.body.toString("utf8") || "{}");
}

async function call(handler, pathName, options) {
  const req = createRequest(options);
  const res = createResponse();
  const handled = await handler(req, res, new URL(`http://127.0.0.1:7680${pathName}`));
  assert.equal(handled, true);
  return res;
}

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function createTestCredentialStore() {
  const secrets = new Map();
  return {
    isAvailable: () => true,
    saveSecret(ref, value) {
      secrets.set(ref, String(value));
      return { ok: true, masked: "••••test" };
    },
    readSecret: (ref) => secrets.get(ref) || null,
    deleteSecret: (ref) => secrets.delete(ref),
  };
}

test("api billing accounts endpoint returns accounts array when no spend records", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const res = await call(handler, "/functions/tokentracker-api-billing-accounts");
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(body.accounts));
    assert.deepEqual(SPEND_AUTHORITIES, {
      OFFICIAL_INVOICE: "official_invoice",
      LOCAL_LIST_PRICE_ESTIMATE: "local_list_price_estimate",
      UNAVAILABLE: "unavailable",
    });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("selected billing months require an explicit UTC boundary contract", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-time-zone-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const missingTimeZone = await call(handler, "/functions/tokentracker-api-billing-accounts?month=2026-01");
    const localTimeZone = await call(handler, "/functions/tokentracker-api-billing-accounts?month=2026-01&time_zone=Asia%2FShanghai");
    assert.equal(missingTimeZone.statusCode, 400);
    assert.equal(localTimeZone.statusCode, 400);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("canonical OpenAI Costs pages reach the selected UTC month cash contract", async () => {
  const requests = [];
  const januaryStart = Date.parse("2026-01-01T00:00:00.000Z") / 1000;
  const februaryStart = Date.parse("2026-02-01T00:00:00.000Z") / 1000;
  const { server, url } = await startMockServer((req, res) => {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    requests.push({
      pathname: requestUrl.pathname,
      search: Object.fromEntries(requestUrl.searchParams),
      authorization: req.headers.authorization,
    });
    const isSecondPage = requestUrl.searchParams.get("page") === "page-2";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      object: "page",
      data: isSecondPage ? [{
        object: "bucket",
        start_time: januaryStart + 86400,
        end_time: januaryStart + 172800,
        results: [
          { object: "organization.costs.result", amount: { value: 2, currency: "usd" } },
          { object: "organization.costs.result", amount: { value: 4, currency: "usd" } },
        ],
      }] : [{
        object: "bucket",
        start_time: januaryStart,
        end_time: januaryStart + 86400,
        results: [
          { object: "organization.costs.result", amount: { value: 1.25, currency: "usd" } },
          { object: "organization.costs.result", amount: { value: 0.75, currency: "usd" } },
        ],
      }],
      has_more: !isSecondPage,
      next_page: isSecondPage ? null : "page-2",
    }));
  });
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-official-"));
  const originalHomedir = os.homedir;
  const originalCodexHome = process.env.CODEX_HOME;
  const originalAgentData = process.env.AGENTDATA;
  const originalAgentDataRoots = process.env.TOKENTRACKER_AGENTDATA_ROOTS;
  os.homedir = () => tmp;
  process.env.CODEX_HOME = path.join(tmp, ".codex");
  delete process.env.AGENTDATA;
  delete process.env.TOKENTRACKER_AGENTDATA_ROOTS;
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
      providerApiTestMode: true,
    });
    const auth = readJsonResponse(await call(handler, "/api/local-auth"));
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": auth.token,
      origin: "http://127.0.0.1:7680",
    };
    const created = readJsonResponse(await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        providerId: "openai",
        label: "OpenAI Billing",
        requestUrl: `${url}/v1/organization/costs`,
        requestMethod: "GET",
        authType: "bearer",
        balancePath: "data",
        monthSpendPath: "",
        lifetimeSpendPath: "",
        currencyPath: "",
        refreshIntervalSeconds: 300,
        enabled: true,
      }),
    })).config;
    await call(handler, "/functions/tokentracker-provider-api-secrets", {
      method: "POST",
      headers,
      body: JSON.stringify({ configId: created.id, secret: "sk-official-test" }),
    });
    const body = readJsonResponse(await call(
      handler,
      "/functions/tokentracker-api-billing-accounts?month=2026-01&time_zone=UTC",
    ));
    const account = body.accounts.find((item) => item.provider === "openai");
    assert.ok(account);
    assert.equal(account.billingSource, "api");
    assert.equal(account.spendAuthority, "official_invoice");
    assert.equal(account.monthCostUsd, 8);
    assert.equal(account.lifetimeCostUsd, null);
    assert.equal(account.monthKey, "2026-01");
    assert.equal(account.billingPeriodStart, "2026-01-01T00:00:00.000Z");
    assert.equal(account.billingPeriodEnd, "2026-02-01T00:00:00.000Z");
    assert.deepEqual(account.dailyCosts, [
      { date: "2026-01-01", costUsd: 2 },
      { date: "2026-01-02", costUsd: 6 },
    ]);
    assert.deepEqual(requests.map((request) => request.search), [{
      start_time: String(januaryStart),
      end_time: String(februaryStart),
      bucket_width: "1d",
      limit: "180",
    }, {
      start_time: String(januaryStart),
      end_time: String(februaryStart),
      bucket_width: "1d",
      limit: "180",
      page: "page-2",
    }]);
    assert.deepEqual(requests.map((request) => request.pathname), [
      "/v1/organization/costs",
      "/v1/organization/costs",
    ]);
    assert.ok(requests.every((request) => request.authorization === "Bearer sk-official-test"));
  } finally {
    os.homedir = originalHomedir;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    if (originalAgentData === undefined) delete process.env.AGENTDATA;
    else process.env.AGENTDATA = originalAgentData;
    if (originalAgentDataRoots === undefined) delete process.env.TOKENTRACKER_AGENTDATA_ROOTS;
    else process.env.TOKENTRACKER_AGENTDATA_ROOTS = originalAgentDataRoots;
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("official daily costs reject overlapping buckets that do not exactly cover the seven UTC billing days", async () => {
  const start = Date.parse("2026-05-03T00:00:00.000Z") / 1000;
  const result = await fetchOpenAiCostsPeriod({
    config: {
      providerId: "openai",
      requestUrl: "https://api.openai.com/v1/organization/costs",
      requestMethod: "GET",
      authType: "bearer",
    },
    secret: "sk-redacted-test",
    fromKey: "2026-05-03",
    toKey: "2026-05-09",
    executeRequest: async () => ({
      ok: true,
      data: {
        object: "page",
        data: [0, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((offset) => ({
          object: "bucket",
          start_time: start + offset * 86400,
          end_time: start + (offset + 1) * 86400,
          results: [{
            object: "organization.costs.result",
            amount: { value: 1, currency: "usd" },
          }],
        })),
        has_more: false,
        next_page: null,
      },
    }),
  });

  assert.deepEqual(result, { ok: false, errorCode: "official_invoice_invalid" });
});

test("official OpenAI Costs atomically replaces local list-price provenance", async () => {
  const augustStart = Date.parse("2026-08-01T00:00:00.000Z") / 1000;
  const { server, url } = await startMockServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      object: "page",
      data: [{
        object: "bucket",
        start_time: augustStart,
        end_time: augustStart + 86400,
        results: [{ object: "organization.costs.result", amount: { value: 8, currency: "usd" } }],
      }],
      has_more: false,
      next_page: null,
    }));
  });
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-official-provenance-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(queuePath, `${JSON.stringify({
      source: "codex",
      model: "official-overwrite-local-model",
      hour_start: "2026-08-15T00:00:00.000Z",
      input_tokens: 1_000_000,
      output_tokens: 0,
      total_tokens: 1_000_000,
    })}\n`, "utf8");
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
      providerApiTestMode: true,
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    });
    const token = readJsonResponse(await call(handler, "/api/local-auth")).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };
    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        pricingRules: [{
          source: "codex",
          model: "official-overwrite-local-model",
          inputPricePer1M: 99,
          outputPricePer1M: 0,
          currency: "USD",
          updated_at: "2026-08-01T00:00:00.000Z",
        }],
      }),
    });
    const created = readJsonResponse(await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        providerId: "openai",
        label: "OpenAI Billing",
        requestUrl: `${url}/v1/organization/costs`,
        requestMethod: "GET",
        authType: "bearer",
        balancePath: "data",
        monthSpendPath: "",
        lifetimeSpendPath: "",
        currencyPath: "",
        refreshIntervalSeconds: 300,
        enabled: true,
      }),
    })).config;
    await call(handler, "/functions/tokentracker-provider-api-secrets", {
      method: "POST",
      headers,
      body: JSON.stringify({ configId: created.id, secret: "sk-official-provenance-test" }),
    });

    const response = await call(
      handler,
      "/functions/tokentracker-api-billing-accounts?month=2026-08&time_zone=UTC",
    );
    const openai = readJsonResponse(response).accounts.find((account) => account.provider === "openai");

    assert.equal(response.statusCode, 200);
    assert.ok(openai);
    assert.equal(openai.monthCostUsd, 8);
    assert.equal(openai.lifetimeCostUsd, null);
    assert.equal(openai.spendAuthority, "official_invoice");
    assert.equal(openai.source_kind, "official_api");
    assert.equal(openai.pricing_source, "openai-costs-api");
    assert.equal(openai.estimated, false);
    assert.equal(openai.is_stale, false);
    assert.equal(openai.note_code, "official_invoice");
    assert.deepEqual(openai.pricing_components, []);
    assert.notEqual(openai.match_kind, "exact");
    assert.notEqual(openai.matched_model, "official-overwrite-local-model");
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("multiple canonical OpenAI Costs configs stay ambiguous without retaining local pricing provenance", async () => {
  let requestCount = 0;
  const januaryStart = Date.parse("2026-01-01T00:00:00.000Z") / 1000;
  const { server, url } = await startMockServer((req, res) => {
    requestCount += 1;
    if (req.headers.authorization === "Bearer sk-ambiguous-0") {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "first candidate would fail" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      object: "page",
      data: [{
        object: "bucket",
        start_time: januaryStart,
        end_time: januaryStart + 86400,
        results: [{ object: "organization.costs.result", amount: { value: 8, currency: "usd" } }],
      }],
      has_more: false,
      next_page: null,
    }));
  });
  const originalHomedir = os.homedir;
  const originalCodexHome = process.env.CODEX_HOME;
  const originalAgentData = process.env.AGENTDATA;
  const originalAgentDataRoots = process.env.TOKENTRACKER_AGENTDATA_ROOTS;
  try {
    for (const providerOrder of [["openai", "codex"], ["codex", "openai"], ["openai", "openai"]]) {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-ambiguous-"));
      os.homedir = () => tmp;
      process.env.CODEX_HOME = path.join(tmp, ".codex");
      delete process.env.AGENTDATA;
      delete process.env.TOKENTRACKER_AGENTDATA_ROOTS;
      try {
        const trackerDir = path.join(tmp, ".tokentracker", "tracker");
        const queuePath = path.join(trackerDir, "queue.jsonl");
        await fs.mkdir(trackerDir, { recursive: true });
        await fs.writeFile(queuePath, `${JSON.stringify({
          source: "codex",
          model: "ambiguous-local-review-model",
          hour_start: "2026-01-15T00:00:00.000Z",
          input_tokens: 1_000_000,
          output_tokens: 0,
          total_tokens: 1_000_000,
        })}\n`, "utf8");
        const handler = createLocalApiHandler({
          queuePath,
          trackerDataDir: trackerDir,
          credentialStore: createTestCredentialStore(),
          providerApiTestMode: true,
          now: () => new Date("2026-01-20T00:00:00.000Z"),
        });
        const auth = readJsonResponse(await call(handler, "/api/local-auth"));
        const headers = {
          "content-type": "application/json",
          "x-tokentracker-local-auth": auth.token,
          origin: "http://127.0.0.1:7680",
        };
        await call(handler, "/functions/tokentracker-local-settings", {
          method: "POST",
          headers,
          body: JSON.stringify({
            pricingRules: [{
              source: "codex",
              model: "ambiguous-local-review-model",
              inputPricePer1M: 99,
              outputPricePer1M: 0,
              currency: "USD",
              updated_at: "2026-01-01T00:00:00.000Z",
            }],
          }),
        });
        const configs = [];
        for (const [index, providerId] of providerOrder.entries()) {
          const created = readJsonResponse(await call(handler, "/functions/tokentracker-provider-api-configs", {
            method: "POST",
            headers,
            body: JSON.stringify({
              providerId,
              label: `${providerId}-${index}`,
              requestUrl: `${url}/v1/organization/costs`,
              requestMethod: "GET",
              authType: "bearer",
              balancePath: "data",
              refreshIntervalSeconds: 300,
              enabled: true,
            }),
          })).config;
          configs.push(created);
          await call(handler, "/functions/tokentracker-provider-api-secrets", {
            method: "POST",
            headers,
            body: JSON.stringify({ configId: created.id, secret: `sk-ambiguous-${index}` }),
          });
        }

        const requestsBeforeAmbiguousRead = requestCount;
        const ambiguous = readJsonResponse(await call(
          handler,
          "/functions/tokentracker-api-billing-accounts?month=2026-01&time_zone=UTC",
        ));
        assert.equal(requestCount, requestsBeforeAmbiguousRead, providerOrder.join(","));
        const ambiguousAccount = ambiguous.accounts.find((account) => account.errorCode === "official_invoice_ambiguous");
        assert.ok(ambiguousAccount);
        assert.equal(ambiguousAccount.provider, "openai");
        assert.equal(ambiguousAccount.spendAuthority, "unavailable");
        assert.equal(ambiguousAccount.monthCostUsd, null);
        assert.equal(ambiguousAccount.lifetimeCostUsd, null);
        assert.equal(ambiguousAccount.status, "ambiguous");
        assert.equal(ambiguousAccount.candidateCount, 2);
        assert.equal(ambiguousAccount.pricing_source, null);
        assert.equal(ambiguousAccount.source_kind, null);
        assert.equal(ambiguousAccount.estimated, false);
        assert.equal(ambiguousAccount.is_stale, false);
        assert.equal(ambiguousAccount.match_kind, null);
        assert.equal(ambiguousAccount.matched_model, null);
        assert.equal(ambiguousAccount.pricing_coverage, null);
        assert.deepEqual(ambiguousAccount.pricing_components, []);
        assert.equal(ambiguous.accounts.some((account) => account.spendAuthority === "official_invoice"), false);

        await call(handler, `/functions/tokentracker-provider-api-configs?id=${configs[0].id}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ enabled: false }),
        });
        const unique = readJsonResponse(await call(
          handler,
          "/functions/tokentracker-api-billing-accounts?month=2026-01&time_zone=UTC",
        ));
        assert.equal(unique.accounts.filter((account) => account.spendAuthority === "official_invoice").length, 1);
        assert.equal(unique.accounts.find((account) => account.spendAuthority === "official_invoice").monthCostUsd, 8);
        assert.equal(unique.accounts.find((account) => account.spendAuthority === "official_invoice").source_kind, "official_api");
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    }
  } finally {
    os.homedir = originalHomedir;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    if (originalAgentData === undefined) delete process.env.AGENTDATA;
    else process.env.AGENTDATA = originalAgentData;
    if (originalAgentDataRoots === undefined) delete process.env.TOKENTRACKER_AGENTDATA_ROOTS;
    else process.env.TOKENTRACKER_AGENTDATA_ROOTS = originalAgentDataRoots;
    server.close();
  }
});

test("OpenAI Costs rejects malformed, partial, non-USD, wrong-object, and incomplete pagination responses", async () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z") / 1000;
  const validBucket = {
    object: "bucket",
    start_time: start,
    end_time: start + 86400,
    results: [{
      object: "organization.costs.result",
      amount: { value: 8, currency: "usd" },
    }],
  };
  const validPage = { object: "page", data: [validBucket], has_more: false, next_page: null };
  const cases = [
    { name: "wrong page object", pages: [{ ...validPage, object: "list" }] },
    { name: "wrong bucket object", pages: [{ ...validPage, data: [{ ...validBucket, object: "day" }] }] },
    { name: "wrong result object", pages: [{ ...validPage, data: [{ ...validBucket, results: [{ ...validBucket.results[0], object: "cost" }] }] }] },
    { name: "missing amount", pages: [{ ...validPage, data: [{ ...validBucket, results: [{ object: "organization.costs.result" }] }] }] },
    { name: "non USD", pages: [{ ...validPage, data: [{ ...validBucket, results: [{ ...validBucket.results[0], amount: { value: 8, currency: "eur" } }] }] }] },
    { name: "negative amount", pages: [{ ...validPage, data: [{ ...validBucket, results: [{ ...validBucket.results[0], amount: { value: -1, currency: "usd" } }] }] }] },
    { name: "bucket outside period", pages: [{ ...validPage, data: [{ ...validBucket, start_time: start - 86400, end_time: start }] }] },
    { name: "has more without cursor", pages: [{ ...validPage, has_more: true, next_page: null }] },
    { name: "terminal page with cursor", pages: [{ ...validPage, next_page: "unexpected" }] },
    { name: "partial pagination failure", pages: [{ ...validPage, has_more: true, next_page: "page-2" }, { ok: false }] },
  ];

  for (const testCase of cases) {
    const pages = [...testCase.pages];
    const result = await fetchOpenAiCostsInvoice({
      config: {
        providerId: "openai",
        requestUrl: "https://api.openai.com/v1/organization/costs",
        authType: "bearer",
      },
      secret: "sk-redacted-test",
      monthKey: "2026-01",
      executeRequest: async () => {
        const page = pages.shift();
        return page?.ok === false ? { ok: false, error_code: "provider_unavailable" } : { ok: true, data: page };
      },
    });
    assert.equal(result.ok, false, testCase.name);
  }
});

test("generic custom monthSpend paths can never become official invoices", async () => {
  const result = await fetchOpenAiCostsInvoice({
    config: {
      providerId: "openai",
      requestUrl: "https://billing.example.com/costs",
      authType: "bearer",
      monthSpendPath: "data.month_spend",
    },
    secret: "sk-redacted-test",
    monthKey: "2026-01",
    executeRequest: async () => ({
      ok: true,
      data: { data: { month_spend: 8, currency: "USD" } },
    }),
  });
  assert.equal(result.ok, false);
});

test("OpenAI Costs transport failures stay unavailable without exposing credential text", async () => {
  const result = await fetchOpenAiCostsInvoice({
    config: {
      providerId: "openai",
      requestUrl: "https://api.openai.com/v1/organization/costs",
      authType: "bearer",
    },
    secret: "sk-sensitive-transport-test",
    monthKey: "2026-01",
    executeRequest: async () => {
      throw new Error("upstream included sk-sensitive-transport-test");
    },
  });
  assert.deepEqual(result, { ok: false, errorCode: "official_invoice_unavailable" });
  assert.ok(!JSON.stringify(result).includes("sk-sensitive-transport-test"));
});

test("api billing accounts endpoint derives accounts from spend records (identity only, costs are null)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "claude",
        plan_label: "Max",
        amount: 20,
        currency: "USD",
        billing_cycle: "monthly",
        start_date: "2026-06-01",
      }),
    });

    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "openai",
        plan_label: "Plus",
        amount: 200,
        currency: "CNY",
        billing_cycle: "monthly",
        start_date: "2026-06-01",
      }),
    });

    const res = await call(handler, "/functions/tokentracker-api-billing-accounts");
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(body.accounts));
    assert.ok(body.accounts.length >= 2);

    const claudeAccount = body.accounts.find((a) => a.provider === "claude");
    assert.ok(claudeAccount, "claude account should exist");
    assert.equal(claudeAccount.accountName, "Claude");
    assert.equal(typeof claudeAccount.billingSource, "string");
    assert.equal(claudeAccount.spendAuthority, "unavailable");
    // Spend records establish identity only - API usage costs are null (subscription fees ≠ API usage costs)
    assert.equal(claudeAccount.monthCostUsd, null);
    assert.equal(claudeAccount.lifetimeCostUsd, null);
    assert.equal(claudeAccount.status, "not-connected");

    const openaiAccount = body.accounts.find((a) => a.provider === "openai");
    assert.ok(openaiAccount, "openai account should exist");
    assert.equal(openaiAccount.monthCostUsd, null);
    assert.equal(openaiAccount.lifetimeCostUsd, null);
    assert.equal(openaiAccount.spendAuthority, "unavailable");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("api billing account has required fields including spendAuthority", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    await call(handler, "/functions/tokentracker-spend-records", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "claude",
        plan_label: "Max",
        amount: 20,
        currency: "USD",
        billing_cycle: "monthly",
        start_date: "2026-06-01",
      }),
    });

    const res = await call(handler, "/functions/tokentracker-api-billing-accounts");
    const body = readJsonResponse(res);
    const account = body.accounts.find((a) => a.provider === "claude");

    assert.ok("provider" in account, "should have provider");
    assert.ok("accountName" in account, "should have accountName");
    assert.ok("billingSource" in account, "should have billingSource");
    assert.ok("spendAuthority" in account, "should have spendAuthority");
    assert.ok("monthCostUsd" in account, "should have monthCostUsd");
    assert.ok("lifetimeCostUsd" in account, "should have lifetimeCostUsd");
    assert.ok("status" in account, "should have status");
    assert.ok("lastSyncedAt" in account, "should have lastSyncedAt");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("api billing accounts correctly calculates cross-month costs (monthCostUsd filters current month, lifetimeCostUsd covers all history)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    const queueJsonl = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const lastMonthDate = new Date(currentYear, currentMonth - 1, 15);
    const currentMonthDate = new Date(currentYear, currentMonth, 15);

    const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}-${String(lastMonthDate.getDate()).padStart(2, "0")}T00:00:00.000Z`;
    const currentMonthKey = `${currentMonthDate.getFullYear()}-${String(currentMonthDate.getMonth() + 1).padStart(2, "0")}-${String(currentMonthDate.getDate()).padStart(2, "0")}T00:00:00.000Z`;

    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        pricingRules: [{
          source: "claude",
          model: "review-cross-month",
          inputPricePer1M: 1,
          outputPricePer1M: 0,
          currency: "USD",
          updated_at: "2026-08-01T00:00:00.000Z",
        }],
      }),
    });

    await fs.writeFile(queueJsonl,
      JSON.stringify({
        hour_start: lastMonthKey,
        source: "claude",
        model: "review-cross-month",
        total_tokens: 100_000,
        input_tokens: 100_000,
        output_tokens: 0,
        cost_usd: 999,
      }) + "\n" +
      JSON.stringify({
        hour_start: currentMonthKey,
        source: "claude",
        model: "review-cross-month",
        total_tokens: 200_000,
        input_tokens: 200_000,
        output_tokens: 0,
        cost_usd: 999,
      }) + "\n",
      "utf8"
    );

    const res = await call(handler, "/functions/tokentracker-api-billing-accounts");
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 200);

    const claudeAccount = body.accounts.find((a) => a.provider === "claude");
    assert.ok(claudeAccount, "claude account should exist");

    assert.equal(claudeAccount.status, "synced", "should be synced since queue has usage data");
    assert.equal(claudeAccount.monthCostUsd, 0.2, "monthCostUsd should only include current month cost");
    assert.equal(claudeAccount.lifetimeCostUsd, 0.3, "lifetimeCostUsd should include all history");
    assert.equal(claudeAccount.billingSource, "api");
    assert.equal(claudeAccount.spendAuthority, "local_list_price_estimate");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("API billing shared month and lifetime badge unions materially different pricing evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-lifetime-evidence-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(queuePath, `${[
      {
        source: "claude",
        model: "review-lifetime-old-model",
        hour_start: "2026-07-15T00:00:00.000Z",
        input_tokens: 1_000_000,
        output_tokens: 0,
        total_tokens: 1_000_000,
      },
      {
        source: "claude",
        model: "review-month-current-model",
        hour_start: "2026-08-15T00:00:00.000Z",
        input_tokens: 1_000_000,
        output_tokens: 0,
        total_tokens: 1_000_000,
      },
    ].map(JSON.stringify).join("\n")}\n`, "utf8");
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: trackerDir,
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    });
    const token = readJsonResponse(await call(handler, "/api/local-auth")).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };
    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        pricingRules: [
          {
            source: "claude",
            model: "review-lifetime-old-model",
            inputPricePer1M: 1,
            outputPricePer1M: 0,
            currency: "USD",
            updated_at: "2026-07-01T00:00:00.000Z",
          },
          {
            source: "claude",
            model: "review-month-current-model",
            inputPricePer1M: 2,
            outputPricePer1M: 0,
            currency: "USD",
            updated_at: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
    });

    const response = await call(
      handler,
      "/functions/tokentracker-api-billing-accounts?month=2026-08&time_zone=UTC",
    );
    const claude = readJsonResponse(response).accounts.find((account) => account.provider === "claude");

    assert.equal(response.statusCode, 200);
    assert.ok(claude);
    assert.equal(claude.monthCostUsd, 2);
    assert.equal(claude.lifetimeCostUsd, 3);
    assert.equal(claude.source_kind, "mixed");
    assert.equal(claude.pricing_source, "mixed");
    assert.deepEqual(
      claude.pricing_components.map((component) => component.matched_model).sort(),
      ["review-lifetime-old-model", "review-month-current-model"],
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("selected UTC month local estimates use latest queue identities and merge provider aliases", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-history-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });
    const rows = [
      { source: "codex", model: "gpt-5", hour_start: "2025-06-01T00:00:00.000Z", billing_mode: "api_key", input_tokens: 100_000, total_tokens: 100_000, cost_usd: 999 },
      { source: "codex", model: "gpt-5", hour_start: "2025-06-01T00:00:00.000Z", billing_mode: "api_key", input_tokens: 200_000, total_tokens: 200_000, cost_usd: 999 },
      { source: "codex", model: "gpt-5", hour_start: "2025-06-01T00:00:00.000Z", billing_mode: "token_plan", input_tokens: 400_000, total_tokens: 400_000, cost_usd: 999 },
      { source: "cursor", model: "composer-1", hour_start: "2025-06-02T00:00:00.000Z", billing_mode: "api_key", input_tokens: 300_000, total_tokens: 300_000, cost_usd: 999 },
      { source: "codex", model: "gpt-5", hour_start: "2026-08-01T00:00:00.000Z", billing_mode: "api_key", input_tokens: 9_000_000, total_tokens: 9_000_000, cost_usd: 999 },
    ];
    await fs.writeFile(queuePath, `${rows.map(JSON.stringify).join("\n")}\n`, "utf8");
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: trackerDir });
    const token = readJsonResponse(await call(handler, "/api/local-auth")).token;
    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tokentracker-local-auth": token,
        origin: "http://127.0.0.1:7680",
      },
      body: JSON.stringify({
        pricingRules: [
          { source: "codex", model: "gpt-5", inputPricePer1M: 1, outputPricePer1M: 0, currency: "USD", updated_at: "2026-08-01T00:00:00.000Z" },
          { source: "cursor", model: "composer-1", inputPricePer1M: 1, outputPricePer1M: 0, currency: "USD", updated_at: "2026-08-01T00:00:00.000Z" },
        ],
      }),
    });

    const res = await call(
      handler,
      "/functions/tokentracker-api-billing-accounts?month=2025-06&time_zone=UTC",
    );
    const body = readJsonResponse(res);
    const openai = body.accounts.find((account) => account.provider === "openai");

    assert.equal(res.statusCode, 200);
    assert.ok(openai);
    assert.equal(openai.monthCostUsd, 0.9);
    assert.equal(openai.lifetimeCostUsd, 9.9);
    assert.equal(body.accounts.filter((account) => account.provider === "openai").length, 1);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("API billing recomputes configured prices and exposes their production provenance", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-pricing-rule-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(queuePath, `${JSON.stringify({
      source: "claude",
      model: "review-fixture-model",
      hour_start: "2026-08-15T00:00:00.000Z",
      input_tokens: 600_000,
      output_tokens: 400_000,
      total_tokens: 1_000_000,
      cost_usd: 999,
    })}\n`, "utf8");
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: trackerDir,
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    });
    const token = readJsonResponse(await call(handler, "/api/local-auth")).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };
    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        pricingRules: [{
          source: "claude",
          model: "review-fixture-model",
          inputPricePer1M: 2,
          outputPricePer1M: 4,
          currency: "USD",
          updated_at: "2026-08-01T00:00:00.000Z",
        }],
      }),
    });

    const response = await call(
      handler,
      "/functions/tokentracker-api-billing-accounts?month=2026-08&time_zone=UTC",
    );
    const claude = readJsonResponse(response).accounts.find((account) => account.provider === "claude");

    assert.equal(response.statusCode, 200);
    assert.ok(claude);
    assert.equal(claude.monthCostUsd, 2.8);
    assert.equal(claude.lifetimeCostUsd, 2.8);
    assert.equal(claude.source_kind, "user_override");
    assert.equal(claude.pricing_source, "pricing-rule");
    assert.equal(claude.source_updated_at, "2026-08-01T00:00:00.000Z");
    assert.equal(claude.observed_at, "2026-08-20T00:00:00.000Z");
    assert.equal(claude.match_kind, "exact");
    assert.equal(claude.matched_model, "review-fixture-model");
    assert.equal(claude.pricing_coverage, "complete");
    assert.equal(claude.pricing_components.length, 1);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("API billing normalizes legacy inclusive Codex input before recomputing local list cost", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-legacy-codex-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(queuePath, `${JSON.stringify({
      source: "codex",
      model: "legacy-inclusive-review-model",
      hour_start: "2026-08-15T00:00:00.000Z",
      input_tokens: 1_000_000,
      cached_input_tokens: 900_000,
      output_tokens: 100_000,
      total_tokens: 1_100_000,
      cost_usd: 999,
    })}\n`, "utf8");
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: trackerDir,
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    });
    const token = readJsonResponse(await call(handler, "/api/local-auth")).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };
    await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        pricingRules: [{
          source: "codex",
          model: "legacy-inclusive-review-model",
          inputPricePer1M: 1,
          outputPricePer1M: 10,
          currency: "USD",
          updated_at: "2026-08-01T00:00:00.000Z",
        }],
      }),
    });

    const response = await call(
      handler,
      "/functions/tokentracker-api-billing-accounts?month=2026-08&time_zone=UTC",
    );
    const openai = readJsonResponse(response).accounts.find((account) => account.provider === "openai");

    assert.equal(response.statusCode, 200);
    assert.ok(openai);
    assert.equal(openai.monthCostUsd, 2);
    assert.equal(openai.lifetimeCostUsd, 2);
    assert.equal(openai.matched_model, "legacy-inclusive-review-model");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("API billing never revives a stale catalog price from persisted row cost_usd", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-stale-pricing-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(queuePath, `${JSON.stringify({
      source: "codex",
      model: "gpt-4o",
      hour_start: "2026-08-15T00:00:00.000Z",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      total_tokens: 2_000_000,
      cost_usd: 999,
    })}\n`, "utf8");
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: trackerDir,
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    });

    const response = await call(
      handler,
      "/functions/tokentracker-api-billing-accounts?month=2026-08&time_zone=UTC",
    );
    const openai = readJsonResponse(response).accounts.find((account) => account.provider === "openai");

    assert.equal(response.statusCode, 200);
    assert.ok(openai);
    assert.equal(openai.monthCostUsd, null);
    assert.equal(openai.lifetimeCostUsd, null);
    assert.equal(openai.source_kind, "third_party");
    assert.equal(openai.pricing_coverage, "unpriced");
    assert.equal(openai.is_stale, true);
    assert.equal(openai.note_code, "pricing_source_stale");
    assert.equal(openai.matched_model, "gpt-4o");
    assert.equal(openai.observed_at, "2026-08-20T00:00:00.000Z");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("API billing preserves the saved modification time of agent-default user pricing", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-agent-default-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(queuePath, `${JSON.stringify({
      source: "claude",
      model: "review-fixture-agent-default",
      hour_start: "2026-08-15T00:00:00.000Z",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      total_tokens: 2_000_000,
      cost_usd: 999,
    })}\n`, "utf8");
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: trackerDir,
      now: () => new Date("2026-08-20T12:34:56.000Z"),
    });
    const token = readJsonResponse(await call(handler, "/api/local-auth")).token;
    const settingsResponse = await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tokentracker-local-auth": token,
        origin: "http://127.0.0.1:7680",
      },
      body: JSON.stringify({
        agentDefaultPricing: {
          claude: { inputUsdPer1M: 3, outputUsdPer1M: 15 },
        },
      }),
    });
    assert.equal(
      readJsonResponse(settingsResponse).pricing_updated_at,
      "2026-08-20T12:34:56.000Z",
    );

    const response = await call(
      handler,
      "/functions/tokentracker-api-billing-accounts?month=2026-08&time_zone=UTC",
    );
    const claude = readJsonResponse(response).accounts.find((account) => account.provider === "claude");

    assert.equal(response.statusCode, 200);
    assert.ok(claude);
    assert.equal(claude.monthCostUsd, 18);
    assert.equal(claude.pricing_source, "agent-default");
    assert.equal(claude.source_kind, "user_override");
    assert.equal(claude.pricing_version, "2026-08-20T12:34:56.000Z");
    assert.equal(claude.source_updated_at, "2026-08-20T12:34:56.000Z");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("agent-default pricing timestamps change only for materially edited agents", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-agent-default-per-agent-time-"));
  let nowIso = "2026-08-01T00:00:00.000Z";
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(queuePath, `${[
      {
        source: "codex",
        model: "codex-default-review-model",
        hour_start: "2026-08-20T00:00:00.000Z",
        input_tokens: 1_000_000,
        output_tokens: 0,
        total_tokens: 1_000_000,
      },
      {
        source: "claude",
        model: "claude-default-review-model",
        hour_start: "2026-08-20T00:00:00.000Z",
        input_tokens: 1_000_000,
        output_tokens: 0,
        total_tokens: 1_000_000,
      },
    ].map(JSON.stringify).join("\n")}\n`, "utf8");
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: trackerDir,
      now: () => new Date(nowIso),
    });
    const token = readJsonResponse(await call(handler, "/api/local-auth")).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };
    const defaults = {
      claude: { inputUsdPer1M: 3, outputUsdPer1M: 15 },
      codex: { inputUsdPer1M: 2, outputUsdPer1M: 8 },
      hermes: { inputUsdPer1M: 1, outputUsdPer1M: 4 },
    };

    const first = readJsonResponse(await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({ agentDefaultPricing: defaults, pricingRules: [] }),
    }));
    assert.equal(first.pricing_updated_at, "2026-08-01T00:00:00.000Z");
    assert.deepEqual(first.agent_default_pricing_updated_at, {
      claude: "2026-08-01T00:00:00.000Z",
      codex: "2026-08-01T00:00:00.000Z",
      hermes: "2026-08-01T00:00:00.000Z",
    });

    nowIso = "2026-08-10T00:00:00.000Z";
    const rulesOnly = readJsonResponse(await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentDefaultPricing: defaults,
        pricingRules: [{
          source: "hermes",
          model: "rules-only-review-model",
          inputPricePer1M: 9,
          outputPricePer1M: 9,
          currency: "USD",
          updated_at: nowIso,
        }],
      }),
    }));
    assert.equal(rulesOnly.pricing_updated_at, "2026-08-01T00:00:00.000Z");
    assert.equal(rulesOnly.agent_default_pricing_updated_at.codex, "2026-08-01T00:00:00.000Z");
    assert.equal(rulesOnly.agent_default_pricing_updated_at.hermes, "2026-08-01T00:00:00.000Z");

    nowIso = "2026-08-15T00:00:00.000Z";
    const claudeChanged = readJsonResponse(await call(handler, "/functions/tokentracker-local-settings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentDefaultPricing: {
          ...defaults,
          claude: { inputUsdPer1M: 4, outputUsdPer1M: 15 },
        },
        pricingRules: rulesOnly.pricingRules,
      }),
    }));
    assert.equal(claudeChanged.pricing_updated_at, "2026-08-15T00:00:00.000Z");
    assert.deepEqual(claudeChanged.agent_default_pricing_updated_at, {
      claude: "2026-08-15T00:00:00.000Z",
      codex: "2026-08-01T00:00:00.000Z",
      hermes: "2026-08-01T00:00:00.000Z",
    });

    const billing = readJsonResponse(await call(
      handler,
      "/functions/tokentracker-api-billing-accounts?month=2026-08&time_zone=UTC",
    ));
    const openai = billing.accounts.find((account) => account.provider === "openai");
    const claude = billing.accounts.find((account) => account.provider === "claude");
    assert.equal(openai.source_updated_at, "2026-08-01T00:00:00.000Z");
    assert.equal(openai.pricing_version, "2026-08-01T00:00:00.000Z");
    assert.equal(claude.source_updated_at, "2026-08-15T00:00:00.000Z");
    assert.equal(claude.pricing_version, "2026-08-15T00:00:00.000Z");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("api billing accounts with only credentials detected shows not-connected status with null cost (no actual usage)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-"));
  try {
    const codexHome = path.join(tmp, ".codex");
    await fs.mkdir(codexHome, { recursive: true });
    await fs.writeFile(
      path.join(codexHome, "auth.json"),
      JSON.stringify({ tokens: { account_id: "test-account-12345" } }),
      "utf8"
    );

    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const originalHomedir = os.homedir;
    os.homedir = () => tmp;

    try {
      const res = await call(handler, "/functions/tokentracker-api-billing-accounts");
      const body = readJsonResponse(res);
      assert.equal(res.statusCode, 200);

      const openaiAccount = body.accounts.find((a) => a.provider === "openai");
      if (openaiAccount) {
        // Credentials detected but no actual API usage data - costs should be null
        assert.equal(openaiAccount.status, "not-connected");
        assert.equal(openaiAccount.monthCostUsd, null);
        assert.equal(openaiAccount.lifetimeCostUsd, null);
        assert.equal(openaiAccount.spendAuthority, "unavailable");
      }
    } finally {
      os.homedir = originalHomedir;
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
