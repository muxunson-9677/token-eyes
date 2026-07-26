require("./helpers/home-shim.cjs");

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

function createRequest({ method = "GET", headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { host: "127.0.0.1:7680", ...headers };
  req[Symbol.asyncIterator] = async function* iterateBody() {
    if (body != null) yield Buffer.from(body);
  };

  process.nextTick(() => {
    if (body != null) req.emit("data", Buffer.from(body));
    req.emit("end");
  });

  return req;
}

async function callLocalApi(handler, pathname, {
  method = "GET",
  headers = {},
  body,
} = {}) {
  const req = createRequest({ method, headers, body });
  const res = createResponse();
  const handled = await handler(
    req,
    res,
    new URL(pathname, "http://127.0.0.1:7680"),
  );
  return { handled, req, res };
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

async function getLocalAuthToken(handler) {
  const req = createRequest({ method: "GET" });
  const res = createResponse();
  const handled = await handler(req, res, new URL("http://127.0.0.1/api/local-auth"));
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const body = JSON.parse(res.body.toString("utf8"));
  assert.equal(typeof body.token, "string");
  assert.ok(body.token.length > 0);
  return body.token;
}

function loadLocalApiWithSpawn(fakeSpawn) {
  const childProcess = require("node:child_process");
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = fakeSpawn;
  delete require.cache[require.resolve("../src/lib/local-api")];
  const mod = require("../src/lib/local-api");
  return {
    mod,
    restore() {
      childProcess.spawn = originalSpawn;
      delete require.cache[require.resolve("../src/lib/local-api")];
    },
  };
}

function createSuccessfulSpawn(calls) {
  return (cmd, args, options) => {
    calls.push({ cmd, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => {
      child.stdout.emit("data", "sync ok");
      child.emit("close", 0);
    });
    return child;
  };
}

test("local sync rejects arbitrary insforgeBaseUrl overrides", async () => {
  const calls = [];
  const prevBaseUrl = process.env.TOKENTRACKER_INSFORGE_BASE_URL;
  process.env.TOKENTRACKER_INSFORGE_BASE_URL = "https://allowed.example";
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({
        deviceToken: "device-token",
        insforgeBaseUrl: "https://evil.example",
      }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
      ok: false,
      error: "Unsupported insforgeBaseUrl override",
    });
    assert.equal(calls.length, 0);
  } finally {
    restore();
    if (prevBaseUrl === undefined) delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
    else process.env.TOKENTRACKER_INSFORGE_BASE_URL = prevBaseUrl;
  }
});

test("local sync accepts the configured insforgeBaseUrl override", async () => {
  const calls = [];
  const prevBaseUrl = process.env.TOKENTRACKER_INSFORGE_BASE_URL;
  process.env.TOKENTRACKER_INSFORGE_BASE_URL = "https://allowed.example";

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({
        deviceToken: "device-token",
        insforgeBaseUrl: "https://allowed.example/",
      }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].options.env.TOKENTRACKER_INSFORGE_BASE_URL,
      "https://allowed.example",
    );
  } finally {
    restore();
    if (prevBaseUrl === undefined) delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
    else process.env.TOKENTRACKER_INSFORGE_BASE_URL = prevBaseUrl;
  }
});

test("local sync drain request runs sync with --drain", async () => {
  const calls = [];
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({
        deviceToken: "device-token",
        drain: true,
      }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-3), [path.join(process.cwd(), "bin/tracker.js"), "sync", "--drain"]);
  } finally {
    restore();
  }
});

test("local sync only treats boolean true as drain", async () => {
  const cases = [
    {},
    { drain: false },
    { drain: "true" },
    { drain: 1 },
  ];

  for (const body of cases) {
    const calls = [];
    const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

    try {
      const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
      const localAuthToken = await getLocalAuthToken(handler);
      const req = createRequest({
        method: "POST",
        headers: { "x-tokentracker-local-auth": localAuthToken },
        body: JSON.stringify({
          deviceToken: "device-token",
          ...body,
        }),
      });
      const res = createResponse();

      const handled = await handler(
        req,
        res,
        new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
      );

      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args.slice(-2), [path.join(process.cwd(), "bin/tracker.js"), "sync"]);
    } finally {
      restore();
    }
  }
});

