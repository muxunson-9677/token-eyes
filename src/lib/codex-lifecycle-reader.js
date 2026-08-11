"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FILES = 200;
const MAX_SESSIONS = 100;
const SESSION_META_READ_BYTES = 256 * 1024;
const SESSION_INDEX_READ_BYTES = 2 * 1024 * 1024;
const TAIL_READ_CHUNK_BYTES = 256 * 1024;
const MAX_PARTIAL_LINE_BYTES = 1024 * 1024;

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

function safeSessionLabel(value) {
  const text = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return text.slice(0, 80) || null;
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

function parseJsonLine(line) {
  try {
    return JSON.parse(String(line || "").replace(/\r$/u, ""));
  } catch {
    return null;
  }
}

function parseSessionMeta(line) {
  if (!line.includes('"session_meta"')) return null;
  const item = parseJsonLine(line);
  if (item?.type !== "session_meta" || !item.payload) return null;
  return {
    id: item.payload.id,
    cwd: item.payload.cwd,
    threadSource: item.payload.thread_source,
  };
}

function parseLifecycleEvidence(line) {
  if (
    !line.includes('"task_started"')
    && !line.includes('"task_complete"')
    && !line.includes('"turn_aborted"')
    && !line.includes('"error"')
    && !line.includes('"approval_request"')
  ) {
    return null;
  }
  const item = parseJsonLine(line);
  if (!item) return null;
  const type = item?.type === "event_msg" ? item?.payload?.type : item?.type;
  const status = lifecycleStatus(type);
  const timestamp = typeof item?.timestamp === "string"
    && Number.isFinite(Date.parse(item.timestamp))
    ? new Date(item.timestamp).toISOString()
    : null;
  return status && timestamp ? { status, updatedAt: timestamp } : null;
}

async function readSessionMeta(handle, fileSize) {
  const bytesToRead = Math.min(fileSize, SESSION_META_READ_BYTES);
  if (bytesToRead <= 0) return null;
  const buffer = Buffer.allocUnsafe(bytesToRead);
  const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
  const lines = buffer.subarray(0, bytesRead).toString("utf8").split(/\n/u);
  for (const line of lines) {
    const meta = parseSessionMeta(line);
    if (meta) return meta;
  }
  return null;
}

async function readLatestLifecycleEvidence(handle, fileSize) {
  let end = fileSize;
  let partial = Buffer.alloc(0);
  while (end > 0) {
    const start = Math.max(0, end - TAIL_READ_CHUNK_BYTES);
    const length = end - start;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    if (bytesRead <= 0) break;
    const combined = Buffer.concat([buffer.subarray(0, bytesRead), partial]);
    const lines = combined.toString("utf8").split(/\n/u);
    const firstCompleteLine = start === 0 ? 0 : 1;
    for (let index = lines.length - 1; index >= firstCompleteLine; index -= 1) {
      const evidence = parseLifecycleEvidence(lines[index]);
      if (evidence) return evidence;
    }
    const firstNewline = combined.indexOf(0x0a);
    partial = firstNewline >= 0 && firstNewline <= MAX_PARTIAL_LINE_BYTES
      ? combined.subarray(0, firstNewline)
      : Buffer.alloc(0);
    end = start;
  }
  return null;
}

async function readThreadTitles(home) {
  const titles = new Map();
  let handle;
  try {
    handle = await fs.promises.open(path.join(home, "session_index.jsonl"), "r");
    const stat = await handle.stat();
    const bytesToRead = Math.min(stat.size, SESSION_INDEX_READ_BYTES);
    if (bytesToRead <= 0) return titles;
    const start = stat.size - bytesToRead;
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split(/\n/u);
    if (start > 0) lines.shift();
    for (const line of lines) {
      const item = parseJsonLine(line);
      const sessionId = safeSessionId(item?.id, "");
      const title = safeSessionLabel(item?.thread_name);
      if (item?.id && title) titles.set(sessionId, title);
    }
  } catch {
    // Older Codex versions may not expose a session title index.
  } finally {
    await handle?.close().catch(() => {});
  }
  return titles;
}

async function readLifecycleFile(filePath, threadTitles) {
  let handle;
  try {
    handle = await fs.promises.open(filePath, "r");
    const stat = await handle.stat();
    const [meta, evidence] = await Promise.all([
      readSessionMeta(handle, stat.size),
      readLatestLifecycleEvidence(handle, stat.size),
    ]);
    if (!meta || meta.threadSource !== "user" || !evidence) return null;
    const project = projectMetadata(meta.cwd);
    const sessionId = safeSessionId(meta.id, filePath);
    return {
      agent: "codex",
      ...project,
      sessionId,
      sessionLabel: threadTitles.get(sessionId) || null,
      status: evidence.status,
      updatedAt: evidence.updatedAt,
    };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function collectCodexLifecycleSessions({
  homes = [],
  nowMs = Date.now(),
} = {}) {
  const cutoffMs = nowMs - LOOKBACK_MS;
  const files = [];
  const threadTitles = new Map();
  const resolvedHomes = [...new Set(homes.map((item) => path.resolve(String(item))))];
  for (const home of resolvedHomes) {
    files.push(...listRolloutFiles(home, cutoffMs));
    for (const [sessionId, title] of await readThreadTitles(home)) {
      threadTitles.set(sessionId, title);
    }
  }
  files.sort((left, right) => right.mtimeMs - left.mtimeMs);

  const sessions = [];
  for (const item of files.slice(0, MAX_FILES)) {
    const session = await readLifecycleFile(item.filePath, threadTitles);
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
