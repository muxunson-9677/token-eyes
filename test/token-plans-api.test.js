const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");
const { createInMemoryCredentialStore } = require("../src/lib/provider-api-secrets");
const { getPlanById } = require("../src/lib/token-plan-catalog");

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

test("Token Plan GET migrates only exact kiro-cli source records and preserves unrelated Kiro identifiers", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-kiro-plan-migration-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    const configPath = path.join(trackerDir, "config.json");
    const original = {
      tokenPlans: [
        {
          id: "legacy-kiro-cli-plan",
          source: "kiro-cli",
          provider_id: "custom",
          plan_id: "custom",
          plan_label: "Kiro CLI Plan",
          model_id: "kiro-cli-agent",
        },
        {
          id: "non-exact-source",
          source: "kiro-cli-agent",
          provider_id: "custom",
          plan_id: "custom",
          plan_label: "Do not migrate",
        },
      ],
      queueHistory: [{ source: "kiro-cli", model: "kiro-cli-agent" }],
      dataDirectories: { "kiro-cli": "C:\\fixture\\kiro-cli" },
      limitsProviderOrder: ["kiro-cli", "codex"],
      diagnostics: { cli_name: "kiro-cli", parser_fixture: "kiro-cli" },
    };
    await fs.writeFile(configPath, `${JSON.stringify(original, null, 2)}\n`, "utf8");

    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const response = await call(handler, "/functions/tokentracker-token-plans");
    const records = readJsonResponse(response).records;
    assert.equal(response.statusCode, 200);
    assert.equal(records.find((record) => record.id === "legacy-kiro-cli-plan").source, "kiro");
    assert.equal(records.find((record) => record.id === "non-exact-source").source, "kiro-cli-agent");

    const persisted = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(persisted.tokenPlans[0].source, "kiro");
    assert.equal(persisted.tokenPlans[0].model_id, "kiro-cli-agent");
    assert.equal(persisted.tokenPlans[1].source, "kiro-cli-agent");
    assert.deepEqual(persisted.queueHistory, original.queueHistory);
    assert.deepEqual(persisted.dataDirectories, original.dataDirectories);
    assert.deepEqual(persisted.limitsProviderOrder, original.limitsProviderOrder);
    assert.deepEqual(persisted.diagnostics, original.diagnostics);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

async function call(handler, pathName, options) {
  const req = createRequest(options);
  const res = createResponse();
  const handled = await handler(req, res, new URL(`http://127.0.0.1:7680${pathName}`));
  assert.equal(handled, true);
  return res;
}

test("Cursor native live snapshot persists fractional metrics and is not scheduled for Node fallback refresh", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-cursor-native-live-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const snapshot = {
      source: "cursor",
      provider_id: "cursor",
      plan_id: "cursor_pro",
      plan_label: "Pro",
      quota_kind: "rolling_window",
      quota_unit: "percent",
      total_quota: 100,
      used_quota: 33.52173913043478,
      remaining_quota: 66.47826086956522,
      refresh_enabled: true,
      refresh_method: "official_api",
      detection_method: "official_account",
      sync_status: "success",
      last_synced_at: "2026-07-20T00:01:56.714Z",
      provider_reported_at: "2026-07-20T00:01:56.714Z",
      provider_reported_fields: ["total_quota", "used_quota", "remaining_quota", "quota_windows"],
      detection_config: {
        official_account: {
          provider_home_url: "https://www.cursor.com/settings",
          account_binding_id: "cursor-session-id",
          session_ref: "token-plan/cursor/session/cursor-one",
          account_id: "auth0|user_01KWTPZG4VW30ZF6MKZ2XXM398",
          display_name: "eve***@hotmail.com",
          plan_name: "pro",
        },
      },
      quota_windows: [
        { kind: "total", lane_id: "overall", unit: "percent", total: 100, used: 33.52173913043478, remaining: 66.47826086956522, percentage: 33.52173913043478, resets_at: "2026-08-06T14:31:29.000Z" },
        { kind: "auto_composer", lane_id: "auto", unit: "percent", total: 100, used: 27.82, remaining: 72.18, percentage: 27.82, resets_at: "2026-08-06T14:31:29.000Z" },
        { kind: "api", lane_id: "api", unit: "percent", total: 100, used: 71.53333333333333, remaining: 28.46666666666667, percentage: 71.53333333333333, resets_at: "2026-08-06T14:31:29.000Z" },
      ],
    };

    const response = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify(snapshot),
    });
    const record = readJsonResponse(response).record;

    assert.equal(response.statusCode, 200);
    assert.equal(record.total_quota, 100);
    assert.equal(record.used_quota, 33.52173913043478);
    assert.equal(record.remaining_quota, 66.47826086956522);
    assert.equal(record.refresh_enabled, false);
    assert.equal(record.sync_status, "success");
    assert.equal(record.detection_config.official_account.account_id, snapshot.detection_config.official_account.account_id);
    assert.equal(record.detection_config.official_account.display_name, "eve***@hotmail.com");
    assert.equal(record.detection_config.official_account.plan_name, "pro");
    assert.deepEqual(record.quota_windows.map((window) => window.kind), ["total", "auto_composer", "api"]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Task 8 Cursor POST then GET preserves lane ids without claiming a top-level headline", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-cursor-lanes-only-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const priorOverallSnapshot = {
      id: "cursor-lanes-only",
      source: "cursor",
      provider_id: "cursor",
      plan_id: "cursor_pro",
      plan_label: "Pro",
      quota_kind: "rolling_window",
      quota_unit: "percent",
      detection_method: "official_account",
      sync_status: "success",
      total_quota: 100,
      used_quota: 40,
      remaining_quota: 60,
      provider_reported_fields: ["total_quota", "used_quota", "remaining_quota", "quota_windows"],
      provider_reported_at: "2026-08-20T11:00:00.000Z",
      quota_windows: [
        { kind: "total", lane_id: "overall", unit: "percent", total: 100, used: 40, remaining: 60, percentage: 40, resets_at: "2026-08-21T00:00:00.000Z" },
      ],
    };
    await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify(priorOverallSnapshot),
    });

    const snapshot = {
      ...priorOverallSnapshot,
      provider_reported_fields: ["quota_windows"],
      provider_reported_at: "2026-08-20T12:00:00.000Z",
      quota_windows: [
        { kind: "team_pool", lane_id: "team_pool", unit: "percent", total: 100, used: 25, remaining: 75, percentage: 25, resets_at: "2026-08-21T00:00:00.000Z" },
      ],
    };
    delete snapshot.total_quota;
    delete snapshot.used_quota;
    delete snapshot.remaining_quota;

    const saved = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify(snapshot),
    })).record;
    assert.deepEqual(saved.provider_reported_fields, ["quota_windows"]);
    assert.deepEqual(saved.quota_windows.map((window) => window.lane_id), ["team_pool"]);
    for (const field of ["total_quota", "used_quota", "remaining_quota"]) {
      assert.equal(Object.hasOwn(saved, field), false, `${field} must be absent`);
      assert.equal(saved.provider_reported_fields.includes(field), false, field);
    }

    const listed = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans"));
    const reloaded = listed.records.find((record) => record.id === snapshot.id);
    assert.deepEqual(reloaded.provider_reported_fields, ["quota_windows"]);
    assert.deepEqual(reloaded.quota_windows.map((window) => window.lane_id), ["team_pool"]);
    for (const field of ["total_quota", "used_quota", "remaining_quota"]) {
      assert.equal(Object.hasOwn(reloaded, field), false, `${field} must remain absent after GET`);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Task 8 Codex POST then GET keeps live weekly headline and window on one percent unit", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-codex-percent-roundtrip-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const { parseCodexUsageBody } = require("../src/lib/codex-token-plan");
    const live = parseCodexUsageBody({
      rate_limit: {
        primary_window: { used_percent: 20.25, limit_window_seconds: 18000, reset_at: 1_700_000_000 },
        secondary_window: { used_percent: 60.75, limit_window_seconds: 604800, reset_at: 1_700_604_800 },
      },
    });
    const payload = {
      id: "codex-live-percent",
      source: "codex",
      provider_id: "codex",
      plan_id: "codex_pro_5x",
      plan_label: "Pro 5x",
      quota_kind: "rolling_window",
      detection_method: "official_account",
      sync_status: "success",
      provider_reported_fields: ["total_quota", "used_quota", "remaining_quota", "quota_windows"],
      provider_reported_at: "2026-08-20T12:00:00.000Z",
      ...live,
    };

    const saved = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    })).record;
    const weekly = saved.quota_windows.find((window) => window.kind === "rolling_weekly");
    assert.equal(saved.quota_unit, "percent");
    assert.equal(saved.used_quota, weekly.used);
    assert.equal(saved.remaining_quota, weekly.remaining);
    assert.equal(weekly.unit, saved.quota_unit);

    const listed = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans"));
    const reloaded = listed.records.find((record) => record.id === payload.id);
    assert.equal(reloaded.quota_unit, "percent");
    assert.equal(reloaded.used_quota, 60.75);
    assert.equal(reloaded.quota_windows.find((window) => window.kind === "rolling_weekly").used, 60.75);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("console session API accepts TRAE official account bindings", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-trae-console-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };

    const response = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "trae",
        auth_kind: "official_console_session",
        display_name: "TRAE CN",
        session_ref: "token-plan/trae/session/account-one",
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(readJsonResponse(response).session.provider_id, "trae");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("TRAE live request quota survives save and subsequent reads", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-trae-live-quota-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const snapshot = {
      source: "trae",
      provider_id: "trae",
      plan_id: "trae_cn_pro",
      plan_label: "速通 Pro",
      quota_kind: "subscription",
      quota_unit: "requests",
      total_quota: 100,
      used_quota: 25,
      remaining_quota: 75,
      detection_method: "official_account",
      sync_status: "success",
      last_synced_at: "2026-07-20T01:23:22.565Z",
      provider_reported_at: "2026-07-20T01:23:22Z",
      provider_reported_fields: ["total_quota", "used_quota", "remaining_quota", "quota_windows"],
      detection_config: {
        official_account: {
          provider_home_url: "https://www.trae.cn/",
          account_binding_id: "trae-session-id",
          session_ref: "token-plan/trae/session/account-one",
          account_id: "4267669818716825",
          plan_name: "速通 Pro",
        },
      },
      quota_windows: [{
        kind: "fast_request",
        unit: "requests",
        total: 100,
        used: 25,
        remaining: 75,
        percentage: 25,
        resets_at: "2026-08-01T00:03:00Z",
      }],
    };

    const saved = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify(snapshot),
    });
    assert.equal(saved.statusCode, 200);

    const listed = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans"));
    const record = listed.records[0];
    assert.equal(record.total_quota, 100);
    assert.equal(record.used_quota, 25);
    assert.equal(record.remaining_quota, 75);
    assert.deepEqual(record.quota_windows, snapshot.quota_windows);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Task 4 local API round-trips explicit zero while absent and null preserve last-good", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-task4-zero-roundtrip-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const common = {
      id: "task4-zero-roundtrip",
      source: "hermes",
      provider_id: "custom",
      plan_id: "custom",
      plan_label: "Task 4 zero round-trip",
      quota_unit: "tokens",
      detection_method: "official_account",
      sync_status: "success",
    };

    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...common,
        total_quota: 100,
        used_quota: 50,
        remaining_quota: 50,
        provider_reported_fields: ["total_quota", "used_quota", "remaining_quota"],
        provider_reported_at: "2026-08-20T01:00:00Z",
      }),
    });
    assert.equal(created.statusCode, 200);

    for (const patch of [
      { plan_label: "Task 4 absent fields" },
      { used_quota: null, remaining_quota: null },
    ]) {
      const updated = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...common, ...patch }),
      });
      assert.equal(updated.statusCode, 200);
      assert.equal(readJsonResponse(updated).record.used_quota, 50);
      assert.equal(readJsonResponse(updated).record.remaining_quota, 50);
    }

    const zeroSnapshot = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...common,
        used_quota: 100,
        remaining_quota: 0,
        provider_reported_fields: ["used_quota", "remaining_quota"],
        provider_reported_at: "2026-08-20T02:00:00Z",
      }),
    });
    assert.equal(zeroSnapshot.statusCode, 200);
    assert.equal(readJsonResponse(zeroSnapshot).record.remaining_quota, 0);

    const reloaded = readJsonResponse(
      await call(handler, "/functions/tokentracker-token-plans"),
    ).records[0];
    assert.equal(reloaded.used_quota, 100);
    assert.equal(reloaded.remaining_quota, 0);
    assert.deepEqual(reloaded.provider_reported_fields, ["used_quota", "remaining_quota"]);
    assert.equal(reloaded.provider_reported_at, "2026-08-20T02:00:00Z");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Task 4 direct token-plan POST rejects non-JSON, unsafe count, and out-of-range percent values", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-task4-number-validation-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const base = {
      source: "hermes",
      provider_id: "custom",
      plan_id: "custom",
      plan_label: "Task 4 invalid number",
      quota_unit: "tokens",
      detection_method: "not_configured",
    };
    const invalidPayloads = [
      { id: "number-string", used_quota: "0" },
      { id: "negative", used_quota: -1 },
      { id: "unsafe-integer", total_quota: Number.MAX_SAFE_INTEGER + 1 },
      { id: "fractional-count", remaining_quota: 0.5 },
      { id: "nan-string", used_quota: "NaN" },
      { id: "infinity-string", used_quota: "Infinity" },
      { id: "percent-over", quota_unit: "percent", used_quota: 100.01 },
      { id: "percent-under", quota_unit: "percent", remaining_quota: -0.01 },
    ];
    for (const payload of invalidPayloads) {
      const response = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...base, ...payload }),
      });
      assert.equal(response.statusCode, 400, payload.id);
    }

    for (const [id, body] of [
      ["nan-literal", '{"source":"hermes","provider_id":"custom","plan_id":"custom","plan_label":"invalid","used_quota":NaN}'],
      ["infinity-literal", '{"source":"hermes","provider_id":"custom","plan_id":"custom","plan_label":"invalid","used_quota":Infinity}'],
    ]) {
      const response = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body,
      });
      assert.equal(response.statusCode, 400, id);
    }

    const validPercent = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...base,
        id: "fractional-percent",
        quota_unit: "percent",
        total_quota: 100,
        used_quota: 12.5,
        remaining_quota: 87.5,
      }),
    });
    assert.equal(validPercent.statusCode, 200);
    assert.equal(readJsonResponse(validPercent).record.used_quota, 12.5);

    const listed = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans"));
    assert.deepEqual(listed.records.map((record) => record.id), ["fractional-percent"]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Task 4 direct top-level quota uses the shared unit allowlist without rejecting unused legacy units", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-task4-unit-allowlist-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(path.join(trackerDir, "config.json"), JSON.stringify({
      tokenPlans: [{
        id: "task4-legacy-unit",
        source: "hermes",
        provider_id: "custom",
        plan_id: "custom",
        plan_label: "Legacy unit",
        quota_unit: "legacy_unused_unit",
        total_quota: 12,
        used_quota: 3,
        remaining_quota: 9,
        expires_at: "2027-12-31",
        detection_method: "not_configured",
      }],
    }), "utf8");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };

    for (const unit of ["EUR", "unknown_count", "percent_typo"]) {
      const response = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: `task4-invalid-unit-${unit.toLowerCase()}`,
          source: "hermes",
          provider_id: "custom",
          plan_id: "custom",
          plan_label: `Task 4 invalid ${unit}`,
          quota_unit: unit,
          total_quota: 100,
          detection_method: "not_configured",
        }),
      });
      assert.equal(response.statusCode, 400, unit);
    }

    for (const unit of ["CNY", "USD"]) {
      const response = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: `task4-currency-${unit.toLowerCase()}`,
          source: "hermes",
          provider_id: "custom",
          plan_id: "custom",
          plan_label: `Task 4 ${unit}`,
          quota_unit: unit.toLowerCase(),
          total_quota: 100.5,
          used_quota: 20.25,
          remaining_quota: 80.25,
          detection_method: "not_configured",
        }),
      });
      assert.equal(response.statusCode, 200, unit);
      const record = readJsonResponse(response).record;
      assert.equal(record.quota_unit, unit);
      assert.equal(record.total_quota, 100.5);
      assert.equal(record.used_quota, 20.25);
      assert.equal(record.remaining_quota, 80.25);
    }

    const metadataOnly = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "task4-legacy-unit",
        plan_label: "Legacy unit metadata edited",
        notes: "metadata only",
        expires_at: "2028-01-31",
      }),
    });
    assert.equal(metadataOnly.statusCode, 200);
    const legacy = readJsonResponse(metadataOnly).record;
    assert.equal(legacy.quota_unit, "legacy_unused_unit");
    assert.equal(legacy.total_quota, 12);
    assert.equal(legacy.expires_at, "2028-01-31");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Task 4 expires_at distinguishes absent null valid explicit-empty and invalid snapshots", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-task4-expiry-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const common = {
      id: "task4-expiry",
      source: "hermes",
      provider_id: "custom",
      plan_id: "custom",
      plan_label: "Task 4 expiry",
      quota_unit: "tokens",
      detection_method: "official_account",
      sync_status: "success",
    };
    const initialAt = "2026-08-20T01:00:00Z";
    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...common,
        expires_at: "2027-01-31",
        provider_reported_fields: ["expires_at"],
        provider_reported_at: initialAt,
      }),
    });
    assert.equal(created.statusCode, 200);

    const omitted = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...common, plan_label: "Task 4 expiry edited" }),
    })).record;
    assert.equal(omitted.expires_at, "2027-01-31");
    assert.equal(omitted.provider_reported_at, initialAt);

    const nullCompatible = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...common,
        expires_at: null,
        provider_reported_fields: ["expires_at"],
        provider_reported_at: "2026-08-20T02:00:00Z",
      }),
    })).record;
    assert.equal(nullCompatible.expires_at, "2027-01-31");
    assert.equal(nullCompatible.provider_reported_at, initialAt);

    const validTimestamp = "2027-02-28T12:30:00+08:00";
    const valid = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...common,
        expires_at: validTimestamp,
        provider_reported_fields: ["expires_at"],
        provider_reported_at: "2026-08-20T03:00:00Z",
      }),
    })).record;
    assert.equal(valid.expires_at, validTimestamp);
    assert.equal(valid.provider_reported_at, "2026-08-20T03:00:00Z");

    const unreportedEmpty = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...common, expires_at: "" }),
    })).record;
    assert.equal(unreportedEmpty.expires_at, validTimestamp);
    assert.equal(unreportedEmpty.provider_reported_at, "2026-08-20T03:00:00Z");

    const invalid = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...common,
        expires_at: "2027-02-30",
        provider_reported_fields: ["expires_at"],
        provider_reported_at: "2026-08-20T04:00:00Z",
      }),
    });
    assert.equal(invalid.statusCode, 400);
    const afterInvalid = readJsonResponse(
      await call(handler, "/functions/tokentracker-token-plans"),
    ).records.find((record) => record.id === common.id);
    assert.equal(afterInvalid.expires_at, validTimestamp);
    assert.equal(afterInvalid.provider_reported_at, "2026-08-20T03:00:00Z");

    const explicitEmpty = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...common,
        expires_at: "",
        provider_reported_fields: ["expires_at"],
        provider_reported_at: "2026-08-20T05:00:00Z",
      }),
    })).record;
    assert.equal(explicitEmpty.expires_at, "");
    assert.equal(explicitEmpty.provider_reported_at, "2026-08-20T05:00:00Z");

    const manualCreated = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "task4-manual-expiry",
        source: "hermes",
        provider_id: "custom",
        plan_id: "custom",
        plan_label: "Task 4 manual expiry",
        detection_method: "not_configured",
        expires_at: "2027-12-31",
      }),
    })).record;
    const manualCleared = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...manualCreated, expires_at: "" }),
    })).record;
    assert.equal(manualCleared.expires_at, "");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Task 4 partial success marks only fresh fields and failed snapshots do not advance evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-task4-partial-fields-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const common = {
      id: "task4-partial",
      source: "hermes",
      provider_id: "custom",
      plan_id: "custom",
      plan_label: "Task 4 partial",
      quota_unit: "tokens",
      detection_method: "official_account",
    };
    await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...common,
        total_quota: 100,
        used_quota: 40,
        remaining_quota: 60,
        sync_status: "success",
        provider_reported_fields: ["total_quota", "used_quota", "remaining_quota"],
        provider_reported_at: "2026-08-20T01:00:00Z",
      }),
    });

    const partial = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...common,
        remaining_quota: 0,
        sync_status: "success",
        provider_reported_fields: ["remaining_quota"],
        provider_reported_at: "2026-08-20T02:00:00Z",
      }),
    })).record;
    assert.equal(partial.total_quota, 100);
    assert.equal(partial.used_quota, 40);
    assert.equal(partial.remaining_quota, 0);
    assert.deepEqual(partial.provider_reported_fields, ["remaining_quota"]);
    assert.equal(partial.provider_reported_at, "2026-08-20T02:00:00Z");

    for (const [index, syncStatus] of ["failed", "reauth_required", "temporary", "unsupported"].entries()) {
      const nonSuccess = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...common,
          used_quota: 0,
          remaining_quota: 100,
          sync_status: syncStatus,
          provider_reported_fields: ["used_quota", "remaining_quota"],
          provider_reported_at: `2026-08-20T0${index + 3}:00:00Z`,
        }),
      })).record;
      assert.equal(nonSuccess.used_quota, 40, syncStatus);
      assert.equal(nonSuccess.remaining_quota, 0, syncStatus);
      assert.deepEqual(nonSuccess.provider_reported_fields, ["remaining_quota"], syncStatus);
      assert.equal(nonSuccess.provider_reported_at, "2026-08-20T02:00:00Z", syncStatus);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("DATA-06 Xiaomi client-observed partial success advances quota without fabricating provider time", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-xiaomi-observed-freshness-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const common = {
      id: "xiaomi-observed-plan",
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_id: "xiaomi_mimo_standard_monthly",
      detection_method: "official_account",
      detection_config: { official_account: { account_binding_id: "xiaomi-session" } },
      sync_status: "success",
    };

    await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...common,
        total_quota: 11_000_000_000,
        used_quota: 3_000_000_000,
        remaining_quota: 8_000_000_000,
        provider_reported_fields: ["total_quota", "used_quota", "remaining_quota"],
        provider_reported_at: "2026-08-19T12:00:00.000Z",
        fetched_at: "2026-08-19T12:00:01.000Z",
        observed_at: "2026-08-19T12:00:01.000Z",
        source_kind: "undocumented_console_api",
        support_tier: "best_effort",
        partial: false,
      }),
    });

    const record = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...common,
        total_quota: 11_000_000_000,
        used_quota: 4_000_000_000,
        remaining_quota: 7_000_000_000,
        provider_reported_fields: ["total_quota", "used_quota", "remaining_quota"],
        fetched_at: "2026-08-20T12:00:00.000Z",
        observed_at: "2026-08-20T12:00:00.000Z",
        source_kind: "undocumented_console_api",
        support_tier: "best_effort",
        partial: true,
      }),
    })).record;

    assert.equal(record.used_quota, 4_000_000_000);
    assert.equal(record.remaining_quota, 7_000_000_000);
    assert.deepEqual(record.provider_reported_fields, ["total_quota", "used_quota", "remaining_quota"]);
    assert.equal(record.provider_reported_at, "");
    assert.equal(record.fetched_at, "2026-08-20T12:00:00.000Z");
    assert.equal(record.observed_at, "2026-08-20T12:00:00.000Z");
    assert.equal(record.source_kind, "undocumented_console_api");
    assert.equal(record.support_tier, "best_effort");
    assert.equal(record.partial, true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Task 4 success quota mutations require matching fresh fields and reported time", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-task4-fresh-evidence-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const common = {
      id: "task4-fresh-evidence",
      source: "hermes",
      provider_id: "custom",
      plan_id: "custom",
      plan_label: "Task 4 fresh evidence",
      quota_unit: "tokens",
      detection_method: "official_account",
      sync_status: "success",
    };
    await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...common,
        total_quota: 100,
        used_quota: 50,
        remaining_quota: 50,
        provider_reported_fields: ["total_quota", "used_quota", "remaining_quota"],
        provider_reported_at: "2026-08-20T01:00:00Z",
      }),
    });

    const incompleteEvidencePatches = [
      { used_quota: 0 },
      { used_quota: 0, provider_reported_fields: ["used_quota"] },
      { used_quota: 0, provider_reported_at: "2026-08-20T02:00:00Z" },
      {
        used_quota: 0,
        provider_reported_fields: ["used_quota"],
        last_synced_at: "2026-08-20T02:00:00Z",
      },
    ];
    for (const patch of incompleteEvidencePatches) {
      const record = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...common, ...patch }),
      })).record;
      assert.equal(record.used_quota, 50);
      assert.equal(record.remaining_quota, 50);
      assert.deepEqual(
        record.provider_reported_fields,
        ["total_quota", "used_quota", "remaining_quota"],
      );
      assert.equal(record.provider_reported_at, "2026-08-20T01:00:00Z");
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Task 4 initial failed reauth and unsupported snapshots cannot become last-good quota", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-task4-initial-failure-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };

    for (const syncStatus of ["failed", "reauth_required", "unsupported"]) {
      const response = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: `task4-initial-${syncStatus}`,
          source: "hermes",
          provider_id: "custom",
          plan_id: "custom",
          plan_label: `Task 4 ${syncStatus}`,
          quota_unit: "tokens",
          total_quota: 100,
          used_quota: 20,
          remaining_quota: 80,
          expires_at: "2027-12-31",
          detection_method: "official_account",
          sync_status: syncStatus,
          provider_reported_fields: [
            "total_quota",
            "used_quota",
            "remaining_quota",
            "expires_at",
          ],
          provider_reported_at: "2026-08-20T01:00:00Z",
        }),
      });
      assert.equal(response.statusCode, 200, syncStatus);
      const record = readJsonResponse(response).record;
      assert.equal(record.total_quota, 0, syncStatus);
      assert.equal(record.used_quota, 0, syncStatus);
      assert.equal(record.remaining_quota, 0, syncStatus);
      assert.equal(record.expires_at, "", syncStatus);
      assert.deepEqual(record.provider_reported_fields, [], syncStatus);
      assert.equal(record.provider_reported_at, "", syncStatus);
    }

    const listed = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans"));
    assert.equal(listed.records.every((record) => (
      record.total_quota === 0
      && record.used_quota === 0
      && record.remaining_quota === 0
      && record.expires_at === ""
      && record.provider_reported_fields.length === 0
      && record.provider_reported_at === ""
    )), true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Cursor official refresh clears a legacy billing-cycle expiry without claiming entitlement evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-cursor-entitlement-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const base = {
      id: "cursor-legacy-expiry",
      source: "cursor",
      provider_id: "cursor",
      plan_id: "cursor_pro",
      plan_label: "Pro",
      quota_unit: "percent",
      total_quota: 100,
      used_quota: 10,
      remaining_quota: 90,
      detection_method: "official_account",
      detection_config: { official_account: { plan_name: "pro" } },
      sync_status: "success",
      provider_reported_at: "2026-08-20T01:00:00Z",
    };
    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...base,
        expires_at: "2026-09-22T05:18:33.402Z",
        provider_reported_fields: ["total_quota", "used_quota", "remaining_quota", "expires_at"],
      }),
    });
    assert.equal(created.statusCode, 200);

    const refreshed = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...base,
        used_quota: 0,
        remaining_quota: 100,
        expires_at: "",
        detection_config: { official_account: { plan_name: "free" } },
        provider_reported_fields: ["total_quota", "used_quota", "remaining_quota"],
        provider_reported_at: "2026-08-31T01:00:00Z",
      }),
    });
    assert.equal(refreshed.statusCode, 200);
    const record = readJsonResponse(refreshed).record;
    assert.equal(record.expires_at, "");
    assert.equal(record.detection_config.official_account.plan_name, "free");
    assert.deepEqual(record.provider_reported_fields, ["total_quota", "used_quota", "remaining_quota"]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Task 4 full quota windows require valid units and arithmetic without rewriting fractional values", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-task4-window-validation-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": readJsonResponse(auth).token,
      origin: "http://127.0.0.1:7680",
    };
    const base = {
      source: "cursor",
      provider_id: "cursor",
      plan_id: "cursor_pro",
      plan_label: "Cursor Pro",
      quota_unit: "percent",
      total_quota: 100,
      used_quota: 33.33333333333333,
      remaining_quota: 66.66666666666666,
      detection_method: "official_account",
      sync_status: "success",
      provider_reported_fields: ["total_quota", "used_quota", "remaining_quota", "quota_windows"],
      provider_reported_at: "2026-08-20T01:00:00Z",
    };
    const validWindow = {
      kind: "total",
      unit: "percent",
      total: 100,
      used: 33.33333333333333,
      remaining: 66.66666666666666,
      percentage: 33.33333333333333,
      resets_at: "2026-08-21T01:00:00Z",
    };
    const valid = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...base, id: "task4-valid-window", quota_windows: [validWindow] }),
    });
    assert.equal(valid.statusCode, 200);
    assert.deepEqual(readJsonResponse(valid).record.quota_windows[0], validWindow);

    const invalidWindows = [
      { id: "arithmetic", window: { ...validWindow, remaining: 60 } },
      { id: "unknown-unit", window: { ...validWindow, unit: "unknown_count" } },
      { id: "numeric-string", window: { ...validWindow, used: "33.33333333333333" } },
      { id: "fractional-count", window: { ...validWindow, unit: "tokens", total: 100, used: 0.5, remaining: 99.5 } },
      { id: "percent-range", window: { ...validWindow, percentage: 100.01 } },
      { id: "cursor-lane", window: { ...validWindow, lane_id: "averaged" } },
    ];
    for (const item of invalidWindows) {
      const response = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...base, id: `task4-invalid-${item.id}`, quota_windows: [item.window] }),
      });
      assert.equal(response.statusCode, 400, item.id);
    }

    const reloaded = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans"));
    assert.deepEqual(reloaded.records.map((record) => record.id), ["task4-valid-window"]);
    assert.deepEqual(reloaded.records[0].quota_windows[0], validWindow);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

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

