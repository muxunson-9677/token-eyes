const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  normalizeRefreshFields,
  ensureStatusFields,
  computeNextRefreshAt,
  isDue,
  pickIntervalMinutes,
  pickMethod,
  pickCredentialRef,
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
