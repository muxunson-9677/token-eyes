"use strict";

const {
  acknowledgeCodexResetEvent,
  evaluateCodexResetSnapshot,
  listUnreadCodexResetEvents,
} = require("./codex-reset-monitor");

const STARTUP_DELAY_MS = 30_000;
const SUCCESS_INTERVAL_MS = 10 * 60_000;
const FOCUS_FRESHNESS_MS = 5 * 60_000;
const FAILURE_BACKOFF_MS = Object.freeze([
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
]);

function emptyState() {
  return {
    version: 1,
    lastCheckedAt: null,
    lastSuccessfulAt: null,
    windows: {},
    restoreCandidates: {},
    events: [],
    acknowledgedEventIds: [],
  };
}

function createCodexResetMonitorService({
  getCodexUsageLimits,
  loadState,
  saveState,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  enabled = true,
}) {
  if (typeof getCodexUsageLimits !== "function") {
    throw new TypeError("getCodexUsageLimits is required");
  }

  let state = loadState?.() || emptyState();
  let timer = null;
  let inFlight = null;
  let started = false;
  let failureCount = 0;
  let configured = null;
  let lastErrorCode = null;
  let nextCheckAt = null;

  function schedule(delay) {
    if (!started) return;
    if (timer) clearTimer(timer);
    nextCheckAt = new Date(now() + delay).toISOString();
    timer = setTimer(() => {
      void check({ reason: "timer", force: true });
    }, delay);
    timer?.unref?.();
  }

  function persist(nextState) {
    state = nextState;
    saveState?.(state);
  }

  function getStatus() {
    return {
      enabled,
      configured,
      running: inFlight !== null,
      last_checked_at: state.lastCheckedAt || null,
      last_successful_at: state.lastSuccessfulAt || null,
      next_check_at: nextCheckAt,
      last_error_code: lastErrorCode,
      failure_count: failureCount,
      unread_count: listUnreadCodexResetEvents(state).length,
    };
  }

  function check({ reason = "timer", force = false } = {}) {
    if (!enabled) return Promise.resolve({ skipped: "disabled", status: getStatus() });
    if (inFlight) return inFlight;

    const lastSuccessfulMs = Date.parse(state.lastSuccessfulAt || "");
    if (
      !force
      && (reason === "focus" || reason === "manual")
      && Number.isFinite(lastSuccessfulMs)
      && now() - lastSuccessfulMs < FOCUS_FRESHNESS_MS
    ) {
      return Promise.resolve({ skipped: "fresh", status: getStatus() });
    }

    inFlight = (async () => {
      try {
        const snapshot = await getCodexUsageLimits();
        configured = snapshot?.configured === true;
        if (snapshot?.configured === false) {
          failureCount = 0;
          lastErrorCode = null;
          schedule(SUCCESS_INTERVAL_MS);
          return { status: getStatus() };
        }

        const nextState = evaluateCodexResetSnapshot(state, snapshot, {
          nowMs: now(),
        });
        persist(nextState);
        const failed = Boolean(
          snapshot?.error_code
          || snapshot?.unsupported === true
          || snapshot?.auth_action_required,
        );
        if (failed) {
          failureCount += 1;
          lastErrorCode = snapshot.error_code
            || (snapshot.auth_action_required ? "reauth_required" : "unsupported");
          schedule(FAILURE_BACKOFF_MS[Math.min(
            failureCount - 1,
            FAILURE_BACKOFF_MS.length - 1,
          )]);
        } else {
          failureCount = 0;
          lastErrorCode = null;
          schedule(SUCCESS_INTERVAL_MS);
        }
        return { status: getStatus() };
      } catch (_error) {
        failureCount += 1;
        lastErrorCode = "network_error";
        schedule(FAILURE_BACKOFF_MS[Math.min(
          failureCount - 1,
          FAILURE_BACKOFF_MS.length - 1,
        )]);
        return { status: getStatus() };
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function start() {
    if (!enabled || started) return;
    started = true;
    schedule(STARTUP_DELAY_MS);
  }

  function stop() {
    started = false;
    nextCheckAt = null;
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  }

  function acknowledge(eventId) {
    persist(acknowledgeCodexResetEvent(state, eventId));
  }

  return {
    acknowledge,
    check,
    getStatus,
    listUnread: () => listUnreadCodexResetEvents(state),
    start,
    stop,
  };
}

module.exports = {
  FAILURE_BACKOFF_MS,
  FOCUS_FRESHNESS_MS,
  STARTUP_DELAY_MS,
  SUCCESS_INTERVAL_MS,
  createCodexResetMonitorService,
};
