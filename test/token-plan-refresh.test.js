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
  refreshPlan,
  createScheduler,
  registerProviderAdapter,
  getProviderAdapter,
} = require("../src/lib/token-plan-refresh");

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
