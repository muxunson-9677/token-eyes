import type { CodexResetHistoryEvent } from "./api";

const DAY_MS = 24 * 60 * 60 * 1000;
export const RESET_STATISTICS_PERIOD_DAYS = 30;

type OfficialResetEvent = Pick<CodexResetHistoryEvent, "type" | "occurred_at">;

export type ResetStatistics = {
  periodDays: number;
  count: number;
  averageIntervalMs: number | null;
  shortestIntervalMs: number | null;
  longestIntervalMs: number | null;
};

export function filterRecentOfficialResets<T extends OfficialResetEvent>(
  events: readonly T[],
  nowMs = Date.now(),
) {
  const cutoffMs = nowMs - RESET_STATISTICS_PERIOD_DAYS * DAY_MS;
  return events.filter((event) => {
    if (event.type !== "official_reset_announcement") return false;
    const occurredAtMs = Date.parse(event.occurred_at);
    return Number.isFinite(occurredAtMs) && occurredAtMs >= cutoffMs && occurredAtMs <= nowMs;
  });
}

export function calculateResetStatistics(
  events: readonly OfficialResetEvent[],
  nowMs = Date.now(),
): ResetStatistics {
  const occurredAtValues = filterRecentOfficialResets(events, nowMs)
    .map((event) => Date.parse(event.occurred_at))
    .sort((left, right) => left - right);
  const intervals = occurredAtValues
    .slice(1)
    .map((occurredAt, index) => occurredAt - occurredAtValues[index]);

  return {
    periodDays: RESET_STATISTICS_PERIOD_DAYS,
    count: occurredAtValues.length,
    averageIntervalMs: intervals.length > 0
      ? intervals.reduce((total, interval) => total + interval, 0) / intervals.length
      : null,
    shortestIntervalMs: intervals.length > 0 ? Math.min(...intervals) : null,
    longestIntervalMs: intervals.length > 0 ? Math.max(...intervals) : null,
  };
}
