const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { listDataDirectoryAdapterKeys } = require("./agent-adapters");

const DATA_DIRECTORY_KEYS = listDataDirectoryAdapterKeys();

function normalizePathValue(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeDataDirectories(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const normalized = {};
  for (const key of DATA_DIRECTORY_KEYS) {
    normalized[key] = normalizePathValue(input[key]);
  }
  return normalized;
}

function pathKey(value) {
  return normalizePathValue(value).toLowerCase();
}

function defaultWindowsDriveRoots() {
  if (process.platform !== "win32") return [];
  const roots = [];
  for (let code = 65; code <= 90; code += 1) {
    roots.push(`${String.fromCharCode(code)}:\\`);
  }
  return roots;
}

function isCurrentUserHome(home) {
  return pathKey(home) === pathKey(os.homedir());
}

function windowsAgentDataCodexCandidates({ env = process.env, home = os.homedir(), platform = process.platform, windowsDriveRoots = null } = {}) {
  if (platform !== "win32") return [];
  const roots = [];
  const rawAgentDataRoots = normalizePathValue(env.TOKENTRACKER_AGENTDATA_ROOTS);
  if (rawAgentDataRoots) {
    roots.push(...rawAgentDataRoots.split(";").map((value) => value.trim()).filter(Boolean));
  }
  const rawAgentData = normalizePathValue(env.AGENTDATA);
  if (rawAgentData) roots.push(rawAgentData);

  const scanDefaultDrives = !Array.isArray(windowsDriveRoots) && isCurrentUserHome(home);
  const driveRoots = Array.isArray(windowsDriveRoots) ? windowsDriveRoots : scanDefaultDrives ? defaultWindowsDriveRoots() : [];
  for (const root of driveRoots) {
    const normalizedRoot = normalizePathValue(root);
    if (!normalizedRoot) continue;
    roots.push(path.join(normalizedRoot, "AgentData"));
  }

  const homeRoot = path.parse(home || "").root;
  if (homeRoot && (Array.isArray(windowsDriveRoots) || isCurrentUserHome(home))) {
    roots.push(path.join(homeRoot, "AgentData"));
  }

  return uniquePaths(roots.map((root) => {
    const tail = path.basename(root).toLowerCase();
    return tail === "codex" ? root : path.join(root, "Codex");
  }));
}

function listCodexHomeCandidates({ configured, env = process.env, home = os.homedir(), platform = process.platform, windowsDriveRoots = null } = {}) {
  const defaultCodex = path.join(home, ".codex");
  const configuredCodex = normalizePathValue(configured);
  return uniquePaths([
    configuredCodex,
    normalizePathValue(env.CODEX_HOME),
    defaultCodex,
    ...windowsAgentDataCodexCandidates({ env, home, platform, windowsDriveRoots }),
  ]);
}

function listTrackingReadyCodexHomes({ configured, env = process.env, home = os.homedir(), platform = process.platform, windowsDriveRoots = null } = {}) {
  return listCodexHomeCandidates({ configured, env, home, platform, windowsDriveRoots })
    .map((candidate) => inspectDataDirectory("codex", candidate))
    .filter((candidate) => candidate.trackingReady)
    .sort((a, b) => Date.parse(b.latestActivityAt || 0) - Date.parse(a.latestActivityAt || 0))
    .map((candidate) => candidate.path);
}

function pickBestCodexHome({ configured, env = process.env, home = os.homedir(), platform = process.platform, windowsDriveRoots = null } = {}) {
  const defaultCodex = path.join(home, ".codex");
  const envCodex = normalizePathValue(env.CODEX_HOME);
  const configuredCodex = normalizePathValue(configured);
  const fallback = configuredCodex || envCodex || defaultCodex;
  const configuredIsDefault = configuredCodex && pathKey(configuredCodex) === pathKey(defaultCodex);

  if (configuredCodex && !configuredIsDefault) {
    return configuredCodex;
  }

  if (envCodex) return envCodex;

  const ready = listTrackingReadyCodexHomes({ configured, env, home, platform, windowsDriveRoots });
  return ready[0] || fallback;
}

function resolveDataDirectoryPaths({ config = {}, env = process.env, home = os.homedir(), platform = process.platform, windowsDriveRoots = null } = {}) {
  const dataDirectories = normalizeDataDirectories(config.dataDirectories);
  const codexHome = pickBestCodexHome({
    configured: dataDirectories.codex,
    env,
    home,
    platform,
    windowsDriveRoots,
  });
  const codexHomes = listTrackingReadyCodexHomes({
    configured: dataDirectories.codex,
    env,
    home,
    platform,
    windowsDriveRoots,
  });
  const codeHome = normalizePathValue(env.CODE_HOME) || path.join(home, ".code");
  const claudeHome = dataDirectories.claude || path.join(home, ".claude");
  const cursorHome = dataDirectories.cursor || normalizePathValue(env.CURSOR_HOME) || null;
  const cursorHomes = listTrackingReadyCursorHomes({
    configured: dataDirectories.cursor,
    env,
    home,
    platform,
  });
  const traeHome = dataDirectories.trae || normalizePathValue(env.TRAE_HOME) || null;
  const traeHomes = listTrackingReadyTraeHomes({
    configured: dataDirectories.trae,
    env,
    home,
    platform,
  });
  const xdgDataHome = normalizePathValue(env.XDG_DATA_HOME) || path.join(home, ".local", "share");
  const opencodeHome = dataDirectories.opencode
    || normalizePathValue(env.OPENCODE_HOME)
    || path.join(xdgDataHome, "opencode");
  const openclawHome = dataDirectories.openclaw || normalizePathValue(env.OPENCLAW_HOME) || path.join(home, ".openclaw");

  return {
    dataDirectories,
    codexHome,
    codexHomes,
    codeHome,
    claudeProjectsDir: path.join(claudeHome, "projects"),
    hermesPath: dataDirectories.hermes || null,
    cursorHome: cursorHomes[0] || cursorHome,
    cursorHomes,
    traeHome: traeHomes[0] || traeHome,
    traeHomes,
    opencodeHome,
    openclawHome,
  };
}

function isDirectory(candidate) {
  if (!candidate) return false;
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function fileStat(candidate) {
  if (!candidate) return null;
  try {
    const stat = fs.statSync(candidate);
    return stat.isFile() && stat.size > 0 ? stat : null;
  } catch {
    return null;
  }
}

function listDirectories(parent) {
  try {
    return fs.readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name));
  } catch {
    return [];
  }
}

