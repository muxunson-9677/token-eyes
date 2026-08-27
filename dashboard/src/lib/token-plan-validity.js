const UNIX_SECONDS_PATTERN = /^\d{10}$/;
const UNIX_MILLISECONDS_PATTERN = /^\d{13}$/;
const NUMERIC_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function nonEmptyExpiryValue(value) {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  return typeof value === "number" ? value : null;
}

export function tokenPlanExpiryValue(record) {
  const subscriptionEndDate = nonEmptyExpiryValue(record?.subscription_end_date);
  return subscriptionEndDate ?? nonEmptyExpiryValue(record?.expires_at);
}

export function tokenPlanStartValue(record) {
  return nonEmptyExpiryValue(record?.subscription_start_date);
}

function numericExpiryTimestamp(value, digits) {
  if (UNIX_SECONDS_PATTERN.test(digits)) {
    return value * 1000;
  }

  if (UNIX_MILLISECONDS_PATTERN.test(digits)) {
    return value;
  }

  return null;
}

function localEndOfDayTimestamp(match) {
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(0);

  date.setFullYear(year, monthIndex, day);
  date.setHours(23, 59, 59, 999);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date.getTime();
}

function localStartOfDayTimestamp(match) {
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(0);

  date.setFullYear(year, monthIndex, day);
  date.setHours(0, 0, 0, 0);

  if (
    date.getFullYear() !== year
    || date.getMonth() !== monthIndex
    || date.getDate() !== day
  ) return null;
  return date.getTime();
}

export function tokenPlanExpiryTimestamp(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      return null;
    }

    return numericExpiryTimestamp(value, String(value));
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (UNIX_SECONDS_PATTERN.test(trimmed) || UNIX_MILLISECONDS_PATTERN.test(trimmed)) {
    return numericExpiryTimestamp(Number(trimmed), trimmed);
  }

  if (NUMERIC_PATTERN.test(trimmed)) {
    return null;
  }

  const dateOnlyMatch = DATE_ONLY_PATTERN.exec(trimmed);
  if (dateOnlyMatch) {
    return localEndOfDayTimestamp(dateOnlyMatch);
  }

  const isoDateTimeMatch = ISO_DATETIME_PATTERN.exec(trimmed);
  if (!isoDateTimeMatch || localEndOfDayTimestamp(isoDateTimeMatch) === null) {
    return null;
  }

  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function tokenPlanStartTimestamp(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return null;
    return numericExpiryTimestamp(value, String(value));
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (UNIX_SECONDS_PATTERN.test(trimmed) || UNIX_MILLISECONDS_PATTERN.test(trimmed)) {
    return numericExpiryTimestamp(Number(trimmed), trimmed);
  }
  if (NUMERIC_PATTERN.test(trimmed)) return null;

  const dateOnlyMatch = DATE_ONLY_PATTERN.exec(trimmed);
  if (dateOnlyMatch) return localStartOfDayTimestamp(dateOnlyMatch);

  const isoDateTimeMatch = ISO_DATETIME_PATTERN.exec(trimmed);
  if (!isoDateTimeMatch || localStartOfDayTimestamp(isoDateTimeMatch) === null) return null;
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizedNowTimestamp(now) {
  const timestamp = now instanceof Date
    ? now.getTime()
    : typeof now === "number" && Number.isFinite(now)
      ? now
      : null;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function tokenPlanValidityState(record, now = new Date()) {
  const nowTimestamp = normalizedNowTimestamp(now);
  if (nowTimestamp === null) return "active";

  const expiryTimestamp = tokenPlanExpiryTimestamp(tokenPlanExpiryValue(record));
  if (expiryTimestamp !== null && expiryTimestamp < nowTimestamp) return "expired";

  const startTimestamp = tokenPlanStartTimestamp(tokenPlanStartValue(record));
  if (startTimestamp !== null && startTimestamp > nowTimestamp) return "scheduled";
  return "active";
}

export function isTokenPlanActive(record, now = new Date()) {
  return tokenPlanValidityState(record, now) === "active";
}

export function isTokenPlanScheduled(record, now = new Date()) {
  return tokenPlanValidityState(record, now) === "scheduled";
}

export function isTokenPlanExpired(record, now = new Date()) {
  return tokenPlanValidityState(record, now) === "expired";
}
