const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const {
  detectCustomApi,
  jsonPathGet,
  parseResponseWithMapping,
  parseQuotaValue,
  sanitizeErrorMessage,
  ERROR_CODES,
} = require("../src/lib/token-plan-custom-api");

// ---------------------------------------------------------------------------
// jsonPathGet unit tests
// ---------------------------------------------------------------------------

test("jsonPathGet extracts top-level key", () => {
  const obj = { total: 1000, used: 200, remaining: 800 };
  assert.equal(jsonPathGet(obj, "$.total"), 1000);
  assert.equal(jsonPathGet(obj, "$.used"), 200);
  assert.equal(jsonPathGet(obj, "$.remaining"), 800);
});

test("jsonPathGet extracts nested key", () => {
  const obj = { data: { quota: { total: 5000 } } };
  assert.equal(jsonPathGet(obj, "$.data.quota.total"), 5000);
});

test("jsonPathGet extracts array index", () => {
  const obj = { items: [{ value: 42 }, { value: 99 }] };
  assert.equal(jsonPathGet(obj, "$.items[0].value"), 42);
  assert.equal(jsonPathGet(obj, "$.items[1].value"), 99);
});

test("jsonPathGet returns undefined for missing path", () => {
  const obj = { a: 1 };
  assert.equal(jsonPathGet(obj, "$.b"), undefined);
  assert.equal(jsonPathGet(obj, "$.a.b"), undefined);
});

test("jsonPathGet returns undefined for non-object input", () => {
  assert.equal(jsonPathGet(null, "$.a"), undefined);
  assert.equal(jsonPathGet(undefined, "$.a"), undefined);
  assert.equal(jsonPathGet("string", "$.a"), undefined);
});

test("jsonPathGet returns obj for $ root", () => {
  const obj = { a: 1 };
  assert.deepEqual(jsonPathGet(obj, "$"), obj);
});

// ---------------------------------------------------------------------------
// parseQuotaValue unit tests
// ---------------------------------------------------------------------------

test("parseQuotaValue accepts only finite non-negative JSON numbers without rounding", () => {
  assert.equal(parseQuotaValue(1000), 1000);
  assert.equal(parseQuotaValue(0), 0);
  assert.equal(parseQuotaValue(3.14), 3.14);
});

test("parseQuotaValue returns null for invalid values", () => {
  assert.equal(parseQuotaValue(undefined), null);
  assert.equal(parseQuotaValue(null), null);
  assert.equal(parseQuotaValue(""), null);
  assert.equal(parseQuotaValue("2000"), null);
  assert.equal(parseQuotaValue("abc"), null);
  assert.equal(parseQuotaValue(-1), null);
  assert.equal(parseQuotaValue(Number.POSITIVE_INFINITY), null);
});

// ---------------------------------------------------------------------------
// parseResponseWithMapping unit tests
// ---------------------------------------------------------------------------

test("parseResponseWithMapping extracts all fields from valid JSON", () => {
  const data = { total: 11000000000, used: 3200000000, remaining: 7800000000, expires_at: "2026-07-25" };
  const mapping = {
    total_quota_path: "$.total",
    used_quota_path: "$.used",
    remaining_quota_path: "$.remaining",
    expires_at_path: "$.expires_at",
  };
  const result = parseResponseWithMapping(data, mapping, "json_path");
  assert.equal(result.error, null);
  assert.equal(result.total_quota, 11000000000);
  assert.equal(result.used_quota, 3200000000);
  assert.equal(result.remaining_quota, 7800000000);
  assert.equal(result.expires_at, "2026-07-25");
});

test("parseResponseWithMapping works with nested paths", () => {
  const data = { quota_info: { total_tokens: 5000, used_tokens: 1000 } };
  const mapping = {
    total_quota_path: "$.quota_info.total_tokens",
    used_quota_path: "$.quota_info.used_tokens",
    remaining_quota_path: "",
    expires_at_path: "",
  };
  const result = parseResponseWithMapping(data, mapping, "json_path");
  assert.equal(result.error, null);
  assert.equal(result.total_quota, 5000);
  assert.equal(result.used_quota, 1000);
});

