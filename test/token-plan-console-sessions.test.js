const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
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
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

function readJsonResponse(res) {
  return JSON.parse(res.body.toString("utf8") || "{}");
}

async function call(handler, pathName, options) {
  const req = createRequest(options);
  const res = createResponse();
  const handled = await handler(req, res, new URL(`http://127.0.0.1:7680${pathName}`));
  assert.equal(handled, true);
  return res;
}

async function getAuthHeaders(handler) {
  const auth = await call(handler, "/api/local-auth");
  const token = readJsonResponse(auth).token;
  return {
    "content-type": "application/json",
    "x-tokentracker-local-auth": token,
    origin: "http://127.0.0.1:7680",
  };
}

test("GET /api/local-auth exposes CORS without caching the token", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-local-auth-cors-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const res = await call(handler, "/api/local-auth", {
      headers: { origin: "http://127.0.0.1:5173" },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Access-Control-Allow-Origin"], "*");
    assert.equal(res.headers["Access-Control-Allow-Methods"], "GET, POST, PUT, DELETE, OPTIONS");
    assert.match(res.headers["Access-Control-Allow-Headers"], /X-TokenTracker-Local-Auth/i);
    assert.equal(res.headers["Cache-Control"], "no-store");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST console session accepts the packaged Tauri origin", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-tauri-origin-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;

    const res = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tokentracker-local-auth": token,
        origin: "http://tauri.localhost",
      },
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/tauri-origin-test",
      }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(readJsonResponse(res).session.status, "pending_login");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("GET /functions/tokentracker-token-plan-console-sessions returns empty list when no sessions", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const res = await call(handler, "/functions/tokentracker-token-plan-console-sessions");
    assert.equal(res.statusCode, 200);
    const body = readJsonResponse(res);
    assert.deepEqual(body.sessions, []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /functions/tokentracker-token-plan-console-sessions creates session in pending_login (NOT connected)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const headers = await getAuthHeaders(handler);

    const res = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/test-uuid-123",
      }),
    });

    assert.equal(res.statusCode, 200);
    const body = readJsonResponse(res);
    assert.ok(body.session, "Response should contain session");
    assert.ok(body.session.id, "Session should have an id");
    assert.equal(body.session.provider_id, "xiaomi_mimo");
    assert.equal(body.session.auth_kind, "official_console_session");
    assert.equal(body.session.display_name, "小米 MiMo 控制台账号");
    assert.equal(body.session.session_ref, "token-plan/xiaomi_mimo/session/test-uuid-123");
    // CRITICAL: a freshly created session must NOT be marked connected.
    assert.equal(
      body.session.status,
      "pending_login",
      "POST must create the session as pending_login, not connected",
    );
    assert.equal(
      body.session.connected_at,
      "",
      "connected_at must be empty until native verify reports connected",
    );

    // Verify no cookie, token, or authorization fields are present
    assert.equal(body.session.cookie, undefined, "Session should NOT contain cookie field");
    assert.equal(body.session.authorization, undefined, "Session should NOT contain authorization field");
    assert.equal(body.session.token, undefined, "Session should NOT contain token field");
    assert.equal(body.session.authorization_header, undefined, "Session should NOT contain authorization_header field");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST refuses to mark the session as connected from a client request", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const headers = await getAuthHeaders(handler);
    const res = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/uuid-fake-connect",
        status: "connected",
      }),
    });
    assert.equal(res.statusCode, 400);
    const body = readJsonResponse(res);
    assert.match(body.error || "", /connected|native/i);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("GET /functions/tokentracker-token-plan-console-sessions does not return cookie/token fields", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const headers = await getAuthHeaders(handler);

    // Create a session
    await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/test-uuid-456",
      }),
    });

    // List sessions
    const listRes = await call(handler, "/functions/tokentracker-token-plan-console-sessions");
    assert.equal(listRes.statusCode, 200);
    const listBody = readJsonResponse(listRes);
    assert.ok(Array.isArray(listBody.sessions), "Response should have sessions array");
    assert.equal(listBody.sessions.length, 1);

    const session = listBody.sessions[0];
    // Verify no sensitive fields
    assert.equal(session.cookie, undefined, "Session should NOT contain cookie field");
    assert.equal(session.authorization, undefined, "Session should NOT contain authorization field");
    assert.equal(session.token, undefined, "Session should NOT contain token field");
    assert.equal(session.authorization_header, undefined, "Session should NOT contain authorization_header field");
    assert.equal(session.credential, undefined, "Session should NOT contain credential field");
    assert.equal(session.cookie_raw, undefined, "Session should NOT contain cookie_raw field");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("DELETE /functions/tokentracker-token-plan-console-sessions removes session", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const headers = await getAuthHeaders(handler);

    const createRes = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/test-uuid-789",
      }),
    });

    const createdSession = readJsonResponse(createRes).session;
    assert.ok(createdSession.id);

    const deleteRes = await call(handler, `/functions/tokentracker-token-plan-console-sessions?id=${createdSession.id}`, {
      method: "DELETE",
      headers,
    });

    assert.equal(deleteRes.statusCode, 200);
    const deleteBody = readJsonResponse(deleteRes);
    assert.equal(deleteBody.ok, true);

    const listRes = await call(handler, "/functions/tokentracker-token-plan-console-sessions");
    const listBody = readJsonResponse(listRes);
    assert.deepEqual(listBody.sessions, []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /functions/tokentracker-token-plan-console-sessions rejects non-xiaomi_mimo provider_id", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const headers = await getAuthHeaders(handler);

    const res = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "some_other_provider",
        auth_kind: "official_console_session",
        display_name: "Test Provider",
        session_ref: "token-plan/some_other/session/test",
      }),
    });

    assert.equal(res.statusCode, 400);
    const body = readJsonResponse(res);
    assert.ok(body.error, "Response should contain error message");
    assert.match(body.error, /provider_id/i);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /functions/tokentracker-token-plan-console-sessions rejects non-official_console_session auth_kind", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const headers = await getAuthHeaders(handler);

    const res = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "cookie_scrape",
        display_name: "Test",
        session_ref: "token-plan/xiaomi_mimo/session/test",
      }),
    });

    assert.equal(res.statusCode, 400);
    const body = readJsonResponse(res);
    assert.ok(body.error, "Response should contain error message");
    assert.match(body.error, /auth_kind/i);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST from non-desktop origin returns desktop_required", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    // Simulate a web request: no local-auth token, no origin header
    const res = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "Should Not Be Saved",
        session_ref: "token-plan/xiaomi_mimo/session/web-fake",
      }),
    });

    assert.equal(res.statusCode, 403, "non-desktop POST must be rejected with 403");
    const body = readJsonResponse(res);
    assert.equal(body.error, "desktop_required");
    assert.equal(body.error_code, "desktop_required");

    // Verify nothing was persisted
    const list = await call(handler, "/functions/tokentracker-token-plan-console-sessions");
    const listBody = readJsonResponse(list);
    assert.deepEqual(listBody.sessions, []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST without auth returns 401 when an origin is set", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const res = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:7680",
      },
      body: JSON.stringify({ provider_id: "xiaomi_mimo" }),
    });

    assert.equal(res.statusCode, 401);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("DELETE without auth returns 401", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const res = await call(handler, "/functions/tokentracker-token-plan-console-sessions?id=test-id", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
    });

    assert.equal(res.statusCode, 401);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("POST /functions/.../verify without native_result returns 400 and never marks connected", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    const createRes = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/verify-test-uuid",
      }),
    });
    const createdSession = readJsonResponse(createRes).session;

    const verifyRes = await call(
      handler,
      `/functions/tokentracker-token-plan-console-sessions/${createdSession.id}/verify`,
      { method: "POST", headers, body: JSON.stringify({}) }
    );
    assert.equal(verifyRes.statusCode, 400);
    const verifyBody = readJsonResponse(verifyRes);
    assert.match(verifyBody.error || "", /native_result|native/i);

    // Status must remain pending_login
    const listRes = await call(handler, "/functions/tokentracker-token-plan-console-sessions");
    const listBody = readJsonResponse(listRes);
    assert.equal(listBody.sessions[0].status, "pending_login");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("verify with native state awaiting_verification updates session to awaiting_verification (not connected)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    const createRes = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/awaiting-uuid",
      }),
    });
    const createdSession = readJsonResponse(createRes).session;

    const verifyRes = await call(
      handler,
      `/functions/tokentracker-token-plan-console-sessions/${createdSession.id}/verify`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          native_result: {
            connected: false,
            state_code: "awaiting_verification",
            error_code: "AWAITING_VERIFICATION",
            error_message: "等待小米控制台登录完成",
          },
        }),
      }
    );
    assert.equal(verifyRes.statusCode, 200);
    const verifyBody = readJsonResponse(verifyRes);
    assert.equal(verifyBody.session.status, "awaiting_verification");
    assert.notEqual(verifyBody.session.status, "connected");
    assert.equal(verifyBody.session.connected_at, "");
    assert.ok(verifyBody.session.last_verified_at, "last_verified_at must be set");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("verify with native state connected marks the session connected exactly once", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    const createRes = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/connected-uuid",
      }),
    });
    const createdSession = readJsonResponse(createRes).session;
    assert.equal(createdSession.status, "pending_login");

    const verifyRes = await call(
      handler,
      `/functions/tokentracker-token-plan-console-sessions/${createdSession.id}/verify`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          native_result: {
            connected: true,
            state_code: "connected",
            error_code: "",
            error_message: "",
          },
        }),
      }
    );
    assert.equal(verifyRes.statusCode, 200);
    const verifyBody = readJsonResponse(verifyRes);
    assert.equal(verifyBody.session.status, "connected");
    assert.ok(verifyBody.session.connected_at, "connected_at must be set on first connect");
    assert.equal(verifyBody.session.last_error_code, "");
    assert.equal(verifyBody.session.last_error_message, "");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("verify with connected quota updates only the session and does not create a fallback plan", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-session-ownership-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    const createRes = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/quota-ownership",
      }),
    });
    const createdSession = readJsonResponse(createRes).session;

    const verifyRes = await call(
      handler,
      `/functions/tokentracker-token-plan-console-sessions/${createdSession.id}/verify`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          native_result: {
            connected: true,
            session_ref: createdSession.session_ref,
            state_code: "connected",
            error_code: "",
            error_message: "",
            quota: {
              total_quota: 11_000_000_000,
              used_quota: 1_000_000_000,
              remaining_quota: 10_000_000_000,
              expires_at: null,
              provider_reported_at: "2026-06-28T00:00:00.000Z",
            },
          },
        }),
      },
    );

    assert.equal(verifyRes.statusCode, 200);
    const verifyBody = readJsonResponse(verifyRes);
    assert.equal(verifyBody.session.status, "connected");

    const plans = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans"));
    assert.equal(plans.records.some((record) =>
      record.provider_id === "xiaomi_mimo"
      && record.detection_config?.official_account?.account_binding_id === createdSession.id
    ), false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("verify with non-official domain native result marks session as failed and never connected", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    const createRes = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/phish-uuid",
      }),
    });
    const createdSession = readJsonResponse(createRes).session;

    const verifyRes = await call(
      handler,
      `/functions/tokentracker-token-plan-console-sessions/${createdSession.id}/verify`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          native_result: {
            connected: false,
            state_code: "non_official_domain",
            error_code: "NON_OFFICIAL_DOMAIN",
            error_message: "会话跳转到非官方域名",
          },
        }),
      }
    );
    assert.equal(verifyRes.statusCode, 200);
    const verifyBody = readJsonResponse(verifyRes);
    assert.equal(verifyBody.session.status, "failed");
    assert.notEqual(verifyBody.session.status, "connected");
    assert.equal(verifyBody.session.connected_at, "");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("verify with desktop_session_not_verified native result marks session as failed and never connected", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    const createRes = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/desktop-uuid",
      }),
    });
    const createdSession = readJsonResponse(createRes).session;

    const verifyRes = await call(
      handler,
      `/functions/tokentracker-token-plan-console-sessions/${createdSession.id}/verify`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          native_result: {
            connected: false,
            state_code: "desktop_session_not_verified",
            error_code: "DESKTOP_SESSION_NOT_VERIFIED",
            error_message: "桌面端暂无法验证小米控制台登录状态，不能继续实时同步。",
          },
        }),
      }
    );
    assert.equal(verifyRes.statusCode, 200);
    const verifyBody = readJsonResponse(verifyRes);
    assert.equal(verifyBody.session.status, "failed");
    assert.notEqual(verifyBody.session.status, "connected");
    assert.equal(verifyBody.session.connected_at, "");
    assert.equal(verifyBody.session.last_error_code, "DESKTOP_SESSION_NOT_VERIFIED");
    assert.match(verifyBody.session.last_error_message, /桌面端/);
    assert.match(verifyBody.session.last_error_message, /无法验证/);
    assert.match(verifyBody.session.last_error_message, /实时同步/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("session_ref is stored as reference, not cookie value", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const headers = await getAuthHeaders(handler);

    const res = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "小米 MiMo 控制台账号",
        session_ref: "token-plan/xiaomi_mimo/session/ref-12345",
      }),
    });

    const body = readJsonResponse(res);
    assert.ok(body.session.session_ref.startsWith("token-plan/"), "session_ref should be a path reference");
    assert.ok(!body.session.session_ref.includes("cookie"), "session_ref should not contain 'cookie'");
    assert.ok(!body.session.session_ref.includes("Bearer"), "session_ref should not contain 'Bearer'");
    assert.ok(!body.session.session_ref.includes("sk-"), "session_ref should not contain API key prefix 'sk-'");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("session_ref containing cookie/Bearer/sk-/token= is rejected with 400", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    for (const badRef of [
      "token-plan/xiaomi_mimo/session/cookie=abc",
      "token-plan/Bearer/session/abc",
      "session/sk-abcdef123",
      "session/token=eyJhbGciOiJIUzI1NiJ9",
    ]) {
      const res = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider_id: "xiaomi_mimo",
          auth_kind: "official_console_session",
          display_name: "X",
          session_ref: badRef,
        }),
      });
      assert.equal(res.statusCode, 400, `must reject ${badRef}`);
      const body = readJsonResponse(res);
      assert.match(body.error || "", /session_ref|credential|path/i);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// --- W03-R3D: 统一同步状态 — console session + detection integration ---

