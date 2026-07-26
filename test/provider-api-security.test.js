"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("./helpers/local-api.cjs");
const {
  isModelEndpoint,
  isFinancialProviderEndpoint,
  normalizeFinancialPath,
  isCloudMetadataAddress,
  isAllowedUrl,
  sanitizeUrlForLogging,
  sanitizeErrorMessage,
  executeFinancialRequest,
} = require("../src/lib/provider-api-executor");
const { isSecretLikeValue, isSecretLikeHeaderName } = require("../src/lib/provider-api-configs");
const {
  createDefaultCredentialStore,
  createWindowsDpapiStore: _windowsStoreExport,
} = require("../src/lib/provider-api-secrets");

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
// Unit tests: isModelEndpoint
// ---------------------------------------------------------------------------

// Test 8: 模型推理端点被拒绝
test("isModelEndpoint rejects chat/completions", () => {
  assert.equal(isModelEndpoint("https://api.openai.com/v1/chat/completions"), true);
});

test("isModelEndpoint rejects responses endpoint", () => {
  assert.equal(isModelEndpoint("https://api.openai.com/v1/responses"), true);
});

test("isModelEndpoint rejects messages endpoint", () => {
  assert.equal(isModelEndpoint("https://api.anthropic.com/v1/messages"), true);
});

test("isModelEndpoint rejects embeddings endpoint", () => {
  assert.equal(isModelEndpoint("https://api.openai.com/v1/embeddings"), true);
});

test("isModelEndpoint rejects images/generations endpoint", () => {
  assert.equal(isModelEndpoint("https://api.openai.com/v1/images/generations"), true);
});

test("isModelEndpoint allows balance/costs/billing endpoints", () => {
  assert.equal(isModelEndpoint("https://api.openai.com/v1/organization/costs"), false);
  assert.equal(isModelEndpoint("https://api.openai.com/dashboard/billing/credit_grants"), false);
  assert.equal(isModelEndpoint("https://api.anthropic.com/v1/organizations/balance"), false);
});

test("isModelEndpoint is case-insensitive", () => {
  assert.equal(isModelEndpoint("https://api.openai.com/v1/CHAT/COMPLETIONS"), true);
  assert.equal(isModelEndpoint("https://api.openai.com/V1/Messages"), true);
});

// 01-密钥安全修复 (对抗性审查): 查询参数和片段不得绕过模型 endpoint 检测
test("isModelEndpoint rejects model endpoints even with query string", () => {
  // 修复前：`?foo=bar` 使 `$` 锚失效，导致绕过
  assert.equal(isModelEndpoint("https://api.openai.com/v1/chat/completions?foo=bar"), true);
  assert.equal(isModelEndpoint("https://api.openai.com/v1/messages?stream=true"), true);
  assert.equal(isModelEndpoint("https://api.openai.com/v1/embeddings?model=text-embedding-ada-002"), true);
});

test("isModelEndpoint rejects model endpoints even with fragment", () => {
  assert.equal(isModelEndpoint("https://api.openai.com/v1/chat/completions#section"), true);
  assert.equal(isModelEndpoint("https://api.openai.com/v1/responses#"), true);
});

test("isModelEndpoint allows financial endpoints with query strings", () => {
  assert.equal(isModelEndpoint("https://api.openai.com/v1/organization/costs?start_date=2024-01-01"), false);
  assert.equal(isModelEndpoint("https://api.anthropic.com/v1/organizations/balance?period=current"), false);
});

// 04-独立贝叶斯复验 (对抗性审查): 尾部斜杠不得绕过模型 endpoint 检测。
// HTTP 服务器通常将 /chat/completions/ 与 /chat/completions 视为同一 endpoint，
// 因此尾部斜杠是真实可利用的绕过（$ 锚失效）。
test("isModelEndpoint rejects model endpoints even with trailing slash", () => {
  assert.equal(isModelEndpoint("https://api.openai.com/v1/chat/completions/"), true);
  assert.equal(isModelEndpoint("https://api.openai.com/v1/messages/"), true);
  assert.equal(isModelEndpoint("https://api.openai.com/v1/embeddings/"), true);
  assert.equal(isModelEndpoint("https://api.openai.com/v1/chat/completions///"), true, "multiple trailing slashes");
});

// ---------------------------------------------------------------------------
// Unit tests: isCloudMetadataAddress
// ---------------------------------------------------------------------------

test("isCloudMetadataAddress rejects AWS metadata", () => {
  assert.equal(isCloudMetadataAddress("169.254.169.254"), true);
  assert.equal(isCloudMetadataAddress("169.254.170.2"), true); // ECS task metadata
});

test("isCloudMetadataAddress rejects GCP metadata", () => {
  assert.equal(isCloudMetadataAddress("metadata.google.internal"), true);
});

test("isCloudMetadataAddress allows normal hosts", () => {
  assert.equal(isCloudMetadataAddress("api.openai.com"), false);
  assert.equal(isCloudMetadataAddress("127.0.0.1"), false);
});

// ---------------------------------------------------------------------------
// Unit tests: isAllowedUrl
// ---------------------------------------------------------------------------

test("isAllowedUrl rejects non-HTTP protocols", () => {
  assert.equal(isAllowedUrl("file:///etc/passwd"), false);
  assert.equal(isAllowedUrl("ftp://example.com/file"), false);
  assert.equal(isAllowedUrl("gopher://example.com/"), false);
  assert.equal(isAllowedUrl("javascript:alert(1)"), false);
});

test("isAllowedUrl rejects cloud metadata in production mode", () => {
  assert.equal(isAllowedUrl("https://169.254.169.254/latest/meta-data/", { testMode: false }), false);
});

test("isAllowedUrl allows HTTPS in production mode", () => {
  assert.equal(isAllowedUrl("https://api.openai.com/v1/organization/costs", { testMode: false }), true);
});

test("isAllowedUrl rejects HTTP in production mode", () => {
  assert.equal(isAllowedUrl("http://api.openai.com/v1/organization/costs", { testMode: false }), false);
});

test("isAllowedUrl allows HTTP in test mode (for mock servers)", () => {
  assert.equal(isAllowedUrl("http://127.0.0.1:34567/balance", { testMode: true }), true);
});

// ---------------------------------------------------------------------------
// Unit tests: sanitizeUrlForLogging
// ---------------------------------------------------------------------------

// Test 9: 日志和错误响应不包含测试密钥
test("sanitizeUrlForLogging strips api_key from query params", () => {
  const url = "https://api.example.com/balance?api_key=sk-secret-key-12345";
  const sanitized = sanitizeUrlForLogging(url);
  assert.ok(!sanitized.includes("sk-secret-key-12345"), "api_key value must be redacted");
  assert.ok(sanitized.includes("api_key="), "param name kept but value redacted");
});

test("sanitizeUrlForLogging strips key from query params", () => {
  const url = "https://api.example.com/balance?key=secret123";
  const sanitized = sanitizeUrlForLogging(url);
  assert.ok(!sanitized.includes("secret123"), "key value must be redacted");
});

test("sanitizeUrlForLogging strips token from query params", () => {
  const url = "https://api.example.com/balance?token=tok-abc-def";
  const sanitized = sanitizeUrlForLogging(url);
  assert.ok(!sanitized.includes("tok-abc-def"), "token value must be redacted");
});

