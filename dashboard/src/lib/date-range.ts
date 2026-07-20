import { getLocalDateParts } from "./timezone";

type DateRangeOptions = {
  timeZone?: string;
  offsetMinutes?: number;
  now?: Date;
};

export function formatDateUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export function formatDateLocal(d: any) {
  const date = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateString(yyyyMmDd: any) {
  if (!yyyyMmDd) return null;
  const raw = String(yyyyMmDd).trim();
  const parts = raw.split("-");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  const dt = new Date(Date.UTC(y, m, d));
  if (!Number.isFinite(dt.getTime())) return null;
  return formatDateUTC(dt) === raw ? dt : null;
}

function formatDateParts(parts: any) {
  if (!parts) return "";
  const y = parts.year;
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  if (!y || !m || !d) return "";
  return `${y}-${m}-${d}`;
}

export function getRangeForPeriod(
  period: any,
  { timeZone, offsetMinutes, now }: DateRangeOptions = {},
) {
  const baseDate = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const parts = getLocalDateParts({ timeZone, offsetMinutes, date: baseDate });
  if (!parts) {
    const fallbackKey = formatDateLocal(new Date());
    return { from: fallbackKey, to: fallbackKey };
  }
  const to = formatDateParts(parts);
  const today = parseDateString(to);
  if (!today) return { from: to, to };

  if (period === "day") {
    return { from: to, to };
  }

  if (period === "week") {
    const fromDate = new Date(today);
    const day = fromDate.getUTCDay();
    const offset = (day + 6) % 7; // Monday start
    fromDate.setUTCDate(fromDate.getUTCDate() - offset);
    const toDate = new Date(fromDate);
    toDate.setUTCDate(toDate.getUTCDate() + 6);
    return { from: formatDateUTC(fromDate), to: formatDateUTC(toDate) };
  }

  if (period === "month") {
    const fromDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const toDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    return { from: formatDateUTC(fromDate), to: formatDateUTC(toDate) };
  }

  if (period === "30d") {
    const fromDate = new Date(today);
    fromDate.setUTCDate(fromDate.getUTCDate() - 30);
    return { from: formatDateUTC(fromDate), to };
  }

  // "total": last 24 months (local month window).
  if (period === "total") {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 23, 1));
    return { from: formatDateUTC(start), to };
  }

  // Default to week (safe fallback)
  return getRangeForPeriod("week");
}

/**
 * Month-over-month comparison ranges: month-to-date vs the same elapsed
 * period in the previous calendar month (本月至今 vs 上月同期).
 *
 * - current: 1st of this month → today (local)
 * - previous: 1st of last month → same day-of-month last month (clamped to
 *   last day of that month when the day does not exist, e.g. Mar 31 → Feb 28/29)
 */
