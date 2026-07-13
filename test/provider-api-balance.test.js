"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");
const {
  parseBalanceResponse,
  determineStatus,
  createBalanceRefreshManager,
  ERROR_CODES,
} = require("../src/lib/provider-api-balance");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function getAuthHeaders(handler) {
  const auth = await call(handler, "/api/local-auth");
  const token = readJsonResponse(auth).token;
  return {
    "content-type": "application/json",
    "x-tokentracker-local-auth": token,
    origin: "http://127.0.0.1:7680",
  };
}

function maskSecret(secret) {
  const s = String(secret || "");
  if (s.length <= 4) return "••••";
  return "••••" + s.slice(-4);
}

function createTestCredentialStore() {
  const store = new Map();
  return {
    isAvailable: () => true,
    saveSecret(ref, secret) {
      store.set(ref, String(secret));
      return { ok: true, masked: maskSecret(secret) };
    },
    readSecret(ref) {
      return store.has(ref) ? store.get(ref) : null;
    },
    deleteSecret(ref) {
      return store.delete(ref);
    },
    listRefs() {
      return Array.from(store.keys());
    },
  };
}

function createTestFileCredentialStore(vaultPath) {
  const fsSync = require("node:fs");
  function load() {
    try {
      const raw = fsSync.readFileSync(vaultPath, "utf8");
      return new Map(Object.entries(JSON.parse(raw)));
    } catch {
      return new Map();
    }
  }
  function save(map) {
    fsSync.writeFileSync(vaultPath, JSON.stringify(Object.fromEntries(map), null, 2), {
      mode: 0o600,
    });
  }
  return {
    isAvailable: () => true,
    saveSecret(ref, secret) {
      const map = load();
      map.set(ref, String(secret));
      save(map);
      return { ok: true, masked: maskSecret(secret) };
    },
    readSecret(ref) {
      const map = load();
      return map.has(ref) ? map.get(ref) : null;
    },
    deleteSecret(ref) {
      const map = load();
      const deleted = map.delete(ref);
      save(map);
      return deleted;
    },
    listRefs() {
      return Array.from(load().keys());
    },
  };
}

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function validConfig(overrides = {}) {
  return {
    providerId: "openai",
    label: "OpenAI Test",
    requestUrl: "https://api.openai.com/v1/organization/costs",
    requestMethod: "GET",
    authType: "bearer",
    apiKeyRef: "",
    balancePath: "data.balance",
    monthSpendPath: "data.month_spend",
    lifetimeSpendPath: "data.lifetime_spend",
    currencyPath: "data.currency",
    refreshIntervalSeconds: 300,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit tests: parseBalanceResponse
// ---------------------------------------------------------------------------

// Test 5: 成功解析余额、月花销、累计花销和币种
test("parseBalanceResponse extracts balance, monthSpend, lifetimeSpend, currency", () => {
  const data = {
    data: {
      balance: 1234.56,
      month_spend: 100.0,
      lifetime_spend: 5000.0,
      currency: "USD",
    },
  };
  const config = validConfig();
  const result = parseBalanceResponse(data, config);
  assert.equal(result.balance, 1234.56);
  assert.equal(result.monthSpend, 100.0);
  assert.equal(result.lifetimeSpend, 5000.0);
  assert.equal(result.currency, "USD");
});

test("parseBalanceResponse handles null optional fields", () => {
  const data = { data: { balance: 100 } };
  const config = validConfig({
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "",
  });
  const result = parseBalanceResponse(data, config);
  assert.equal(result.balance, 100);
  assert.equal(result.monthSpend, null);
  assert.equal(result.lifetimeSpend, null);
  assert.equal(result.currency, null);
});

test("parseBalanceResponse uses the verified Kimi CNY currency when the API omits it", async () => {
  const fixturePath = path.join(__dirname, "fixtures", "kimi-balance-response.json");
  const data = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  const result = parseBalanceResponse(
    data,
    validConfig({
      providerId: "moonshot",
      balancePath: "data.available_balance",
      monthSpendPath: "",
      lifetimeSpendPath: "",
      currencyPath: "",
      currencyValue: "CNY",
    })
  );

  assert.equal(result.balance, 88.5);
  assert.equal(result.currency, "CNY");
});

test("parseBalanceResponse reads Alibaba Cloud account balance fields", async () => {
  const fixturePath = path.join(__dirname, "fixtures", "aliyun-account-balance-response.json");
  const data = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  const result = parseBalanceResponse(
    data,
    validConfig({
      providerId: "aliyun_bss",
      balancePath: "Data.AvailableAmount",
      monthSpendPath: "",
      lifetimeSpendPath: "",
      currencyPath: "Data.Currency",
    })
  );

  assert.equal(result.balance, 123.45);
  assert.equal(result.currency, "CNY");
});

test("parseBalanceResponse reads Volcengine account balance and fixed currency", async () => {
  const fixturePath = path.join(__dirname, "fixtures", "volcengine-account-balance-response.json");
  const data = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  const result = parseBalanceResponse(
    data,
    validConfig({
      providerId: "volcengine_billing",
      balancePath: "Result.AvailableBalance",
      monthSpendPath: "",
      lifetimeSpendPath: "",
      currencyPath: "",
      currencyValue: "CNY",
    })
  );

  assert.equal(result.balance, 67.89);
  assert.equal(result.currency, "CNY");
});

test("parseBalanceResponse rejects NaN and Infinity", () => {
  const data = { data: { balance: NaN, month_spend: Infinity } };
  const config = validConfig();
  const result = parseBalanceResponse(data, config);
  assert.equal(result.error_code, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
});

test("parseBalanceResponse rejects negative balance as invalid", () => {
  const data = { data: { balance: -50 } };
  const config = validConfig();
  const result = parseBalanceResponse(data, config);
  // Negative balance is suspicious — should be flagged
  assert.equal(result.error_code, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
});

test("parseBalanceResponse rejects non-numeric balance", () => {
  const data = { data: { balance: "not-a-number" } };
  const config = validConfig();
  const result = parseBalanceResponse(data, config);
  assert.equal(result.error_code, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
});

test("parseBalanceResponse handles array index paths", () => {
  const data = { data: [{ balance: 200 }] };
  const config = validConfig({ balancePath: "data[0].balance" });
  const result = parseBalanceResponse(data, config);
  assert.equal(result.balance, 200);
});

test("parseBalanceResponse sums wildcard array balances for DeepSeek balance_infos", () => {
  const data = {
    balance_infos: [
      { currency: "USD", total_balance: "0" },
      { currency: "USD", total_balance: "12.34" },
      { currency: "USD", total_balance: "1.66" },
    ],
  };
  const config = validConfig({
    providerId: "deepseek",
    balancePath: "balance_infos[*].total_balance",
    currencyPath: "balance_infos[*].currency",
  });
  const result = parseBalanceResponse(data, config);
  assert.equal(result.balance, 14);
  assert.equal(result.currency, "USD");
});

test("parseBalanceResponse repairs old DeepSeek first-element path when later balances are non-zero", () => {
  const data = {
    balance_infos: [
      { currency: "USD", total_balance: "0" },
      { currency: "USD", total_balance: "20.5" },
    ],
  };
  const config = validConfig({
    providerId: "deepseek",
    balancePath: "balance_infos[0].total_balance",
    currencyPath: "balance_infos[0].currency",
  });
  const result = parseBalanceResponse(data, config);
  assert.equal(result.balance, 20.5);
  assert.equal(result.currency, "USD");
});

test("parseBalanceResponse pairs DeepSeek balance with the selected non-zero currency", () => {
  const data = {
    balance_infos: [
      { currency: "CNY", total_balance: "0" },
      { currency: "USD", total_balance: "100.92" },
    ],
  };
  const config = validConfig({
    providerId: "deepseek",
    balancePath: "balance_infos[*].total_balance",
    currencyPath: "balance_infos[*].currency",
  });
  const result = parseBalanceResponse(data, config);
  assert.equal(result.balance, 100.92);
  assert.equal(result.currency, "USD");
});

test("parseBalanceResponse prefers funded USD over a higher CNY balance", () => {
  const data = {
    is_available: true,
    balance_infos: [
      { currency: "USD", total_balance: "50.00", granted_balance: "0", topped_up_balance: "50.00" },
      { currency: "CNY", total_balance: "291.00", granted_balance: "0", topped_up_balance: "291.00" },
    ],
  };
  const config = validConfig({
    providerId: "deepseek",
    balancePath: "balance_infos[*].total_balance",
    currencyPath: "balance_infos[*].currency",
  });
  const result = parseBalanceResponse(data, config);
  assert.equal(result.balance, 50);
  assert.equal(result.currency, "USD");
});

test("parseBalanceResponse falls back to granted_balance + topped_up_balance when total_balance is missing", () => {
  const data = {
    is_available: true,
    balance_infos: [
      {
        currency: "USD",
        granted_balance: "12.50",
        topped_up_balance: "37.50",
      },
    ],
  };
  const config = validConfig({
    providerId: "deepseek",
    balancePath: "balance_infos[0].total_balance",
    currencyPath: "balance_infos[0].currency",
  });
  const result = parseBalanceResponse(data, config);
  assert.equal(result.balance, 50);
  assert.equal(result.currency, "USD");
});

test("parseBalanceResponse detects DeepSeek balance_infos by request host when providerId is blank", () => {
  const data = {
    balance_infos: [
      { currency: "USD", total_balance: "0" },
      { currency: "USD", total_balance: "8.25" },
    ],
  };
  const config = validConfig({
    providerId: "",
    requestUrl: "https://api.deepseek.com/user/balance",
    balancePath: "balance_infos[0].total_balance",
    currencyPath: "balance_infos[0].currency",
  });
  const result = parseBalanceResponse(data, config);
  assert.equal(result.balance, 8.25);
  assert.equal(result.currency, "USD");
});

test("parseBalanceResponse parses recorded DeepSeek fixture", async () => {
  const fixturePath = path.join(__dirname, "fixtures", "deepseek-balance-response.json");
  const data = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  const config = validConfig({
    providerId: "deepseek",
    requestUrl: "https://api.deepseek.com/user/balance",
    balancePath: "balance_infos[*].total_balance",
    currencyPath: "balance_infos[*].currency",
  });
  const result = parseBalanceResponse(data, config);
  assert.equal(result.balance, 100.92);
  assert.equal(result.currency, "USD");
  assert.equal(result.error_code, undefined);
});

test("parseBalanceResponse treats DeepSeek all-zero balance as a real synced zero", () => {
  const data = {
    is_available: false,
    balance_infos: [
      {
        currency: "USD",
        total_balance: "0",
        granted_balance: "0",
        topped_up_balance: "0",
      },
    ],
  };
  const config = validConfig({
    providerId: "deepseek",
    balancePath: "balance_infos[*].total_balance",
    currencyPath: "balance_infos[*].currency",
  });
  const result = parseBalanceResponse(data, config);
  assert.equal(result.balance, 0);
  assert.equal(result.currency, "USD");
});

test("parseBalanceResponse never maps GLM Coding Plan quota to cash balance", () => {
  const data = {
    code: 200,
    data: {
      level: "pro",
      limits: [
        {
          type: "TOKENS_LIMIT",
          unit: 3,
          usage: 4_000_000,
          currentValue: 1_000_000,
          percentage: 25,
        },
        {
          type: "TOKENS_LIMIT",
          unit: 6,
          usage: 20_000_000,
          currentValue: 5_000_000,
          percentage: 25,
        },
      ],
    },
  };
  const config = {
    providerId: "glm",
    requestUrl: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    balancePath: "data.limits[*].usage",
  };
  const result = parseBalanceResponse(data, config);
  assert.equal(result.balance, null);
  assert.equal(result.currency, null);
  assert.equal(result.error_code, ERROR_CODES.UNSUPPORTED_ENDPOINT);
});

test("refreshBalance short-circuits unsupported GLM before reading its API key", async () => {
  let readSecretCalls = 0;
  const manager = createBalanceRefreshManager({
    credentialStore: {
      isAvailable: () => true,
      readSecret() {
        readSecretCalls += 1;
        return "must-not-be-read";
      },
    },
  });

  const balance = await manager.refreshBalance({
    id: "glm-legacy",
    providerId: "glm",
    label: "智谱 GLM",
    requestUrl: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    apiKeyRef: "provider-api/glm/legacy",
    balancePath: "data.limits[*].usage",
  });

  assert.equal(balance.status, "unsupported");
  assert.equal(balance.errorCode, ERROR_CODES.UNSUPPORTED_ENDPOINT);
  assert.equal(balance.balance, null);
  assert.equal(readSecretCalls, 0);
});

test("refreshBalance blocks official GLM quota endpoint before secret read even for unknown provider IDs", async () => {
  let readSecretCalls = 0;
  const manager = createBalanceRefreshManager({
    credentialStore: {
      isAvailable: () => true,
      readSecret() {
        readSecretCalls += 1;
        return "must-not-be-read";
      },
    },
  });

  const balance = await manager.refreshBalance({
    id: "glm-coding-plan-legacy",
    providerId: "glm-coding-plan",
    label: "自定义旧套餐",
    requestUrl: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    apiKeyRef: "provider-api/glm/unknown-id",
    balancePath: "data.limits[*].usage",
  });

  assert.equal(balance.status, "unsupported");
  assert.equal(balance.errorCode, ERROR_CODES.UNSUPPORTED_ENDPOINT);
  assert.equal(readSecretCalls, 0);
});

// ---------------------------------------------------------------------------
// Unit tests: determineStatus
// ---------------------------------------------------------------------------

test("determineStatus maps 401 to provider_unauthorized", () => {
  assert.equal(determineStatus(401), "error");
  const result = determineStatus(401, { returnCode: true });
  assert.equal(result.code, ERROR_CODES.PROVIDER_UNAUTHORIZED);
});

test("determineStatus maps 403 to provider_unauthorized", () => {
  const result = determineStatus(403, { returnCode: true });
  assert.equal(result.code, ERROR_CODES.PROVIDER_UNAUTHORIZED);
});

test("determineStatus maps 429 to provider_rate_limited", () => {
  const result = determineStatus(429, { returnCode: true });
  assert.equal(result.code, ERROR_CODES.PROVIDER_RATE_LIMITED);
});

test("determineStatus maps 5xx to provider_unavailable", () => {
  const result = determineStatus(503, { returnCode: true });
  assert.equal(result.code, ERROR_CODES.PROVIDER_UNAVAILABLE);
});

test("determineStatus maps timeout to request_timeout", () => {
  const result = determineStatus("timeout", { returnCode: true });
  assert.equal(result.code, ERROR_CODES.REQUEST_TIMEOUT);
});

// ---------------------------------------------------------------------------
// Integration tests: balance refresh via local-api.js
// ---------------------------------------------------------------------------

// Test 4: Bearer 和自定义 Header 鉴权正确
test("refreshBalance sends Bearer auth for authType=bearer", async () => {
  let receivedAuth = null;
  const { server, url } = await startMockServer((req, res) => {
    receivedAuth = req.headers["authorization"] || "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: { balance: 100, currency: "USD" } }));
  });

  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      const credStore = createTestCredentialStore();
      const handler = createLocalApiHandler({
        queuePath: path.join(trackerDir, "queue.jsonl"),
        trackerDataDir: trackerDir,
        credentialStore: credStore,
        // Test mode: allow HTTP for mock server
        providerApiTestMode: true,
      });

      const headers = await getAuthHeaders(handler);

      // Create config pointing to mock server
      const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({
          requestUrl: `${url}/balance`,
          authType: "bearer",
        })),
      });
      const configId = readJsonResponse(created).config.id;

      // Save secret
      const testSecret = "sk-bearer-test-key-12345";
      await call(handler, "/functions/tokentracker-provider-api-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({ configId, secret: testSecret }),
      });

      // Refresh
      const refreshRes = await call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, {
        method: "POST",
        headers,
      });
      const refreshBody = readJsonResponse(refreshRes);
      assert.equal(refreshRes.statusCode, 200, JSON.stringify(refreshBody));
      assert.equal(refreshBody.balance.status, "synced");
      assert.equal(refreshBody.balance.balance, 100);

      // Verify Bearer auth was sent
      assert.equal(receivedAuth, `Bearer ${testSecret}`);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

test("refreshBalance sends custom header for authType=header", async () => {
  let receivedHeader = null;
  const { server, url } = await startMockServer((req, res) => {
    receivedHeader = req.headers["x-api-key"] || "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: { balance: 200, currency: "USD" } }));
  });

  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      const handler = createLocalApiHandler({
        queuePath: path.join(trackerDir, "queue.jsonl"),
        trackerDataDir: trackerDir,
        credentialStore: createTestCredentialStore(),
        providerApiTestMode: true,
      });

      const headers = await getAuthHeaders(handler);

      const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({
          requestUrl: `${url}/balance`,
          authType: "header",
          authHeaderName: "X-API-Key",
        })),
      });
      const configId = readJsonResponse(created).config.id;

      const testSecret = "header-key-test-67890";
      await call(handler, "/functions/tokentracker-provider-api-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({ configId, secret: testSecret }),
      });

      const refreshRes = await call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, {
        method: "POST",
        headers,
      });
      const refreshBody = readJsonResponse(refreshRes);
      assert.equal(refreshRes.statusCode, 200, JSON.stringify(refreshBody));
      assert.equal(refreshBody.balance.status, "synced");
      assert.equal(refreshBody.balance.balance, 200);

      // Verify custom header was sent with the key value
      assert.equal(receivedHeader, testSecret);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

