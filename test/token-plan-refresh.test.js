const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");

const {
  normalizeRefreshFields,
  ensureStatusFields,
  computeNextRefreshAt,
  isDue,
  pickIntervalMinutes,
  pickMethod,
  pickCredentialRef,
  pickDetectionMethod,
  pickSyncStatus,
  mapRefreshMethodToDetectionMethod,
  mapRefreshStatusToSyncStatus,
  normalizeDetectionFields,
  normalizeDetectionConfig,
  normalizeQuotaWindows,
  refreshPlan,
  createScheduler,
  registerProviderAdapter,
  getProviderAdapter,
} = require("../src/lib/token-plan-refresh");

test("Cursor official account metadata survives normalization without credentials", () => {
  const normalized = normalizeDetectionConfig({
    official_account: {
      provider_home_url: "https://www.cursor.com/settings",
      account_binding_id: "cursor-session-id",
      session_ref: "token-plan/cursor/session/cursor-one",
      account_id: "auth0|user_01KWTPZG4VW30ZF6MKZ2XXM398",
      display_name: "eve***@hotmail.com",
      plan_name: "pro",
    },
  });

  assert.deepEqual(normalized.official_account, {
    provider_home_url: "https://www.cursor.com/settings",
    account_binding_id: "cursor-session-id",
    api_key_ref: "",
    session_ref: "token-plan/cursor/session/cursor-one",
    account_id: "auth0|user_01KWTPZG4VW30ZF6MKZ2XXM398",
    display_name: "eve***@hotmail.com",
    plan_name: "pro",
  });
  assert.equal("access_token" in normalized.official_account, false);
  assert.equal("refresh_token" in normalized.official_account, false);
});

test("Cursor percentage windows preserve fractional Total Auto and API dimensions", () => {
  const windows = normalizeQuotaWindows([
    { kind: "total", unit: "percent", total: 100, used: 33.52173913043478, remaining: 66.47826086956522, percentage: 33.52173913043478, resets_at: "2026-08-06T14:31:29.000Z" },
    { kind: "auto_composer", unit: "percent", total: 100, used: 27.82, remaining: 72.18, percentage: 27.82, resets_at: "2026-08-06T14:31:29.000Z" },
    { kind: "api", unit: "percent", total: 100, used: 71.53333333333333, remaining: 28.46666666666667, percentage: 71.53333333333333, resets_at: "2026-08-06T14:31:29.000Z" },
  ]);

  assert.equal(windows.length, 3);
  assert.deepEqual(windows.map((window) => window.kind), ["total", "auto_composer", "api"]);
  assert.equal(windows[0].unit, "percent");
  assert.equal(windows[0].used, 33.52173913043478);
  assert.equal(windows[1].used, 27.82);
  assert.equal(windows[2].used, 71.53333333333333);
});

test("Codex model-specific weekly quota survives persistence normalization", () => {
  const windows = normalizeQuotaWindows([
    { kind: "rolling_weekly", unit: "percent", total: 100, used: 4, remaining: 96, percentage: 4, resets_at: "1787196800" },
    { kind: "gpt_5_3_codex_spark_weekly", unit: "percent", total: 100, used: 56, remaining: 44, percentage: 56, resets_at: "1787701607" },
  ]);

  assert.deepEqual(windows.map((window) => window.kind), [
    "rolling_weekly",
    "gpt_5_3_codex_spark_weekly",
  ]);
  assert.deepEqual(windows.map((window) => window.resets_at), ["1787196800", "1787701607"]);
});

test("pickIntervalMinutes clamps to allowed set", () => {
  assert.equal(pickIntervalMinutes(15), 15);
  assert.equal(pickIntervalMinutes(1440), 1440);
  assert.equal(pickIntervalMinutes(7, 60), 60);
  assert.equal(pickIntervalMinutes("abc"), 60);
});

test("pickMethod only allows known methods", () => {
  assert.equal(pickMethod("manual"), "manual");
  assert.equal(pickMethod("official_api"), "official_api");
  assert.equal(pickMethod("cookie_scrape"), "cookie_scrape");
  assert.equal(pickMethod("bogus", "manual"), "manual");
  assert.equal(pickMethod(""), "manual");
});

