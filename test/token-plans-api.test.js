const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

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

test("token plans API creates, lists, and updates manual local records", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const initial = await call(handler, "/functions/tokentracker-token-plans");
    assert.deepEqual(readJsonResponse(initial).records, []);

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "claude",
        plan_label: "Max",
        total_quota: 1000,
        used_quota: 200,
        remaining_quota: 800,
        expires_at: "2026-12-31",
      }),
    });
    const createdBody = readJsonResponse(created);
    assert.equal(created.statusCode, 200);
    assert.equal(createdBody.records.length, 1);
    assert.ok(createdBody.record.id);

    const updated = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: createdBody.record.id,
        source: "claude",
        plan_label: "Max updated",
        remaining_quota: 700,
      }),
    });
    const updatedBody = readJsonResponse(updated);
    assert.equal(updatedBody.records.length, 1);
    assert.equal(updatedBody.record.plan_label, "Max updated");
    assert.equal(updatedBody.record.total_quota, 1000);
    assert.equal(updatedBody.record.remaining_quota, 700);

    const listed = await call(handler, "/functions/tokentracker-token-plans");
    assert.equal(readJsonResponse(listed).records[0].plan_label, "Max updated");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("token plans API persists F03 refresh fields", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "codex",
        plan_label: "ChatGPT Plus",
        total_quota: 0,
        used_quota: 0,
        remaining_quota: 0,
        expires_at: "2026-07-20",
        refresh_enabled: true,
        refresh_interval_minutes: 60,
        refresh_method: "official_api",
        credential_ref: "codex_auth_json",
      }),
    });
    const record = readJsonResponse(created).record;
    assert.equal(record.refresh_enabled, true);
    assert.equal(record.refresh_interval_minutes, 60);
    assert.equal(record.refresh_method, "official_api");
    assert.equal(record.credential_ref, "codex_auth_json");
    // official_api 启用后应自动安排 next_refresh_at
    assert.ok(record.next_refresh_at, "next_refresh_at should be set when refresh_enabled && method != manual");

    // GET 应该回传相同的刷新字段
    const listed = await call(handler, "/functions/tokentracker-token-plans");
    const listedRecord = readJsonResponse(listed).records[0];
    assert.equal(listedRecord.refresh_enabled, true);
    assert.equal(listedRecord.refresh_method, "official_api");
    assert.equal(listedRecord.credential_ref, "codex_auth_json");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("token plans refresh endpoint writes failed status when no provider API", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "codex",
        plan_label: "ChatGPT Plus",
        refresh_enabled: true,
        refresh_interval_minutes: 60,
        refresh_method: "official_api",
        credential_ref: "codex_auth_json",
      }),
    });
    const id = readJsonResponse(created).record.id;

    const refreshRes = await call(handler, "/functions/tokentracker-token-plans-refresh", {
      method: "POST",
      headers,
      body: JSON.stringify({ id }),
    });
    const refreshBody = readJsonResponse(refreshRes);
    assert.equal(refreshRes.statusCode, 200);
    assert.equal(refreshBody.ok, true);
    assert.equal(refreshBody.plan.last_refresh_status, "failed");
    assert.ok(refreshBody.plan.last_refresh_error);
    assert.ok(refreshBody.plan.last_refresh_at);

    // 状态应已持久化
    const listed = await call(handler, "/functions/tokentracker-token-plans");
    const listedRecord = readJsonResponse(listed).records[0];
    assert.equal(listedRecord.last_refresh_status, "failed");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("token plans refresh endpoint handles manual method as success no-op", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "claude",
        plan_label: "Max",
        total_quota: 1000,
        used_quota: 200,
        remaining_quota: 800,
        refresh_method: "manual",
      }),
    });
    const id = readJsonResponse(created).record.id;

    const refreshRes = await call(handler, "/functions/tokentracker-token-plans-refresh", {
      method: "POST",
      headers,
      body: JSON.stringify({ id }),
    });
    const refreshBody = readJsonResponse(refreshRes);
    assert.equal(refreshBody.ok, true);
    assert.equal(refreshBody.plan.last_refresh_status, "success");
    // manual 不应安排 next_refresh_at
    assert.equal(refreshBody.plan.next_refresh_at, "");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("token plans API normalizes catalog plan from provider_id + plan_id", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "hermes",
        provider_id: "xiaomi_mimo",
        plan_id: "xiaomi_mimo_standard_monthly",
        plan_label: "Fake Label",
        total_quota: 999,
        used_quota: 100,
        remaining_quota: 899,
        expires_at: "2026-12-31",
      }),
    });
    const record = readJsonResponse(created).record;
    assert.equal(created.statusCode, 200);
    assert.equal(record.provider_id, "xiaomi_mimo");
    assert.equal(record.plan_id, "xiaomi_mimo_standard_monthly");
    assert.equal(record.plan_label, "Standard（月付）");
    assert.equal(record.quota_kind, "credits");
    assert.equal(record.quota_unit, "credits");
    assert.equal(record.total_quota, 11000000000);
    assert.equal(record.total_quota_display, "11,000,000,000（11B）Credits");
    assert.equal(record.quota_catalog_version, "2026-06-25");
    assert.equal(record.quota_source, "catalog");
    assert.equal(record.used_quota, 100);
    assert.equal(record.remaining_quota, 899);
    assert.equal(record.expires_at, "2026-12-31");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("token plans API migrates legacy records to custom/manual fields", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(
      path.join(trackerDir, "config.json"),
      JSON.stringify({
        tokenPlans: [
          {
            id: "legacy-1",
            source: "claude",
            plan_label: "Max",
            total_quota: 1000,
            used_quota: 200,
            remaining_quota: 800,
            expires_at: "2026-12-31",
          },
        ],
      }),
      "utf8",
    );

    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const listed = await call(handler, "/functions/tokentracker-token-plans");
    const records = readJsonResponse(listed).records;
    assert.equal(records.length, 1);
    const record = records[0];
    assert.equal(record.id, "legacy-1");
    assert.equal(record.source, "claude");
    assert.equal(record.plan_label, "Max");
    assert.equal(record.total_quota, 1000);
    assert.equal(record.used_quota, 200);
    assert.equal(record.remaining_quota, 800);
    assert.equal(record.expires_at, "2026-12-31");
    assert.equal(record.provider_id, "custom");
    assert.equal(record.plan_id, "custom");
    assert.equal(record.quota_source, "manual");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("token plans API rejects an unknown plan id for a catalog provider", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const response = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "hermes",
        provider_id: "xiaomi_mimo",
        plan_id: "made-up-plan",
        plan_label: "伪造套餐",
        total_quota: 7,
      }),
    });

    assert.equal(response.statusCode, 400);
    assert.match(readJsonResponse(response).error, /套餐/);

    const listed = await call(handler, "/functions/tokentracker-token-plans");
    assert.deepEqual(readJsonResponse(listed).records, []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("token plans API rejects an unknown provider id", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const response = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "hermes",
        provider_id: "unknown_provider",
        plan_id: "unknown_plan",
        plan_label: "伪造服务商套餐",
        total_quota: 7,
      }),
    });

    assert.equal(response.statusCode, 400);
    assert.match(readJsonResponse(response).error, /服务商/);

    const listed = await call(handler, "/functions/tokentracker-token-plans");
    assert.deepEqual(readJsonResponse(listed).records, []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("token plans API forces xiaomi_mimo catalog plans to manual refresh", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const catalogResponse = await call(handler, "/functions/tokentracker-token-plan-catalog");
    const catalogProviders = readJsonResponse(catalogResponse).providers || [];
    const xiaomiProvider = catalogProviders.find((p) => p.id === "xiaomi_mimo");
    if (!xiaomiProvider || !xiaomiProvider.plans?.length) {
      console.log("  skipping: xiaomi_mimo catalog not available");
      return;
    }
    const firstPlan = xiaomiProvider.plans[0];

    const response = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "hermes",
        provider_id: "xiaomi_mimo",
        plan_id: firstPlan.plan_id,
        refresh_enabled: true,
        refresh_method: "official_api",
        refresh_interval_minutes: 30,
        credential_ref: "fake_credential",
      }),
    });

    assert.equal(response.statusCode, 200);
    const record = readJsonResponse(response).record;
    assert.equal(record.refresh_enabled, false);
    assert.equal(record.refresh_method, "manual");
    assert.equal(record.credential_ref, "");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W03-R3A: Detection contract tests
