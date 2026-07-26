require("./helpers/home-shim.cjs");

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  detectDataDirectoryPaths,
  listCodexHomeCandidates,
  listTrackingReadyCodexHomes,
  normalizeDataDirectories,
  resolveDataDirectoryPaths,
} = require("../src/lib/data-directories");

test("normalizeDataDirectories trims known directory overrides", () => {
  assert.deepEqual(
    normalizeDataDirectories({
      claude: "  \\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude  ",
      codex: " C:\\Users\\admin\\.codex ",
      cursor: "  ",
      openclaw: " D:\\openclaw ",
      hermes: "  ",
      ignored: "x",
    }),
    {
      claude: "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude",
      codex: "C:\\Users\\admin\\.codex",
      cursor: "",
      trae: "",
      openclaw: "D:\\openclaw",
      hermes: "",
    },
  );
});

test("preload disables production default-drive scans while explicit fake roots remain available", async () => {
  const repoRoot = path.resolve(__dirname, "..");
  const preloadPath = path.join(__dirname, "helpers", "home-shim.cjs");
  const preloadedScript = String.raw`
    const fs = require("node:fs");
    const path = require("node:path");
    const safeRoot = path.resolve(process.env.TOKENTRACKER_TEST_TEMP_ROOT);
    const realStatSync = fs.statSync;
    const realWrite = process.stdout.write.bind(process.stdout);
    let externalAgentDataProbe = false;
    fs.statSync = function guardedStatSync(candidate, ...args) {
      const resolved = path.resolve(String(candidate));
      if (/^[A-Za-z]:[\\/]+AgentData(?:[\\/]|$)/i.test(resolved) && !resolved.startsWith(safeRoot)) {
        externalAgentDataProbe = true;
        const error = new Error("blocked external AgentData probe");
        error.code = "ENOENT";
        throw error;
      }
      return realStatSync.call(this, candidate, ...args);
    };
    process.stdout.write = () => true;
    require("./src/commands/status").cmdStatus([]).then(() => {
      realWrite(JSON.stringify({
        markerEnabled: process.env.TOKENTRACKER_TEST_DISABLE_WINDOWS_DRIVE_SCAN === "1",
        externalAgentDataProbe,
      }));
    }).catch((error) => {
      realWrite(JSON.stringify({ errorName: error && error.name }));
      process.exitCode = 1;
    });
  `;
  const preloaded = cp.spawnSync(
    process.execPath,
    ["--require", preloadPath, "-e", preloadedScript],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        TOKENTRACKER_TEST_DISABLE_WINDOWS_DRIVE_SCAN: "",
      },
      encoding: "utf8",
    },
  );
  assert.equal(preloaded.status, 0, preloaded.stderr);
  assert.deepEqual(JSON.parse(preloaded.stdout), {
    markerEnabled: true,
    externalAgentDataProbe: false,
  });

  const fakeDrive = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-explicit-drive-"));
  try {
    const explicitScript = String.raw`
      const path = require("node:path");
      const { readCodexAuthBundle } = require("./src/lib/subscriptions");
      const fakeDrive = process.env.TOKENTRACKER_TEST_FAKE_DRIVE;
      readCodexAuthBundle({
        home: path.join(fakeDrive, "home"),
        env: {},
        platform: "win32",
        scanDefaultWindowsDrives: true,
        windowsDriveRoots: [fakeDrive],
      }).then((bundle) => {
        process.stdout.write(JSON.stringify({ explicitScanFoundAuth: Boolean(bundle && bundle.accessToken) }));
      });
    `;
    await fs.promises.mkdir(path.join(fakeDrive, "AgentData", "Codex"), { recursive: true });
    await fs.promises.writeFile(
      path.join(fakeDrive, "AgentData", "Codex", "auth.json"),
      JSON.stringify({ tokens: { access_token: "fixture-explicit-scan-token" } }),
      "utf8",
    );
    const explicit = cp.spawnSync(process.execPath, ["-e", explicitScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        TOKENTRACKER_TEST_DISABLE_WINDOWS_DRIVE_SCAN: "",
        TOKENTRACKER_TEST_FAKE_DRIVE: fakeDrive,
      },
      encoding: "utf8",
    });
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.deepEqual(JSON.parse(explicit.stdout), { explicitScanFoundAuth: true });
  } finally {
    await fs.promises.rm(fakeDrive, { recursive: true, force: true });
  }
});