test("pickCredentialRef only allows whitelist refs", () => {
  assert.equal(pickCredentialRef("codex_auth_json"), "codex_auth_json");
  assert.equal(pickCredentialRef("claude_credentials_json"), "claude_credentials_json");
  assert.equal(pickCredentialRef("raw-token-abc"), "");
  assert.equal(pickCredentialRef(""), "");
});

test("normalizeRefreshFields merges input and fallback", () => {
  const out = normalizeRefreshFields(
    { refresh_enabled: true, refresh_interval_minutes: 30, refresh_method: "official_api" },
    { refresh_interval_minutes: 60, credential_ref: "codex_auth_json" },
  );
  assert.equal(out.refresh_enabled, true);
  assert.equal(out.refresh_interval_minutes, 30);
  assert.equal(out.refresh_method, "official_api");
  assert.equal(out.credential_ref, "codex_auth_json");
});

test("backend refresh preserves a native TRAE quota until the desktop bridge syncs it", async () => {
  const plan = {
    id: "trae-live-plan",
    provider_id: "trae",
    plan_id: "trae_cn_pro",
    detection_method: "official_account",
    refresh_method: "official_api",
    refresh_enabled: true,
    refresh_interval_minutes: 5,
    total_quota: 100,
    used_quota: 25,
    remaining_quota: 75,
    quota_windows: [{
      kind: "fast_request",
      unit: "requests",
      total: 100,
      used: 25,
      remaining: 75,
      percentage: 25,
    }],
    sync_status: "success",
    last_synced_at: "2026-07-20T01:23:22.565Z",
    last_error_code: "",
    last_error_message: "",
    detection_config: {
      official_account: {
        account_binding_id: "console-trae-one",
        session_ref: "token-plan/trae/session/one",
        account_id: "4267669818716825",
      },
    },
  };

  const result = await refreshPlan(plan, { now: "2026-07-20T01:28:22.565Z" });

  assert.equal(result.status, "deferred_native");
  assert.equal(result.record.sync_status, "success");
  assert.equal(result.record.last_synced_at, plan.last_synced_at);
  assert.equal(result.record.last_error_code, "");
  assert.equal(result.record.total_quota, 100);
  assert.equal(result.record.used_quota, 25);
  assert.equal(result.record.remaining_quota, 75);
  assert.deepEqual(result.record.quota_windows, plan.quota_windows);
  assert.equal(result.record.next_refresh_at, "2026-07-20T01:33:22.565Z");
});

test("ensureStatusFields sets next_refresh_at when enabled and non-manual", () => {
  const out = ensureStatusFields({
    refresh_enabled: true,
    refresh_interval_minutes: 60,
    refresh_method: "official_api",
  });
  assert.ok(out.next_refresh_at, "next_refresh_at should be set");
});

test("ensureStatusFields leaves next_refresh_at empty for manual", () => {
  const out = ensureStatusFields({
    refresh_enabled: true,
    refresh_interval_minutes: 60,
    refresh_method: "manual",
  });
  assert.equal(out.next_refresh_at, "");
});

test("computeNextRefreshAt returns empty for manual or disabled", () => {
  assert.equal(computeNextRefreshAt({ refresh_method: "manual", refresh_enabled: true, refresh_interval_minutes: 60 }), "");
  assert.equal(computeNextRefreshAt({ refresh_method: "official_api", refresh_enabled: false, refresh_interval_minutes: 60 }), "");
});

test("isDue respects enabled, method and next_refresh_at", () => {
  const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.equal(isDue({ refresh_enabled: true, refresh_method: "official_api", next_refresh_at: past }), true);
  assert.equal(isDue({ refresh_enabled: true, refresh_method: "official_api", next_refresh_at: future }), false);
  assert.equal(isDue({ refresh_enabled: false, refresh_method: "official_api", next_refresh_at: past }), false);
  assert.equal(isDue({ refresh_enabled: true, refresh_method: "manual", next_refresh_at: past }), false);
});

test("refreshPlan manual returns success and no next_refresh_at", async () => {
  const result = await refreshPlan({
    id: "p1",
    source: "claude",
    refresh_method: "manual",
    refresh_enabled: true,
    refresh_interval_minutes: 60,
  });
  assert.equal(result.status, "success");
  assert.equal(result.record.last_refresh_status, "success");
  assert.equal(result.record.next_refresh_at, "");
});

