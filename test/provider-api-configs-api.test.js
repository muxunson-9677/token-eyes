"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");
const {
  validateDotPath,
  validateProviderApiConfig,
  normalizeProviderApiConfig,
  getProviderFinancialCapabilities,
  readProviderApiConfigs,
  sanitizeConfigForOutput,
  isSecretLikeValue,
} = require("../src/lib/provider-api-configs");

// ---------------------------------------------------------------------------
// Test helpers (match existing test pattern in token-plans-api.test.js)
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

/**
 * In-memory credential store for testing. Simulates OS keychain.
 * NOT for production use — production uses createDefaultCredentialStore().
 */
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

function maskSecret(secret) {
  const s = String(secret || "");
  if (s.length <= 4) return "••••";
  return "••••" + s.slice(-4);
}

/**
 * File-backed credential store for testing restart persistence.
 * Simulates OS keychain surviving a process restart.
 * NOT for production — production uses OS keychain via createDefaultCredentialStore().
 */
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

/**
 * Unavailable credential store for testing failure paths.
 */
function createUnavailableCredentialStore() {
  return {
    isAvailable: () => false,
    saveSecret() {
      return { ok: false, error_code: "credential_store_unavailable" };
    },
    readSecret() {
      return null;
    },
    deleteSecret() {
      return false;
    },
    listRefs() {
      return [];
    },
  };
}

function validConfig(overrides = {}) {
  return {
    providerId: "openai",
    label: "OpenAI Production",
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
// Unit tests: validateDotPath
// ---------------------------------------------------------------------------

test("validateDotPath accepts simple identifiers", () => {
  assert.equal(validateDotPath("data"), true);
  assert.equal(validateDotPath("data.balance"), true);
  assert.equal(validateDotPath("data.month_spend"), true);
  assert.equal(validateDotPath("data.month-spend"), true);
});

test("validateDotPath accepts array indices", () => {
  assert.equal(validateDotPath("data[0].balance"), true);
  assert.equal(validateDotPath("items[0].amount"), true);
  assert.equal(validateDotPath("data[0]"), true);
});

test("validateDotPath rejects prototype chain fields", () => {
  assert.equal(validateDotPath("__proto__"), false);
  assert.equal(validateDotPath("constructor"), false);
  assert.equal(validateDotPath("prototype"), false);
  assert.equal(validateDotPath("data.__proto__"), false);
  assert.equal(validateDotPath("data.constructor"), false);
});

test("validateDotPath rejects scripts and expressions", () => {
  assert.equal(validateDotPath("data; require('fs')"), false);
  assert.equal(validateDotPath("data[balance]"), false); // non-numeric bracket
  assert.equal(validateDotPath("data['x']"), false);
  assert.equal(validateDotPath("$(echo hi)"), false);
  assert.equal(validateDotPath("data..balance"), false);
  assert.equal(validateDotPath(".data"), false);
  assert.equal(validateDotPath("data."), false);
  assert.equal(validateDotPath(""), false);
  assert.equal(validateDotPath("   "), false);
});

// ---------------------------------------------------------------------------
// Unit tests: isSecretLikeValue
// ---------------------------------------------------------------------------

test("isSecretLikeValue detects api key fields", () => {
  assert.equal(isSecretLikeValue("api_key", "sk-abc"), true);
  assert.equal(isSecretLikeValue("apiKey", "sk-abc"), true);
  assert.equal(isSecretLikeValue("authorization", "Bearer x"), true);
  assert.equal(isSecretLikeValue("Authorization", "Bearer x"), true);
  assert.equal(isSecretLikeValue("secret", "val"), true);
  assert.equal(isSecretLikeValue("token", "val"), true);
  assert.equal(isSecretLikeValue("cookie", "val"), true);
  assert.equal(isSecretLikeValue("password", "val"), true);
});

test("isSecretLikeValue does not flag non-secret fields", () => {
  assert.equal(isSecretLikeValue("label", "OpenAI"), false);
  assert.equal(isSecretLikeValue("balancePath", "data.balance"), false);
  assert.equal(isSecretLikeValue("providerId", "openai"), false);
  assert.equal(isSecretLikeValue("enabled", true), false);
});

// ---------------------------------------------------------------------------
// Unit tests: validateProviderApiConfig
// ---------------------------------------------------------------------------

test("validateProviderApiConfig accepts a valid config", () => {
  const result = validateProviderApiConfig(validConfig());
  assert.equal(result.ok, true, result.error || "should be valid");
});

test("validateProviderApiConfig rejects invalid auth type", () => {
  const result = validateProviderApiConfig(validConfig({ authType: "basic" }));
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "invalid_config");
});

test("validateProviderApiConfig rejects invalid method", () => {
  const result = validateProviderApiConfig(validConfig({ requestMethod: "DELETE" }));
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "invalid_config");
});

