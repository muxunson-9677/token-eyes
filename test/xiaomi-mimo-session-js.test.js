"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function loadSessionFetchScript() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src-tauri", "src", "xiaomi_mimo_session.rs"),
    "utf8",
  );
  const match = source.match(/const SESSION_FETCH_JS: &str = r#"([\s\S]*?)"#;/);
  assert.ok(match, "SESSION_FETCH_JS fixture must remain extractable");
  return match[1];
}

function responseWithJson(payload) {
  return {
    status: 200,
    ok: true,
    json: async () => payload,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function executeSessionFetch(responses) {
  const queue = [...responses];
  const window = {
    location: { hostname: "fixture.invalid" },
    addEventListener() {},
  };
  const context = vm.createContext({
    Date,
    Number,
    String,
    window,
    history: { pushState() {} },
    fetch: async () => {
      assert.ok(queue.length > 0, "unexpected Xiaomi fixture request");
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });
  vm.runInContext(loadSessionFetchScript(), context);
  window.location.hostname = "platform.xiaomimimo.com";
  await window.__tokenEyesSessionFetch__();
  return window.__tokenEyesQuotaResult__;
}

const validBalance = {
  data: {
    balance: 120,
    available_balance: 100,
    remainingOverdraftLimit: 20,
    currency: "CNY",
  },
};

const validUsage = {
  data: {
    usage: {
      items: [{ name: "plan_total_token", limit: 1000, used: 250 }],
    },
  },
};

test("SESSION_FETCH_JS maps malformed balance JSON to unsupported schema drift", async () => {
  const malformed = responseWithJson(null);
  malformed.json = async () => { throw new SyntaxError("synthetic malformed balance fixture"); };

  const result = await executeSessionFetch([malformed]);
  assert.deepEqual(plain(result), {
    status: "error",
    error: "structure_drift",
    error_code: "parse_error",
  });
});

test("SESSION_FETCH_JS maps malformed usage JSON to unsupported schema drift", async () => {
  const malformed = responseWithJson(null);
  malformed.json = async () => { throw new SyntaxError("synthetic malformed usage fixture"); };

  const result = await executeSessionFetch([
    responseWithJson(validBalance),
    malformed,
  ]);
  assert.deepEqual(plain(result), {
    status: "error",
    error: "structure_drift",
    error_code: "parse_error",
  });
});

test("SESSION_FETCH_JS keeps a fetch rejection in the temporary network-error class", async () => {
  const result = await executeSessionFetch([
    new Error("synthetic Xiaomi transport fixture"),
  ]);
  assert.deepEqual(plain(result), {
    status: "error",
    error: "network_error",
    error_code: "network_error",
  });
});

test("SESSION_FETCH_JS rejects whitespace-only required quota numbers as schema drift", async () => {
  const result = await executeSessionFetch([
    responseWithJson(validBalance),
    responseWithJson({
      data: {
        usage: {
          items: [{ name: "plan_total_token", limit: "   ", used: 25 }],
        },
      },
    }),
  ]);
  assert.deepEqual(plain(result), {
    status: "error",
    error: "structure_drift",
    error_code: "parse_error",
  });
});

for (const [label, invalidValue] of [
  ["array", [1000]],
  ["object", { value: 1000 }],
  ["boolean", true],
  ["numeric string", "1000"],
  ["empty string", ""],
  ["whitespace string", "   "],
  ["null", null],
]) {
  test(`SESSION_FETCH_JS rejects ${label} required quota numbers as schema drift`, async () => {
    const result = await executeSessionFetch([
      responseWithJson(validBalance),
      responseWithJson({
        data: {
          usage: {
            items: [{ name: "plan_total_token", limit: invalidValue, used: 25 }],
          },
        },
      }),
    ]);

    assert.deepEqual(plain(result), {
      status: "error",
      error: "structure_drift",
      error_code: "parse_error",
    });
  });
}

test("SESSION_FETCH_JS preserves finite JSON-number decimals without coercion", async () => {
  const result = await executeSessionFetch([
    responseWithJson({
      data: {
        balance: 120.5,
        available_balance: 100.25,
        remainingOverdraftLimit: 20.25,
        currency: "CNY",
      },
    }),
    responseWithJson({
      data: {
        usage: {
          items: [{ name: "plan_total_token", limit: 1000.5, used: 250.25 }],
        },
      },
    }),
  ]);

  assert.equal(result.status, "success");
  assert.equal(result.total, 1000.5);
  assert.equal(result.used, 250.25);
  assert.equal(result.remaining, 750.25);
  assert.equal(result.balance, 120.5);
  assert.equal(result.available_balance, 100.25);
  assert.equal(result.credit_balance, 20.25);
});

test("SESSION_FETCH_JS preserves valid usage as partial when credit is missing", async () => {
  const result = await executeSessionFetch([
    responseWithJson({
      data: {
        balance: 100,
        available_balance: 100,
        currency: "CNY",
      },
    }),
    responseWithJson(validUsage),
  ]);

  assert.equal(result.status, "success");
  assert.equal(result.partial, true);
  assert.equal(result.credit_balance, null);
  assert.deepEqual(Array.from(result.provider_reported_fields), [
    "total_quota",
    "used_quota",
    "remaining_quota",
    "balance",
    "available_balance",
  ]);
});