test("refreshPlan official_api fails when no provider adapter", async () => {
  // 使用未注册 adapter 的 source（hermes）
  assert.equal(getProviderAdapter("hermes"), null);
  const result = await refreshPlan({
    id: "p1",
    source: "hermes",
    refresh_method: "official_api",
    refresh_enabled: true,
    refresh_interval_minutes: 60,
    credential_ref: "",
  });
  assert.equal(result.status, "failed");
  assert.ok(result.error);
  assert.equal(result.record.last_refresh_status, "failed");
  assert.ok(result.record.last_refresh_at);
  assert.ok(result.record.next_refresh_at);
});

test("refreshPlan cookie_scrape fails with risk notice", async () => {
  const result = await refreshPlan({
    id: "p1",
    source: "codex",
    refresh_method: "cookie_scrape",
    refresh_enabled: true,
    refresh_interval_minutes: 60,
  });
  assert.equal(result.status, "failed");
  assert.ok(result.record.last_refresh_error);
});

test("refreshPlan official_api uses registered adapter", async () => {
  registerProviderAdapter("codex", async () => ({
    total_quota: 5000,
    used_quota: 1000,
    remaining_quota: 4000,
  }));
  const result = await refreshPlan({
    id: "p1",
    source: "codex",
    refresh_method: "official_api",
    refresh_enabled: true,
    refresh_interval_minutes: 60,
    credential_ref: "codex_auth_json",
    total_quota: 0,
    used_quota: 0,
    remaining_quota: 0,
  });
  assert.equal(result.status, "success");
  assert.equal(result.record.total_quota, 5000);
  assert.equal(result.record.used_quota, 1000);
  assert.equal(result.record.remaining_quota, 4000);
  assert.equal(result.record.last_refresh_status, "success");
});

test("scheduler runDueRefresh refreshes only due plans", async () => {
  // 使用未注册 adapter 的 source（hermes），确保 official_api 走失败分支
  let store = [
    {
      id: "due",
      source: "hermes",
      refresh_enabled: true,
      refresh_method: "official_api",
      refresh_interval_minutes: 60,
      next_refresh_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      total_quota: 0,
      used_quota: 0,
      remaining_quota: 0,
    },
    {
      id: "not-due",
      source: "claude",
      refresh_enabled: true,
      refresh_method: "manual",
      refresh_interval_minutes: 60,
      total_quota: 100,
      used_quota: 10,
      remaining_quota: 90,
    },
  ];
  const scheduler = createScheduler({
    readAll: () => store,
    upsertAll: (records) => { store = records; },
    logger: { error: () => {}, log: () => {} },
  });
  const result = await scheduler.runDueOnce();
  assert.equal(result.refreshed, 1);
  const due = store.find((p) => p.id === "due");
  assert.equal(due.last_refresh_status, "failed"); // 无 adapter 时失败
  // not-due 是 manual，不应被刷新，保持原状（无 last_refresh_status）
  const notDue = store.find((p) => p.id === "not-due");
  assert.notEqual(notDue.last_refresh_status, "success");
  assert.notEqual(notDue.last_refresh_status, "failed");
});

test("scheduler refreshById returns 404 for unknown plan", async () => {
  const scheduler = createScheduler({
    readAll: () => [],
    upsertAll: () => {},
  });
  const result = await scheduler.refreshById("missing");
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 404);
});

test("scheduler refreshById prevents concurrent in-flight for same plan", async () => {
  let resolveAdapter;
  registerProviderAdapter("codex", () => new Promise((resolve) => { resolveAdapter = resolve; }));
  let store = [
    {
      id: "p1",
      source: "codex",
      refresh_enabled: true,
      refresh_method: "official_api",
      refresh_interval_minutes: 60,
      next_refresh_at: new Date(Date.now() - 1000).toISOString(),
      total_quota: 0,
      used_quota: 0,
      remaining_quota: 0,
    },
  ];
  const scheduler = createScheduler({
    readAll: () => store,
    upsertAll: (records) => { store = records; },
    logger: { error: () => {} },
  });
  const first = scheduler.refreshById("p1");
  const second = await scheduler.refreshById("p1");
  assert.equal(second.ok, false);
  assert.equal(second.statusCode, 409);
  resolveAdapter({ total_quota: 1, used_quota: 0, remaining_quota: 1 });
  const firstResult = await first;
  assert.equal(firstResult.ok, true);
});

// ---------------------------------------------------------------------------
// W03-R3D: Detection sync integration tests
// ---------------------------------------------------------------------------

