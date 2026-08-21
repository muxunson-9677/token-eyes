"use strict";

const crypto = require("node:crypto");

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeText(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
}

function metric(value, unit, evidenceState) {
  return { value: finiteNumber(value), unit, evidence_state: evidenceState };
}

function lifecycleMap(lifecycleSessions) {
  const map = new Map();
  for (const item of Array.isArray(lifecycleSessions) ? lifecycleSessions : []) {
    const sessionId = safeText(item && item.sessionId);
    if (!sessionId) continue;
    map.set(sessionId, item);
  }
  return map;
}

function buildSession(row, lifecycle) {
  const totalTokens = finiteNumber(row.total_tokens);
  const costUsd = finiteNumber(row.cost_usd);
  const lifecycleStatus = safeText(lifecycle && lifecycle.status);
  return {
    session_id: safeText(row.session_id),
    parent_session_id: safeText(row.parent_session_id),
    root_task_id: safeText(row.root_task_id),
    source: safeText(row.source) || "unknown",
    agent_label: safeText(row.agent_label) || safeText(lifecycle && lifecycle.agent),
    project_label: safeText(row.project_label) || safeText(lifecycle && lifecycle.projectLabel),
    model: safeText(row.model),
    state: lifecycleStatus || "recent_activity",
    last_activity_at: safeText(row.last_activity_at) || safeText(lifecycle && lifecycle.updatedAt),
    total_tokens: metric(totalTokens, "tokens", totalTokens === null ? "connected_no_exact_data" : "exact"),
    api_equivalent_usd: metric(costUsd, "USD", costUsd === null ? "connected_no_exact_data" : "estimated"),
  };
}

function buildSessionTree(sessions) {
  const byId = new Map(sessions.map((session) => [session.session_id, { ...session, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent_session_id ? byId.get(node.parent_session_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function buildNativeResources(nativeResources = []) {
  return (Array.isArray(nativeResources) ? nativeResources : [])
    .filter((resource) => resource && typeof resource.provider === "string" && typeof resource.unit === "string")
    .map((resource) => ({ provider: resource.provider, value: finiteNumber(resource.value), unit: resource.unit }));
}

function buildRealtimeSessionViewModel(input = {}) {
  const lifecycle = lifecycleMap(input.lifecycleSessions);
  const rows = Array.isArray(input.usageRows) ? input.usageRows : [];
  const seen = new Set();
  const sessions = [];
  for (const row of rows) {
    const sessionId = safeText(row && row.session_id);
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    sessions.push(buildSession(row, lifecycle.get(sessionId)));
  }
  for (const [sessionId, item] of lifecycle.entries()) {
    if (seen.has(sessionId)) continue;
    sessions.push(buildSession({ session_id: sessionId, source: item.agent }, item));
  }
  sessions.sort((left, right) => left.session_id.localeCompare(right.session_id));
  const totalTokens = sessions.reduce((sum, session) => sum + (session.total_tokens.value || 0), 0);
  const totalCost = sessions.reduce((sum, session) => sum + (session.api_equivalent_usd.value || 0), 0);
  const payload = {
    observed_at: typeof input.observedAt === "string" ? input.observedAt : null,
    sessions,
    session_tree: buildSessionTree(sessions),
    summary: {
      active_agents: metric(new Set(sessions.map((session) => session.agent_label || session.source)).size, "agents", "partial"),
      realtime_tokens: metric(totalTokens, "tokens", sessions.length ? "partial" : "connected_no_exact_data"),
      api_equivalent_value: metric(totalCost, "USD", sessions.length ? "estimated" : "connected_no_exact_data"),
    },
    native_resources: buildNativeResources(input.nativeResources),
  };
  return {
    ...payload,
    revision: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16),
  };
}

module.exports = {
  buildRealtimeSessionViewModel,
};