test("validateProviderApiConfig rejects non-HTTPS URL in production mode", () => {
  const result = validateProviderApiConfig(validConfig({ requestUrl: "http://api.example.com/balance" }));
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "invalid_config");
});

test("validateProviderApiConfig rejects file protocol", () => {
  const result = validateProviderApiConfig(validConfig({ requestUrl: "file:///etc/passwd" }));
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "invalid_config");
});

test("validateProviderApiConfig rejects cloud metadata address", () => {
  const result = validateProviderApiConfig(
    validConfig({ requestUrl: "https://169.254.169.254/latest/meta-data/" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "invalid_config");
});

test("validateProviderApiConfig rejects model inference endpoint", () => {
  const result = validateProviderApiConfig(
    validConfig({ requestUrl: "https://api.openai.com/v1/chat/completions" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "invalid_config");
});

test("validateProviderApiConfig rejects prototype chain in path fields", () => {
  const result = validateProviderApiConfig(
    validConfig({ balancePath: "__proto__.balance" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "invalid_config");
});

test("validateProviderApiConfig rejects refresh interval below 60 seconds", () => {
  const result = validateProviderApiConfig(validConfig({ refreshIntervalSeconds: 30 }));
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "invalid_config");
});

test("validateProviderApiConfig rejects nested secret fields in nonSecretHeaders", () => {
  const result = validateProviderApiConfig(
    validConfig({ nonSecretHeaders: { Authorization: "Bearer sk-leak" } }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "invalid_config");
});

test("validateProviderApiConfig accepts custom header auth with header name", () => {
  const result = validateProviderApiConfig(
    validConfig({ authType: "header", authHeaderName: "X-API-Key" }),
  );
  assert.equal(result.ok, true, result.error || "should be valid");
});

test("normalizeProviderApiConfig converts DeepSeek CC Switch base URL to balance endpoint", () => {
  const normalized = normalizeProviderApiConfig({
    providerId: "",
    label: "",
    requestUrl: "https://api.deepseek.com",
    requestMethod: "GET",
    authType: "bearer",
    balancePath: "",
    currencyPath: "",
    refreshIntervalSeconds: 300,
    enabled: true,
  });

  assert.equal(normalized.providerId, "deepseek");
  assert.equal(normalized.label, "DeepSeek");
  assert.equal(normalized.requestUrl, "https://api.deepseek.com/user/balance");
  assert.equal(normalized.balancePath, "balance_infos[*].total_balance");
  assert.equal(normalized.currencyPath, "balance_infos[*].currency");

  const validation = validateProviderApiConfig(normalized);
  assert.equal(validation.ok, true, validation.error || "normalized DeepSeek config should be valid");
});

test("normalizeProviderApiConfig converts DashScope CC Switch base URL to balance endpoint", () => {
  const normalized = normalizeProviderApiConfig({
    providerId: "",
    label: "",
    requestUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    requestMethod: "GET",
    authType: "bearer",
    balancePath: "data.balance",
    currencyPath: "data.currency",
    refreshIntervalSeconds: 300,
    enabled: true,
  });

  assert.equal(normalized.providerId, "dashscope");
  assert.equal(normalized.label, "DashScope");
  assert.equal(normalized.requestUrl, "https://dashscope.aliyuncs.com/api/v1/recharge/recharge-balance/query");
  assert.equal(normalized.balancePath, "output.available_balance");
  assert.equal(normalized.currencyPath, "output.currency");

  const validation = validateProviderApiConfig(normalized);
  assert.equal(validation.ok, true, validation.error || "normalized DashScope config should be valid");
});

test("normalizeProviderApiConfig converts Moonshot CC Switch base URL to balance endpoint", () => {
  const normalized = normalizeProviderApiConfig({
    providerId: "",
    label: "Kimi 主账户",
    requestUrl: "https://api.moonshot.cn",
    requestMethod: "GET",
    authType: "bearer",
    balancePath: "",
    currencyPath: "",
    refreshIntervalSeconds: 300,
    enabled: true,
  });

  assert.equal(normalized.providerId, "moonshot");
  assert.equal(normalized.label, "Kimi 主账户");
  assert.equal(normalized.requestUrl, "https://api.moonshot.cn/v1/users/me/balance");
  assert.equal(normalized.balancePath, "data.available_balance");

  const validation = validateProviderApiConfig(normalized);
  assert.equal(validation.ok, true, validation.error || "normalized Moonshot config should be valid");
});

test("GLM model API is recognized but rejected as an unsupported financial source", () => {
  const normalized = normalizeProviderApiConfig({
    providerId: "",
    label: "智谱GLM",
    requestUrl: "https://open.bigmodel.cn/api/paas/v4",
    requestMethod: "GET",
    authType: "bearer",
    balancePath: "",
    currencyPath: "",
    refreshIntervalSeconds: 300,
    enabled: true,
  });

  assert.equal(normalized.providerId, "glm");
  assert.equal(normalized.requestUrl, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(normalized.authType, "bearer");
  assert.equal(normalized.balancePath, "");

  assert.deepEqual(getProviderFinancialCapabilities(normalized), {
    balance: "unsupported",
    monthSpend: "unsupported",
    lifetimeSpend: "unsupported",
    tokenQuota: "token_plan",
  });

  const validation = validateProviderApiConfig(normalized);
  assert.equal(validation.ok, false);
  assert.equal(validation.error_code, "unsupported_endpoint");
});

test("DeepSeek capability metadata exposes balance without inventing spend history", () => {
  const normalized = normalizeProviderApiConfig({
    providerId: "deepseek",
    label: "DeepSeek",
    requestUrl: "https://api.deepseek.com",
    requestMethod: "GET",
    authType: "bearer",
    balancePath: "",
    currencyPath: "",
    refreshIntervalSeconds: 300,
    enabled: true,
  });

  assert.deepEqual(getProviderFinancialCapabilities(normalized), {
    balance: "supported",
    monthSpend: "unsupported",
    lifetimeSpend: "unsupported",
    tokenQuota: "unsupported",
  });
  assert.deepEqual(sanitizeConfigForOutput(normalized).financialCapabilities,
    getProviderFinancialCapabilities(normalized));
});

test("readProviderApiConfigs migrates legacy DeepSeek first-entry balance paths to wildcard paths", () => {
  const [config] = readProviderApiConfigs({
    providerApiConfigs: [{
      id: "deepseek-legacy",
      providerId: "deepseek",
      label: "DeepSeek",
      requestUrl: "https://api.deepseek.com/user/balance",
      requestMethod: "GET",
      authType: "bearer",
      apiKeyRef: "provider-api/deepseek/ref",
      balancePath: "balance_infos[0].total_balance",
      currencyPath: "balance_infos[0].currency",
      refreshIntervalSeconds: 300,
      enabled: true,
    }],
  });

  assert.equal(config.balancePath, "balance_infos[*].total_balance");
  assert.equal(config.currencyPath, "balance_infos[*].currency");
});

test("validateProviderApiConfig rejects custom header auth without header name", () => {
  const result = validateProviderApiConfig(
    validConfig({ authType: "header", authHeaderName: "" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "invalid_config");
});

// ---------------------------------------------------------------------------
// Unit tests: sanitizeConfigForOutput
// ---------------------------------------------------------------------------

test("sanitizeConfigForOutput strips secret-like fields", () => {
  const config = {
    id: "abc",
    providerId: "openai",
    label: "test",
    requestUrl: "https://api.example.com/balance",
    apiKeyRef: "provider-api/openai/abc-123",
    api_key: "sk-secret-do-not-leak",
    authorization: "Bearer secret",
    password: "hidden",
  };
  const sanitized = sanitizeConfigForOutput(config);
  assert.equal(sanitized.api_key, undefined);
  assert.equal(sanitized.authorization, undefined);
  assert.equal(sanitized.password, undefined);
  assert.equal(sanitized.apiKeyRef, "provider-api/openai/abc-123");
  assert.equal(sanitized.label, "test");
});

// ---------------------------------------------------------------------------
// Integration tests: config CRUD via local-api.js
// ---------------------------------------------------------------------------

test("provider-api-configs CRUD creates, lists, updates, deletes config without echoing secrets", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-configs-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });

    const headers = await getAuthHeaders(handler);

    // Create
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig()),
    });
    const createdBody = readJsonResponse(created);
    assert.equal(created.statusCode, 200, JSON.stringify(createdBody));
    assert.ok(createdBody.config.id, "should return config with id");
    // New config has no saved secret yet — apiKeyRef is the empty-string sentinel
    assert.equal(createdBody.config.apiKeyRef, "", "apiKeyRef should be empty for new config");
    // Verify NO secret is echoed
    const createdStr = JSON.stringify(createdBody);
    assert.ok(!createdStr.includes("sk-"), "no sk- key in response");

    const configId = createdBody.config.id;

    // List
    const listed = await call(handler, "/functions/tokentracker-provider-api-configs");
    const listedBody = readJsonResponse(listed);
    assert.equal(listed.statusCode, 200);
    assert.ok(Array.isArray(listedBody.configs));
    assert.equal(listedBody.configs.length, 1);
    assert.equal(listedBody.configs[0].id, configId);

    // Update (PUT)
    const updated = await call(handler, `/functions/tokentracker-provider-api-configs?id=${configId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(validConfig({ label: "Updated Label" })),
    });
    const updatedBody = readJsonResponse(updated);
    assert.equal(updated.statusCode, 200, JSON.stringify(updatedBody));
    assert.equal(updatedBody.config.label, "Updated Label");

    // Delete
    const deleted = await call(handler, `/functions/tokentracker-provider-api-configs?id=${configId}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(deleted.statusCode, 200);

    // Verify deleted
    const listedAfter = await call(handler, "/functions/tokentracker-provider-api-configs");
    const listedAfterBody = readJsonResponse(listedAfter);
    assert.equal(listedAfterBody.configs.length, 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-api-configs POST rejects invalid config with invalid_config error code", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-configs-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });

    const headers = await getAuthHeaders(handler);

    const res = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig({ requestMethod: "DELETE" })),
    });
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 400);
    assert.equal(body.error_code, "invalid_config");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-api-configs POST accepts DeepSeek CC Switch style base URL with inferred fields", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-configs-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });

    const headers = await getAuthHeaders(handler);
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        providerId: "",
        label: "",
        requestUrl: "https://api.deepseek.com",
        requestMethod: "GET",
        authType: "bearer",
        balancePath: "",
        currencyPath: "",
        refreshIntervalSeconds: 300,
        enabled: true,
      }),
    });

    const body = readJsonResponse(created);
    assert.equal(created.statusCode, 200, JSON.stringify(body));
    assert.equal(body.config.providerId, "deepseek");
    assert.equal(body.config.label, "DeepSeek");
    assert.equal(body.config.requestUrl, "https://api.deepseek.com/user/balance");
    assert.equal(body.config.balancePath, "balance_infos[*].total_balance");
    assert.equal(body.config.currencyPath, "balance_infos[*].currency");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-api-configs POST accepts DashScope CC Switch style base URL with inferred fields", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-configs-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });

    const headers = await getAuthHeaders(handler);
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        providerId: "",
        label: "",
        requestUrl: "https://dashscope.aliyuncs.com",
        requestMethod: "GET",
        authType: "bearer",
        balancePath: "data.balance",
        currencyPath: "",
        refreshIntervalSeconds: 300,
        enabled: true,
      }),
    });

    const body = readJsonResponse(created);
    assert.equal(created.statusCode, 200, JSON.stringify(body));
    assert.equal(body.config.providerId, "dashscope");
    assert.equal(body.config.label, "DashScope");
    assert.equal(body.config.requestUrl, "https://dashscope.aliyuncs.com/api/v1/recharge/recharge-balance/query");
    assert.equal(body.config.balancePath, "output.available_balance");
    assert.equal(body.config.currencyPath, "output.currency");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-api-configs POST rejects GLM quota as a cash-balance source", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-configs-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });

    const headers = await getAuthHeaders(handler);
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        providerId: "",
        label: "智谱GLM",
        requestUrl: "https://open.bigmodel.cn/api/paas/v4",
        requestMethod: "GET",
        authType: "bearer",
        balancePath: "",
        currencyPath: "",
        refreshIntervalSeconds: 300,
        enabled: true,
      }),
    });

    const body = readJsonResponse(created);
    assert.equal(created.statusCode, 400, JSON.stringify(body));
    assert.equal(body.error_code, "unsupported_endpoint");
    assert.match(body.error, /Token 套餐设置/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-api-configs requires auth for mutations", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-configs-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });

    // POST without auth
    const res = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validConfig()),
    });
    assert.equal(res.statusCode, 401);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Test 1: 配置 CRUD 不回显秘密
