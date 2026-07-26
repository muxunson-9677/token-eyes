"use strict";

const crypto = require("node:crypto");

const MONITOR_STATE_VERSION = 1;
const UPCOMING_MS = 30 * 60 * 1000;
const RESTORE_DROP_POINTS = 20;
const RESTORE_CONFIRM_MS = 5 * 60 * 1000;
const SNAPSHOT_FRESH_MS = 15 * 60 * 1000;
const EVENT_HISTORY_LIMIT = 100;
const RESET_HISTORY_LIMIT = 5;
const ACKNOWLEDGEMENT_LIMIT = 200;
const OFFICIAL_CODEX_URL = "https://chatgpt.com/codex";

const WINDOW_FIELDS = Object.freeze({
  rolling_5_hour: "primary_window",
  rolling_weekly: "secondary_window",
});

function emptyState() {
  return {
    version: MONITOR_STATE_VERSION,
    lastCheckedAt: null,
    lastSuccessfulAt: null,
    windows: {},
    restoreCandidates: {},
    events: [],
    acknowledgedEventIds: [],
    feed: null,
  };
}

function normalizePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  return Math.round(numeric);
}

function normalizeIso(value) {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalizeWindow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usedPercent = normalizePercent(value.used_percent);
  const resetAt = normalizeIso(value.reset_at);
  if (usedPercent === null || !resetAt) return null;
  return { usedPercent, resetAt };
}

function normalizeCodexResetSnapshot(snapshot, { nowMs = Date.now() } = {}) {
  const checkedAt = normalizeIso(snapshot?.checked_at);
  const checkedMs = checkedAt ? Date.parse(checkedAt) : NaN;
  const fresh = Number.isFinite(checkedMs)
    && checkedMs <= nowMs + 60_000
    && nowMs - checkedMs <= SNAPSHOT_FRESH_MS;
  const blocked = !snapshot
    || snapshot.configured !== true
    || snapshot.error_code
    || snapshot.unsupported === true
    || snapshot.auth_action_required
    || !fresh;

  const windows = {};
  for (const [name, field] of Object.entries(WINDOW_FIELDS)) {
    const normalized = normalizeWindow(snapshot?.[field]);
    if (normalized) windows[name] = normalized;
  }
  return {
    valid: !blocked && Object.keys(windows).length > 0,
    configured: snapshot?.configured === true,
    checkedAt,
    windows,
  };
}

function normalizeState(state) {
  const base = emptyState();
  if (!state || typeof state !== "object" || Array.isArray(state)) return base;
  return {
    ...base,
    lastCheckedAt: normalizeIso(state.lastCheckedAt),
    lastSuccessfulAt: normalizeIso(state.lastSuccessfulAt),
    windows: state.windows && typeof state.windows === "object"
      ? { ...state.windows }
      : {},
    restoreCandidates:
      state.restoreCandidates && typeof state.restoreCandidates === "object"
        ? { ...state.restoreCandidates }
        : {},
    events: Array.isArray(state.events)
      ? state.events.filter((event) => event && typeof event.id === "string")
      : [],
    acknowledgedEventIds: Array.isArray(state.acknowledgedEventIds)
      ? state.acknowledgedEventIds.filter((id) => typeof id === "string")
      : [],
    feed: state.feed && typeof state.feed === "object" && !Array.isArray(state.feed)
      ? { ...state.feed }
      : null,
  };
}

function buildCodexResetEventId(type, window, resetAt) {
  return crypto
    .createHash("sha256")
    .update(`${type}|${window}|${resetAt}`, "utf8")
    .digest("hex");
}

function addEvent(state, { type, window, resetAt, nowMs }) {
  const id = buildCodexResetEventId(type, window, resetAt);
  if (state.events.some((event) => event.id === id)) return;
  state.events.push({
    id,
    type,
    window,
    createdAt: new Date(nowMs).toISOString(),
    resetAt,
    officialUrl: OFFICIAL_CODEX_URL,
    source: "local_quota",
  });
}

function codexResetOccurredAt(event) {
  if (event?.type === "reset_completed") return normalizeIso(event.resetAt);
  if (event?.type === "unexpected_quota_restore") return normalizeIso(event.createdAt);
  return null;
}

function listCodexResetHistory(state, { limit = RESET_HISTORY_LIMIT } = {}) {
  const safeLimit = Number.isInteger(limit) && limit >= 0
    ? Math.min(limit, RESET_HISTORY_LIMIT)
    : RESET_HISTORY_LIMIT;
  if (safeLimit === 0) return [];
  return normalizeState(state).events
    .map((event) => {
      const occurredAt = codexResetOccurredAt(event);
      return occurredAt ? { ...event, occurredAt } : null;
    })
    .filter(Boolean)
    .sort((left, right) => (
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
      || String(right.id).localeCompare(String(left.id))
    ))
    .slice(0, safeLimit);
}