// Test 6: 401, 403, 429, timeout, HTML, oversized, bad JSON, missing fields
test("refreshBalance maps 401 to provider_unauthorized and status=error", async () => {
  const { server, url } = await startMockServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
  });
  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      const handler = createLocalApiHandler({
        queuePath: path.join(trackerDir, "queue.jsonl"),
        trackerDataDir: trackerDir,
        credentialStore: createTestCredentialStore(),
        providerApiTestMode: true,
      });
      const headers = await getAuthHeaders(handler);

      const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({ requestUrl: `${url}/balance` })),
      });
      const configId = readJsonResponse(created).config.id;

      await call(handler, "/functions/tokentracker-provider-api-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({ configId, secret: "sk-test" }),
      });

      const refreshRes = await call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, {
        method: "POST",
        headers,
      });
      const refreshBody = readJsonResponse(refreshRes);
      assert.equal(refreshRes.statusCode, 200); // HTTP 200 with error status in body
      assert.equal(refreshBody.balance.status, "error");
      assert.equal(refreshBody.balance.errorCode, "provider_unauthorized");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

test("refreshBalance maps 429 to provider_rate_limited", async () => {
  const { server, url } = await startMockServer((req, res) => {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "rate limited" }));
  });
  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      const handler = createLocalApiHandler({
        queuePath: path.join(trackerDir, "queue.jsonl"),
        trackerDataDir: trackerDir,
        credentialStore: createTestCredentialStore(),
        providerApiTestMode: true,
      });
      const headers = await getAuthHeaders(handler);

      const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({ requestUrl: `${url}/balance` })),
      });
      const configId = readJsonResponse(created).config.id;

      await call(handler, "/functions/tokentracker-provider-api-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({ configId, secret: "sk-test" }),
      });

      const refreshRes = await call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, {
        method: "POST",
        headers,
      });
      const refreshBody = readJsonResponse(refreshRes);
      assert.equal(refreshBody.balance.status, "error");
      assert.equal(refreshBody.balance.errorCode, "provider_rate_limited");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

