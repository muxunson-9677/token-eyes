const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

require("./helpers/home-shim.cjs");

function isolateWindowsHomeEnv(tmp) {
  const keys = ["APPDATA", "LOCALAPPDATA", "USERPROFILE"];
  const saved = {};
  for (const key of keys) saved[key] = process.env[key];
  process.env.APPDATA = path.join(tmp, "AppData", "Roaming");
  process.env.LOCALAPPDATA = path.join(tmp, "AppData", "Local");
  process.env.USERPROFILE = tmp;
  return () => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

const {
  getUsageLimits,
  resetUsageLimitsCache,
  runCommand,
} = require("../src/lib/usage-limits");

function makeCountingDeps() {
  const commandCalls = [];
  let fetchCalls = 0;
  return {
    commandCalls,
    countFetchCalls: () => fetchCalls,
    options: {
      platform: "linux",
      providerTimeoutMs: 2000,
      securityRunner() {
        return { status: 1, stdout: "" };
      },
      // Async (slow) runner: keeps the fetch round in flight long enough for a
      // concurrent caller to arrive, and exercises the await path in runCommand.
      commandRunner(command, args) {
        commandCalls.push([command, ...(args || [])].join(" "));
        return new Promise((resolve) => {
          setTimeout(() => resolve({ status: 1, stdout: "", stderr: "" }), 50);
        });
      },
      fetchImpl() {
        fetchCalls += 1;
        return Promise.resolve({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) });
      },
    },
  };
}

function makeKimiPersistenceFixture(tmp) {
  const kimiHome = path.join(tmp, ".kimi");
  const credsPath = path.join(kimiHome, "credentials", "kimi-code.json");
  fs.mkdirSync(path.dirname(credsPath), { recursive: true });
  fs.writeFileSync(path.join(kimiHome, "config.toml"), 'default_model = "kimi-code/kimi-for-coding"\n');
  const oldRefreshToken = "synthetic-singleflight-old-refresh-task9";
  const freshAccessToken = "synthetic-singleflight-fresh-access-task9";
  const originalBytes = Buffer.from(`${JSON.stringify({
    access_token: "synthetic-singleflight-expired-access-task9",
    refresh_token: oldRefreshToken,
    expires_at: 1,
    unknown_vendor_field: "keep",
  }, null, 2)}\n`);
  fs.writeFileSync(credsPath, originalBytes);

  const observed = { refreshBodies: [], tempOpens: 0 };
  const credentialFs = {
    lstatSync: fs.lstatSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
    openSync(filePath, flags, mode) {
      observed.tempOpens += 1;
      return fs.openSync(filePath, flags, mode);
    },
    writeFileSync: fs.writeFileSync.bind(fs),
    fsyncSync: fs.fsyncSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    renameSync() {
      throw new Error(`synthetic persistence failure ${oldRefreshToken} ${freshAccessToken}`);
    },
    unlinkSync: fs.unlinkSync.bind(fs),
  };

  const options = {
    home: tmp,
    platform: "darwin",
    providerTimeoutMs: 2000,
    credentialFileOptions: { platform: "linux", fsImpl: credentialFs },
    securityRunner() {
      return { status: 1, stdout: "" };
    },
    commandRunner() {
      return { status: 1, stdout: "", stderr: "" };
    },
    fetchImpl(url, requestOptions = {}) {
      if (url === "https://auth.kimi.com/api/oauth/token") {
        observed.refreshBodies.push(String(requestOptions.body || ""));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ access_token: freshAccessToken, expires_in: 900 }),
        });
      }
      if (url === "https://api.kimi.com/coding/v1/usages") {
        assert.equal(requestOptions.headers?.Authorization, `Bearer ${freshAccessToken}`);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ usage: { used: 5, limit: 10 } }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) });
    },
  };

  return { credsPath, originalBytes, oldRefreshToken, freshAccessToken, observed, options };
}

