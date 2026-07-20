const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  detectDataDirectoryPaths,
  inspectDataDirectory,
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
      opencode: " E:\\opencode ",
      hermes: "  ",
      ignored: "x",
    }),
    {
      claude: "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude",
      codex: "C:\\Users\\admin\\.codex",
      cursor: "",
      trae: "",
      gemini: "",
      openclaw: "D:\\openclaw",
      opencode: "E:\\opencode",
      hermes: "",
      codebuddy: "",
      antigravity: "",
    },
  );
});

test("resolveDataDirectoryPaths keeps TokenTracker defaults on non-Windows when overrides are empty", () => {
  const home = path.join("C:", "Users", "example");
  const resolved = resolveDataDirectoryPaths({ config: { dataDirectories: {} }, env: {}, home, platform: "linux" });

  assert.equal(resolved.codexHome, path.join(home, ".codex"));
  assert.equal(resolved.codeHome, path.join(home, ".code"));
  assert.equal(resolved.claudeProjectsDir, path.join(home, ".claude", "projects"));
  assert.equal(resolved.hermesPath, null);
  assert.equal(resolved.opencodeHome, path.join(home, ".local", "share", "opencode"));
  assert.equal(resolved.geminiHome, path.join(home, ".gemini"));
  assert.equal(resolved.codebuddyHome, path.join(home, ".codebuddy"));
  assert.equal(resolved.antigravityHome, path.join(home, ".gemini"));
});

test("resolveDataDirectoryPaths applies MVP data directory overrides", () => {
  const home = path.join("C:", "Users", "example");
  const claude = "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude";
  const codex = "D:\\CodexHome";
  const hermes = "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.hermes";
  const opencode = "D:\\OpenCodeData";
  const resolved = resolveDataDirectoryPaths({
    home,
    env: { CODEX_HOME: "E:\\ShouldNotWin" },
    config: { dataDirectories: { claude, codex, hermes, opencode } },
  });

  assert.equal(resolved.codexHome, codex);
  assert.equal(resolved.claudeProjectsDir, path.join(claude, "projects"));
  assert.equal(resolved.hermesPath, hermes);
  assert.equal(resolved.opencodeHome, opencode);
});