test("R3D refreshPlan with detection_method=official_account returns unsupported and preserves quota", async () => {
  const result = await refreshPlan({
    id: "p-official",
    source: "hermes",
    provider_id: "xiaomi_mimo",
    plan_id: "xiaomi_mimo_standard_monthly",
    plan_label: "Standard（月付）",
    total_quota: 11000000000,
    used_quota: 5000000000,
    remaining_quota: 6000000000,
    expires_at: "2026-12-31",
    refresh_method: "manual",
    refresh_enabled: false,
    detection_method: "official_account",
    detection_config: {
      official_account: {
        provider_home_url: "https://platform.xiaomimimo.com/token-plan",
        account_binding_id: "session-test-001",
      },
    },
    sync_status: "auth_required",
  });

  assert.equal(result.status, "failed", "official_account without data source must return failed status");
  assert.equal(result.record.sync_status, "unsupported", "sync_status must be unsupported when no quota data source");
  assert.equal(result.record.last_error_code, "PROVIDER_UNSUPPORTED", "error code must indicate unsupported");
  assert.ok(result.record.last_error_message, "error message must be set");
  assert.ok(result.record.last_error_message.includes("当前没有可复现官方额度查询能力"), "error message must explain unsupported");

  // Quota must be preserved
  assert.equal(result.record.total_quota, 11000000000, "total_quota must be preserved");
  assert.equal(result.record.used_quota, 5000000000, "used_quota must be preserved");
  assert.equal(result.record.remaining_quota, 6000000000, "remaining_quota must be preserved");
  assert.equal(result.record.expires_at, "2026-12-31", "expires_at must be preserved");
});

test("R3D refreshPlan failed does NOT clear old quota", async () => {
  const result = await refreshPlan({
    id: "p-failed",
    source: "hermes",
    plan_label: "Custom Plan",
    total_quota: 10000,
    used_quota: 3000,
    remaining_quota: 7000,
    expires_at: "2026-08-15",
    refresh_method: "official_api",
    refresh_enabled: true,
    refresh_interval_minutes: 60,
    detection_method: "not_configured",
    provider_reported_at: "2026-06-20T10:00:00Z",
  });

  assert.equal(result.status, "failed", "no provider adapter must return failed");
  assert.equal(result.record.sync_status, "failed");

  // Quota must be preserved
  assert.equal(result.record.total_quota, 10000, "total_quota must be preserved after failed refresh");
  assert.equal(result.record.used_quota, 3000, "used_quota must be preserved after failed refresh");
  assert.equal(result.record.remaining_quota, 7000, "remaining_quota must be preserved after failed refresh");
  assert.equal(result.record.expires_at, "2026-08-15", "expires_at must be preserved after failed refresh");
  assert.equal(result.record.provider_reported_at, "2026-06-20T10:00:00Z", "provider_reported_at must be preserved after failed refresh");

  // Error fields must be set
  assert.ok(result.record.last_error_message, "last_error_message must be set");
  assert.ok(result.record.last_error_code, "last_error_code must be set");
  assert.ok(result.record.last_sync_attempt_at, "last_sync_attempt_at must be updated");
});

test("R3D refreshPlan reauth_required (custom_api 401) does NOT clear old quota", async () => {
  // Spin up a real HTTP server that returns 401, then call refreshPlan
  // with resolveApiKey so the custom_api module actually hits the endpoint.
  const { server, url } = await new Promise((resolve) => {
    const s = http.createServer((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
    });
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      resolve({ server: s, url: `http://127.0.0.1:${addr.port}` });
    });
  });

  try {
    const testApiKey = "sk-test-do-not-leak-this-value";
    const resolveApiKey = () => testApiKey;

    const result = await refreshPlan(
      {
        id: "p-reauth-401",
        source: "hermes",
        provider_id: "xiaomi_mimo",
        plan_label: "Standard（月付）",
        total_quota: 11000000000,
        used_quota: 2000000000,
        remaining_quota: 9000000000,
        expires_at: "2026-07-01",
        refresh_method: "manual",
        refresh_enabled: false,
        detection_method: "custom_api",
        detection_config: {
          custom_api: {
            api_key_ref: "token-plan/xiaomi_mimo/custom-api/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
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
        provider_reported_at: "2026-06-15T08:00:00Z",
      },
      { resolveApiKey },
    );

    // Status must be failed (refreshPlan top-level), sync_status reauth_required
    assert.equal(result.status, "failed", "401 must return top-level failed");
    assert.equal(result.record.sync_status, "reauth_required", "sync_status must be reauth_required");
    assert.equal(result.record.last_error_code, "CUSTOM_API_AUTH_EXPIRED", "error code must be AUTH_EXPIRED");
    assert.ok(result.record.last_error_message.includes("401"), "error message must mention 401");
    assert.ok(result.record.last_error_message.includes("更新 API Key"), "error message must suggest updating API Key");

    // API Key must NOT leak into error messages
    assert.ok(!result.record.last_error_message.includes(testApiKey), "API key must NOT leak");

    // Quota must be preserved
    assert.equal(result.record.total_quota, 11000000000, "total_quota must be preserved");
    assert.equal(result.record.used_quota, 2000000000, "used_quota must be preserved");
    assert.equal(result.record.remaining_quota, 9000000000, "remaining_quota must be preserved");
    assert.equal(result.record.expires_at, "2026-07-01", "expires_at must be preserved");
    assert.equal(result.record.provider_reported_at, "2026-06-15T08:00:00Z", "provider_reported_at must be preserved");
  } finally {
    server.close();
  }
});