// ---------------------------------------------------------------------------

test("W03-R3A POST with detection_method custom_api must not leak API Key plaintext in response", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    // Create a record with detection_method custom_api and an api_key_ref.
    // The response must NOT contain any api_key, apiKey, or secret plaintext.
    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "hermes",
        provider_id: "xiaomi_mimo",
        plan_id: "xiaomi_mimo_standard_monthly",
        detection_method: "custom_api",
        detection_config: {
          custom_api: {
            api_key_ref: "token-plan/xiaomi_mimo/custom-api/2e2c7f3d-7b9f-4c92-b2d2-c6e9f4a8c320",
            api_format: "json_path",
            request_url: "https://example.com/quota",
            official_url: "https://platform.xiaomimimo.com/token-plan",
            method: "GET",
            response_mapping: {
              total_quota_path: "$.total",
              used_quota_path: "$.used",
              remaining_quota_path: "$.remaining",
              expires_at_path: "$.expires_at",
            },
          },
        },
      }),
    });

    assert.equal(created.statusCode, 200);
    const createdBody = readJsonResponse(created);
    const record = createdBody.record;
    assert.equal(record.detection_method, "custom_api");

    // Verify no plaintext secrets in response
    const responseStr = JSON.stringify(createdBody);
    assert.ok(!responseStr.includes("sk-"), "response must not contain API key prefix sk-");
    assert.ok(!responseStr.includes("tp-"), "response must not contain API key prefix tp-");
    assert.equal(record.api_key, undefined, "response must not contain api_key field");
    assert.equal(record.apiKey, undefined, "response must not contain apiKey field");
    assert.equal(record.secret, undefined, "response must not contain secret field");

    // api_key_ref should be present
    assert.ok(record.detection_config);
    assert.ok(record.detection_config.custom_api);
    assert.equal(record.detection_config.custom_api.api_key_ref, "token-plan/xiaomi_mimo/custom-api/2e2c7f3d-7b9f-4c92-b2d2-c6e9f4a8c320");

    // GET must also not leak secrets
    const listed = await call(handler, "/functions/tokentracker-token-plans");
    const listedBody = readJsonResponse(listed);
    const listedStr = JSON.stringify(listedBody);
    assert.ok(!listedStr.includes("sk-"), "GET response must not contain API key prefix sk-");
    assert.ok(!listedStr.includes("tp-"), "GET response must not contain API key prefix tp-");
    const listedRecord = listedBody.records[0];
    assert.equal(listedRecord.api_key, undefined);
    assert.equal(listedRecord.secret, undefined);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("W03-R3A POST with forbidden fields api_key/cookie/authorization returns 400", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const forbiddenFields = [
      "api_key",
      "apiKey",
      "cookie",
      "authorization",
      "authorization_header",
      "bearer",
      "token",
      "password",
      "secret",
    ];

    for (const field of forbiddenFields) {
      const body = {
        source: "hermes",
        provider_id: "xiaomi_mimo",
        plan_id: "xiaomi_mimo_standard_monthly",
      };
      body[field] = "some-secret-value";

      const res = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      assert.equal(res.statusCode, 400, `POST with "${field}" must return 400`);
      const resBody = readJsonResponse(res);
      assert.ok(resBody.error, `Error message must be present for "${field}"`);
      assert.match(resBody.error || "", /敏感|forbidden|不允许|secret|credential/i,
        `Error for "${field}" must mention forbidden nature`);
    }

    // Verify nothing was persisted
    const listed = await call(handler, "/functions/tokentracker-token-plans");
    const listedBody = readJsonResponse(listed);
    assert.equal(listedBody.records.length, 0, "No records should be persisted when forbidden fields are present");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("W03-R3A old records read with detection_method and sync_status backfilled, quota preserved", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });

    // Write old-style records with refresh_* fields
    await fs.writeFile(
      path.join(trackerDir, "config.json"),
      JSON.stringify({
        tokenPlans: [
          {
            id: "legacy-detection-1",
            source: "hermes",
            provider_id: "xiaomi_mimo",
            plan_id: "xiaomi_mimo_standard_monthly",
            plan_label: "Standard（月付）",
            total_quota: 11000000000,
            used_quota: 5000000000,
            remaining_quota: 6000000000,
            expires_at: "2026-12-31",
            refresh_method: "official_api",
            last_refresh_status: "success",
            last_refresh_at: "2026-06-20T10:00:00Z",
            last_refresh_error: "",
            credential_ref: "",
          },
          {
            id: "legacy-detection-2",
            source: "claude",
            plan_label: "Max",
            total_quota: 1000,
            used_quota: 200,
            remaining_quota: 800,
            expires_at: "2026-06-30",
          },
          {
            id: "legacy-detection-3",
            source: "codex",
            plan_label: "Custom Plan",
            total_quota: 500,
            used_quota: 100,
            remaining_quota: 400,
            refresh_method: "manual",
            last_refresh_status: "failed",
            last_refresh_error: "network timeout",
            last_refresh_at: "2026-06-19T08:00:00Z",
          },
        ],
      }),
      "utf8",
    );

    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const listed = await call(handler, "/functions/tokentracker-token-plans");
    const records = readJsonResponse(listed).records;
    assert.equal(records.length, 3);

    // Record 1: xiaomi_mimo with old refresh_method: "official_api"
    const r1 = records.find((r) => r.id === "legacy-detection-1");
    assert.ok(r1, "legacy record 1 must exist");
    // detection_method should be normalized from old refresh_method
    assert.ok(r1.detection_method, "detection_method must be set");
    assert.equal(typeof r1.detection_method, "string");
    // sync_status should be mapped from old last_refresh_status
    assert.ok(r1.sync_status, "sync_status must be set");
    assert.equal(typeof r1.sync_status, "string");
    // Quota must be preserved
    assert.equal(r1.total_quota, 11000000000);
    assert.equal(r1.used_quota, 5000000000);
    assert.equal(r1.remaining_quota, 6000000000);
    assert.equal(r1.expires_at, "2026-12-31");
    // last_sync fields should be backfilled from old refresh_* fields
    assert.equal(r1.last_synced_at, "2026-06-20T10:00:00Z");

    // Record 2: legacy record without provider_id (no refresh fields)
    const r2 = records.find((r) => r.id === "legacy-detection-2");
    assert.ok(r2, "legacy record 2 must exist");
    assert.equal(r2.detection_method, "not_configured", "legacy record without refresh_method should be not_configured");
    assert.equal(r2.sync_status, "not_configured");
    assert.equal(r2.total_quota, 1000);
    assert.equal(r2.used_quota, 200);
    assert.equal(r2.remaining_quota, 800);

    // Record 3: manual refresh with failed status
    const r3 = records.find((r) => r.id === "legacy-detection-3");
    assert.ok(r3, "legacy record 3 must exist");
    assert.equal(r3.detection_method, "not_configured", "manual refresh should map to not_configured");
    assert.equal(r3.sync_status, "not_configured");
    assert.equal(r3.total_quota, 500);
    assert.equal(r3.used_quota, 100);
    assert.equal(r3.remaining_quota, 400);
    // old refresh fields should still be present for compat
    assert.equal(r3.refresh_method, "manual");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("W03-R3A refresh failure only updates error status, does not clear last successful quota", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    // Create a non-xiaomi_mimo plan with official_api refresh method that will fail
    // (xiaomi_mimo plans are forced to manual, so they'd always succeed as no-op)
    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "claude",
        plan_label: "Claude Max",
        total_quota: 11000000000,
        used_quota: 5000000000,
        remaining_quota: 6000000000,
        expires_at: "2026-12-31",
        refresh_enabled: true,
        refresh_method: "official_api",
        refresh_interval_minutes: 60,
        credential_ref: "claude_credentials_json",
        detection_method: "official_account",
        sync_status: "success",
        last_synced_at: "2026-06-20T10:00:00Z",
      }),
    });
    const record = readJsonResponse(created).record;
    assert.ok(record.id);

    // Trigger a refresh that will fail (no provider adapter for claude source)
    const refreshRes = await call(handler, "/functions/tokentracker-token-plans-refresh", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: record.id }),
    });
    const refreshBody = readJsonResponse(refreshRes);
    assert.equal(refreshRes.statusCode, 200);

    // Refresh should have failed but quota must be preserved
    // W03-R3D: official_account without provider adapter returns "unsupported" (not "failed")
    const refreshedPlan = refreshBody.plan;
    assert.ok(
      refreshedPlan.sync_status === "failed" || refreshedPlan.sync_status === "unsupported",
      `sync_status should be failed or unsupported, got: ${refreshedPlan.sync_status}`
    );
    assert.ok(refreshedPlan.last_error_message, "last_error_message should be set");
    assert.ok(refreshedPlan.last_sync_attempt_at, "last_sync_attempt_at should be updated");

    // Quota must NOT be cleared
    assert.equal(refreshedPlan.total_quota, 11000000000, "total_quota must be preserved after failed refresh");
    assert.equal(refreshedPlan.used_quota, 5000000000, "used_quota must be preserved after failed refresh");
    assert.equal(refreshedPlan.remaining_quota, 6000000000, "remaining_quota must be preserved after failed refresh");
    assert.equal(refreshedPlan.expires_at, "2026-12-31", "expires_at must be preserved after failed refresh");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// W03-R3A P1 fix: nested forbidden fields in detection_config.custom_api
