"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");

const WINDOW_BY_MINUTES = new Map([
  [300, "rolling_5_hour"],
  [10080, "rolling_weekly"],
]);

function cursorKey(filePath) {
  return crypto.createHash("md5").update(path.resolve(filePath), "utf8").digest("hex");
}

async function listRolloutFiles(root) {
  const files = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (
        entry.isFile()
        && entry.name.startsWith("rollout-")
        && entry.name.endsWith(".jsonl")
      ) {
        files.push(entryPath);
      }
    }
  }
  await walk(root);
  return files;
}

function toIso(value) {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function extractSnapshots(object, sinceMs) {
  const observedAt = toIso(object?.timestamp);
  if (!observedAt || Date.parse(observedAt) < sinceMs) return [];
  const payload = object?.payload?.type === "token_count"
    ? object.payload
    : object?.payload?.msg?.type === "token_count"
      ? object.payload.msg
      : null;
  const rateLimits = payload?.rate_limits;
  if (rateLimits?.limit_id !== "codex") return [];

  const snapshots = [];
  for (const lane of [rateLimits.primary, rateLimits.secondary]) {
    if (!lane || typeof lane !== "object" || Array.isArray(lane)) continue;
    const window = WINDOW_BY_MINUTES.get(Number(lane.window_minutes));
    const usedPercent = Number(lane.used_percent);
    const resetAt = toIso(lane.resets_at);
    if (
      !window
      || !Number.isFinite(usedPercent)
      || usedPercent < 0
      || usedPercent > 100
      || !resetAt
    ) {
      continue;
    }
    snapshots.push({
      observedAt,
      window,
      usedPercent: Math.round(usedPercent),
      resetAt,
      accountKey: null,
      source: "codex_rollout",
    });
  }
  return snapshots;
}

async function readNewSnapshots(filePath, start, sinceMs) {
  const snapshots = [];
  const input = fs.createReadStream(filePath, {
    encoding: "utf8",
    ...(start > 0 ? { start } : {}),
  });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes("\"token_count\"") || !line.includes("\"rate_limits\"")) continue;
    try {
      snapshots.push(...extractSnapshots(JSON.parse(line), sinceMs));
    } catch (_error) {
      // A malformed rollout line is ignored without retaining its content.
    }
  }
  return snapshots;
}

async function collectCodexResetSnapshots({
  codexHomes,
  sinceMs,
  cursor = { files: {} },
}) {
  const safeSinceMs = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : 0;
  const roots = Array.isArray(codexHomes) ? codexHomes : [];
  const uniqueFiles = new Set();
  for (const home of roots) {
    if (typeof home !== "string" || !home) continue;
    for (const folder of ["sessions", "archived_sessions"]) {
      for (const filePath of await listRolloutFiles(path.join(home, folder))) {
        uniqueFiles.add(path.resolve(filePath));
      }
    }
  }

  const snapshots = [];
  const nextCursor = { files: {} };
  for (const filePath of [...uniqueFiles].sort((a, b) => a.localeCompare(b))) {
    const stat = await fsp.stat(filePath);
    const key = cursorKey(filePath);
    const previousOffset = Number(cursor?.files?.[key]?.offset);
    const start = Number.isSafeInteger(previousOffset)
      && previousOffset >= 0
      && previousOffset <= stat.size
      ? previousOffset
      : 0;
    if (start < stat.size) {
      snapshots.push(...await readNewSnapshots(filePath, start, safeSinceMs));
    }
    nextCursor.files[key] = {
      offset: stat.size,
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
    };
  }
  snapshots.sort((left, right) => (
    Date.parse(left.observedAt) - Date.parse(right.observedAt)
    || left.window.localeCompare(right.window)
  ));
  return { snapshots, cursor: nextCursor };
}

module.exports = {
  collectCodexResetSnapshots,
};