test("inspectDataDirectory recognizes OpenCode SQLite and JSON message evidence", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-opencode-"));
  try {
    const sqliteHome = path.join(tmp, "sqlite");
    await fs.promises.mkdir(sqliteHome, { recursive: true });
    const dbPath = path.join(sqliteHome, "opencode.db");
    await fs.promises.writeFile(dbPath, "sqlite", "utf8");
    const sqliteInspection = inspectDataDirectory("opencode", sqliteHome);
    assert.equal(sqliteInspection.status, "ready");
    assert.equal(sqliteInspection.trackingReady, true);
    assert.equal(sqliteInspection.evidence, "opencode_database");
    assert.equal(sqliteInspection.evidenceCount, 1);

    const jsonHome = path.join(tmp, "json");
    const messageDir = path.join(jsonHome, "storage", "message", "session");
    await fs.promises.mkdir(messageDir, { recursive: true });
    await fs.promises.writeFile(path.join(messageDir, "message.json"), "{}", "utf8");
    const jsonInspection = inspectDataDirectory("opencode", jsonHome);
    assert.equal(jsonInspection.trackingReady, true);
    assert.equal(jsonInspection.evidence, "token_logs");
    assert.equal(jsonInspection.evidenceCount, 1);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("inspectDataDirectory recognizes Gemini, CodeBuddy and Antigravity token logs", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-new-agents-"));
  try {
    const geminiHome = path.join(tmp, "gemini");
    const geminiChat = path.join(geminiHome, "tmp", "project", "chats");
    await fs.promises.mkdir(geminiChat, { recursive: true });
    await fs.promises.writeFile(path.join(geminiChat, "session-1.json"), "{}", "utf8");
    assert.equal(inspectDataDirectory("gemini", geminiHome).status, "ready");

    const codebuddyHome = path.join(tmp, "codebuddy");
    const codebuddyProject = path.join(codebuddyHome, "projects", "cwd");
    await fs.promises.mkdir(codebuddyProject, { recursive: true });
    await fs.promises.writeFile(path.join(codebuddyProject, "session.jsonl"), "{}\n", "utf8");
    assert.equal(inspectDataDirectory("codebuddy", codebuddyHome).status, "ready");

    const antigravityHome = path.join(tmp, "antigravity-root");
    const transcriptDir = path.join(antigravityHome, "antigravity", "brain", "session", ".system_generated", "logs");
    await fs.promises.mkdir(transcriptDir, { recursive: true });
    await fs.promises.writeFile(path.join(transcriptDir, "transcript.jsonl"), "{}\n", "utf8");
    assert.equal(inspectDataDirectory("antigravity", antigravityHome).status, "ready");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("inspectDataDirectory redirects Trae and CodeBuddy install folders to their roaming data", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-install-redirect-"));
  try {
    const appData = path.join(tmp, "AppData");
    const traeInstall = path.join(appData, "Local", "Programs", "Trae CN");
    const traeData = path.join(appData, "Roaming", "Trae CN", "ModularData", "ai-agent");
    const codebuddyInstall = path.join(appData, "Local", "Programs", "CodeBuddy CN");
    const codebuddyData = path.join(appData, "Roaming", "CodeBuddy CN");
    await fs.promises.mkdir(traeInstall, { recursive: true });
    await fs.promises.mkdir(traeData, { recursive: true });
    await fs.promises.writeFile(path.join(traeData, "token_usage.jsonl"), "{}\n", "utf8");
    await fs.promises.mkdir(codebuddyInstall, { recursive: true });
    await fs.promises.mkdir(path.join(codebuddyData, "projects", "cwd"), { recursive: true });
    await fs.promises.writeFile(path.join(codebuddyData, "projects", "cwd", "session.jsonl"), "{}\n", "utf8");

    const traeInspection = inspectDataDirectory("trae", traeInstall);
    const codebuddyInspection = inspectDataDirectory("codebuddy", codebuddyInstall);
    assert.equal(traeInspection.path, path.join(appData, "Roaming", "Trae CN"));
    assert.equal(traeInspection.status, "ready");
    assert.equal(codebuddyInspection.path, codebuddyData);
    assert.equal(codebuddyInspection.status, "ready");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("inspectDataDirectory uses the current APPDATA when the install directory is on another drive", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-cross-drive-"));
  try {
    const installRoot = path.join(tmp, "external-drive", "Users", "example", "AppData", "Local", "Programs");
    const appData = path.join(tmp, "system-drive", "Users", "example", "AppData", "Roaming");
    const traeInstall = path.join(installRoot, "Trae CN");
    const traeData = path.join(appData, "Trae CN", "ModularData", "ai-agent");
    const codebuddyInstall = path.join(installRoot, "CodeBuddy CN");
    const codebuddyData = path.join(appData, "CodeBuddy CN", "User", "globalStorage");
    await fs.promises.mkdir(traeInstall, { recursive: true });
    await fs.promises.mkdir(traeData, { recursive: true });
    await fs.promises.writeFile(path.join(traeData, "database.db"), "encrypted", "utf8");
    await fs.promises.mkdir(codebuddyInstall, { recursive: true });
    await fs.promises.mkdir(codebuddyData, { recursive: true });
    await fs.promises.writeFile(path.join(codebuddyData, "state.vscdb"), "sqlite", "utf8");

    const options = { env: { APPDATA: appData } };
    const traeInspection = inspectDataDirectory("trae", traeInstall, options);
    const codebuddyInspection = inspectDataDirectory("codebuddy", codebuddyInstall, options);
    assert.equal(traeInspection.path, path.join(appData, "Trae CN"));
    assert.equal(traeInspection.configuredPath, traeInstall);
    assert.equal(traeInspection.dataPath, path.join(appData, "Trae CN"));
    assert.equal(traeInspection.status, "detected");
    assert.equal(traeInspection.evidence, "encrypted_database");
    assert.equal(codebuddyInspection.path, path.join(appData, "CodeBuddy CN"));
    assert.equal(codebuddyInspection.configuredPath, codebuddyInstall);
    assert.equal(codebuddyInspection.dataPath, path.join(appData, "CodeBuddy CN"));
    assert.equal(codebuddyInspection.status, "detected");
    assert.equal(codebuddyInspection.evidence, "session_database");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("detectDataDirectoryPaths keeps recognized Trae and CodeBuddy stores even before exact token fields are available", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-data-dirs-recognized-"));
  try {
    const home = path.join(tmp, "Users", "example");
    const appData = path.join(home, "AppData", "Roaming");
    const localAppData = path.join(home, "AppData", "Local");
    const traeHome = path.join(appData, "Trae CN");
    const codebuddyHome = path.join(appData, "CodeBuddy CN");
    await fs.promises.mkdir(path.join(traeHome, "ModularData", "ai-agent"), { recursive: true });
    await fs.promises.writeFile(path.join(traeHome, "ModularData", "ai-agent", "database.db"), "encrypted", "utf8");
    await fs.promises.mkdir(path.join(codebuddyHome, "User", "globalStorage"), { recursive: true });
    await fs.promises.writeFile(path.join(codebuddyHome, "User", "globalStorage", "state.vscdb"), "sqlite", "utf8");

    const result = detectDataDirectoryPaths({
      home,
      env: { APPDATA: appData, LOCALAPPDATA: localAppData },
      platform: "win32",
      wslRoots: [],
      wslDistributions: [],
      detectInstallation: () => ({ installed: false, executablePath: null, currentVersion: null }),
    });

    assert.equal(result.dataDirectories.trae, traeHome);
    assert.equal(result.detected.trae.status, "detected");
    assert.equal(result.detected.trae.evidence, "encrypted_database");
    assert.equal(result.dataDirectories.codebuddy, codebuddyHome);
    assert.equal(result.detected.codebuddy.status, "detected");
    assert.equal(result.detected.codebuddy.evidence, "session_database");
    assert.equal(result.missing.includes("trae"), false);
    assert.equal(result.missing.includes("codebuddy"), false);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
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
    const opencodeHome = path.join(tmp, ".local", "share", "opencode");
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
    await fs.promises.mkdir(opencodeHome, { recursive: true });
    await fs.promises.writeFile(path.join(opencodeHome, "opencode.db"), "db", "utf8");
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
      gemini: "",
      opencode: opencodeHome,
      openclaw: "",
      codebuddy: "",
      antigravity: "",
    });
    assert.equal(result.detected.claude.evidence, "token_logs");
    assert.equal(result.detected.hermes.evidence, "state_db_exists");
    assert.deepEqual(result.missing.sort(), ["antigravity", "codebuddy", "gemini", "openclaw", "trae"].sort());
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

test("resolveDataDirectoryPaths uses detected Trae and CodeBuddy app-data roots", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-detected-app-roots-"));
  try {
    const appData = path.join(tmp, "AppData", "Roaming");
    const localAppData = path.join(tmp, "AppData", "Local");
    const traeHome = path.join(appData, "Trae CN");
    const codebuddyHome = path.join(appData, "CodeBuddy CN");
    await fs.promises.mkdir(path.join(traeHome, "ModularData", "ai-agent"), { recursive: true });
    await fs.promises.writeFile(path.join(traeHome, "ModularData", "ai-agent", "database.db"), "encrypted");
    await fs.promises.mkdir(codebuddyHome, { recursive: true });
    await fs.promises.writeFile(path.join(codebuddyHome, "codebuddy-sessions.vscdb"), "sqlite");

    const resolved = resolveDataDirectoryPaths({
      config: {
        dataDirectories: {
          trae: path.join(localAppData, "Programs", "Trae CN"),
          codebuddy: "",
        },
      },
      env: { APPDATA: appData, LOCALAPPDATA: localAppData },
      home: tmp,
      platform: "win32",
    });

    assert.equal(resolved.traeHome, traeHome);
    assert.deepEqual(resolved.traeHomes, [traeHome]);
    assert.equal(resolved.codebuddyHome, codebuddyHome);
    assert.deepEqual(resolved.codebuddyHomes, [codebuddyHome]);
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