test("config CRUD never echoes secrets: saving secret returns only masked reference", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-configs-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });

    const headers = await getAuthHeaders(handler);

    // Create config
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig()),
    });
    const configId = readJsonResponse(created).config.id;

    // Save secret
    const testSecret = "sk-test-secret-do-not-leak-1234567890";
    const secretRes = await call(handler, "/functions/tokentracker-provider-api-secrets", {
      method: "POST",
      headers,
      body: JSON.stringify({ configId, secret: testSecret }),
    });
    const secretBody = readJsonResponse(secretRes);
    assert.equal(secretRes.statusCode, 200, JSON.stringify(secretBody));
    assert.ok(secretBody.apiKeyRef, "should return apiKeyRef");
    assert.ok(secretBody.masked, "should return masked preview");
    assert.ok(secretBody.masked.includes("7890"), "masked should show last 4");
    // Verify the full secret is NOT in the response
    const secretResStr = JSON.stringify(secretBody);
    assert.ok(!secretResStr.includes(testSecret), "full secret must NOT appear in response");

    // List configs — should NOT include the secret
    const listed = await call(handler, "/functions/tokentracker-provider-api-configs");
    const listedStr = JSON.stringify(readJsonResponse(listed));
    assert.ok(!listedStr.includes(testSecret), "secret must NOT appear in config list");

    // Read config.json — should NOT include the secret
    const configContent = await fs.readFile(path.join(trackerDir, "config.json"), "utf8");
    assert.ok(!configContent.includes(testSecret), "secret must NOT appear in config.json");
    // But the apiKeyRef SHOULD be in config.json
    assert.ok(configContent.includes(secretBody.apiKeyRef), "apiKeyRef should be in config.json");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Test 3: 安全存储不可用时明确失败