test("refreshBalance maps HTML login page to provider_response_invalid", async () => {
  const { server, url } = await startMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body><h1>Please log in</h1></body></html>");
  });
  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      const handler = createLocalApiHandler({
        queuePath: path.join(trackerDir, "queue.jsonl"),
        trackerDataDir: trackerDir,
        credentialStore: createTestCredentialStore(),
        providerApiTestMode: true,
      });
      const headers = await getAuthHeaders(handler);

      const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({ requestUrl: `${url}/balance` })),
      });
      const configId = readJsonResponse(created).config.id;

      await call(handler, "/functions/tokentracker-provider-api-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({ configId, secret: "sk-test" }),
      });

      const refreshRes = await call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, {
        method: "POST",
        headers,
      });
      const refreshBody = readJsonResponse(refreshRes);
      assert.equal(refreshBody.balance.status, "error");
      assert.equal(refreshBody.balance.errorCode, "provider_response_invalid");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

test("refreshBalance maps oversized response to provider_response_invalid", async () => {
  const { server, url } = await startMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    // Write a response larger than the limit (10 MB)
    const huge = JSON.stringify({ data: { balance: 1 }, padding: "x".repeat(11 * 1024 * 1024) });
    res.end(huge);
  });
  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      const handler = createLocalApiHandler({
        queuePath: path.join(trackerDir, "queue.jsonl"),
        trackerDataDir: trackerDir,
        credentialStore: createTestCredentialStore(),
        providerApiTestMode: true,
      });
      const headers = await getAuthHeaders(handler);

      const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({ requestUrl: `${url}/balance` })),
      });
      const configId = readJsonResponse(created).config.id;

      await call(handler, "/functions/tokentracker-provider-api-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({ configId, secret: "sk-test" }),
      });

      const refreshRes = await call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, {
        method: "POST",
        headers,
      });
      const refreshBody = readJsonResponse(refreshRes);
      assert.equal(refreshBody.balance.status, "error");
      assert.equal(refreshBody.balance.errorCode, "provider_response_invalid");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