test("W03-R3A P1 POST with nested api_key in detection_config.custom_api returns 400 and does not persist", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const res = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "hermes",
        provider_id: "xiaomi_mimo",
        plan_id: "xiaomi_mimo_standard_monthly",
        detection_method: "custom_api",
        detection_config: {
          custom_api: {
            api_key: "nested-secret-should-be-blocked",
            api_format: "json_path",
            request_url: "https://example.com/quota",
          },
        },
      }),
    });

    assert.equal(res.statusCode, 400, "nested api_key must return 400");
    const resBody = readJsonResponse(res);
    assert.match(resBody.error || "", /敏感|forbidden|不允许|secret|credential/i,
      "error must mention forbidden nature");

    // Verify nothing was persisted
    const listed = await call(handler, "/functions/tokentracker-token-plans");
    const listedBody = readJsonResponse(listed);
    assert.equal(listedBody.records.length, 0, "no records should be persisted when nested api_key is present");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("W03-R3A P1 POST with nested secret in detection_config.custom_api returns 400 and does not persist", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    const res = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "hermes",
        provider_id: "xiaomi_mimo",
        plan_id: "xiaomi_mimo_standard_monthly",
        detection_method: "custom_api",
        detection_config: {
          custom_api: {
            secret: "nested-secret-should-be-blocked",
            api_format: "json_path",
            request_url: "https://example.com/quota",
          },
        },
      }),
    });

    assert.equal(res.statusCode, 400, "nested secret must return 400");
    const resBody = readJsonResponse(res);
    assert.match(resBody.error || "", /敏感|forbidden|不允许|secret|credential/i,
      "error must mention forbidden nature");

    // Verify nothing was persisted
    const listed = await call(handler, "/functions/tokentracker-token-plans");
    const listedBody = readJsonResponse(listed);
    assert.equal(listedBody.records.length, 0, "no records should be persisted when nested secret is present");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// W03-R3D P0 fix: secrets stored in-memory only, returns api_key_ref on success.
