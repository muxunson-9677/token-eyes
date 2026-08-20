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

async function createCodexSession(handler, headers, sessionRef) {
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
  return readJsonResponse(created).session;
}

async function persistNativeSessionState(handler, headers, sessionId, nativeResult) {
  return call(
    handler,
    `/functions/tokentracker-token-plan-console-sessions/${sessionId}/verify`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ native_result: nativeResult }),
    },
  );
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

test("Xiaomi terminal warning states are persisted canonically without upstream details", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-xiaomi-terminal-warnings-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);
    const syntheticSecret = "synthetic-upstream-secret-must-not-persist";
    const cases = [
      {
        state: "reauth_required",
        errorCode: "REAUTH_REQUIRED",
        errorMessage: "Xiaomi MiMo authorization must be completed again.",
      },
      {
        state: "temporary",
        errorCode: "TEMPORARY",
        errorMessage: "Xiaomi MiMo quota service is temporarily unavailable.",
      },
      {
        state: "unsupported",
        errorCode: "UNSUPPORTED",
        errorMessage: "Xiaomi MiMo quota response is unsupported.",
      },
    ];

    for (const item of cases) {
      const created = readJsonResponse(await call(
        handler,
        "/functions/tokentracker-token-plan-console-sessions",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            provider_id: "xiaomi_mimo",
            auth_kind: "official_console_session",
            display_name: "Xiaomi MiMo",
            session_ref: `provider-api/xiaomi_mimo/session/${item.state}`,
          }),
        },
      )).session;

      const verified = readJsonResponse(await persistNativeSessionState(
        handler,
        headers,
        created.id,
        {
          connected: false,
          session_ref: created.session_ref,
          state_code: item.state,
          error_code: `${syntheticSecret}-${item.state}`,
          error_message: `${syntheticSecret}-${item.state}`,
        },
      )).session;

      assert.equal(verified.status, item.state, item.state);
      assert.equal(verified.last_error_code, item.errorCode, item.state);
      assert.equal(verified.last_error_message, item.errorMessage, item.state);
      assert.equal(JSON.stringify(verified).includes(syntheticSecret), false, item.state);
    }

    const reloaded = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const persisted = readJsonResponse(
      await call(reloaded, "/functions/tokentracker-token-plan-console-sessions"),
    ).sessions;
    for (const item of cases) {
      const session = persisted.find((candidate) => candidate.session_ref.endsWith(`/${item.state}`));
      assert.equal(session.status, item.state, item.state);
      assert.equal(session.last_error_code, item.errorCode, item.state);
      assert.equal(session.last_error_message, item.errorMessage, item.state);
    }
    const rawConfig = await fs.readFile(path.join(trackerDir, "config.json"), "utf8");
    assert.equal(rawConfig.includes(syntheticSecret), false);
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