test("R3D unsupported does NOT display as success", async () => {
  const result = await refreshPlan({
    id: "p-unsupported",
    source: "hermes",
    provider_id: "xiaomi_mimo",
    plan_id: "xiaomi_mimo_standard_monthly",
    plan_label: "Standard（月付）",
    total_quota: 11000000000,
    used_quota: 1000000000,
    remaining_quota: 10000000000,
    expires_at: "2026-09-01",
    refresh_method: "manual",
    refresh_enabled: false,
    detection_method: "official_account",
    detection_config: {
      official_account: {
        provider_home_url: "https://platform.xiaomimimo.com/token-plan",
        account_binding_id: "session-xyz",
      },
    },
    sync_status: "auth_required",
    last_synced_at: "",
  });

  // sync_status must NOT be "success"
  assert.notEqual(result.record.sync_status, "success", "unsupported must not show as success");
  assert.equal(result.record.sync_status, "unsupported", "sync_status must be unsupported");
  assert.equal(result.record.last_refresh_status, "failed", "last_refresh_status must be failed");

  // last_synced_at must not be updated (no success)
  assert.equal(result.record.last_synced_at, "", "last_synced_at must remain empty when unsupported");
});

test("R3D detection field normalization uses unified statuses for both methods", () => {
  // Verify that both official_account and custom_api detection methods
  // produce records with the same set of detection fields.
  const officialFields = normalizeDetectionFields({
    detection_method: "official_account",
    sync_status: "unsupported",
    last_error_code: "PROVIDER_UNSUPPORTED",
    last_error_message: "当前没有可复现官方额度查询能力",
  });
  assert.equal(officialFields.detection_method, "official_account");
  assert.equal(officialFields.sync_status, "unsupported");
  assert.equal(officialFields.last_error_code, "PROVIDER_UNSUPPORTED");
  assert.equal(officialFields.last_error_message, "当前没有可复现官方额度查询能力");

  const customFields = normalizeDetectionFields({
    detection_method: "custom_api",
    sync_status: "failed",
    last_error_code: "CUSTOM_API_MAPPING_MISSING",
    last_error_message: "自定义 API 响应映射缺失",
  });
  assert.equal(customFields.detection_method, "custom_api");
  assert.equal(customFields.sync_status, "failed");
  assert.equal(customFields.last_error_code, "CUSTOM_API_MAPPING_MISSING");
  assert.equal(customFields.last_error_message, "自定义 API 响应映射缺失");

  // Both should have the same set of fields (not method-specific)
  const officialKeys = Object.keys(officialFields).sort();
  const customKeys = Object.keys(customFields).sort();
  assert.deepEqual(officialKeys, customKeys, "both detection methods must produce same field set");
});