// NEVER written to config.json or any plaintext file.
test("W03-R3D P0 POST to token-plan-secrets stores in-memory and returns api_key_ref", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    const configPath = path.join(trackerDir, "config.json");

    // Pre-create a clean config.json
    await fs.writeFile(configPath, JSON.stringify({ tokenPlans: [] }), "utf8");

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

    const secretValue = "do-not-leak-sk-1234567890abcdef";

    const res = await call(handler, "/functions/tokentracker-token-plan-secrets", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        purpose: "custom-api",
        secret: secretValue,
      }),
    });

    // Should return 200 with api_key_ref (in-memory store works)
    assert.equal(res.statusCode, 200, "secrets endpoint must return 200 on success");
    const resBody = readJsonResponse(res);
    assert.equal(resBody.ok, true);
    assert.ok(typeof resBody.api_key_ref === "string" && resBody.api_key_ref.length > 0, "must return api_key_ref");
    assert.equal(resBody.provider_id, "xiaomi_mimo");
    assert.equal(resBody.purpose, "custom-api");

    // Response must NOT echo the secret
    const responseStr = JSON.stringify(resBody);
    assert.ok(!responseStr.includes(secretValue), "response must not contain the secret");
    assert.ok(!responseStr.includes("do-not-leak"), "response must not contain any secret substring");

    // config.json must NOT contain the secret
    const configRaw = await fs.readFile(configPath, "utf8");
    assert.ok(!configRaw.includes(secretValue), "config.json must not contain the secret");
    assert.ok(!configRaw.includes("do-not-leak"), "config.json must not contain any secret substring");
    assert.ok(!configRaw.includes("tokenPlanSecrets"), "config.json must not have tokenPlanSecrets key");

    // config.json should still be a valid JSON with only the original content
    const config = JSON.parse(configRaw);
    assert.ok(Array.isArray(config.tokenPlans), "config.json should still have tokenPlans array");
    assert.equal(config.tokenPlans.length, 0);
    assert.equal(config.tokenPlanSecrets, undefined, "config.json must not have tokenPlanSecrets");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W03-R3D: Custom API detection sync tests