test("parseResponseWithMapping returns error when both total and remaining paths are empty", () => {
  const data = { a: 1 };
  const mapping = { total_quota_path: "", used_quota_path: "", remaining_quota_path: "", expires_at_path: "" };
  const result = parseResponseWithMapping(data, mapping, "json_path");
  assert.ok(result.error);
  assert.equal(result.errorCode, ERROR_CODES.CUSTOM_API_MAPPING_MISSING);
});

test("parseResponseWithMapping returns error when mapped values are not numeric", () => {
  const data = { total: "not-a-number" };
  const mapping = { total_quota_path: "$.total", used_quota_path: "", remaining_quota_path: "", expires_at_path: "" };
  const result = parseResponseWithMapping(data, mapping, "json_path");
  assert.ok(result.error);
  assert.equal(result.errorCode, ERROR_CODES.PROVIDER_SNAPSHOT_INVALID);
  assert.equal(result.error.includes("not-a-number"), false);
});

// ---------------------------------------------------------------------------
// sanitizeErrorMessage unit tests
// ---------------------------------------------------------------------------

test("sanitizeErrorMessage redacts Bearer tokens", () => {
  const msg = "Error: Authorization: Bearer sk-abc123def456ghi789";
  const sanitized = sanitizeErrorMessage(msg);
  assert.ok(!sanitized.includes("sk-abc123def456ghi789"));
  assert.ok(sanitized.includes("***"));
});

test("sanitizeErrorMessage redacts api_key in query params", () => {
  const msg = "GET https://api.example.com?api_key=secret123 failed";
  const sanitized = sanitizeErrorMessage(msg);
  assert.ok(!sanitized.includes("secret123"));
});

test("sanitizeErrorMessage handles non-string input", () => {
  assert.equal(sanitizeErrorMessage(null), "null");
  assert.equal(sanitizeErrorMessage(undefined), "undefined");
});

// ---------------------------------------------------------------------------
// detectCustomApi integration tests (with local HTTP server)
// ---------------------------------------------------------------------------

function startTestServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function createInjectedRequest(responseFactory, calls = []) {
  return (options, callback) => {
    const req = new EventEmitter();
    req.destroyed = false;
    req.destroy = () => {
      req.destroyed = true;
    };
    req.end = () => {
      queueMicrotask(() => {
        calls.push(options);
        const spec = responseFactory(options, req);
        const response = Readable.from(spec.chunks || []);
        response.statusCode = spec.statusCode ?? 200;
        response.headers = spec.headers || { "content-type": "application/json" };
        callback(response);
      });
    };
    return req;
  };
}

function secureCustomConfig(requestUrl) {
  return {
    api_key_ref: "token-plan/test/custom-api/synthetic-task5",
    api_format: "json_path",
    request_url: requestUrl,
    method: "GET",
    response_mapping: {
      total_quota_path: "$.total",
      used_quota_path: "",
      remaining_quota_path: "$.remaining",
      expires_at_path: "",
    },
  };
}

test("custom API production rejects HTTP, FTP, URL credentials, and secret query before request", async () => {
  for (const requestUrl of [
    "http://127.0.0.1:1/quota",
    "ftp://127.0.0.1:1/quota",
    "https://user:pass@127.0.0.1:1/quota",
    "https://127.0.0.1:1/quota?api_key=SYNTHETIC_QUERY_SECRET",
  ]) {
    let requestCalls = 0;
    const result = await detectCustomApi(secureCustomConfig(requestUrl), {
      apiKey: "SYNTHETIC_TASK5_CUSTOM_SECRET",
      dnsLookup(_hostname, _options, callback) {
        callback(null, [{ address: "93.184.216.34", family: 4 }]);
      },
      requestImpl() {
        requestCalls += 1;
        throw new Error("request must not be sent");
      },
    });
    assert.equal(result.sync_status, "failed", requestUrl);
    assert.equal(result.last_error_code, ERROR_CODES.CUSTOM_API_CONFIG_INVALID, requestUrl);
    assert.equal(requestCalls, 0, requestUrl);
  }
});

