const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");
const { deriveOfficialInvoiceSpend, SPEND_AUTHORITIES } = require("../src/lib/api-billing");

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

test("official provider month spend reaches the API billing cash contract", async () => {
  const { server, url } = await startMockServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      data: { balance: 92, month_spend: 8, lifetime_spend: 48, currency: "USD" },
    }));
  });
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-api-billing-official-"));
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
        requestUrl: `${url}/costs`,
        requestMethod: "GET",
        authType: "bearer",
        balancePath: "data.balance",
        monthSpendPath: "data.month_spend",
        lifetimeSpendPath: "data.lifetime_spend",
        currencyPath: "data.currency",
        refreshIntervalSeconds: 300,
        enabled: true,
      }),
    })).config;
    await call(handler, "/functions/tokentracker-provider-api-secrets", {
      method: "POST",
      headers,
      body: JSON.stringify({ configId: created.id, secret: "sk-official-test" }),
    });
    const refresh = readJsonResponse(await call(
      handler,
      `/functions/tokentracker-provider-api-refresh?id=${created.id}`,
      { method: "POST", headers },
    ));
    assert.equal(refresh.balance.status, "synced");

    const body = readJsonResponse(await call(handler, "/functions/tokentracker-api-billing-accounts"));
    const account = body.accounts.find((item) => item.provider === "openai");
    assert.ok(account);
    assert.equal(account.billingSource, "api");
    assert.equal(account.spendAuthority, "official_invoice");
    assert.equal(account.monthCostUsd, 8);
    assert.equal(account.lifetimeCostUsd, 48);
  } finally {
    server.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("official invoice evidence rejects unverified hosts, console, stale, non-USD, and invalid month spend", () => {
  const validConfig = {
    providerId: "openai",
    requestUrl: "https://api.openai.com/v1/organization/costs",
    authType: "bearer",
    monthSpendPath: "data.month_spend",
  };
  const validBalance = { status: "synced", monthSpend: 8, lifetimeSpend: 48, currency: "USD" };
  assert.deepEqual(deriveOfficialInvoiceSpend(validConfig, validBalance), {
    monthCostUsd: 8,
    lifetimeCostUsd: 48,
    lastSyncedAt: null,
  });
  assert.equal(deriveOfficialInvoiceSpend({ ...validConfig, authType: "official_console" }, validBalance), null);
  assert.equal(deriveOfficialInvoiceSpend(validConfig, { ...validBalance, status: "stale" }), null);
  assert.equal(deriveOfficialInvoiceSpend(validConfig, { ...validBalance, currency: "CNY" }), null);
  assert.equal(deriveOfficialInvoiceSpend(validConfig, { ...validBalance, monthSpend: -1 }), null);
  assert.equal(deriveOfficialInvoiceSpend({ ...validConfig, requestUrl: "https://api.openai.com/v1/dashboard/billing/credit_grants" }, validBalance), null);
  assert.equal(deriveOfficialInvoiceSpend({ ...validConfig, requestUrl: "https://billing.example.com/costs" }, validBalance), null);
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

    await fs.writeFile(queueJsonl,
      JSON.stringify({
        hour_start: lastMonthKey,
        source: "claude",
        total_tokens: 1000,
        input_tokens: 500,
        output_tokens: 500,
        cost_usd: 0.1,
      }) + "\n" +
      JSON.stringify({
        hour_start: currentMonthKey,
        source: "claude",
        total_tokens: 2000,
        input_tokens: 1000,
        output_tokens: 1000,
        cost_usd: 0.2,
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