test("R3D plan with detection_method=official_account preserves quota when console session exists but detection is unsupported", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-r3d-console-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    // Create a plan with existing quota and official_account detection
    const planRes = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "r3d-console-plan",
        source: "hermes",
        provider_id: "xiaomi_mimo",
        plan_id: "xiaomi_mimo_standard_monthly",
        plan_label: "Standard",
        total_quota: 11000000000,
        used_quota: 5000000000,
        remaining_quota: 6000000000,
        expires_at: "2026-12-31",
        provider_reported_at: "2026-06-20T10:00:00Z",
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
        quota_source: "catalog",
      }),
    });
    assert.equal(planRes.statusCode, 200);
    const planBody = readJsonResponse(planRes);

    // Plan must have detection_method preserved
    assert.equal(planBody.record.detection_method, "official_account");
    // Quota must be preserved (no zeroing out)
    assert.ok(planBody.record.total_quota > 0, "total_quota must be preserved");
    assert.ok(planBody.record.used_quota > 0, "used_quota must be preserved");
    assert.ok(planBody.record.remaining_quota > 0, "remaining_quota must be preserved");

    // Verify plan appears in GET with full quota
    const getRes = await call(handler, "/functions/tokentracker-token-plans");
    const getBody = readJsonResponse(getRes);
    const found = getBody.records.find((r) => r.id === "r3d-console-plan");
    assert.ok(found, "plan must be in GET response");
    assert.equal(found.total_quota, 11000000000, "GET must return original total_quota");
    assert.equal(found.used_quota, 5000000000, "GET must return original used_quota");
    assert.equal(found.remaining_quota, 6000000000, "GET must return original remaining_quota");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("R3D plan with detection_method configured disallows manual quota zero-overwrite in upsert", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-r3d-quota-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    // Step 1: Create a plan with custom_api detection and existing quota
    const createRes = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "r3d-quota-plan",
        source: "hermes",
        provider_id: "custom",
        plan_id: "custom",
        plan_label: "Custom API Plan",
        total_quota: 5000000,
        used_quota: 2000000,
        remaining_quota: 3000000,
        expires_at: "2026-09-01",
        refresh_method: "manual",
        refresh_enabled: false,
        detection_method: "custom_api",
        detection_config: {
          custom_api: {
            api_key_ref: "token-plan/hermes/api/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            request_url: "https://api.example.com/v1/usage",
            method: "GET",
            response_mapping: {
              total_quota_path: "data.total",
              used_quota_path: "data.used",
              remaining_quota_path: "data.remaining",
            },
          },
        },
        sync_status: "success",
        last_synced_at: "2026-06-20T10:00:00Z",
        quota_source: "custom_api",
        provider_reported_at: "2026-06-20T10:00:00Z",
      }),
    });
    assert.equal(createRes.statusCode, 200);

    // Step 2: Attempt to update the same plan with used_quota=0, remaining_quota=0
    // (simulating a form submit that only changed non-quota fields)
    const updateRes = await call(handler, "/functions/tokentracker-token-plans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "r3d-quota-plan",
        source: "hermes",
        provider_id: "custom",
        plan_id: "custom",
        plan_label: "Custom API Plan",
        total_quota: 5000000,
        used_quota: 0,            // ← attempting to zero out
        remaining_quota: 0,       // ← attempting to zero out
        expires_at: "",           // ← attempting to clear
        refresh_method: "manual",
        refresh_enabled: false,
        detection_method: "custom_api",
        sync_status: "success",
        last_synced_at: "2026-06-20T10:00:00Z",
      }),
    });
    assert.equal(updateRes.statusCode, 200);
    const updateBody = readJsonResponse(updateRes);

    // R3D: Detection-configured plan must NOT accept zero-overwrite
    assert.ok(updateBody.record.used_quota > 0,
      "used_quota must not be zeroed when detection is configured");
    assert.ok(updateBody.record.remaining_quota > 0,
      "remaining_quota must not be zeroed when detection is configured");
    assert.ok(updateBody.record.expires_at,
      "expires_at must not be cleared when detection is configured");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("GLM console verification stores only sanitized balance", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    const created = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "glm",
        auth_kind: "official_console_session",
        display_name: "GLM 官网账号",
        session_ref: "token-plan/glm/session/test",
      }),
    });
    const createdBody = readJsonResponse(created);
    const sessionId = createdBody.session.id;

    const verifyRes = await call(
      handler,
      `/functions/tokentracker-token-plan-console-sessions/${sessionId}/verify`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          native_result: {
            connected: true,
            session_ref: "token-plan/glm/session/test",
            state_code: "connected",
            error_code: "",
            error_message: "",
            balance: {
              balance: 88.5,
              available_balance: 80,
              credit_balance: 8.5,
              currency: "CNY",
              provider_reported_at: "2026-07-03T12:00:00.000Z",
            },
          },
        }),
      },
    );
    assert.equal(verifyRes.statusCode, 200);
    const body = readJsonResponse(verifyRes);
    assert.equal(body.session.balance.available_balance, 80);
    assert.equal(/authorization|cookie|raw_response/i.test(JSON.stringify(body)), false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex authorized without quota remains connected with a retryable sync error", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-codex-authorized-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);
    const sessionRef = "token-plan/codex/session/authorized-test";

    const created = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "codex",
        auth_kind: "official_console_session",
        display_name: "Codex 官网账号",
        session_ref: sessionRef,
      }),
    });
    const sessionId = readJsonResponse(created).session.id;

    const verified = await call(
      handler,
      `/functions/tokentracker-token-plan-console-sessions/${sessionId}/verify`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          native_result: {
            connected: true,
            authorized: true,
            session_ref: sessionRef,
            state_code: "authorized",
            error_code: "QUOTA_SYNC_FAILED",
            error_message: "授权已完成，但额度同步暂时失败，可稍后重试。",
          },
        }),
      },
    );

    assert.equal(verified.statusCode, 200);
    const body = readJsonResponse(verified);
    assert.equal(body.session.status, "connected");
    assert.equal(body.session.last_error_code, "QUOTA_SYNC_FAILED");
    assert.equal(body.session.last_error_message, "授权已完成，但额度同步暂时失败，可稍后重试。");
    assert.equal(
      /authorization|cookie|\"token\"|raw_response|headers/i.test(JSON.stringify(body)),
      false,
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