test("Task 4 success snapshots preserve omitted and null quota fields but accept explicit zero", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-r3d-quota-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    for (const snapshot of [
      { id: "task4-used-full", used_quota: 100, remaining_quota: 0 },
      { id: "task4-remaining-full", used_quota: 0, remaining_quota: 100 },
    ]) {
      const common = {
        id: snapshot.id,
        source: "hermes",
        provider_id: "custom",
        plan_id: "custom",
        plan_label: "Task 4 quota",
        detection_method: "official_account",
        sync_status: "success",
      };
      const created = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...common,
          total_quota: 100,
          used_quota: 50,
          remaining_quota: 50,
          provider_reported_fields: ["total_quota", "used_quota", "remaining_quota"],
          provider_reported_at: "2026-06-20T10:00:00Z",
        }),
      });
      assert.equal(created.statusCode, 200);

      const omitted = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...common, plan_label: "Task 4 quota edited" }),
      })).record;
      assert.equal(omitted.used_quota, 50, "absent used_quota must preserve last-good");
      assert.equal(omitted.remaining_quota, 50, "absent remaining_quota must preserve last-good");

      const nullCompatible = readJsonResponse(await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...common,
          used_quota: null,
          remaining_quota: null,
        }),
      })).record;
      assert.equal(nullCompatible.used_quota, 50, "null used_quota must preserve last-good");
      assert.equal(nullCompatible.remaining_quota, 50, "null remaining_quota must preserve last-good");

      const updated = await call(handler, "/functions/tokentracker-token-plans", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...common,
          used_quota: snapshot.used_quota,
          remaining_quota: snapshot.remaining_quota,
          provider_reported_fields: ["used_quota", "remaining_quota"],
          provider_reported_at: "2026-06-21T10:00:00Z",
        }),
      });
      assert.equal(updated.statusCode, 200);
      const record = readJsonResponse(updated).record;
      assert.equal(record.used_quota, snapshot.used_quota);
      assert.equal(record.remaining_quota, snapshot.remaining_quota);
    }

    const reloaded = readJsonResponse(
      await call(handler, "/functions/tokentracker-token-plans"),
    ).records;
    assert.equal(reloaded.find((record) => record.id === "task4-used-full").remaining_quota, 0);
    assert.equal(reloaded.find((record) => record.id === "task4-remaining-full").used_quota, 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("GLM balance-only console verification stays sanitized and cannot infer a cohort", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-console-sessions-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(path.join(trackerDir, "config.json"), JSON.stringify({
      tokenPlans: [{
        id: "glm-balance-only-plan",
        source: "hermes",
        provider_id: "glm",
        plan_id: "glm_pro",
        plan_label: "Pro",
        detection_method: "official_account",
        detection_config: {
          official_account: { account_binding_id: "glm-balance-only-session" },
        },
      }],
    }), "utf8");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    const created = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "glm-balance-only-session",
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
    assert.equal(Object.prototype.hasOwnProperty.call(body.session, "entitlement_revision"), false);
    assert.equal(/authorization|cookie|raw_response/i.test(JSON.stringify(body)), false);
    const plan = readJsonResponse(
      await call(handler, "/functions/tokentracker-token-plans"),
    ).records.find((record) => record.id === "glm-balance-only-plan");
    assert.equal(plan.entitlement_revision, "unknown");
    assert.deepEqual(plan.entitlement_windows, []);
    for (const field of ["total_quota", "used_quota", "remaining_quota"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(plan, field), false);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("DATA-06 Xiaomi partial balance keeps missing credit null and client freshness separate from provider time", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-xiaomi-partial-balance-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);
    const sessionRef = "token-plan/xiaomi_mimo/session/partial-balance";
    const created = await call(handler, "/functions/tokentracker-token-plan-console-sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider_id: "xiaomi_mimo",
        auth_kind: "official_console_session",
        display_name: "Xiaomi MiMo console session",
        session_ref: sessionRef,
      }),
    });
    const sessionId = readJsonResponse(created).session.id;
    const verified = await persistNativeSessionState(handler, headers, sessionId, {
      connected: true,
      session_ref: sessionRef,
      state_code: "connected",
      error_code: "",
      error_message: "",
      balance: {
        balance: 120,
        available_balance: 100,
        credit_balance: null,
        currency: "CNY",
        partial: true,
        provider_reported_fields: ["balance", "available_balance"],
        fetched_at: "2026-08-20T12:00:00.000Z",
        observed_at: "2026-08-20T12:00:00.000Z",
        source_kind: "undocumented_console_api",
        support_tier: "best_effort",
      },
    });

    assert.equal(verified.statusCode, 200);
    const balance = readJsonResponse(verified).session.balance;
    assert.equal(balance.credit_balance, null);
    assert.equal(balance.partial, true);
    assert.deepEqual(balance.provider_reported_fields, ["balance", "available_balance"]);
    assert.equal(balance.fetched_at, "2026-08-20T12:00:00.000Z");
    assert.equal(balance.observed_at, "2026-08-20T12:00:00.000Z");
    assert.equal(balance.source_kind, "undocumented_console_api");
    assert.equal(balance.support_tier, "best_effort");
    assert.equal(Object.prototype.hasOwnProperty.call(balance, "provider_reported_at"), false);
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
            quota_sync_status: "error",
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