test("sanitizeErrorMessage redacts Bearer tokens", () => {
  const msg = "Request failed with Authorization: Bearer sk-test-abc123def456";
  const sanitized = sanitizeErrorMessage(msg);
  assert.ok(!sanitized.includes("sk-test-abc123def456"), "Bearer token must be redacted");
});

test("sanitizeErrorMessage redacts api_key in query", () => {
  const msg = "GET https://api.example.com?api_key=secret-key failed";
  const sanitized = sanitizeErrorMessage(msg);
  assert.ok(!sanitized.includes("secret-key"), "api_key value must be redacted");
});

test("sanitizeErrorMessage redacts sk- patterns", () => {
  const msg = "Error from server: sk-proj-abcdefghij1234567890 not found";
  const sanitized = sanitizeErrorMessage(msg);
  assert.ok(!sanitized.includes("sk-proj-abcdefghij1234567890"), "sk- key must be redacted");
});

// 01-密钥安全修复: extraSecrets verbatim 脱敏单元测试
// 修复前：sanitizeErrorMessage 只覆盖 Bearer/sk-/tp-/api_key 模式，
// 非 sk- 前缀的密钥（如 TE_REPAIR_SECRET_<uuid>）会原样泄漏。
// 修复后：extraSecrets 中的每个非空字符串都被正则转义后 verbatim 替换为 ***。
test("sanitizeErrorMessage redacts extraSecrets verbatim (non-sk prefix)", () => {
  const uniqueSecret = "TE_REPAIR_SECRET_abc-123-def-456";
  const msg = `failed to persist ${uniqueSecret} to secure store`;
  const sanitized = sanitizeErrorMessage(msg, [uniqueSecret]);
  assert.ok(!sanitized.includes(uniqueSecret), "verbatim secret must be redacted");
  assert.ok(sanitized.includes("***"), "redacted marker must be present");
});

test("sanitizeErrorMessage redacts multiple extraSecrets", () => {
  const s1 = "TE_REPAIR_SECRET_aaa";
  const s2 = "custom-key-without-prefix-xyz";
  const msg = `keys: ${s1} and ${s2}`;
  const sanitized = sanitizeErrorMessage(msg, [s1, s2]);
  assert.ok(!sanitized.includes(s1), "first secret must be redacted");
  assert.ok(!sanitized.includes(s2), "second secret must be redacted");
});

test("sanitizeErrorMessage handles regex metacharacters in extraSecrets", () => {
  // 密钥含正则元字符（如 . * + ?）时，必须正确转义，否则替换会失败或误匹配
  const secret = "sk.test*[key]+?special";
  const msg = `error: ${secret} is invalid`;
  const sanitized = sanitizeErrorMessage(msg, [secret]);
  assert.ok(!sanitized.includes(secret), "secret with regex metachars must be redacted");
});

test("sanitizeErrorMessage ignores empty/null extraSecrets entries", () => {
  const msg = "normal error without secrets";
  const sanitized = sanitizeErrorMessage(msg, ["", null, undefined]);
  assert.equal(sanitized, msg, "empty entries must not affect output");
});

test("sanitizeErrorMessage redacts custom auth header value via extraSecrets", () => {
  // F2 场景：自定义 Header 鉴权时，密钥不是 Bearer/sk- 格式
  const secret = "x-custom-auth-value-12345";
  const msg = `X-Custom-Auth: ${secret}`;
  const sanitized = sanitizeErrorMessage(msg, [secret]);
  assert.ok(!sanitized.includes(secret), "custom header secret must be redacted");
});

test("validateRedirectTarget rejects secret in query params", () => {
  const { validateRedirectTarget } = require("../src/lib/provider-api-executor");
  const r = validateRedirectTarget("https://api.example.com/balance?api_key=sk-secret", { testMode: true });
  assert.equal(r.ok, false);
  assert.equal(r.error_code, "provider_response_invalid");
});

// ---------------------------------------------------------------------------
// Integration tests: security via local-api.js
// ---------------------------------------------------------------------------

// Test 8: 模型推理端点被拒绝 (integration)
test("creating config with model inference endpoint is rejected", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });
    const headers = await getAuthHeaders(handler);

    const endpoints = [
      "https://api.openai.com/v1/chat/completions",
      "https://api.openai.com/v1/responses",
      "https://api.anthropic.com/v1/messages",
      "https://api.openai.com/v1/embeddings",
      "https://api.openai.com/v1/images/generations",
      // 01-密钥安全修复 (对抗性审查): 查询参数不得绕过模型 endpoint 检测
      "https://api.openai.com/v1/chat/completions?stream=true",
      "https://api.openai.com/v1/messages?model=claude-3",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=test",
    ];

    for (const endpoint of endpoints) {
      const res = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({ requestUrl: endpoint })),
      });
      const body = readJsonResponse(res);
      assert.equal(res.statusCode, 400, `${endpoint} should be rejected`);
      assert.equal(body.error_code, "invalid_config", `${endpoint} should be invalid_config`);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Test 7: 跨域重定向不携带密钥
test("cross-domain redirect does not carry Authorization header", async () => {
  let redirectAuthHeader = null;
  let firstRequestAuth = null;

  // Mock server: first endpoint redirects to a different "domain" (different port)
  const targetServer = await startMockServer((req, res) => {
    redirectAuthHeader = req.headers["authorization"] || "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: { balance: 500, currency: "USD" } }));
  });

  const redirectServer = await startMockServer((req, res) => {
    firstRequestAuth = req.headers["authorization"] || "";
    // Redirect to the target server (different host:port = cross-domain)
    res.writeHead(302, { Location: `${targetServer.url}/balance` });
    res.end();
  });

  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
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
        body: JSON.stringify(validConfig({ requestUrl: `${redirectServer.url}/balance` })),
      });
      const configId = readJsonResponse(created).config.id;

      const testSecret = "sk-cross-domain-redirect-test-7777";
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
      // Should succeed (redirect followed) OR fail gracefully — but the key security check is:
      // the redirected request must NOT contain the Authorization header

      // First request SHOULD have the auth header
      assert.equal(firstRequestAuth, `Bearer ${testSecret}`, "first request should have Bearer auth");

      // Redirected request should NOT have the auth header (cross-domain)
      assert.equal(redirectAuthHeader, "", "cross-domain redirect must NOT carry Authorization header");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    redirectServer.server.close();
    targetServer.server.close();
  }
});

// Test 9: 日志和错误响应不包含测试密钥
test("error responses and logs do not contain the test secret", async () => {
  const { server, url } = await startMockServer((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  });
  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
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

      const testSecret = "sk-error-leak-test-secret-aaa-bbb-ccc";
      await call(handler, "/functions/tokentracker-provider-api-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({ configId, secret: testSecret }),
      });

      const refreshRes = await call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, {
        method: "POST",
        headers,
      });
      const refreshStr = refreshRes.body.toString("utf8");

      // The error response must NOT contain the test secret
      assert.ok(
        !refreshStr.includes(testSecret),
        "error response must NOT contain the test secret",
      );

      // The error response must NOT contain "Bearer sk-error-leak-test-secret"
      assert.ok(
        !refreshStr.includes(`Bearer ${testSecret}`),
        "error response must NOT contain Bearer + secret",
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

// Adversarial: nested secret fields in config
test("config with nested secret fields is rejected", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });
    const headers = await getAuthHeaders(handler);

    // Try to sneak a secret into nonSecretHeaders
    const res = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig({
        nonSecretHeaders: {
          "X-Custom": "ok",
          Authorization: "Bearer sk-sneaky-secret",
        },
      })),
    });
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 400);
    assert.equal(body.error_code, "invalid_config");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Adversarial: secret in URL query param