test("custom API production resolves once and sends through pinned hostname/SNI options", async () => {
  let resolverCalls = 0;
  const requestCalls = [];
  const result = await detectCustomApi(secureCustomConfig("https://quota.invalid/v1/quota"), {
    apiKey: "SYNTHETIC_TASK5_CUSTOM_BEARER",
    dnsLookup(hostname, options, callback) {
      resolverCalls += 1;
      assert.equal(hostname, "quota.invalid");
      assert.deepEqual(options, { all: true, verbatim: true });
      callback(null, [{ address: "93.184.216.34", family: 4 }]);
    },
    requestImpl: createInjectedRequest(() => ({
      chunks: [Buffer.from('{"total":100,"remaining":80}')],
    }), requestCalls),
  });
  assert.equal(result.sync_status, "success");
  assert.equal(resolverCalls, 1);
  assert.equal(requestCalls.length, 1);
  assert.equal(requestCalls[0].hostname, "quota.invalid");
  assert.equal(requestCalls[0].servername, "quota.invalid");
  const pinned = await new Promise((resolve, reject) => {
    requestCalls[0].lookup("quota.invalid", { family: 4 }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(pinned, { address: "93.184.216.34", family: 4 });
});

test("custom API rejects every 3xx response without making a second request", async () => {
  for (let statusCode = 300; statusCode <= 399; statusCode += 1) {
    const requestCalls = [];
    const result = await detectCustomApi(secureCustomConfig("https://quota.invalid/v1/quota"), {
      apiKey: "SYNTHETIC_TASK5_REDIRECT_BEARER",
      dnsLookup(_hostname, _options, callback) {
        callback(null, [{ address: "93.184.216.34", family: 4 }]);
      },
      requestImpl: createInjectedRequest(() => ({
        statusCode,
        headers: { location: "https://attacker.invalid/collect" },
        chunks: [],
      }), requestCalls),
    });
    assert.equal(result.sync_status, "failed", `HTTP ${statusCode}`);
    assert.equal(result.last_error_code, ERROR_CODES.CUSTOM_API_REQUEST_FAILED, `HTTP ${statusCode}`);
    assert.equal(requestCalls.length, 1, `HTTP ${statusCode}`);
  }
});

test("custom API 302 never sends Authorization to the Location service", async () => {
  let secondRequests = 0;
  let firstAuthorization = "";
  const second = await startTestServer((_req, res) => {
    secondRequests += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"total":1,"remaining":1}');
  });
  const first = await startTestServer((req, res) => {
    firstAuthorization = String(req.headers.authorization || "");
    res.writeHead(302, { location: `${second.url}/collect` });
    res.end();
  });
  try {
    const result = await detectCustomApi(secureCustomConfig(`${first.url}/quota`), {
      apiKey: "SYNTHETIC_TASK5_NO_REDIRECT_SECRET",
      testMode: true,
    });
    assert.equal(result.sync_status, "failed");
    assert.equal(firstAuthorization, "Bearer SYNTHETIC_TASK5_NO_REDIRECT_SECRET");
    assert.equal(secondRequests, 0);
  } finally {
    first.server.close();
    second.server.close();
  }
});

test("custom API 1 MiB Content-Length and stream overflow destroy the request", async () => {
  for (const responseFactory of [
    (_options, req) => ({
      req,
      headers: {
        "content-type": "application/json",
        "content-length": String((1024 * 1024) + 1),
      },
      chunks: [],
    }),
    (_options, req) => ({
      req,
      headers: { "content-type": "application/json" },
      chunks: [Buffer.alloc(700 * 1024), Buffer.alloc((324 * 1024) + 1)],
    }),
  ]) {
    let requestRef;
    const requestCalls = [];
    const result = await detectCustomApi(secureCustomConfig("https://quota.invalid/v1/quota"), {
      apiKey: "SYNTHETIC_TASK5_SIZE_SECRET",
      dnsLookup(_hostname, _options, callback) {
        callback(null, [{ address: "93.184.216.34", family: 4 }]);
      },
      requestImpl: createInjectedRequest((options, req) => {
        requestRef = req;
        return responseFactory(options, req);
      }, requestCalls),
    });
    assert.equal(result.sync_status, "failed");
    assert.equal(result.last_error_code, ERROR_CODES.CUSTOM_API_REQUEST_FAILED);
    assert.equal(requestRef.destroyed, true);
    assert.equal(requestCalls.length, 1);
  }
});

test("custom API exact synthetic secret is redacted from injected network errors", async () => {
  const secret = "SYNTHETIC.custom+$secret[task5]";
  const result = await detectCustomApi(secureCustomConfig("https://quota.invalid/v1/quota"), {
    apiKey: secret,
    dnsLookup(_hostname, _options, callback) {
      callback(null, [{ address: "93.184.216.34", family: 4 }]);
    },
    requestImpl() {
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = () => queueMicrotask(() => req.emit("error", new Error(`synthetic failure ${secret}`)));
      return req;
    },
  });
  assert.equal(result.sync_status, "failed");
  assert.equal(result.last_error_message.includes(secret), false);
  assert.equal(result.last_error_message.includes("***"), true);
});

test("detectCustomApi successfully parses a valid JSON response", async () => {
  const { server, url } = await startTestServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      total: 11000000000,
      used: 3200000000,
      remaining: 7800000000,
      expires_at: "2026-07-25",
    }));
  });

  try {
    const config = {
      api_key_ref: "token-plan/xiaomi_mimo/custom-api/2e2c7f3d-7b9f-4c92-b2d2-c6e9f4a8c320",
      api_format: "json_path",
      request_url: `${url}/quota`,
      method: "GET",
      response_mapping: {
        total_quota_path: "$.total",
        used_quota_path: "$.used",
        remaining_quota_path: "$.remaining",
        expires_at_path: "$.expires_at",
      },
    };

    const result = await detectCustomApi(config, { apiKey: "test-key-12345", testMode: true });
    assert.equal(result.sync_status, "success");
    assert.equal(result.total_quota, 11000000000);
    assert.equal(result.used_quota, 3200000000);
    assert.equal(result.remaining_quota, 7800000000);
    assert.equal(result.expires_at, "2026-07-25");
    assert.equal(result.last_error_code, "");
    assert.equal(result.last_error_message, "");
    assert.ok(result.provider_reported_at);
  } finally {
    server.close();
  }
});

