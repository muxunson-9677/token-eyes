export type LeaderboardPeriod = "today" | "yesterday" | "7d" | "30d" | "total";
export type LeaderboardMetric = "with_cache" | "without_cache" | "estimated_cost";

export const LEADERBOARD_DEFAULT_PERIOD: LeaderboardPeriod;
export const LEADERBOARD_DEFAULT_AGENT: "all";
export const LEADERBOARD_DEFAULT_METRIC: LeaderboardMetric;
export const LEADERBOARD_PERIODS: readonly LeaderboardPeriod[];
export const LEADERBOARD_METRICS: readonly LeaderboardMetric[];
export const LEADERBOARD_AGENTS: readonly Readonly<{ value: string; label: string }>[];

export function normalizeLeaderboardPeriod(value: unknown): LeaderboardPeriod;
export function normalizeLeaderboardAgent(value: unknown): string;
export function normalizeLeaderboardMetric(value: unknown): LeaderboardMetric;
export function getLeaderboardAgentLabel(agent: unknown): string;