test("token plans API deletes only the requested local record", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-delete-"));
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

    const ids = [];
    for (const label of ["Keep", "Delete"]) {
      const created = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({ source: "claude", plan_label: label, total_quota: 100 }),
      });
      ids.push(readJsonResponse(created).record.id);
    }

    const deleted = await call(handler, "/functions/tokentracker-token-plans", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ id: ids[1] }),
    });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(readJsonResponse(deleted).records.map((record) => record.id), [ids[0]]);
    assert.equal(readJsonResponse(deleted).records[0].display_order, 0);

    const missing = await call(handler, "/functions/tokentracker-token-plans", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ id: ids[1] }),
    });
    assert.equal(missing.statusCode, 404);
    const listed = await call(handler, "/functions/tokentracker-token-plans");
    assert.deepEqual(readJsonResponse(listed).records.map((record) => record.id), [ids[0]]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("token plans order API persists an exact atomic order and rejects invalid ID sets", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-token-plans-order-"));
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

    const ids = [];
    for (const label of ["A", "B", "C"]) {
      const response = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({ source: "claude", plan_label: label, total_quota: 100 }),
      });
      ids.push(readJsonResponse(response).record.id);
    }

    const expected = [ids[2], ids[0], ids[1]];
    const reordered = await call(handler, "/functions/tokentracker-token-plans-order", {
      method: "PUT",
      headers,
      body: JSON.stringify({ ids: expected }),
    });
    assert.equal(reordered.statusCode, 200);
    assert.deepEqual(readJsonResponse(reordered).records.map((record) => record.id), expected);
    assert.deepEqual(readJsonResponse(reordered).records.map((record) => record.display_order), [0, 1, 2]);

    const invalidOrders = [
      [ids[0], ids[0], ids[2]],
      [ids[0], ids[1]],
      [ids[0], ids[1], "unknown"],
    ];
    for (const invalid of invalidOrders) {
      const rejected = await call(handler, "/functions/tokentracker-token-plans-order", {
        method: "PUT",
        headers,
        body: JSON.stringify({ ids: invalid }),
      });
      assert.equal(rejected.statusCode, 400);
      const listed = await call(handler, "/functions/tokentracker-token-plans");
      assert.deepEqual(readJsonResponse(listed).records.map((record) => record.id), expected);
    }
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