test("local sync drain request mints a device token from relayed login when none is provided", async () => {
  const calls = [];
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-local-sync-drain-"));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  const prevBaseUrl = process.env.TOKENTRACKER_INSFORGE_BASE_URL;
  const prevFetch = global.fetch;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.TOKENTRACKER_INSFORGE_BASE_URL = "https://cloud.example";

  const trackerDir = path.join(tmpHome, ".tokentracker", "tracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDir, "cloud-sync-pref.json"), JSON.stringify({ enabled: true }));
  fs.writeFileSync(path.join(trackerDir, "config.json"), JSON.stringify({ machineId: "machine-abcdef12" }));
  fs.writeFileSync(
    path.join(trackerDir, "relay-cookies.json"),
    JSON.stringify({
      insforge_refresh_token: "insforge_refresh_token=refresh-xyz; Path=/; HttpOnly; SameSite=Lax",
    }),
  );

  const fetchCalls = [];
  global.fetch = async (urlStr, opts = {}) => {
    fetchCalls.push({ url: String(urlStr), opts });
    if (String(urlStr) === "https://cloud.example/api/auth/refresh?client_type=mobile") {
      return { ok: true, status: 200, json: async () => ({ accessToken: "access-token" }) };
    }
    if (String(urlStr) === "https://cloud.example/functions/tokentracker-device-token-issue") {
      assert.equal(opts.headers.Authorization, "Bearer access-token");
      const body = JSON.parse(String(opts.body || "{}"));
      assert.equal(body.machine_id, "machine-abcdef12");
      assert.equal(body.device_name, "Token Tracker (dashboard) #machine-");
      assert.equal(
        body.platform,
        process.platform === "darwin" ? "MacIntel" :
          process.platform === "win32" ? "Win32" :
            process.platform === "linux" ? "Linux x86_64" :
              "web",
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "issued-device-token", device_id: "device-id" }),
      };
    }
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({ drain: true }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-3), [path.join(process.cwd(), "bin/tracker.js"), "sync", "--drain"]);
    assert.equal(calls[0].options.env.TOKENTRACKER_DEVICE_TOKEN, "issued-device-token");
    assert.ok(fetchCalls.some((c) => c.url.endsWith("/api/auth/refresh?client_type=mobile")));
    assert.ok(fetchCalls.some((c) => c.url.endsWith("/functions/tokentracker-device-token-issue")));
  } finally {
    restore();
    global.fetch = prevFetch;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    if (prevBaseUrl === undefined) delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
    else process.env.TOKENTRACKER_INSFORGE_BASE_URL = prevBaseUrl;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("local sync drain request fails when relayed device token cannot be issued", async () => {
  const calls = [];
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-local-sync-drain-fail-"));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  const prevBaseUrl = process.env.TOKENTRACKER_INSFORGE_BASE_URL;
  const prevFetch = global.fetch;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.TOKENTRACKER_INSFORGE_BASE_URL = "https://cloud.example";

  const trackerDir = path.join(tmpHome, ".tokentracker", "tracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDir, "cloud-sync-pref.json"), JSON.stringify({ enabled: true }));
  fs.writeFileSync(path.join(trackerDir, "config.json"), JSON.stringify({ machineId: "machine-abcdef12" }));
  fs.writeFileSync(
    path.join(trackerDir, "relay-cookies.json"),
    JSON.stringify({
      insforge_refresh_token: "insforge_refresh_token=refresh-xyz; Path=/; HttpOnly; SameSite=Lax",
    }),
  );

  global.fetch = async (urlStr) => {
    if (String(urlStr) === "https://cloud.example/api/auth/refresh?client_type=mobile") {
      return { ok: true, status: 200, json: async () => ({ accessToken: "access-token" }) };
    }
    if (String(urlStr) === "https://cloud.example/functions/tokentracker-device-token-issue") {
      return { ok: false, status: 502, json: async () => ({ error: "upstream unavailable" }) };
    }
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({ drain: true }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
      ok: false,
      error: "Unable to issue cloud device token for drain sync",
    });
    assert.equal(calls.length, 0);
  } finally {
    restore();
    global.fetch = prevFetch;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    if (prevBaseUrl === undefined) delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
    else process.env.TOKENTRACKER_INSFORGE_BASE_URL = prevBaseUrl;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("local sync rejects requests without the local auth token", async () => {
  const calls = [];
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const req = createRequest({
      method: "POST",
      body: JSON.stringify({ deviceToken: "device-token" }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
      ok: false,
      error: "Unauthorized",
    });
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("auth bridge mutation requires the local auth token", async () => {
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn([]));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const req = createRequest({
      method: "PUT",
      body: JSON.stringify({ native: true }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/api/auth-bridge/verifier"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
      ok: false,
      error: "Unauthorized",
    });
  } finally {
    restore();
  }
});

test("rejects malicious Origin on preflight, handshake, sensitive GET, and POST", async () => {
  const handler = require("../src/lib/local-api").createLocalApiHandler({
    queuePath: path.join(os.tmpdir(), "r2-malicious-origin-queue.jsonl"),
    listeningPort: 7680,
  });
  const maliciousOrigin = "https://attacker.example";

  for (const request of [
    {
      pathname: "/functions/tokentracker-usage-summary",
      method: "OPTIONS",
      headers: {
        origin: maliciousOrigin,
        "access-control-request-method": "GET",
      },
    },
    {
      pathname: "/api/local-auth",
      headers: { origin: maliciousOrigin },
    },
    {
      pathname: "/functions/tokentracker-usage-summary",
      headers: { origin: maliciousOrigin },
    },
    {
      pathname: "/functions/tokentracker-local-sync",
      method: "POST",
      headers: { origin: maliciousOrigin },
    },
  ]) {
    const { handled, res } = await callLocalApi(handler, request.pathname, request);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 403);
    assert.notEqual(res.headers?.["Access-Control-Allow-Origin"], "*");
    assert.deepEqual(JSON.parse(res.body.toString("utf8")), { error: "Forbidden" });
  }
});

test("rejects public, rebinding, and wrong-port Host headers", async () => {
  const handler = require("../src/lib/local-api").createLocalApiHandler({
    queuePath: path.join(os.tmpdir(), "r2-host-queue.jsonl"),
    listeningPort: 7680,
  });

  for (const host of [
    "attacker.example:7680",
    "127.0.0.1.attacker.example:7680",
    "127.0.0.1:9999",
    "localhost:9999",
  ]) {
    const { res } = await callLocalApi(handler, "/api/local-auth", {
      headers: { host },
    });
    assert.equal(res.statusCode, 403, host);
    assert.deepEqual(JSON.parse(res.body.toString("utf8")), { error: "Forbidden" });
  }
});

test("sensitive GET requires a current local auth token", async () => {
  const handler = require("../src/lib/local-api").createLocalApiHandler({
    queuePath: path.join(os.tmpdir(), "r2-sensitive-get-queue.jsonl"),
    listeningPort: 7680,
  });

  for (const token of [undefined, "fake-token"]) {
    const headers = token ? { "x-tokentracker-local-auth": token } : {};
    const { res } = await callLocalApi(
      handler,
      "/functions/tokentracker-usage-summary",
      { headers },
    );
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers["X-TokenTracker-Local-Auth-Required"], "1");
    assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
      ok: false,
      error: "Unauthorized",
    });
  }

  const token = await getLocalAuthToken(handler);
  const replacementHandler = require("../src/lib/local-api").createLocalApiHandler({
    queuePath: path.join(os.tmpdir(), "r2-expired-token-queue.jsonl"),
    listeningPort: 7680,
  });
  const { res: expiredRes } = await callLocalApi(
    replacementHandler,
    "/functions/tokentracker-usage-summary",
    { headers: { "x-tokentracker-local-auth": token } },
  );
  assert.equal(expiredRes.statusCode, 401);
  assert.equal(expiredRes.headers["X-TokenTracker-Local-Auth-Required"], "1");

  const currentToken = await getLocalAuthToken(replacementHandler);
  const { res: validRes } = await callLocalApi(
    replacementHandler,
    "/functions/tokentracker-usage-summary",
    { headers: { "x-tokentracker-local-auth": currentToken } },
  );
  assert.equal(validRes.statusCode, 200);
});

test("allows dev, Tauri, same-origin, and strict no-Origin CLI handshakes", async () => {
  const handler = require("../src/lib/local-api").createLocalApiHandler({
    queuePath: path.join(os.tmpdir(), "r2-allowed-origin-queue.jsonl"),
    listeningPort: 7680,
  });

  for (const origin of [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:7680",
    "http://127.0.0.1:7680",
    "http://tauri.localhost",
    "tauri://localhost",
    undefined,
  ]) {
    const headers = origin ? { origin } : {};
    const { res } = await callLocalApi(handler, "/api/local-auth", { headers });
    assert.equal(res.statusCode, 200, origin || "no Origin");
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.notEqual(res.headers["Access-Control-Allow-Origin"], "*");
    if (origin) {
      assert.equal(res.headers["Access-Control-Allow-Origin"], origin);
      assert.match(res.headers.Vary || "", /(?:^|,\s*)Origin(?:,|$)/);
    } else {
      assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
    }
  }
});

test("rejects tauri.localhost origins with arbitrary ports", async () => {
  const handler = require("../src/lib/local-api").createLocalApiHandler({
    queuePath: path.join(os.tmpdir(), "r2-tauri-origin-port-queue.jsonl"),
    listeningPort: 7680,
  });

  for (const origin of [
    "http://tauri.localhost:7680",
    "http://tauri.localhost:5173",
    "https://tauri.localhost:4433",
  ]) {
    const { res } = await callLocalApi(handler, "/api/local-auth", {
      headers: { origin },
    });
    assert.equal(res.statusCode, 403, origin);
  }
});

test("accepts IPv6 loopback Host only when the server is bound to IPv6 loopback", () => {
  const { validateLocalApiRequest } = require("../src/lib/local-api");
  assert.equal(validateLocalApiRequest(
    { headers: { host: "[::1]:7680" } },
    { listeningPort: 7680, bindHost: "::1" },
  ).ok, true);
  assert.equal(validateLocalApiRequest(
    { headers: { host: "[::1]:7680" } },
    { listeningPort: 7680, bindHost: "127.0.0.1" },
  ).ok, false);
  assert.equal(validateLocalApiRequest(
    { headers: { host: "[::2]:7680" } },
    { listeningPort: 7680, bindHost: "::1" },
  ).ok, false);
});

test("anonymous verifier GET cannot consume the one-time OAuth flag", async () => {
  const handler = require("../src/lib/local-api").createLocalApiHandler({
    queuePath: path.join(os.tmpdir(), "r2-auth-verifier-queue.jsonl"),
    listeningPort: 7680,
  });
  const token = await getLocalAuthToken(handler);
  const { res: setPending } = await callLocalApi(handler, "/api/auth-bridge/verifier", {
    method: "PUT",
    headers: { "x-tokentracker-local-auth": token },
    body: JSON.stringify({ native: true }),
  });
  assert.equal(setPending.statusCode, 200);

  const { res: anonymous } = await callLocalApi(handler, "/api/auth-bridge/verifier");
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.headers["X-TokenTracker-Local-Auth-Required"], "1");

  const { res: authorized } = await callLocalApi(handler, "/api/auth-bridge/verifier", {
    headers: { "x-tokentracker-local-auth": token },
  });
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(JSON.parse(authorized.body.toString("utf8")), { native: true });
});

test("rejects every unauthenticated local API write before route handling", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("write must not reach upstream");
  };
  const handler = require("../src/lib/local-api").createLocalApiHandler({
    queuePath: path.join(os.tmpdir(), "r2-write-auth-queue.jsonl"),
    listeningPort: 7680,
  });

  try {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const { res } = await callLocalApi(handler, "/api/auth/session", {
        method,
        body: "{}",
      });
      assert.equal(res.statusCode, 401, method);
      assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
        ok: false,
        error: "Unauthorized",
      });
    }
    assert.equal(fetchCalls, 0);

    const { res: localAuthWrite } = await callLocalApi(handler, "/api/local-auth", {
      method: "POST",
    });
    assert.equal(localAuthWrite.statusCode, 405);
  } finally {
    global.fetch = originalFetch;
  }
});