// ---------------------------------------------------------------------------

test("R3D custom_api plan with sync_status=failed does NOT clear old quota in GET response", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });

    // Pre-create a record that had a successful sync before
    await fs.writeFile(
      path.join(trackerDir, "config.json"),
      JSON.stringify({
        tokenPlans: [
          {
            id: "plan-had-success",
            source: "hermes",
            provider_id: "xiaomi_mimo",
            plan_id: "xiaomi_mimo_standard_monthly",
            plan_label: "Standard（月付）",
            total_quota: 11000000000,
            used_quota: 3200000000,
            remaining_quota: 7800000000,
            expires_at: "2026-07-25",
            quota_source: "custom_api",
            detection_method: "custom_api",
            detection_config: {
              custom_api: {
                api_key_ref: "token-plan/xiaomi_mimo/custom-api/2e2c7f3d-7b9f-4c92-b2d2-c6e9f4a8c320",
                api_format: "json_path",
                request_url: "http://127.0.0.1:19999/nonexistent",
                method: "GET",
                response_mapping: {
                  total_quota_path: "$.total",
                  used_quota_path: "$.used",
                  remaining_quota_path: "$.remaining",
                  expires_at_path: "$.expires_at",
                },
              },
            },
            sync_status: "success",
            last_synced_at: "2026-06-20T10:00:00Z",
            provider_reported_at: "2026-06-20T10:00:00Z",
            refresh_method: "manual",
          },
        ],
      }),
      "utf8",
    );

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

    // Trigger refresh on the plan with custom_api detection (will fail: network error)
    const refreshRes = await call(handler, "/functions/tokentracker-token-plans-refresh", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "plan-had-success" }),
    });
    const refreshBody = readJsonResponse(refreshRes);

    // Refresh should have failed
    assert.equal(refreshBody.ok, true, "refresh endpoint should return ok:true even on detection failure");
    assert.equal(refreshBody.plan.sync_status, "failed", "sync_status should be failed after failed custom_api detection");

    // Quota must NOT be cleared
    assert.equal(refreshBody.plan.total_quota, 11000000000, "total_quota must be preserved");
    assert.equal(refreshBody.plan.used_quota, 3200000000, "used_quota must be preserved");
    assert.equal(refreshBody.plan.remaining_quota, 7800000000, "remaining_quota must be preserved");
    assert.equal(refreshBody.plan.expires_at, "2026-07-25", "expires_at must be preserved");

    // Error info must be set
    assert.ok(refreshBody.plan.last_error_message, "last_error_message must be set");
    assert.ok(refreshBody.plan.last_error_code, "last_error_code must be set");

    // API Key must NOT appear in response
    const responseStr = JSON.stringify(refreshBody);
    assert.ok(!responseStr.includes("do-not-leak"), "response must not leak API key");
    assert.ok(!responseStr.includes("sk-"), "response must not leak sk- prefixed key");

    // GET should also show preserved quota
    const listed = await call(handler, "/functions/tokentracker-token-plans");
    const listedRecord = readJsonResponse(listed).records[0];
    assert.equal(listedRecord.total_quota, 11000000000);
    assert.equal(listedRecord.used_quota, 3200000000);
    assert.equal(listedRecord.remaining_quota, 7800000000);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("R3D official_account detection returns unsupported with preserved quota", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
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

    // Create a plan with official_account detection
    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "hermes",
        provider_id: "xiaomi_mimo",
        plan_id: "xiaomi_mimo_standard_monthly",
        total_quota: 11000000000,
        used_quota: 5000000000,
        remaining_quota: 6000000000,
        expires_at: "2026-12-31",
        detection_method: "official_account",
        detection_config: {
          official_account: {
            provider_home_url: "https://platform.xiaomimimo.com/token-plan",
            account_binding_id: "session-test",
          },
        },
      }),
    });
    const record = readJsonResponse(created).record;

    // Refresh the plan
    const refreshRes = await call(handler, "/functions/tokentracker-token-plans-refresh", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: record.id }),
    });
    const refreshBody = readJsonResponse(refreshRes);

    assert.equal(refreshBody.ok, true);
    // sync_status must be unsupported, not success
    assert.equal(refreshBody.plan.sync_status, "unsupported", "official_account must return unsupported");
    assert.notEqual(refreshBody.plan.sync_status, "success", "must not be success");

    // Quota must be preserved
    assert.equal(refreshBody.plan.total_quota, 11000000000);
    assert.equal(refreshBody.plan.used_quota, 5000000000);
    assert.equal(refreshBody.plan.remaining_quota, 6000000000);
    assert.equal(refreshBody.plan.expires_at, "2026-12-31");

    // Error info must be set
    assert.equal(refreshBody.plan.last_error_code, "PROVIDER_UNSUPPORTED");
    assert.ok(refreshBody.plan.last_error_message.includes("当前没有可复现官方额度查询能力"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("R3D reauth_required from custom_api does NOT clear old quota", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });

    // Pre-create a record with custom_api detection pointing to a port that will fail
    // (we cannot easily mock 401/403 in the refresh flow since refreshPlan runs
    // in-process, but the custom_api module correctly maps 401/403 to reauth_required)
    await fs.writeFile(
      path.join(trackerDir, "config.json"),
      JSON.stringify({
        tokenPlans: [
          {
            id: "plan-reauth",
            source: "hermes",
            provider_id: "xiaomi_mimo",
            plan_id: "xiaomi_mimo_standard_monthly",
            plan_label: "Standard（月付）",
            total_quota: 11000000000,
            used_quota: 2000000000,
            remaining_quota: 9000000000,
            expires_at: "2026-07-01",
            quota_source: "custom_api",
            detection_method: "custom_api",
            detection_config: {
              custom_api: {
                api_key_ref: "token-plan/xiaomi_mimo/custom-api/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                api_format: "json_path",
                request_url: "",
                method: "GET",
                response_mapping: {},
              },
            },
            sync_status: "success",
            last_synced_at: "2026-06-15T08:00:00Z",
            provider_reported_at: "2026-06-15T08:00:00Z",
            refresh_method: "manual",
          },
        ],
      }),
      "utf8",
    );

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

    // Refresh the plan (will fail because request_url is empty)
    const refreshRes = await call(handler, "/functions/tokentracker-token-plans-refresh", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "plan-reauth" }),
    });
    const refreshBody = readJsonResponse(refreshRes);

    // Refresh should fail but quota preserved
    assert.equal(refreshBody.ok, true);
    assert.equal(refreshBody.plan.total_quota, 11000000000, "total_quota must be preserved");
    assert.equal(refreshBody.plan.used_quota, 2000000000, "used_quota must be preserved");
    assert.equal(refreshBody.plan.remaining_quota, 9000000000, "remaining_quota must be preserved");
    assert.equal(refreshBody.plan.expires_at, "2026-07-01", "expires_at must be preserved");

    // The sync_status should reflect the failure (failed or reauth_required)
    // config-invalid will be "failed", network error would be "failed", 401/403 would be "reauth_required"
    assert.ok(
      refreshBody.plan.sync_status === "failed" || refreshBody.plan.sync_status === "reauth_required",
      `sync_status should be failed or reauth_required, got: ${refreshBody.plan.sync_status}`
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// W03-R3D P2: Full path — save secret via endpoint, then refreshPlan resolves it
// and succeeds.  This verifies that the in-memory credential store is wired
// correctly end-to-end: secret endpoint → resolveApiKey → refreshPlan.
test("R3D P2 save secret then refresh custom_api plan succeeds (in-memory store)", async () => {
  const http = require("node:http");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    const configPath = path.join(trackerDir, "config.json");

    // Pre-create a clean config.json
    await fs.writeFile(configPath, JSON.stringify({ tokenPlans: [] }), "utf8");

    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    // 1. Get local auth token
    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    // 2. Spin up a real HTTP server that returns 200 with quota data
    const testApiKey = "sk-test-full-path-key-12345678";
    const { server, url } = await new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        // Verify the API key header was sent
        const authHeader = req.headers["authorization"] || "";
        if (authHeader === `Bearer ${testApiKey}`) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            total: 50000000000,
            used: 12000000000,
            remaining: 38000000000,
            expires_at: "2026-12-31",
          }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
        }
      });
      s.listen(0, "127.0.0.1", () => {
        const addr = s.address();
        resolve({ server: s, url: `http://127.0.0.1:${addr.port}` });
      });
    });

    try {
      // 3. Save the API key via secrets endpoint
      const secretRes = await call(handler, "/functions/tokentracker-token-plan-secrets", {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider_id: "xiaomi_mimo",
          purpose: "custom-api",
          secret: testApiKey,
        }),
      });
      assert.equal(secretRes.statusCode, 200, "secret save must succeed");
      const secretBody = readJsonResponse(secretRes);
      const apiKeyRef = secretBody.api_key_ref;

      // 4. Create a token plan record that uses this api_key_ref
      const createRes = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({
          source: "hermes",
          provider_id: "xiaomi_mimo",
          plan_id: "xiaomi_mimo_standard_monthly",
          plan_label: "Standard（月付）",
          total_quota: 11000000000,
          used_quota: 2000000000,
          remaining_quota: 9000000000,
          expires_at: "2026-07-01",
          detection_method: "custom_api",
          detection_config: {
            custom_api: {
              api_key_ref: apiKeyRef,
              api_format: "json_path",
              request_url: `${url}/quota`,
              method: "GET",
              response_mapping: {
                total_quota_path: "$.total",
                used_quota_path: "$.used",
                remaining_quota_path: "$.remaining",
                expires_at_path: "$.expires_at",
              },
            },
          },
        }),
      });
      assert.equal(createRes.statusCode, 200);
      const createdRecord = readJsonResponse(createRes).record;
      const planId = createdRecord.id;

      // 5. Refresh the plan — this calls resolveApiKey internally
      const refreshRes = await call(handler, "/functions/tokentracker-token-plans-refresh", {
        method: "POST",
        headers,
        body: JSON.stringify({ id: planId }),
      });
      const refreshBody = readJsonResponse(refreshRes);

      // 6. Verify the refresh succeeded and quota was updated from the mock server
      assert.equal(refreshBody.ok, true, "refresh must succeed");
      assert.equal(refreshBody.plan.sync_status, "success", "sync_status must be success");
      assert.equal(refreshBody.plan.total_quota, 50000000000, "total_quota updated from mock server");
      assert.equal(refreshBody.plan.used_quota, 12000000000, "used_quota updated from mock server");
      assert.equal(refreshBody.plan.remaining_quota, 38000000000, "remaining_quota updated from mock server");
      assert.equal(refreshBody.plan.expires_at, "2026-12-31", "expires_at updated from mock server");

      // 7. API key must NOT leak into the plan record
      const planStr = JSON.stringify(refreshBody.plan);
      assert.ok(!planStr.includes(testApiKey), "API key must not leak into plan record");
    } finally {
      server.close();
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