function makeGeminiPersistenceFixture(tmp) {
  const geminiHome = path.join(tmp, ".gemini");
  const credsPath = path.join(geminiHome, "oauth_creds.json");
  fs.mkdirSync(geminiHome, { recursive: true });
  fs.writeFileSync(path.join(geminiHome, "settings.json"), JSON.stringify({
    security: { auth: { selectedType: "oauth-personal" } },
  }));
  const oldRefreshToken = "synthetic-gemini-singleflight-old-refresh-task9";
  const freshAccessToken = "synthetic-gemini-singleflight-fresh-access-task9";
  const originalBytes = Buffer.from(`${JSON.stringify({
    access_token: "synthetic-gemini-singleflight-expired-access-task9",
    refresh_token: oldRefreshToken,
    id_token: "synthetic-gemini-singleflight-old-id-task9",
    expiry_date: 1,
    unknown_vendor_field: "keep",
  }, null, 2)}\n`);
  fs.writeFileSync(credsPath, originalBytes);

  const bundleDir = path.join(tmp, "synthetic-gemini-singleflight", "bundle");
  fs.mkdirSync(bundleDir, { recursive: true });
  const geminiPath = path.join(bundleDir, "gemini.js");
  fs.writeFileSync(geminiPath, "#!/usr/bin/env node\n", "utf8");
  fs.writeFileSync(
    path.join(bundleDir, "chunk-oauth.js"),
    [
      'var OAUTH_CLIENT_ID = "synthetic-client.apps.googleusercontent.com";',
      'var OAUTH_CLIENT_SECRET = "synthetic-client-secret";',
    ].join("\n"),
    "utf8",
  );

  const observed = { refreshBodies: [], tempOpens: 0 };
  const credentialFs = {
    lstatSync: fs.lstatSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
    openSync(filePath, flags, mode) {
      observed.tempOpens += 1;
      return fs.openSync(filePath, flags, mode);
    },
    writeFileSync: fs.writeFileSync.bind(fs),
    fsyncSync: fs.fsyncSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    renameSync() {
      throw new Error(`synthetic Gemini persistence failure ${oldRefreshToken} ${freshAccessToken}`);
    },
    unlinkSync: fs.unlinkSync.bind(fs),
  };

  const options = {
    home: tmp,
    platform: "darwin",
    providerTimeoutMs: 2000,
    credentialFileOptions: { platform: "linux", fsImpl: credentialFs },
    securityRunner() {
      return { status: 1, stdout: "" };
    },
    commandRunner(command, args) {
      if (command === "which" && args?.[0] === "gemini") {
        return { status: 0, stdout: `${geminiPath}\n`, stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "" };
    },
    fetchImpl(url, requestOptions = {}) {
      if (url === "https://oauth2.googleapis.com/token") {
        observed.refreshBodies.push(String(requestOptions.body || ""));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ access_token: freshAccessToken, expires_in: 900 }),
        });
      }
      if (url === "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist") {
        assert.equal(requestOptions.headers?.Authorization, `Bearer ${freshAccessToken}`);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ currentTier: { id: "free-tier" } }),
        });
      }
      if (url === "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ buckets: [{ modelId: "gemini-pro", remainingFraction: 0.5 }] }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) });
    },
  };

  return { credsPath, originalBytes, oldRefreshToken, observed, options };
}

