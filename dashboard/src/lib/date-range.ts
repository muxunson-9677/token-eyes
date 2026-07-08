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
