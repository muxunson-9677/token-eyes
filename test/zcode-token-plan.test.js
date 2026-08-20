"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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

test("encrypt/decrypt round-trips only with an explicit ZCODE_CREDENTIAL_SECRET", () => {
  const key = deriveZcodeKey({
    env: { ZCODE_CREDENTIAL_SECRET: "synthetic-explicit-secret" },
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

test("deriveZcodeKey refuses host-derived fallback material when no explicit secret exists", () => {
  assert.throws(
    () => deriveZcodeKey({ env: {}, platform: "win32", home: "C:\\Users\\synthetic", username: "synthetic" }),
    (error) => error instanceof ZcodeTokenPlanError
      && error.code === "ZCODE_SECURE_STORE_UNSUPPORTED"
      && mapZcodeErrorCode(error) === "unsupported",
  );

  const source = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "zcode-token-plan.js"), "utf8");
  assert.doesNotMatch(source, /zcode-credential-fallback|safeUserInfoName|os\.userInfo/);
});

test("readZcodeJwt refuses an unverified on-disk credential without leaking it", () => {
  const syntheticToken = "synthetic-unverified-plaintext-jwt";
  const home = makeTempZcodeHome({ zcode_jwt_token: syntheticToken });
  assert.throws(
    () => readZcodeJwt({ home, env: {} }),
    (error) => error instanceof ZcodeTokenPlanError
      && error.code === "ZCODE_SECURE_STORE_UNSUPPORTED"
      && !String(error.message).includes(syntheticToken),
  );
});

test("readZcodeJwt decrypts an encrypted fixture with an explicit secret key", () => {
  const env = { ZCODE_CREDENTIAL_SECRET: "host-secret" };
  const key = deriveZcodeKey({ env });
  const home = makeTempZcodeHome({ zcode_jwt_token: encryptZcodeValue("enc-jwt", key) });
  assert.equal(readZcodeJwt({ home, env }), "enc-jwt");
});

test("readZcodeJwt returns secure-store unsupported for encrypted data without an explicit secret and redacts ciphertext", () => {
  const fixtureKey = crypto.createHash("sha256").update("synthetic-fixture-key").digest();
  const ciphertext = encryptZcodeValue("synthetic-secret-jwt", fixtureKey);
  const home = makeTempZcodeHome({ zcode_jwt_token: ciphertext });

  assert.throws(
    () => readZcodeJwt({ home, env: {}, platform: "win32", username: "synthetic" }),
    (error) => {
      assert.ok(error instanceof ZcodeTokenPlanError);
      assert.equal(error.code, "ZCODE_SECURE_STORE_UNSUPPORTED");
      assert.equal(mapZcodeErrorCode(error), "unsupported");
      assert.equal(String(error.message).includes(ciphertext), false);
      assert.equal(String(error.message).includes("synthetic-secret-jwt"), false);
      return true;
    },
  );
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

test("fetchZcodeQuota refuses the undocumented endpoint before any request while its fixed fixture is absent", async () => {
  const explicitToken = "synthetic-explicit-zcode-jwt";
  const home = makeTempZcodeHome({ zcode_jwt_token: "ignored" });
  let requests = 0;

  await assert.rejects(
    fetchZcodeQuota({
      home,
      env: { TOKENTRACKER_ZCODE_JWT: explicitToken },
      fetchImpl: async () => {
        requests += 1;
        return fakeResponse(200, balancePayload);
      },
    }),
    (error) => error instanceof ZcodeTokenPlanError
      && error.code === "ZCODE_ENDPOINT_UNSUPPORTED"
      && mapZcodeErrorCode(error) === "unsupported"
      && !String(error.message).includes(explicitToken),
  );
  assert.equal(requests, 0);
});

test("fetchZcodeQuota reports secure-store unsupported without reading an unverified installed credential", async () => {
  const syntheticToken = "synthetic-installed-zcode-token";
  const home = makeTempZcodeHome({ zcode_jwt_token: syntheticToken });
  let requests = 0;

  await assert.rejects(
    fetchZcodeQuota({
      home,
      env: {},
      fetchImpl: async () => {
        requests += 1;
        return fakeResponse(200, balancePayload);
      },
    }),
    (error) => error instanceof ZcodeTokenPlanError
      && error.code === "ZCODE_SECURE_STORE_UNSUPPORTED"
      && mapZcodeErrorCode(error) === "unsupported"
      && !String(error.message).includes(syntheticToken),
  );
  assert.equal(requests, 0);
});

test("fetchZcodeQuota fails closed before host installation or credential-path probes when fixtures are absent", async () => {
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-zcode-gate-empty-"));
  const populatedHome = makeTempZcodeHome({});
  const originalExistsSync = fs.existsSync;
  const originalReadFileSync = fs.readFileSync;
  let existsCalls = 0;
  let readCalls = 0;
  let requests = 0;

  fs.existsSync = (...args) => {
    existsCalls += 1;
    return originalExistsSync(...args);
  };
  fs.readFileSync = (...args) => {
    readCalls += 1;
    return originalReadFileSync(...args);
  };
  try {
    for (const home of [emptyHome, populatedHome]) {
      await assert.rejects(
        fetchZcodeQuota({
          home,
          env: {},
          fetchImpl: async () => {
            requests += 1;
            return fakeResponse(200, balancePayload);
          },
        }),
        (error) => error instanceof ZcodeTokenPlanError
          && error.code === "ZCODE_SECURE_STORE_UNSUPPORTED"
          && mapZcodeErrorCode(error) === "unsupported",
      );
    }
  } finally {
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(emptyHome, { recursive: true, force: true });
    fs.rmSync(populatedHome, { recursive: true, force: true });
  }

  assert.equal(existsCalls, 0);
  assert.equal(readCalls, 0);
  assert.equal(requests, 0);
});

test("zcode provider adapter is registered but remains unsupported without a fixed endpoint fixture", async () => {
  const refresh = require("../src/lib/token-plan-refresh");
  assert.equal(typeof refresh.getProviderAdapter("zcode"), "function");

  const explicitToken = "synthetic-explicit-zcode-jwt";
  const env = { TOKENTRACKER_ZCODE_JWT: explicitToken };
  const home = makeTempZcodeHome({ zcode_jwt_token: "ignored" });
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return fakeResponse(200, balancePayload);
  };
  const adapter = createZcodeProviderAdapter({ home, env, fetchImpl });
  await assert.rejects(
    adapter({}),
    (error) => error.code === "ZCODE_ENDPOINT_UNSUPPORTED"
      && mapZcodeErrorCode(error) === "unsupported",
  );
  assert.equal(requests, 0);
});

test("zcode appears in the token-plan catalog", () => {
  const catalog = require("../src/lib/token-plan-catalog");
  const zcode = catalog.getProviderCatalog("zcode");
  assert.ok(zcode);
  assert.equal(zcode.provider_id, "zcode");
  assert.ok(zcode.plans.length >= 1);
  const options = catalog.listProviderOptions();
  assert.ok(options.some((option) => option.id === "zcode"));

  const rawCatalog = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "token-plan-catalog", "zcode.catalog.json"),
    "utf8",
  ));
  assert.equal(rawCatalog.account_access.official_quota_api, false);
  assert.equal(rawCatalog.account_access.usage_endpoint_documented, false);
  assert.equal(rawCatalog.account_access.source_kind, "undocumented_api");
  assert.equal(rawCatalog.account_access.support_tier, "unsupported");
  assert.doesNotMatch(rawCatalog.account_access.notes, /官方.*(?:接口|已文档化)|official.*documented/i);
});
