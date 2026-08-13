"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ZCODE_BALANCE_URL,
  ZcodeTokenPlanError,
  mapZcodeErrorCode,
  deriveZcodeKey,
  encryptZcodeValue,
  decryptZcodeValue,
  isEncryptedValue,
  readZcodeJwt,
  parseZcodeBalanceResponse,
  fetchZcodeQuota,
  createZcodeProviderAdapter,
} = require("../src/lib/zcode-token-plan");

const balancePayload = {
  code: 0,
  msg: "success",
  data: {
    plans: [
      { plan_id: "pro", name: "ZCode Pro", status: "active" },
      { plan_id: "lite", name: "ZCode Lite", status: "expired" },
    ],
    balances: [
      {
        model: "glm-4.6",
        total_units: 1000,
        used_units: 250,
        remaining_units: 750,
        period_end: "2026-08-20T00:00:00Z",
      },
      {
        model: "glm-4.5-air",
        total_units: 500,
        used_units: 100,
        available_units: 400,
        period_end: "2026-08-18T00:00:00Z",
      },
    ],
  },
};

function makeTempZcodeHome(credentials) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-zcode-"));
  const dir = path.join(home, ".zcode", "v2");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "credentials.json"), JSON.stringify(credentials), "utf8");
  return home;
}

function fakeResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  };
}

test("encrypt/decrypt round-trips the enc:v1 envelope with a derived key", () => {
  const key = deriveZcodeKey({
    env: {},
    platform: "win32",
    home: "C:\\Users\\demo",
    username: "demo",
  });
  const secretValue = "jwt-token-abc.123_456";
  const envelope = encryptZcodeValue(secretValue, key);
  assert.ok(isEncryptedValue(envelope));
  assert.ok(envelope.startsWith("enc:v1:"));
  assert.equal(envelope.split(".").length, 3);
  assert.equal(decryptZcodeValue(envelope, key), secretValue);
});

test("decrypt with the wrong key raises a reauth-mapped decrypt error", () => {
  const rightKey = deriveZcodeKey({ env: { ZCODE_CREDENTIAL_SECRET: "right" } });
  const wrongKey = deriveZcodeKey({ env: { ZCODE_CREDENTIAL_SECRET: "wrong" } });
  const envelope = encryptZcodeValue("secret", rightKey);
  let caught = null;
  try {
    decryptZcodeValue(envelope, wrongKey);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ZcodeTokenPlanError);
  assert.equal(caught.code, "ZCODE_DECRYPT_FAILED");
  assert.equal(mapZcodeErrorCode(caught), "reauth_required");
});

test("ZCODE_CREDENTIAL_SECRET takes priority over the fallback secret", () => {
  const explicit = deriveZcodeKey({ env: { ZCODE_CREDENTIAL_SECRET: "explicit" }, platform: "linux", home: "/home/a", username: "a" });
  const fallback = deriveZcodeKey({ env: {}, platform: "linux", home: "/home/a", username: "a" });
  assert.notDeepEqual(explicit, fallback);
});

test("readZcodeJwt returns a plaintext token as-is", () => {
  const home = makeTempZcodeHome({ zcode_jwt_token: "plain-jwt" });
  assert.equal(readZcodeJwt({ home, env: {} }), "plain-jwt");
});

test("readZcodeJwt decrypts an encrypted token with the host key", () => {
  const env = { ZCODE_CREDENTIAL_SECRET: "host-secret" };
  const key = deriveZcodeKey({ env });
  const home = makeTempZcodeHome({ zcode_jwt_token: encryptZcodeValue("enc-jwt", key) });
  assert.equal(readZcodeJwt({ home, env }), "enc-jwt");
});

test("readZcodeJwt honours the TOKENTRACKER_ZCODE_JWT escape hatch", () => {
  const home = makeTempZcodeHome({ zcode_jwt_token: "ignored" });
  assert.equal(readZcodeJwt({ home, env: { TOKENTRACKER_ZCODE_JWT: " override-jwt " } }), "override-jwt");
});

test("readZcodeJwt maps a missing install to not_configured", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-zcode-empty-"));
  let caught = null;
  try {
    readZcodeJwt({ home, env: {} });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ZcodeTokenPlanError);
  assert.equal(caught.code, "ZCODE_NOT_INSTALLED");
  assert.equal(mapZcodeErrorCode(caught), "not_configured");
});

