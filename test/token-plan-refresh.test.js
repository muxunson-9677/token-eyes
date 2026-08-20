const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
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
  validateQuotaUnit,
  validateProviderQuotaNumber,
  validateProviderQuotaWindows,
  isValidProviderExpiry,
  mergeAdapterResultIntoRecord,
  refreshPlan,
  createScheduler,
  registerProviderAdapter,
  getProviderAdapter,
} = require("../src/lib/token-plan-refresh");

test("DATA-01 refresh snapshot validators are shared with direct POST validation", () => {
  assert.equal(typeof validateQuotaUnit, "function");
  assert.equal(typeof validateProviderQuotaNumber, "function");
  assert.equal(typeof validateProviderQuotaWindows, "function");
  assert.equal(typeof isValidProviderExpiry, "function");
});

const TASK4_OLD_REPORTED_AT = "2026-08-19T00:00:00.000Z";
const TASK4_FRESH_REPORTED_AT = "2026-08-20T00:00:00.000Z";
const TASK4_NOW = "2026-08-20T00:00:01.000Z";

function createTask4Plan(overrides = {}) {
  return {
    id: "task4-plan",
    source: "task4-provider",
    quota_unit: "tokens",
    total_quota: 100,
    used_quota: 50,
    remaining_quota: 50,
    expires_at: "2026-12-31",
    provider_reported_at: TASK4_OLD_REPORTED_AT,
    provider_reported_fields: ["total_quota", "used_quota", "remaining_quota"],
    refresh_method: "official_api",
    refresh_enabled: true,
    refresh_interval_minutes: 60,
    ...overrides,
  };
}

function mergeTask4Snapshot(snapshot, planOverrides = {}) {
  const plan = createTask4Plan(planOverrides);
  return {
    ...plan,
    ...mergeAdapterResultIntoRecord(plan, snapshot, TASK4_NOW),
  };
}

test("DATA-06 Xiaomi temporary is a canonical sync status", () => {
  assert.equal(pickSyncStatus("temporary"), "temporary");
  assert.equal(pickSyncStatus(" TEMPORARY "), "temporary");
});

test("DATA-01 refresh adapter treats fresh 100/0 and 0/100 as authoritative reports", () => {
  const exhausted = mergeTask4Snapshot({
    total_quota: 100,
    used_quota: 100,
    remaining_quota: 0,
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  });
  assert.equal(exhausted.used_quota, 100);
  assert.equal(exhausted.remaining_quota, 0);
  assert.deepEqual(exhausted.provider_reported_fields, [
    "total_quota",
    "used_quota",
    "remaining_quota",
  ]);

  const unused = mergeTask4Snapshot({
    total_quota: 100,
    used_quota: 0,
    remaining_quota: 100,
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  });
  assert.equal(unused.used_quota, 0);
  assert.equal(unused.remaining_quota, 100);
  assert.deepEqual(unused.provider_reported_fields, [
    "total_quota",
    "used_quota",
    "remaining_quota",
  ]);
});

test("DATA-01 refresh adapter distinguishes absent, null, and explicit zero quota fields", () => {
  const absent = mergeTask4Snapshot({ provider_reported_at: TASK4_FRESH_REPORTED_AT });
  assert.equal(absent.used_quota, 50);
  assert.equal(absent.remaining_quota, 50);
  assert.equal(absent.provider_reported_at, TASK4_OLD_REPORTED_AT);
  assert.deepEqual(absent.provider_reported_fields, ["total_quota", "used_quota", "remaining_quota"]);

  const nullValue = mergeTask4Snapshot({
    used_quota: null,
    remaining_quota: null,
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  });
  assert.equal(nullValue.used_quota, 50);
  assert.equal(nullValue.remaining_quota, 50);
  assert.equal(nullValue.provider_reported_at, TASK4_OLD_REPORTED_AT);
  assert.deepEqual(nullValue.provider_reported_fields, ["total_quota", "used_quota", "remaining_quota"]);

  const explicitZero = mergeTask4Snapshot({
    used_quota: 0,
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  });
  assert.equal(explicitZero.used_quota, 0);
  assert.equal(explicitZero.remaining_quota, 50);
  assert.equal(explicitZero.provider_reported_at, TASK4_FRESH_REPORTED_AT);
  assert.deepEqual(explicitZero.provider_reported_fields, ["used_quota"]);
});