test("detectCustomApi returns CUSTOM_API_MAPPING_MISSING when mapping is missing", async () => {
  const { server, url } = await startTestServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ total: 1000 }));
  });

  try {
    const config = {
      api_key_ref: "token-plan/xiaomi_mimo/custom-api/test-uuid",
      api_format: "json_path",
      request_url: `${url}/quota`,
      method: "GET",
      response_mapping: {
        total_quota_path: "",  // missing mapping
        used_quota_path: "",
        remaining_quota_path: "",
        expires_at_path: "",
      },
    };

    const result = await detectCustomApi(config, { apiKey: "test-key", testMode: true });
    assert.equal(result.sync_status, "failed");
    assert.equal(result.last_error_code, ERROR_CODES.CUSTOM_API_MAPPING_MISSING);
    assert.ok(result.last_error_message.includes("映射缺失") || result.last_error_message.includes("需要至少配置"));
    assert.equal(result.total_quota, null);
    assert.equal(result.used_quota, null);
    assert.equal(result.remaining_quota, null);
  } finally {
    server.close();
  }
});

test("detectCustomApi maps 401 to reauth_required and does NOT leak API Key", async () => {
  const { server, url } = await startTestServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
  });

  try {
    const secretKey = "do-not-leak-this-api-key-value";
    const config = {
      api_key_ref: "token-plan/xiaomi_mimo/custom-api/test-uuid",
      api_format: "json_path",
      request_url: `${url}/quota`,
      method: "GET",
      response_mapping: {
        total_quota_path: "$.total",
        used_quota_path: "$.used",
        remaining_quota_path: "$.remaining",
        expires_at_path: "$.expires_at",
      },
    };

    const result = await detectCustomApi(config, { apiKey: secretKey, testMode: true });
    assert.equal(result.sync_status, "reauth_required");
    assert.equal(result.last_error_code, ERROR_CODES.CUSTOM_API_AUTH_EXPIRED);
    assert.ok(result.last_error_message.includes("401"));
    // API Key must NOT be in the error message
    assert.ok(!result.last_error_message.includes(secretKey));
    assert.ok(!result.last_error_message.includes("do-not-leak"));
  } finally {
    server.close();
  }
});

