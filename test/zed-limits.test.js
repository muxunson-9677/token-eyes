"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  ZED_KEYCHAIN_SERVER,
  ZED_WINDOWS_CRED_TARGET,
  readZedCredentialFromEnv,
  readZedCredentialMacos,
  readZedCredential,
  prettifyZedPlan,
  normalizeZedUsageResponse,
  fetchZedLimits,
} = require("../src/lib/zed-limits");

const usagePayload = {
  plan: { plan_v3: "zed_pro" },
  subscription: {
    period: { start_at: "2026-08-01T00:00:00Z", end_at: "2026-09-01T00:00:00Z" },
  },
  current_usage: {
    token_spend: { used: 500, limit: 2000, remaining: 1500 },
    edit_predictions: { used: 100, limit: 1000, remaining: 900 },
  },
};

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

test("readZedCredentialFromEnv requires both user id and access token", () => {
  assert.equal(readZedCredentialFromEnv({}), null);
  assert.equal(readZedCredentialFromEnv({ TOKENTRACKER_ZED_USER_ID: "1" }), null);
  assert.deepEqual(
    readZedCredentialFromEnv({ TOKENTRACKER_ZED_USER_ID: " 42 ", TOKENTRACKER_ZED_ACCESS_TOKEN: " tok " }),
    { userId: "42", accessToken: "tok" },
  );
});

test("readZedCredentialMacos parses the keychain attribute dump and password", () => {
  const calls = [];
  const securityRunner = (bin, args) => {
    calls.push({ bin, args });
    if (args.includes("-w")) {
      return { status: 0, stdout: "secret-token\n" };
    }
    return { status: 0, stdout: 'keychain: "login.keychain"\n    "acct"<blob>="12345"\n    "srvr"<blob>="zed.dev"\n' };
  };
  const credential = readZedCredentialMacos({ securityRunner });
  assert.deepEqual(credential, { userId: "12345", accessToken: "secret-token" });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.args.includes(ZED_KEYCHAIN_SERVER)));
});

test("readZedCredentialMacos returns null when the keychain entry is absent", () => {
  const securityRunner = () => ({ status: 44, stdout: "" });
  assert.equal(readZedCredentialMacos({ securityRunner }), null);
});

test("readZedCredential on Windows parses the PowerShell CredRead output", async () => {
  let seenCommand = null;
  const commandRunner = (command, args) => {
    seenCommand = { command, args };
    return { status: 0, stdout: "67890\r\nwin-secret-token\r\n" };
  };
  const credential = await readZedCredential({ platform: "win32", env: {}, commandRunner });
  assert.deepEqual(credential, { userId: "67890", accessToken: "win-secret-token" });
  assert.equal(seenCommand.command, "powershell.exe");
  assert.ok(seenCommand.args.join(" ").includes(ZED_WINDOWS_CRED_TARGET));
});

test("readZedCredential prefers the env escape hatch on any platform", async () => {
  const credential = await readZedCredential({
    platform: "linux",
    env: { TOKENTRACKER_ZED_USER_ID: "7", TOKENTRACKER_ZED_ACCESS_TOKEN: "tok" },
  });
  assert.deepEqual(credential, { userId: "7", accessToken: "tok" });
});

test("prettifyZedPlan strips the zed prefix", () => {
  assert.equal(prettifyZedPlan("zed_pro"), "pro");
  assert.equal(prettifyZedPlan("zed_pro_trial"), "pro trial");
  assert.equal(prettifyZedPlan(""), null);
});

test("normalizeZedUsageResponse builds spend and prediction windows", () => {
  const result = normalizeZedUsageResponse(usagePayload);
  assert.equal(result.plan_name, "pro");
  assert.equal(result.primary_window.used_percent, 25);
  assert.equal(result.primary_window.reset_at, "2026-09-01T00:00:00.000Z");
  assert.equal(result.secondary_window.used_percent, 10);
  assert.equal(result.spend_used_cents, 500);
  assert.equal(result.spend_limit_cents, 2000);
  assert.equal(result.predictions_limit, 1000);
  assert.equal(result.period_start, "2026-08-01T00:00:00.000Z");
});

test("normalizeZedUsageResponse throws when no usable windows exist", () => {
  assert.throws(
    () => normalizeZedUsageResponse({ plan: { plan_v3: "zed_free" }, current_usage: {} }),
    /no quota windows/,
  );
});

test("fetchZedLimits returns configured:false without a credential", async () => {
  const result = await fetchZedLimits({ platform: "linux", env: {}, fetchImpl: async () => jsonResponse(200, usagePayload) });
  assert.deepEqual(result, { configured: false });
});

test("fetchZedLimits sends the space-separated auth header and normalizes the payload", async () => {
  let seenUrl = "";
  let seenHeaders = null;
  const fetchImpl = async (url, options) => {
    seenUrl = url;
    seenHeaders = options.headers;
    return jsonResponse(200, usagePayload);
  };
  const result = await fetchZedLimits({
    platform: "linux",
    env: { TOKENTRACKER_ZED_USER_ID: "42", TOKENTRACKER_ZED_ACCESS_TOKEN: "tok" },
    fetchImpl,
  });
  assert.equal(seenUrl, "https://cloud.zed.dev/client/users/me");
  assert.equal(seenHeaders.Authorization, "42 tok");
  assert.equal(result.configured, true);
  assert.equal(result.error, null);
  assert.equal(result.plan_name, "pro");
  assert.equal(result.primary_window.used_percent, 25);
});

test("fetchZedLimits surfaces a sign-in message on 401", async () => {
  const result = await fetchZedLimits({
    platform: "linux",
    env: { TOKENTRACKER_ZED_USER_ID: "42", TOKENTRACKER_ZED_ACCESS_TOKEN: "expired" },
    fetchImpl: async () => jsonResponse(401, {}),
  });
  assert.equal(result.configured, true);
  assert.match(result.error, /Not signed in to Zed/);
});

test("usage-limits getUsageLimits includes a zed entry", async () => {
  const usageLimits = require("../src/lib/usage-limits");
  usageLimits.resetUsageLimitsCache();
  const os = require("node:os");
  const fs = require("node:fs");
  const path = require("node:path");
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-zed-home-"));
  const data = await usageLimits.getUsageLimits({
    home: emptyHome,
    env: { TOKENTRACKER_ZED_USER_ID: "42", TOKENTRACKER_ZED_ACCESS_TOKEN: "tok" },
    platform: "linux",
    fetchImpl: async (url) => {
      if (String(url).includes("cloud.zed.dev")) return jsonResponse(200, usagePayload);
      return jsonResponse(404, {});
    },
    commandRunner: () => ({ status: 1, stdout: "", stderr: "" }),
    securityRunner: () => ({ status: 44, stdout: "" }),
    providerTimeoutMs: 2000,
  });
  usageLimits.resetUsageLimitsCache();
  assert.ok(data.zed);
  assert.equal(data.zed.configured, true);
  assert.equal(data.zed.error, null);
  assert.equal(data.zed.plan_label, "Pro");
  assert.equal(data.zed.primary_window.used_percent, 25);
});
