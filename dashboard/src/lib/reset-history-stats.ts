import type { CodexResetHistoryEvent } from "./api";

const DAY_MS = 24 * 60 * 60 * 1000;
export const RESET_STATISTICS_PERIOD_DAYS = 30;
export const RESET_HISTORY_TIME_ZONE = "Asia/Shanghai";

const SHANGHAI_DAY_FORMATTER = new Intl.DateTimeFormat("en", {
  timeZone: RESET_HISTORY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type OfficialResetEvent = Pick<CodexResetHistoryEvent, "type" | "occurred_at" | "published_precision">;

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

export type ResetActivityDay = {
  key: string;
  count: number;
  offset: number;
};

export function resetHistoryDayKey(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(
    SHANGHAI_DAY_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftCalendarDayKey(key: string, offset: number) {
  const [year, month, day] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function calculateResetActivityDays<T extends OfficialResetEvent>(
  events: readonly T[],
  nowMs = Date.now(),
  dayCount = 7,
): ResetActivityDay[] {
  const todayKey = resetHistoryDayKey(nowMs);
  if (!todayKey || !Number.isInteger(dayCount) || dayCount <= 0) return [];
  const days = Array.from({ length: dayCount }, (_, index) => {
    const offset = dayCount - 1 - index;
    return { key: shiftCalendarDayKey(todayKey, -offset), count: 0, offset };
  });
  const byKey = new Map(days.map((day) => [day.key, day]));
  for (const event of events) {
    if (event.type !== "official_reset_announcement") continue;
    const day = byKey.get(resetHistoryDayKey(event.occurred_at) || "");
    if (day) day.count += 1;
  }
  return days;
}

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
  const recentEvents = filterRecentOfficialResets(events, nowMs);
  const hasDateOnly = recentEvents.some((event) => event.published_precision === "day");
  const occurredAtValues = recentEvents
    .map((event) => Date.parse(event.occurred_at))
    .sort((left, right) => left - right);
  const intervals = (hasDateOnly ? [] : occurredAtValues)
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