for (const [label, snapshot, planOverrides] of [
  ["numeric strings", { used_quota: "0" }],
  ["negative values", { used_quota: -1 }],
  ["NaN", { used_quota: Number.NaN }],
  ["Infinity", { used_quota: Number.POSITIVE_INFINITY }],
  ["values above Number.MAX_SAFE_INTEGER", { total_quota: Number.MAX_SAFE_INTEGER + 1 }],
  ["fractional count values", { used_quota: 0.5 }],
  ["percent values above 100", { used_quota: 100.0001 }, { quota_unit: "percent" }],
]) {
  test(`DATA-01 refresh adapter rejects ${label}`, () => {
    assert.throws(
      () => mergeTask4Snapshot({
        ...snapshot,
        provider_reported_at: TASK4_FRESH_REPORTED_AT,
      }, planOverrides),
      (error) => error?.code === "PROVIDER_SNAPSHOT_INVALID",
    );
  });
}

test("DATA-01 invalid provider snapshot preserves last-good values and reported time", async () => {
  registerProviderAdapter("task4-invalid-provider", async () => ({
    total_quota: 100,
    used_quota: "50",
    remaining_quota: 50,
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  }));

  const result = await refreshPlan(createTask4Plan({
    source: "task4-invalid-provider",
    sync_status: "success",
  }), { now: TASK4_NOW });

  assert.equal(result.status, "failed");
  assert.equal(result.record.sync_status, "failed");
  assert.equal(result.record.last_error_code, "PROVIDER_SNAPSHOT_INVALID");
  assert.equal(result.record.total_quota, 100);
  assert.equal(result.record.used_quota, 50);
  assert.equal(result.record.remaining_quota, 50);
  assert.equal(result.record.provider_reported_at, TASK4_OLD_REPORTED_AT);
  assert.deepEqual(result.record.provider_reported_fields, [
    "total_quota",
    "used_quota",
    "remaining_quota",
  ]);
});

test("DATA-01 percent snapshots preserve valid fractional provider values", () => {
  const merged = mergeTask4Snapshot({
    total_quota: 100,
    used_quota: 33.52173913043478,
    remaining_quota: 66.47826086956522,
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  }, { quota_unit: "percent" });

  assert.equal(merged.total_quota, 100);
  assert.equal(merged.used_quota, 33.52173913043478);
  assert.equal(merged.remaining_quota, 66.47826086956522);
});

test("DATA-01 CNY snapshots preserve fractional JSON numbers without count coercion", () => {
  const merged = mergeTask4Snapshot({
    quota_unit: "CNY",
    total_quota: 20.5,
    used_quota: 12.34,
    remaining_quota: 8.16,
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  }, { quota_unit: "CNY" });

  assert.equal(merged.total_quota, 20.5);
  assert.equal(merged.used_quota, 12.34);
  assert.equal(merged.remaining_quota, 8.16);
});

test("DATA-01 currency quota units use an explicit CNY and USD allowlist", () => {
  assert.equal(validateQuotaUnit("CNY", "quota_unit"), "CNY");
  assert.equal(validateQuotaUnit("USD", "quota_unit"), "USD");
  assert.throws(
    () => validateQuotaUnit("EUR", "quota_unit"),
    (error) => error?.code === "PROVIDER_SNAPSHOT_INVALID",
  );
});

