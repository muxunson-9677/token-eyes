"use strict";

const {
  acknowledgeCodexResetEvent,
  evaluateCodexResetSnapshot,
  listUnreadCodexResetEvents,
} = require("./codex-reset-monitor");
const { verifyCodexResetFeed } = require("./codex-reset-feed");

const STARTUP_DELAY_MS = 30_000;
const SUCCESS_INTERVAL_MS = 10 * 60_000;
const FOCUS_FRESHNESS_MS = 5 * 60_000;
const FEED_CACHE_MS = 30 * 60_000;
const FEED_URL = "https://www.tokentracker.cc/.well-known/token-eyes/codex-reset-feed.json";
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
    feed: null,
  };
}

function initializeState(value) {
  const base = emptyState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  return {
    ...base,
    ...value,
    windows: value.windows && typeof value.windows === "object"
      ? value.windows
      : {},
    restoreCandidates:
      value.restoreCandidates && typeof value.restoreCandidates === "object"
        ? value.restoreCandidates
        : {},
    events: Array.isArray(value.events) ? value.events : [],
    acknowledgedEventIds: Array.isArray(value.acknowledgedEventIds)
      ? value.acknowledgedEventIds
      : [],
    feed: value.feed && typeof value.feed === "object" ? value.feed : null,
  };
}

function safeHeader(value) {
  return typeof value === "string"
    && value.length <= 512
    && !/[\r\n]/u.test(value)
    ? value
    : null;
}

function officialEvent(announcement) {
  return {
    id: `official:${announcement.id}`,
    type: "official_reset_announcement",
    window: null,
    createdAt: announcement.published_at,
    resetAt: null,
    officialUrl: announcement.official_url,
    sourceUrl: announcement.source_url,
    sourceAuthor: announcement.source_author || null,
    sourcePostId: announcement.source_post_id || null,
    title: announcement.title,
    summary: announcement.summary,
    expiresAt: announcement.expires_at,
    source: "signed_feed",
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
  feedEnabled = false,
  feedUrl = FEED_URL,
  feedPublicKey,
  fetchImpl = fetch,
}) {
  if (typeof getCodexUsageLimits !== "function") {
    throw new TypeError("getCodexUsageLimits is required");
  }

  let state = initializeState(loadState?.());
  let timer = null;
  let feedTimer = null;
  let inFlight = null;
  let feedInFlight = null;
  let started = false;
  let failureCount = 0;
  let configured = null;
  let lastErrorCode = null;
  let nextCheckAt = null;
  let feedErrorCode = null;
  let lastFeedAttemptAt = 0;

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

  function listUnread() {
    const currentMs = now();
    return listUnreadCodexResetEvents(state).filter((event) => (
      event.type !== "official_reset_announcement"
      || (typeof event.expiresAt === "string" && Date.parse(event.expiresAt) > currentMs)
    ));
  }

  function scheduleFeed(delay = FEED_CACHE_MS) {
    if (!started || !feedEnabled) return;
    if (feedTimer) clearTimer(feedTimer);
    feedTimer = setTimer(() => {
      void checkFeed({ force: true });
    }, delay);
    feedTimer?.unref?.();
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
      unread_count: listUnread().length,
      feed_enabled: feedEnabled,
      feed_last_checked_at: state.feed?.fetchedAt || null,
      feed_error_code: feedErrorCode,
    };
  }

  function checkFeed({ force = false } = {}) {
    if (!feedEnabled) {
      return Promise.resolve({ skipped: "disabled", status: getStatus() });
    }
    if (feedInFlight) return feedInFlight;
    if (!force && lastFeedAttemptAt && now() - lastFeedAttemptAt < FEED_CACHE_MS) {
      return Promise.resolve({ skipped: "fresh", status: getStatus() });
    }

    feedInFlight = (async () => {
      lastFeedAttemptAt = now();
      if (!feedPublicKey) {
        feedErrorCode = "verification_unavailable";
        return { status: getStatus() };
      }
      const headers = { Accept: "application/json" };
      const etag = safeHeader(state.feed?.etag);
      const lastModified = safeHeader(state.feed?.lastModified);
      if (etag) headers["If-None-Match"] = etag;
      if (lastModified) headers["If-Modified-Since"] = lastModified;

      let response;
      try {
        response = await fetchImpl(feedUrl, { method: "GET", headers });
      } catch (_error) {
        feedErrorCode = "network_error";
        return { status: getStatus() };
      }

      if (response.status === 304) {
        if (state.feed?.announcements) {
          persist({
            ...state,
            feed: {
              ...state.feed,
              fetchedAt: new Date(now()).toISOString(),
            },
          });
          feedErrorCode = null;
        } else {
          feedErrorCode = "invalid_not_modified";
        }
        return { status: getStatus() };
      }
      if (!response.ok) {
        feedErrorCode = "http_error";
        return { status: getStatus() };
      }

      let payload;
      try {
        const envelope = await response.json();
        payload = verifyCodexResetFeed(envelope, {
          publicKey: feedPublicKey,
          nowMs: now(),
        });
      } catch (_error) {
        feedErrorCode = "invalid_signature";
        return { status: getStatus() };
      }

      const announcements = payload.announcements.map((item) => ({ ...item }));
      const localEvents = state.events.filter(
        (event) => event.type !== "official_reset_announcement",
      );
      const nextState = {
        ...state,
        events: [...localEvents, ...announcements.map(officialEvent)].slice(-100),
        feed: {
          fetchedAt: new Date(now()).toISOString(),
          etag: safeHeader(response.headers?.get?.("etag")),
          lastModified: safeHeader(response.headers?.get?.("last-modified")),
          announcements,
        },
      };
      persist(nextState);
      feedErrorCode = null;
      return { status: getStatus() };
    })().catch(() => {
      feedErrorCode = "network_error";
      return { status: getStatus() };
    }).finally(() => {
      scheduleFeed();
      feedInFlight = null;
    });
    return feedInFlight;
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
        } else {
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
        }
      } catch (_error) {
        failureCount += 1;
        lastErrorCode = "network_error";
        schedule(FAILURE_BACKOFF_MS[Math.min(
          failureCount - 1,
          FAILURE_BACKOFF_MS.length - 1,
        )]);
      }
      await checkFeed();
      return { status: getStatus() };
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function start() {
    if (started) return;
    started = true;
    if (enabled) schedule(STARTUP_DELAY_MS);
    scheduleFeed(STARTUP_DELAY_MS);
  }

  function stop() {
    started = false;
    nextCheckAt = null;
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    if (feedTimer) {
      clearTimer(feedTimer);
      feedTimer = null;
    }
  }

  function acknowledge(eventId) {
    persist(acknowledgeCodexResetEvent(state, eventId));
  }

  return {
    acknowledge,
    check,
    checkFeed,
    getStatus,
    listUnread,
    start,
    stop,
  };
}

module.exports = {
  FEED_CACHE_MS,
  FEED_URL,
  FAILURE_BACKOFF_MS,
  FOCUS_FRESHNESS_MS,
  STARTUP_DELAY_MS,
  SUCCESS_INTERVAL_MS,
  createCodexResetMonitorService,
};
