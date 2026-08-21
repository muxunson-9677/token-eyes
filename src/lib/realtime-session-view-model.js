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
    if (sessionId) map.set(sessionId, item);
  }
  return map;
}

function timestampMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowTime(row) {
  return safeText(row && (row.last_activity_at || row.hour_start || row.timestamp));
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (finiteNumber(row[key]) || 0), 0);
}

function buildSession(rows, lifecycle) {
  const latest = [...rows].sort((left, right) => timestampMs(rowTime(right)) - timestampMs(rowTime(left)))[0] || {};
  const lifecycleStatus = safeText(lifecycle && lifecycle.status);
  const hasExactTokens = rows.some((row) => finiteNumber(row.total_tokens) !== null);
  const hasCost = rows.some((row) => finiteNumber(row.cost_usd) !== null);
  return {
    session_id: safeText(latest.session_id),
    parent_session_id: safeText(latest.parent_session_id),
    root_task_id: safeText(latest.root_task_id),
    source: safeText(latest.source) || "unknown",
    agent_label: safeText(latest.agent_label) || safeText(lifecycle && lifecycle.agent),
    project_label: safeText(latest.project_label) || safeText(lifecycle && lifecycle.projectLabel),
    model: safeText(latest.model),
    state: lifecycleStatus || "recent_activity",
    last_activity_at: rowTime(latest) || safeText(lifecycle && lifecycle.updatedAt),
    total_tokens: metric(sum(rows, "total_tokens"), "tokens", hasExactTokens ? "exact" : "connected_no_exact_data"),
    input_tokens: metric(sum(rows, "input_tokens"), "tokens", hasExactTokens ? "exact" : "connected_no_exact_data"),
    output_tokens: metric(sum(rows, "output_tokens"), "tokens", hasExactTokens ? "exact" : "connected_no_exact_data"),
    cached_input_tokens: metric(sum(rows, "cached_input_tokens"), "tokens", hasExactTokens ? "exact" : "connected_no_exact_data"),
    cache_creation_input_tokens: metric(sum(rows, "cache_creation_input_tokens"), "tokens", hasExactTokens ? "exact" : "connected_no_exact_data"),
    reasoning_output_tokens: metric(sum(rows, "reasoning_output_tokens"), "tokens", hasExactTokens ? "exact" : "connected_no_exact_data"),
    request_count: metric(rows.length, "requests", rows.length ? "partial" : "connected_no_exact_data"),
    api_equivalent_usd: metric(sum(rows, "cost_usd"), "USD", hasCost ? "estimated" : "connected_no_exact_data"),
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

function buildActivityPoints(rows) {
  return rows
    .map((row) => ({
      observed_at: rowTime(row),
      total_tokens: finiteNumber(row.total_tokens) || 0,
      api_equivalent_usd: finiteNumber(row.cost_usd) || 0,
      source: safeText(row.source) || "unknown",
    }))
    .filter((point) => point.observed_at)
    .sort((left, right) => timestampMs(left.observed_at) - timestampMs(right.observed_at))
    .slice(-48);
}

function buildRealtimeSessionViewModel(input = {}) {
  const lifecycle = lifecycleMap(input.lifecycleSessions);
  const rawRows = Array.isArray(input.usageRows) ? input.usageRows : [];
  const byId = new Map();
  for (const row of rawRows) {
    const sessionId = safeText(row && row.session_id);
    if (!sessionId) continue;
    const rows = byId.get(sessionId) || [];
    rows.push(row);
    byId.set(sessionId, rows);
  }
  const sessions = [];
  for (const [sessionId, rows] of byId.entries()) sessions.push(buildSession(rows, lifecycle.get(sessionId)));
  for (const [sessionId, item] of lifecycle.entries()) {
    if (!byId.has(sessionId)) sessions.push(buildSession([{ session_id: sessionId, source: item.agent }], item));
  }
  sessions.sort((left, right) => {
    const stateOrder = Number(right.state === "running") - Number(left.state === "running");
    return stateOrder || timestampMs(right.last_activity_at) - timestampMs(left.last_activity_at) || left.session_id.localeCompare(right.session_id);
  });
  const totalTokens = sessions.reduce((sumValue, session) => sumValue + (session.total_tokens.value || 0), 0);
  const totalCost = sessions.reduce((sumValue, session) => sumValue + (session.api_equivalent_usd.value || 0), 0);
  const payload = {
    observed_at: typeof input.observedAt === "string" ? input.observedAt : null,
    sessions,
    session_tree: buildSessionTree(sessions),
    activity_points: buildActivityPoints(rawRows),
    summary: {
      active_agents: metric(new Set(sessions.map((session) => session.agent_label || session.source)).size, "agents", "partial"),
      realtime_tokens: metric(totalTokens, "tokens", sessions.length ? "partial" : "connected_no_exact_data"),
      api_equivalent_value: metric(totalCost, "USD", sessions.length ? "estimated" : "connected_no_exact_data"),
    },
    native_resources: buildNativeResources(input.nativeResources),
  };
  return { ...payload, revision: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16) };
}

module.exports = { buildRealtimeSessionViewModel };