for (const [label, value] of [
  ["numeric strings", "12.34"],
  ["negative values", -0.01],
  ["values above Number.MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER + 1],
]) {
  test(`DATA-01 CNY snapshots reject ${label}`, () => {
    assert.throws(
      () => mergeTask4Snapshot({
        quota_unit: "CNY",
        used_quota: value,
        provider_reported_at: TASK4_FRESH_REPORTED_AT,
      }, { quota_unit: "CNY" }),
      (error) => error?.code === "PROVIDER_SNAPSHOT_INVALID",
    );
  });
}

test("DATA-01 CNY quota windows retain their currency unit and fractional values", () => {
  const currencyWindow = {
    kind: "api",
    unit: "CNY",
    total: 20.5,
    used: 12.34,
    remaining: 8.16,
    percentage: 60.19512195121951,
    resets_at: "2026-08-27T00:00:00.000Z",
  };
  const merged = mergeTask4Snapshot({
    quota_windows: [currencyWindow],
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  }, { quota_unit: "CNY" });

  assert.deepEqual(merged.quota_windows, [currencyWindow]);
});

test("DATA-01 expiry absent and null preserve last-good without advancing freshness", () => {
  for (const snapshot of [
    { provider_reported_at: TASK4_FRESH_REPORTED_AT },
    { expires_at: null, provider_reported_at: TASK4_FRESH_REPORTED_AT },
  ]) {
    const merged = mergeTask4Snapshot(snapshot);
    assert.equal(merged.expires_at, "2026-12-31");
    assert.equal(merged.provider_reported_at, TASK4_OLD_REPORTED_AT);
    assert.deepEqual(merged.provider_reported_fields, ["total_quota", "used_quota", "remaining_quota"]);
  }
});

test("DATA-01 valid expiry overwrites last-good and is marked provider-reported", () => {
  const merged = mergeTask4Snapshot({
    expires_at: "2027-01-31T12:30:00Z",
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  });
  assert.equal(merged.expires_at, "2027-01-31T12:30:00Z");
  assert.equal(merged.provider_reported_at, TASK4_FRESH_REPORTED_AT);
  assert.deepEqual(merged.provider_reported_fields, ["expires_at"]);
});

test("DATA-01 explicit empty expiry clears only when provider_reported_fields owns it", () => {
  const omittedOwnership = mergeTask4Snapshot({
    expires_at: "",
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  });
  assert.equal(omittedOwnership.expires_at, "2026-12-31");
  assert.equal(omittedOwnership.provider_reported_at, TASK4_OLD_REPORTED_AT);

  const explicitOwnership = mergeTask4Snapshot({
    expires_at: "",
    provider_reported_fields: ["expires_at"],
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  });
  assert.equal(explicitOwnership.expires_at, "");
  assert.equal(explicitOwnership.provider_reported_at, TASK4_FRESH_REPORTED_AT);
  assert.deepEqual(explicitOwnership.provider_reported_fields, ["expires_at"]);
});

test("DATA-01 invalid non-empty expiry rejects the snapshot", () => {
  assert.throws(
    () => mergeTask4Snapshot({
      expires_at: "2026-02-30",
      provider_reported_at: TASK4_FRESH_REPORTED_AT,
    }),
    (error) => error?.code === "PROVIDER_SNAPSHOT_INVALID",
  );
});

test("DATA-01 partial remaining zero preserves old used and reports only remaining as fresh", () => {
  const merged = mergeTask4Snapshot({
    remaining_quota: 0,
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  });

  assert.equal(merged.total_quota, 100);
  assert.equal(merged.used_quota, 50);
  assert.equal(merged.remaining_quota, 0);
  assert.equal(merged.provider_reported_at, TASK4_FRESH_REPORTED_AT);
  assert.deepEqual(merged.provider_reported_fields, ["remaining_quota"]);
});

test("DATA-01 complete percent window uses arithmetic tolerance without rewriting provider values", () => {
  const providerWindow = {
    kind: "rolling_weekly",
    unit: "percent",
    total: 100,
    used: 33.33333333333333,
    remaining: 66.66666666666666,
    percentage: 33.33333333333333,
    resets_at: "2026-08-27T00:00:00.000Z",
  };
  const merged = mergeTask4Snapshot({
    quota_windows: [providerWindow],
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  }, { quota_unit: "percent" });

  assert.deepEqual(merged.quota_windows, [providerWindow]);
  assert.equal(merged.quota_windows[0].used, providerWindow.used);
  assert.equal(merged.quota_windows[0].remaining, providerWindow.remaining);
  assert.deepEqual(merged.provider_reported_fields, ["quota_windows"]);
});

test("DATA-01 heterogeneous top-level provider_count and percent window keep independent units", () => {
  const percentWindow = {
    kind: "rolling_weekly",
    unit: "percent",
    total: 100,
    used: 40,
    remaining: 60,
    percentage: 40,
    resets_at: "2026-08-27T00:00:00.000Z",
  };
  const merged = mergeTask4Snapshot({
    quota_unit: "provider_count",
    total_quota: 1000,
    used_quota: 300,
    remaining_quota: 700,
    quota_windows: [percentWindow],
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  }, { quota_unit: "provider_count" });

  assert.equal(merged.total_quota, 1000, "explicit top-level total must not be replaced by a window lane");
  assert.equal(merged.used_quota, 300, "explicit top-level used must keep provider_count semantics");
  assert.equal(merged.remaining_quota, 700, "explicit top-level remaining must keep provider_count semantics");
  assert.deepEqual(merged.quota_windows, [percentWindow]);
  assert.deepEqual(merged.provider_reported_fields, [
    "total_quota",
    "used_quota",
    "remaining_quota",
    "quota_windows",
  ]);
});

test("DATA-01 quota-window-only snapshots preserve independent top-level provider_count fields", () => {
  const providerWindow = {
    kind: "rolling_weekly",
    unit: "percent",
    total: 100,
    used: 40,
    remaining: 60,
    resets_at: "2026-08-27T00:00:00.000Z",
  };
  const merged = mergeTask4Snapshot({
    quota_windows: [providerWindow],
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  }, {
    quota_unit: "provider_count",
    total_quota: 1000,
    used_quota: 300,
    remaining_quota: 700,
  });

  assert.equal(merged.total_quota, 1000);
  assert.equal(merged.used_quota, 300);
  assert.equal(merged.remaining_quota, 700);
  assert.deepEqual(merged.quota_windows, [providerWindow]);
  assert.equal(Object.prototype.hasOwnProperty.call(merged.quota_windows[0], "percentage"), false);
  assert.deepEqual(merged.provider_reported_fields, ["quota_windows"]);
});

test("DATA-01 quota-window-only snapshots never derive absent same-unit top-level fields", () => {
  const plan = createTask4Plan({
    quota_unit: "tokens",
    provider_reported_fields: [],
  });
  delete plan.total_quota;
  delete plan.used_quota;
  delete plan.remaining_quota;

  const merged = mergeAdapterResultIntoRecord(plan, {
    quota_windows: [{
      kind: "rolling_weekly",
      unit: "tokens",
      total: 1000,
      used: 300,
      remaining: 700,
      resets_at: "2026-08-27T00:00:00.000Z",
    }],
    provider_reported_at: TASK4_FRESH_REPORTED_AT,
  }, TASK4_NOW);

  assert.equal(merged.total_quota, undefined);
  assert.equal(merged.used_quota, undefined);
  assert.equal(merged.remaining_quota, undefined);
  assert.deepEqual(merged.provider_reported_fields, ["quota_windows"]);
});

for (const [label, quotaUnit] of [
  ["unknown", "unknown"],
  ["empty", ""],
]) {
  test(`DATA-01 expiry-only snapshot ignores ${label} unused quota unit`, () => {
    const merged = mergeTask4Snapshot({
      expires_at: "2027-03-31",
      provider_reported_at: TASK4_FRESH_REPORTED_AT,
    }, { quota_unit: quotaUnit });

    assert.equal(merged.total_quota, 100);
    assert.equal(merged.used_quota, 50);
    assert.equal(merged.remaining_quota, 50);
    assert.equal(merged.expires_at, "2027-03-31");
    assert.equal(merged.provider_reported_at, TASK4_FRESH_REPORTED_AT);
    assert.deepEqual(merged.provider_reported_fields, ["expires_at"]);
  });
}

for (const [label, window] of [
  ["window numeric strings", { unit: "tokens", total: 100, used: "50", remaining: 50, percentage: 50 }],
  ["window negative values", { unit: "tokens", total: 100, used: -1, remaining: 101, percentage: 0 }],
  ["window NaN", { unit: "tokens", total: 100, used: Number.NaN, remaining: 100, percentage: 0 }],
  ["window Infinity", { unit: "tokens", total: 100, used: Number.POSITIVE_INFINITY, remaining: 0, percentage: 100 }],
  ["window values above Number.MAX_SAFE_INTEGER", { unit: "tokens", total: Number.MAX_SAFE_INTEGER + 1, used: 0, remaining: Number.MAX_SAFE_INTEGER + 1, percentage: 0 }],
  ["fractional count window values", { unit: "provider_count", total: 10, used: 0.5, remaining: 9.5, percentage: 5 }],
  ["percent window values above 100", { unit: "percent", total: 100, used: 100.1, remaining: 0, percentage: 100 }],
  ["window percentage above 100", { unit: "tokens", total: 100, used: 100, remaining: 0, percentage: 100.1 }],
  ["window arithmetic mismatch", { unit: "tokens", total: 100, used: 40, remaining: 50, percentage: 40 }],
  ["unsupported window unit", { unit: "mystery", total: 100, used: 50, remaining: 50, percentage: 50 }],
]) {
  test(`DATA-01 refresh adapter rejects ${label}`, () => {
    assert.throws(
      () => mergeTask4Snapshot({
        quota_windows: [{
          kind: "rolling_weekly",
          resets_at: TASK4_FRESH_REPORTED_AT,
          ...window,
        }],
        provider_reported_at: TASK4_FRESH_REPORTED_AT,
      }),
      (error) => error?.code === "PROVIDER_SNAPSHOT_INVALID",
    );
  });
}

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
    { kind: "total", lane_id: "overall", unit: "percent", total: 100, used: 33.52173913043478, remaining: 66.47826086956522, percentage: 33.52173913043478, resets_at: "2026-08-06T14:31:29.000Z" },
    { kind: "auto_composer", lane_id: "auto", unit: "percent", total: 100, used: 27.82, remaining: 72.18, percentage: 27.82, resets_at: "2026-08-06T14:31:29.000Z" },
    { kind: "api", lane_id: "api", unit: "percent", total: 100, used: 71.53333333333333, remaining: 28.46666666666667, percentage: 71.53333333333333, resets_at: "2026-08-06T14:31:29.000Z" },
  ]);

  assert.equal(windows.length, 3);
  assert.deepEqual(windows.map((window) => window.kind), ["total", "auto_composer", "api"]);
  assert.equal(windows[0].unit, "percent");
  assert.equal(windows[0].used, 33.52173913043478);
  assert.equal(windows[1].used, 27.82);
  assert.equal(windows[2].used, 71.53333333333333);
  assert.deepEqual(windows.map((window) => window.lane_id), ["overall", "auto", "api"]);
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