test("refreshBalance maps bad JSON to provider_response_invalid", async () => {
  const { server, url } = await startMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{not valid json");
  });
  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      const handler = createLocalApiHandler({
        queuePath: path.join(trackerDir, "queue.jsonl"),
        trackerDataDir: trackerDir,
        credentialStore: createTestCredentialStore(),
        providerApiTestMode: true,
      });
      const headers = await getAuthHeaders(handler);

      const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({ requestUrl: `${url}/balance` })),
      });
      const configId = readJsonResponse(created).config.id;

      await call(handler, "/functions/tokentracker-provider-api-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({ configId, secret: "sk-test" }),
      });

      const refreshRes = await call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, {
        method: "POST",
        headers,
      });
      const refreshBody = readJsonResponse(refreshRes);
      assert.equal(refreshBody.balance.status, "error");
      assert.equal(refreshBody.balance.errorCode, "provider_response_invalid");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

test("refreshBalance maps missing balance field to provider_response_invalid", async () => {
  const { server, url } = await startMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    // No balance field
    res.end(JSON.stringify({ data: { other: "value" } }));
  });
  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      const handler = createLocalApiHandler({
        queuePath: path.join(trackerDir, "queue.jsonl"),
        trackerDataDir: trackerDir,
        credentialStore: createTestCredentialStore(),
        providerApiTestMode: true,
      });
      const headers = await getAuthHeaders(handler);

      const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({ requestUrl: `${url}/balance` })),
      });
      const configId = readJsonResponse(created).config.id;

      await call(handler, "/functions/tokentracker-provider-api-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({ configId, secret: "sk-test" }),
      });

      const refreshRes = await call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, {
        method: "POST",
        headers,
      });
      const refreshBody = readJsonResponse(refreshRes);
      assert.equal(refreshBody.balance.status, "error");
      assert.equal(refreshBody.balance.errorCode, "provider_response_invalid");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

