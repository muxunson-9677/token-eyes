"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FILES = 200;
const MAX_SESSIONS = 100;

function hashId(prefix, value) {
  return `${prefix}-${crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, 12)}`;
}

function safeSessionId(value, fallback) {
  const text = String(value || "").trim();
  if (/^[a-z0-9][a-z0-9._-]{0,95}$/iu.test(text)) return text;
  return hashId("session", text || fallback);
}

function projectMetadata(cwd) {
  const text = String(cwd || "").trim().replace(/[\\/]+$/u, "");
  const label = text.split(/[\\/]/u).filter(Boolean).at(-1) || "Unknown project";
  return {
    projectId: hashId("project", text.toLowerCase()),
    projectLabel: label.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 80),
  };
}

function listRolloutFiles(home, cutoffMs) {
  const output = [];
  for (const folder of ["sessions", "archived_sessions"]) {
    const root = path.join(home, folder);
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile() || !/^rollout-.*\.jsonl$/iu.test(entry.name)) continue;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs >= cutoffMs) {
            output.push({ filePath: fullPath, mtimeMs: stat.mtimeMs });
          }
        } catch {
          // A rollout can disappear while Codex archives it.
        }
      }
    }
  }
  return output;
}

function lifecycleStatus(type) {
  if (type === "task_started") return "running";
  if (type === "task_complete") return "completed";
  if (type === "turn_aborted") return "interrupted";
  if (type === "error") return "error";
  if (type === "approval_request" || type === "exec_approval_request") {
    return "waiting_approval";
  }
  return null;
}

async function readLifecycleFile(filePath) {
  let meta = null;
  let status = "unknown";
  let updatedAt = null;
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (
        !line.includes('"session_meta"')
        && !line.includes('"task_started"')
        && !line.includes('"task_complete"')
        && !line.includes('"turn_aborted"')
        && !line.includes('"error"')
        && !line.includes('"approval_request"')
      ) {
        continue;
      }
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        continue;
      }
      const timestamp = typeof item?.timestamp === "string"
        && Number.isFinite(Date.parse(item.timestamp))
        ? new Date(item.timestamp).toISOString()
        : null;
      if (item?.type === "session_meta" && item.payload) {
        meta = {
          id: item.payload.id,
          cwd: item.payload.cwd,
        };
        continue;
      }
      const type = item?.type === "event_msg" ? item?.payload?.type : item?.type;
      const nextStatus = lifecycleStatus(type);
      if (nextStatus && timestamp) {
        status = nextStatus;
        updatedAt = timestamp;
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (!meta || !updatedAt) return null;
  const project = projectMetadata(meta.cwd);
  const sessionId = safeSessionId(meta.id, filePath);
  return {
    agent: "codex",
    ...project,
    sessionId,
    sessionLabel: sessionId,
    status,
    updatedAt,
  };
}

async function collectCodexLifecycleSessions({
  homes = [],
  nowMs = Date.now(),
} = {}) {
  const cutoffMs = nowMs - LOOKBACK_MS;
  const files = [];
  for (const home of [...new Set(homes.map((item) => path.resolve(String(item))))]) {
    files.push(...listRolloutFiles(home, cutoffMs));
  }
  files.sort((left, right) => right.mtimeMs - left.mtimeMs);

  const sessions = [];
  for (const item of files.slice(0, MAX_FILES)) {
    const session = await readLifecycleFile(item.filePath);
    if (session) sessions.push(session);
    if (sessions.length >= MAX_SESSIONS) break;
  }
  return sessions.sort((left, right) => (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  ));
}

module.exports = {
  collectCodexLifecycleSessions,
};