function createTask5CustomApiPlan(requestUrl, overrides = {}) {
  return createTask4Plan({
    source: "task4-custom-api",
    provider_id: "task4-custom-api",
    quota_unit: "provider_count",
    total_quota: 1000,
    used_quota: 300,
    remaining_quota: 700,
    sync_status: "success",
    detection_method: "custom_api",
    refresh_method: "manual",
    refresh_enabled: false,
    detection_config: {
      custom_api: {
        api_key_ref: "token-plan/task4-custom-api/custom-api/00000000-0000-4000-8000-000000000004",
        api_format: "json_path",
        request_url: requestUrl,
        method: "GET",
        response_mapping: {
          total_quota_path: "$.total",
          used_quota_path: "$.used",
          remaining_quota_path: "$.remaining",
          expires_at_path: "$.expires_at",
        },
      },
    },
    ...overrides,
  });
}

function createTask5InjectedRequest(responseBody, calls) {
  return (options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => {
      queueMicrotask(() => {
        calls.push(options);
        const response = Readable.from([Buffer.from(JSON.stringify(responseBody))]);
        response.statusCode = 200;
        response.headers = { "content-type": "application/json" };
        callback(response);
      });
    };
    return request;
  };
}

function task5LoopbackLookup(_hostname, options, callback) {
  assert.deepEqual(options, { all: true, verbatim: true });
  callback(null, [{ address: "127.0.0.1", family: 4 }]);
}