export function getMonthComparisonRanges(options: DateRangeOptions = {}) {
  const baseDate = options.now instanceof Date && Number.isFinite(options.now.getTime())
    ? options.now
    : new Date();
  const parts = getLocalDateParts({
    timeZone: options.timeZone,
    offsetMinutes: options.offsetMinutes,
    date: baseDate,
  });
  if (!parts) {
    const fallbackKey = formatDateLocal(new Date());
    const fallback = { from: fallbackKey, to: fallbackKey };
    return { current: fallback, previous: fallback };
  }

  const currentFrom = `${parts.year}-${String(parts.month).padStart(2, "0")}-01`;
  const currentTo = formatDateParts(parts);

  const previousMonthAnchor = new Date(Date.UTC(parts.year, parts.month - 2, 1));
  const previousYear = previousMonthAnchor.getUTCFullYear();
  const previousMonth = previousMonthAnchor.getUTCMonth() + 1;
  const previousMonthLastDay = new Date(
    Date.UTC(previousYear, previousMonthAnchor.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const previousDay = Math.min(parts.day, previousMonthLastDay);
  const previousFrom = `${previousYear}-${String(previousMonth).padStart(2, "0")}-01`;
  const previousTo = `${previousYear}-${String(previousMonth).padStart(2, "0")}-${String(previousDay).padStart(2, "0")}`;

  return {
    current: { from: currentFrom, to: currentTo },
    previous: { from: previousFrom, to: previousTo },
  };
}

type CostMonthRangeOptions = DateRangeOptions & {
  selectedMonth?: string;
};

export function getCostMonthRanges(options: CostMonthRangeOptions = {}) {
  const baseDate = options.now instanceof Date && Number.isFinite(options.now.getTime())
    ? options.now
    : new Date();
  const localParts = getLocalDateParts({
    timeZone: options.timeZone,
    offsetMinutes: options.offsetMinutes,
    date: baseDate,
  });
  const fallbackDay = formatDateLocal(baseDate);
  const currentYear = localParts?.year || Number(fallbackDay.slice(0, 4));
  const currentMonthNumber = localParts?.month || Number(fallbackDay.slice(5, 7));
  const currentDay = localParts?.day || Number(fallbackDay.slice(8, 10));
  const currentMonth = `${currentYear}-${String(currentMonthNumber).padStart(2, "0")}`;
  const requestedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(options.selectedMonth || ""))
    ? String(options.selectedMonth)
    : currentMonth;
  const selectedMonth = requestedMonth > currentMonth ? currentMonth : requestedMonth;
  const [selectedYear, selectedMonthNumber] = selectedMonth.split("-").map(Number);
  const isCurrentMonth = selectedMonth === currentMonth;
  const selectedLastDay = new Date(Date.UTC(selectedYear, selectedMonthNumber, 0)).getUTCDate();
  const selectedToDay = isCurrentMonth ? currentDay : selectedLastDay;
  const selectedFrom = `${selectedMonth}-01`;
  const selectedTo = `${selectedMonth}-${String(selectedToDay).padStart(2, "0")}`;

  const comparisonAnchor = new Date(Date.UTC(selectedYear, selectedMonthNumber - 2, 1));
  const comparisonYear = comparisonAnchor.getUTCFullYear();
  const comparisonMonthNumber = comparisonAnchor.getUTCMonth() + 1;
  const comparisonMonth = `${comparisonYear}-${String(comparisonMonthNumber).padStart(2, "0")}`;
  const comparisonLastDay = new Date(Date.UTC(comparisonYear, comparisonMonthNumber, 0)).getUTCDate();
  const comparisonToDay = isCurrentMonth
    ? Math.min(selectedToDay, comparisonLastDay)
    : comparisonLastDay;

  return {
    selectedMonth,
    isCurrentMonth,
    selected: { from: selectedFrom, to: selectedTo },
    comparison: {
      from: `${comparisonMonth}-01`,
      to: `${comparisonMonth}-${String(comparisonToDay).padStart(2, "0")}`,
    },
    yearToSelected: { from: `${selectedYear}-01-01`, to: selectedTo },
  };
}

/**
 * Compute a {from, to} date range (YYYY-MM-DD) for the Ticket-02 time-range
 * keys used by the SpendPage filter bar: "today" / "1d" / "7d" / "14d" /
 * "30d" / "custom".
 *
 * Distinct from `getRangeForPeriod` (which serves the legacy "day"/"week"/
 * "month"/"total" keys). The two helpers are intentionally separate so the
 * new key set does not alter the legacy behavior.
 *
 * - "today": from = to = today (local).
 * - "1d" / "7d" / "14d" / "30d": from = today - N days, to = today. "1d" thus
 *   spans 2 calendar days (yesterday + today), distinct from "today".
 * - "custom": returns today as a safe fallback; the caller is expected to
 *   override `from`/`to` with explicit values from the calendar popover.
 */
export function computeRangeFromKey(
  key: string,
  { timeZone, offsetMinutes, now }: DateRangeOptions = {},
): { from: string; to: string } {
  const baseDate = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const parts = getLocalDateParts({ timeZone, offsetMinutes, date: baseDate });
  if (!parts) {
    const fallbackKey = formatDateLocal(new Date());
    return { from: fallbackKey, to: fallbackKey };
  }
  const to = formatDateParts(parts);
  const today = parseDateString(to);
  if (!today) return { from: to, to };

  if (key === "today") {
    return { from: to, to };
  }

  // "1d" / "7d" / "14d" / "30d" — from = today - N days
  const dayMatch = /^(\d+)d$/.exec(key);
  if (dayMatch) {
    const n = Number(dayMatch[1]);
    if (Number.isFinite(n) && n > 0) {
      const fromDate = new Date(today);
      fromDate.setUTCDate(fromDate.getUTCDate() - n);
      return { from: formatDateUTC(fromDate), to };
    }
  }

  // "custom" or unknown — fall back to today. Callers driving the custom
  // calendar override from/to via setTimeRange(key, from, to).
  return { from: to, to };
}
