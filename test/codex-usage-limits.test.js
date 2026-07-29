"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const {
  CODEX_RESET_CREDIT_ALLOWLIST,
  getCodexUsageLimits,
  parseCodexResetCreditFields,
} = require("../src/lib/usage-limits");

const homes = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function makeJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

function createCodexHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-codex-limit-"));
  homes.push(home);
  const dir = path.join(home, ".codex");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({
    tokens: {
      access_token: makeJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct-fixture",
        },
      }),
      refresh_token: "refresh-fixture",
    },
    last_refresh: new Date().toISOString(),
  }));
  return home;
}

function isolatedEnv(home) {
  return { ...process.env, CODEX_HOME: path.join(home, ".codex") };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("focused reader calls only Codex and normalizes windows by duration", async () => {
  const home = createCodexHome();
  const calls = [];
  const checkedAt = new Date("2026-07-20T08:00:00.000Z");

  const result = await getCodexUsageLimits({
    home,
    env: isolatedEnv(home),
    now: checkedAt,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, {
        rate_limit: {
          primary_window: {
            used_percent: 64,
            limit_window_seconds: 604800,
            reset_at: 1784851200,
          },
          secondary_window: {
            used_percent: 37,
            limit_window_seconds: 18000,
            reset_at: 1784543400,
          },
        },
      });
    },
  });

  assert.deepEqual(result, {
    configured: true,
    checked_at: "2026-07-20T08:00:00.000Z",
    primary_window: {
      used_percent: 37,
      reset_at: "2026-07-20T10:30:00.000Z",
    },
    secondary_window: {
      used_percent: 64,
      reset_at: "2026-07-24T00:00:00.000Z",
    },
    spark_primary_window: null,
    spark_secondary_window: null,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://chatgpt.com/backend-api/wham/usage");
  assert.deepEqual(calls[0].init.headers, {
    Authorization: `Bearer ${makeJwt({
      "https://api.openai.com/auth": { chatgpt_account_id: "acct-fixture" },
    })}`,
    Accept: "application/json",
    "ChatGPT-Account-Id": "acct-fixture",
  });
});

test("focused reader maps auth, unsupported, and network failures to sanitized states", async () => {
  for (const [status, expected] of [
    [401, { auth_action_required: "reauth", error_code: "auth_required" }],
    [403, { auth_action_required: "reauth", error_code: "auth_required" }],
    [404, { unsupported: true, error_code: "endpoint_unsupported" }],
    [503, { error_code: "upstream_5xx" }],
  ]) {
    const home = createCodexHome();
    const result = await getCodexUsageLimits({
      home,
      env: isolatedEnv(home),
      fetchImpl: async () => response(status, { secret: "must-not-leak" }),
    });
    assert.equal(result.configured, true);
    assert.equal(result.checked_at.length, 24);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(result).filter(([key]) => key !== "configured" && key !== "checked_at"),
      ),
      expected,
    );
    assert.doesNotMatch(JSON.stringify(result), /secret|refresh|authorization|account/i);
  }

  const networkHome = createCodexHome();
  const network = await getCodexUsageLimits({
    home: networkHome,
    env: isolatedEnv(networkHome),
    fetchImpl: async () => {
      throw new Error("connect ECONNRESET /private/path");
    },
  });
  assert.equal(network.error_code, "network_error");
  assert.doesNotMatch(JSON.stringify(network), /ECONNRESET|private|path/i);
});

test("shape drift is unsupported and unconfigured Codex performs no request", async () => {
  const driftHome = createCodexHome();
  const drift = await getCodexUsageLimits({
    home: driftHome,
    env: isolatedEnv(driftHome),
    fetchImpl: async () => response(200, { changed_schema: true }),
  });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(drift).filter(([key]) => key !== "checked_at"),
    ),
    { configured: true, unsupported: true, error_code: "response_unsupported" },
  );

  let called = false;
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-no-codex-"));
  homes.push(emptyHome);
  const unconfigured = await getCodexUsageLimits({
    home: emptyHome,
    env: isolatedEnv(emptyHome),
    fetchImpl: async () => {
      called = true;
      throw new Error("must not run");
    },
  });
  assert.equal(called, false);
  assert.equal(unconfigured.configured, false);
});

test("allowlists only official reset-credit counters", () => {
  const fixture = require("./fixtures/codex/wham-usage-reset-credits.json");
  assert.deepEqual(CODEX_RESET_CREDIT_ALLOWLIST, [
    "rate_limit_reset_credits.available_count",
    "rate_limit_reset_credits.applicable_available_count",
  ]);
  assert.deepEqual(parseCodexResetCreditFields(fixture), {
    available_count: 2,
    applicable_available_count: 1,
  });
  assert.equal(parseCodexResetCreditFields({
    rate_limit_reset_credits: {
      available_count: -1,
      applicable_available_count: "secret",
    },
  }), null);
  assert.doesNotMatch(
    JSON.stringify(parseCodexResetCreditFields(fixture)),
    /account_id|access_token|must-not-be-returned/u,
  );
});
