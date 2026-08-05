"use strict";

const crypto = require("node:crypto");

const WIDGET_AGENTS = Object.freeze(["all", "claude", "codex", "cursor", "hermes"]);
const STATUS_ORDER = Object.freeze({
  red: 0,
  yellow: 1,
  green: 2,
  stopped: 3,
  unknown: 4,
});
const WINDOW_ORDER = Object.freeze({
  "5h": 0,
  "7d": 1,
  monthly: 2,
  "自动与 Composer": 3,
  API: 4,
  "快速请求": 5,
});
const PROVIDER_NAMES = Object.freeze({
  aliyun_bailian: "阿里云百炼",
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  glm: "GLM",
  hermes: "Hermes",
  kimi: "Kimi",
  minimax: "MiniMax",
  trae: "TRAE",
  xiaomi_mimo: "小米 MiMo",
});
const ACTIVE_SESSION_WINDOWS_MS = Object.freeze({
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "5h": 5 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
});
const MAX_ACTIVE_SESSIONS = 10;
const MAX_RECENT_PROJECTS = 10;

function agentKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "every-code") return "codex";
  return normalized;
}

function safeId(value, prefix) {
  const text = String(value || "").trim();
  if (/^[a-z0-9][a-z0-9:._-]{0,95}$/iu.test(text)) return text;
  return `${prefix}-${crypto.createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
}

function safeLabel(value, fallback) {
  const parts = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .split(/[\\/]/u)
    .filter(Boolean);
  const label = String(parts.at(-1) || fallback || "").trim();
  return label.slice(0, 80) || String(fallback || "").slice(0, 80);
}

function optionalLabel(value) {
  const label = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return label.slice(0, 80) || null;
}

function safeNote(value) {
  const note = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return note.slice(0, 200) || null;
}

function finiteNonNegative(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function usedPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  return Math.round(numeric);
}

function safeIso(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function sessionState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["approval", "waiting_approval"].includes(normalized)) return "waiting_approval";
  if (normalized === "error") return "error";
  if (["interrupted", "aborted"].includes(normalized)) return "stopped";
  if (["running", "task_started"].includes(normalized)) return "running";
  if (["completed", "task_complete"].includes(normalized)) return "completed";
  return "unknown";
}

function statusKey(value) {
  const state = sessionState(value);
  if (state === "waiting_approval" || state === "error") return "red";
  if (state === "running") return "yellow";
  if (state === "completed") return "green";
  if (state === "stopped") return "stopped";
  return "unknown";
}

function buildProjectStatus(sessions, selectedAgent, nowMs, activeSessionWindow) {
  const activeWindowMs = ACTIVE_SESSION_WINDOWS_MS[activeSessionWindow]
    || ACTIVE_SESSION_WINDOWS_MS["1h"];
  const projects = new Map();
  const newestSessions = new Map();
  for (const item of Array.isArray(sessions) ? sessions : []) {
    const key = `${agentKey(item?.agent)}:${safeId(item?.sessionId, "session")}`;
    const previous = newestSessions.get(key);
    if (
      !previous
      || Date.parse(item?.updatedAt || 0) > Date.parse(previous?.updatedAt || 0)
    ) {
      newestSessions.set(key, item);
    }
  }
  const eligibleSessions = Array.from(newestSessions.values())
    .filter((item) => {
      const itemAgent = agentKey(item?.agent);
      const updatedAt = Date.parse(item?.updatedAt || "");
      return (selectedAgent === "all" || itemAgent === selectedAgent)
        && Number.isFinite(updatedAt)
        && updatedAt <= nowMs;
    })
    .sort((left, right) => (
      Date.parse(right?.updatedAt || 0) - Date.parse(left?.updatedAt || 0)
    ));
  const recentProjectIds = new Set();
  const recentProjects = [];
  for (const item of eligibleSessions) {
    const projectId = safeId(item?.projectId, "project");
    if (recentProjectIds.has(projectId)) continue;
    recentProjectIds.add(projectId);
    recentProjects.push({
      id: projectId,
      label: safeLabel(item?.projectLabel, projectId),
      updatedAt: safeIso(item?.updatedAt),
    });
    if (recentProjects.length >= MAX_RECENT_PROJECTS) break;
  }
  const activeSessions = eligibleSessions
    .filter((item) => Date.parse(item?.updatedAt || 0) >= nowMs - activeWindowMs)
    .slice(0, MAX_ACTIVE_SESSIONS);

  for (const item of activeSessions) {
    const projectId = safeId(item?.projectId, "project");
    if (!projects.has(projectId)) {
      projects.set(projectId, {
        id: projectId,
        label: safeLabel(item?.projectLabel, projectId),
        red: 0,
        yellow: 0,
        green: 0,
        unknown: 0,
        sessions: [],
      });
    }
    const project = projects.get(projectId);
    const status = statusKey(item?.status);
    const state = sessionState(item?.status);
    if (status === "stopped") project.unknown += 1;
    else project[status] += 1;
    const sessionId = safeId(item?.sessionId, "session");
    project.sessions.push({
      id: sessionId,
      label: optionalLabel(item?.sessionLabel),
      status,
      state,
      updatedAt: safeIso(item?.updatedAt),
    });
  }

  const output = {
    red: 0,
    yellow: 0,
    green: 0,
    unknown: 0,
    recentProjects,
    projects: Array.from(projects.values()),
  };
  for (const project of output.projects) {
    output.red += project.red;
    output.yellow += project.yellow;
    output.green += project.green;
    output.unknown += project.unknown;
    project.sessions.sort((left, right) => (
      STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
      || Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)
      || left.id.localeCompare(right.id)
    ));
  }
  output.projects.sort((left, right) => (
    Number(right.red > 0) - Number(left.red > 0)
    || Number(right.yellow > 0) - Number(left.yellow > 0)
    || Number(right.green > 0) - Number(left.green > 0)
    || left.label.localeCompare(right.label)
  ));
  return output;
}

function buildLimits(limits, selectedAgent) {
  return (Array.isArray(limits) ? limits : [])
    .filter((item) => (
      selectedAgent === "all" || agentKey(item?.agent) === selectedAgent
    ))
    .map((item) => ({
      id: safeId(item?.id, "limit"),
      agent: agentKey(item?.agent) || "unknown",
      provider: safeLabel(item?.provider, "Unknown"),
      accountLabel: safeLabel(item?.accountLabel, "Default"),
      window: Object.hasOwn(WINDOW_ORDER, item?.window) ? item.window : "other",
      usedPercent: usedPercent(item?.usedPercent),
      resetAt: safeIso(item?.resetAt),
      notes: safeNote(item?.notes),
      error: typeof item?.error === "string" ? safeLabel(item.error, "").slice(0, 120) : null,
    }))
    .sort((left, right) => (
      (WINDOW_ORDER[left.window] ?? 99) - (WINDOW_ORDER[right.window] ?? 99)
      || left.provider.localeCompare(right.provider)
      || left.accountLabel.localeCompare(right.accountLabel)
    ))
    .slice(0, 24);
}

function buildTotals(usage, selectedAgent) {
  const models = new Map();
  for (const item of Array.isArray(usage) ? usage : []) {
    if (selectedAgent !== "all" && agentKey(item?.agent) !== selectedAgent) continue;
    const name = safeLabel(item?.model, "unknown");
    const current = models.get(name) || { name, tokens: 0, costUsd: 0 };
    current.tokens += finiteNonNegative(item?.tokens);
    current.costUsd += finiteNonNegative(item?.costUsd);
    models.set(name, current);
  }
  const entries = Array.from(models.values())
    .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name));
  const tokens = entries.reduce((total, model) => total + model.tokens, 0);
  const costUsd = entries.reduce((total, model) => total + model.costUsd, 0);
  return {
    tokens: Math.round(tokens),
    costUsd: Number(costUsd.toFixed(6)),
    models: entries.slice(0, 24).map((model) => ({
      name: model.name,
      tokens: Math.round(model.tokens),
      share: tokens > 0 ? Number(((model.tokens / tokens) * 100).toFixed(1)) : 0,
      costUsd: Number(model.costUsd.toFixed(6)),
    })),
  };
}

function buildPendingReset(events) {
  const event = (Array.isArray(events) ? events : []).find((candidate) => (
    candidate?.alertEligible === true
    && candidate.type === "official_reset_announcement"
  ));
  if (!event) return null;
  const occurredAt = safeIso(event.occurred_at || event.occurredAt);
  const id = safeId(event.id, "reset");
  if (!occurredAt) return null;
  return {
    id,
    agent: agentKey(event.agent) || "codex",
    window: null,
    occurredAt,
    previousUsedPercent: usedPercent(
      event.previous_used_percent ?? event.previousUsedPercent,
    ),
    currentUsedPercent: usedPercent(
      event.current_used_percent ?? event.currentUsedPercent,
    ),
  };
}

function limitResetIso(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return new Date(milliseconds).toISOString();
}

function providerName(value, fallback = "Unknown") {
  const key = agentKey(value);
  if (PROVIDER_NAMES[key]) return PROVIDER_NAMES[key];
  return safeLabel(value, fallback);
}

function planWindowName(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (["rolling_5_hour", "session", "5h"].includes(normalized)) return "5h";
  if (["rolling_weekly", "weekly", "7d"].includes(normalized)) return "7d";
  if (["total", "monthly"].includes(normalized)) return "monthly";
  if (normalized === "auto_composer") return "自动与 Composer";
  if (normalized === "api") return "API";
  if (normalized === "fast_request") return "快速请求";
  return "other";
}

function quotaWindowPercent(window) {
  const directPercent = usedPercent(window?.percentage);
  if (directPercent != null) return directPercent;
  const used = Number(window?.used);
  const total = Number(window?.total);
  if (!Number.isFinite(used) || !Number.isFinite(total) || used < 0 || total <= 0) return null;
  return usedPercent((used / total) * 100);
}

function flattenTokenPlanRecords(records) {
  const output = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== "object") continue;
    const agent = agentKey(record.source || record.provider_id) || "unknown";
    const provider = providerName(record.provider_id || agent);
    const accountLabel = safeLabel(record.plan_label, provider);
    const notes = safeNote(record.notes);
    const planId = safeId(record.id, "plan");
    const windows = Array.isArray(record.quota_windows) ? record.quota_windows : [];
    for (const window of windows) {
      const windowName = planWindowName(window?.kind);
      const windowId = windowName === "other"
        ? safeId(window?.kind, "window")
        : ["5h", "7d", "monthly"].includes(windowName)
          ? windowName
          : String(window?.kind || "other").trim().toLowerCase();
      output.push({
        id: safeId(`${agent}:${planId}:${windowId}`, "limit"),
        agent,
        provider,
        accountLabel,
        window: windowName,
        usedPercent: quotaWindowPercent(window),
        resetAt: safeIso(window?.resets_at || window?.reset_at),
        notes,
        error: null,
      });
    }
    if (windows.length === 0) {
      const total = Number(record.total_quota);
      const used = Number(record.used_quota);
      if (Number.isFinite(total) && total > 0 && Number.isFinite(used) && used >= 0) {
        output.push({
          id: safeId(`${agent}:${planId}:monthly`, "limit"),
          agent,
          provider,
          accountLabel,
          window: "monthly",
          usedPercent: usedPercent((used / total) * 100),
          resetAt: safeIso(record.expires_at),
          notes,
          error: null,
        });
      }
    }
  }
  return output;
}

function flattenUsageLimitsPayload(payload, tokenPlans = []) {
  const planLimits = flattenTokenPlanRecords(tokenPlans);
  const planAgents = new Set(planLimits.map((item) => item.agent));
  const output = [];
  for (const agent of ["claude", "codex", "cursor", "hermes"]) {
    if (planAgents.has(agent)) continue;
    const provider = providerName(agent);
    const data = payload?.[agent];
    if (!data || data.configured !== true) continue;
    const windows = [
      ["primary_window", data.primary_window],
      ["secondary_window", data.secondary_window],
    ];
    for (const [field, window] of windows) {
      if (!window || typeof window !== "object") continue;
      const seconds = Number(window.limit_window_seconds);
      const windowName = seconds === 18_000
        ? "5h"
        : seconds === 604_800 ? "7d" : field === "primary_window" ? "5h" : "7d";
      output.push({
        id: `${agent}:default:${windowName}`,
        agent,
        provider,
        accountLabel: safeLabel(data.account_label || data.plan_label, provider),
        window: windowName,
        usedPercent: usedPercent(window.used_percent),
        resetAt: limitResetIso(window.reset_at),
        notes: null,
        error: null,
      });
    }
    if (output.every((item) => item.agent !== agent) && typeof data.error === "string") {
      output.push({
        id: `${agent}:default:error`,
        agent,
        provider,
        accountLabel: safeLabel(data.account_label || data.plan_label, provider),
        window: "other",
        usedPercent: null,
        resetAt: null,
        notes: null,
        error: safeLabel(data.error, "Refresh failed").slice(0, 120),
      });
    }
  }
  return [...planLimits, ...output];
}

function buildWidgetViewModel({
  agent = "all",
  usage = [],
  sessions = [],
  limits = [],
  pendingResets = [],
  nowMs = Date.now(),
  activeSessionWindow = "1h",
} = {}) {
  const selectedAgent = WIDGET_AGENTS.includes(agentKey(agent)) ? agentKey(agent) : "all";
  return {
    agents: [...WIDGET_AGENTS],
    selectedAgent,
    projectStatus: buildProjectStatus(
      sessions,
      selectedAgent,
      nowMs,
      activeSessionWindow,
    ),
    limits: buildLimits(limits, selectedAgent),
    totals: buildTotals(usage, selectedAgent),
    pendingReset: buildPendingReset(pendingResets),
  };
}

module.exports = {
  WIDGET_AGENTS,
  buildWidgetViewModel,
  flattenUsageLimitsPayload,
};
