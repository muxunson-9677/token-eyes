const os = require("node:os");
const path = require("node:path");

const DATA_DIRECTORY_KEYS = ["claude", "codex", "hermes"];

function normalizePathValue(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeDataDirectories(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  return {
    claude: normalizePathValue(input.claude),
    codex: normalizePathValue(input.codex),
    hermes: normalizePathValue(input.hermes),
  };
}

function resolveDataDirectoryPaths({ config = {}, env = process.env, home = os.homedir() } = {}) {
  const dataDirectories = normalizeDataDirectories(config.dataDirectories);
  const codexHome = dataDirectories.codex || normalizePathValue(env.CODEX_HOME) || path.join(home, ".codex");
  const codeHome = normalizePathValue(env.CODE_HOME) || path.join(home, ".code");
  const claudeHome = dataDirectories.claude || path.join(home, ".claude");

  return {
    dataDirectories,
    codexHome,
    codeHome,
    claudeProjectsDir: path.join(claudeHome, "projects"),
    hermesPath: dataDirectories.hermes || null,
  };
}

module.exports = {
  DATA_DIRECTORY_KEYS,
  normalizeDataDirectories,
  resolveDataDirectoryPaths,
};
