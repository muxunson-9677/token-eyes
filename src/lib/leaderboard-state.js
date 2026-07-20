"use strict";

const crypto = require("node:crypto");

const COMPACT_STATE_MAX_BYTES = 8 * 1024;
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const PERIOD_NAMES = ["today", "week", "month", "total"];
const TOKEN_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "reasoning_output_tokens",
];

const shanghaiDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function shanghaiDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = {};
  for (const part of shanghaiDayFormatter.formatToParts(date)) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      parts[part.type] = part.value;
    }
  }
  if (!parts.year || !parts.month || !parts.day) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function mondayKey(dayKey) {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function decimalInteger(value) {
  if (typeof value === "bigint") return value > 0n ? value : 0n;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return 0n;
    return BigInt(Math.trunc(value));
  }
  if (typeof value !== "string") return 0n;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return 0n;
  return BigInt(normalized);
}

function emptyTotals() {
  return [0n, 0n, 0n, 0n, 0n];
}

function addRow(target, row) {
  for (let index = 0; index < TOKEN_FIELDS.length; index += 1) {
    target[index] += decimalInteger(row[TOKEN_FIELDS[index]]);
  }
}

function periodRows(periodMap) {
  return [...periodMap.entries()]
    .filter(([, totals]) => totals.some((value) => value !== 0n))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, totals]) => {
      const separator = key.indexOf("\u0000");
      return [
        key.slice(0, separator),
        key.slice(separator + 1),
        ...totals.map((value) => value.toString()),
      ];
    });
}

function buildLeaderboardDeviceState(rows, options = {}) {
  const deviceId = typeof options.deviceId === "string" ? options.deviceId.trim() : "";
  if (!deviceId) throw new TypeError("deviceId is required");

  const capturedDate = options.capturedAt instanceof Date
    ? options.capturedAt
    : new Date(options.capturedAt || Date.now());
  if (!Number.isFinite(capturedDate.getTime())) {
    throw new TypeError("capturedAt must be a valid date");
  }

  const todayKey = shanghaiDayKey(capturedDate);
  const weekKey = mondayKey(todayKey);
  const monthKey = `${todayKey.slice(0, 7)}-01`;
  const periodMaps = Object.fromEntries(PERIOD_NAMES.map((name) => [name, new Map()]));

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const source = typeof row.source === "string" ? row.source.trim().toLowerCase() : "";
    const model = typeof row.model === "string" ? row.model.trim() : "";
    const rowKey = shanghaiDayKey(row.hour_start);
    if (!source || !model || !rowKey || rowKey > todayKey) continue;

    const groupKey = `${source}\u0000${model}`;
    const includedPeriods = ["total"];
    if (rowKey >= monthKey) includedPeriods.push("month");
    if (rowKey >= weekKey) includedPeriods.push("week");
    if (rowKey >= todayKey) includedPeriods.push("today");

    for (const period of includedPeriods) {
      const totals = periodMaps[period].get(groupKey) || emptyTotals();
      addRow(totals, row);
      periodMaps[period].set(groupKey, totals);
    }
  }

  return {
    version: 1,
    device_id: deviceId,
    captured_at: capturedDate.toISOString(),
    periods: Object.fromEntries(PERIOD_NAMES.map((name) => [name, periodRows(periodMaps[name])])),
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function stableStateHash(state) {
  const hashableState = state && typeof state === "object"
    ? Object.fromEntries(
      Object.entries(state).filter(([key]) => key !== "captured_at"),
    )
    : state;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(hashableState)))
    .digest("hex");
}

function assertCompactStateSize(value) {
  const payload = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8");
  if (payload.byteLength > COMPACT_STATE_MAX_BYTES) {
    throw new RangeError(
      `Compact leaderboard state is ${payload.byteLength} bytes exceeds ${COMPACT_STATE_MAX_BYTES}-byte limit`,
    );
  }
  return payload.byteLength;
}

module.exports = {
  COMPACT_STATE_MAX_BYTES,
  assertCompactStateSize,
  buildLeaderboardDeviceState,
  stableStateHash,
};