test("detectCustomApi maps 403 to reauth_required with safe error message", async () => {
  const { server, url } = await startTestServer((req, res) => {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden" }));
  });

  try {
    const config = {
      api_key_ref: "token-plan/xiaomi_mimo/custom-api/test-uuid",
      api_format: "json_path",
      request_url: `${url}/quota`,
      method: "GET",
      response_mapping: {
        total_quota_path: "$.total",
        used_quota_path: "$.used",
        remaining_quota_path: "$.remaining",
        expires_at_path: "$.expires_at",
      },
    };

    const result = await detectCustomApi(config, { apiKey: "test-key", testMode: true });
    assert.equal(result.sync_status, "reauth_required");
    assert.equal(result.last_error_code, ERROR_CODES.CUSTOM_API_AUTH_EXPIRED);
    assert.ok(result.last_error_message.includes("403"));
    assert.ok(result.last_error_message.includes("更新 API Key"));
  } finally {
    server.close();
  }
});

test("detectCustomApi returns failed for network errors", async () => {
  const config = {
    api_key_ref: "token-plan/xiaomi_mimo/custom-api/test-uuid",
    api_format: "json_path",
    request_url: "http://127.0.0.1:19999/nonexistent",
    method: "GET",
    response_mapping: {
      total_quota_path: "$.total",
      used_quota_path: "$.used",
      remaining_quota_path: "$.remaining",
      expires_at_path: "$.expires_at",
    },
  };

  const result = await detectCustomApi(config, { apiKey: "test-key", testMode: true });
  assert.equal(result.sync_status, "failed");
  assert.equal(result.last_error_code, ERROR_CODES.CUSTOM_API_REQUEST_FAILED);
  assert.ok(result.last_error_message);
});

test("detectCustomApi returns failed when apiKey is empty", async () => {
  const config = {
    api_key_ref: "token-plan/xiaomi_mimo/custom-api/test-uuid",
    api_format: "json_path",
    request_url: "https://example.com/quota",
    method: "GET",
    response_mapping: {
      total_quota_path: "$.total",
      used_quota_path: "$.used",
      remaining_quota_path: "$.remaining",
      expires_at_path: "$.expires_at",
    },
  };

  const result = await detectCustomApi(config, { apiKey: "" });
  assert.equal(result.sync_status, "failed");
  assert.equal(result.last_error_code, ERROR_CODES.CUSTOM_API_CONFIG_INVALID);
  assert.ok(result.last_error_message.includes("密钥"));
});

test("detectCustomApi returns failed for invalid config", async () => {
  const result = await detectCustomApi(null, { apiKey: "test" });
  assert.equal(result.sync_status, "failed");
  assert.equal(result.last_error_code, ERROR_CODES.CUSTOM_API_CONFIG_INVALID);
});

test("detectCustomApi returns failed for unsupported api_format", async () => {
  const config = {
    api_key_ref: "token-plan/xiaomi_mimo/custom-api/test-uuid",
    api_format: "unsupported_format",
    request_url: "https://example.com/quota",
    method: "GET",
    response_mapping: {},
  };

  const result = await detectCustomApi(config, { apiKey: "test" });
  assert.equal(result.sync_status, "failed");
  assert.equal(result.last_error_code, ERROR_CODES.CUSTOM_API_CONFIG_INVALID);
  assert.ok(result.last_error_message.includes("unsupported_format"));
});

test("detectCustomApi returns failed for empty request_url", async () => {
  const config = {
    api_key_ref: "token-plan/xiaomi_mimo/custom-api/test-uuid",
    api_format: "json_path",
    request_url: "",
    method: "GET",
    response_mapping: {},
  };

  const result = await detectCustomApi(config, { apiKey: "test" });
  assert.equal(result.sync_status, "failed");
  assert.equal(result.last_error_code, ERROR_CODES.CUSTOM_API_CONFIG_INVALID);
  assert.ok(result.last_error_message.includes("请求地址"));
});
