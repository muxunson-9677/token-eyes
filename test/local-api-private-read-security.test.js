"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

function createRequest({ method = "GET", headers = {}, body = "" } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.headers = headers;
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: {},
    body: Buffer.alloc(0),
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

async function call(handler, pathname, options = {}) {
  const req = createRequest(options);
  const res = createResponse();
  const handled = await handler(req, res, new URL(`http://127.0.0.1:7680${pathname}`));
  assert.equal(handled, true);
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: JSON.parse(res.body.toString("utf8") || "{}"),
  };
}

function createIsolatedHandler(root, overrides = {}) {
  return createLocalApiHandler({
    queuePath: path.join(root, "queue.jsonl"),
    trackerDataDir: root,
    now: () => new Date("2026-08-23T08:00:00.000Z"),
    codexLifecycleProvider: async () => [],
    codexRolloutRowsProvider: async () => [],
    detectAllAgentEnvironments: () => [],
    workbuddyQuotaProvider: async () => ({
      signed_in: false,
      plan: null,
      groups: [],
      fetched_at: "2026-08-23T08:00:00.000Z",
      error: null,
    }),
    ...overrides,
  });
}

const PRIVATE_READ_PATHS = [
  "/functions/tokentracker-value-comparison?range=month",
  "/functions/tokentracker-realtime-sessions?range=today",
  "/functions/tokentracker-workbuddy-quota",
  "/functions/tokentracker-token-plans",
  "/functions/tokentracker-token-plan-console-sessions",
];