function findWslHomes(wslRoots) {
  const homes = [];
  for (const root of wslRoots) {
    for (const distroPath of listDirectories(root)) {
      homes.push(...listDirectories(path.join(distroPath, "home")));
    }
  }
  return homes;
}

function listWslDistributions() {
  const output = safeExecFile("wsl.exe", ["--list", "--quiet"]);
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, "").trim())
    .filter(Boolean);
}

function findWslHomesFromDistributions(wslRoots, distroNames) {
  const homes = [];
  for (const root of wslRoots) {
    for (const distro of distroNames) {
      homes.push(...listDirectories(path.join(root, distro, "home")));
    }
  }
  return homes;
}

function dataPathEnvironment(candidate) {
  return /^\\\\wsl(?:\.localhost|\$)\\/i.test(candidate || "") ? "wsl-ubuntu" : "win";
}

function findEvidenceFiles(root, { extension = "", fileName = "", maxDepth = 4 } = {}) {
  if (!isDirectory(root)) return { count: 0, latestMs: 0 };
  const pending = [{ directory: root, depth: 0 }];
  let count = 0;
  let latestMs = 0;
  while (pending.length > 0 && count < 10_000) {
    const { directory, depth } = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory() && depth < maxDepth) {
        pending.push({ directory: fullPath, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (fileName && entry.name !== fileName) continue;
      if (extension && !entry.name.toLowerCase().endsWith(extension)) continue;
      const stat = fileStat(fullPath);
      if (!stat) continue;
      count += 1;
      latestMs = Math.max(latestMs, stat.mtimeMs);
    }
  }
  return { count, latestMs };
}

function inspectDataDirectory(agentId, directoryPath) {
  const normalizedPath = normalizePathValue(directoryPath);
  const environment = dataPathEnvironment(normalizedPath);
  if (!isDirectory(normalizedPath)) {
    return {
      path: normalizedPath,
      environment,
      status: "not-detected",
      trackingReady: false,
      evidence: "path_missing",
      evidenceCount: 0,
      latestActivityAt: null,
    };
  }

  let recognized = false;
  let evidence = "directory_only";
  let result = { count: 0, latestMs: 0 };
  if (agentId === "claude") {
    const projectsDir = path.join(normalizedPath, "projects");
    recognized = isDirectory(projectsDir);
    result = findEvidenceFiles(projectsDir, { extension: ".jsonl", maxDepth: 3 });
    evidence = result.count > 0 ? "token_logs" : "projects_directory";
  } else if (agentId === "codex") {
    const sessionsDir = path.join(normalizedPath, "sessions");
    const archivedDir = path.join(normalizedPath, "archived_sessions");
    recognized = isDirectory(sessionsDir) || isDirectory(archivedDir);
    const sessions = findEvidenceFiles(sessionsDir, { extension: ".jsonl", maxDepth: 5 });
    const archived = findEvidenceFiles(archivedDir, { extension: ".jsonl", maxDepth: 5 });
    result = {
      count: sessions.count + archived.count,
      latestMs: Math.max(sessions.latestMs, archived.latestMs),
    };
    evidence = result.count > 0 ? "token_logs" : "sessions_directory";
  } else if (agentId === "hermes") {
    const rootDb = fileStat(path.join(normalizedPath, "state.db"));
    const profileDbs = findEvidenceFiles(path.join(normalizedPath, "profiles"), {
      fileName: "state.db",
      maxDepth: 2,
    });
    recognized = Boolean(rootDb) || isDirectory(path.join(normalizedPath, "profiles"));
    result = {
      count: (rootDb ? 1 : 0) + profileDbs.count,
      latestMs: Math.max(rootDb?.mtimeMs || 0, profileDbs.latestMs),
    };
    evidence = result.count > 0 ? "state_db_exists" : "hermes_directory";
  } else if (agentId === "cursor") {
    const stateDb = fileStat(path.join(normalizedPath, "User", "globalStorage", "state.vscdb"));
    recognized = isDirectory(path.join(normalizedPath, "User", "globalStorage"));
    result = { count: stateDb ? 1 : 0, latestMs: stateDb?.mtimeMs || 0 };
    evidence = result.count > 0 ? "account_state_db" : "cursor_state_directory";
  } else if (agentId === "trae") {
    const agentDir = path.join(normalizedPath, "ModularData", "ai-agent");
    const encryptedDb = fileStat(path.join(agentDir, "database.db"));
    const decryptedDb = fileStat(path.join(agentDir, "database_decrypted.db"));
    const tokenJsonl = fileStat(path.join(agentDir, "token_usage.jsonl"));
    recognized = isDirectory(agentDir) || Boolean(encryptedDb) || Boolean(decryptedDb) || Boolean(tokenJsonl);
    const latestMs = Math.max(
      encryptedDb?.mtimeMs || 0,
      decryptedDb?.mtimeMs || 0,
      tokenJsonl?.mtimeMs || 0,
    );
    const count = (encryptedDb ? 1 : 0) + (decryptedDb ? 1 : 0) + (tokenJsonl ? 1 : 0);
    result = { count, latestMs };
    evidence = decryptedDb || tokenJsonl ? "token_logs" : encryptedDb ? "encrypted_database" : "trae_directory";
  } else if (agentId === "opencode") {
    const database = fileStat(path.join(normalizedPath, "opencode.db"));
    const databaseWal = fileStat(path.join(normalizedPath, "opencode.db-wal"));
    const messageDir = path.join(normalizedPath, "storage", "message");
    const messages = findEvidenceFiles(messageDir, { extension: ".json", maxDepth: 4 });
    recognized = Boolean(database) || Boolean(databaseWal) || isDirectory(messageDir);
    result = {
      count: (database ? 1 : 0) + (databaseWal ? 1 : 0) + messages.count,
      latestMs: Math.max(database?.mtimeMs || 0, databaseWal?.mtimeMs || 0, messages.latestMs),
    };
    evidence = messages.count > 0
      ? "token_logs"
      : database || databaseWal
        ? "opencode_database"
        : "opencode_storage";
  } else if (agentId === "openclaw") {
    const agentsDir = path.join(normalizedPath, "agents");
    recognized = Boolean(fileStat(path.join(normalizedPath, "openclaw.json"))) || isDirectory(agentsDir);
    result = findEvidenceFiles(agentsDir, { extension: ".jsonl", maxDepth: 4 });
    evidence = result.count > 0 ? "token_logs" : "openclaw_config";
  }

  const trackingReady = result.count > 0;
  return {
    path: normalizedPath,
    environment,
    status: trackingReady ? "ready" : recognized ? "detected" : "not-detected",
    trackingReady,
    evidence,
    evidenceCount: result.count,
    latestActivityAt: result.latestMs > 0 ? new Date(result.latestMs).toISOString() : null,
  };
}

const AGENT_COMMANDS = Object.freeze({
  claude: "claude",
  codex: "codex",
  cursor: "cursor",
  opencode: "opencode",
  openclaw: "openclaw",
  hermes: "hermes",
});

function safeExecFile(command, args) {
  try {
    return String(execFileSync(command, args, {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }) || "").trim();
  } catch {
    return "";
  }
}

function pickWindowsExecutablePath(whereOutput) {
  const paths = String(whereOutput || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return paths.find((candidate) => /\.(exe|cmd|bat)$/i.test(candidate)) || paths[0] || "";
}

function detectAgentInstallation(agentId, environment, directoryPath) {
  const command = AGENT_COMMANDS[agentId];
  if (!command) return { installed: false, executablePath: null, currentVersion: null };

  if (environment === "wsl-ubuntu") {
    const distro = normalizePathValue(directoryPath).match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)/i)?.[1];
    if (!distro) return { installed: false, executablePath: null, currentVersion: null };
    const executablePath = safeExecFile("wsl.exe", ["-d", distro, "--", "sh", "-lc", `command -v ${command}`]);
    if (!executablePath) return { installed: false, executablePath: null, currentVersion: null };
    const currentVersion = safeExecFile("wsl.exe", ["-d", distro, "--", "sh", "-lc", `${command} --version`]);
    return { installed: true, executablePath, currentVersion: currentVersion || null };
  }

  const executablePath = pickWindowsExecutablePath(safeExecFile("where.exe", [command]));
  if (!executablePath) return { installed: false, executablePath: null, currentVersion: null };
  return { installed: true, executablePath, currentVersion: null };
}