test("official detection selects adapters by provider_id before Agent source", async () => {
  const { fetchGlmQuota } = require("../src/lib/glm-token-plan");
  const payload = {
    code: 200,
    data: {
      level: "pro",
      limits: [
        { type: "TOKENS_LIMIT", unit: 3, usage: 100, currentValue: 20, percentage: 20, nextResetTime: "a" },
        { type: "TOKENS_LIMIT", unit: 6, usage: 500, currentValue: 100, percentage: 20, nextResetTime: "b" },
      ],
    },
  };
  registerProviderAdapter("glm", async () => ({
    quota_windows: (await fetchGlmQuota({
      apiKey: "test",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
      }),
    })).quota_windows,
    provider_reported_at: new Date().toISOString(),
  }));
  const result = await refreshPlan({
    id: "glm-plan",
    source: "hermes",
    provider_id: "glm",
    plan_id: "glm_pro",
    plan_label: "Pro",
    detection_method: "official_account",
    refresh_method: "official_api",
    detection_config: {
      official_account: {
        api_key_ref: "token-plan/glm/usage-api/00000000-0000-4000-8000-000000000001",
      },
    },
  }, {
    resolveApiKey: async () => "test",
  });
  assert.equal(result.status, "success");
  assert.equal(result.record.total_quota, 2000);
  assert.equal(result.record.used_quota, 100);
  assert.equal(result.record.remaining_quota, 400);
  assert.equal(result.record.quota_windows.length, 2);
});

test("official detection refreshes Kimi Code quota via provider adapter", async () => {
  const { parseKimiUsageBody } = require("../src/lib/kimi-token-plan");
  const usagePayload = {
    usage: { limit: "1000", used: "250", remaining: "750", resetTime: "2026-05-04T06:02:56Z" },
    limits: [{
      detail: { limit: "200", used: "40", remaining: "160", resetTime: "2026-05-02T05:02:56Z" },
    }],
  };
  registerProviderAdapter("kimi", async () => ({
    ...parseKimiUsageBody(usagePayload),
    provider_reported_at: new Date().toISOString(),
  }));
  const result = await refreshPlan({
    id: "kimi-plan",
    source: "kimi",
    provider_id: "kimi",
    plan_id: "kimi_code_manual_quota",
    plan_label: "Kimi Code",
    detection_method: "official_account",
    refresh_method: "official_api",
    detection_config: {
      official_account: {
        provider_home_url: "https://www.kimi.com/code",
      },
    },
  });
  assert.equal(result.status, "success");
  assert.equal(result.record.total_quota, 1000);
  assert.equal(result.record.remaining_quota, 750);
  assert.equal(result.record.quota_windows.length, 2);
});

test("official detection refreshes MiniMax token plan via provider adapter", async () => {
  const { parseMiniMaxTokenPlanResponse } = require("../src/lib/minimax-token-plan");
  const payload = {
    base_resp: { status_code: 0 },
    model_remains: [{
      model_name: "MiniMax-M*",
      current_interval_total_count: 1000,
      current_interval_usage_count: 200,
      current_weekly_total_count: 5000,
      current_weekly_usage_count: 1000,
    }],
  };
  registerProviderAdapter("minimax", async () => ({
    ...parseMiniMaxTokenPlanResponse(payload),
    provider_reported_at: new Date().toISOString(),
  }));
  const result = await refreshPlan({
    id: "minimax-plan",
    source: "kilo-code",
    provider_id: "minimax",
    plan_id: "minimax_manual_quota",
    plan_label: "Token Plan",
    detection_method: "official_account",
    refresh_method: "official_api",
    detection_config: {
      official_account: {
        api_key_ref: "token-plan/minimax/token-plan-api/00000000-0000-4000-8000-000000000002",
      },
    },
  }, {
    resolveApiKey: async () => "test",
  });
  assert.equal(result.status, "success");
  assert.equal(result.record.total_quota, 5000);
  assert.equal(result.record.remaining_quota, 4000);
  assert.equal(result.record.quota_windows.length, 2);
});

test("official detection refreshes Aliyun Bailian coding plan via provider adapter", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { parseAliyunBailianQuotaResponse } = require("../src/lib/aliyun-bailian-token-plan");
  const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", "aliyun-bailian-quota-response.json"),
    "utf8",
  ));
  registerProviderAdapter("aliyun_bailian", async () => ({
    ...parseAliyunBailianQuotaResponse(fixture),
    provider_reported_at: new Date().toISOString(),
  }));
  const result = await refreshPlan({
    id: "bailian-plan",
    source: "qwen",
    provider_id: "aliyun_bailian",
    plan_id: "aliyun_bailian_manual_quota",
    plan_label: "Coding Plan",
    detection_method: "official_account",
    refresh_method: "official_api",
    detection_config: {
      official_account: {
        api_key_ref: "token-plan/aliyun_bailian/coding-plan-api/00000000-0000-4000-8000-000000000003",
      },
    },
  }, {
    resolveApiKey: async () => "sk-sp-test",
  });
  assert.equal(result.status, "success");
  assert.equal(result.record.total_quota, 45000);
  assert.equal(result.record.remaining_quota, 35000);
  assert.equal(result.record.quota_windows.length, 2);
});

