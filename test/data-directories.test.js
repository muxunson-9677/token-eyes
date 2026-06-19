const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const {
  normalizeDataDirectories,
  resolveDataDirectoryPaths,
} = require("../src/lib/data-directories");

test("normalizeDataDirectories trims known directory overrides", () => {
  assert.deepEqual(
    normalizeDataDirectories({
      claude: "  \\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude  ",
      codex: " C:\\Users\\admin\\.codex ",
      hermes: "  ",
      ignored: "x",
    }),
    {
      claude: "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude",
      codex: "C:\\Users\\admin\\.codex",
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