test("parseZcodeBalanceResponse sums balances across models and picks the earliest reset", () => {
  const result = parseZcodeBalanceResponse(balancePayload);
  assert.equal(result.total_quota, 1500);
  assert.equal(result.used_quota, 350);
  assert.equal(result.remaining_quota, 1150);
  assert.equal(result.plan_label, "ZCode Pro");
  assert.equal(result.quota_windows.length, 1);
  const window = result.quota_windows[0];
  assert.equal(window.kind, "total");
  assert.equal(window.total, 1500);
  assert.equal(window.used, 350);
  assert.equal(window.remaining, 1150);
  assert.equal(window.resets_at, "2026-08-18T00:00:00.000Z");
});

test("parseZcodeBalanceResponse derives the missing leg from the other two", () => {
  const result = parseZcodeBalanceResponse({
    code: 0,
    data: {
      plans: [],
      balances: [{ used_units: 30, remaining_units: 70 }],
    },
  });
  assert.equal(result.total_quota, 100);
  assert.equal(result.used_quota, 30);
  assert.equal(result.remaining_quota, 70);
});

test("parseZcodeBalanceResponse rejects an empty balances array as unsupported", () => {
  let caught = null;
  try {
    parseZcodeBalanceResponse({ code: 0, data: { balances: [] } });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ZcodeTokenPlanError);
  assert.equal(caught.code, "ZCODE_NO_BALANCE");
  assert.equal(mapZcodeErrorCode(caught), "unsupported");
});

test("parseZcodeBalanceResponse surfaces provider business errors", () => {
  let caught = null;
  try {
    parseZcodeBalanceResponse({ code: 4001, msg: "quota service down", data: {} });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ZcodeTokenPlanError);
  assert.equal(caught.code, "ZCODE_PROVIDER_ERROR");
});

test("fetchZcodeQuota sends the bearer JWT to the balance endpoint", async () => {
  const env = { ZCODE_CREDENTIAL_SECRET: "host-secret" };
  const key = deriveZcodeKey({ env });
  const home = makeTempZcodeHome({ zcode_jwt_token: encryptZcodeValue("live-jwt", key) });

  let seenUrl = "";
  let seenHeaders = null;
  const fetchImpl = async (url, options) => {
    seenUrl = url;
    seenHeaders = options.headers;
    return fakeResponse(200, balancePayload);
  };

  const result = await fetchZcodeQuota({ home, env, fetchImpl });
  assert.ok(seenUrl.startsWith(ZCODE_BALANCE_URL));
  assert.ok(seenUrl.includes("app_version="));
  assert.equal(seenHeaders.Authorization, "Bearer live-jwt");
  assert.equal(result.total_quota, 1500);
  assert.ok(result.provider_reported_at);
});

test("fetchZcodeQuota maps 401 to reauth_required", async () => {
  const home = makeTempZcodeHome({ zcode_jwt_token: "expired-jwt" });
  const fetchImpl = async () => fakeResponse(401, { code: 401, msg: "unauthorized" });
  let caught = null;
  try {
    await fetchZcodeQuota({ home, env: {}, fetchImpl });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ZcodeTokenPlanError);
  assert.equal(caught.code, "ZCODE_REAUTH_REQUIRED");
  assert.equal(mapZcodeErrorCode(caught), "reauth_required");
});

test("zcode provider adapter is registered and merges into a refresh record", async () => {
  const refresh = require("../src/lib/token-plan-refresh");
  assert.equal(typeof refresh.getProviderAdapter("zcode"), "function");

  const env = {};
  const home = makeTempZcodeHome({ zcode_jwt_token: "plain-jwt" });
  const fetchImpl = async () => fakeResponse(200, balancePayload);
  const adapter = createZcodeProviderAdapter({ home, env, fetchImpl });
  const quota = await adapter({});
  const merged = refresh.mergeAdapterResultIntoRecord(
    {
      id: "plan-1",
      provider_id: "zcode",
      plan_id: "zcode_plan",
      total_quota: 0,
      used_quota: 0,
      remaining_quota: 0,
      quota_windows: [],
    },
    quota,
    "2026-08-13T00:00:00.000Z",
  );
  assert.equal(merged.total_quota, 1500);
  assert.equal(merged.used_quota, 350);
  assert.equal(merged.remaining_quota, 1150);
  assert.equal(merged.sync_status, "success");
  assert.equal(merged.quota_source, "provider_reported");
  assert.equal(merged.quota_windows.length, 1);
});

test("zcode appears in the token-plan catalog", () => {
  const catalog = require("../src/lib/token-plan-catalog");
  const zcode = catalog.getProviderCatalog("zcode");
  assert.ok(zcode);
  assert.equal(zcode.provider_id, "zcode");
  assert.ok(zcode.plans.length >= 1);
  const options = catalog.listProviderOptions();
  assert.ok(options.some((option) => option.id === "zcode"));
});
