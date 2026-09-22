"use strict";

const crypto = require("node:crypto");

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeText(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
}

function metric(value, unit, evidenceState, evidence = null) {
  const result = { value: finiteNumber(value), unit, evidence_state: evidenceState };
  if (evidence) result.evidence = evidence;
  return result;
}

function safePublicUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch (_error) {
    return null;
  }
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

function durationMetric(rows, todayKey, evidence, lifecycle) {
  const lifecycleSpan = lifecycle ? {
    activity_day: lifecycle.activityDay,
    first_message_at: lifecycle.firstMessageAt,
    last_message_at: lifecycle.lastMessageAt,
    message_span_state: lifecycle.messageSpanState,
  } : null;
  const candidates = [...rows, ...(lifecycleSpan ? [lifecycleSpan] : [])].filter((row) => {
    const activityDay = safeText(row && row.activity_day);
    return !todayKey || activityDay === todayKey;
  });
  const first = candidates
    .map((row) => safeText(row && row.first_message_at))
    .filter(Boolean)
    .sort((left, right) => timestampMs(left) - timestampMs(right))[0];
  const last = candidates
    .map((row) => safeText(row && row.last_message_at))
    .filter(Boolean)
    .sort((left, right) => timestampMs(left) - timestampMs(right))
    .at(-1);
  const firstMs = timestampMs(first);
  const lastMs = timestampMs(last);
  const valid = Boolean(first && last && lastMs >= firstMs);
  const exact = valid && candidates.some((row) => row && row.message_span_state === "exact");
  return metric(
    valid ? Math.round((lastMs - firstMs) / 60_000) : null,
    "minutes",
    valid ? (exact ? "exact" : "partial") : "connected_no_exact_data",
    evidence,
  );
}

function buildEvidence(rows, lifecycle, latest) {
  const observed = rows.map(rowTime).filter(Boolean).sort((left, right) => timestampMs(left) - timestampMs(right));
  const latestModel = safeText(latest && latest.model) || safeText(lifecycle && lifecycle.model);
  const latestSessionId = safeText(latest && latest.session_id) || safeText(lifecycle && lifecycle.sessionId);
  const priceKnown = rows.some((row) => finiteNumber(row && row.cost_usd) !== null);
  return {
    source_kind: rows.length ? "local_usage_log" : "lifecycle_metadata",
    record_count: rows.length,
    observed_from: observed[0] || null,
    observed_to: observed.at(-1) || safeText(lifecycle && lifecycle.updatedAt),
    safe_record_refs: latestSessionId ? [`session:${latestSessionId}`] : [],
    pricing: {
      state: priceKnown ? "estimated" : "unavailable",
      model: latestModel,
      source_url: safePublicUrl(latest && latest.source_url),
      version: safeText(latest && latest.pricing_version),
    },
  };
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (finiteNumber(row[key]) || 0), 0);
}

function buildSessionActivityPoints(rows) {
  return rows
    .map((row) => ({ observed_at: safeText(row.hour_start) || rowTime(row), total_tokens: finiteNumber(row.total_tokens) }))
    .filter((point) => point.observed_at)
    .sort((left, right) => timestampMs(left.observed_at) - timestampMs(right.observed_at))
    .slice(-48);
}

function tokenMetric(rows, key, evidence = null) {
  const contributors = rows.filter(row => row.record_kind !== "lifecycle_metadata");
  const known = contributors.filter(row => finiteNumber(row[key]) !== null);
  if (!known.length) return metric(null, "tokens", "connected_no_exact_data", evidence);
  const states = known.map(row => row.token_evidence_state || row.evidence_state || "exact");
  const state = known.length !== contributors.length || states.some(value => !["exact", "estimated"].includes(value))
    ? "partial" : states.includes("estimated") ? "estimated" : "exact";
  return metric(sum(known, key), "tokens", state, evidence);
}

