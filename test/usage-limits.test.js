const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const { runSql } = require("./helpers/sqlite-builder.cjs");

require("./helpers/home-shim.cjs");

const http = require("node:http");
const https = require("node:https");

describe("test environment preload", () => {
  it("uses a repository-local temp directory and denies default network", async () => {
    const repoRoot = path.resolve(__dirname, "..");
    assert.ok(path.resolve(os.tmpdir()).startsWith(repoRoot + path.sep));
    assert.equal(globalThis.fetch?.__tokentrackerTestNetworkDeny, true);
    await assert.rejects(
      globalThis.fetch("https://provider.example.test/usage"),
      (error) => error?.code === "ERR_TEST_NETWORK_DISABLED",
    );
  });

  it("denies non-loopback https.request before DNS lookup", async () => {
    let lookupCalled = false;
    const error = await new Promise((resolve) => {
      const req = https.request({
        hostname: "provider.example.test",
        path: "/usage",
        lookup(_hostname, _options, callback) {
          lookupCalled = true;
          const lookupError = new Error("fixture lookup blocked");
          lookupError.code = "ERR_FIXTURE_LOOKUP_BLOCKED";
          callback(lookupError);
        },
      });
      req.once("error", resolve);
      req.end();
    });

    assert.equal(error?.code, "ERR_TEST_NETWORK_DISABLED");
    assert.equal(lookupCalled, false);
  });

  it("keeps loopback http.request available", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const statusCode = await new Promise((resolve, reject) => {
        const address = server.address();
        const req = http.request({
          hostname: "127.0.0.1",
          port: address.port,
          path: "/health",
        }, (res) => {
          res.resume();
          res.once("end", () => resolve(res.statusCode));
        });
        req.once("error", reject);
        req.end();
      });
      assert.equal(statusCode, 204);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("clears source-consumed path and credential overrides before module load", () => {
    const keys = [
      "CODE_HOME",
      "CODEBUDDY_HOME",
      "COPILOT_OTEL_ENABLED",
      "COPILOT_OTEL_EXPORTER_TYPE",
      "COPILOT_OTEL_FILE_EXPORTER_PATH",
      "CRAFT_CONFIG_DIR",
      "DROID_SESSIONS_DIR",
      "FACTORY_DIR",
      "GOOSE_PATH_ROOT",
      "GROK_HOME",
      "GROK_WORKSPACE_ROOT",
      "KILO_HOME",
      "KIRO_CLI_DB_PATH",
      "KIRO_HOME",
      "OMP_HOME",
      "OPENCLAW_CONFIG_PATH",
      "OPENCLAW_STATE_DIR",
      "OPENCODE_CONFIG_DIR",
      "OPENCODE_HOME",
      "PI_CODING_AGENT_DIR",
      "PI_CONFIG_DIR",
      "TOKENTRACKER_ANTIGRAVITY_HOME",
      "TOKENTRACKER_GOOSE_DB",
      "TOKENTRACKER_GROK_BILLING_BASE_URL",
      "TOKENTRACKER_GROK_HOME",
      "TOKENTRACKER_HERMES_HOME",
      "TOKENTRACKER_KILOCODE_ROOTS",
      "TOKENTRACKER_OMP_AGENT_DIR",
      "TOKENTRACKER_OPENCLAW_HOME",
      "TOKENTRACKER_PI_AGENT_DIR",
      "TOKENTRACKER_TRAE_DECRYPTED_DB",
      "TOKENTRACKER_TRAE_ROOTS",
      "TOKENTRACKER_ZED_DB",
    ];
    const repoRoot = path.resolve(__dirname, "..");
    const preloadPath = path.join(__dirname, "helpers", "home-shim.cjs");
    const childEnv = { ...process.env, R1_TEST_ENV_KEYS: JSON.stringify(keys) };
    for (const key of keys) childEnv[key] = `fixture-bait-${key.toLowerCase()}`;
    const script = [
      "const keys = JSON.parse(process.env.R1_TEST_ENV_KEYS);",
      "const present = Object.fromEntries(keys.map((key) => [key, Object.hasOwn(process.env, key)]));",
      "require('./src/lib/rollout');",
      "process.stdout.write(JSON.stringify(present));",
    ].join("");

    const result = cp.spawnSync(process.execPath, [
      "--require",
      preloadPath,
      "-e",
      script,
    ], {
      cwd: repoRoot,
      env: childEnv,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const present = JSON.parse(result.stdout);
    assert.deepEqual(
      Object.keys(present).filter((key) => present[key]),
      [],
    );
  });
});

// Prevents real Windows user credentials (Cursor APPDATA, etc.) from leaking
// into tests that only pass `home: tmp` — getUsageLimits falls back to
// process.env.APPDATA for Cursor path resolution on Windows.
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
  fetchKiroLimits,
  extractGeminiOauthClientCredentials,
  getUsageLimits,
  normalizePlanLabel,
  loadKimiCredentials,
  normalizeCursorUsageSummary,
  normalizeGeminiQuotaResponse,
  normalizeKimiUsageResponse,
  parseKiroUsageOutput,
  resetUsageLimitsCache,
  normalizeAntigravityResponse,
  parseListeningPorts,
  detectAntigravityProcess,
  fetchAntigravityLimits,
} = require("../src/lib/usage-limits");
const { extractCursorSessionToken } = require("../src/lib/cursor-config");

describe("extractGeminiOauthClientCredentials", () => {
  it("finds OAuth constants from bundled Gemini CLI chunk files", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-gemini-bundle-"));
    try {
      const root = path.join(tmp, "lib", "node_modules", "@google", "gemini-cli");
      const bundleDir = path.join(root, "bundle");
      fs.mkdirSync(bundleDir, { recursive: true });
      const geminiPath = path.join(bundleDir, "gemini.js");
      fs.writeFileSync(geminiPath, "#!/usr/bin/env node\n", "utf8");
      fs.writeFileSync(
        path.join(bundleDir, "chunk-test.js"),
        [
          'var OAUTH_CLIENT_ID = "client.apps.googleusercontent.com";',
          'var OAUTH_CLIENT_SECRET = "secret-value";',
        ].join("\n"),
        "utf8",
      );

      const result = await extractGeminiOauthClientCredentials({
        commandRunner(command, args) {
          assert.equal(command, "which");
          assert.deepEqual(args, ["gemini"]);
          return { status: 0, stdout: `${geminiPath}\n` };
        },
      });

      assert.deepEqual(result, {
        clientId: "client.apps.googleusercontent.com",
        clientSecret: "secret-value",
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Skipped on Windows: fs.symlinkSync requires admin privileges (EPERM) and
  // the test exercises macOS launchd PATH fallback semantics.
  (process.platform === "win32" ? it.skip : it)("falls back to nvm-installed Gemini when launchd PATH cannot find gemini", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-gemini-nvm-"));
    try {
      const home = path.join(tmp, "home");
      const root = path.join(home, ".nvm", "versions", "node", "v22.21.1");
      const binDir = path.join(root, "bin");
      const bundleDir = path.join(root, "lib", "node_modules", "@google", "gemini-cli", "bundle");
      fs.mkdirSync(binDir, { recursive: true });
      fs.mkdirSync(bundleDir, { recursive: true });
      const geminiTarget = path.join(bundleDir, "gemini.js");
      const geminiLink = path.join(binDir, "gemini");
      fs.writeFileSync(geminiTarget, "#!/usr/bin/env node\n", "utf8");
      fs.symlinkSync("../lib/node_modules/@google/gemini-cli/bundle/gemini.js", geminiLink);
      fs.writeFileSync(
        path.join(bundleDir, "chunk-test.js"),
        [
          'var OAUTH_CLIENT_ID = "fallback-client.apps.googleusercontent.com";',
          'var OAUTH_CLIENT_SECRET = "fallback-secret";',
        ].join("\n"),
        "utf8",
      );

      const result = await extractGeminiOauthClientCredentials({
        home,
        commandRunner() {
          return { status: 1, stdout: "" };
        },
      });

      assert.deepEqual(result, {
        clientId: "fallback-client.apps.googleusercontent.com",
        clientSecret: "fallback-secret",
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function makeFakeCodexJwt(planType) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_plan_type: planType },
    }),
  ).toString("base64url");
  return `${header}.${payload}.`;
}

function writeCodexAuth(tmp, planType = "plus", extraTokens = {}) {
  const codexHome = path.join(tmp, ".codex");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "auth.json"),
    JSON.stringify({
      tokens: {
        access_token: makeFakeCodexJwt(planType),
        id_token: makeFakeCodexJwt(planType),
        ...extraTokens,
      },
    }),
  );
}

function inactiveRunner() {
  return { status: 1, stdout: "" };
}

describe("getUsageLimits", () => {
  it("threads injected Cursor env into the SQLite reader", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-cursor-sqlite-env-"));
    try {
      const appDir = path.join(tmp, "Cursor");
      const stateDb = path.join(appDir, "User", "globalStorage", "state.vscdb");
      fs.mkdirSync(path.dirname(stateDb), { recursive: true });
      fs.writeFileSync(stateDb, "fixture", "utf8");
      const home = path.join(tmp, "home");
      fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
      fs.writeFileSync(
        path.join(home, ".cursor", "cli-config.json"),
        JSON.stringify({ authInfo: { authId: "auth0|user_fixture" } }),
      );

      const injectedEnv = { PATH: "fixture-sqlite-path", TOKENTRACKER_DEBUG: "1" };
      let observedEnv;
      const auth = extractCursorSessionToken({
        appDir,
        home,
        platform: "linux",
        env: injectedEnv,
        deps: {
          execFileSync(_command, _args, options) {
            observedEnv = options.env;
            return JSON.stringify([{ value: "fixture-cursor-token-long-enough" }]);
          },
          requireFn() {
            throw new Error("node:sqlite fallback should not run");
          },
        },
      });

      assert.equal(observedEnv, injectedEnv);
      assert.equal(auth?.userId, "user_fixture");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses injected Cursor env and platform instead of ambient APPDATA", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-cursor-env-"));
    const originalAppData = process.env.APPDATA;
    try {
      const ambientAppData = path.join(tmp, "ambient-appdata");
      const ambientCursor = path.join(ambientAppData, "Cursor");
      const stateDb = path.join(ambientCursor, "User", "globalStorage", "state.vscdb");
      fs.mkdirSync(path.dirname(stateDb), { recursive: true });
      runSql(
        stateDb,
        "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);"
          + " INSERT INTO ItemTable VALUES ('cursorAuth/accessToken', 'fixture-cursor-token-long-enough');",
      );
      const home = path.join(tmp, "home");
      fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
      fs.writeFileSync(
        path.join(home, ".cursor", "cli-config.json"),
        JSON.stringify({ authInfo: { authId: "auth0|user_fixture" } }),
      );
      process.env.APPDATA = ambientAppData;

      let cursorRequests = 0;
      const result = await getUsageLimits({
        home,
        env: { APPDATA: path.join(tmp, "injected-appdata") },
        platform: "win32",
        providerTimeoutMs: 100,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (String(url).includes("cursor.com/api/usage-summary")) cursorRequests += 1;
          return new Promise(() => {});
        },
      });

      assert.equal(result.cursor.configured, false);
      assert.equal(cursorRequests, 0);
    } finally {
      if (originalAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = originalAppData;
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses injected platform and env for Kiro discovery and execution", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-kiro-env-"));
    try {
      const calls = [];
      const injectedEnv = { PATH: "fixture-path" };
      const kiroPath = "C:\\fixture\\kiro-cli.exe";
      const result = await getUsageLimits({
        home: tmp,
        env: injectedEnv,
        platform: "win32",
        providerTimeoutMs: 100,
        securityRunner: inactiveRunner,
        commandRunner(command, args, options) {
          calls.push({ command, args, env: options.env });
          if (command === "where") return { status: 0, stdout: `${kiroPath}\r\n` };
          if (command === kiroPath) {
            return {
              status: 0,
              stdout: "Plan: Kiro Professional\nUsage is managed by organization admin.\n",
              stderr: "",
            };
          }
          return { status: 1, stdout: "", stderr: "" };
        },
        fetchImpl() {
          return new Promise(() => {});
        },
      });

      assert.equal(result.kiro.configured, true);
      assert.equal(result.kiro.plan_label, "Professional");
      assert.deepEqual(
        calls.filter(({ command }) => command === "where" || command === kiroPath),
        [
        { command: "where", args: ["kiro-cli"], env: injectedEnv },
        {
          command: kiroPath,
          args: ["chat", "--no-interactive", "/usage"],
          env: { ...injectedEnv, TERM: "xterm-256color" },
        },
        ],
      );
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("redacts queue, Cookie, and account identifiers from provider errors", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-redaction-"));
    try {
      writeCodexAuth(tmp, "plus", { account_id: "acct-fixture-sensitive" });
      const result = await getUsageLimits({
        home: tmp,
        env: {},
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            throw new Error(
              'request failed; Cookie: session=fixture-cookie; account_id=acct-fixture-sensitive; queue=[{"source":"fixture"}]',
            );
          }
          return new Promise(() => {});
        },
      });

      assert.equal(result.codex.configured, true);
      assert.equal(result.codex.error, "Provider request failed.");
      assert.doesNotMatch(
        JSON.stringify(result),
        /fixture-cookie|acct-fixture-sensitive|queue=\[\{"source":"fixture"\}\]/,
      );
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("redacts quoted and camelCase sensitive provider error fields", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-json-redaction-"));
    try {
      writeCodexAuth(tmp, "plus", { account_id: "acct-json-sensitive" });
      const cases = [
        ['{"accessToken":"fixture-access"}', "fixture-access"],
        ['{"refresh_token":"fixture-refresh"}', "fixture-refresh"],
        ['{"sessionCookie":"fixture-session"}', "fixture-session"],
        ['{"Cookie":"fixture-cookie"}', "fixture-cookie"],
        ['{"authorization":"Bearer fixture-auth"}', "fixture-auth"],
        ['{"queue":"fixture-queue"}', "fixture-queue"],
        ['{"accountId":"organization-json-sensitive"}', "organization-json-sensitive"],
      ];
      for (const [providerMessage, secret] of cases) {
        resetUsageLimitsCache();
        const result = await getUsageLimits({
          home: tmp,
          env: {},
          platform: "linux",
          providerTimeoutMs: 1000,
          securityRunner: inactiveRunner,
          commandRunner: inactiveRunner,
          fetchImpl(url) {
            if (String(url).includes("chatgpt.com/backend-api/wham/usage")) {
              throw new Error(`upstream rejected ${providerMessage}`);
            }
            return new Promise(() => {});
          },
        });
        assert.equal(result.codex.error, "Provider request failed.", providerMessage);
        assert.doesNotMatch(JSON.stringify(result), new RegExp(secret), providerMessage);
      }

      resetUsageLimitsCache();
      const safeResult = await getUsageLimits({
        home: tmp,
        env: {},
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (String(url).includes("chatgpt.com/backend-api/wham/usage")) {
            throw new Error("Codex API error: HTTP 503");
          }
          return new Promise(() => {});
        },
      });
      assert.equal(safeResult.codex.error, "Codex API error: HTTP 503");
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("classifies a 5h session window into primary regardless of slot position", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-classify-"));
    try {
      const codexHome = path.join(tmp, ".codex");
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(
        path.join(codexHome, "auth.json"),
        JSON.stringify({
          tokens: {
            access_token: makeFakeCodexJwt("plus"),
            id_token: makeFakeCodexJwt("plus"),
            account_id: "acc-classify",
          },
        }),
      );

      let observedHeader = null;
      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 2000,
        securityRunner() {
          return { status: 1, stdout: "" };
        },
        commandRunner() {
          return { status: 1, stdout: "" };
        },
        fetchImpl(url, opts) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            observedHeader = opts?.headers?.["ChatGPT-Account-Id"] || null;
            return Promise.resolve({
              ok: true,
              status: 200,
              // API delivers 7d in primary slot and 5h in secondary — sorter must swap them.
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 30, limit_window_seconds: 604800, reset_at: 99999 },
                  secondary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 11111 },
                },
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.equal(observedHeader, "acc-classify", "ChatGPT-Account-Id header must be sent");
      assert.equal(result.codex.configured, true);
      assert.equal(result.codex.error, null);
      assert.equal(result.codex.plan_type, "plus");
      assert.deepEqual(result.codex.primary_window, {
        used_percent: 12,
        limit_window_seconds: 18000,
        reset_at: 11111,
      });
      assert.deepEqual(result.codex.secondary_window, {
        used_percent: 30,
        limit_window_seconds: 604800,
        reset_at: 99999,
      });
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("renders free-tier weekly-only response into the secondary (7d) lane", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-free-weekly-"));
    try {
      const codexHome = path.join(tmp, ".codex");
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(
        path.join(codexHome, "auth.json"),
        JSON.stringify({
          tokens: {
            access_token: makeFakeCodexJwt("free"),
            id_token: makeFakeCodexJwt("free"),
          },
        }),
      );

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 2000,
        securityRunner() {
          return { status: 1, stdout: "" };
        },
        commandRunner() {
          return { status: 1, stdout: "" };
        },
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            // Free plans get a single 7-day window in the primary slot.
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 8, limit_window_seconds: 604800, reset_at: 42 },
                  secondary_window: null,
                },
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.equal(result.codex.configured, true);
      assert.equal(result.codex.error, null);
      assert.equal(result.codex.plan_type, "free");
      // No 5h session window for free — primary lane stays empty, weekly fills secondary.
      assert.equal(result.codex.primary_window, null);
      assert.deepEqual(result.codex.secondary_window, {
        used_percent: 8,
        limit_window_seconds: 604800,
        reset_at: 42,
      });
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("maps Codex Spark windows by duration when their slots are reversed", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-spark-reversed-"));
    try {
      writeCodexAuth(tmp, "plus", { account_id: "acc-spark-reversed" });

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 11111 },
                  secondary_window: { used_percent: 30, limit_window_seconds: 604800, reset_at: 99999 },
                },
                additional_rate_limits: [
                  {
                    limit_name: "codex spark model",
                    rate_limit: {
                      primary_window: { used_percent: 18, limit_window_seconds: 604800, reset_at: 33333 },
                      secondary_window: { used_percent: 4, limit_window_seconds: 18000, reset_at: 22222 },
                    },
                  },
                ],
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.deepEqual(result.codex.primary_window, {
        used_percent: 12,
        limit_window_seconds: 18000,
        reset_at: 11111,
      });
      assert.deepEqual(result.codex.secondary_window, {
        used_percent: 30,
        limit_window_seconds: 604800,
        reset_at: 99999,
      });
      assert.deepEqual(result.codex.spark_primary_window, {
        used_percent: 4,
        limit_window_seconds: 18000,
        reset_at: 22222,
      });
      assert.deepEqual(result.codex.spark_secondary_window, {
        used_percent: 18,
        limit_window_seconds: 604800,
        reset_at: 33333,
      });
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rounds fractional Codex and Spark usage percentages before exposing windows", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-fractional-"));
    try {
      writeCodexAuth(tmp, "plus");

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 12.4, limit_window_seconds: 18000, reset_at: 100 },
                  secondary_window: { used_percent: 30.6, limit_window_seconds: 604800, reset_at: 200 },
                },
                additional_rate_limits: [
                  {
                    limit_name: "codex spark model",
                    rate_limit: {
                      primary_window: { used_percent: 4.4, limit_window_seconds: 18000, reset_at: 300 },
                      secondary_window: { used_percent: 18.6, limit_window_seconds: 604800, reset_at: 400 },
                    },
                  },
                ],
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.equal(result.codex.primary_window.used_percent, 12);
      assert.equal(result.codex.secondary_window.used_percent, 31);
      assert.equal(result.codex.spark_primary_window.used_percent, 4);
      assert.equal(result.codex.spark_secondary_window.used_percent, 19);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("prefers classified Spark windows across all entries before slot fallback", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-spark-fallback-"));
    try {
      writeCodexAuth(tmp, "plus");

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 1, limit_window_seconds: 18000, reset_at: 100 },
                  secondary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: 200 },
                },
                additional_rate_limits: [
                  {
                    metered_feature: "  Codex Spark Requests  ",
                    rate_limit: {
                      primary_window: { used_percent: 7, limit_window_seconds: 12345, reset_at: 300 },
                      secondary_window: { used_percent: 19, reset_at: 400 },
                    },
                  },
                  {
                    limit_name: "spark duplicate",
                    rate_limit: {
                      primary_window: { used_percent: 99, limit_window_seconds: 18000, reset_at: 500 },
                      secondary_window: { used_percent: 88, limit_window_seconds: 604800, reset_at: 600 },
                    },
                  },
                ],
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.deepEqual(result.codex.spark_primary_window, {
        used_percent: 99,
        limit_window_seconds: 18000,
        reset_at: 500,
      });
      assert.deepEqual(result.codex.spark_secondary_window, {
        used_percent: 88,
        limit_window_seconds: 604800,
        reset_at: 600,
      });
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not let an unknown Spark window override a classified 5h window", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-spark-mixed-"));
    try {
      writeCodexAuth(tmp, "plus");

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 1, limit_window_seconds: 18000, reset_at: 100 },
                  secondary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: 200 },
                },
                additional_rate_limits: [
                  {
                    limit_name: "codex spark model",
                    rate_limit: {
                      primary_window: { used_percent: 90, limit_window_seconds: 12345, reset_at: 300 },
                      secondary_window: { used_percent: 15, limit_window_seconds: 18000, reset_at: 400 },
                    },
                  },
                ],
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.deepEqual(result.codex.spark_primary_window, {
        used_percent: 15,
        limit_window_seconds: 18000,
        reset_at: 400,
      });
      assert.equal(result.codex.spark_secondary_window, null);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fills a missing Spark weekly slot from position when the secondary window is classified 5h", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-spark-primary-fallback-"));
    try {
      writeCodexAuth(tmp, "plus");

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 1, limit_window_seconds: 18000, reset_at: 100 },
                  secondary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: 200 },
                },
                additional_rate_limits: [
                  {
                    limit_name: "codex spark model",
                    rate_limit: {
                      primary_window: { used_percent: 44, reset_at: 300 },
                      secondary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 400 },
                    },
                  },
                ],
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.deepEqual(result.codex.spark_primary_window, {
        used_percent: 12,
        limit_window_seconds: 18000,
        reset_at: 400,
      });
      assert.deepEqual(result.codex.spark_secondary_window, {
        used_percent: 44,
        reset_at: 300,
      });
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fills an empty Spark slot from position when the other window is classified", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-spark-mixed-fallback-"));
    try {
      writeCodexAuth(tmp, "plus");

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 1, limit_window_seconds: 18000, reset_at: 100 },
                  secondary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: 200 },
                },
                additional_rate_limits: [
                  {
                    limit_name: "codex spark model",
                    rate_limit: {
                      primary_window: { used_percent: 11, reset_at: 300 },
                      secondary_window: { used_percent: 25, limit_window_seconds: 604800, reset_at: 400 },
                    },
                  },
                ],
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.deepEqual(result.codex.spark_primary_window, {
        used_percent: 11,
        reset_at: 300,
      });
      assert.deepEqual(result.codex.spark_secondary_window, {
        used_percent: 25,
        limit_window_seconds: 604800,
        reset_at: 400,
      });
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("keeps a lone unknown Spark secondary window in the weekly lane", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-spark-secondary-only-"));
    try {
      writeCodexAuth(tmp, "plus");

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 1, limit_window_seconds: 18000, reset_at: 100 },
                  secondary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: 200 },
                },
                additional_rate_limits: [
                  {
                    limit_name: "codex spark model",
                    rate_limit: {
                      primary_window: null,
                      secondary_window: { used_percent: 37, reset_at: 300 },
                    },
                  },
                ],
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.equal(result.codex.spark_primary_window, null);
      assert.deepEqual(result.codex.spark_secondary_window, {
        used_percent: 37,
        reset_at: 300,
      });
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("keeps an unknown secondary Spark window as 5h when paired with a classified weekly window", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-spark-weekly-unknown-"));
    try {
      writeCodexAuth(tmp, "plus");

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 1, limit_window_seconds: 18000, reset_at: 100 },
                  secondary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: 200 },
                },
                additional_rate_limits: [
                  {
                    limit_name: "codex spark model",
                    rate_limit: {
                      primary_window: { used_percent: 31, limit_window_seconds: 604800, reset_at: 300 },
                      secondary_window: { used_percent: 12, limit_window_seconds: 32400, reset_at: 400 },
                    },
                  },
                ],
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.deepEqual(result.codex.spark_primary_window, {
        used_percent: 12,
        limit_window_seconds: 32400,
        reset_at: 400,
      });
      assert.deepEqual(result.codex.spark_secondary_window, {
        used_percent: 31,
        limit_window_seconds: 604800,
        reset_at: 300,
      });
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("ignores malformed Spark windows before exposing Codex usage limits", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-spark-malformed-"));
    try {
      writeCodexAuth(tmp, "plus");

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 1, limit_window_seconds: 18000, reset_at: 100 },
                  secondary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: 200 },
                },
                additional_rate_limits: [
                  {
                    limit_name: "codex spark broken",
                    rate_limit: {
                      primary_window: { limit_window_seconds: 18000, reset_at: 300 },
                      secondary_window: {},
                    },
                  },
                  {
                    limit_name: "codex spark valid",
                    rate_limit: {
                      primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 500 },
                      secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 600 },
                    },
                  },
                ],
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.deepEqual(result.codex.spark_primary_window, {
        used_percent: 25,
        limit_window_seconds: 18000,
        reset_at: 500,
      });
      assert.deepEqual(result.codex.spark_secondary_window, {
        used_percent: 40,
        limit_window_seconds: 604800,
        reset_at: 600,
      });
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("ignores non-Spark additional rate limits and keeps Spark windows null", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-non-spark-"));
    try {
      writeCodexAuth(tmp, "plus");

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner: inactiveRunner,
        commandRunner: inactiveRunner,
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 11, limit_window_seconds: 18000, reset_at: 700 },
                  secondary_window: { used_percent: 22, limit_window_seconds: 604800, reset_at: 800 },
                },
                additional_rate_limits: [
                  null,
                  "bad-entry",
                  {
                    limit_name: "codex regular model",
                    metered_feature: "codex_model",
                    rate_limit: {
                      primary_window: { used_percent: 77, limit_window_seconds: 18000, reset_at: 900 },
                      secondary_window: { used_percent: 66, limit_window_seconds: 604800, reset_at: 1000 },
                    },
                  },
                ],
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.deepEqual(result.codex.primary_window, {
        used_percent: 11,
        limit_window_seconds: 18000,
        reset_at: 700,
      });
      assert.deepEqual(result.codex.secondary_window, {
        used_percent: 22,
        limit_window_seconds: 604800,
        reset_at: 800,
      });
      assert.equal(result.codex.spark_primary_window, null);
      assert.equal(result.codex.spark_secondary_window, null);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("proactively refreshes a stale Codex token and persists the new one before calling wham", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-refresh-"));
    try {
      const codexHome = path.join(tmp, ".codex");
      fs.mkdirSync(codexHome, { recursive: true });
      const authPath = path.join(codexHome, "auth.json");
      // Write an auth.json whose last_refresh is >8 days old → must be refreshed.
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          auth_mode: "chatgpt",
          tokens: {
            access_token: makeFakeCodexJwt("plus"),
            id_token: makeFakeCodexJwt("plus"),
            refresh_token: "rt-stale",
            account_id: "acc-stale",
          },
          last_refresh: "2026-01-01T00:00:00Z",
        }),
      );

      let refreshCalled = false;
      let whamAuthHeader = null;
      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 2000,
        securityRunner() {
          return { status: 1, stdout: "" };
        },
        commandRunner() {
          return { status: 1, stdout: "" };
        },
        fetchImpl(url, opts) {
          if (typeof url === "string" && url.includes("auth.openai.com/oauth/token")) {
            refreshCalled = true;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                access_token: "fresh-access",
                refresh_token: "fresh-refresh",
                id_token: "fresh-id",
              }),
            });
          }
          if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
            whamAuthHeader = opts?.headers?.Authorization || null;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                rate_limit: {
                  primary_window: { used_percent: 1, limit_window_seconds: 18000, reset_at: 100 },
                  secondary_window: { used_percent: 9, limit_window_seconds: 604800, reset_at: 200 },
                },
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.equal(refreshCalled, true, "refresh endpoint must be called when token is stale");
      assert.equal(whamAuthHeader, "Bearer fresh-access", "wham must use the new token");
      assert.equal(result.codex.configured, true);
      assert.equal(result.codex.error, null);
      assert.deepEqual(result.codex.primary_window, { used_percent: 1, limit_window_seconds: 18000, reset_at: 100 });

      // Persisted auth.json gets the new tokens + a fresh last_refresh.
      const updated = JSON.parse(fs.readFileSync(authPath, "utf8"));
      assert.equal(updated.tokens.access_token, "fresh-access");
      assert.equal(updated.tokens.refresh_token, "fresh-refresh");
      assert.notEqual(updated.last_refresh, "2026-01-01T00:00:00Z");
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("surfaces a reauth-required error when the refresh token itself is expired", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-codex-reauth-"));
    try {
      const codexHome = path.join(tmp, ".codex");
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(
        path.join(codexHome, "auth.json"),
        JSON.stringify({
          tokens: {
            access_token: makeFakeCodexJwt("plus"),
            refresh_token: "rt-dead",
          },
          last_refresh: "2026-01-01T00:00:00Z",
        }),
      );

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 2000,
        securityRunner() {
          return { status: 1, stdout: "" };
        },
        commandRunner() {
          return { status: 1, stdout: "" };
        },
        fetchImpl(url) {
          if (typeof url === "string" && url.includes("auth.openai.com/oauth/token")) {
            return Promise.resolve({
              ok: false,
              status: 401,
              json: async () => ({ error: { code: "refresh_token_expired" } }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.equal(result.codex.configured, true);
      assert.equal(result.codex.auth_action_required, "reauth");
      assert.match(result.codex.error, /Run `codex` to re-authenticate/);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  for (const status of [401, 403, 404]) {
    it(`treats wham ${status} as no-data instead of a hard error`, async () => {
      resetUsageLimitsCache();
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `tokentracker-limits-codex-${status}-`));
      try {
        const codexHome = path.join(tmp, ".codex");
        fs.mkdirSync(codexHome, { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "auth.json"),
          JSON.stringify({ tokens: { access_token: "opaque-token" } }),
        );

        const result = await getUsageLimits({
          home: tmp,
          platform: "linux",
          providerTimeoutMs: 1000,
          securityRunner() {
            return { status: 1, stdout: "" };
          },
          commandRunner() {
            return { status: 1, stdout: "" };
          },
          fetchImpl(url) {
            if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
              return Promise.resolve({ ok: false, status, json: async () => ({}) });
            }
            return new Promise(() => {});
          },
        });

        assert.equal(result.codex.configured, true);
        assert.equal(result.codex.error, null);
        assert.equal(result.codex.primary_window, null);
        assert.equal(result.codex.secondary_window, null);
        assert.equal(result.codex.spark_primary_window, null);
        assert.equal(result.codex.spark_secondary_window, null);
      } finally {
        resetUsageLimitsCache();
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  it("reads the Claude OAuth access token from ~/.claude/.credentials.json on Linux", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-claude-linux-"));
    try {
      const claudeDir = path.join(tmp, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, ".credentials.json"),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: "linux-claude-token",
            subscriptionType: "max",
            rateLimitTier: "tier-1",
          },
        }),
      );

      let observedAuth = null;
      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner() {
          // No keychain on Linux; if the macOS path is taken by mistake this would be the wrong token.
          return { status: 1, stdout: "" };
        },
        commandRunner() {
          return { status: 1, stdout: "" };
        },
        fetchImpl(url, opts) {
          if (typeof url === "string" && url === "https://api.anthropic.com/api/oauth/usage") {
            observedAuth = opts?.headers?.Authorization || null;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                five_hour: { utilization: 0.4 },
                seven_day: { utilization: 0.12 },
                seven_day_opus: null,
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.equal(observedAuth, "Bearer linux-claude-token");
      assert.equal(result.claude.configured, true);
      assert.equal(result.claude.error, null);
      assert.deepEqual(result.claude.five_hour, { utilization: 0.4 });
      assert.deepEqual(result.claude.seven_day, { utilization: 0.12 });
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads the Claude OAuth access token from %USERPROFILE%\\.claude\\.credentials.json on Windows", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-claude-win32-"));
    try {
      const claudeDir = path.join(tmp, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, ".credentials.json"),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: "win32-claude-token",
            subscriptionType: "max",
            rateLimitTier: "tier-1",
          },
        }),
      );

      let observedAuth = null;
      const result = await getUsageLimits({
        home: tmp,
        platform: "win32",
        providerTimeoutMs: 1000,
        securityRunner() {
          // No keychain on Windows; if the macOS path is taken by mistake this would be the wrong token.
          return { status: 1, stdout: "" };
        },
        commandRunner() {
          return { status: 1, stdout: "" };
        },
        fetchImpl(url, opts) {
          if (typeof url === "string" && url === "https://api.anthropic.com/api/oauth/usage") {
            observedAuth = opts?.headers?.Authorization || null;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                five_hour: { utilization: 0.4 },
                seven_day: { utilization: 0.12 },
                seven_day_opus: null,
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.equal(observedAuth, "Bearer win32-claude-token");
      assert.equal(result.claude.configured, true);
      assert.equal(result.claude.error, null);
      assert.deepEqual(result.claude.five_hour, { utilization: 0.4 });
      assert.deepEqual(result.claude.seven_day, { utilization: 0.12 });
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reports Claude unconfigured on Linux when the credentials file is missing", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-claude-linux-missing-"));
    try {
      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner() {
          return { status: 1, stdout: "" };
        },
        commandRunner() {
          return { status: 1, stdout: "" };
        },
        fetchImpl() {
          return new Promise(() => {});
        },
      });

      assert.equal(result.claude.configured, false);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not block the whole response when Claude usage hangs", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-timeout-"));
    try {
      const started = Date.now();
      const result = await getUsageLimits({
        home: tmp,
        platform: "darwin",
        providerTimeoutMs: 10,
        securityRunner() {
          return {
            status: 0,
            stdout: JSON.stringify({ claudeAiOauth: { accessToken: "claude-token" } }),
          };
        },
        commandRunner(command) {
          if (command === "/bin/ps") return { status: 1, stdout: "" };
          return { status: 1, stdout: "" };
        },
        fetchImpl() {
          return new Promise(() => {});
        },
      });

      assert.ok(Date.now() - started < 500);
      assert.equal(result.claude.configured, true);
      assert.match(result.claude.error, /Claude usage request timed out/);
      assert.equal(result.codex.configured, false);
      assert.equal(result.gemini.configured, false);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not wait for Claude 429 retry delays on limits page refresh", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-429-"));
    const restoreWinEnv = isolateWindowsHomeEnv(tmp);
    try {
      let calls = 0;
      const result = await getUsageLimits({
        home: tmp,
        platform: "darwin",
        providerTimeoutMs: 1000,
        securityRunner() {
          return {
            status: 0,
            stdout: JSON.stringify({ claudeAiOauth: { accessToken: "claude-token" } }),
          };
        },
        commandRunner() {
          return { status: 1, stdout: "" };
        },
        fetchImpl() {
          calls += 1;
          return Promise.resolve({
            status: 429,
            ok: false,
            headers: { get: () => "30" },
          });
        },
      });

      assert.equal(calls, 1);
      assert.equal(result.claude.configured, true);
      assert.match(result.claude.error, /rate limited/);
    } finally {
      restoreWinEnv();
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not block the whole response when Kimi usage hangs", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-kimi-timeout-"));
    try {
      const kimiHome = path.join(tmp, ".kimi");
      fs.mkdirSync(path.join(kimiHome, "credentials"), { recursive: true });
      fs.writeFileSync(path.join(kimiHome, "config.toml"), 'default_model = "kimi-code/kimi-for-coding"\n');
      fs.writeFileSync(
        path.join(kimiHome, "credentials", "kimi-code.json"),
        JSON.stringify({ access_token: "kimi-token" }),
      );

      const started = Date.now();
      const result = await getUsageLimits({
        home: tmp,
        platform: "darwin",
        providerTimeoutMs: 10,
        securityRunner() {
          return { status: 1, stdout: "" };
        },
        commandRunner() {
          return { status: 1, stdout: "" };
        },
        fetchImpl() {
          return new Promise(() => {});
        },
      });

      assert.ok(Date.now() - started < 500);
      assert.equal(result.kimi.configured, true);
      assert.match(result.kimi.error, /Kimi usage request timed out/);
      assert.equal(result.claude.configured, false);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refreshes expired Kimi credentials before fetching usage limits", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-kimi-refresh-"));
    const restoreWinEnv = isolateWindowsHomeEnv(tmp);
    try {
      const kimiHome = path.join(tmp, ".kimi");
      const credsPath = path.join(kimiHome, "credentials", "kimi-code.json");
      fs.mkdirSync(path.dirname(credsPath), { recursive: true });
      fs.writeFileSync(path.join(kimiHome, "config.toml"), 'default_model = "kimi-code/kimi-for-coding"\n');
      fs.writeFileSync(
        credsPath,
        JSON.stringify({
          access_token: "expired-kimi-token",
          refresh_token: "refresh-kimi-token",
          expires_at: 1,
          scope: "kimi-code",
          token_type: "Bearer",
          expires_in: 900,
        }),
      );

      const calls = [];
      const result = await getUsageLimits({
        home: tmp,
        platform: "darwin",
        securityRunner() {
          return { status: 1, stdout: "" };
        },
        commandRunner() {
          return { status: 1, stdout: "" };
        },
        fetchImpl(url, options = {}) {
          calls.push({ url, authorization: options.headers?.Authorization || null, body: String(options.body || "") });
          if (url === "https://auth.kimi.com/api/oauth/token") {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                access_token: "fresh-kimi-token",
                refresh_token: "fresh-refresh-token",
                expires_in: 900,
                scope: "kimi-code",
                token_type: "Bearer",
              }),
            });
          }
          if (url === "https://api.kimi.com/coding/v1/usages") {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                usage: { used: 4, limit: 10, resetTime: "2026-05-04T06:02:56.054Z" },
              }),
            });
          }
          return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
        },
      });

      assert.equal(calls[0].url, "https://auth.kimi.com/api/oauth/token");
      assert.match(calls[0].body, /grant_type=refresh_token/);
      assert.match(calls[0].body, /refresh_token=refresh-kimi-token/);
      assert.equal(calls[1].authorization, "Bearer fresh-kimi-token");
      assert.equal(result.kimi.error, null);
      assert.equal(result.kimi.primary_window.used_percent, 40);

      const saved = JSON.parse(fs.readFileSync(credsPath, "utf8"));
      assert.equal(saved.access_token, "fresh-kimi-token");
      assert.equal(saved.refresh_token, "fresh-refresh-token");
      assert.ok(saved.expires_at > Date.now() / 1000);
    } finally {
      restoreWinEnv();
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("fetchKiroLimits", () => {
  it("uses process.env by default for standalone production calls", async () => {
    const markerKey = "R1_KIRO_STANDALONE_ENV_MARKER";
    const originalMarker = process.env[markerKey];
    process.env[markerKey] = "fixture-present";
    try {
      const observed = [];
      const result = await fetchKiroLimits({
        platform: "linux",
        commandRunner(command, _args, options) {
          observed.push({
            command,
            hasMarker: options.env?.[markerKey] === "fixture-present",
          });
          if (command === "which") return { status: 0, stdout: "/fixture/kiro-cli\n" };
          return {
            status: 0,
            stdout: "Plan: Kiro Professional\nUsage is managed by organization admin.\n",
            stderr: "",
          };
        },
      });

      assert.equal(result.configured, true);
      assert.deepEqual(observed, [
        { command: "which", hasMarker: true },
        { command: "/fixture/kiro-cli", hasMarker: true },
      ]);
    } finally {
      if (originalMarker === undefined) delete process.env[markerKey];
      else process.env[markerKey] = originalMarker;
    }
  });
});

describe("loadKimiCredentials", () => {
  it("returns null when Kimi credentials are absent", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-kimi-missing-"));
    try {
      assert.equal(loadKimiCredentials({ home: tmp }), null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("normalizeKimiUsageResponse", () => {
  it("maps weekly, 5h, total, and parallel quota windows", () => {
    const result = normalizeKimiUsageResponse({
      usage: {
        limit: "100",
        used: "64",
        remaining: "36",
        resetTime: "2026-05-04T06:02:56.054721Z",
      },
      limits: [
        {
          window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
          detail: {
            limit: "100",
            used: "4",
            remaining: "96",
            resetTime: "2026-05-02T05:02:56.054721Z",
          },
        },
      ],
      parallel: { limit: "20" },
      totalQuota: { limit: "100", remaining: "99" },
      user: { membership: { level: "LEVEL_INTERMEDIATE" } },
      subType: "TYPE_PURCHASE",
    });

    assert.equal(result.membership_level, "LEVEL_INTERMEDIATE");
    assert.equal(result.subscription_type, "TYPE_PURCHASE");
    assert.equal(result.parallel_limit, 20);
    assert.deepEqual(result.primary_window, {
      used_percent: 64,
      reset_at: "2026-05-04T06:02:56.054Z",
    });
    assert.deepEqual(result.secondary_window, {
      used_percent: 4,
      reset_at: "2026-05-02T05:02:56.054Z",
    });
    assert.deepEqual(result.tertiary_window, {
      used_percent: 1,
      reset_at: null,
    });
  });

  it("returns null windows for invalid or zero limits", () => {
    const result = normalizeKimiUsageResponse({
      usage: { limit: "0", used: "12", remaining: "0" },
      limits: [{ detail: { limit: "bad", used: "1" } }],
      totalQuota: { limit: "0", remaining: "0" },
    });

    assert.equal(result.primary_window, null);
    assert.equal(result.secondary_window, null);
    assert.equal(result.tertiary_window, null);
    assert.equal(result.parallel_limit, null);
  });
});

describe("normalizeCursorUsageSummary", () => {
  it("maps total, auto, and api windows from usage-summary", () => {
    const result = normalizeCursorUsageSummary({
      billingCycleEnd: "2026-04-30T00:00:00.000Z",
      membershipType: "pro",
      individualUsage: {
        plan: {
          totalPercentUsed: 42.4,
          autoPercentUsed: 31.2,
          apiPercentUsed: 78.9,
        },
      },
    });

    assert.equal(result.membership_type, "pro");
    assert.deepEqual(result.primary_window, {
      used_percent: 42.4,
      reset_at: "2026-04-30T00:00:00.000Z",
    });
    assert.deepEqual(result.secondary_window, {
      used_percent: 31.2,
      reset_at: "2026-04-30T00:00:00.000Z",
    });
    assert.deepEqual(result.tertiary_window, {
      used_percent: 78.9,
      reset_at: "2026-04-30T00:00:00.000Z",
    });
  });

  it("falls back to used/limit when total percent is missing", () => {
    const result = normalizeCursorUsageSummary({
      billingCycleEnd: "2026-04-30T00:00:00.000Z",
      individualUsage: {
        plan: {
          used: 250,
          limit: 1000,
        },
      },
    });

    assert.equal(result.primary_window.used_percent, 25);
    assert.equal(result.secondary_window, null);
    assert.equal(result.tertiary_window, null);
  });

  it("prefers auto/api percent lanes over raw plan cents when both exist", () => {
    const result = normalizeCursorUsageSummary({
      billingCycleEnd: "2026-04-30T00:00:00.000Z",
      individualUsage: {
        plan: {
          used: 1,
          limit: 1_000_000,
          autoPercentUsed: 40,
          apiPercentUsed: 60,
        },
      },
    });

    assert.equal(result.primary_window.used_percent, 50);
    assert.equal(result.secondary_window.used_percent, 40);
    assert.equal(result.tertiary_window.used_percent, 60);
  });

  it("maps team onDemand when individual plan has no usable headline", () => {
    const result = normalizeCursorUsageSummary({
      billingCycleEnd: "2026-04-30T00:00:00.000Z",
      membershipType: "team",
      individualUsage: {},
      teamUsage: {
        onDemand: { used: 5000, limit: 10000 },
      },
    });

    assert.equal(result.primary_window.used_percent, 50);
  });

  it("uses team onDemand when enterprise individual lanes are 0% but pool has usage", () => {
    const result = normalizeCursorUsageSummary({
      billingCycleEnd: "2026-05-04T03:32:21.000Z",
      membershipType: "enterprise",
      limitType: "team",
      individualUsage: {
        plan: {
          enabled: true,
          used: 0,
          limit: 2000,
          totalPercentUsed: 0,
          autoPercentUsed: 0,
          apiPercentUsed: 0,
        },
        onDemand: { enabled: true, used: 0, limit: null },
      },
      teamUsage: {
        onDemand: { enabled: true, used: 1655, limit: 630000 },
      },
    });

    assert.ok(result.primary_window.used_percent > 0);
    assert.ok(result.primary_window.used_percent < 1);
  });
});

describe("parseKiroUsageOutput", () => {
  const now = new Date("2026-04-03T00:00:00.000Z");

  it("parses legacy usage output with bonus credits", () => {
    const output = `
\u001b[32m┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\u001b[0m
┃                                                          | KIRO FREE      ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ Monthly credits:                                                          ┃
┃ ████████████████████████████████████████████████████████ 100% (resets on 01/01) ┃
┃                              (0.00 of 50 covered in plan)                 ┃
┃ Bonus credits:                                                            ┃
┃ 0.00/100 credits used, expires in 88 days                                 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    const result = parseKiroUsageOutput(output, { now });

    assert.equal(result.plan_name, "KIRO FREE");
    assert.equal(result.primary_window.used_percent, 100);
    assert.equal(result.primary_window.reset_at, "2027-01-01T00:00:00.000Z");
    assert.equal(result.secondary_window.used_percent, 0);
    assert.ok(result.secondary_window.reset_at.startsWith("2026-06-30T"));
  });

  it("parses managed plan output without usage metrics", () => {
    const output = `
Plan: Q Developer Pro
Usage is managed by organization admin.
`;

    const result = parseKiroUsageOutput(output, { now });

    assert.equal(result.plan_name, "Q Developer Pro");
    assert.equal(result.primary_window.used_percent, 0);
    assert.equal(result.primary_window.reset_at, null);
    assert.equal(result.secondary_window, null);
  });
});

describe("normalizeGeminiQuotaResponse", () => {
  it("maps pro, flash, and flash-lite windows", () => {
    const result = normalizeGeminiQuotaResponse({
      email: "me@example.com",
      tier: "standard-tier",
      buckets: [
        { modelId: "gemini-2.5-pro", remainingFraction: 0.4, resetTime: "2026-04-04T10:00:00Z" },
        { modelId: "gemini-2.5-flash", remainingFraction: 0.8, resetTime: "2026-04-04T09:00:00Z" },
        { modelId: "gemini-2.5-flash-lite", remainingFraction: 0.9, resetTime: "2026-04-04T08:00:00Z" },
      ],
    });

    assert.equal(result.account_email, "me@example.com");
    assert.equal(result.account_plan, "Paid");
    assert.equal(result.primary_window.used_percent, 60);
    assert.equal(result.secondary_window.used_percent, 20);
    assert.equal(result.tertiary_window.used_percent, 10);
  });

  it("does not show epoch reset time when Gemini returns resetTime 0", () => {
    const result = normalizeGeminiQuotaResponse({
      buckets: [
        { modelId: "gemini-2.5-pro", remainingFraction: 0, resetTime: "0" },
        { modelId: "gemini-3-pro-preview", remainingFraction: 0, resetTime: "1970-01-01T00:00:00Z" },
      ],
    });

    assert.equal(result.primary_window.used_percent, 100);
    assert.equal(result.primary_window.reset_at, null);
  });
});

describe("normalizeAntigravityResponse", () => {
  it("maps Claude, Gemini Pro, and Gemini Flash windows from GetUserStatus", () => {
    const result = normalizeAntigravityResponse({
      code: 0,
      userStatus: {
        email: "agent@example.com",
        planStatus: {
          planInfo: {
            planDisplayName: "Antigravity Pro",
          },
        },
        cascadeModelConfigData: {
          clientModelConfigs: [
            {
              label: "Claude Sonnet",
              modelOrAlias: { model: "claude-sonnet-4" },
              quotaInfo: {
                remainingFraction: 0.25,
                resetTime: "2026-04-04T10:00:00.000Z",
              },
            },
            {
              label: "Gemini Pro Low",
              modelOrAlias: { model: "gemini-pro-low" },
              quotaInfo: {
                remainingFraction: 0.4,
                resetTime: "2026-04-04T12:00:00.000Z",
              },
            },
            {
              label: "Gemini Flash",
              modelOrAlias: { model: "gemini-flash" },
              quotaInfo: {
                remainingFraction: 0.8,
                resetTime: "2026-04-04T14:00:00.000Z",
              },
            },
          ],
        },
      },
    });

    assert.equal(result.account_email, "agent@example.com");
    assert.equal(result.account_plan, "Antigravity Pro");
    assert.equal(result.primary_window.used_percent, 75);
    assert.equal(result.secondary_window.used_percent, 60);
    assert.equal(result.tertiary_window.used_percent, 20);
  });

  it("supports GetCommandModelConfigs fallback payloads", () => {
    const result = normalizeAntigravityResponse({
      code: "ok",
      clientModelConfigs: [
        {
          label: "Claude Sonnet",
          modelOrAlias: { model: "claude-sonnet-4" },
          quotaInfo: {
            remainingFraction: 0.5,
            resetTime: "1712311200",
          },
        },
      ],
    }, { fallbackToConfigs: true });

    assert.equal(result.account_email, null);
    assert.equal(result.account_plan, null);
    assert.equal(result.primary_window.used_percent, 50);
    assert.equal(result.primary_window.reset_at, "2024-04-05T10:00:00.000Z");
  });
});

describe("Antigravity helpers", () => {
  it("parses listening ports", () => {
    const output = `
COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
lang      123 me    22u  IPv4 0x123                0t0  TCP 127.0.0.1:51234 (LISTEN)
lang      123 me    23u  IPv4 0x124                0t0  TCP 127.0.0.1:51235 (LISTEN)
`;

    assert.deepEqual(parseListeningPorts(output), [51234, 51235]);
  });

  it("detects antigravity process info from ps output", async () => {
    const commandRunner = () => ({
      stdout: `
123 /Applications/Antigravity.app/Contents/MacOS/language_server_macos --app_data_dir antigravity --csrf_token abc123 --extension_server_port 42427
`,
      status: 0,
    });

    const result = await detectAntigravityProcess({ commandRunner });

    assert.equal(result.configured, true);
    assert.equal(result.pid, 123);
    assert.equal(result.csrfToken, "abc123");
    assert.equal(result.extensionPort, 42427);
  });

  it("persists live Antigravity quota for use after the process exits", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-antigravity-cache-write-"));
    try {
      const nowMs = Date.parse("2026-05-21T00:00:00.000Z");
      const commandRunner = (command) => {
        if (command === "/bin/ps") {
          return {
            stdout: `
123 /Applications/Antigravity.app/Contents/MacOS/language_server_macos --app_data_dir antigravity --csrf_token abc123 --extension_server_port 42427
`,
            status: 0,
          };
        }
        if (command === "which") {
          return { stdout: "/usr/bin/lsof\n", status: 0 };
        }
        if (String(command).endsWith("lsof")) {
          return {
            stdout: `
lang 123 me 22u IPv4 0x123 0t0 TCP 127.0.0.1:51234 (LISTEN)
`,
            status: 0,
          };
        }
        return { stdout: "", stderr: "", status: 1 };
      };
      const requestFn = async ({ path: requestPath }) => {
        if (requestPath.includes("GetUnleashData")) return { code: 0 };
        assert.ok(requestPath.includes("GetUserStatus"));
        return {
          code: 0,
          userStatus: {
            cascadeModelConfigData: {
              clientModelConfigs: [
                {
                  label: "Claude Sonnet",
                  modelOrAlias: { model: "claude-sonnet-4" },
                  quotaInfo: {
                    remainingFraction: 0.25,
                    resetTime: "2026-05-22T00:00:00.000Z",
                  },
                },
              ],
            },
          },
        };
      };

      const result = await fetchAntigravityLimits({ home: tmp, commandRunner, requestFn, nowMs });
      assert.equal(result.configured, true);
      assert.equal(result.primary_window.used_percent, 75);

      const cachedPath = path.join(tmp, ".tokentracker", "tracker", "usage-limits-cache.json");
      const cached = JSON.parse(fs.readFileSync(cachedPath, "utf8"));
      assert.equal(cached.antigravity.primary_window.used_percent, 75);
      assert.equal(cached.antigravity.cached_at, "2026-05-21T00:00:00.000Z");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses cached Antigravity quota when no language server process is running", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-antigravity-cache-read-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      fs.mkdirSync(trackerDir, { recursive: true });
      fs.writeFileSync(
        path.join(trackerDir, "usage-limits-cache.json"),
        JSON.stringify({
          antigravity: {
            primary_window: {
              used_percent: 42,
              reset_at: "2026-05-22T00:00:00.000Z",
            },
            cached_at: "2026-05-21T00:00:00.000Z",
          },
        }),
        "utf8",
      );
      const commandRunner = () => ({ stdout: "", stderr: "", status: 1 });

      const result = await fetchAntigravityLimits({
        home: tmp,
        commandRunner,
        nowMs: Date.parse("2026-05-21T01:00:00.000Z"),
      });

      assert.equal(result.configured, true);
      assert.equal(result.cached, true);
      assert.equal(result.primary_window.used_percent, 42);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses cached Antigravity quota when the live quota request times out", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-antigravity-cache-timeout-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      fs.mkdirSync(trackerDir, { recursive: true });
      fs.writeFileSync(
        path.join(trackerDir, "usage-limits-cache.json"),
        JSON.stringify({
          antigravity: {
            primary_window: {
              used_percent: 42,
              reset_at: "2026-05-22T00:00:00.000Z",
            },
            secondary_window: {
              used_percent: 18,
              reset_at: "2026-05-22T00:00:00.000Z",
            },
            cached_at: "2026-05-21T00:00:00.000Z",
          },
        }),
        "utf8",
      );
      const commandRunner = (command) => {
        if (command === "/bin/ps") {
          return {
            stdout: `
123 /Applications/Antigravity.app/Contents/MacOS/language_server_macos --app_data_dir antigravity --csrf_token abc123 --extension_server_port 42427
`,
            status: 0,
          };
        }
        if (command === "which") {
          return { stdout: "/usr/bin/lsof\n", status: 0 };
        }
        if (String(command).endsWith("lsof")) {
          return {
            stdout: `
lang 123 me 22u IPv4 0x123 0t0 TCP 127.0.0.1:51234 (LISTEN)
`,
            status: 0,
          };
        }
        return { stdout: "", stderr: "", status: 1 };
      };
      const requestFn = async () => {
        throw new Error("timeout");
      };

      const result = await fetchAntigravityLimits({
        home: tmp,
        commandRunner,
        requestFn,
        nowMs: Date.parse("2026-05-21T01:00:00.000Z"),
      });

      assert.equal(result.configured, true);
      assert.equal(result.cached, true);
      assert.equal(result.error, null);
      assert.equal(result.primary_window.used_percent, 42);
      assert.equal(result.secondary_window.used_percent, 18);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not use cached Antigravity quota after all cached windows reset", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-antigravity-cache-expired-"));
    try {
      const trackerDir = path.join(tmp, ".tokentracker", "tracker");
      fs.mkdirSync(trackerDir, { recursive: true });
      fs.writeFileSync(
        path.join(trackerDir, "usage-limits-cache.json"),
        JSON.stringify({
          antigravity: {
            primary_window: {
              used_percent: 42,
              reset_at: "2026-05-21T00:00:00.000Z",
            },
            cached_at: "2026-05-20T23:00:00.000Z",
          },
        }),
        "utf8",
      );
      const commandRunner = () => ({ stdout: "", stderr: "", status: 1 });

      const result = await fetchAntigravityLimits({
        home: tmp,
        commandRunner,
        nowMs: Date.parse("2026-05-21T01:00:00.000Z"),
      });

      assert.equal(result.configured, false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("normalizePlanLabel", () => {
  it("Title-cases a bare paid tier", () => {
    assert.equal(normalizePlanLabel("max", "Claude"), "Max");
  });

  it("returns null for the free tier", () => {
    assert.equal(normalizePlanLabel("free", "Cursor"), null);
  });

  it("strips a leading brand word and Title-cases the rest", () => {
    assert.equal(normalizePlanLabel("KIRO PROFESSIONAL", "Kiro"), "Professional");
  });

  it("Title-cases a lowercase tier", () => {
    assert.equal(normalizePlanLabel("business", "Codex"), "Business");
  });

  it("returns null for a null tier", () => {
    assert.equal(normalizePlanLabel(null, "Codex"), null);
  });

  it("returns null when the tier is just the brand placeholder", () => {
    assert.equal(normalizePlanLabel("Kiro", "Kiro"), null);
  });
});

describe("getUsageLimits plan_label", () => {
  it("populates plan_label for a paid Claude account", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-plan-paid-"));
    try {
      const claudeDir = path.join(tmp, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, ".credentials.json"),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: "paid-claude-token",
            subscriptionType: "max",
            rateLimitTier: "tier-1",
          },
        }),
      );

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner() {
          return { status: 1, stdout: "" };
        },
        commandRunner() {
          return { status: 1, stdout: "" };
        },
        fetchImpl(url) {
          if (typeof url === "string" && url === "https://api.anthropic.com/api/oauth/usage") {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                five_hour: { utilization: 0.4 },
                seven_day: { utilization: 0.12 },
                seven_day_opus: null,
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.equal(result.claude.configured, true);
      assert.equal(result.claude.error, null);
      assert.equal(result.claude.plan_label, "Max");
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("leaves plan_label null for a free Claude account", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-plan-free-"));
    try {
      const claudeDir = path.join(tmp, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, ".credentials.json"),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: "free-claude-token",
            subscriptionType: "free",
          },
        }),
      );

      const result = await getUsageLimits({
        home: tmp,
        platform: "linux",
        providerTimeoutMs: 1000,
        securityRunner() {
          return { status: 1, stdout: "" };
        },
        commandRunner() {
          return { status: 1, stdout: "" };
        },
        fetchImpl(url) {
          if (typeof url === "string" && url === "https://api.anthropic.com/api/oauth/usage") {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                five_hour: { utilization: 0.1 },
                seven_day: { utilization: 0.05 },
                seven_day_opus: null,
              }),
            });
          }
          return new Promise(() => {});
        },
      });

      assert.equal(result.claude.configured, true);
      assert.equal(result.claude.error, null);
      assert.equal(result.claude.plan_label, null);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("getUsageLimits Claude stale fallback", () => {
  const FUTURE_RESET = "2099-01-01T00:00:00.000Z";

  function makeClaudeHome(tmp) {
    const claudeDir = path.join(tmp, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "claude-token" } }),
    );
  }

  function runLimits(tmp, claudeResponder) {
    return getUsageLimits({
      home: tmp,
      platform: "linux",
      providerTimeoutMs: 1000,
      securityRunner() {
        return { status: 1, stdout: "" };
      },
      commandRunner() {
        return { status: 1, stdout: "" };
      },
      fetchImpl(url) {
        if (url === "https://api.anthropic.com/api/oauth/usage") return claudeResponder();
        return new Promise(() => {});
      },
    });
  }

  function ageClaudeCache(tmp, ageMs) {
    const cachePath = path.join(tmp, ".tokentracker", "tracker", "claude-usage-limits-cache.json");
    const payload = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    payload.claude.cached_at = new Date(Date.now() - ageMs).toISOString();
    fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2));
  }

  it("serves the last successful read when a later fetch is rate limited", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-claude-stale-"));
    try {
      makeClaudeHome(tmp);

      const ok = await runLimits(tmp, () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            five_hour: { utilization: 11, resets_at: FUTURE_RESET },
            seven_day: { utilization: 81, resets_at: FUTURE_RESET },
            seven_day_opus: null,
          }),
        }),
      );
      assert.equal(ok.claude.error, null);
      assert.equal(ok.claude.five_hour.utilization, 11);
      assert.notEqual(ok.claude.stale, true);

      // Age the disk cache past the short fresh-cache TTL, then drop the in-memory cache
      // so the next call actually re-fetches and hits the 429 fallback branch.
      ageClaudeCache(tmp, 11 * 60 * 1000);
      resetUsageLimitsCache();

      const limited = await runLimits(tmp, () =>
        Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: () => null },
        }),
      );
      // Bars stay visible from disk cache instead of flipping to a red error.
      assert.equal(limited.claude.configured, true);
      assert.equal(limited.claude.error, null);
      assert.equal(limited.claude.stale, true);
      assert.equal(limited.claude.five_hour.utilization, 11);
      assert.equal(limited.claude.seven_day.utilization, 81);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses a recent disk cache instead of refetching Claude after process cache reset", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-claude-fresh-cache-"));
    try {
      makeClaudeHome(tmp);

      let claudeCalls = 0;
      const ok = await runLimits(tmp, () => {
        claudeCalls += 1;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            five_hour: { utilization: 22, resets_at: FUTURE_RESET },
            seven_day: { utilization: 44, resets_at: FUTURE_RESET },
            seven_day_opus: null,
          }),
        });
      });
      assert.equal(ok.claude.error, null);
      assert.equal(ok.claude.five_hour.utilization, 22);
      assert.equal(claudeCalls, 1);

      resetUsageLimitsCache();
      const cached = await runLimits(tmp, () => {
        claudeCalls += 1;
        throw new Error("Claude endpoint should not be called while disk cache is fresh");
      });

      assert.equal(claudeCalls, 1);
      assert.equal(cached.claude.configured, true);
      assert.equal(cached.claude.error, null);
      assert.equal(cached.claude.stale, false);
      assert.equal(cached.claude.five_hour.utilization, 22);
      assert.equal(cached.claude.seven_day.utilization, 44);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("surfaces the error when a fetch fails and there is no cached fallback", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-claude-nocache-"));
    try {
      makeClaudeHome(tmp);

      const limited = await runLimits(tmp, () =>
        Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: () => null },
        }),
      );
      assert.equal(limited.claude.configured, true);
      assert.match(limited.claude.error, /rate limited \(429\)/);
      assert.notEqual(limited.claude.stale, true);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("records a cooldown on 429 and stops calling the endpoint until it expires", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-claude-cooldown-"));
    try {
      makeClaudeHome(tmp);

      let claudeCalls = 0;
      const responder = () => {
        claudeCalls += 1;
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: (h) => (h === "retry-after" ? "600" : null) },
        });
      };

      const first = await runLimits(tmp, responder);
      assert.equal(claudeCalls, 1);
      assert.match(first.claude.error, /retry in ~10m/);

      // Cooldown is active — the next call must not touch the endpoint again.
      resetUsageLimitsCache();
      const second = await runLimits(tmp, responder);
      assert.equal(claudeCalls, 1, "endpoint must not be called again during cooldown");
      assert.match(second.claude.error, /retry in ~\d+m/);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("clears the cooldown and resumes once a fetch succeeds", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-claude-recover-"));
    try {
      makeClaudeHome(tmp);

      await runLimits(tmp, () =>
        Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: (h) => (h === "retry-after" ? "600" : null) },
        }),
      );
      const cooldownPath = path.join(tmp, ".tokentracker", "tracker", "claude-usage-rate-limit.json");
      assert.ok(fs.existsSync(cooldownPath), "cooldown file should be written on 429");

      // A test can't wait out a 10m cooldown, so clear it to simulate expiry, then succeed.
      fs.unlinkSync(cooldownPath);
      resetUsageLimitsCache();
      const ok = await runLimits(tmp, () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            five_hour: { utilization: 5, resets_at: FUTURE_RESET },
            seven_day: { utilization: 9, resets_at: FUTURE_RESET },
            seven_day_opus: null,
          }),
        }),
      );
      assert.equal(ok.claude.error, null);
      assert.equal(ok.claude.five_hour.utilization, 5);
      assert.equal(fs.existsSync(cooldownPath), false, "cooldown file should be cleared on success");
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("drops cached windows whose reset has already passed", async () => {
    resetUsageLimitsCache();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-limits-claude-expired-"));
    try {
      makeClaudeHome(tmp);

      const ok = await runLimits(tmp, () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            five_hour: { utilization: 50, resets_at: "2000-01-01T00:00:00.000Z" },
            seven_day: { utilization: 81, resets_at: FUTURE_RESET },
            seven_day_opus: null,
          }),
        }),
      );
      assert.equal(ok.claude.error, null);

      ageClaudeCache(tmp, 11 * 60 * 1000);
      resetUsageLimitsCache();

      const limited = await runLimits(tmp, () =>
        Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: () => null },
        }),
      );
      assert.equal(limited.claude.stale, true);
      // Expired 5h window is dropped; the still-valid 7d window survives.
      assert.equal(limited.claude.five_hour, null);
      assert.equal(limited.claude.seven_day.utilization, 81);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