test("config with secret in URL query param is rejected or sanitized", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });
    const headers = await getAuthHeaders(handler);

    // Try to put api_key in URL
    const res = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig({
        requestUrl: "https://api.example.com/balance?api_key=sk-in-url-secret",
      })),
    });
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 400, "config with api_key in URL should be rejected");
    assert.equal(body.error_code, "invalid_config");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Adversarial: prototype chain in path fields
test("config with prototype chain path is rejected", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
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
      body: JSON.stringify(validConfig({ balancePath: "constructor.prototype.balance" })),
    });
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 400);
    assert.equal(body.error_code, "invalid_config");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Adversarial: cloud metadata address
test("config with cloud metadata address is rejected", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
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
      body: JSON.stringify(validConfig({
        requestUrl: "https://169.254.169.254/latest/meta-data/iam/security-credentials/",
      })),
    });
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 400);
    assert.equal(body.error_code, "invalid_config");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Adversarial: timeout handling
test("refreshBalance maps request timeout to request_timeout error code", async () => {
  const { server, url } = await startMockServer((req, res) => {
    // Never respond — triggers timeout
    setTimeout(() => {
      try {
        res.writeHead(200);
        res.end("{}");
      } catch {
        // already closed
      }
    }, 10000);
  });
  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      const handler = createLocalApiHandler({
        queuePath: path.join(trackerDir, "queue.jsonl"),
        trackerDataDir: trackerDir,
        credentialStore: createTestCredentialStore(),
        providerApiTestMode: true,
        providerApiTimeoutMs: 500, // short timeout for test
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
      assert.equal(refreshBody.balance.errorCode, "request_timeout");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

// Adversarial: secret deletion
test("deleting a secret via endpoint removes it from credential store", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const credStore = createTestCredentialStore();
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: credStore,
    });
    const headers = await getAuthHeaders(handler);

    // Create config + secret
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig()),
    });
    const configId = readJsonResponse(created).config.id;

    const secretRes = await call(handler, "/functions/tokentracker-provider-api-secrets", {
      method: "POST",
      headers,
      body: JSON.stringify({ configId, secret: "sk-delete-test-9999" }),
    });
    const apiKeyRef = readJsonResponse(secretRes).apiKeyRef;
    assert.ok(credStore.readSecret(apiKeyRef) !== null);

    // Delete secret via endpoint
    const delRes = await call(handler, `/functions/tokentracker-provider-api-secrets?id=${configId}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(delRes.statusCode, 200);

    // Secret should be gone from store
    assert.equal(credStore.readSecret(apiKeyRef), null, "secret should be deleted from store");

    // Refresh should now return not-connected
    const refreshRes = await call(handler, `/functions/tokentracker-provider-api-refresh?id=${configId}`, {
      method: "POST",
      headers,
    });
    const refreshBody = readJsonResponse(refreshRes);
    assert.equal(refreshBody.balance.status, "not-connected");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Adversarial: test connection endpoint
test("POST /functions/tokentracker-provider-api-test?id=<id> tests connection without leaking secret", async () => {
  const { server, url } = await startMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: { balance: 42, currency: "USD" } }));
  });
  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
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

      const testSecret = "sk-test-conn-secret-zzz-0000";
      await call(handler, "/functions/tokentracker-provider-api-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({ configId, secret: testSecret }),
      });

      // Test connection
      const testRes = await call(handler, `/functions/tokentracker-provider-api-test?id=${configId}`, {
        method: "POST",
        headers,
      });
      const testBody = readJsonResponse(testRes);
      assert.equal(testRes.statusCode, 200, JSON.stringify(testBody));
      assert.equal(testBody.balance.status, "synced");
      assert.equal(testBody.balance.balance, 42);

      // No secret in response
      const testStr = JSON.stringify(testBody);
      assert.ok(!testStr.includes(testSecret), "test response must not contain secret");
      assert.ok(!testStr.includes("Bearer "), "test response must not contain Bearer");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

// Adversarial: config persistence does not contain secrets
test("config.json never contains plaintext secrets after multiple operations", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });
    const headers = await getAuthHeaders(handler);

    const secrets = [
      "sk-first-secret-aaa-1111",
      "sk-second-secret-bbb-2222",
      "sk-third-secret-ccc-3333",
    ];

    for (let i = 0; i < 3; i++) {
      const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({ label: `Config ${i}` })),
      });
      const configId = readJsonResponse(created).config.id;

      await call(handler, "/functions/tokentracker-provider-api-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({ configId, secret: secrets[i] }),
      });
    }

    // Check config.json for ANY of the secrets
    const configContent = await fs.readFile(path.join(trackerDir, "config.json"), "utf8");
    for (const secret of secrets) {
      assert.ok(
        !configContent.includes(secret),
        `config.json must not contain secret: ${secret}`,
      );
    }

    // Also check no "Bearer " + secret pattern
    for (const secret of secrets) {
      assert.ok(
        !configContent.includes(`Bearer ${secret}`),
        `config.json must not contain Bearer + secret`,
      );
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Unit tests: isSecretLikeValue — regex consistency (P2 fix)
// ---------------------------------------------------------------------------
// Defense-in-depth: isSecretLikeValue must catch real OpenAI keys containing
// internal hyphens (sk-proj-...) just like sanitizeErrorMessage does.
// The old regex /^sk-[a-zA-Z0-9]{10,}/ only matched 10+ consecutive
// alphanumeric chars, missing keys like sk-proj-abc... where "proj" breaks
// the alphanumeric run. Fixed to use [A-Za-z0-9\-_]{10,}.

test("isSecretLikeValue flags sk- keys with internal hyphens (sk-proj-...)", () => {
  // Real-world OpenAI key shapes
  assert.equal(isSecretLikeValue("label", "sk-proj-abcdef1234567890"), true);
  assert.equal(isSecretLikeValue("label", "sk-proj-T6m1l3Kq8sZ9abcdef"), true);
  assert.equal(isSecretLikeValue("label", "sk-svcacct-abcdef1234567890"), true);
});

test("isSecretLikeValue flags sk- keys with underscores", () => {
  assert.equal(isSecretLikeValue("label", "sk-proj_test_abcdef1234567890"), true);
});

test("isSecretLikeValue flags classic sk- keys (no internal hyphens)", () => {
  assert.equal(isSecretLikeValue("label", "sk-abcdef1234567890"), true);
});

test("isSecretLikeValue flags Bearer tokens", () => {
  assert.equal(isSecretLikeValue("label", "Bearer abc123"), true);
  assert.equal(isSecretLikeValue("label", "bearer abc123"), true);
});

test("isSecretLikeValue flags tp- tokens (Anthropic-style)", () => {
  assert.equal(isSecretLikeValue("label", "tp-abcdef1234567890"), true);
  assert.equal(isSecretLikeValue("label", "tp-antropic-test-abcdef1234567890"), true);
});

test("isSecretLikeValue does NOT flag normal labels or refs", () => {
  assert.equal(isSecretLikeValue("label", "OpenAI Production"), false);
  assert.equal(isSecretLikeValue("label", "My Test Account"), false);
  assert.equal(isSecretLikeValue("apiKeyRef", "keyring://provider-api/abc-123"), false);
  assert.equal(isSecretLikeValue("providerId", "openai"), false);
});

test("isSecretLikeValue flags by secret field name regardless of value", () => {
  assert.equal(isSecretLikeValue("api_key", "anything"), true);
  assert.equal(isSecretLikeValue("apikey", "anything"), true);
  assert.equal(isSecretLikeValue("Authorization", "anything"), true);
  assert.equal(isSecretLikeValue("secret", "anything"), true);
  assert.equal(isSecretLikeValue("token", "anything"), true);
  assert.equal(isSecretLikeValue("password", "anything"), true);
  assert.equal(isSecretLikeValue("credential", "anything"), true);
});

test("isSecretLikeValue does NOT flag apiKeyRef (it's a reference, not a secret)", () => {
  assert.equal(isSecretLikeValue("apiKeyRef", "keyring://provider-api/uuid-123"), false);
  assert.equal(isSecretLikeValue("apikeyref", "ref-123"), false);
});

test("config with sk-proj-... key in label field is rejected (defense-in-depth)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });
    const headers = await getAuthHeaders(handler);

    // Try to put a real-shape OpenAI key into the non-secret "label" field.
    // isSecretLikeValue should now catch it (regex consistency fix).
    const res = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig({
        label: "sk-proj-abcdef1234567890XYZ",
      })),
    });
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 400, "config with sk-proj- key in label must be rejected");
    assert.equal(body.error_code, "invalid_config");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Unit tests: isSecretLikeHeaderName — X- prefix defense-in-depth (B4-4 fix)
//
// The exact-match SECRET_FIELD_NAMES set misses X-Api-Key, X-Auth-Token, etc.
// isSecretLikeHeaderName uses word-split matching to catch these variations,
// preventing plaintext secrets from being persisted in config.json via
// nonSecretHeaders.
// ---------------------------------------------------------------------------

test("isSecretLikeHeaderName flags X-Api-Key (with hyphens)", () => {
  assert.equal(isSecretLikeHeaderName("X-Api-Key"), true);
  assert.equal(isSecretLikeHeaderName("x-api-key"), true);
  assert.equal(isSecretLikeHeaderName("X-API-KEY"), true);
});

test("isSecretLikeHeaderName flags X-Auth-Token", () => {
  assert.equal(isSecretLikeHeaderName("X-Auth-Token"), true);
  assert.equal(isSecretLikeHeaderName("x-auth-token"), true);
});

test("isSecretLikeHeaderName flags other X- secret header variants", () => {
  assert.equal(isSecretLikeHeaderName("X-Redmine-Api-Key"), true);
  assert.equal(isSecretLikeHeaderName("X-Secret-Token"), true);
  assert.equal(isSecretLikeHeaderName("X-Access-Token"), true);
  assert.equal(isSecretLikeHeaderName("X-Refresh-Token"), true);
  assert.equal(isSecretLikeHeaderName("X-Client-Secret"), true);
  assert.equal(isSecretLikeHeaderName("X-Private-Key"), true);
});

test("isSecretLikeHeaderName flags underscore and dot variants", () => {
  assert.equal(isSecretLikeHeaderName("api_key"), true);
  assert.equal(isSecretLikeHeaderName("auth_token"), true);
  assert.equal(isSecretLikeHeaderName("client.secret"), true);
  assert.equal(isSecretLikeHeaderName("access token"), true);
});

test("isSecretLikeHeaderName flags exact-match secret field names", () => {
  assert.equal(isSecretLikeHeaderName("Authorization"), true);
  assert.equal(isSecretLikeHeaderName("authorization"), true);
  assert.equal(isSecretLikeHeaderName("Cookie"), true);
  assert.equal(isSecretLikeHeaderName("api_key"), true);
  assert.equal(isSecretLikeHeaderName("password"), true);
  assert.equal(isSecretLikeHeaderName("secret"), true);
});

test("isSecretLikeHeaderName does NOT flag legitimate non-secret headers", () => {
  assert.equal(isSecretLikeHeaderName("Content-Type"), false);
  assert.equal(isSecretLikeHeaderName("Accept"), false);
  assert.equal(isSecretLikeHeaderName("User-Agent"), false);
  assert.equal(isSecretLikeHeaderName("X-Request-Id"), false);
  assert.equal(isSecretLikeHeaderName("X-Custom"), false);
  assert.equal(isSecretLikeHeaderName("X-Region"), false);
  assert.equal(isSecretLikeHeaderName("Accept-Language"), false);
});

test("isSecretLikeHeaderName does NOT flag apiKeyRef (reference, not secret)", () => {
  assert.equal(isSecretLikeHeaderName("apiKeyRef"), false);
  assert.equal(isSecretLikeHeaderName("apikeyref"), false);
});

test("isSecretLikeHeaderName handles edge cases", () => {
  assert.equal(isSecretLikeHeaderName(""), false);
  assert.equal(isSecretLikeHeaderName(null), false);
  assert.equal(isSecretLikeHeaderName(undefined), false);
  assert.equal(isSecretLikeHeaderName(123), false);
});

// ---------------------------------------------------------------------------
// Integration tests: nonSecretHeaders rejects X-Api-Key / X-Auth-Token
// even with non-sk- prefixed values (B4-4 fix)
// ---------------------------------------------------------------------------

test("config with X-Api-Key in nonSecretHeaders is rejected (even without sk- value)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });
    const headers = await getAuthHeaders(handler);

    // X-Api-Key with a NON-sk- prefixed value — must still be rejected by name
    const res = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig({
        nonSecretHeaders: {
          "X-Api-Key": "mySecretKeyValue123456",
        },
      })),
    });
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 400, "X-Api-Key in nonSecretHeaders must be rejected by name");
    assert.equal(body.error_code, "invalid_config");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("config with X-Auth-Token in nonSecretHeaders is rejected (even without sk- value)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
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
      body: JSON.stringify(validConfig({
        nonSecretHeaders: {
          "X-Auth-Token": "someTokenValueNotSkPrefixed",
        },
      })),
    });
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 400, "X-Auth-Token in nonSecretHeaders must be rejected");
    assert.equal(body.error_code, "invalid_config");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("config with legitimate nonSecretHeaders (Content-Type, Accept) is accepted", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
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
      body: JSON.stringify(validConfig({
        nonSecretHeaders: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Custom-Region": "us-east-1",
        },
      })),
    });
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 200, "legitimate nonSecretHeaders should be accepted");
    assert.ok(body.config || body.id, "response should contain saved config");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("config with X-Redmine-Api-Key in nonSecretHeaders is rejected", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-provider-api-security-"));
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
      body: JSON.stringify(validConfig({
        nonSecretHeaders: {
          "X-Redmine-Api-Key": "redmineSecretNotSkPrefixed",
        },
      })),
    });
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 400, "X-Redmine-Api-Key in nonSecretHeaders must be rejected");
    assert.equal(body.error_code, "invalid_config");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ===========================================================================
// 01-密钥安全修复 — F1/F2 复现测试（必须先失败，修复后通过）
//
// 这些测试直接复现 README 中确认的 P0 反例：
//   F1: API Key 进入安全存储子进程 argv/env
//   F2: 自定义鉴权 Header 在跨域/跨端口重定向时仍被转发
//
// 规则：每条测试在修复前必须失败（保留原始失败证据），修复后必须通过。
// ===========================================================================

// 唯一测试密钥（每轮随机，用于扫描所有泄漏面）
const REPAIR_UNIQUE_SECRET = `TE_REPAIR_SECRET_${crypto.randomUUID()}`;

// ---------------------------------------------------------------------------
// F1 复现 — Windows DPAPI：密钥不得进入子进程 argv / env
// ---------------------------------------------------------------------------

function makeCapturingRunner(calls, opts = {}) {
  // 记录每次调用的 cmd / args / env / stdin，并返回可控结果
  return function captureRunner(cmd, args, callOpts = {}) {
    calls.push({
      cmd,
      args: args ? args.slice() : [],
      env: callOpts.env || null,
      input: callOpts.input != null ? String(callOpts.input) : null,
    });
    return {
      status: 0,
      stdout: opts.stdout != null ? opts.stdout : "FAKE_DPAPI_BLOB",
      stderr: "",
      error: null,
    };
  };
}

test("F1-REPRO Windows DPAPI saveSecret: secret MUST NOT appear in runner argv", () => {
  const tmp = path.join(os.tmpdir(), `te-f1-win-argv-${crypto.randomUUID()}`);
  fsSync.mkdirSync(tmp, { recursive: true });
  try {
    const calls = [];
    const runner = makeCapturingRunner(calls);
    const store = createDefaultCredentialStore({
      platform: "win32",
      trackerDataDir: tmp,
      runner,
    });
    const result = store.saveSecret("provider-api/test/ref-1", REPAIR_UNIQUE_SECRET);
    assert.equal(result.ok, true, "saveSecret should succeed with capturing runner");

    // 修复前：secret 被插值进 powershell -Command 字符串 → argv 包含 secret（FAIL）
    // 修复后：secret 只通过 stdin 传递 → argv 不含 secret（PASS）
    const allArgs = calls.map((c) => c.args.join("\n")).join("\n");
    assert.ok(
      !allArgs.includes(REPAIR_UNIQUE_SECRET),
      "F1 FAIL: secret leaked into subprocess argv",
    );
  } finally {
    fsSync.rmSync(tmp, { recursive: true, force: true });
  }
});

test("F1-REPRO Windows DPAPI saveSecret: secret MUST NOT appear in subprocess env", () => {
  const tmp = path.join(os.tmpdir(), `te-f1-win-env-${crypto.randomUUID()}`);
  fsSync.mkdirSync(tmp, { recursive: true });
  try {
    const calls = [];
    const runner = makeCapturingRunner(calls);
    const store = createDefaultCredentialStore({
      platform: "win32",
      trackerDataDir: tmp,
      runner,
    });
    store.saveSecret("provider-api/test/ref-2", REPAIR_UNIQUE_SECRET);

    // 修复前后：env 均不应包含 secret（防御性）
    const envStr = calls.map((c) => JSON.stringify(c.env || {})).join("\n");
    assert.ok(
      !envStr.includes(REPAIR_UNIQUE_SECRET),
      "F1 FAIL: secret leaked into subprocess env",
    );
  } finally {
    fsSync.rmSync(tmp, { recursive: true, force: true });
  }
});

test("F1-REPRO Windows DPAPI: secret only travels via stdin, not argv", () => {
  const tmp = path.join(os.tmpdir(), `te-f1-win-stdin-${crypto.randomUUID()}`);
  fsSync.mkdirSync(tmp, { recursive: true });
  try {
    const calls = [];
    const runner = makeCapturingRunner(calls);
    const store = createDefaultCredentialStore({
      platform: "win32",
      trackerDataDir: tmp,
      runner,
    });
    store.saveSecret("provider-api/test/ref-3", REPAIR_UNIQUE_SECRET);

    // 修复后：secret 必须出现在 stdin input 中（证明它通过受控 stdin 传递）
    const anyStdinHasSecret = calls.some((c) => c.input && c.input.includes(REPAIR_UNIQUE_SECRET));
    assert.ok(anyStdinHasSecret, "secret should be delivered via controlled stdin");
  } finally {
    fsSync.rmSync(tmp, { recursive: true, force: true });
  }
});

test("F1-REPRO Windows DPAPI: vault file MUST NOT contain plaintext secret", () => {
  const tmp = path.join(os.tmpdir(), `te-f1-win-vault-${crypto.randomUUID()}`);
  fsSync.mkdirSync(tmp, { recursive: true });
  try {
    const runner = makeCapturingRunner([]);
    const store = createDefaultCredentialStore({
      platform: "win32",
      trackerDataDir: tmp,
      runner,
    });
    store.saveSecret("provider-api/test/ref-4", REPAIR_UNIQUE_SECRET);
    const vault = fsSync.readFileSync(path.join(tmp, "provider-api-vault.enc"), "utf8");
    assert.ok(
      !vault.includes(REPAIR_UNIQUE_SECRET),
      "F1 FAIL: plaintext secret found in vault file",
    );
  } finally {
    fsSync.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F1 复现 — macOS Keychain：密钥不得进入 argv；架构无法安全实现时必须 unavailable
// ---------------------------------------------------------------------------

test("F1-REPRO macOS Keychain: store MUST be unavailable (no secure native path in Node CLI)", () => {
  const calls = [];
  const runner = makeCapturingRunner(calls);
  const store = createDefaultCredentialStore({ platform: "darwin", runner });
  // 修复前：isAvailable() === true 且 secret 进入 argv（FAIL）
  // 修复后：isAvailable() === false（PASS）
  assert.equal(store.isAvailable(), false, "macOS store must be unavailable without native secure IPC");
  const result = store.saveSecret("provider-api/test/ref-5", REPAIR_UNIQUE_SECRET);
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "credential_store_unavailable");
  // 即便 store unavailable，也不应调用 runner 暴露 secret
  const allArgs = calls.map((c) => c.args.join("\n")).join("\n");
  assert.ok(!allArgs.includes(REPAIR_UNIQUE_SECRET), "macOS unavailable store must never pass secret to runner");
});

// ---------------------------------------------------------------------------
// F2 复现 — 自定义鉴权 Header 跨域重定向不得携带密钥
// ---------------------------------------------------------------------------

async function startRedirectChain({ firstHandler, targetHandler }) {
  const target = await startMockServer(targetHandler);
  const redirector = await startMockServer(firstHandler(target.url));
  return { redirector, target };
}

test("F2-REPRO custom X-Custom-Auth header stripped on cross-port redirect", async () => {
  let targetReceivedAuth = null;
  const { redirector, target } = await startRedirectChain({
    firstHandler: (targetUrl) => (req, res) => {
      // 重定向到不同端口（跨 origin）
      res.writeHead(302, { Location: `${targetUrl}/balance` });
      res.end();
    },
    targetHandler: (req, res) => {
      targetReceivedAuth = req.headers["x-custom-auth"] || "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { balance: 1, currency: "USD" } }));
    },
  });
  try {
    const result = await executeFinancialRequest({
      requestUrl: `${redirector.url}/balance`,
      requestMethod: "GET",
      authType: "header",
      authHeaderName: "X-Custom-Auth",
      balancePath: "data.balance",
    }, REPAIR_UNIQUE_SECRET, { testMode: true });
    // 修复前：target 收到 X-Custom-Auth = secret（FAIL）
    // 修复后：target 收不到（PASS）
    assert.equal(targetReceivedAuth, "", "F2 FAIL: custom auth header leaked across cross-port redirect");
    assert.equal(result.ok, true);
  } finally {
    redirector.server.close();
    target.server.close();
  }
});

test("F2-REPRO lowercase custom auth header stripped on cross-host redirect", async () => {
  let targetReceivedAuth = null;
  const { redirector, target } = await startRedirectChain({
    firstHandler: (targetUrl) => (req, res) => {
      res.writeHead(302, { Location: `${targetUrl}/balance` });
      res.end();
    },
    targetHandler: (req, res) => {
      // Node 把 header 名统一转小写
      targetReceivedAuth = req.headers["x-custom-auth"] || "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { balance: 1, currency: "USD" } }));
    },
  });
  try {
    await executeFinancialRequest({
      requestUrl: `${redirector.url}/balance`,
      requestMethod: "GET",
      authType: "header",
      authHeaderName: "x-custom-auth",
      balancePath: "data.balance",
    }, REPAIR_UNIQUE_SECRET, { testMode: true });
    assert.equal(targetReceivedAuth, "", "F2 FAIL: lowercase custom auth header leaked across redirect");
  } finally {
    redirector.server.close();
    target.server.close();
  }
});

test("F2-REPRO secret NOT restored when redirect chain returns to original origin", async () => {
  // 链路：A (original) --302--> B (cross, strip) --302--> A' (same host:port as A)
  // 第二跳回到与 A 相同的 origin，密钥不得恢复
  let finalReceivedAuth = null;
  let firstReceivedAuth = null;
  const target = await startMockServer((req, res) => {
    finalReceivedAuth = req.headers["x-custom-auth"] || req.headers["authorization"] || "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: { balance: 1, currency: "USD" } }));
  });
  const middle = await startMockServer((req, res) => {
    res.writeHead(302, { Location: `${target.url}/balance` });
    res.end();
  });
  const origin = await startMockServer((req, res) => {
    firstReceivedAuth = req.headers["x-custom-auth"] || "";
    // 第一跳：跨 origin 到 middle
    res.writeHead(302, { Location: `${middle.url}/balance` });
    res.end();
  });
  try {
    // 注意：target 与 origin 端口不同即视为跨 origin；为了让"回到原域"成立，
    // 我们让 target 显式与 origin 同端口不可能，故改用"第一跳跨域剥离后，
    // 即使最终目标任意 origin，密钥也不得在后续任一跳恢复"的不变量。
    await executeFinancialRequest({
      requestUrl: `${origin.url}/balance`,
      requestMethod: "GET",
      authType: "header",
      authHeaderName: "X-Custom-Auth",
      balancePath: "data.balance",
    }, REPAIR_UNIQUE_SECRET, { testMode: true });
    // 第一跳应该收到密钥
    assert.equal(firstReceivedAuth, REPAIR_UNIQUE_SECRET, "first hop should receive the secret");
    // 后续跳不得收到密钥（已在跨域剥离，不得恢复）
    assert.equal(finalReceivedAuth, "", "F2 FAIL: secret restored after cross-domain strip on later hop");
  } finally {
    origin.server.close();
    middle.server.close();
    target.server.close();
  }
});

test("F2-REPRO HTTP downgrade redirect MUST be rejected (production mode)", async () => {
  // 生产模式（testMode:false）下，HTTP origin 直接被 isAllowedUrl 拒绝。
  // 这里验证生产模式对 HTTP origin 的初始拒绝（重定向降级由 validateRedirectTarget 单元测试覆盖）。
  const httpOrigin = await startMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: { balance: 1 } }));
  });
  try {
    const result = await executeFinancialRequest({
      requestUrl: `${httpOrigin.url}/balance`,
      requestMethod: "GET",
      authType: "bearer",
      balancePath: "data.balance",
    }, REPAIR_UNIQUE_SECRET, { testMode: false, timeoutMs: 4000 });
    assert.equal(result.ok, false, "production mode must reject HTTP origin");
    assert.equal(result.error_code, "invalid_config");
  } finally {
    httpOrigin.server.close();
  }
});

test("F2-UNIT validateRedirectTarget rejects HTTP downgrade in production mode", async () => {
  const { validateRedirectTarget } = require("../src/lib/provider-api-executor");
  const r = validateRedirectTarget("http://evil.example.com/balance", { testMode: false });
  assert.ok(r && r.ok === false, "HTTP downgrade redirect must be rejected in production mode");
  assert.equal(r.error_code, "provider_response_invalid");
});

test("F2-UNIT validateRedirectTarget allows HTTPS in production mode", () => {
  const { validateRedirectTarget } = require("../src/lib/provider-api-executor");
  const r = validateRedirectTarget("https://api.example.com/v1/balance", { testMode: false });
  assert.ok(!r || r.ok === true, "HTTPS redirect target should be allowed in production mode");
});

test("F2-UNIT validateRedirectTarget rejects cloud metadata target", () => {
  const { validateRedirectTarget } = require("../src/lib/provider-api-executor");
  const r = validateRedirectTarget("https://169.254.169.254/latest/meta-data/", { testMode: true });
  assert.ok(r && r.ok === false, "cloud metadata redirect target must be rejected");
  assert.equal(r.error_code, "provider_response_invalid");
});

test("F2-UNIT validateRedirectTarget rejects model endpoint target", () => {
  const { validateRedirectTarget } = require("../src/lib/provider-api-executor");
  const r = validateRedirectTarget("https://api.openai.com/v1/chat/completions", { testMode: true });
  assert.ok(r && r.ok === false, "model endpoint redirect target must be rejected");
  assert.equal(r.error_code, "provider_response_invalid");
});

test("F2-REPRO cloud metadata redirect target rejected (integration)", async () => {
  // 169.254.169.254 不可达，redirect 后 validateRedirectTarget 直接拒绝
  const origin = await startMockServer((req, res) => {
    res.writeHead(302, { Location: "https://169.254.169.254/latest/meta-data/iam/security-credentials/" });
    res.end();
  });
  try {
    const result = await executeFinancialRequest({
      requestUrl: `${origin.url}/balance`,
      requestMethod: "GET",
      authType: "bearer",
      balancePath: "data.balance",
    }, REPAIR_UNIQUE_SECRET, { testMode: true, timeoutMs: 4000 });
    assert.equal(result.ok, false, "metadata redirect must be rejected");
    assert.equal(result.error_code, "provider_response_invalid");
  } finally {
    origin.server.close();
  }
});

test("F2-REPRO model endpoint redirect target rejected (integration)", async () => {
  const origin = await startMockServer((req, res) => {
    res.writeHead(302, { Location: "https://api.openai.com/v1/chat/completions" });
    res.end();
  });
  try {
    const result = await executeFinancialRequest({
      requestUrl: `${origin.url}/balance`,
      requestMethod: "GET",
      authType: "bearer",
      balancePath: "data.balance",
    }, REPAIR_UNIQUE_SECRET, { testMode: true, timeoutMs: 4000 });
    assert.equal(result.ok, false, "model endpoint redirect must be rejected");
    assert.equal(result.error_code, "provider_response_invalid");
  } finally {
    origin.server.close();
  }
});

// ---------------------------------------------------------------------------
// F1 复现 — 错误脱敏：endpoint 抛出包含测试密钥的错误时，响应不得包含原文
// ---------------------------------------------------------------------------

test("F1-REPRO error response MUST sanitize unique test secret", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "te-f1-error-sanitize-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    // 凭据存储 saveSecret 抛出包含密钥原文的错误
    const throwingStore = {
      isAvailable: () => true,
      saveSecret(ref, secret) {
        throw new Error(`failed to persist ${secret} to secure store`);
      },
      readSecret() { return null; },
      deleteSecret() { return false; },
      listRefs() { return []; },
    };
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: throwingStore,
    });
    const headers = await getAuthHeaders(handler);
    const created = await call(handler, "/functions/tokentracker-provider-api-configs", {
      method: "POST",
      headers,
      body: JSON.stringify(validConfig()),
    });
    const configId = readJsonResponse(created).config.id;

    const res = await call(handler, "/functions/tokentracker-provider-api-secrets", {
      method: "POST",
      headers,
      body: JSON.stringify({ configId, secret: REPAIR_UNIQUE_SECRET }),
    });
    const bodyStr = res.body.toString("utf8");
    // 修复前：catch 直接返回 e.message，包含 secret（FAIL）
    // 修复后：sanitizeErrorMessage(e.message, [secret]) 脱敏（PASS）
    assert.ok(
      !bodyStr.includes(REPAIR_UNIQUE_SECRET),
      "F1 FAIL: unique test secret leaked into error response",
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F1 复现 — 模型调用路径不得通过 generic 配置绕过
// ---------------------------------------------------------------------------

test("F1-REPRO generic POST to generateContent (Gemini) model endpoint MUST be rejected", () => {
  // 修复前：MODEL_ENDPOINT_PATTERNS 未覆盖 generateContent（FAIL）
  // 修复后：拒绝（PASS）
  assert.equal(
    isModelEndpoint("https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent"),
    true,
    "F1 FAIL: Gemini generateContent endpoint not recognized as model endpoint",
  );
});

test("F1-REPRO generic POST to /predict, /invoke, /infer, /generate MUST be rejected", () => {
  assert.equal(isModelEndpoint("https://api.example.com/v1/predict"), true, "/predict must be rejected");
  assert.equal(isModelEndpoint("https://api.example.com/v1/invoke"), true, "/invoke must be rejected");
  assert.equal(isModelEndpoint("https://api.example.com/v1/infer"), true, "/infer must be rejected");
  assert.equal(isModelEndpoint("https://api.example.com/v1/generate"), true, "/generate must be rejected");
  assert.equal(isModelEndpoint("https://api.example.com/v1/completions"), true, "/completions must be rejected");
});

test("F1-REPRO config with Gemini generateContent requestUrl is rejected", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "te-f1-model-endpoint-"));
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
      body: JSON.stringify(validConfig({
        requestUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
      })),
    });
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 400, "Gemini generateContent must be rejected");
    assert.equal(body.error_code, "invalid_config");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 05-供应商API财务端点白名单修复: isFinancialProviderEndpoint / normalizeFinancialPath
// ---------------------------------------------------------------------------

test("isFinancialProviderEndpoint allows balance endpoints", () => {
  assert.equal(isFinancialProviderEndpoint("https://api.openai.com/v1/organization/balance"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.anthropic.com/v1/organizations/balance"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/balance"), true);
});

test("isFinancialProviderEndpoint allows billing endpoints", () => {
  assert.equal(isFinancialProviderEndpoint("https://api.openai.com/dashboard/billing/credit_grants"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.openai.com/v1/billing/subscription"), true);
});

test("isFinancialProviderEndpoint allows costs endpoints", () => {
  assert.equal(isFinancialProviderEndpoint("https://api.openai.com/v1/organization/costs"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.openai.com/v1/organization/cost"), true);
});

test("isFinancialProviderEndpoint allows usage/spend/credit/subscription/invoice/quota/payment endpoints", () => {
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/usage"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/spend"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/spending"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/credit"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/credits"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/subscription"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/subscriptions"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/invoice"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/invoices"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/quota"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/quotas"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/payment"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/payments"), true);
});

// 05 工单必须拒绝的 4 个非财务 endpoint + chat/completions/
test("isFinancialProviderEndpoint rejects realtime/sessions", () => {
  assert.equal(isFinancialProviderEndpoint("https://api.openai.com/v1/realtime/sessions"), false);
});

test("isFinancialProviderEndpoint rejects batches", () => {
  assert.equal(isFinancialProviderEndpoint("https://api.openai.com/v1/batches"), false);
});

test("isFinancialProviderEndpoint rejects countTokens", () => {
  assert.equal(isFinancialProviderEndpoint("https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens"), false);
});

test("isFinancialProviderEndpoint rejects run-agent", () => {
  assert.equal(isFinancialProviderEndpoint("https://example.com/api/run-agent"), false);
});

test("isFinancialProviderEndpoint rejects chat/completions", () => {
  assert.equal(isFinancialProviderEndpoint("https://api.openai.com/v1/chat/completions"), false);
  assert.equal(isFinancialProviderEndpoint("https://api.openai.com/v1/chat/completions/"), false);
});

test("isFinancialProviderEndpoint rejects root path and invalid URLs", () => {
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/"), false);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com"), false);
  assert.equal(isFinancialProviderEndpoint("not-a-url"), false);
  assert.equal(isFinancialProviderEndpoint(""), false);
  assert.equal(isFinancialProviderEndpoint(null), false);
  assert.equal(isFinancialProviderEndpoint(undefined), false);
});

test("isFinancialProviderEndpoint rejects non-financial paths that look similar", () => {
  // `toast` contains `cost` as substring but no separator-bounded match
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/toast"), false);
  // `balanced-report` would match `balanced`? No — regex requires keyword bounded
  // by separators; `balanced` contains `balance` but followed by `d` (not a separator)
  // Actually `balanced` — `balance` is followed by `d` which is not in [/:._-],
  // so it should NOT match. Verify:
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/balanced-report"), false);
  // `costs-report` — `costs` followed by `-` (separator) → matches
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/costs-report"), true);
});

// 05 对抗性审查: 路径规范化必须关闭绕过
test("isFinancialProviderEndpoint is case-insensitive", () => {
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/BALANCE"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/Billing/Credit_Grants"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/REALTIME/SESSIONS"), false);
});

test("isFinancialProviderEndpoint handles trailing slash", () => {
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/balance/"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/balance///"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.openai.com/v1/realtime/sessions/"), false);
});

test("isFinancialProviderEndpoint handles repeated slashes", () => {
  assert.equal(isFinancialProviderEndpoint("https://api.example.com//v1//balance"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.openai.com/v1//batches"), false);
});

test("isFinancialProviderEndpoint ignores query string and fragment", () => {
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/balance?start_date=2024-01-01"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/balance#section"), true);
  assert.equal(isFinancialProviderEndpoint("https://api.openai.com/v1/batches?foo=bar"), false);
});

test("isFinancialProviderEndpoint resolves dot segments via URL parser", () => {
  // URL parser resolves /v1/balance/../realtime/sessions → /v1/realtime/sessions
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/balance/../realtime/sessions"), false);
  // URL parser resolves /v1/realtime/../balance → /v1/balance
  assert.equal(isFinancialProviderEndpoint("https://api.example.com/v1/realtime/../balance"), true);
});

test("normalizeFinancialPath lowercases, collapses slashes, strips trailing slash", () => {
  assert.equal(normalizeFinancialPath("/v1/BALANCE/"), "/v1/balance");
  assert.equal(normalizeFinancialPath("/v1//Balance//"), "/v1/balance");
  assert.equal(normalizeFinancialPath("/v1/./balance"), "/v1/balance");
  assert.equal(normalizeFinancialPath("/v1/../balance"), "/balance");
  assert.equal(normalizeFinancialPath(""), "");
  assert.equal(normalizeFinancialPath(null), "");
});

// ---------------------------------------------------------------------------
// 05-供应商API财务端点白名单修复: validateProviderApiConfig 拒绝非财务 endpoint
// ---------------------------------------------------------------------------

const { validateProviderApiConfig } = require("../src/lib/provider-api-configs");

function financialTestConfig(overrides = {}) {
  return {
    providerId: "probe",
    label: "probe",
    requestMethod: "POST",
    authType: "bearer",
    balancePath: "data.balance",
    refreshIntervalSeconds: 300,
    ...overrides,
  };
}

test("validateProviderApiConfig rejects realtime/sessions with unsupported_endpoint", () => {
  const result = validateProviderApiConfig(financialTestConfig({
    requestUrl: "https://api.openai.com/v1/realtime/sessions",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "unsupported_endpoint");
});

test("validateProviderApiConfig rejects batches with unsupported_endpoint", () => {
  const result = validateProviderApiConfig(financialTestConfig({
    requestUrl: "https://api.openai.com/v1/batches",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "unsupported_endpoint");
});

test("validateProviderApiConfig rejects countTokens with unsupported_endpoint", () => {
  const result = validateProviderApiConfig(financialTestConfig({
    requestUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "unsupported_endpoint");
});

test("validateProviderApiConfig rejects run-agent with unsupported_endpoint", () => {
  const result = validateProviderApiConfig(financialTestConfig({
    requestUrl: "https://example.com/api/run-agent",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "unsupported_endpoint");
});

test("validateProviderApiConfig rejects chat/completions/ with invalid_config (model endpoint)", () => {
  const result = validateProviderApiConfig(financialTestConfig({
    requestUrl: "https://api.openai.com/v1/chat/completions/",
  }));
  assert.equal(result.ok, false);
  // chat/completions 是模型推理端点，先被 isModelEndpoint 拦截，返回 invalid_config
  assert.equal(result.error_code, "invalid_config");
});

test("validateProviderApiConfig accepts legitimate financial endpoints (regression)", () => {
  for (const requestUrl of [
    "https://api.openai.com/v1/organization/costs",
    "https://api.openai.com/dashboard/billing/credit_grants",
    "https://api.anthropic.com/v1/organizations/balance",
    "https://api.example.com/balance",
  ]) {
    const result = validateProviderApiConfig(financialTestConfig({
      requestUrl,
      requestMethod: "GET",
    }));
    assert.equal(result.ok, true, `${requestUrl} should be valid: ${result.error || ""}`);
  }
});

test("validateProviderApiConfig accepts mock-server /balance in testMode", () => {
  const result = validateProviderApiConfig(financialTestConfig({
    requestUrl: "http://127.0.0.1:34567/balance",
    requestMethod: "GET",
  }), { testMode: true });
  assert.equal(result.ok, true, result.error || "");
});

// 05 对抗性审查: POST 到财务 endpoint 仍允许（财务读取适配器），POST 到非财务拒绝
test("validateProviderApiConfig allows POST to financial endpoint", () => {
  const result = validateProviderApiConfig(financialTestConfig({
    requestUrl: "https://api.example.com/v1/billing/usage",
    requestMethod: "POST",
  }));
  assert.equal(result.ok, true, result.error || "");
});

test("validateProviderApiConfig rejects POST to non-financial endpoint", () => {
  const result = validateProviderApiConfig(financialTestConfig({
    requestUrl: "https://api.openai.com/v1/realtime/sessions",
    requestMethod: "POST",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "unsupported_endpoint");
});

// ---------------------------------------------------------------------------
// 05-供应商API财务端点白名单修复: executeFinancialRequest 执行器拒绝
// ---------------------------------------------------------------------------

test("executeFinancialRequest rejects realtime/sessions with unsupported_endpoint", async () => {
  const result = await executeFinancialRequest(
    financialTestConfig({ requestUrl: "https://api.openai.com/v1/realtime/sessions" }),
    "fake-secret",
    { testMode: true },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "unsupported_endpoint");
});

test("executeFinancialRequest rejects batches with unsupported_endpoint", async () => {
  const result = await executeFinancialRequest(
    financialTestConfig({ requestUrl: "https://api.openai.com/v1/batches" }),
    "fake-secret",
    { testMode: true },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "unsupported_endpoint");
});

test("executeFinancialRequest rejects countTokens with unsupported_endpoint", async () => {
  const result = await executeFinancialRequest(
    financialTestConfig({ requestUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens" }),
    "fake-secret",
    { testMode: true },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "unsupported_endpoint");
});

test("executeFinancialRequest rejects run-agent with unsupported_endpoint", async () => {
  const result = await executeFinancialRequest(
    financialTestConfig({ requestUrl: "https://example.com/api/run-agent" }),
    "fake-secret",
    { testMode: true },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "unsupported_endpoint");
});

test("executeFinancialRequest rejects chat/completions/ with invalid_config (model endpoint)", async () => {
  const result = await executeFinancialRequest(
    financialTestConfig({ requestUrl: "https://api.openai.com/v1/chat/completions/" }),
    "fake-secret",
    { testMode: true },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "invalid_config");
});

test("executeFinancialRequest error does not leak the secret", async () => {
  const uniqueSecret = "TE_REPAIR_SECRET_05_executor_no_leak";
  const result = await executeFinancialRequest(
    financialTestConfig({ requestUrl: "https://api.openai.com/v1/realtime/sessions" }),
    uniqueSecret,
    { testMode: true },
  );
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes(uniqueSecret), "executor error must not leak secret");
});

// ---------------------------------------------------------------------------
// 05-供应商API财务端点白名单修复: 集成测试 — local-api 保存配置路径拒绝
// ---------------------------------------------------------------------------

test("saving config with realtime/sessions via local-api is rejected (400)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-05-financial-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });
    const headers = await getAuthHeaders(handler);

    for (const endpoint of [
      "https://api.openai.com/v1/realtime/sessions",
      "https://api.openai.com/v1/batches",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens",
      "https://example.com/api/run-agent",
    ]) {
      const res = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({
          requestUrl: endpoint,
          requestMethod: "POST",
        })),
      });
      const body = readJsonResponse(res);
      assert.equal(res.statusCode, 400, `${endpoint} must be rejected with 400`);
      assert.equal(body.error_code, "unsupported_endpoint", `${endpoint} must return unsupported_endpoint`);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("saving config with chat/completions/ via local-api is rejected as invalid_config", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-05-financial-"));
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
      body: JSON.stringify(validConfig({
        requestUrl: "https://api.openai.com/v1/chat/completions/",
        requestMethod: "POST",
      })),
    });
    const body = readJsonResponse(res);
    assert.equal(res.statusCode, 400);
    assert.equal(body.error_code, "invalid_config");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("saving legitimate financial config via local-api still succeeds (regression)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-05-financial-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore: createTestCredentialStore(),
    });
    const headers = await getAuthHeaders(handler);

    for (const endpoint of [
      "https://api.openai.com/v1/organization/costs",
      "https://api.openai.com/dashboard/billing/credit_grants",
      "https://api.anthropic.com/v1/organizations/balance",
    ]) {
      const res = await call(handler, "/functions/tokentracker-provider-api-configs", {
        method: "POST",
        headers,
        body: JSON.stringify(validConfig({ requestUrl: endpoint })),
      });
      assert.equal(res.statusCode, 200, `${endpoint} should be accepted: ${res.body.toString()}`);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
