"use strict";

const crypto = require("node:crypto");

const MONITOR_STATE_VERSION = 2;
const UPCOMING_MS = 30 * 60 * 1000;
const RESTORE_DROP_POINTS = 20;
const RESTORE_CONFIRM_MS = 5 * 60 * 1000;
const SNAPSHOT_FRESH_MS = 15 * 60 * 1000;
const EVENT_HISTORY_LIMIT = 100;
const RESET_HISTORY_DAYS = 30;
const RESET_HISTORY_MS = RESET_HISTORY_DAYS * 24 * 60 * 60 * 1000;
const ACKNOWLEDGEMENT_LIMIT = 200;
const OFFICIAL_CODEX_URL = "https://chatgpt.com/codex";
const ACKNOWLEDGEMENT_CHANNELS = new Set(["banner", "tray", "widget"]);

const WINDOW_FIELDS = Object.freeze({
  rolling_5_hour: "primary_window",
  rolling_weekly: "secondary_window",
});
const WINDOW_DURATION_MS = Object.freeze({
  rolling_5_hour: 5 * 60 * 60 * 1000,
  rolling_weekly: 7 * 24 * 60 * 60 * 1000,
});

function emptyState() {
  return {
    version: MONITOR_STATE_VERSION,
    lastCheckedAt: null,
    lastSuccessfulAt: null,
    windows: {},
    resetCredits: null,
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

function normalizeResetCredits(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const availableCount = Number(value.available_count);
  const applicableAvailableCount = Number(value.applicable_available_count);
  if (
    !Number.isSafeInteger(availableCount)
    || availableCount < 0
    || !Number.isSafeInteger(applicableAvailableCount)
    || applicableAvailableCount < 0
  ) {
    return null;
  }
  return { availableCount, applicableAvailableCount };
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
    resetCredits: normalizeResetCredits(snapshot?.reset_credits),
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
    resetCredits: normalizeResetCredits({
      available_count: state.resetCredits?.availableCount,
      applicable_available_count: state.resetCredits?.applicableAvailableCount,
    }),
    restoreCandidates:
      state.restoreCandidates && typeof state.restoreCandidates === "object"
        ? { ...state.restoreCandidates }
        : {},
    events: Array.isArray(state.events)
      ? state.events
        .filter((event) => event && typeof event.id === "string")
        .map((event) => ({
          ...event,
          acknowledgedChannels: Array.isArray(event.acknowledgedChannels)
            ? [...new Set(event.acknowledgedChannels.filter((channel) => (
              ACKNOWLEDGEMENT_CHANNELS.has(channel)
            )))]
            : [],
        }))
      : [],
    acknowledgedEventIds: Array.isArray(state.acknowledgedEventIds)
      ? state.acknowledgedEventIds.filter((id) => typeof id === "string")
      : [],
    feed: state.feed && typeof state.feed === "object" && !Array.isArray(state.feed)
      ? { ...state.feed }
      : null,
  };
}

function buildCodexResetEventId(type, window, resetAt, accountKey = "default") {
  return crypto
    .createHash("sha256")
    .update(`${type}|${accountKey}|${window}|${resetAt}`, "utf8")
    .digest("hex");
}

function addEvent(state, {
  type,
  window,
  resetAt,
  nowMs,
  accountKey = "default",
  occurredAt = null,
  previousUsedPercent,
  currentUsedPercent,
  previousResetAt,
  currentResetAt,
  source = "local_quota",
  confidence = "confirmed",
  alertEligible = false,
}) {
  const id = buildCodexResetEventId(type, window, resetAt, accountKey);
  if (state.events.some((event) => event.id === id)) return;
  state.events.push({
    id,
    type,
    agent: "codex",
    accountKey,
    window,
    createdAt: new Date(nowMs).toISOString(),
    resetAt,
    occurredAt: occurredAt || undefined,
    observedAt: new Date(nowMs).toISOString(),
    previousUsedPercent,
    currentUsedPercent,
    previousResetAt,
    currentResetAt,
    confidence,
    alertEligible,
    deliveredChannels: [],
    acknowledgedChannels: [],
    officialUrl: OFFICIAL_CODEX_URL,
    source,
  });
}

function codexResetOccurredAt(event) {
  const occurredAt = normalizeIso(event?.occurredAt);
  if (occurredAt) return occurredAt;
  if (event?.type === "official_reset_announcement") {
    return normalizeIso(event.createdAt);
  }
  if (event?.type === "reset_completed") return normalizeIso(event.resetAt);
  if (event?.type === "manual_reset") return normalizeIso(event.observedAt || event.createdAt);
  if (event?.type === "unexpected_quota_restore") return normalizeIso(event.createdAt);
  return null;
}

function listCodexResetHistory(state, { limit = null, nowMs = Date.now() } = {}) {
  const safeLimit = Number.isInteger(limit) && limit >= 0 ? limit : null;
  if (safeLimit === 0) return [];
  const cutoffMs = nowMs - RESET_HISTORY_MS;
  const history = normalizeState(state).events
    .map((event) => {
      const occurredAt = codexResetOccurredAt(event);
      return occurredAt ? { ...event, occurredAt } : null;
    })
    .filter((event) => event && Date.parse(event.occurredAt) >= cutoffMs)
    .sort((left, right) => (
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
      || String(right.id).localeCompare(String(left.id))
    ));
  return safeLimit === null ? history : history.slice(0, safeLimit);
}

function compactCodexResetEvents(events, { nowMs = Date.now() } = {}) {
  const source = Array.isArray(events)
    ? events.filter((event) => event && typeof event.id === "string")
    : [];
  const actualIds = new Set(
    listCodexResetHistory({ events: source }, { nowMs }).map((event) => event.id),
  );
  const actual = source.filter((event) => actualIds.has(event.id));
  const other = source
    .filter((event) => (
      event.type !== "reset_completed"
      && event.type !== "manual_reset"
      && event.type !== "unexpected_quota_restore"
      && event.type !== "official_reset_announcement"
    ))
    .slice(-EVENT_HISTORY_LIMIT);
  return [...other, ...actual]
    .sort((left, right) => (
      Date.parse(left.createdAt || left.resetAt || 0)
      - Date.parse(right.createdAt || right.resetAt || 0)
    ));
}

function capState(state, { nowMs = Date.now() } = {}) {
  state.events = compactCodexResetEvents(state.events, { nowMs });
  state.acknowledgedEventIds =
    [...new Set(state.acknowledgedEventIds)].slice(-ACKNOWLEDGEMENT_LIMIT);
  return state;
}

function evaluateCodexResetSnapshot(
  state,
  snapshot,
  { nowMs = Date.now(), backfill = false, source = "live_usage" } = {},
) {
  const next = normalizeState(state);
  const normalized = normalizeCodexResetSnapshot(snapshot, { nowMs });
  if (normalized.checkedAt) next.lastCheckedAt = normalized.checkedAt;
  if (!normalized.valid) {
    next.restoreCandidates = {};
    return capState(next, { nowMs });
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
    const creditDecreased = Boolean(
      next.resetCredits
      && normalized.resetCredits
      && normalized.resetCredits.availableCount < next.resetCredits.availableCount,
    );
    const manualReset = Boolean(
      previous
      && previousResetMs > nowMs
      && currentResetMs > previousResetMs
      && current.usedPercent < previous.usedPercent
      && (
        creditDecreased
        || currentResetMs - nowMs >= WINDOW_DURATION_MS[windowName] - 5 * 60 * 1000
      ),
    );
    const completed = Boolean(
      previous
      && previousResetMs <= nowMs
      && currentResetMs > previousResetMs
      && current.usedPercent < previous.usedPercent,
    );

    if (manualReset) {
      addEvent(next, {
        type: "manual_reset",
        window: windowName,
        resetAt: current.resetAt,
        nowMs,
        occurredAt: new Date(nowMs).toISOString(),
        previousUsedPercent: previous.usedPercent,
        currentUsedPercent: current.usedPercent,
        previousResetAt: previous.resetAt,
        currentResetAt: current.resetAt,
        source,
        confidence: backfill ? "recovered" : "confirmed",
        alertEligible: !backfill,
      });
      delete next.restoreCandidates[windowName];
    } else if (completed) {
      addEvent(next, {
        type: "reset_completed",
        window: windowName,
        resetAt: previous.resetAt,
        nowMs,
        occurredAt: previous.resetAt,
        previousUsedPercent: previous.usedPercent,
        currentUsedPercent: current.usedPercent,
        previousResetAt: previous.resetAt,
        currentResetAt: current.resetAt,
        source,
        confidence: backfill ? "recovered" : "confirmed",
        alertEligible: !backfill,
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
            occurredAt: new Date(nowMs).toISOString(),
            previousUsedPercent: candidate.baselineUsed,
            currentUsedPercent: current.usedPercent,
            previousResetAt: previous.resetAt,
            currentResetAt: current.resetAt,
            source,
            confidence: backfill ? "recovered" : "confirmed",
            alertEligible: !backfill,
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
  if (normalized.resetCredits) {
    next.resetCredits = normalized.resetCredits;
  }
  return capState(next, { nowMs });
}

function mergeCodexResetSnapshots(
  state,
  snapshots,
  { nowMs = Date.now(), backfill = true } = {},
) {
  let next = normalizeState(state);
  const ordered = Array.isArray(snapshots)
    ? snapshots
      .filter((item) => item && normalizeIso(item.observedAt))
      .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt))
    : [];
  for (const item of ordered) {
    const field = WINDOW_FIELDS[item.window];
    const observedMs = Date.parse(item.observedAt);
    if (!field || !Number.isFinite(observedMs)) continue;
    next = evaluateCodexResetSnapshot(next, {
      configured: true,
      checked_at: new Date(observedMs).toISOString(),
      [field]: {
        used_percent: item.usedPercent,
        reset_at: item.resetAt,
      },
    }, {
      nowMs: observedMs,
      backfill,
      source: item.source === "codex_rollout" ? "codex_rollout" : "live_usage",
    });
  }
  return capState(next, { nowMs });
}

function acknowledgeCodexResetEvent(
  state,
  eventId,
  { channels = null, nowMs = Date.now() } = {},
) {
  const next = normalizeState(state);
  const eventIndex = next.events.findIndex((event) => event.id === eventId);
  if (
    typeof eventId === "string"
    && eventId.length > 0
    && eventId.length <= 128
    && eventIndex >= 0
  ) {
    const scopedChannels = Array.isArray(channels)
      ? [...new Set(channels.filter((channel) => ACKNOWLEDGEMENT_CHANNELS.has(channel)))]
      : [];
    if (scopedChannels.length > 0) {
      next.events[eventIndex] = {
        ...next.events[eventIndex],
        acknowledgedChannels: [...new Set([
          ...next.events[eventIndex].acknowledgedChannels,
          ...scopedChannels,
        ])],
      };
    } else {
      next.acknowledgedEventIds.push(eventId);
    }
  }
  return capState(next, { nowMs });
}

function listUnreadCodexResetEvents(state, { channel = "banner" } = {}) {
  const normalized = normalizeState(state);
  const acknowledged = new Set(normalized.acknowledgedEventIds);
  const safeChannel = ACKNOWLEDGEMENT_CHANNELS.has(channel) ? channel : "banner";
  return normalized.events.filter((event) => (
    !acknowledged.has(event.id)
    && !event.acknowledgedChannels.includes(safeChannel)
  ));
}

module.exports = {
  MONITOR_STATE_VERSION,
  RESET_HISTORY_DAYS,
  acknowledgeCodexResetEvent,
  buildCodexResetEventId,
  compactCodexResetEvents,
  evaluateCodexResetSnapshot,
  listCodexResetHistory,
  listUnreadCodexResetEvents,
  mergeCodexResetSnapshots,
  normalizeCodexResetSnapshot,
};
