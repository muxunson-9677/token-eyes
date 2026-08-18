import type { CodexResetHistoryEvent } from "./api";

const DAY_MS = 24 * 60 * 60 * 1000;
export const RESET_STATISTICS_PERIOD_DAYS = 30;

type OfficialResetEvent = Pick<CodexResetHistoryEvent, "type" | "occurred_at">;

export type ResetStatistics = {
  periodDays: number;
  count: number;
  /** Official resets in the window immediately before the current one. */
  previousCount: number;
  /**
   * Period-over-period change of `count` vs `previousCount` in percent
   * (e.g. 18.2 for +18.2%). Null when the previous window has no resets.
   */
  countChangePercent: number | null;
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

  // V4 item-9a: period-over-period baseline — official resets that occurred in
  // the RESET_STATISTICS_PERIOD_DAYS window immediately before the current one.
  const currentCutoffMs = nowMs - RESET_STATISTICS_PERIOD_DAYS * DAY_MS;
  const previousCutoffMs = nowMs - 2 * RESET_STATISTICS_PERIOD_DAYS * DAY_MS;
  const previousCount = events.filter((event) => {
    if (event.type !== "official_reset_announcement") return false;
    const occurredAtMs = Date.parse(event.occurred_at);
    return (
      Number.isFinite(occurredAtMs) &&
      occurredAtMs >= previousCutoffMs &&
      occurredAtMs < currentCutoffMs
    );
  }).length;
  const count = occurredAtValues.length;

  return {
    periodDays: RESET_STATISTICS_PERIOD_DAYS,
    count,
    previousCount,
    countChangePercent: previousCount > 0
      ? ((count - previousCount) / previousCount) * 100
      : null,
    averageIntervalMs: intervals.length > 0
      ? intervals.reduce((total, interval) => total + interval, 0) / intervals.length
      : null,
    shortestIntervalMs: intervals.length > 0 ? Math.min(...intervals) : null,
    longestIntervalMs: intervals.length > 0 ? Math.max(...intervals) : null,
  };
}