test("official detection refreshes Codex quota via provider adapter", async () => {
  const { parseCodexUsageBody } = require("../src/lib/codex-token-plan");
  const payload = {
    rate_limit: {
      primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: 1 },
      secondary_window: { used_percent: 60, limit_window_seconds: 604800, reset_at: 2 },
    },
  };
  registerProviderAdapter("codex", async () => ({
    ...parseCodexUsageBody(payload),
    provider_reported_at: new Date().toISOString(),
  }));
  const result = await refreshPlan({
    id: "codex-plan",
    source: "codex",
    provider_id: "codex",
    plan_id: "codex_pro_5x",
    plan_label: "Pro",
    detection_method: "official_account",
    refresh_method: "official_api",
    credential_ref: "codex_auth_json",
    detection_config: {
      official_account: {
        provider_home_url: "https://chatgpt.com/codex",
      },
    },
  });
  assert.equal(result.status, "success");
  assert.equal(result.record.total_quota, 100);
  assert.equal(result.record.remaining_quota, 40);
  assert.equal(result.record.quota_windows.length, 2);
});

test("official detection refreshes Claude quota via provider adapter", async () => {
  const { parseClaudeUsageBody } = require("../src/lib/claude-token-plan");
  const payload = {
    five_hour: { utilization: 0.1 },
    seven_day: { utilization: 30 },
  };
  registerProviderAdapter("claude", async () => ({
    ...parseClaudeUsageBody(payload),
    provider_reported_at: new Date().toISOString(),
  }));
  const result = await refreshPlan({
    id: "claude-plan",
    source: "claude",
    provider_id: "claude",
    plan_id: "claude_pro",
    plan_label: "Pro",
    detection_method: "official_account",
    refresh_method: "official_api",
    credential_ref: "claude_credentials_json",
    detection_config: {
      official_account: {
        claude_account_mode: "official",
        provider_home_url: "https://console.anthropic.com/settings/billing",
      },
    },
  });
  assert.equal(result.status, "success");
  assert.equal(result.record.remaining_quota, 70);
  assert.equal(result.record.quota_windows.length, 2);
});

test("Claude routing plan refresh returns unsupported without faking quota", async () => {
  const { createClaudeProviderAdapter } = require("../src/lib/claude-token-plan");
  registerProviderAdapter("claude", createClaudeProviderAdapter());
  const result = await refreshPlan({
    id: "claude-routing",
    source: "claude",
    provider_id: "claude",
    plan_id: "claude_routing",
    plan_label: "Routing",
    total_quota: 1000,
    used_quota: 100,
    remaining_quota: 900,
    detection_method: "official_account",
    refresh_method: "official_api",
    credential_ref: "claude_credentials_json",
    detection_config: {
      official_account: {
        claude_account_mode: "routing",
      },
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.record.sync_status, "unsupported");
  assert.equal(result.record.remaining_quota, 900);
});

test("official detection refreshes Cursor quota via provider adapter", async () => {
  const { parseCursorUsageBody } = require("../src/lib/cursor-token-plan");
  const payload = {
    membershipType: "pro",
    billingCycleEnd: "2026-08-01T00:00:00.000Z",
    individualUsage: { plan: { totalPercentUsed: 42 } },
  };
  registerProviderAdapter("cursor", async () => ({
    ...parseCursorUsageBody(payload),
    provider_reported_at: new Date().toISOString(),
  }));
  const result = await refreshPlan({
    id: "cursor-plan",
    source: "cursor",
    provider_id: "cursor",
    plan_id: "cursor_pro",
    plan_label: "Pro",
    detection_method: "official_account",
    refresh_method: "official_api",
    detection_config: {
      official_account: {
        provider_home_url: "https://www.cursor.com/settings",
      },
    },
  });
  assert.equal(result.status, "success");
  assert.equal(result.record.used_quota, 42);
  assert.equal(result.record.quota_windows.length, 1);
  assert.equal(result.record.quota_windows[0].kind, "rolling_weekly");
});