// Test 10: 同一配置并发刷新只触发一次上游请求
test("concurrent refresh of same config triggers only one upstream request", async () => {
  let requestCount = 0;
  const { server, url } = await startMockServer((req, res) => {
    requestCount++;
    // Delay response to ensure concurrent calls arrive during the first request
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { balance: 300, currency: "USD" } }));
    }, 200);
  });
  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      const handler = createLocalApiHandler({
        queuePath: path.join(trackerDir, "queue.jsonl"),
        trackerDataDir: trackerDir,
        credentialStore: createTestCredentialStore(),
        providerApiTestMode: true,
      });
      const headers = await getAuthHeaders(handler);

      const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({ requestUrl: `${url}/balance` })),
      });
      const configId = readJsonResponse(created).config.id;

      await call(handler, "/functions/tokentracker-provider-api-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({ configId, secret: "sk-test" }),
      });

      // Fire 5 concurrent refreshes
      const results = await Promise.all([
        call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, { method: "POST", headers }),
        call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, { method: "POST", headers }),
        call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, { method: "POST", headers }),
        call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, { method: "POST", headers }),
        call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, { method: "POST", headers }),
      ]);

      // All should succeed
      for (const res of results) {
        const body = readJsonResponse(res);
        assert.equal(body.balance.status, "synced", JSON.stringify(body));
        assert.equal(body.balance.balance, 300);
      }

      // Only ONE upstream request should have been made
      assert.equal(requestCount, 1, `expected 1 upstream request, got ${requestCount}`);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