function compactCodexResetEvents(events) {
  const source = Array.isArray(events)
    ? events.filter((event) => event && typeof event.id === "string")
    : [];
  const actualIds = new Set(
    listCodexResetHistory({ events: source }).map((event) => event.id),
  );
  const actual = source.filter((event) => actualIds.has(event.id));
  const other = source
    .filter((event) => (
      event.type !== "reset_completed"
      && event.type !== "unexpected_quota_restore"
    ))
    .slice(-(EVENT_HISTORY_LIMIT - actual.length));
  return [...other, ...actual]
    .sort((left, right) => (
      Date.parse(left.createdAt || left.resetAt || 0)
      - Date.parse(right.createdAt || right.resetAt || 0)
    ))
    .slice(-EVENT_HISTORY_LIMIT);
}

function capState(state) {
  state.events = compactCodexResetEvents(state.events);
  state.acknowledgedEventIds =
    [...new Set(state.acknowledgedEventIds)].slice(-ACKNOWLEDGEMENT_LIMIT);
  return state;
}

function evaluateCodexResetSnapshot(state, snapshot, { nowMs = Date.now() } = {}) {
  const next = normalizeState(state);
  const normalized = normalizeCodexResetSnapshot(snapshot, { nowMs });
  if (normalized.checkedAt) next.lastCheckedAt = normalized.checkedAt;
  if (!normalized.valid) {
    next.restoreCandidates = {};
    return capState(next);
  }

  next.lastSuccessfulAt = normalized.checkedAt;
  for (const windowName of Object.keys(WINDOW_FIELDS)) {
    const current = normalized.windows[windowName];
    const previous = next.windows[windowName];
    if (!current) {
      delete next.restoreCandidates[windowName];
      continue;
    }

    const currentResetMs = Date.parse(current.resetAt);
    const previousResetMs = previous ? Date.parse(previous.resetAt) : NaN;
    const completed = Boolean(
      previous
      && previousResetMs <= nowMs
      && currentResetMs > previousResetMs
      && current.usedPercent < previous.usedPercent,
    );

    if (completed) {
      addEvent(next, {
        type: "reset_completed",
        window: windowName,
        resetAt: previous.resetAt,
        nowMs,
      });
      delete next.restoreCandidates[windowName];
    } else if (
      previous
      && previous.resetAt === current.resetAt
      && currentResetMs > nowMs
    ) {
      const candidate = next.restoreCandidates[windowName];
      if (candidate) {
        const maintainedDrop =
          candidate.resetAt === current.resetAt
          && candidate.baselineUsed - current.usedPercent >= RESTORE_DROP_POINTS
          && current.usedPercent <= candidate.observedUsed;
        if (
          maintainedDrop
          && nowMs - Date.parse(candidate.firstObservedAt) >= RESTORE_CONFIRM_MS
        ) {
          addEvent(next, {
            type: "unexpected_quota_restore",
            window: windowName,
            resetAt: current.resetAt,
            nowMs,
          });
          delete next.restoreCandidates[windowName];
        } else if (!maintainedDrop) {
          delete next.restoreCandidates[windowName];
        }
      } else if (previous.usedPercent - current.usedPercent >= RESTORE_DROP_POINTS) {
        next.restoreCandidates[windowName] = {
          baselineUsed: previous.usedPercent,
          observedUsed: current.usedPercent,
          resetAt: current.resetAt,
          firstObservedAt: new Date(nowMs).toISOString(),
        };
      }
    } else {
      delete next.restoreCandidates[windowName];
    }

    const untilReset = currentResetMs - nowMs;
    if (untilReset > 0 && untilReset <= UPCOMING_MS) {
      addEvent(next, {
        type: "reset_upcoming",
        window: windowName,
        resetAt: current.resetAt,
        nowMs,
      });
    }
    next.windows[windowName] = current;
  }
  return capState(next);
}

function acknowledgeCodexResetEvent(state, eventId) {
  const next = normalizeState(state);
  if (
    typeof eventId === "string"
    && eventId.length > 0
    && eventId.length <= 128
    && next.events.some((event) => event.id === eventId)
  ) {
    next.acknowledgedEventIds.push(eventId);
  }
  return capState(next);
}

function listUnreadCodexResetEvents(state) {
  const normalized = normalizeState(state);
  const acknowledged = new Set(normalized.acknowledgedEventIds);
  return normalized.events.filter((event) => !acknowledged.has(event.id));
}

module.exports = {
  MONITOR_STATE_VERSION,
  RESET_HISTORY_LIMIT,
  acknowledgeCodexResetEvent,
  buildCodexResetEventId,
  compactCodexResetEvents,
  evaluateCodexResetSnapshot,
  listCodexResetHistory,
  listUnreadCodexResetEvents,
  normalizeCodexResetSnapshot,
};
