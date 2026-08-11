import { DASHBOARD_AGENTS } from "./agent-adapters-dashboard";

export const LEADERBOARD_DEFAULT_PERIOD = "total";
export const LEADERBOARD_DEFAULT_AGENT = "all";
export const LEADERBOARD_DEFAULT_METRIC = "tokens";

export const LEADERBOARD_PERIODS = Object.freeze([
  "today",
  "week",
  "30d",
  "month",
  "total",
]);

export const LEADERBOARD_METRICS = Object.freeze([
  "tokens",
  "estimated_spend",
  "actual_cost",
]);

const AGENT_LABELS = new Map(
  DASHBOARD_AGENTS.map((agent) => [agent.queueSource, agent.displayName]),
);

export const LEADERBOARD_AGENTS = Object.freeze(
  Array.from(AGENT_LABELS, ([value, label]) => Object.freeze({ value, label })),
);

export function normalizeLeaderboardPeriod(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "7d") return "week";
  return LEADERBOARD_PERIODS.includes(normalized) ? normalized : LEADERBOARD_DEFAULT_PERIOD;
}

export function normalizeLeaderboardAgent(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === LEADERBOARD_DEFAULT_AGENT || AGENT_LABELS.has(normalized)) {
    return normalized;
  }
  return LEADERBOARD_DEFAULT_AGENT;
}

export function normalizeLeaderboardMetric(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "with_cache" || normalized === "without_cache") return "tokens";
  if (normalized === "estimated_cost") return "estimated_spend";
  return LEADERBOARD_METRICS.includes(normalized)
    ? normalized
    : LEADERBOARD_DEFAULT_METRIC;
}

export function getLeaderboardAgentLabel(agent) {
  const normalized = normalizeLeaderboardAgent(agent);
  return normalized === LEADERBOARD_DEFAULT_AGENT ? "" : AGENT_LABELS.get(normalized) || "";
}