test("sensitive auth GET requires local auth before reaching upstream", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ user: { id: "local-test-user" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const handler = require("../src/lib/local-api").createLocalApiHandler({
    queuePath: path.join(os.tmpdir(), "r2-auth-get-queue.jsonl"),
    listeningPort: 7680,
  });

  try {
    const { res: unauthorized } = await callLocalApi(
      handler,
      "/api/auth/sessions/current",
    );
    assert.equal(unauthorized.statusCode, 401);
    assert.deepEqual(JSON.parse(unauthorized.body.toString("utf8")), {
      ok: false,
      error: "Unauthorized",
    });
    assert.equal(fetchCalls, 0);

    const token = await getLocalAuthToken(handler);
    const { res: authorized } = await callLocalApi(
      handler,
      "/api/auth/sessions/current",
      { headers: { "x-tokentracker-local-auth": token } },
    );
    assert.equal(authorized.statusCode, 200, authorized.body.toString("utf8"));
    assert.equal(fetchCalls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("ipcheck upstream wildcard CORS cannot override the validated local Origin", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      Vary: "Accept-Encoding",
    },
  });
  const handler = require("../src/lib/local-api").createLocalApiHandler({
    queuePath: path.join(os.tmpdir(), "r2-ipcheck-cors-queue.jsonl"),
    listeningPort: 7680,
  });

  try {
    const { res } = await callLocalApi(
      handler,
      "/proxy/ipcheck/api/geoip/127.0.0.1",
      { headers: { origin: "http://localhost:5173" } },
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Access-Control-Allow-Origin"], "http://localhost:5173");
    assert.notEqual(res.headers["Access-Control-Allow-Origin"], "*");
    assert.match(res.headers.Vary, /(?:^|,\s*)Origin(?:,|$)/);
    assert.match(res.headers.Vary, /(?:^|,\s*)Accept-Encoding(?:,|$)/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("createLocalApiHandler is secure by default when no options are provided", async () => {
  const handler = require("../src/lib/local-api").createLocalApiHandler({
    queuePath: path.join(os.tmpdir(), "r2-default-secure-queue.jsonl"),
  });
  const { res } = await callLocalApi(handler, "/api/local-auth", {
    headers: { host: "attacker.example:7680" },
  });
  assert.equal(res.statusCode, 403);
});

test("production callers cannot disable request security with a boolean option", async () => {
  const handler = require("../src/lib/local-api").createLocalApiHandler({
    queuePath: path.join(os.tmpdir(), "r2-no-public-security-switch-queue.jsonl"),
    listeningPort: 7680,
    enforceRequestSecurity: false,
  });
  const { res } = await callLocalApi(handler, "/api/local-auth", {
    headers: { host: "attacker.example:7680" },
  });
  assert.equal(res.statusCode, 403);
});