function defaultCursorAppDir({ env, home, platform }) {
  if (platform === "win32") {
    return path.join(normalizePathValue(env.APPDATA) || path.join(home, "AppData", "Roaming"), "Cursor");
  }
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Cursor");
  return path.join(normalizePathValue(env.XDG_CONFIG_HOME) || path.join(home, ".config"), "Cursor");
}

function defaultTraeAppDirs({ env, home, platform }) {
  const dirs = [];
  if (platform === "win32") {
    const appData = normalizePathValue(env.APPDATA) || path.join(home, "AppData", "Roaming");
    const localAppData = normalizePathValue(env.LOCALAPPDATA) || path.join(home, "AppData", "Local");
    for (const name of ["Trae CN", "Trae", "TRAE SOLO CN"]) {
      dirs.push(path.join(appData, name));
      dirs.push(path.join(localAppData, name));
    }
    dirs.push(path.join(localAppData, "Programs", "Trae CN"));
    dirs.push(path.join(localAppData, "Programs", "Trae"));
  } else if (platform === "darwin") {
    const base = path.join(home, "Library", "Application Support");
    dirs.push(path.join(base, "Trae CN"), path.join(base, "Trae"));
  } else {
    const xdg = normalizePathValue(env.XDG_CONFIG_HOME) || path.join(home, ".config");
    dirs.push(path.join(xdg, "Trae CN"), path.join(xdg, "Trae"));
  }
  return dirs;
}

