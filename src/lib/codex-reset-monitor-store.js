"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STATE_FILE = "codex-reset-monitor-state.json";
const STATE_VERSION = 2;

function emptyState() {
  return {
    version: STATE_VERSION,
    lastCheckedAt: null,
    lastSuccessfulAt: null,
    windows: {},
    resetCredits: null,
    restoreCandidates: {},
    events: [],
    acknowledgedEventIds: [],
    rolloutCursor: { files: {} },
    feed: null,
  };
}

function migrateState(value) {
  if (value?.version === STATE_VERSION) return value;
  const base = emptyState();
  const events = Array.isArray(value?.events)
    ? value.events.map((event) => {
      if (event?.type !== "unexpected_quota_restore") return event;
      return {
        ...event,
        type: "manual_reset",
        agent: "codex",
        accountKey: "default",
        occurredAt: event.createdAt || null,
        observedAt: event.createdAt || null,
        source: "live_usage",
        confidence: "recovered",
        alertEligible: false,
        deliveredChannels: [],
        legacyIds: [event.id],
      };
    })
    : [];
  return {
    ...base,
    ...value,
    version: STATE_VERSION,
    resetCredits: value?.resetCredits || null,
    events,
    acknowledgedEventIds: Array.isArray(value?.acknowledgedEventIds)
      ? value.acknowledgedEventIds
      : [],
    rolloutCursor: value?.rolloutCursor?.files
      ? value.rolloutCursor
      : { files: {} },
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
      return migrateState(parsed);
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
