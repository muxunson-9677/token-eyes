"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");

const { getAgentAdapter, listAgentAdapters } = require("./agent-adapters");
const {
  detectAgentInstallation,
  inspectDataDirectory,
  resolveDataDirectoryPaths,
} = require("./data-directories");
const { detectPathKind } = require("./project-path");

const AGENT_EXECUTABLES = {
  claude: {
    win: ["claude.exe", "Claude.exe"],
    wsl: ["claude"],
  },
  codex: {
    win: ["codex.exe", "Codex.exe"],
    wsl: ["codex"],
  },
  cursor: {
    win: ["cursor.exe", "Cursor.exe"],
    wsl: ["cursor"],
  },
};

function safeExec(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      ...options,
    });
    return result ? result.trim() : "";
  } catch {
    return "";
  }
}

function findExecutableInPath(executableNames, searchDir) {
  if (!searchDir || typeof searchDir !== "string") return null;
  try {
    const dirStats = fs.statSync(searchDir);
    if (!dirStats.isDirectory()) {
      if (executableNames.includes(path.basename(searchDir))) {
        return searchDir;
      }
      return null;
    }
    const files = fs.readdirSync(searchDir);
    for (const file of files) {
      if (executableNames.includes(file)) {
        return path.join(searchDir, file);
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function detectEnvironmentForPath(dirPath, agentId = null) {
  if (!dirPath || typeof dirPath !== "string") {
    return { environment: "not-detected", status: "not-detected", executablePath: undefined };
  }

  const kind = detectPathKind(dirPath);
  const executableNames = agentId && AGENT_EXECUTABLES[agentId]
    ? AGENT_EXECUTABLES[agentId][kind === "windows" ? "win" : "wsl"]
    : [];

  if (kind === "windows") {
    try {
      const exists = fs.existsSync(dirPath);
      if (!exists) {
        return { environment: "win", status: "not-detected", executablePath: undefined };
      }

      const stat = fs.statSync(dirPath);
      let executablePath;

      if (stat.isDirectory()) {
        if (executableNames.length > 0) {
          executablePath = findExecutableInPath(executableNames, dirPath);
        }
      } else {
        if (!executableNames.length || executableNames.includes(path.basename(dirPath))) {
          executablePath = dirPath;
        }
      }

      if (!executablePath) {
        return { environment: "win", status: "not-detected", executablePath: undefined };
      }

      return { environment: "win", status: "detected", executablePath };
    } catch {
      return { environment: "win", status: "not-detected", executablePath: undefined };
    }
  }

  if (kind === "wsl") {
    try {
      const exists = fs.existsSync(dirPath);
      if (!exists) {
        return { environment: "wsl-ubuntu", status: "not-detected", executablePath: undefined };
      }

      const stat = fs.statSync(dirPath);
      let executablePath;

      if (stat.isDirectory()) {
        if (executableNames.length > 0) {
          executablePath = findExecutableInPath(executableNames, dirPath);
        }
      } else {
        if (!executableNames.length || executableNames.includes(path.basename(dirPath))) {
          executablePath = dirPath;
        }
      }

      if (!executablePath) {
        return { environment: "wsl-ubuntu", status: "not-detected", executablePath: undefined };
      }

      return { environment: "wsl-ubuntu", status: "detected", executablePath };
    } catch {
      return { environment: "wsl-ubuntu", status: "not-detected", executablePath: undefined };
    }
  }

  return { environment: "not-detected", status: "not-detected", executablePath: undefined };
}

function getWslDistributions() {
  if (process.platform !== "win32") return [];

  const output = safeExec("wsl --list --quiet");
  if (!output) return [];

  return output
    .split("\n")
    .map((line) => line.trim().replace(/\0/g, ""))
    .filter(Boolean);
}

function detectAgentEnvironment(agentId, config = {}, options = {}) {
  const adapter = getAgentAdapter(agentId);
  if (!adapter) {
    return {
      agent: agentId,
      environment: "not-detected",
      status: "not-detected",
      trackingReady: false,
      evidence: "unknown_agent",
      currentVersion: null,
      latestVersion: null,
      executablePath: undefined,
    };
  }

  const dataDirPaths = resolveDataDirectoryPaths({
    config,
    env: process.env,
    home: os.homedir(),
  });

  const detectedPath = agentId === "claude"
    ? path.dirname(dataDirPaths.claudeProjectsDir)
    : agentId === "codex"
      ? dataDirPaths.codexHome
      : agentId === "cursor"
        ? dataDirPaths.cursorHome
        : agentId === "hermes"
          ? dataDirPaths.hermesPath || ""
          : agentId === "openclaw"
            ? dataDirPaths.openclawHome
            : dataDirPaths.dataDirectories?.[adapter.pathOverrideKey] || "";
  const inspection = inspectDataDirectory(agentId, detectedPath);
  const installationDetector = options.detectInstallation || detectAgentInstallation;
  const installation = installationDetector(agentId, inspection.environment, detectedPath);
  const trackingReady = Boolean(inspection.trackingReady);
  const status = trackingReady
    ? "ready"
    : inspection.status === "detected"
      ? "detected"
      : "not-detected";

  return {
    agent: agentId,
    agent_name: adapter.displayName,
    environment: inspection.environment,
    status,
    trackingReady,
    evidence: inspection.evidence,
    evidenceCount: inspection.evidenceCount,
    latestActivityAt: inspection.latestActivityAt,
    configuredPath: detectedPath,
    dataPath: inspection.dataPath || inspection.path || detectedPath,
    currentVersion: installation?.currentVersion || null,
    latestVersion: null,
    executablePath: installation?.executablePath || undefined,
  };
}

function detectAllAgentEnvironments(config = {}, options = {}) {
  const adapters = listAgentAdapters().filter(
    (a) => a.pathOverrideKey !== null || ["claude", "codex", "cursor", "hermes", "openclaw"].includes(a.id),
  );

  return adapters.map((adapter) => detectAgentEnvironment(adapter.id, config, options));
}

module.exports = {
  detectEnvironmentForPath,
  detectAgentEnvironment,
  detectAllAgentEnvironments,
  getWslDistributions,
};