function listCursorHomeCandidates({ configured, env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const candidates = [
    configured,
    normalizePathValue(env.CURSOR_HOME),
    defaultCursorAppDir({ env, home, platform }),
  ];
  if (platform === "win32") {
    const localAppData = normalizePathValue(env.LOCALAPPDATA) || path.join(home, "AppData", "Local");
    candidates.push(path.join(localAppData, "Cursor"));
  }
  return uniquePaths(candidates);
}

function listTrackingReadyCursorHomes(options = {}) {
  return listCursorHomeCandidates(options)
    .map((candidate) => inspectDataDirectory("cursor", candidate))
    .filter((candidate) => candidate.trackingReady)
    .sort((a, b) => Date.parse(b.latestActivityAt || 0) - Date.parse(a.latestActivityAt || 0))
    .map((candidate) => candidate.path);
}

function listTraeHomeCandidates({ configured, env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  return uniquePaths([
    configured,
    normalizePathValue(env.TRAE_HOME),
    ...defaultTraeAppDirs({ env, home, platform }),
  ]);
}

function listTrackingReadyTraeHomes(options = {}) {
  return listTraeHomeCandidates(options)
    .map((candidate) => inspectDataDirectory("trae", candidate))
    .filter((candidate) => candidate.trackingReady)
    .sort((a, b) => Date.parse(b.latestActivityAt || 0) - Date.parse(a.latestActivityAt || 0))
    .map((candidate) => candidate.path);
}

function uniquePaths(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = normalizePathValue(value);
    if (!normalized) return false;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detectDataDirectoryPaths({
  config = {},
  env = process.env,
  home = os.homedir(),
  platform = process.platform,
  windowsDriveRoots = null,
  wslRoots = ["\\\\wsl.localhost", "\\\\wsl$"],
  wslDistributions = null,
  detectInstallation = detectAgentInstallation,
} = {}) {
  const configured = normalizeDataDirectories(config.dataDirectories);
  const candidates = {
    claude: [configured.claude, normalizePathValue(env.CLAUDE_HOME), path.join(home, ".claude")],
    codex: [
      configured.codex,
      normalizePathValue(env.CODEX_HOME),
      path.join(home, ".codex"),
      ...windowsAgentDataCodexCandidates({ env, home, platform, windowsDriveRoots }),
    ],
    hermes: [
      configured.hermes,
      normalizePathValue(env.TOKENTRACKER_HERMES_HOME),
      platform === "win32" && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "hermes") : "",
      path.join(home, ".hermes"),
    ],
    cursor: [configured.cursor, normalizePathValue(env.CURSOR_HOME), defaultCursorAppDir({ env, home, platform })],
    trae: [configured.trae, normalizePathValue(env.TRAE_HOME), ...defaultTraeAppDirs({ env, home, platform })],
    opencode: [
      configured.opencode,
      normalizePathValue(env.OPENCODE_HOME),
      path.join(normalizePathValue(env.XDG_DATA_HOME) || path.join(home, ".local", "share"), "opencode"),
    ],
    openclaw: [configured.openclaw, normalizePathValue(env.OPENCLAW_HOME), path.join(home, ".openclaw")],
  };

  if (platform === "win32") {
    const distroNames = Array.isArray(wslDistributions) ? wslDistributions : listWslDistributions();
    const wslHomes = uniquePaths([
      ...findWslHomes(wslRoots),
      ...findWslHomesFromDistributions(wslRoots, distroNames),
    ]);
    for (const wslHome of wslHomes) {
      candidates.claude.push(path.join(wslHome, ".claude"));
      candidates.codex.push(path.join(wslHome, ".codex"));
      candidates.hermes.push(path.join(wslHome, ".hermes"));
      candidates.cursor.push(path.join(wslHome, ".config", "Cursor"));
      candidates.trae.push(path.join(wslHome, ".config", "Trae CN"));
      candidates.opencode.push(path.join(wslHome, ".local", "share", "opencode"));
      candidates.openclaw.push(path.join(wslHome, ".openclaw"));
    }
  }

  const detectedPaths = {};
  const detected = {};
  const missing = [];
  for (const key of DATA_DIRECTORY_KEYS) {
    const configuredPath = normalizePathValue(configured[key]);
    const configuredKey = configuredPath ? configuredPath.toLowerCase() : "";
    const configuredIsDefaultCodex = key === "codex" && configuredKey === pathKey(path.join(home, ".codex"));
    const inspected = uniquePaths(candidates[key] || [])
      .map((candidate) => {
        const inspection = inspectDataDirectory(key, candidate);
        const installation = detectInstallation(key, inspection.environment, candidate);
        const candidateKey = normalizePathValue(candidate).toLowerCase();
        const isConfigured = Boolean(configuredKey && candidateKey === configuredKey);
        return {
          ...inspection,
          ...installation,
          configured: isConfigured,
          configuredPriority: isConfigured && !configuredIsDefaultCodex,
        };
      })
      .filter((candidate) => candidate.trackingReady || (candidate.installed && candidate.status !== "not-detected"))
      .sort((a, b) => {
        const configuredFirst = Number(b.configuredPriority) - Number(a.configuredPriority);
        if (configuredFirst !== 0) return configuredFirst;
        const readiness = Number(b.trackingReady) - Number(a.trackingReady);
        if (readiness !== 0) return readiness;
        const installed = Number(b.installed) - Number(a.installed);
        if (installed !== 0) return installed;
        return Date.parse(b.latestActivityAt || 0) - Date.parse(a.latestActivityAt || 0);
      });
    const best = inspected[0];
    if (!best) {
      detectedPaths[key] = "";
      missing.push(key);
      continue;
    }
    detectedPaths[key] = best.path;
    const { configured: _configured, configuredPriority: _configuredPriority, ...publicBest } = best;
    detected[key] = publicBest;
  }

  const dataDirectories = normalizeDataDirectories(detectedPaths);
  return { dataDirectories, detected, missing };
}

module.exports = {
  DATA_DIRECTORY_KEYS,
  detectAgentInstallation,
  detectDataDirectoryPaths,
  inspectDataDirectory,
  listCodexHomeCandidates,
  listTrackingReadyCodexHomes,
  listCursorHomeCandidates,
  listTrackingReadyCursorHomes,
  listTraeHomeCandidates,
  listTrackingReadyTraeHomes,
  normalizeDataDirectories,
  pickBestCodexHome,
  resolveDataDirectoryPaths,
};