test("Task 5 refreshPlan keeps production default false and rejects HTTP before injected I/O", async () => {
  let dnsCalls = 0;
  let requestCalls = 0;
  const result = await refreshPlan(createTask5CustomApiPlan("http://quota.test/quota"), {
    now: TASK4_NOW,
    resolveApiKey: async () => "task5-fixture-key",
    dnsLookup(_hostname, _options, callback) {
      dnsCalls += 1;
      callback(null, [{ address: "127.0.0.1", family: 4 }]);
    },
    requestImpl() {
      requestCalls += 1;
      throw new Error("production HTTP request must not be sent");
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.record.sync_status, "failed");
  assert.equal(dnsCalls, 0);
  assert.equal(requestCalls, 0);
});

test("Task 5 refreshPlan forwards only explicit custom API outbound test seams", async () => {
  const requestCalls = [];
  const result = await refreshPlan(createTask5CustomApiPlan("http://quota.test/quota"), {
    now: TASK4_NOW,
    resolveApiKey: async () => "task5-fixture-key",
    testMode: true,
    dnsLookup: task5LoopbackLookup,
    requestImpl: createTask5InjectedRequest({ total: 1000, used: 300, remaining: 700 }, requestCalls),
  });

  assert.equal(result.status, "success");
  assert.equal(result.record.sync_status, "success");
  assert.equal(requestCalls.length, 1);
});

test("Task 5 refreshPlan forwards an explicit custom API response limit", async () => {
  const requestCalls = [];
  const result = await refreshPlan(createTask5CustomApiPlan("http://quota.test/quota"), {
    now: TASK4_NOW,
    resolveApiKey: async () => "task5-fixture-key",
    testMode: true,
    dnsLookup: task5LoopbackLookup,
    requestImpl: createTask5InjectedRequest({ total: 1000, used: 300, remaining: 700 }, requestCalls),
    maxResponseBytes: 1,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.record.sync_status, "failed");
  assert.equal(requestCalls.length, 1);
});

test("Task 5 scheduler forwards explicit custom API outbound test seams to refreshPlan", async () => {
  const requestCalls = [];
  let records = [createTask5CustomApiPlan("http://quota.test/quota")];
  const scheduler = createScheduler({
    readAll: () => records,
    upsertAll: (next) => { records = next; },
    resolveApiKey: async () => "task5-fixture-key",
    testMode: true,
    dnsLookup: task5LoopbackLookup,
    requestImpl: createTask5InjectedRequest({ total: 1000, used: 300, remaining: 700 }, requestCalls),
  });

  const result = await scheduler.refreshById(records[0].id);
  assert.equal(result.ok, true);
  assert.equal(result.plan.sync_status, "success");
  assert.equal(requestCalls.length, 1);
});

test("Task 5 scheduler keeps production default false and rejects HTTP before injected I/O", async () => {
  let dnsCalls = 0;
  let requestCalls = 0;
  let records = [createTask5CustomApiPlan("http://quota.test/quota")];
  const scheduler = createScheduler({
    readAll: () => records,
    upsertAll: (next) => { records = next; },
    resolveApiKey: async () => "task5-fixture-key",
    dnsLookup(_hostname, _options, callback) {
      dnsCalls += 1;
      callback(null, [{ address: "127.0.0.1", family: 4 }]);
    },
    requestImpl() {
      requestCalls += 1;
      throw new Error("production HTTP request must not be sent");
    },
  });

  const result = await scheduler.refreshById(records[0].id);
  assert.equal(result.ok, true);
  assert.equal(result.plan.sync_status, "failed");
  assert.equal(dnsCalls, 0);
  assert.equal(requestCalls, 0);
});

async function refreshTask4CustomApiResponse(responseBody, planOverrides = {}) {
  const { server, url } = await new Promise((resolve) => {
    const instance = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(responseBody));
    });
    instance.listen(0, "127.0.0.1", () => {
      const address = instance.address();
      resolve({ server: instance, url: `http://127.0.0.1:${address.port}` });
    });
  });

  try {
    return await refreshPlan(createTask5CustomApiPlan(`${url}/quota`, planOverrides), {
      now: TASK4_NOW,
      resolveApiKey: async () => "task4-fixture-key",
      testMode: true,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

for (const [label, responseBody, rawValue] of [
  ["remote numeric strings", { total: "1000", used: 300, remaining: 700 }, "1000"],
  ["remote negative numbers", { total: 1000, used: -1, remaining: 1001 }, "-1"],
  ["remote unsafe integers", {
    total: Number.MAX_SAFE_INTEGER + 1,
    used: 0,
    remaining: Number.MAX_SAFE_INTEGER + 1,
  }, String(Number.MAX_SAFE_INTEGER + 1)],
  ["remote invalid expiry", {
    total: 1000,
    used: 300,
    remaining: 700,
    expires_at: "PRIVATE_INVALID_EXPIRY_SENTINEL",
  }, "PRIVATE_INVALID_EXPIRY_SENTINEL"],
]) {
  test(`DATA-01 custom API rejects ${label} without advancing last-good provider time`, async () => {
    const result = await refreshTask4CustomApiResponse(responseBody);

    assert.equal(result.status, "failed");
    assert.equal(result.record.sync_status, "failed");
    assert.equal(result.record.total_quota, 1000);
    assert.equal(result.record.used_quota, 300);
    assert.equal(result.record.remaining_quota, 700);
    assert.equal(result.record.expires_at, "2026-12-31");
    assert.equal(result.record.provider_reported_at, TASK4_OLD_REPORTED_AT);
    assert.deepEqual(result.record.provider_reported_fields, [
      "total_quota",
      "used_quota",
      "remaining_quota",
    ]);
    assert.ok(result.record.last_error_code);
    assert.equal(result.record.last_error_message.includes(rawValue), false);
  });
}

test("DATA-01 custom API preserves fractional CNY JSON numbers through canonical merge", async () => {
  const result = await refreshTask4CustomApiResponse({
    total: 20.5,
    used: 12.34,
    remaining: 8.16,
  }, {
    quota_unit: "CNY",
    total_quota: 10,
    used_quota: 4,
    remaining_quota: 6,
  });

  assert.equal(result.status, "success");
  assert.equal(result.record.total_quota, 20.5);
  assert.equal(result.record.used_quota, 12.34);
  assert.equal(result.record.remaining_quota, 8.16);
  assert.equal(result.record.expires_at, "2026-12-31");
  assert.notEqual(result.record.provider_reported_at, TASK4_OLD_REPORTED_AT);
  assert.deepEqual(result.record.provider_reported_fields, [
    "total_quota",
    "used_quota",
    "remaining_quota",
  ]);
});

test("DATA-01 custom API partial snapshot updates only explicit fields and freshness ownership", async () => {
  const result = await refreshTask4CustomApiResponse({ remaining: 0 });

  assert.equal(result.status, "success");
  assert.equal(result.record.total_quota, 1000);
  assert.equal(result.record.used_quota, 300);
  assert.equal(result.record.remaining_quota, 0);
  assert.equal(result.record.expires_at, "2026-12-31");
  assert.notEqual(result.record.provider_reported_at, TASK4_OLD_REPORTED_AT);
  assert.deepEqual(result.record.provider_reported_fields, ["remaining_quota"]);
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
      { resolveApiKey, testMode: true },
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

test("DATA-02 GLM live weekly window exclusively owns the top-level quota triple", async () => {
  const { createGlmProviderAdapter } = require("../src/lib/glm-token-plan");
  const payload = {
    code: 200,
    data: {
      level: "max",
      limits: [
        { type: "TOKENS_LIMIT", unit: 3, usage: 100, currentValue: 20, percentage: 20, nextResetTime: "a" },
        { type: "TOKENS_LIMIT", unit: 6, usage: 500, currentValue: 100, percentage: 20, nextResetTime: "b" },
      ],
    },
  };
  registerProviderAdapter("glm", createGlmProviderAdapter({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
    }),
  }));
  const result = await refreshPlan({
    id: "glm-plan",
    source: "hermes",
    provider_id: "glm",
    plan_id: "glm_pro",
    plan_label: "Pro",
    entitlement_revision: "legacy_v2_prompts",
    entitlement_windows: [
      { kind: "rolling_5_hour", unit: "prompts", total: 400 },
      { kind: "rolling_weekly", unit: "prompts", total: 2000 },
    ],
    quota_unit: "prompts",
    total_quota: 2000,
    used_quota: 12,
    remaining_quota: 1988,
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
  const weekly = result.record.quota_windows.find((window) => window.kind === "rolling_weekly");
  assert.deepEqual(
    {
      unit: result.record.quota_unit,
      total: result.record.total_quota,
      used: result.record.used_quota,
      remaining: result.record.remaining_quota,
    },
    {
      unit: weekly.unit,
      total: weekly.total,
      used: weekly.used,
      remaining: weekly.remaining,
    },
  );
  assert.deepEqual(result.record.provider_reported_fields, [
    "total_quota",
    "used_quota",
    "remaining_quota",
    "quota_windows",
  ]);
  assert.equal(result.record.quota_unit, "tokens");
  assert.equal(result.record.quota_kind, "rolling_window");
  assert.equal(result.record.quota_source, "provider_reported");
  assert.equal(result.record.total_quota_display, undefined);
  assert.equal(result.record.total_quota, 500);
  assert.equal(result.record.used_quota, 100);
  assert.equal(result.record.remaining_quota, 400);
  assert.equal(result.record.quota_windows.length, 2);
  assert.equal(result.record.entitlement_revision, "legacy_v2_prompts");
  assert.equal(result.record.entitlement_windows[1].unit, "prompts");
  assert.equal(result.record.plan_id, "glm_pro", "provider tier hints must not half-migrate entitlement state");
});

test("DATA-02 GLM missing API key never backfills static entitlement into live top-level quota", async () => {
  const { createGlmProviderAdapter } = require("../src/lib/glm-token-plan");
  registerProviderAdapter("glm", createGlmProviderAdapter());
  const result = await refreshPlan({
    id: "glm-no-live-plan",
    source: "hermes",
    provider_id: "glm",
    plan_id: "glm_lite",
    plan_label: "Lite",
    entitlement_revision: "current_v3_points",
    entitlement_windows: [
      { kind: "rolling_5_hour", unit: "points", total: 2000 },
      { kind: "rolling_weekly", unit: "points", total: 10000 },
    ],
    detection_method: "official_account",
    refresh_method: "official_api",
    detection_config: { official_account: { api_key_ref: "" } },
  }, {
    resolveApiKey: async () => "",
  });
  assert.equal(result.status, "failed");
  assert.equal(result.record.sync_status, "not_configured");
  for (const field of ["total_quota", "used_quota", "remaining_quota"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(result.record, field), false);
  }
  assert.equal(result.record.entitlement_revision, "current_v3_points");
  assert.equal(result.record.quota_source, undefined);
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
      current_interval_total_count: 100,
      current_interval_usage_count: 101,
      current_weekly_total_count: 100,
      current_weekly_usage_count: 101,
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
  assert.equal(result.record.quota_unit, "provider_count");
  assert.equal(result.record.total_quota, 100);
  assert.equal(result.record.used_quota, 100);
  assert.equal(result.record.remaining_quota, 0);
  assert.equal(result.record.quota_windows.length, 2);
  for (const window of result.record.quota_windows) {
    assert.equal(window.unit, "provider_count");
    assert.equal(window.total, 100);
    assert.equal(window.used, 100);
    assert.equal(window.remaining, 0);
    assert.equal(window.percentage, 100);
  }
  assert.equal(Object.keys(result.record).some((key) => /overage|token_conversion/i.test(key)), false);
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
  assert.equal(result.record.quota_unit, "percent");
  assert.equal(result.record.quota_windows.length, 2);
  assert.equal(result.record.quota_windows[1].unit, result.record.quota_unit);
  assert.equal(result.record.quota_windows[1].used, result.record.used_quota);
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
  assert.equal(result.record.quota_windows[0].kind, "total");
  assert.equal(result.record.quota_windows[0].lane_id, "overall");
});

test("Task 8 Cursor lane-only refresh does not mark an invented top-level headline fresh", async () => {
  const { parseCursorUsageBody } = require("../src/lib/cursor-token-plan");
  registerProviderAdapter("cursor", async () => ({
    ...parseCursorUsageBody({
      membershipType: "pro",
      billingCycleEnd: "2026-08-01T00:00:00.000Z",
      individualUsage: { plan: { autoPercentUsed: 10.25, apiPercentUsed: 70.75 } },
    }),
    provider_reported_at: "2026-08-20T12:00:00.000Z",
  }));

  const result = await refreshPlan({
    id: "cursor-lanes-only",
    source: "cursor",
    provider_id: "cursor",
    plan_id: "cursor_pro",
    plan_label: "Pro",
    quota_unit: "percent",
    total_quota: 100,
    used_quota: 40,
    remaining_quota: 60,
    provider_reported_fields: ["total_quota", "used_quota", "remaining_quota"],
    detection_method: "official_account",
    refresh_method: "official_api",
  });

  assert.equal(result.status, "success");
  assert.equal(result.record.total_quota, 100);
  assert.equal(result.record.used_quota, 40);
  assert.equal(result.record.remaining_quota, 60);
  assert.deepEqual(result.record.provider_reported_fields, ["quota_windows"]);
  assert.deepEqual(result.record.quota_windows.map((window) => window.lane_id), ["auto", "api"]);
});