test("private local-data GET routes reject a hostile Origin without wildcard CORS", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-private-origin-"));
  try {
    const handler = createIsolatedHandler(root);
    for (const pathname of PRIVATE_READ_PATHS) {
      const response = await call(handler, pathname, {
        headers: { origin: "https://hostile.example" },
      });
      assert.equal(response.statusCode, 403, pathname);
      assert.equal(response.body.error, "Forbidden", pathname);
      assert.notEqual(response.headers["Access-Control-Allow-Origin"], "*", pathname);
      assert.equal(response.headers["Access-Control-Allow-Origin"], undefined, pathname);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("private local-data GET routes allow direct and loopback app reads without wildcard CORS", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-private-loopback-"));
  try {
    const handler = createIsolatedHandler(root);
    for (const pathname of PRIVATE_READ_PATHS) {
      const direct = await call(handler, pathname);
      assert.equal(direct.statusCode, 200, `${pathname} direct`);
      assert.equal(direct.headers["Access-Control-Allow-Origin"], undefined, `${pathname} direct`);

      const app = await call(handler, pathname, {
        headers: { origin: "http://tauri.localhost" },
      });
      assert.equal(app.statusCode, 200, `${pathname} app`);
      assert.equal(
        app.headers["Access-Control-Allow-Origin"],
        "http://tauri.localhost",
        `${pathname} app`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public Token Plan and console-session GET DTOs use strict privacy allowlists", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-private-dto-"));
  const configPath = path.join(root, "config.json");
  const validSessionRef = "token-plan/codex/session/private-binding";
  const traversalSessionRef = "token-plan/codex/session/../private-binding";
  const urlSessionRef = "https://example.test/session/private-binding?token=secret";
  const unsafeSessionRefs = [
    traversalSessionRef,
    urlSessionRef,
    "C:\\Users\\private\\session",
    "\\\\server\\share\\session",
    "file:///C:/private/session",
    "http://example.test/session/private-binding",
    "token-plan\\codex\\session\\private-binding",
    "token-plan/codex/session/with.dot",
    "token-plan/codex/session/opaque?token=secret",
    "token-plan/codex/session/opaque#private",
    "token-plan/trae/session/provider-mismatch",
  ];
  const rawError = "synthetic failure C:/Users/private/account.json?token=secret";
  const rawErrorCode = "PRIVATE_ACCOUNT_123";
  const privateEmail = "private@example.test";
  try {
    fs.writeFileSync(configPath, JSON.stringify({
      tokenPlans: [{
        id: "safe-plan-id",
        source: "codex",
        provider_id: "codex",
        plan_id: "codex_pro",
        plan_label: "Codex Pro",
        quota_kind: "rolling_window",
        quota_unit: "tokens",
        quota_source: "provider_reported",
        total_quota: 100,
        used_quota: 25,
        remaining_quota: 75,
        credential_ref: "token-plan/codex/quota/private-ref",
        last_refresh_status: "failed",
        last_refresh_error: rawError,
        detection_method: "official_account",
        sync_status: "failed",
        last_error_code: rawErrorCode,
        last_error_message: rawError,
        detection_config: {
          official_account: {
            account_binding_id: "safe-binding-id",
            account_id: "private-account-id",
            display_name: privateEmail,
            account_label: "Private account",
            account_name: "Private name",
            email: privateEmail,
            session_ref: validSessionRef,
            api_key_ref: "token-plan/codex/quota/private-key-ref",
            provider_home_url: "https://example.test/account?token=secret#private",
            plan_name: "Pro",
          },
          custom_api: {
            api_key_ref: "token-plan/codex/custom/private-key-ref",
            api_format: "json_path",
            request_url: "https://user:password@example.test/quota?token=secret#private",
            official_url: "https://example.test/docs?account=private#private",
            method: "GET",
            response_mapping: { total_quota_path: "data.total" },
          },
        },
        notes: privateEmail,
        display_order: 0,
      }],
      consoleSessions: [{
        id: "safe-session-id",
        provider_id: "codex",
        auth_kind: "official_console_session",
        display_name: privateEmail,
        account_id: "private-account-id",
        account_label: "Private account",
        account_name: "Private name",
        email: privateEmail,
        status: "failed",
        session_ref: validSessionRef,
        connected_at: "2026-08-20T08:00:00.000Z",
        last_verified_at: "2026-08-23T07:00:00.000Z",
        last_error_code: rawErrorCode,
        last_error_message: rawError,
        balance: {
          balance: 80,
          available_balance: 75,
          credit_balance: 5,
          currency: "CNY",
          provider_reported_at: "2026-08-23T07:00:00.000Z",
          raw_response: { token: "secret" },
        },
      }, ...unsafeSessionRefs.map((sessionRef, index) => ({
        id: `unsafe-session-${index}`,
        provider_id: "codex",
        auth_kind: "official_console_session",
        status: "failed",
        session_ref: sessionRef,
      }))],
    }));
    const handler = createIsolatedHandler(root);

    const plans = await call(handler, "/functions/tokentracker-token-plans", {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    const plan = plans.body.records[0];
    assert.deepEqual(Object.keys(plan).sort(), [
      "created_at",
      "detection_config",
      "detection_method",
      "display_order",
      "expires_at",
      "id",
      "last_error_code",
      "last_error_message",
      "last_refresh_at",
      "last_refresh_error",
      "last_refresh_status",
      "last_sync_attempt_at",
      "last_synced_at",
      "next_refresh_at",
      "plan_id",
      "plan_label",
      "provider_id",
      "provider_reported_at",
      "provider_reported_fields",
      "quota_catalog_version",
      "quota_kind",
      "quota_source",
      "quota_unit",
      "refresh_enabled",
      "refresh_interval_minutes",
      "refresh_method",
      "remaining_quota",
      "source",
      "subscription_amount",
      "subscription_currency",
      "subscription_cycle",
      "subscription_end_date",
      "subscription_start_date",
      "sync_status",
      "total_quota",
      "total_quota_display",
      "updated_at",
      "used_quota",
    ].sort());
    assert.equal(plan.detection_config.official_account.account_binding_id, "safe-binding-id");
    assert.equal(plan.detection_config.official_account.provider_home_url, "https://example.test/account");
    assert.equal(plan.detection_config.official_account.session_ref, validSessionRef);
    assert.equal(plan.detection_config.custom_api.request_url, "https://example.test/quota");
    assert.equal(plan.detection_config.custom_api.official_url, "https://example.test/docs");
    assert.equal(plan.last_error_message, "授权或额度状态暂时不可读取，请稍后重试。");
    assert.equal(plan.last_refresh_error, "授权或额度状态暂时不可读取，请稍后重试。");
    assert.equal(plan.last_error_code, "UNAVAILABLE");

    const sessions = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    const session = sessions.body.sessions.find((item) => item.id === "safe-session-id");
    assert.deepEqual(Object.keys(session).sort(), [
      "auth_kind",
      "balance",
      "connected_at",
      "id",
      "last_error_code",
      "last_error_message",
      "last_verified_at",
      "provider_id",
      "session_ref",
      "status",
    ].sort());
    assert.equal(session.session_ref, validSessionRef);
    assert.equal(session.last_error_message, "授权或额度状态暂时不可读取，请稍后重试。");
    assert.equal(session.last_error_code, "UNAVAILABLE");
    assert.deepEqual(Object.keys(session.balance).sort(), [
      "available_balance",
      "balance",
      "credit_balance",
      "currency",
      "fetched_at",
      "observed_at",
      "partial",
      "provider_reported_at",
      "provider_reported_fields",
      "source_kind",
      "support_tier",
    ].sort());
    for (const [index, sessionRef] of unsafeSessionRefs.entries()) {
      assert.equal(
        sessions.body.sessions.find((item) => item.id === `unsafe-session-${index}`).session_ref,
        null,
        sessionRef,
      );
    }

    const serialized = JSON.stringify({ plan, sessions: sessions.body.sessions });
    for (const forbidden of [
      privateEmail,
      "private-account-id",
      rawError,
      rawErrorCode,
      "token=secret",
      "password",
      "private-key-ref",
      "C:/Users/private",
      ...unsafeSessionRefs,
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }

    const persisted = fs.readFileSync(configPath, "utf8");
    assert.equal(persisted.includes(validSessionRef), true, "GET must not mutate internal persistence");
    assert.equal(persisted.includes(privateEmail), true, "GET must not mutate internal persistence");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a valid namespaced session_ref returned by GET remains usable by the verify flow", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-private-session-ref-"));
  try {
    const handler = createIsolatedHandler(root);
    const auth = await call(handler, "/api/local-auth");
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": auth.body.token,
      origin: "http://tauri.localhost",
    };
    const sessionRef = "token-plan/codex/session/native-operation-123";
    const created = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "codex",
        auth_kind: "official_console_session",
        display_name: "Codex",
        session_ref: sessionRef,
      }),
    });
    assert.equal(created.statusCode, 200);

    const listed = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      headers: { origin: "http://tauri.localhost" },
    });
    const publicSession = listed.body.sessions.find((item) => item.id === created.body.session.id);
    assert.equal(publicSession.session_ref, sessionRef);

    const verified = await call(
      handler,
      `/functions/tokentracker-token-plan-console-sessions/${publicSession.id}/verify`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          native_result: {
            connected: false,
            session_ref: publicSession.session_ref,
            state_code: "awaiting_verification",
            error_code: "",
            error_message: "",
          },
        }),
      },
    );
    assert.equal(verified.statusCode, 200);
    assert.equal(verified.body.session.status, "awaiting_verification");
    assert.equal(verified.body.session.session_ref, sessionRef);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("WorkBuddy GET strictly allowlists provider data and returns a fixed unreadable state on failure", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-private-workbuddy-"));
  try {
    const handler = createIsolatedHandler(root, {
      workbuddyQuotaProvider: async () => ({
        signed_in: true,
        plan: "PRO",
        account: { nickname: "Private", phone_masked: "123", account_id: "secret" },
        groups: [{
          id: "base",
          items: 1,
          total: 100,
          remain: 100,
          used: 0,
          used_percent: 0,
          token: "secret",
          endpoint: "https://example.test/?token=secret",
        }, {
          id: "attacker-controlled",
          items: 1,
          total: 1,
          remain: 0,
          used: 1,
          used_percent: 100,
        }],
        fetched_at: "2026-08-23T08:00:00.000Z",
        error: null,
        token: "secret",
      }),
    });
    const response = await call(handler, "/functions/tokentracker-workbuddy-quota", {
      headers: { origin: "http://tauri.localhost" },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(response.body).sort(), [
      "error", "fetched_at", "groups", "plan", "signed_in",
    ]);
    assert.deepEqual(response.body.groups, [{
      id: "base",
      items: 1,
      total: 100,
      remain: 100,
      used: 0,
      used_percent: 0,
    }]);
    assert.equal(JSON.stringify(response.body).includes("secret"), false);

    for (const pathname of [
      "/functions/tokentracker-value-comparison?range=month",
      "/functions/tokentracker-realtime-sessions?range=today",
    ]) {
      const pageData = await call(handler, pathname, {
        headers: { origin: "http://tauri.localhost" },
      });
      assert.deepEqual(pageData.body.native_resources, [{
        provider: "workbuddy",
        label: "remaining",
        value: 100,
        unit: "Credits",
        evidence_state: "exact",
      }, {
        provider: "workbuddy",
        label: "today_consumed",
        value: 0,
        unit: "Credits",
        evidence_state: "observed",
      }], pathname);
      assert.equal(JSON.stringify(pageData.body).includes("attacker-controlled"), false, pathname);
      assert.equal(JSON.stringify(pageData.body).includes("secret"), false, pathname);
    }

    const failing = createIsolatedHandler(path.join(root, "failure"), {
      workbuddyQuotaProvider: async () => {
        throw new Error("synthetic C:/private?token=secret");
      },
    });
    const unavailable = await call(failing, "/functions/tokentracker-workbuddy-quota", {
      headers: { origin: "http://tauri.localhost" },
    });
    assert.equal(unavailable.statusCode, 200);
    assert.deepEqual(unavailable.body, {
      signed_in: null,
      plan: null,
      groups: [],
      fetched_at: null,
      error: "unavailable",
    });
    assert.equal(JSON.stringify(unavailable).includes("synthetic"), false);
    assert.equal(unavailable.headers["Access-Control-Allow-Origin"], "http://tauri.localhost");

    for (const pathname of [
      "/functions/tokentracker-value-comparison?range=month",
      "/functions/tokentracker-realtime-sessions?range=today",
    ]) {
      const pageData = await call(failing, pathname, {
        headers: { origin: "http://tauri.localhost" },
      });
      assert.equal(pageData.statusCode, 200, pathname);
      assert.deepEqual(pageData.body.native_resources, [{
        provider: "workbuddy",
        label: "remaining",
        value: null,
        unit: "Credits",
        evidence_state: "unavailable",
      }, {
        provider: "workbuddy",
        label: "today_consumed",
        value: null,
        unit: "Credits",
        evidence_state: "unavailable",
      }], pathname);
      assert.equal(JSON.stringify(pageData.body).includes("synthetic"), false, pathname);
      assert.equal(JSON.stringify(pageData.body).includes("secret"), false, pathname);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
