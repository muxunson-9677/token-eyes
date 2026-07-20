"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STATE_FILE = "codex-reset-monitor-state.json";

function emptyState() {
  return {
    version: 1,
    lastCheckedAt: null,
    lastSuccessfulAt: null,
    windows: {},
    restoreCandidates: {},
    events: [],
    acknowledgedEventIds: [],
  };
}

function resolveCodexResetMonitorStatePath(trackerDataDir) {
  if (typeof trackerDataDir !== "string" || trackerDataDir.length === 0) {
    throw new TypeError("trackerDataDir is required");
  }
  return path.join(path.resolve(trackerDataDir), STATE_FILE);
}

function quarantineSuffix(nowMs) {
  return new Date(nowMs).toISOString().replace(/[:.]/g, "-");
}

function createCodexResetMonitorStore({
  trackerDataDir,
  fsImpl = fs,
  now = Date.now,
}) {
  const statePath = resolveCodexResetMonitorStatePath(trackerDataDir);

  function ensureDirectory() {
    fsImpl.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  }

  function load() {
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(statePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new TypeError("invalid monitor state");
      }
      return parsed;
    } catch (error) {
      if (error?.code === "ENOENT") return emptyState();
      ensureDirectory();
      try {
        fsImpl.renameSync(
          statePath,
          `${statePath}.corrupt.${quarantineSuffix(now())}`,
        );
      } catch (renameError) {
        if (renameError?.code !== "ENOENT") throw renameError;
      }
      return emptyState();
    }
  }

  function save(state) {
    ensureDirectory();
    const tempPath = `${statePath}.tmp.${process.pid}.${now()}`;
    try {
      fsImpl.writeFileSync(
        tempPath,
        `${JSON.stringify(state, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      fsImpl.renameSync(tempPath, statePath);
    } finally {
      try {
        fsImpl.rmSync(tempPath, { force: true });
      } catch (_error) {
        // The atomic rename normally removes the temporary path.
      }
    }
  }

  return { load, save, statePath };
}

module.exports = {
  createCodexResetMonitorStore,
  resolveCodexResetMonitorStatePath,
};