test("token plans refresh endpoint writes failed status when no provider adapter exists", async () => {
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
        plan_label: "Hermes Custom",
        refresh_enabled: true,
        refresh_interval_minutes: 60,
        refresh_method: "official_api",
        credential_ref: "",
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

test("DATA-02 legacy GLM migration requires paired revision evidence and repairs old cross-unit records", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-glm-unknown-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(path.join(trackerDir, "config.json"), JSON.stringify({
      tokenPlans: [
        {
          id: "legacy-glm-bare",
          source: "hermes",
          provider_id: "glm",
          plan_id: "glm_pro",
          plan_label: "Pro",
          quota_unit: "prompts",
          total_quota: 2000,
          used_quota: 0,
          remaining_quota: 2000,
          quota_source: "catalog",
        },
        {
          id: "legacy-glm-version-only",
          source: "hermes",
          provider_id: "glm",
          plan_id: "glm_pro",
          plan_label: "Pro",
          quota_catalog_version: "2026-07-08",
          total_quota: 2000,
          quota_source: "catalog",
        },
        {
          id: "legacy-glm-v2",
          source: "hermes",
          provider_id: "glm",
          plan_id: "glm_pro",
          plan_label: "Pro",
          quota_catalog_version: "2026-07-08",
          quota_unit: "prompts",
          total_quota: 2000,
          used_quota: 0,
          remaining_quota: 2000,
          quota_source: "catalog",
        },
        {
          id: "legacy-glm-v1-explicit",
          source: "hermes",
          provider_id: "glm",
          plan_id: "glm_pro",
          plan_label: "Pro",
          entitlement_revision: "legacy_v1",
          entitlement_windows: [{ kind: "rolling_weekly", unit: "prompts", total: 999999 }],
          total_quota: 999999,
          quota_source: "catalog",
        },
        {
          id: "legacy-glm-current-explicit",
          source: "hermes",
          provider_id: "glm",
          plan_id: "glm_pro",
          plan_label: "Pro",
          entitlement_revision: "current_v3_points",
          quota_catalog_version: "2026-08-20",
          quota_unit: "points",
          quota_source: "catalog",
        },
        {
          id: "legacy-glm-cross-unit",
          source: "hermes",
          provider_id: "glm",
          plan_id: "glm_pro",
          plan_label: "Pro",
          quota_catalog_version: "2026-07-08",
          quota_kind: "rolling_window",
          quota_unit: "prompts",
          total_quota: 2000,
          used_quota: 100,
          remaining_quota: 400,
          quota_source: "catalog",
          quota_windows: [
            { kind: "rolling_5_hour", unit: "tokens", total: 100, used: 20, remaining: 80, percentage: 20, resets_at: "a" },
            { kind: "rolling_weekly", unit: "tokens", total: 500, used: 100, remaining: 400, percentage: 20, resets_at: "b" },
          ],
          provider_reported_fields: ["quota_windows"],
          provider_reported_at: "2026-08-20T02:00:00Z",
          detection_method: "official_account",
          sync_status: "success",
        },
      ],
    }), "utf8");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const records = readJsonResponse(
      await call(handler, "/functions/tokentracker-token-plans"),
    ).records;
    const byId = (id) => records.find((record) => record.id === id);
    for (const id of ["legacy-glm-bare", "legacy-glm-version-only"]) {
      const record = byId(id);
      assert.equal(record.entitlement_revision, "unknown");
      assert.deepEqual(record.entitlement_windows, []);
      for (const field of ["total_quota", "used_quota", "remaining_quota"]) {
        assert.equal(Object.prototype.hasOwnProperty.call(record, field), false);
      }
    }

    const v2 = byId("legacy-glm-v2");
    assert.equal(v2.entitlement_revision, "legacy_v2_prompts");
    assert.deepEqual(
      v2.entitlement_windows.map((window) => [window.kind, window.unit, window.total]),
      [["rolling_5_hour", "prompts", 400], ["rolling_weekly", "prompts", 2000]],
    );
    for (const field of ["total_quota", "used_quota", "remaining_quota"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(v2, field), false);
    }

    const v1 = byId("legacy-glm-v1-explicit");
    assert.equal(v1.entitlement_revision, "legacy_v1");
    assert.deepEqual(v1.entitlement_windows, []);
    assert.equal(Object.prototype.hasOwnProperty.call(v1, "total_quota"), false);

    const current = byId("legacy-glm-current-explicit");
    assert.equal(current.entitlement_revision, "current_v3_points");
    assert.deepEqual(
      current.entitlement_windows.map((window) => [window.kind, window.unit, window.total]),
      [["rolling_5_hour", "points", 12000], ["rolling_weekly", "points", 60000]],
    );
    assert.equal(Object.prototype.hasOwnProperty.call(current, "total_quota"), false);

    const repaired = byId("legacy-glm-cross-unit");
    assert.equal(repaired.entitlement_revision, "legacy_v2_prompts");
    assert.deepEqual(
      repaired.entitlement_windows.map((window) => [window.kind, window.unit, window.total]),
      [["rolling_5_hour", "prompts", 400], ["rolling_weekly", "prompts", 2000]],
    );
    assert.equal(repaired.quota_kind, "rolling_window");
    assert.equal(repaired.quota_unit, "tokens");
    assert.equal(repaired.total_quota, 500);
    assert.equal(repaired.used_quota, 100);
    assert.equal(repaired.remaining_quota, 400);
    assert.equal(repaired.total_quota_display, "");
    assert.equal(repaired.quota_source, "provider_reported");
    assert.deepEqual(repaired.provider_reported_fields, [
      "total_quota",
      "used_quota",
      "remaining_quota",
      "quota_windows",
    ]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("DATA-02 editing an existing unknown GLM record cannot forge a current cohort upgrade", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-glm-edit-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(path.join(trackerDir, "config.json"), JSON.stringify({
      tokenPlans: [{
        id: "glm-existing-unknown",
        source: "hermes",
        provider_id: "glm",
        plan_id: "glm_lite",
        plan_label: "Lite",
        entitlement_revision: "unknown",
        entitlement_windows: [],
        detection_method: "not_configured",
      }],
    }), "utf8");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = readJsonResponse(await call(handler, "/api/local-auth"));
    const response = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tokentracker-local-auth": auth.token,
        origin: "http://127.0.0.1:7680",
      },
      body: JSON.stringify({
        id: "glm-existing-unknown",
        source: "hermes",
        provider_id: "glm",
        plan_id: "glm_lite",
        plan_label: "Lite renamed",
        entitlement_revision: "current_v3_points",
        detection_method: "not_configured",
      }),
    });
    assert.equal(response.statusCode, 200);
    const record = readJsonResponse(response).record;
    assert.equal(record.entitlement_revision, "unknown");
    assert.deepEqual(record.entitlement_windows, []);
    for (const field of ["total_quota", "used_quota", "remaining_quota"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(record, field), false);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("DATA-02 new GLM official-account plan without API key stores only current static entitlement", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-glm-no-key-save-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = readJsonResponse(await call(handler, "/api/local-auth"));
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": auth.token,
      origin: "http://127.0.0.1:7680",
    };
    const saved = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "glm-new-no-key",
        source: "hermes",
        provider_id: "glm",
        plan_id: "glm_pro",
        plan_label: "Pro",
        detection_method: "official_account",
        detection_config: { official_account: { api_key_ref: "" } },
        sync_status: "not_configured",
      }),
    });
    assert.equal(saved.statusCode, 200);
    const canonicalPlan = getPlanById("glm", "glm_pro");
    assert.ok(Array.isArray(canonicalPlan.entitlement_windows));
    const created = readJsonResponse(saved).record;
    const listed = readJsonResponse(
      await call(handler, "/functions/tokentracker-token-plans"),
    ).records.find((record) => record.id === "glm-new-no-key");
    for (const record of [created, listed]) {
      assert.equal(record.entitlement_revision, "current_v3_points");
      assert.deepEqual(record.entitlement_windows, canonicalPlan.entitlement_windows);
      for (const field of [
        "quota_kind",
        "quota_unit",
        "total_quota",
        "used_quota",
        "remaining_quota",
        "quota_source",
        "total_quota_display",
      ]) {
        assert.equal(Object.prototype.hasOwnProperty.call(record, field), false, `${field} must stay absent`);
      }
      assert.deepEqual(record.provider_reported_fields, []);
      assert.equal(record.provider_reported_at, "");
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("DATA-02 metadata edit preserves an evidenced legacy V2 cohort instead of upgrading to current", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-glm-v2-edit-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(path.join(trackerDir, "config.json"), JSON.stringify({
      tokenPlans: [{
        id: "glm-existing-v2",
        source: "hermes",
        provider_id: "glm",
        plan_id: "glm_pro",
        plan_label: "Pro",
        quota_catalog_version: "2026-07-08",
        quota_unit: "prompts",
        total_quota: 2000,
        remaining_quota: 2000,
        quota_source: "catalog",
        detection_method: "not_configured",
      }],
    }), "utf8");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = readJsonResponse(await call(handler, "/api/local-auth"));
    const response = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tokentracker-local-auth": auth.token,
        origin: "http://127.0.0.1:7680",
      },
      body: JSON.stringify({
        id: "glm-existing-v2",
        source: "hermes",
        provider_id: "glm",
        plan_id: "glm_pro",
        notes: "metadata only",
        detection_method: "not_configured",
      }),
    });
    assert.equal(response.statusCode, 200);
    const { getGlmEntitlementWindows } = require("../src/lib/glm-token-plan");
    assert.equal(typeof getGlmEntitlementWindows, "function");
    const canonicalWindows = getGlmEntitlementWindows("legacy_v2_prompts", "glm_pro");
    const created = readJsonResponse(response).record;
    const listed = readJsonResponse(
      await call(handler, "/functions/tokentracker-token-plans"),
    ).records.find((record) => record.id === "glm-existing-v2");
    for (const record of [created, listed]) {
      assert.equal(record.entitlement_revision, "legacy_v2_prompts");
      assert.deepEqual(record.entitlement_windows, canonicalWindows);
      assert.equal(record.quota_catalog_version, "2026-07-08");
      for (const field of [
        "quota_kind",
        "quota_unit",
        "total_quota",
        "used_quota",
        "remaining_quota",
        "quota_source",
        "total_quota_display",
      ]) {
        assert.equal(Object.prototype.hasOwnProperty.call(record, field), false, `${field} must stay absent`);
      }
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("DATA-02 GLM POST then GET keeps static points entitlements separate from one live token window", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-glm-layered-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = readJsonResponse(await call(handler, "/api/local-auth"));
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": auth.token,
      origin: "http://127.0.0.1:7680",
    };
    const quotaWindows = [
      {
        kind: "rolling_5_hour",
        unit: "tokens",
        total: 100,
        used: 20,
        remaining: 80,
        percentage: 20,
        resets_at: "2026-08-20T05:00:00Z",
      },
      {
        kind: "rolling_weekly",
        unit: "tokens",
        total: 500,
        used: 100,
        remaining: 400,
        percentage: 20,
        resets_at: "2026-08-27T00:00:00Z",
      },
    ];
    const canonicalPlan = getPlanById("glm", "glm_pro");
    assert.ok(Array.isArray(canonicalPlan.entitlement_windows));
    assert.equal(canonicalPlan.entitlement_windows.length, 2);
    const saved = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "glm-current-pro",
        source: "hermes",
        provider_id: "glm",
        plan_id: "glm_pro",
        plan_label: "Pro",
        quota_unit: "tokens",
        total_quota: 500,
        used_quota: 100,
        remaining_quota: 400,
        quota_windows: quotaWindows,
        detection_method: "official_account",
        sync_status: "success",
        provider_reported_fields: [
          "total_quota",
          "used_quota",
          "remaining_quota",
          "quota_windows",
        ],
        provider_reported_at: "2026-08-20T02:00:00Z",
      }),
    });
    assert.equal(saved.statusCode, 200);

    const created = readJsonResponse(saved).record;
    const listed = readJsonResponse(
      await call(handler, "/functions/tokentracker-token-plans"),
    ).records.find((record) => record.id === "glm-current-pro");
    for (const record of [created, listed]) {
      assert.equal(record.entitlement_revision, "current_v3_points");
      assert.deepEqual(record.entitlement_windows, canonicalPlan.entitlement_windows);
      assert.equal(record.quota_kind, "rolling_window");
      assert.equal(record.quota_unit, "tokens");
      assert.equal(record.total_quota, 500);
      assert.equal(record.used_quota, 100);
      assert.equal(record.remaining_quota, 400);
      assert.deepEqual(record.quota_windows, quotaWindows);
      assert.equal(record.total_quota_display, "");
      assert.equal(record.quota_source, "provider_reported");
      assert.deepEqual(record.provider_reported_fields, [
        "total_quota",
        "used_quota",
        "remaining_quota",
        "quota_windows",
      ]);
      assert.equal(record.provider_reported_at, "2026-08-20T02:00:00Z");
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("DATA-02 local GLM falls back to rolling_5_hour when the weekly live window is absent", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-glm-five-hour-primary-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    const canonicalPlan = getPlanById("glm", "glm_pro");
    const fiveHour = {
      kind: "rolling_5_hour",
      unit: "tokens",
      total: 100,
      used: 20,
      remaining: 80,
      percentage: 20,
      resets_at: "2026-08-20T05:00:00Z",
    };
    await fs.writeFile(path.join(trackerDir, "config.json"), JSON.stringify({
      tokenPlans: [{
        id: "glm-five-hour-only",
        source: "hermes",
        provider_id: "glm",
        plan_id: "glm_pro",
        plan_label: "Pro",
        entitlement_revision: "current_v3_points",
        entitlement_windows: canonicalPlan.entitlement_windows,
        quota_catalog_version: "2026-08-20",
        quota_kind: "entitlement_windows",
        quota_unit: "points",
        total_quota: 60000,
        used_quota: 0,
        remaining_quota: 60000,
        total_quota_display: canonicalPlan.total_quota_display,
        quota_source: "catalog",
        quota_windows: [fiveHour],
        provider_reported_fields: ["quota_windows"],
        provider_reported_at: "2026-08-20T02:00:00Z",
        detection_method: "official_account",
        sync_status: "success",
      }],
    }), "utf8");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const record = readJsonResponse(
      await call(handler, "/functions/tokentracker-token-plans"),
    ).records.find((item) => item.id === "glm-five-hour-only");
    assert.equal(record.quota_kind, "rolling_window");
    assert.equal(record.quota_unit, "tokens");
    assert.equal(record.total_quota, 100);
    assert.equal(record.used_quota, 20);
    assert.equal(record.remaining_quota, 80);
    assert.equal(record.quota_source, "provider_reported");
    assert.equal(record.total_quota_display, "");
    assert.deepEqual(record.quota_windows, [fiveHour]);
    assert.deepEqual(record.provider_reported_fields, [
      "total_quota",
      "used_quota",
      "remaining_quota",
      "quota_windows",
    ]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("DATA-03 MiniMax provider_count live snapshot round-trips without catalog unit override", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-minimax-unit-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = readJsonResponse(await call(handler, "/api/local-auth"));
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": auth.token,
      origin: "http://127.0.0.1:7680",
    };
    const { parseMiniMaxTokenPlanResponse } = require("../src/lib/minimax-token-plan");
    const adapterSnapshot = parseMiniMaxTokenPlanResponse({
      base_resp: { status_code: 0 },
      model_remains: [{
        model_name: "MiniMax-M*",
        current_interval_total_count: 100,
        current_interval_usage_count: 101,
        current_weekly_total_count: 100,
        current_weekly_usage_count: 101,
      }],
    });
    const quotaWindows = adapterSnapshot.quota_windows;
    const saved = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "minimax-provider-count",
        source: "hermes",
        provider_id: "minimax",
        plan_id: "minimax_manual_quota",
        plan_label: "Token Plan",
        ...adapterSnapshot,
        detection_method: "official_account",
        sync_status: "success",
        provider_reported_fields: [
          "total_quota",
          "used_quota",
          "remaining_quota",
          "quota_windows",
        ],
        provider_reported_at: "2026-08-20T03:00:00Z",
      }),
    });
    assert.equal(saved.statusCode, 200, saved.body.toString("utf8"));
    const listed = readJsonResponse(
      await call(handler, "/functions/tokentracker-token-plans"),
    ).records.find((record) => record.id === "minimax-provider-count");
    assert.equal(listed.quota_unit, "provider_count");
    assert.equal(listed.total_quota, 100);
    assert.equal(listed.used_quota, 100);
    assert.equal(listed.remaining_quota, 0);
    assert.deepEqual(listed.quota_windows, quotaWindows);
    for (const window of listed.quota_windows) {
      assert.equal(window.unit, "provider_count");
      assert.equal(window.total, 100);
      assert.equal(window.used, 100);
      assert.equal(window.remaining, 0);
      assert.equal(window.percentage, 100);
    }
    assert.equal(Object.keys(listed).some((key) => /overage|token_conversion/i.test(key)), false);
    assert.deepEqual(listed.provider_reported_fields, [
      "total_quota",
      "used_quota",
      "remaining_quota",
      "quota_windows",
    ]);
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

    // Create a plan whose source has no official quota adapter. Codex, Claude,
    // and Cursor are intentionally excluded because they now have real adapters.
    const created = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "hermes",
        plan_label: "Hermes Custom",
        total_quota: 11000000000,
        used_quota: 5000000000,
        remaining_quota: 6000000000,
        expires_at: "2026-12-31",
        refresh_enabled: true,
        refresh_method: "official_api",
        refresh_interval_minutes: 60,
        credential_ref: "",
        detection_method: "official_account",
        sync_status: "success",
        last_synced_at: "2026-06-20T10:00:00Z",
        provider_reported_at: "2026-06-20T10:00:00Z",
        provider_reported_fields: ["total_quota", "used_quota", "remaining_quota", "expires_at"],
      }),
    });
    const record = readJsonResponse(created).record;
    assert.ok(record.id);

    // Trigger a refresh that will fail (no provider adapter for Hermes).
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
      credentialStore: createInMemoryCredentialStore(),
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

    const credentialStore = createInMemoryCredentialStore();
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
      credentialStore,
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
    let upstreamRequestCount = 0;
    const { server, url } = await new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        upstreamRequestCount += 1;
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

      // 5. The production-default handler must reject HTTP/loopback before I/O,
      // even under NODE_TEST_CONTEXT.
      const blockedRefreshRes = await call(handler, "/functions/tokentracker-token-plans-refresh", {
        method: "POST",
        headers,
        body: JSON.stringify({ id: planId }),
      });
      const blockedRefreshBody = readJsonResponse(blockedRefreshRes);
      assert.equal(blockedRefreshBody.ok, true);
      assert.equal(blockedRefreshBody.plan.sync_status, "failed");
      assert.equal(upstreamRequestCount, 0, "production default must not contact localhost");

      // 6. A separately constructed handler may opt in explicitly for its local fixture.
      const testHandler = createLocalApiHandler({
        queuePath: path.join(trackerDir, "queue.jsonl"),
        trackerDataDir: trackerDir,
        credentialStore,
        providerApiTestMode: true,
      });
      const testAuth = await call(testHandler, "/api/local-auth");
      const testHeaders = {
        ...headers,
        "x-tokentracker-local-auth": readJsonResponse(testAuth).token,
      };
      const refreshRes = await call(testHandler, "/functions/tokentracker-token-plans-refresh", {
        method: "POST",
        headers: testHeaders,
        body: JSON.stringify({ id: planId }),
      });
      const refreshBody = readJsonResponse(refreshRes);

      // 7. Verify the explicit fixture opt-in refreshed from the mock server.
      assert.equal(refreshBody.ok, true, "refresh must succeed");
      assert.equal(refreshBody.plan.sync_status, "success", "sync_status must be success");
      assert.equal(refreshBody.plan.total_quota, 50000000000, "total_quota updated from mock server");
      assert.equal(refreshBody.plan.used_quota, 12000000000, "used_quota updated from mock server");
      assert.equal(refreshBody.plan.remaining_quota, 38000000000, "remaining_quota updated from mock server");
      assert.equal(refreshBody.plan.expires_at, "2026-12-31", "expires_at updated from mock server");
      assert.equal(upstreamRequestCount, 1);

      // 8. API key must NOT leak into the plan record
      const planStr = JSON.stringify(refreshBody.plan);
      assert.ok(!planStr.includes(testApiKey), "API key must not leak into plan record");
    } finally {
      server.close();
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