test("saving secret fails with credential_store_unavailable when store is unavailable", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-configs-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createUnavailableCredentialStore(),
    });

    const headers = await getAuthHeaders(handler);

    // Create config first
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig()),
    });
    const configId = readJsonResponse(created).config.id;

    // Try to save secret — should fail
    const secretRes = await call(handler, "/functions/tokentracker-provider-api-secrets", {
      method: "POST",
      headers,
      body: JSON.stringify({ configId, secret: "sk-test-secret" }),
    });
    const secretBody = readJsonResponse(secretRes);
    assert.equal(secretRes.statusCode, 503);
    assert.equal(secretBody.error_code, "credential_store_unavailable");

    // Verify no plaintext secret in config.json
    const configContent = await fs.readFile(path.join(trackerDir, "config.json"), "utf8");
    assert.ok(!configContent.includes("sk-test-secret"), "no secret in config.json");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Test 11: 删除配置会删除密钥引用
test("deleting config also deletes the associated secret from credential store", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-configs-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const credStore = createTestCredentialStore();
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: credStore,
    });

    const headers = await getAuthHeaders(handler);

    // Create config
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig()),
    });
    const configId = readJsonResponse(created).config.id;

    // Save secret
    const secretRes = await call(handler, "/functions/tokentracker-provider-api-secrets", {
      method: "POST",
      headers,
      body: JSON.stringify({ configId, secret: "sk-test-delete-me" }),
    });
    const apiKeyRef = readJsonResponse(secretRes).apiKeyRef;
    assert.ok(apiKeyRef);

    // Verify secret exists in store
    assert.ok(credStore.readSecret(apiKeyRef) !== null, "secret should exist before delete");

    // Delete config
    const deleted = await call(handler, `/functions/tokentracker-provider-api-configs?id=${configId}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(deleted.statusCode, 200);

    // Verify secret is deleted from store (no orphan key)
    assert.equal(credStore.readSecret(apiKeyRef), null, "secret should be deleted from store");

    // Verify apiKeyRef is removed from config.json
    const configContent = await fs.readFile(path.join(trackerDir, "config.json"), "utf8");
    assert.ok(!configContent.includes(apiKeyRef), "apiKeyRef should be removed from config.json");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Test: delete config fails loudly if credential delete fails (no orphan keys)
test("deleting config reports visible error if credential delete fails", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-configs-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    // Credential store whose deleteSecret always fails (save/read succeed)
    const failingStore = {
      isAvailable: () => true,
      saveSecret(ref, secret) {
        return { ok: true, masked: maskSecret(secret) };
      },
      readSecret: () => null,
      deleteSecret() {
        return false; // always fails
      },
      listRefs: () => [],
    };
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: failingStore,
    });

    const headers = await getAuthHeaders(handler);

    // Create config
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig()),
    });
    const configId = readJsonResponse(created).config.id;

    // Save a secret so the config has a non-empty apiKeyRef — only then will
    // DELETE call deleteSecret() and exercise the failure path. Without this,
    // there is nothing to fail to delete and the endpoint correctly succeeds.
    const secretRes = await call(handler, "/functions/tokentracker-provider-api-secrets", {
      method: "POST",
      headers,
      body: JSON.stringify({ configId, secret: "sk-test-orphan-check-1234567890" }),
    });
    assert.equal(secretRes.statusCode, 200, JSON.stringify(readJsonResponse(secretRes)));
    const apiKeyRef = readJsonResponse(secretRes).apiKeyRef;
    assert.ok(apiKeyRef, "secret save should produce an apiKeyRef");

    // Delete should fail with visible error because deleteSecret() returns false
    const deleted = await call(handler, `/functions/tokentracker-provider-api-configs?id=${configId}`, {
      method: "DELETE",
      headers,
    });
    const body = readJsonResponse(deleted);
    assert.ok(deleted.statusCode >= 400, "should return error status");
    assert.ok(body.error || body.error_code, "should return visible error");
    assert.equal(body.error_code, "credential_delete_failed", "should report credential delete failure");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