function buildSession(rows, lifecycle, lifecycleSessionId = null, todayKey = null, agentDayRows = []) {
  const latest = [...rows].sort((left, right) => timestampMs(rowTime(right)) - timestampMs(rowTime(left)))[0] || {};
  const lifecycleStatus = safeText(lifecycle && lifecycle.status);
  const lifecycleTime = safeText(lifecycle && lifecycle.updatedAt);
  const usageTime = rowTime(latest);
  const hasCost = rows.some((row) => finiteNumber(row.cost_usd) !== null);
  const evidence = buildEvidence(rows, lifecycle, latest);
  function requestMetric(metricRows, metricEvidence = evidence) {
    const known = metricRows.length > 0 && metricRows.every((row) => (
      Number.isInteger(row.request_count) && row.request_count >= 0
    ));
    return metric(known ? sum(metricRows, "request_count") : null, "requests", known ? "exact" : "connected_no_exact_data", metricEvidence);
  }
  const agentDayEvidence = buildEvidence(agentDayRows, null, agentDayRows.at(-1));
  const agentDayHasCost = agentDayRows.some((row) => finiteNumber(row.cost_usd) !== null);
  return {
    session_id: safeText(latest.session_id) || safeText(lifecycleSessionId) || safeText(lifecycle && lifecycle.sessionId),
    parent_session_id: safeText(latest.parent_session_id) || safeText(lifecycle && lifecycle.parentSessionId),
    root_task_id: safeText(latest.root_task_id),
    source: safeText(latest.source) || safeText(lifecycle && lifecycle.agent) || "unknown",
    agent_label: safeText(latest.agent_label) || safeText(lifecycle && lifecycle.agent),
    project_label: null,
    task_label: safeText(lifecycle && lifecycle.taskLabel) || safeText(latest.task_label),
    task_ref: safeText(lifecycle && lifecycle.taskRef)
      || safeText(latest.root_task_id)
      || safeText(latest.session_id)
      || safeText(lifecycleSessionId)
      || safeText(lifecycle && lifecycle.sessionId),
    model: safeText(latest.model) || safeText(lifecycle && lifecycle.model),
    state: lifecycleStatus || "recent_activity",
    last_activity_at: timestampMs(lifecycleTime) > timestampMs(usageTime)
      ? lifecycleTime : usageTime || lifecycleTime,
    total_tokens: tokenMetric(rows, "total_tokens", evidence),
    input_tokens: tokenMetric(rows, "input_tokens", evidence),
    output_tokens: tokenMetric(rows, "output_tokens", evidence),
    cached_input_tokens: tokenMetric(rows, "cached_input_tokens", evidence),
    cache_creation_input_tokens: tokenMetric(rows, "cache_creation_input_tokens", evidence),
    reasoning_output_tokens: tokenMetric(rows, "reasoning_output_tokens", evidence),
    request_count: requestMetric(rows),
    duration_minutes: durationMetric(rows, todayKey, evidence, lifecycle),
    api_equivalent_usd: metric(hasCost ? sum(rows, "cost_usd") : null, "USD", hasCost ? "estimated" : "connected_no_exact_data", evidence),
    activity_points: buildSessionActivityPoints(rows),
    ...(agentDayRows.length ? {
      agent_day_usage: {
        total_tokens: tokenMetric(agentDayRows, "total_tokens", agentDayEvidence),
        input_tokens: tokenMetric(agentDayRows, "input_tokens", agentDayEvidence),
        output_tokens: tokenMetric(agentDayRows, "output_tokens", agentDayEvidence),
        request_count: requestMetric(agentDayRows, agentDayEvidence),
        api_equivalent_usd: metric(agentDayHasCost ? sum(agentDayRows, "cost_usd") : null, "USD", agentDayHasCost ? "estimated" : "connected_no_exact_data", agentDayEvidence),
      },
      agent_day_activity_points: buildSessionActivityPoints(agentDayRows),
    } : {}),
    evidence,
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
    .map((resource) => {
      const label = safeText(resource.label);
      return {
        provider: resource.provider,
        ...(label ? { label } : {}),
        value: finiteNumber(resource.value),
        unit: resource.unit,
        ...(typeof resource.evidence_state === "string" ? { evidence_state: resource.evidence_state } : {}),
      };
    });
}

function buildAgentHistory(agentHistory = [], runtimeBySource = new Map()) {
  const allowedStates = new Set(["exact", "partial", "estimated", "connected_no_exact_data"]);
  return (Array.isArray(agentHistory) ? agentHistory : [])
    .map((item) => {
      const tokenState = allowedStates.has(item?.total_tokens?.evidence_state) ? item.total_tokens.evidence_state : "connected_no_exact_data";
      const valueState = allowedStates.has(item?.api_equivalent_usd?.evidence_state) ? item.api_equivalent_usd.evidence_state : "connected_no_exact_data";
    const nativeResources = buildNativeResources(item?.native_resources);
    return {
        source: safeText(item?.source),
        agent_label: safeText(item?.agent_label),
        runtime_state: runtimeBySource.get(safeText(item?.source)) || "unknown",
        history_state: item?.history_state === "installed_no_history" ? "installed_no_history" : "historical_usage",
        record_count: finiteNumber(item?.record_count) ?? 0,
        observed_from: safeText(item?.observed_from),
        observed_to: safeText(item?.observed_to),
      total_tokens: metric(item?.total_tokens?.value, "tokens", tokenState),
      api_equivalent_usd: metric(item?.api_equivalent_usd?.value, "USD", valueState),
      ...(nativeResources.length ? { native_resources: nativeResources } : {}),
      };
    })
    .filter((item) => item.source && item.agent_label);
}

function buildActivityPoints(rows) {
  return rows
    .map((row) => ({
      observed_at: safeText(row.hour_start) || rowTime(row),
      total_tokens: finiteNumber(row.total_tokens),
      api_equivalent_usd: finiteNumber(row.cost_usd),
      source: safeText(row.source) || "unknown",
    }))
    .filter((point) => point.observed_at)
    .sort((left, right) => timestampMs(left.observed_at) - timestampMs(right.observed_at))
    .slice(-48);
}

function buildUsageRecords(rows) {
  return rows
    .map((row, index) => {
      const sessionId = safeText(row && row.session_id);
      const observedAt = rowTime(row);
      if (!observedAt) return null;
      const recordKind = row.record_kind === "request_event" ? "request_event" : "aggregate_bucket";
      return {
        record_ref: `${recordKind === "request_event" ? "request" : "usage"}:${sessionId || "aggregate"}:${index}`,
        record_kind: recordKind,
        range_included: row.range_included !== false,
        session_ref: sessionId ? `session:${sessionId}` : null,
        observed_at: observedAt,
        source: safeText(row.source) || "unknown",
        model: safeText(row.model),
        total_tokens: tokenMetric([row], "total_tokens", buildEvidence([row], null, row)),
        api_equivalent_usd: metric(
          finiteNumber(row.cost_usd),
          "USD",
          finiteNumber(row.cost_usd) === null ? "connected_no_exact_data" : "estimated",
          buildEvidence([row], null, row),
        ),
        evidence: buildEvidence([row], null, row),
      };
    })
    .filter(Boolean)
    .sort((left, right) => timestampMs(right.observed_at) - timestampMs(left.observed_at));
}

function buildAgentRangeSummary(rows) {
  const bySource = new Map();
  for (const row of rows) {
    const source = safeText(row.source) || "unknown";
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push(row);
  }
  return [...bySource].map(([source, sourceRows]) => {
    const session = buildSession(sourceRows, null);
    if (sourceRows.some((row) => finiteNumber(row.cost_usd) === null)) {
      session.api_equivalent_usd = metric(null, "USD", "connected_no_exact_data", session.evidence);
    }
    const points = new Map();
    for (const row of sourceRows) {
      const observedAt = safeText(row.hour_start) || rowTime(row);
      if (!observedAt) continue;
      const time = Date.parse(observedAt);
      if (!Number.isFinite(time)) continue;
      const key = Math.floor(time / 1_800_000) * 1_800_000;
      const point = points.get(key) || { observed_at: new Date(key).toISOString(), total_tokens: null };
      if (finiteNumber(row.total_tokens) !== null) point.total_tokens = (point.total_tokens || 0) + row.total_tokens;
      points.set(key, point);
    }
    return {
      source,
      ...Object.fromEntries(["total_tokens", "input_tokens", "output_tokens", "cached_input_tokens", "cache_creation_input_tokens", "reasoning_output_tokens", "api_equivalent_usd", "request_count"].map((key) => [key, session[key]])),
      activity_points: [...points.values()].sort((left, right) => timestampMs(left.observed_at) - timestampMs(right.observed_at)),
    };
  });
}

function buildPricingCoverage(rows, sessions) {
  const byModel = new Map();
  for (const row of rows) {
    const model = safeText(row && row.model);
    if (!model) continue;
    const current = byModel.get(model) || false;
    byModel.set(model, current || finiteNumber(row.cost_usd) !== null);
  }
  for (const session of sessions) {
    const model = safeText(session && session.model);
    if (model && !byModel.has(model)) byModel.set(model, false);
  }
  const uncoveredModels = [...byModel.entries()]
    .filter(([, hasKnownPrice]) => !hasKnownPrice)
    .map(([model]) => model)
    .sort();
  const totalModels = byModel.size;
  const coveredModels = totalModels - uncoveredModels.length;
  return {
    covered_models: coveredModels,
    total_models: totalModels,
    percent: totalModels ? Math.round(coveredModels / totalModels * 100) : 0,
    uncovered_models: uncoveredModels,
  };
}

function buildRealtimeSessionViewModel(input = {}) {
  const lifecycle = lifecycleMap(input.lifecycleSessions);
  const rawRows = Array.isArray(input.usageRows) ? input.usageRows : [];
  const byId = new Map();
  const bySource = new Map();
  for (const row of rawRows) {
    const sessionId = safeText(row && row.session_id);
    if (!sessionId) continue;
    const rows = byId.get(sessionId) || [];
    rows.push(row);
    byId.set(sessionId, rows);
    const source = safeText(row && row.source);
    if (source) {
      const sourceRows = bySource.get(source) || [];
      sourceRows.push(row);
      bySource.set(source, sourceRows);
    }
  }
  const sessions = [];
  for (const [sessionId, rows] of byId.entries()) sessions.push(buildSession(rows, lifecycle.get(sessionId), null, safeText(input.todayKey)));
  for (const [sessionId, item] of lifecycle.entries()) {
    if (!byId.has(sessionId)) {
      sessions.push(buildSession(
        [],
        item,
        sessionId,
        safeText(input.todayKey),
        bySource.get(safeText(item && item.agent)) || [],
      ));
    }
  }
  sessions.sort((left, right) => {
    const stateOrder = Number(right.state === "running") - Number(left.state === "running");
    return stateOrder || timestampMs(right.last_activity_at) - timestampMs(left.last_activity_at) || left.session_id.localeCompare(right.session_id);
  });
  const rangeRows = rawRows.filter((row) => row.range_included !== false);
  const agentRangeSummary = buildAgentRangeSummary(rangeRows);
  const sessionTokenValues = agentRangeSummary.map((item) => item.total_tokens.value).filter((value) => value !== null);
  const sessionCostValues = agentRangeSummary.map((item) => item.api_equivalent_usd.value).filter((value) => value !== null);
  const totalTokens = sessionTokenValues.length ? sessionTokenValues.reduce((sumValue, value) => sumValue + value, 0) : null;
  const totalCost = sessionCostValues.length ? sessionCostValues.reduce((sumValue, value) => sumValue + value, 0) : null;
  const summaryEvidence = buildEvidence(rangeRows, null, rangeRows.at(-1));
  const runtimeItems = Array.isArray(input.runtimeSessions) ? input.runtimeSessions : sessions;
  const runtimeBySource = runtimeItems.reduce((states, item) => {
    const source = safeText(item?.source || item?.agent);
    const state = safeText(item?.state || item?.status);
    if (!source) return states;
    if (!["running", "idle", "completed", "interrupted", "error", "waiting_approval"].includes(state)) return states;
    if (state === "running" || !states.has(source)) states.set(source, state === "running" ? "running" : "idle");
    return states;
  }, new Map());
  const payload = {
    observed_at: typeof input.observedAt === "string" ? input.observedAt : null,
    range: ["today", "7d", "month", "30d"].includes(input.range) ? input.range : "today",
    range_from: /^\d{4}-\d{2}-\d{2}$/.test(String(input.rangeFrom || "")) ? input.rangeFrom : null,
    range_to: /^\d{4}-\d{2}-\d{2}$/.test(String(input.rangeTo || "")) ? input.rangeTo : null,
    requested_month: /^\d{4}-\d{2}$/.test(String(input.requestedMonth || "")) ? input.requestedMonth : null,
    data_month: typeof input.dataMonth === "string" ? input.dataMonth : null,
    month_options: Array.isArray(input.monthOptions) ? input.monthOptions.filter((item) => /^\d{4}-\d{2}$/.test(item)).slice(0, 12) : [],
    sessions,
    session_tree: buildSessionTree(sessions),
    activity_points: buildActivityPoints(rawRows),
    requests: buildUsageRecords(rawRows.filter((row) => row.record_kind === "request_event")),
    usage_records: buildUsageRecords(rawRows),
    agent_range_summary: agentRangeSummary,
    agent_history: buildAgentHistory(input.agentHistory, runtimeBySource),
    summary: {
      active_agents: metric(runtimeBySource.size ? new Set(sessions.filter((session) => session.state === "running").map((session) => session.source)).size : null, "agents", runtimeBySource.size ? "partial" : "connected_no_exact_data", summaryEvidence),
      realtime_tokens: metric(totalTokens, "tokens", totalTokens === null ? "connected_no_exact_data" : "partial", summaryEvidence),
      api_equivalent_value: metric(totalCost, "USD", totalCost === null ? "connected_no_exact_data" : "estimated", summaryEvidence),
    },
    pricing_coverage: buildPricingCoverage(rawRows, sessions),
    native_resources: buildNativeResources(input.nativeResources),
  };
  return { ...payload, revision: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16) };
}

module.exports = { buildRealtimeSessionViewModel };
