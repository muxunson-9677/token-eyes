const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  detectDataDirectoryPaths,
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
      openclaw: "D:\\openclaw",
      hermes: "",
    },
  );
});

test("resolveDataDirectoryPaths keeps TokenTracker defaults when overrides are empty", () => {
  const home = path.join("C:", "Users", "example");
  const resolved = resolveDataDirectoryPaths({ config: { dataDirectories: {} }, env: {}, home });

  assert.equal(resolved.codexHome, path.join(home, ".codex"));
  assert.equal(resolved.codeHome, path.join(home, ".code"));
  assert.equal(resolved.claudeProjectsDir, path.join(home, ".claude", "projects"));
  assert.equal(resolved.hermesPath, null);
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
      openclaw: "",
    });
    assert.equal(result.detected.claude.evidence, "token_logs");
    assert.equal(result.detected.hermes.evidence, "state_db_exists");
    assert.deepEqual(result.missing, ["openclaw"]);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
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
