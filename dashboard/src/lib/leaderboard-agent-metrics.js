import { getAgentDisplayNameByQueueSource } from "./agent-adapters-dashboard.ts";

const LEGACY_AGENT_FIELDS = Object.freeze([
  ["codex", "gpt_tokens"],
  ["claude", "claude_tokens"],
  ["gemini", "gemini_tokens"],
  ["cursor", "cursor_tokens"],
  ["kiro", "kiro_tokens"],
  ["copilot", "copilot_tokens"],
  ["kimi-code", "kimi_tokens"],
  ["opencode", "opencode_tokens"],
  ["openclaw", "openclaw_tokens"],
  ["hermes", "hermes_tokens"],
  ["other", "other_tokens"],
]);

function displayName(agentId) {
  if (agentId === "other") return "Other";
  return getAgentDisplayNameByQueueSource(agentId);
}

function positiveMetric(agentId, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return { id: agentId, label: displayName(agentId), value: numeric };
}

export function normalizeAgentMetrics(entry, metric = "with_cache") {
  const record = entry && typeof entry === "object" ? entry : {};
  if (Object.prototype.hasOwnProperty.call(record, "agent_metrics")) {
    const metrics = record.agent_metrics && typeof record.agent_metrics === "object"
      ? record.agent_metrics
      : {};
    const valueKey = metric === "estimated_cost"
      ? "estimated_cost_usd"
      : metric === "without_cache"
        ? "without_cache_tokens"
        : "with_cache_tokens";
    return Object.entries(metrics)
      .map(([agentId, values]) => positiveMetric(agentId, values?.[valueKey]))
      .filter(Boolean)
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }

  return LEGACY_AGENT_FIELDS
    .map(([agentId, field]) => positiveMetric(agentId, record[field]))
    .filter(Boolean)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}