describe("getUsageLimits single-flight", () => {
  it("shares one upstream fetch round across concurrent cache misses", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-singleflight-"));
    const restoreWinEnv = isolateWindowsHomeEnv(tmp);
    try {
      const { commandCalls, countFetchCalls, options } = makeCountingDeps();
      const opts = { home: tmp, ...options };

      const [r1, r2] = await Promise.all([getUsageLimits(opts), getUsageLimits(opts)]);

      assert.equal(r1, r2, "concurrent callers must resolve to the same result object");
      assert.equal(
        commandCalls.filter((c) => c === "which kiro-cli").length,
        1,
        "Kiro probe must run once for two concurrent requests",
      );
      assert.equal(
        commandCalls.filter((c) => c.startsWith("/bin/ps")).length,
        1,
        "Antigravity ps probe must run once for two concurrent requests",
      );
      assert.equal(countFetchCalls(), 0, "no provider is configured, so no HTTP fetch expected");
    } finally {
      restoreWinEnv();
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reuses the in-flight fetch when the cache is cleared mid-flight (refresh=1 path)", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-singleflight-refresh-"));
    try {
      const { commandCalls, options } = makeCountingDeps();
      const opts = { home: tmp, ...options };

      const p1 = getUsageLimits(opts);
      // local-api.js clears the cache before calling getUsageLimits on refresh=1.
      resetUsageLimitsCache();
      const p2 = getUsageLimits(opts);
      const [r1, r2] = await Promise.all([p1, p2]);

      assert.equal(r1, r2, "refresh arriving mid-flight reuses the in-flight fetch");
      assert.equal(commandCalls.filter((c) => c === "which kiro-cli").length, 1);

      // Once settled, the in-flight slot is released: a fresh refresh triggers a new round.
      resetUsageLimitsCache();
      await getUsageLimits(opts);
      assert.equal(
        commandCalls.filter((c) => c === "which kiro-cli").length,
        2,
        "a refresh after settlement must trigger a new fetch round",
      );
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("shares one failed Kimi persistence attempt and one redacted warning across concurrent callers", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-singleflight-credential-"));
    const restoreWinEnv = isolateWindowsHomeEnv(tmp);
    try {
      const fixture = makeKimiPersistenceFixture(tmp);
      const [first, second] = await Promise.all([
        getUsageLimits(fixture.options),
        getUsageLimits(fixture.options),
      ]);

      assert.equal(first, second, "single-flight callers must share the same result object");
      assert.equal(fixture.observed.refreshBodies.length, 1, "concurrent callers must refresh once");
      assert.equal(fixture.observed.tempOpens, 1, "concurrent callers must create one owned temp");
      assert.equal(first.kimi.error, null);
      assert.equal(first.kimi.primary_window.used_percent, 50);
      assert.equal(first.kimi.credential_persist_warning, second.kimi.credential_persist_warning);
      assert.match(first.kimi.credential_persist_warning, /not saved|could not be saved|retry/i);
      assert.equal(first.kimi.credential_persist_warning.includes(fixture.oldRefreshToken), false);
      assert.equal(first.kimi.credential_persist_warning.includes(fixture.freshAccessToken), false);
      assert.deepEqual(fs.readFileSync(fixture.credsPath), fixture.originalBytes);
    } finally {
      restoreWinEnv();
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rereads the unchanged old refresh token and retries only after the first round settles", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-credential-retry-"));
    const restoreWinEnv = isolateWindowsHomeEnv(tmp);
    try {
      const fixture = makeKimiPersistenceFixture(tmp);
      const first = await getUsageLimits(fixture.options);
      assert.match(first.kimi.credential_persist_warning, /not saved|could not be saved|retry/i);
      assert.equal(fixture.observed.refreshBodies.length, 1);
      assert.match(fixture.observed.refreshBodies[0], new RegExp(`refresh_token=${fixture.oldRefreshToken}`));
      assert.deepEqual(fs.readFileSync(fixture.credsPath), fixture.originalBytes);

      resetUsageLimitsCache();
      const second = await getUsageLimits(fixture.options);

      assert.equal(fixture.observed.refreshBodies.length, 2, "a settled round must retry persistence from disk");
      assert.match(fixture.observed.refreshBodies[1], new RegExp(`refresh_token=${fixture.oldRefreshToken}`));
      assert.equal(fixture.observed.tempOpens, 2);
      assert.equal(second.kimi.error, null);
      assert.match(second.kimi.credential_persist_warning, /not saved|could not be saved|retry/i);
      assert.deepEqual(fs.readFileSync(fixture.credsPath), fixture.originalBytes);
    } finally {
      restoreWinEnv();
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("shares one failed Gemini persistence per round and retries the old disk token after settlement", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-gemini-credential-retry-"));
    const restoreWinEnv = isolateWindowsHomeEnv(tmp);
    try {
      const fixture = makeGeminiPersistenceFixture(tmp);
      const [first, second] = await Promise.all([
        getUsageLimits(fixture.options),
        getUsageLimits(fixture.options),
      ]);

      assert.equal(first, second, "first-round concurrent callers must share one result");
      assert.equal(fixture.observed.refreshBodies.length, 1);
      assert.equal(
        new URLSearchParams(fixture.observed.refreshBodies[0]).get("refresh_token"),
        fixture.oldRefreshToken,
      );
      assert.equal(fixture.observed.tempOpens, 1, "first round must make one persistence attempt");
      assert.equal(first.gemini.error, null);
      assert.match(first.gemini.credential_persist_warning, /not saved|could not be saved|retry/i);
      assert.deepEqual(fs.readFileSync(fixture.credsPath), fixture.originalBytes);

      resetUsageLimitsCache();
      const [third, fourth] = await Promise.all([
        getUsageLimits(fixture.options),
        getUsageLimits(fixture.options),
      ]);

      assert.equal(third, fourth, "second-round concurrent callers must share one result");
      assert.equal(fixture.observed.refreshBodies.length, 2);
      assert.equal(
        new URLSearchParams(fixture.observed.refreshBodies[1]).get("refresh_token"),
        fixture.oldRefreshToken,
      );
      assert.equal(fixture.observed.tempOpens, 2, "settled retry must make exactly one new persistence attempt");
      assert.equal(third.gemini.error, null);
      assert.match(third.gemini.credential_persist_warning, /not saved|could not be saved|retry/i);
      assert.deepEqual(fs.readFileSync(fixture.credsPath), fixture.originalBytes);
    } finally {
      restoreWinEnv();
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("runCommand (async)", () => {
  it("returns a spawnSync-shaped result from a real process", async () => {
    const result = await runCommand(
      null,
      process.execPath,
      ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3);"],
      { timeout: 10_000 },
    );
    assert.equal(result.status, 3);
    assert.equal(result.stdout, "out");
    assert.equal(result.stderr, "err");
    assert.equal(result.error, undefined);
  });

  it("runs commands concurrently without blocking the event loop", async () => {
    const sleeper = () =>
      runCommand(null, process.execPath, ["-e", "setTimeout(() => {}, 700);"], { timeout: 10_000 });
    const started = Date.now();
    const [a, b] = await Promise.all([sleeper(), sleeper()]);
    const elapsed = Date.now() - started;
    assert.equal(a.status, 0);
    assert.equal(b.status, 0);
    // Two 700ms commands run serially (spawnSync behavior) would take >= 1400ms.
    // Keep enough headroom for a busy full-suite Windows runner while still
    // rejecting serial execution.
    assert.ok(elapsed < 1200, `expected parallel execution, took ${elapsed}ms`);
  });

  it("kills the child and reports ETIMEDOUT when the timeout elapses", async () => {
    const started = Date.now();
    const result = await runCommand(
      null,
      process.execPath,
      ["-e", "setTimeout(() => {}, 10_000);"],
      { timeout: 200 },
    );
    assert.equal(result.error?.code, "ETIMEDOUT");
    assert.equal(result.status, null);
    assert.ok(Date.now() - started < 3000, "timeout must settle promptly");
  });

  it("wraps a synchronous injected runner's result in a promise", async () => {
    const fake = { status: 0, stdout: "hello\n", stderr: "" };
    const promise = runCommand(() => fake, "anything", []);
    assert.ok(typeof promise.then === "function");
    assert.equal(await promise, fake);
  });
});
