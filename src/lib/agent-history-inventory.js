"use strict";

const { listAgentUsageIdentities } = require("./agent-adapters");
const { normalizeSource } = require("./source-metadata");

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sixMonthsAgo(now) {
  const date = new Date(now);
  const requestedDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 6);
  const finalDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(requestedDay, finalDay));
  return date;
}

function metric(value, unit, evidenceState) {
  return { value: finiteNumber(value), unit, evidence_state: evidenceState };
}

function rowTime(row) {
  const value = row?.hour_start || row?.timestamp || row?.observed_at || null;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function registeredAgentsBySource() {
  return new Map(listAgentUsageIdentities().map((agent) => [normalizeSource(agent.queueSource), agent]));
}

function buildAgentHistoryInventory({ rows = [], installedSources = [], now = new Date() } = {}) {
  const registered = registeredAgentsBySource();
  const since = sixMonthsAgo(now).getTime();
  const bySource = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const source = normalizeSource(row?.source);
    const observedAt = rowTime(row);
    if (!source || !registered.has(source) || !observedAt || Date.parse(observedAt) < since) continue;
    const current = bySource.get(source) || {
      source,
      record_count: 0,
      total_tokens: 0,
      has_tokens: false,
      api_equivalent_usd: 0,
      has_cost: false,
      observed_from: observedAt,
      observed_to: observedAt,
    };
    const tokens = finiteNumber(row?.total_tokens);
    const cost = finiteNumber(row?.cost_usd);
    current.record_count += 1;
    if (tokens !== null) {
      current.total_tokens += tokens;
      current.has_tokens = true;
    }
    if (cost !== null) {
      current.api_equivalent_usd += cost;
      current.has_cost = true;
    }
    if (observedAt < current.observed_from) current.observed_from = observedAt;
    if (observedAt > current.observed_to) current.observed_to = observedAt;
    bySource.set(source, current);
  }

  const inventory = [...bySource.values()].map((entry) => {
    const agent = registered.get(entry.source);
    return {
      source: entry.source,
      agent_label: agent.displayName,
      history_state: "historical_usage",
      record_count: entry.record_count,
      observed_from: entry.observed_from,
      observed_to: entry.observed_to,
      total_tokens: metric(entry.has_tokens ? entry.total_tokens : null, "tokens", entry.has_tokens ? "exact" : "connected_no_exact_data"),
      api_equivalent_usd: metric(entry.has_cost ? entry.api_equivalent_usd : null, "USD", entry.has_cost ? "estimated" : "connected_no_exact_data"),
    };
  }).sort((left, right) => Date.parse(right.observed_to) - Date.parse(left.observed_to) || left.source.localeCompare(right.source));

  const presentSources = new Set(inventory.map((item) => item.source));
  for (const rawSource of Array.isArray(installedSources) ? installedSources : []) {
    const source = normalizeSource(rawSource);
    const agent = registered.get(source);
    if (!source || !agent || presentSources.has(source)) continue;
    inventory.push({
      source,
      agent_label: agent.displayName,
      history_state: "installed_no_history",
      record_count: 0,
      observed_from: null,
      observed_to: null,
      total_tokens: metric(null, "tokens", "connected_no_exact_data"),
      api_equivalent_usd: metric(null, "USD", "connected_no_exact_data"),
    });
  }
  return inventory;
}

module.exports = { buildAgentHistoryInventory, sixMonthsAgo };