test("Codex authorization can be persisted before quota synchronization starts", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-codex-auth-first-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);
    const sessionRef = "token-plan/codex/session/auth-first-test";
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
            quota_sync_status: "idle",
            error_code: "",
            error_message: "",
          },
        }),
      },
    );

    assert.equal(verified.statusCode, 200);
    const body = readJsonResponse(verified);
    assert.equal(body.session.status, "connected");
    assert.equal(body.session.last_error_code, "");
    assert.equal(body.session.last_error_message, "");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex connected quota errors remain retryable without revoking the local binding", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-codex-connected-quota-error-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);
    const session = await createCodexSession(
      handler,
      headers,
      "token-plan/codex/session/connected-quota-error",
    );

    const verified = readJsonResponse(await persistNativeSessionState(
      handler,
      headers,
      session.id,
      {
        connected: true,
        authorized: true,
        session_ref: session.session_ref,
        state_code: "connected",
        quota_sync_status: "error",
        error_code: "UNTRUSTED_QUOTA_ERROR",
        error_message: "Quota synchronization can be retried without reconnecting.",
      },
    )).session;

    assert.equal(verified.status, "connected");
    assert.equal(verified.last_error_code, "QUOTA_SYNC_FAILED");
    assert.equal(
      verified.last_error_message,
      "Quota synchronization can be retried without reconnecting.",
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex successful quota synchronization clears the prior retryable quota error", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-codex-quota-recovered-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);
    const session = await createCodexSession(
      handler,
      headers,
      "token-plan/codex/session/quota-recovered",
    );

    await persistNativeSessionState(handler, headers, session.id, {
      connected: true,
      authorized: true,
      session_ref: session.session_ref,
      state_code: "authorized",
      quota_sync_status: "error",
      error_code: "QUOTA_SYNC_FAILED",
      error_message: "Quota synchronization failed temporarily.",
    });
    const recovered = readJsonResponse(await persistNativeSessionState(
      handler,
      headers,
      session.id,
      {
        connected: true,
        authorized: true,
        session_ref: session.session_ref,
        state_code: "authorized",
        quota_sync_status: "success",
        error_code: "STALE_NATIVE_ERROR",
        error_message: "This stale marker must not survive a successful quota sync.",
      },
    )).session;

    assert.equal(recovered.status, "connected");
    assert.equal(recovered.last_error_code, "");
    assert.equal(recovered.last_error_message, "");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex connected and authorized states reject inconsistent authorization tuples", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-codex-inconsistent-tuple-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);
    const cases = [
      { suffix: "connected-without-authorization", state_code: "connected", connected: true, authorized: false },
      { suffix: "authorized-without-connection", state_code: "authorized", connected: false, authorized: true },
    ];

    for (const item of cases) {
      const session = await createCodexSession(
        handler,
        headers,
        `token-plan/codex/session/${item.suffix}`,
      );
      const stored = readJsonResponse(await persistNativeSessionState(
        handler,
        headers,
        session.id,
        {
          connected: item.connected,
          authorized: item.authorized,
          session_ref: session.session_ref,
          state_code: item.state_code,
          quota_sync_status: "error",
          error_code: "UNTRUSTED_NATIVE_ERROR",
          error_message: "synthetic-sensitive-marker-must-not-be-persisted",
        },
      )).session;

      assert.equal(stored.status, "failed", item.suffix);
      assert.equal(stored.last_error_code, "AUTHORIZATION_FAILED", item.suffix);
      assert.notEqual(
        stored.last_error_message,
        "synthetic-sensitive-marker-must-not-be-persisted",
        item.suffix,
      );
      assert.equal(JSON.stringify(stored).includes("synthetic-sensitive-marker"), false, item.suffix);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex local state table persists login and terminal states and removes disconnected bindings", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-codex-local-state-table-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);

    const cases = [
      {
        suffix: "login-started",
        native: {
          connected: false,
          authorized: false,
          state_code: "login_started",
          error_code: "AWAITING_VERIFICATION",
          error_message: "Waiting for official authorization.",
        },
        expectedStatus: "awaiting_verification",
        expectedError: "",
      },
      {
        suffix: "failed",
        native: {
          connected: false,
          authorized: false,
          state_code: "failed",
          error_code: "AUTHORIZATION_FAILED",
          error_message: "Official authorization did not complete.",
        },
        expectedStatus: "failed",
        expectedError: "AUTHORIZATION_FAILED",
      },
      {
        suffix: "missing",
        native: {
          connected: false,
          authorized: false,
          state_code: "session_not_found",
          error_code: "",
          error_message: "",
        },
        expectedStatus: "failed",
        expectedError: "SESSION_NOT_FOUND",
      },
    ];

    for (const item of cases) {
      const session = await createCodexSession(
        handler,
        headers,
        `token-plan/codex/session/${item.suffix}`,
      );
      const stored = readJsonResponse(await persistNativeSessionState(
        handler,
        headers,
        session.id,
        { ...item.native, session_ref: session.session_ref },
      )).session;
      assert.equal(stored.status, item.expectedStatus, item.suffix);
      assert.equal(stored.last_error_code, item.expectedError, item.suffix);
    }

    const disconnected = await createCodexSession(
      handler,
      headers,
      "token-plan/codex/session/disconnected",
    );
    await persistNativeSessionState(handler, headers, disconnected.id, {
      connected: true,
      authorized: true,
      session_ref: disconnected.session_ref,
      state_code: "connected",
      quota_sync_status: "success",
      error_code: "",
      error_message: "",
    });
    const result = readJsonResponse(await persistNativeSessionState(
      handler,
      headers,
      disconnected.id,
      {
        connected: false,
        authorized: false,
        session_ref: disconnected.session_ref,
        state_code: "disconnected",
        error_code: "",
        error_message: "",
      },
    ));
    assert.equal(result.session.status, "disconnected");
    assert.equal(result.session.last_error_code, "");
    assert.equal(result.session.last_error_message, "");
    assert.equal(result.sessions.some((candidate) => candidate.id === disconnected.id), false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex disconnected keeps the connected binding unless the native tuple is clean", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-codex-disconnect-guard-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);
    const session = await createCodexSession(
      handler,
      headers,
      "token-plan/codex/session/disconnect-guard",
    );
    await persistNativeSessionState(handler, headers, session.id, {
      connected: true,
      authorized: true,
      session_ref: session.session_ref,
      state_code: "connected",
      quota_sync_status: "success",
      error_code: "",
      error_message: "",
    });

    const invalidResults = [
      {
        suffix: "logout-error",
        connected: false,
        authorized: false,
        error_code: "CODEX_LOGOUT_FAILED",
        error_message: "synthetic-logout-detail-must-not-be-persisted",
      },
      {
        suffix: "still-connected",
        connected: true,
        authorized: false,
        error_code: "",
        error_message: "",
      },
      {
        suffix: "still-authorized",
        connected: false,
        authorized: true,
        error_code: "",
        error_message: "",
      },
    ];

    for (const invalid of invalidResults) {
      const result = readJsonResponse(await persistNativeSessionState(
        handler,
        headers,
        session.id,
        {
          connected: invalid.connected,
          authorized: invalid.authorized,
          session_ref: session.session_ref,
          state_code: "disconnected",
          quota_sync_status: "idle",
          error_code: invalid.error_code,
          error_message: invalid.error_message,
        },
      ));
      assert.equal(result.session.status, "connected", invalid.suffix);
      assert.equal(result.session.last_error_code, "CODEX_LOGOUT_FAILED", invalid.suffix);
      assert.equal(result.sessions.some((candidate) => candidate.id === session.id), true, invalid.suffix);
      assert.equal(JSON.stringify(result).includes("synthetic-logout-detail"), false, invalid.suffix);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex reauth_required is persisted as a failed authorization terminal", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-codex-reauth-terminal-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);
    const session = await createCodexSession(
      handler,
      headers,
      "token-plan/codex/session/reauth-terminal",
    );

    await persistNativeSessionState(handler, headers, session.id, {
      connected: false,
      authorized: false,
      session_ref: session.session_ref,
      state_code: "reauth_required",
      error_code: "AUTHORIZATION_FAILED",
      error_message: "OpenAI 官方授权未完成，请重新连接。",
    });

    const reloaded = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const stored = readJsonResponse(
      await call(reloaded, "/functions/tokentracker-token-plan-console-sessions"),
    ).sessions.find((candidate) => candidate.id === session.id);
    assert.equal(stored.status, "failed");
    assert.equal(stored.last_error_code, "AUTHORIZATION_FAILED");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex session_not_found never overwrites an existing authorization failure", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-codex-error-precedence-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);
    const session = await createCodexSession(
      handler,
      headers,
      "token-plan/codex/session/error-precedence",
    );
    const authorizationFailure = {
      connected: false,
      authorized: false,
      session_ref: session.session_ref,
      state_code: "reauth_required",
      error_code: "AUTHORIZATION_FAILED",
      error_message: "State validation failed before credentials were stored.",
    };
    await persistNativeSessionState(handler, headers, session.id, authorizationFailure);
    const missing = await persistNativeSessionState(handler, headers, session.id, {
      connected: false,
      authorized: false,
      session_ref: session.session_ref,
      state_code: "session_not_found",
      error_code: "SESSION_NOT_FOUND",
      error_message: "Pending native login is no longer present.",
    });

    const stored = readJsonResponse(missing).session;
    assert.equal(stored.status, "failed");
    assert.equal(stored.last_error_code, authorizationFailure.error_code);
    assert.equal(stored.last_error_message, authorizationFailure.error_message);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex session_not_found replaces a connected quota warning", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-codex-missing-after-quota-warning-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);
    const session = await createCodexSession(
      handler,
      headers,
      "token-plan/codex/session/missing-after-quota-warning",
    );
    await persistNativeSessionState(handler, headers, session.id, {
      connected: true,
      authorized: true,
      session_ref: session.session_ref,
      state_code: "authorized",
      quota_sync_status: "error",
      error_code: "QUOTA_SYNC_FAILED",
      error_message: "Quota synchronization failed temporarily.",
    });

    const missing = readJsonResponse(await persistNativeSessionState(
      handler,
      headers,
      session.id,
      {
        connected: false,
        authorized: false,
        session_ref: session.session_ref,
        state_code: "session_not_found",
        error_code: "SESSION_NOT_FOUND",
        error_message: "Pending native login is no longer present.",
      },
    )).session;

    assert.equal(missing.status, "failed");
    assert.equal(missing.last_error_code, "SESSION_NOT_FOUND");
    assert.equal(missing.last_error_message, "Pending native login is no longer present.");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("successive Codex awaiting native states are persisted", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-codex-awaiting-rounds-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const headers = await getAuthHeaders(handler);
    const session = await createCodexSession(
      handler,
      headers,
      "token-plan/codex/session/awaiting-rounds",
    );

    const first = readJsonResponse(await persistNativeSessionState(handler, headers, session.id, {
      connected: false,
      authorized: false,
      session_ref: session.session_ref,
      state_code: "awaiting_verification",
      error_code: "AWAITING_VERIFICATION",
      error_message: "Waiting for account/login/completed.",
    })).session;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = readJsonResponse(await persistNativeSessionState(handler, headers, session.id, {
      connected: false,
      authorized: false,
      session_ref: session.session_ref,
      state_code: "awaiting_verification",
      error_code: "AWAITING_VERIFICATION",
      error_message: "Still waiting for account/login/completed.",
    })).session;

    assert.equal(first.status, "awaiting_verification");
    assert.equal(second.status, "awaiting_verification");
    assert.ok(Date.parse(second.last_verified_at) > Date.parse(first.last_verified_at));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("Codex cancel and timeout keep their specific failed records", async () => {
  for (const terminal of [
    {
      suffix: "cancelled",
      state_code: "failed",
      error_code: "AUTHORIZATION_CANCELLED",
      error_message: "Authorization was cancelled by the user.",
    },
    {
      suffix: "timed-out",
      state_code: "failed",
      error_code: "AUTHORIZATION_TIMEOUT",
      error_message: "Authorization timed out.",
    },
  ]) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `tokentracker-codex-${terminal.suffix}-`));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      const handler = createLocalApiHandler({
        queuePath: path.join(trackerDir, "queue.jsonl"),
        trackerDataDir: trackerDir,
      });
      const headers = await getAuthHeaders(handler);
      const session = await createCodexSession(
        handler,
        headers,
        `token-plan/codex/session/${terminal.suffix}`,
      );
      await persistNativeSessionState(handler, headers, session.id, {
        connected: false,
        authorized: false,
        session_ref: session.session_ref,
        state_code: terminal.state_code,
        error_code: terminal.error_code,
        error_message: terminal.error_message,
      });

      const stored = readJsonResponse(
        await call(handler, "/functions/tokentracker-token-plan-console-sessions"),
      ).sessions.find((candidate) => candidate.id === session.id);
      assert.equal(stored.status, "failed");
      assert.equal(stored.last_error_code, terminal.error_code);
      assert.equal(stored.last_error_message, terminal.error_message);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }
});