test("resolveDataDirectoryPaths keeps TokenTracker defaults on non-Windows when overrides are empty", () => {
  const home = path.join("C:", "Users", "example");
  const resolved = resolveDataDirectoryPaths({ config: { dataDirectories: {} }, env: {}, home, platform: "linux" });

  assert.equal(resolved.codexHome, path.join(home, ".codex"));
  assert.equal(resolved.codeHome, path.join(home, ".code"));
  assert.equal(resolved.claudeProjectsDir, path.join(home, ".claude", "projects"));
  assert.equal(resolved.hermesPath, null);
});

test("listCodexHomeCandidates does not read process CODEX_HOME after home is injected", () => {
  const home = path.join("C:", "isolated-test-home");
  const bait = path.join(__dirname, "fixtures", "bait-codex-home");
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = bait;
  try {
    const candidates = listCodexHomeCandidates({ home, platform: "linux" });
    assert.deepEqual(candidates, [path.join(home, ".codex")]);
    assert.ok(!candidates.includes(bait));
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
});

test("resolveDataDirectoryPaths applies MVP data directory overrides", () => {
  const home = path.join("C:", "Users", "example");
  const claude = "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude";
  const codex = "D:\\CodexHome";
  const hermes = "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.hermes";
  const resolved = resolveDataDirectoryPaths({
    home,
    env: { CODEX_HOME: "E:\\ShouldNotWin" },
    config: { dataDirectories: { claude, codex, hermes } },
  });

  assert.equal(resolved.codexHome, codex);
  assert.equal(resolved.claudeProjectsDir, path.join(claude, "projects"));
  assert.equal(resolved.hermesPath, hermes);
});

test("resolveDataDirectoryPaths prefers active Codex Desktop evidence over stale default .codex", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-resolve-codex-desktop-"));
  try {
    const home = path.join(tmp, "Users", "example");
    const defaultCodex = path.join(home, ".codex");
    const desktopCodex = path.join(tmp, "AgentData", "Codex");
    await fs.promises.mkdir(path.join(defaultCodex, "sessions"), { recursive: true });
    await fs.promises.mkdir(path.join(desktopCodex, "sessions"), { recursive: true });
    const staleLog = path.join(defaultCodex, "sessions", "stale.jsonl");
    const activeLog = path.join(desktopCodex, "sessions", "active.jsonl");
    await fs.promises.writeFile(staleLog, "{}\n", "utf8");
    await fs.promises.writeFile(activeLog, "{}\n", "utf8");
    await fs.promises.utimes(staleLog, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
    await fs.promises.utimes(activeLog, new Date("2026-07-06T00:00:00.000Z"), new Date("2026-07-06T00:00:00.000Z"));

    const resolved = resolveDataDirectoryPaths({
      home,
      env: { CODEX_HOME: desktopCodex },
      config: { dataDirectories: { codex: defaultCodex } },
    });

    assert.equal(resolved.codexHome, desktopCodex);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("detectDataDirectoryPaths chooses installed agents with live token evidence", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-detect-"));
  try {
    const codexHome = path.join(tmp, "custom-codex");
    const localAppData = path.join(tmp, "AppData", "Local");
    const appData = path.join(tmp, "AppData", "Roaming");
    const hermesHome = path.join(localAppData, "hermes");
    const cursorHome = path.join(appData, "Cursor");
    const wslRoot = path.join(tmp, "wsl.localhost");
    const wslClaudeHome = path.join(wslRoot, "Ubuntu", "home", "agent", ".claude");

    await fs.promises.mkdir(path.join(tmp, ".claude", "projects"), { recursive: true });
    await fs.promises.writeFile(path.join(tmp, ".claude", "projects", "stale.jsonl"), "{}\n", "utf8");
    await fs.promises.mkdir(path.join(wslClaudeHome, "projects"), { recursive: true });
    await fs.promises.writeFile(path.join(wslClaudeHome, "projects", "active.jsonl"), "{}\n", "utf8");
    await fs.promises.mkdir(path.join(codexHome, "sessions"), { recursive: true });
    await fs.promises.writeFile(path.join(codexHome, "sessions", "session.jsonl"), "{}\n", "utf8");
    await fs.promises.mkdir(path.join(cursorHome, "User", "globalStorage"), { recursive: true });
    await fs.promises.writeFile(path.join(cursorHome, "User", "globalStorage", "state.vscdb"), "db", "utf8");
    await fs.promises.mkdir(path.join(tmp, ".openclaw"), { recursive: true });
    await fs.promises.mkdir(hermesHome, { recursive: true });
    await fs.promises.writeFile(path.join(hermesHome, "state.db"), "db", "utf8");
    const staleTime = new Date("2026-01-01T00:00:00.000Z");
    const activeTime = new Date("2026-06-01T00:00:00.000Z");
    await fs.promises.utimes(path.join(tmp, ".claude", "projects", "stale.jsonl"), staleTime, staleTime);
    await fs.promises.utimes(path.join(wslClaudeHome, "projects", "active.jsonl"), activeTime, activeTime);

    const result = detectDataDirectoryPaths({
      home: tmp,
      env: {
        APPDATA: appData,
        CODEX_HOME: codexHome,
        LOCALAPPDATA: localAppData,
      },
      platform: "win32",
      wslRoots: [wslRoot],
      detectInstallation: (agentId) => ({ installed: agentId !== "openclaw" }),
    });

    assert.deepEqual(result.dataDirectories, {
      claude: wslClaudeHome,
      codex: codexHome,
      hermes: hermesHome,
      cursor: cursorHome,
      trae: "",
      openclaw: "",
    });
    assert.equal(result.detected.claude.evidence, "token_logs");
    assert.equal(result.detected.hermes.evidence, "state_db_exists");
    assert.deepEqual(result.missing.sort(), ["openclaw", "trae"].sort());
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("detectDataDirectoryPaths chooses live token evidence even when CLI installation is not detected", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-token-only-"));
  try {
    const codexHome = path.join(tmp, "CodexHome");
    await fs.promises.mkdir(path.join(codexHome, "sessions"), { recursive: true });
    await fs.promises.writeFile(path.join(codexHome, "sessions", "session.jsonl"), "{}\n", "utf8");

    const result = detectDataDirectoryPaths({
      home: tmp,
      env: { CODEX_HOME: codexHome },
      platform: "win32",
      wslRoots: [],
      wslDistributions: [],
      detectInstallation: () => ({ installed: false, executablePath: null, currentVersion: null }),
    });

    assert.equal(result.dataDirectories.codex, codexHome);
    assert.equal(result.detected.codex.status, "ready");
    assert.equal(result.detected.codex.trackingReady, true);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("detectDataDirectoryPaths discovers Windows AgentData Codex home without CODEX_HOME", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-agentdata-codex-"));
  try {
    const agentDataCodex = path.join(tmp, "AgentData", "Codex");
    await fs.promises.mkdir(path.join(agentDataCodex, "sessions"), { recursive: true });
    await fs.promises.writeFile(path.join(agentDataCodex, "sessions", "rollout.jsonl"), "{}\n", "utf8");

    const result = detectDataDirectoryPaths({
      home: path.join(tmp, "Users", "example"),
      env: {},
      platform: "win32",
      wslRoots: [],
      wslDistributions: [],
      windowsDriveRoots: [tmp],
      scanDefaultWindowsDrives: true,
      detectInstallation: () => ({ installed: false, executablePath: null, currentVersion: null }),
    });

    assert.equal(result.dataDirectories.codex, agentDataCodex);
    assert.equal(result.detected.codex.trackingReady, true);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("detectDataDirectoryPaths treats default Codex config as overridable by active CODEX_HOME", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-detect-codex-desktop-"));
  try {
    const home = path.join(tmp, "Users", "example");
    const defaultCodex = path.join(home, ".codex");
    const desktopCodex = path.join(tmp, "AgentData", "Codex");
    await fs.promises.mkdir(path.join(defaultCodex, "sessions"), { recursive: true });
    await fs.promises.mkdir(path.join(desktopCodex, "sessions"), { recursive: true });
    const staleLog = path.join(defaultCodex, "sessions", "stale.jsonl");
    const activeLog = path.join(desktopCodex, "sessions", "active.jsonl");
    await fs.promises.writeFile(staleLog, "{}\n", "utf8");
    await fs.promises.writeFile(activeLog, "{}\n", "utf8");
    await fs.promises.utimes(staleLog, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
    await fs.promises.utimes(activeLog, new Date("2026-07-06T00:00:00.000Z"), new Date("2026-07-06T00:00:00.000Z"));

    const result = detectDataDirectoryPaths({
      config: { dataDirectories: { codex: defaultCodex } },
      home,
      env: { CODEX_HOME: desktopCodex },
      platform: "win32",
      wslRoots: [],
      wslDistributions: [],
      detectInstallation: () => ({ installed: false, executablePath: null, currentVersion: null }),
    });

    assert.equal(result.dataDirectories.codex, desktopCodex);
    assert.equal(result.detected.codex.latestActivityAt, "2026-07-06T00:00:00.000Z");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("resolveDataDirectoryPaths respects explicit CODEX_HOME even when Windows AgentData exists", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-env-codex-"));
  try {
    const home = path.join(tmp, "Users", "example");
    const envCodexHome = path.join(tmp, "empty-codex");
    const agentDataCodex = path.join(tmp, "AgentData", "Codex");
    await fs.promises.mkdir(path.join(agentDataCodex, "sessions"), { recursive: true });
    await fs.promises.writeFile(path.join(agentDataCodex, "sessions", "rollout.jsonl"), "{}\n", "utf8");

    const resolved = resolveDataDirectoryPaths({
      home,
      env: { CODEX_HOME: envCodexHome },
      platform: "win32",
      windowsDriveRoots: [tmp],
      scanDefaultWindowsDrives: true,
      config: { dataDirectories: {} },
    });

    assert.equal(resolved.codexHome, envCodexHome);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("detectDataDirectoryPaths prefers a configured Codex directory over newer env evidence", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-configured-codex-"));
  try {
    const configuredCodexHome = path.join(tmp, "configured-codex");
    const envCodexHome = path.join(tmp, "env-codex");
    await fs.promises.mkdir(path.join(configuredCodexHome, "sessions"), { recursive: true });
    await fs.promises.mkdir(path.join(envCodexHome, "sessions"), { recursive: true });
    const configuredLog = path.join(configuredCodexHome, "sessions", "configured.jsonl");
    const envLog = path.join(envCodexHome, "sessions", "newer.jsonl");
    await fs.promises.writeFile(configuredLog, "{}\n", "utf8");
    await fs.promises.writeFile(envLog, "{}\n", "utf8");
    await fs.promises.utimes(configuredLog, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
    await fs.promises.utimes(envLog, new Date("2026-07-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));

    const result = detectDataDirectoryPaths({
      config: { dataDirectories: { codex: configuredCodexHome } },
      home: tmp,
      env: { CODEX_HOME: envCodexHome },
      platform: "win32",
      wslRoots: [],
      wslDistributions: [],
      detectInstallation: () => ({ installed: false, executablePath: null, currentVersion: null }),
    });

    assert.equal(result.dataDirectories.codex, configuredCodexHome);
    assert.equal(result.detected.codex.path, configuredCodexHome);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("listTrackingReadyCodexHomes returns every tracking-ready Codex directory", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-multi-codex-"));
  try {
    const home = path.join(tmp, "Users", "example");
    const defaultCodex = path.join(home, ".codex");
    const desktopCodex = path.join(tmp, "AgentData", "Codex");
    await fs.promises.mkdir(path.join(defaultCodex, "sessions"), { recursive: true });
    await fs.promises.mkdir(path.join(desktopCodex, "sessions"), { recursive: true });
    const staleLog = path.join(defaultCodex, "sessions", "stale.jsonl");
    const activeLog = path.join(desktopCodex, "sessions", "active.jsonl");
    await fs.promises.writeFile(staleLog, "{}\n", "utf8");
    await fs.promises.writeFile(activeLog, "{}\n", "utf8");
    await fs.promises.utimes(staleLog, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
    await fs.promises.utimes(activeLog, new Date("2026-07-06T00:00:00.000Z"), new Date("2026-07-06T00:00:00.000Z"));

    const homes = listTrackingReadyCodexHomes({
      home,
      env: {},
      platform: "win32",
      windowsDriveRoots: [tmp],
      scanDefaultWindowsDrives: true,
      configured: defaultCodex,
    });

    assert.equal(homes.length, 2);
    assert.equal(homes[0], desktopCodex);
    assert.ok(homes.includes(defaultCodex));
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("resolveDataDirectoryPaths exposes codexHomes for multi-directory ingest", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-codex-homes-"));
  try {
    const home = path.join(tmp, "Users", "example");
    const defaultCodex = path.join(home, ".codex");
    const desktopCodex = path.join(tmp, "AgentData", "Codex");
    await fs.promises.mkdir(path.join(defaultCodex, "sessions"), { recursive: true });
    await fs.promises.mkdir(path.join(desktopCodex, "sessions"), { recursive: true });
    await fs.promises.writeFile(path.join(defaultCodex, "sessions", "a.jsonl"), "{}\n", "utf8");
    await fs.promises.writeFile(path.join(desktopCodex, "sessions", "b.jsonl"), "{}\n", "utf8");

    const resolved = resolveDataDirectoryPaths({
      home,
      env: { CODEX_HOME: desktopCodex },
      platform: "win32",
      windowsDriveRoots: [tmp],
      scanDefaultWindowsDrives: true,
      config: { dataDirectories: { codex: defaultCodex } },
    });

    assert.equal(resolved.codexHome, desktopCodex);
    assert.equal(resolved.codexHomes.length, 2);
    assert.ok(resolved.codexHomes.includes(defaultCodex));
    assert.ok(resolved.codexHomes.includes(desktopCodex));
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("detectAgentInstallation does not launch Windows GUI CLIs for version probing", () => {
  const modulePath = require.resolve("../src/lib/data-directories");
  const childProcess = require("node:child_process");
  const originalExecFileSync = childProcess.execFileSync;
  const originalModule = require.cache[modulePath];
  const calls = [];

  delete require.cache[modulePath];
  childProcess.execFileSync = (command, args) => {
    calls.push({ command, args });
    if (command === "where.exe") {
      return [
        "E:\\Program Files\\cursor\\resources\\app\\bin\\cursor",
        "E:\\Program Files\\cursor\\resources\\app\\bin\\cursor.cmd",
      ].join("\r\n");
    }
    throw new Error(`unexpected command: ${command}`);
  };

  try {
    const freshModule = require("../src/lib/data-directories");
    const result = freshModule.detectAgentInstallation("cursor", "win", "E:\\Program Files\\cursor");

    assert.equal(result.installed, true);
    assert.equal(result.executablePath, "E:\\Program Files\\cursor\\resources\\app\\bin\\cursor.cmd");
    assert.equal(result.currentVersion, null);
    assert.deepEqual(calls.map((call) => call.command), ["where.exe"]);
  } finally {
    childProcess.execFileSync = originalExecFileSync;
    delete require.cache[modulePath];
    if (originalModule) require.cache[modulePath] = originalModule;
  }
});

test("detectDataDirectoryPaths discovers WSL homes from distro names when the server root cannot be scanned", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-wsl-distro-"));
  const originalReaddirSync = fs.readdirSync;
  try {
    const wslRoot = path.join(tmp, "wsl.localhost");
    const wslClaudeHome = path.join(wslRoot, "Ubuntu", "home", "agent", ".claude");
    await fs.promises.mkdir(path.join(wslClaudeHome, "projects"), { recursive: true });
    await fs.promises.writeFile(path.join(wslClaudeHome, "projects", "active.jsonl"), "{}\n", "utf8");

    fs.readdirSync = (candidate, options) => {
      if (candidate === wslRoot) {
        const err = new Error("Cannot enumerate WSL server root");
        err.code = "ENOENT";
        throw err;
      }
      return originalReaddirSync(candidate, options);
    };

    const result = detectDataDirectoryPaths({
      home: tmp,
      env: {},
      platform: "win32",
      wslRoots: [wslRoot],
      wslDistributions: ["Ubuntu"],
      detectInstallation: (agentId) => ({ installed: agentId === "claude" }),
    });

    assert.equal(result.dataDirectories.claude, wslClaudeHome);
    assert.equal(result.detected.claude.evidence, "token_logs");
  } finally {
    fs.readdirSync = originalReaddirSync;
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("listTrackingReadyTraeHomes detects token_usage.jsonl export", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-trae-homes-"));
  try {
    const traeRoot = path.join(tmp, "Trae CN");
    const agentDir = path.join(traeRoot, "ModularData", "ai-agent");
    await fs.promises.mkdir(agentDir, { recursive: true });
    const jsonl = path.join(agentDir, "token_usage.jsonl");
    await fs.promises.writeFile(
      jsonl,
      JSON.stringify({
        id: "turn-1",
        created_at: "2026-07-06T10:00:00.000Z",
        context: {
          token_usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            cache_read_input_tokens: 5,
          },
          persist_user_message_context: { model_info: { config_name: "kimi-k2.5" } },
        },
      }) + "\n",
      "utf8",
    );

    const { listTrackingReadyTraeHomes } = require("../src/lib/data-directories");
    const homes = listTrackingReadyTraeHomes({
      configured: traeRoot,
      env: {},
      home: tmp,
      platform: "win32",
    });
    assert.deepEqual(homes, [traeRoot]);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("listTrackingReadyCursorHomes returns all ready cursor data directories", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-cursor-homes-"));
  try {
    const roaming = path.join(tmp, "AppData", "Roaming", "Cursor");
    const local = path.join(tmp, "AppData", "Local", "Cursor");
    for (const cursorHome of [roaming, local]) {
      await fs.promises.mkdir(path.join(cursorHome, "User", "globalStorage"), { recursive: true });
      const db = path.join(cursorHome, "User", "globalStorage", "state.vscdb");
      await fs.promises.writeFile(db, "sqlite", "utf8");
    }

    const { listTrackingReadyCursorHomes } = require("../src/lib/data-directories");
    const homes = listTrackingReadyCursorHomes({
      env: {
        APPDATA: path.join(tmp, "AppData", "Roaming"),
        LOCALAPPDATA: path.join(tmp, "AppData", "Local"),
      },
      home: tmp,
      platform: "win32",
    });
    assert.equal(homes.length, 2);
    assert.ok(homes.includes(roaming));
    assert.ok(homes.includes(local));
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