// Test 2: API Key 重启后仍可通过安全引用读取；普通配置文件中不存在明文
test("API Key survives handler restart via credential store reference; no plaintext in config.json", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const vaultPath = path.join(trackerDir, "test-vault.json");

    // First handler instance — save config + secret
    const handler1 = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestFileCredentialStore(vaultPath),
      providerApiTestMode: true,
    });
    const headers1 = await getAuthHeaders(handler1);

    const created = await call(handler1, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers: headers1,
      body: JSON.stringify(validConfig()),
    });
    const configId = readJsonResponse(created).config.id;

    const testSecret = "sk-restart-persistence-test-key-99999";
    const secretRes = await call(handler1, "/functions/tokentracker-provider-api-secrets", {
      method: "POST",
      headers: headers1,
      body: JSON.stringify({ configId, secret: testSecret }),
    });
    const apiKeyRef = readJsonResponse(secretRes).apiKeyRef;
    assert.ok(apiKeyRef);

    // Verify config.json has NO plaintext secret
    const configContent = await fs.readFile(path.join(trackerDir, "config.json"), "utf8");
    assert.ok(!configContent.includes(testSecret), "no plaintext secret in config.json");
    assert.ok(configContent.includes(apiKeyRef), "apiKeyRef should be in config.json");

    // Create a NEW handler instance (simulates restart) with same vault
    const handler2 = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestFileCredentialStore(vaultPath),
      providerApiTestMode: true,
    });

    // The new handler should be able to resolve the secret via apiKeyRef
    // Test by doing a refresh against a mock server
    let receivedAuth = null;
    const { server, url } = await startMockServer((req, res) => {
      receivedAuth = req.headers["authorization"] || "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { balance: 999, currency: "USD" } }));
    });
    try {
      const headers2 = await getAuthHeaders(handler2);

      // Update config to point to mock server
      await call(handler2, `/functions/tokentracker-provider-api-configs?id=${configId}`, {
        method: "PUT",
        headers: headers2,
        body: JSON.stringify(validConfig({ requestUrl: `${url}/balance` })),
      });

      // Refresh — should read secret from vault via apiKeyRef
      const refreshRes = await call(handler2, `/functions/tokentracker-provider-api-refresh?id=${configId}`, {
        method: "POST",
        headers: headers2,
      });
      const refreshBody = readJsonResponse(refreshRes);
      assert.equal(refreshRes.statusCode, 200, JSON.stringify(refreshBody));
      assert.equal(refreshBody.balance.status, "synced");
      assert.equal(refreshBody.balance.balance, 999);

      // Verify the original secret was used (not empty, not a different value)
      assert.equal(receivedAuth, `Bearer ${testSecret}`, "secret should survive restart via credential store");
    } finally {
      server.close();
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("refreshBalance returns not-connected status when no secret is configured", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
      providerApiTestMode: true,
    });
    const headers = await getAuthHeaders(handler);

    // Create config but DON'T save a secret
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig()),
    });
    const configId = readJsonResponse(created).config.id;

    const refreshRes = await call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, {
      method: "POST",
      headers,
    });
    const refreshBody = readJsonResponse(refreshRes);
    assert.equal(refreshRes.statusCode, 200);
    assert.equal(refreshBody.balance.status, "not-connected");
    assert.equal(refreshBody.balance.errorCode, "credential_missing");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("GET /functions/tokentracker-provider-api-balances returns all configured balances", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
      providerApiTestMode: true,
    });
    const headers = await getAuthHeaders(handler);

    // Create a config without secret
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig()),
    });
    const configId = readJsonResponse(created).config.id;

    // GET balances
    const balancesRes = await call(handler, "/functions/tokentracker-provider-api-balances");
    const balancesBody = readJsonResponse(balancesRes);
    assert.equal(balancesRes.statusCode, 200);
    assert.ok(Array.isArray(balancesBody.balances));
    assert.equal(balancesBody.balances.length, 1);
    assert.equal(balancesBody.balances[0].configId, configId);
    // No secret → not-connected
    assert.equal(balancesBody.balances[0].status, "not-connected");
    // No secret in response
    const balancesStr = JSON.stringify(balancesBody);
    assert.ok(!balancesStr.includes("sk-"), "no secret in balances response");
    assert.ok(!balancesStr.includes("Bearer "), "no Bearer in balances response");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("legacy GLM quota config with unknown provider ID stays unsupported across list and refresh APIs", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-glm-legacy-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(path.join(trackerDir, "config.json"), JSON.stringify({
      providerApiConfigs: [{
        id: "glm-legacy",
        providerId: "glm-coding-plan",
        label: "智谱 GLM",
        requestUrl: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
        requestMethod: "GET",
        authType: "header",
        authHeaderName: "Authorization",
        apiKeyRef: "provider-api/glm/legacy",
        balancePath: "data.limits[*].usage",
        monthSpendPath: "",
        lifetimeSpendPath: "",
        currencyPath: "",
        refreshIntervalSeconds: 300,
        enabled: true,
      }],
    }), "utf8");

    let readSecretCalls = 0;
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: {
        isAvailable: () => true,
        readSecret() {
          readSecretCalls += 1;
          return "must-not-be-read";
        },
        saveSecret: () => ({ ok: true, masked: "••••read" }),
        deleteSecret: () => true,
      },
    });

    const balancesRes = await call(handler, "/functions/tokentracker-provider-api-balances");
    const balancesBody = readJsonResponse(balancesRes);
    assert.equal(balancesRes.statusCode, 200);
    assert.equal(balancesBody.balances[0].status, "unsupported");
    assert.equal(balancesBody.balances[0].errorCode, ERROR_CODES.UNSUPPORTED_ENDPOINT);

    const headers = await getAuthHeaders(handler);
    const refreshRes = await call(handler, "/functions/tokentracker-provider-api-refresh?id=glm-legacy", {
      method: "POST",
      headers,
    });
    const refreshBody = readJsonResponse(refreshRes);
    assert.equal(refreshRes.statusCode, 200);
    assert.equal(refreshBody.balance.status, "unsupported");
    assert.equal(refreshBody.balance.balance, null);
    assert.equal(readSecretCalls, 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Test 12: 财务结果不会与订阅费用或本地估算成本重复相加
test("provider financial results are NOT summed with subscription fees or local usage estimates", async () => {
  // This is verified by checking that ProviderAccountBalance is a separate field
  // from subscription costs and local usage estimates in api-billing output.
  // The balance endpoint returns balance/monthSpend/lifetimeSpend from the
  // provider's financial API only — these must not be combined with
  // local queue cost_usd or subscription spend records.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-balance-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
      providerApiTestMode: true,
    });
    const headers = await getAuthHeaders(handler);

    // Create a provider API config
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig({ providerId: "openai" })),
    });
    const configId = readJsonResponse(created).config.id;

    // The balance endpoint should return balance fields separate from billing
    const balancesRes = await call(handler, "/functions/tokentracker-provider-api-balances");
    const balancesBody = readJsonResponse(balancesRes);
    const balance = balancesBody.balances[0];

    // Verify the balance object has the financial fields from the provider
    assert.ok("balance" in balance, "has balance field");
    assert.ok("monthSpend" in balance, "has monthSpend field");
    assert.ok("lifetimeSpend" in balance, "has lifetimeSpend field");
    assert.ok("currency" in balance, "has currency field");

    // Verify it does NOT have local usage cost fields mixed in
    assert.ok(!("monthCostUsd" in balance), "must NOT mix in local usage monthCostUsd");
    assert.ok(!("lifetimeCostUsd" in balance), "must NOT mix in local usage lifetimeCostUsd");
    assert.ok(!("subscriptionFee" in balance), "must NOT mix in subscriptionFee");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
