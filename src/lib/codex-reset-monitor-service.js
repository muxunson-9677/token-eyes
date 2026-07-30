"use strict";

const {
  acknowledgeCodexResetEvent,
  compactCodexResetEvents,
  evaluateCodexResetSnapshot,
  listCodexResetHistory,
  listUnreadCodexResetEvents,
  mergeCodexResetSnapshots,
} = require("./codex-reset-monitor");
const { verifyCodexResetFeed } = require("./codex-reset-feed");

const STARTUP_DELAY_MS = 10_000;
const SUCCESS_INTERVAL_MS = 30_000;
const FOCUS_FRESHNESS_MS = 60_000;
const FEED_CACHE_MS = 5 * 60_000;
const FEED_URL = "https://a62b9nf2.ap-southeast.insforge.app/functions/tokentracker-codex-reset-feed";
const FAILURE_BACKOFF_MS = Object.freeze([
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
]);

function emptyState() {
  return {
    version: 2,
    lastCheckedAt: null,
    lastSuccessfulAt: null,
    windows: {},
    resetCredits: null,
    restoreCandidates: {},
    events: [],
    acknowledgedEventIds: [],
    rolloutCursor: { files: {} },
    feed: null,
  };
}

function materializeOfficialFeedEvents(events, announcements) {
  const compactedEvents = compactCodexResetEvents(events);
  if (!Array.isArray(announcements)) return compactedEvents;
  const previousById = new Map(compactedEvents.map((event) => [event.id, event]));
  const localEvents = compactedEvents.filter(
    (event) => event.type !== "official_reset_announcement",
  );
  const officialEvents = announcements.map((announcement) => {
    const nextEvent = officialEvent(announcement);
    const previous = previousById.get(nextEvent.id);
    if (!previous) return nextEvent;
    return {
      ...nextEvent,
      deliveredChannels: Array.isArray(previous.deliveredChannels)
        ? previous.deliveredChannels
        : [],
      acknowledgedChannels: Array.isArray(previous.acknowledgedChannels)
        ? previous.acknowledgedChannels
        : [],
    };
  });
  return compactCodexResetEvents([...localEvents, ...officialEvents]);
}

function initializeState(value) {
  const base = emptyState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const feed = value.feed && typeof value.feed === "object" ? value.feed : null;
  return {
    ...base,
    ...value,
    windows: value.windows && typeof value.windows === "object"
      ? value.windows
      : {},
    resetCredits: value.resetCredits && typeof value.resetCredits === "object"
      ? value.resetCredits
      : null,
    restoreCandidates:
      value.restoreCandidates && typeof value.restoreCandidates === "object"
        ? value.restoreCandidates
        : {},
    events: materializeOfficialFeedEvents(value.events, feed?.announcements),
    acknowledgedEventIds: Array.isArray(value.acknowledgedEventIds)
      ? value.acknowledgedEventIds
      : [],
    rolloutCursor: value.rolloutCursor?.files
      ? value.rolloutCursor
      : { files: {} },
    feed,
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
    occurredAt: announcement.published_at,
    resetAt: null,
    officialUrl: announcement.official_url,
    sourceUrl: announcement.source_url,
    sourceAuthor: announcement.source_author || null,
    sourcePostId: announcement.source_post_id || null,
    resetKind: announcement.reset_kind || "unknown",
    resetScope: announcement.reset_scope || "unknown",
    title: announcement.title,
    summary: announcement.summary,
    expiresAt: announcement.expires_at,
    source: "signed_feed",
    alertEligible: true,
    deliveredChannels: [],
    acknowledgedChannels: [],
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
  collectCodexResetSnapshots,
  getCodexHomes = () => [],
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
  let backfillInFlight = null;
  let backfillErrorCode = null;

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

  function latestOfficialEvent() {
    let latest = null;
    let latestMs = Number.NEGATIVE_INFINITY;
    for (const event of state.events) {
      if (event.type !== "official_reset_announcement") continue;
      const createdMs = Date.parse(event.createdAt || "");
      if (!Number.isFinite(createdMs) || createdMs <= latestMs) continue;
      latest = event;
      latestMs = createdMs;
    }
    return latest;
  }

  function listUnread(channel = "banner") {
    const latest = latestOfficialEvent();
    if (!latest) return [];
    const currentMs = now();
    if (
      typeof latest.expiresAt !== "string"
      || Date.parse(latest.expiresAt) <= currentMs
    ) {
      return [];
    }
    const unread = listUnreadCodexResetEvents(state, { channel })
      .find((event) => event.id === latest.id);
    return unread ? [unread] : [];
  }

  function listHistory() {
    return listCodexResetHistory(state, { nowMs: now() })
      .filter((event) => event.type === "official_reset_announcement");
  }

  function listNotificationPending() {
    const latest = latestOfficialEvent();
    if (
      !latest
      || latest.alertEligible !== true
      || latest.deliveredChannels?.includes("windows_notification")
      || state.acknowledgedEventIds.includes(latest.id)
    ) {
      return [];
    }
    return [latest];
  }

  function markDelivered(eventId, channel) {
    if (channel !== "windows_notification") return false;
    const index = state.events.findIndex((event) => event.id === eventId);
    if (index < 0) return false;
    const deliveredChannels = [...new Set([
      ...(Array.isArray(state.events[index].deliveredChannels)
        ? state.events[index].deliveredChannels
        : []),
      channel,
    ])];
    const events = state.events.slice();
    events[index] = { ...events[index], deliveredChannels };
    persist({ ...state, events });
    return true;
  }

  function backfill() {
    if (typeof collectCodexResetSnapshots !== "function") {
      return Promise.resolve({ skipped: "unavailable", status: getStatus() });
    }
    if (backfillInFlight) return backfillInFlight;
    backfillInFlight = (async () => {
      const result = await collectCodexResetSnapshots({
        codexHomes: getCodexHomes(),
        sinceMs: now() - 30 * 24 * 60 * 60_000,
        cursor: state.rolloutCursor,
      });
      const merged = mergeCodexResetSnapshots(state, result.snapshots, {
        nowMs: now(),
        backfill: true,
      });
      persist({
        ...merged,
        rolloutCursor: result.cursor?.files ? result.cursor : { files: {} },
      });
      backfillErrorCode = null;
      return { status: getStatus() };
    })().catch(() => {
      backfillErrorCode = "backfill_failed";
      return { status: getStatus() };
    }).finally(() => {
      backfillInFlight = null;
    });
    return backfillInFlight;
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
      backfill_error_code: backfillErrorCode,
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
            events: materializeOfficialFeedEvents(
              state.events,
              state.feed.announcements,
            ),
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
      const nextState = {
        ...state,
        events: materializeOfficialFeedEvents(state.events, announcements),
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
    void backfill();
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

  function acknowledge(eventId, options) {
    persist(acknowledgeCodexResetEvent(state, eventId, options));
  }

  return {
    acknowledge,
    backfill,
    check,
    checkFeed,
    getStatus,
    listHistory,
    listNotificationPending,
    markDelivered,
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
