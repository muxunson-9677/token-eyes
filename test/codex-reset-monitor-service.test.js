"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  FEED_CACHE_MS,
  FEED_URL,
  FAILURE_BACKOFF_MS,
  FOCUS_FRESHNESS_MS,
  STARTUP_DELAY_MS,
  SUCCESS_INTERVAL_MS,
  createCodexResetMonitorService,
} = require("../src/lib/codex-reset-monitor-service");
const {
  createSignedCodexResetFeedEnvelope,
} = require("../src/lib/codex-reset-feed");

const BASE = Date.parse("2026-07-20T08:00:00.000Z");

function validSnapshot(nowMs, used = 40) {
  return {
    configured: true,
    checked_at: new Date(nowMs).toISOString(),
    primary_window: {
      used_percent: used,
      reset_at: new Date(nowMs + 60 * 60_000).toISOString(),
    },
    secondary_window: {
      used_percent: 60,
      reset_at: new Date(nowMs + 4 * 24 * 60 * 60_000).toISOString(),
    },
    spark_primary_window: null,
    spark_secondary_window: null,
  };
}

function harness(reader, overrides = {}) {
  let nowMs = BASE;
  const timers = [];
  const cleared = [];
  let saved = null;
  const service = createCodexResetMonitorService({
    getCodexUsageLimits: reader,
    loadState: () => saved,
    saveState: (state) => {
      saved = JSON.parse(JSON.stringify(state));
    },
    now: () => nowMs,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => cleared.push(timer),
    enabled: true,
    ...overrides,
  });
  return {
    service,
    timers,
    cleared,
    getNow: () => nowMs,
    getSaved: () => saved,
    setNow: (value) => {
      nowMs = value;
    },
  };
}

test("uses the exact startup, success, freshness, and failure schedules", async () => {
  assert.equal(STARTUP_DELAY_MS, 10_000);
  assert.equal(SUCCESS_INTERVAL_MS, 30_000);
  assert.equal(FOCUS_FRESHNESS_MS, 60_000);
  assert.deepEqual(FAILURE_BACKOFF_MS, [2 * 60_000, 10 * 60_000, 30 * 60_000]);

  const reads = [];
  const h = harness(async () => {
    reads.push(1);
    return validSnapshot(BASE);
  });
  h.service.start();
  assert.equal(h.timers.at(-1).delay, STARTUP_DELAY_MS);
  await h.service.check({ reason: "timer" });
  assert.equal(reads.length, 1);
  assert.equal(h.timers.at(-1).delay, SUCCESS_INTERVAL_MS);

  const skipped = await h.service.check({ reason: "focus" });
  assert.equal(skipped.skipped, "fresh");
  assert.equal(reads.length, 1);
});

test("backfills 30 days of rollout resets without making them notification pending", async () => {
  const calls = [];
  const h = harness(async () => validSnapshot(BASE), {
    getCodexHomes: () => ["C:/private/codex-home"],
    collectCodexResetSnapshots: async (options) => {
      calls.push(options);
      return {
        snapshots: [
          {
            observedAt: new Date(BASE).toISOString(),
            window: "rolling_weekly",
            usedPercent: 21,
            resetAt: new Date(BASE + 6 * 24 * 60 * 60_000).toISOString(),
            accountKey: null,
            source: "codex_rollout",
          },
          {
            observedAt: new Date(BASE + 60_000).toISOString(),
            window: "rolling_weekly",
            usedPercent: 0,
            resetAt: new Date(BASE + 7 * 24 * 60 * 60_000 + 60_000).toISOString(),
            accountKey: null,
            source: "codex_rollout",
          },
        ],
        cursor: { files: { abcdef0123456789abcdef0123456789: { offset: 42 } } },
      };
    },
  });
  assert.equal(typeof h.service.backfill, "function");
  await h.service.backfill();
  assert.equal(calls[0].sinceMs, BASE - 30 * 24 * 60 * 60_000);
  assert.equal(h.service.listHistory().length, 0);
  assert.equal(h.service.listNotificationPending().length, 0);
  assert.equal(h.getSaved().rolloutCursor.files.abcdef0123456789abcdef0123456789.offset, 42);
  assert.doesNotMatch(JSON.stringify(h.getSaved().rolloutCursor), /private|codex-home/u);
});

test("only signed official extra resets reach unread, history, and native notification surfaces", () => {
  const localEvent = {
    id: "restore-1",
    type: "unexpected_quota_restore",
    window: "rolling_5_hour",
    createdAt: new Date(BASE).toISOString(),
    occurredAt: new Date(BASE).toISOString(),
    resetAt: new Date(BASE + 60 * 60_000).toISOString(),
    officialUrl: "https://chatgpt.com/codex",
    source: "live_usage",
    alertEligible: true,
    deliveredChannels: [],
  };
  const official = {
    id: "official:x:2082317452755751098",
    type: "official_reset_announcement",
    window: null,
    createdAt: new Date(BASE + 60_000).toISOString(),
    sourceUrl: "https://x.com/thsottiaux/status/2082317452755751098",
    officialUrl: "https://chatgpt.com/codex",
    source: "signed_feed",
    alertEligible: true,
    deliveredChannels: [],
    expiresAt: new Date(BASE + 30 * 24 * 60 * 60_000).toISOString(),
  };
  const h = harness(async () => validSnapshot(BASE), {
    loadState: () => ({
      version: 2,
      events: [localEvent, official],
      windows: {},
      restoreCandidates: {},
      acknowledgedEventIds: [],
    }),
  });
  assert.deepEqual(
    h.service.listNotificationPending().map((item) => item.id),
    [official.id],
  );
  assert.deepEqual(h.service.listUnread().map((item) => item.id), [official.id]);
  assert.deepEqual(h.service.listHistory().map((item) => item.id), [official.id]);
});

test("acknowledging the newest official reset never promotes older history into the banner", () => {
  const previous = {
    id: "official:x:2081955008658252238",
    type: "official_reset_announcement",
    window: null,
    createdAt: new Date(BASE - 24 * 60 * 60_000).toISOString(),
    sourceUrl: "https://x.com/thsottiaux/status/2081955008658252238",
    officialUrl: "https://chatgpt.com/codex",
    source: "signed_feed",
    alertEligible: true,
    deliveredChannels: [],
    expiresAt: new Date(BASE + 29 * 24 * 60 * 60_000).toISOString(),
  };
  const latest = {
    ...previous,
    id: "official:x:2082317452755751098",
    createdAt: new Date(BASE).toISOString(),
    sourceUrl: "https://x.com/thsottiaux/status/2082317452755751098",
    expiresAt: new Date(BASE + 30 * 24 * 60 * 60_000).toISOString(),
  };
  const h = harness(async () => validSnapshot(BASE), {
    loadState: () => ({
      version: 2,
      events: [previous, latest],
      windows: {},
      restoreCandidates: {},
      acknowledgedEventIds: [],
    }),
  });

  assert.deepEqual(h.service.listUnread().map((item) => item.id), [latest.id]);
  assert.deepEqual(
    h.service.listNotificationPending().map((item) => item.id),
    [latest.id],
  );
  h.service.acknowledge(latest.id);
  assert.deepEqual(h.service.listUnread(), []);
  assert.deepEqual(h.service.listNotificationPending(), []);
  assert.equal(h.service.listHistory().length, 2);
});

test("signed feed uses a fixed URL, 5-minute cache, and conditional requests", async () => {
  assert.equal(
    FEED_URL,
    "https://token-eyes-leaderboard-cache-staging.token-eyes-labs.workers.dev/v1/codex-reset/feed.json",
  );
  assert.equal(FEED_CACHE_MS, 5 * 60_000);
  const keys = crypto.generateKeyPairSync("ed25519");
  const requests = [];
  const feedPayload = {
    generated_at: new Date(BASE).toISOString(),
    announcements: [{
      id: "codex-reset-promo",
      type: "official_reset_announcement",
      title: "Codex 额外额度活动",
      summary: "请前往官方页面确认是否适用于你的账户。",
      body: "完整声明第一段。\n\n完整声明第二段。",
      source_url: "https://openai.com/index/introducing-codex/",
      official_url: "https://chatgpt.com/codex",
      published_at: new Date(BASE - 60_000).toISOString(),
      expires_at: new Date(BASE + 24 * 60 * 60_000).toISOString(),
    }],
  };
  const responses = [
    {
      ok: true,
      status: 200,
      headers: {
        get: (name) => ({
          etag: "\"feed-v1\"",
          "last-modified": "Sun, 20 Jul 2026 08:00:00 GMT",
        })[name.toLowerCase()] || null,
      },
      json: async () => createSignedCodexResetFeedEnvelope(feedPayload, keys.privateKey),
    },
    { ok: false, status: 304, headers: { get: () => null } },
  ];
  const h = harness(async () => ({ configured: false, checked_at: new Date(BASE).toISOString() }), {
    feedEnabled: true,
    feedPublicKey: keys.publicKey,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return responses.shift();
    },
  });

  await h.service.checkFeed({ force: true });
  assert.equal(requests[0].url, FEED_URL);
  assert.deepEqual(requests[0].options.headers, { Accept: "application/json" });
  const [unread] = h.service.listUnread();
  assert.equal(unread.type, "official_reset_announcement");
  assert.equal(
    unread.occurredAt,
    feedPayload.announcements[0].published_at,
  );
  assert.equal(unread.body, feedPayload.announcements[0].body);
  assert.deepEqual(h.service.getStatus(), {
    enabled: true,
    configured: null,
    running: false,
    last_checked_at: null,
    last_successful_at: null,
    next_check_at: null,
    last_error_code: null,
    failure_count: 0,
    unread_count: 1,
    feed_enabled: true,
    feed_last_checked_at: new Date(BASE).toISOString(),
    feed_generated_at: feedPayload.generated_at,
    latest_published_at: feedPayload.announcements[0].published_at,
    feed_stale: false,
    feed_error_code: null,
    backfill_error_code: null,
  });

  const cached = await h.service.checkFeed();
  assert.equal(cached.skipped, "fresh");
  assert.equal(requests.length, 1);

  h.setNow(BASE + 31 * 60_000);
  await h.service.checkFeed();
  assert.equal(requests[1].options.headers["If-None-Match"], "\"feed-v1\"");
  assert.equal(
    requests[1].options.headers["If-Modified-Since"],
    "Sun, 20 Jul 2026 08:00:00 GMT",
  );
  assert.equal(h.service.listUnread().length, 1);
});

test("manual force bypasses the five-minute feed cache", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const feedPayload = {
    generated_at: new Date(BASE).toISOString(),
    announcements: [],
  };
  let feedReads = 0;
  const h = harness(async () => validSnapshot(BASE), {
    feedEnabled: true,
    feedPublicKey: keys.publicKey,
    fetchImpl: async () => {
      feedReads += 1;
      return feedReads === 1
        ? {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => createSignedCodexResetFeedEnvelope(feedPayload, keys.privateKey),
        }
        : { ok: false, status: 304, headers: { get: () => null } };
    },
  });

  await h.service.checkFeed({ force: true });
  await h.service.check({ reason: "manual", force: true });

  assert.equal(feedReads, 2);
});

test("forced check queued during an ordinary check performs its own feed refresh", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const feedPayload = (generatedOffset, id) => ({
    generated_at: new Date(BASE + generatedOffset).toISOString(),
    announcements: [{
      id,
      type: "official_reset_announcement",
      title: `Reset ${id}`,
      summary: `Summary ${id}`,
      source_url: `https://openai.com/reset/${id}`,
      official_url: "https://chatgpt.com/codex",
      published_at: new Date(BASE - 60_000 + generatedOffset).toISOString(),
      expires_at: new Date(BASE + 24 * 60 * 60_000).toISOString(),
    }],
  });
  const payloads = [
    feedPayload(0, "cached"),
    feedPayload(60_000, "forced"),
  ];
  let resolveOrdinary;
  const ordinaryUsage = new Promise((resolve) => {
    resolveOrdinary = resolve;
  });
  let usageReads = 0;
  let feedReads = 0;
  const h = harness(async () => {
    usageReads += 1;
    if (usageReads === 1) return ordinaryUsage;
    return validSnapshot(BASE);
  }, {
    feedEnabled: true,
    feedPublicKey: keys.publicKey,
    fetchImpl: async () => {
      feedReads += 1;
      const payload = payloads.shift();
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => createSignedCodexResetFeedEnvelope(payload, keys.privateKey),
      };
    },
  });
  await h.service.checkFeed({ force: true });

  const ordinary = h.service.check({ reason: "manual" });
  const forced = h.service.check({ reason: "manual", force: true });
  const duplicateForce = h.service.check({ reason: "manual", force: true });
  assert.equal(feedReads, 1);

  resolveOrdinary(validSnapshot(BASE));
  const ordinaryResult = await ordinary;
  const [forcedResult, duplicateResult] = await Promise.all([forced, duplicateForce]);

  assert.equal(usageReads, 2);
  assert.equal(feedReads, 2);
  assert.equal(
    ordinaryResult.status.feed_generated_at,
    new Date(BASE).toISOString(),
  );
  assert.equal(
    forcedResult.status.feed_generated_at,
    new Date(BASE + 60_000).toISOString(),
  );
  assert.deepEqual(duplicateResult, forcedResult);
  assert.deepEqual(
    h.service.listHistory().map((event) => event.id).sort(),
    ["official:cached", "official:forced"],
  );
});

test("direct forced feed refresh queues behind an ordinary feed fetch without being swallowed", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const feedPayload = (generatedOffset, id) => ({
    generated_at: new Date(BASE + generatedOffset).toISOString(),
    announcements: [{
      id,
      type: "official_reset_announcement",
      title: `Reset ${id}`,
      summary: `Summary ${id}`,
      source_url: `https://openai.com/reset/${id}`,
      official_url: "https://chatgpt.com/codex",
      published_at: new Date(BASE - 60_000 + generatedOffset).toISOString(),
      expires_at: new Date(BASE + 24 * 60 * 60_000).toISOString(),
    }],
  });
  const cachedPayload = feedPayload(0, "cached");
  const ordinaryPayload = feedPayload(5 * 60_000, "ordinary");
  const forcedPayload = feedPayload(6 * 60_000, "forced-direct");
  let resolveOrdinaryFetch;
  const ordinaryFetch = new Promise((resolve) => {
    resolveOrdinaryFetch = resolve;
  });
  let feedReads = 0;
  const responseFor = (payload) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => createSignedCodexResetFeedEnvelope(payload, keys.privateKey),
  });
  const h = harness(async () => validSnapshot(BASE), {
    feedEnabled: true,
    feedPublicKey: keys.publicKey,
    fetchImpl: async () => {
      feedReads += 1;
      if (feedReads === 1) return responseFor(cachedPayload);
      if (feedReads === 2) return ordinaryFetch;
      return responseFor(forcedPayload);
    },
  });
  await h.service.checkFeed({ force: true });
  h.setNow(BASE + 6 * 60_000);

  const ordinary = h.service.checkFeed();
  const forced = h.service.checkFeed({ force: true });
  const duplicateForce = h.service.checkFeed({ force: true });
  assert.equal(feedReads, 2);

  resolveOrdinaryFetch(responseFor(ordinaryPayload));
  const ordinaryResult = await ordinary;
  const [forcedResult, duplicateResult] = await Promise.all([forced, duplicateForce]);

  assert.equal(feedReads, 3);
  assert.equal(ordinaryResult.status.feed_generated_at, ordinaryPayload.generated_at);
  assert.equal(forcedResult.status.feed_generated_at, forcedPayload.generated_at);
  assert.deepEqual(duplicateResult, forcedResult);
  assert.deepEqual(
    h.service.listHistory().map((event) => event.id).sort(),
    ["official:cached", "official:forced-direct", "official:ordinary"],
  );
});

test("signed feed accepts an identical generation but rejects older or conflicting peers", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const announcement = (id, publishedOffset) => ({
    id,
    type: "official_reset_announcement",
    title: `Reset ${id}`,
    summary: `Summary ${id}`,
    source_url: `https://openai.com/reset/${id}`,
    official_url: "https://chatgpt.com/codex",
    published_at: new Date(BASE + publishedOffset).toISOString(),
    expires_at: new Date(BASE + 24 * 60 * 60_000).toISOString(),
  });
  const newest = {
    generated_at: new Date(BASE).toISOString(),
    announcements: [
      announcement("retained", -120_000),
      announcement("newest-only", -60_000),
    ],
  };
  const identical = JSON.parse(JSON.stringify(newest));
  const rollbackCandidates = [
    {
      generated_at: new Date(BASE - 60_000).toISOString(),
      announcements: [announcement("retained", -120_000)],
    },
    {
      generated_at: newest.generated_at,
      announcements: [announcement("retained", -120_000)],
    },
  ];
  const payloads = [newest, identical, ...rollbackCandidates];
  const h = harness(async () => validSnapshot(BASE), {
    feedEnabled: true,
    feedPublicKey: keys.publicKey,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => createSignedCodexResetFeedEnvelope(
        payloads.shift(),
        keys.privateKey,
      ),
    }),
  });

  await h.service.checkFeed({ force: true });
  const expectedIds = h.service.listHistory().map((event) => event.id).sort();
  assert.deepEqual(expectedIds, ["official:newest-only", "official:retained"]);

  await h.service.checkFeed({ force: true });
  assert.equal(h.service.getStatus().feed_generated_at, newest.generated_at);
  assert.equal(h.service.getStatus().feed_error_code, null);
  assert.deepEqual(
    h.service.listHistory().map((event) => event.id).sort(),
    expectedIds,
  );

  for (const candidate of rollbackCandidates) {
    await h.service.checkFeed({ force: true });
    assert.equal(h.service.getStatus().feed_generated_at, newest.generated_at);
    assert.equal(h.service.getStatus().feed_error_code, "feed_rollback");
    assert.deepEqual(
      h.service.listHistory().map((event) => event.id).sort(),
      expectedIds,
      `must reject ${candidate.generated_at} without deleting trusted records`,
    );
  }
});

test("startup rematerializes cached official events when a newer app adds feed metadata", () => {
  const announcement = {
    id: "x:2082317452755751098",
    type: "official_reset_announcement",
    title: "Codex official extra reset",
    summary: "Usage limits were reset for all ChatGPT Work and Codex users.",
    body: "Usage limits were reset for all ChatGPT Work and Codex users.\n\nFull second paragraph.",
    source_url: "https://x.com/thsottiaux/status/2082317452755751098",
    source_author: "thsottiaux",
    source_post_id: "2082317452755751098",
    official_url: "https://chatgpt.com/codex",
    published_at: new Date(BASE - 60_000).toISOString(),
    expires_at: new Date(BASE + 30 * 24 * 60 * 60_000).toISOString(),
    reset_kind: "hard",
    reset_scope: "all_codex_work_users",
  };
  const scheduledAnnouncement = {
    ...announcement,
    id: "x:2090947196107764189",
    summary: "The banked reset will be there by 8pm PST.",
    body: "The banked reset will be there by 8pm PST. For all paid users of ChatGPT Work and Codex.",
    source_url: "https://x.com/thsottiaux/status/2090947196107764189",
    source_post_id: "2090947196107764189",
    published_at: new Date(BASE - 2 * 60_000).toISOString(),
  };
  const h = harness(async () => validSnapshot(BASE), {
    loadState: () => ({
      version: 2,
      events: [{
        id: `official:${announcement.id}`,
        type: "official_reset_announcement",
        createdAt: announcement.published_at,
        expiresAt: announcement.expires_at,
        sourceUrl: announcement.source_url,
        sourceAuthor: announcement.source_author,
        source: "signed_feed",
        alertEligible: true,
      }],
      windows: {},
      restoreCandidates: {},
      acknowledgedEventIds: [],
      feed: {
        fetchedAt: new Date(BASE).toISOString(),
        announcements: [scheduledAnnouncement, announcement],
      },
    }),
  });

  const [event] = h.service.listHistory();
  assert.equal(event.resetKind, "hard");
  assert.equal(event.resetScope, "all_codex_work_users");
  assert.equal(event.sourcePostId, "2082317452755751098");
  assert.equal(event.occurredAt, announcement.published_at);
  assert.equal(event.body, announcement.body);
  assert.equal(h.service.listHistory().length, 1);
  assert.notEqual(event.sourcePostId, scheduledAnnouncement.source_post_id);
});

test("startup removes an orphaned scheduled X event even without cached feed metadata", () => {
  const expiresAt = new Date(BASE + 30 * 24 * 60 * 60_000).toISOString();
  const persistedEvent = (id, body) => ({
    id: `official:x:${id}`,
    type: "official_reset_announcement",
    createdAt: new Date(BASE - 60_000).toISOString(),
    occurredAt: new Date(BASE - 60_000).toISOString(),
    expiresAt,
    officialUrl: "https://chatgpt.com/codex",
    sourceUrl: `https://x.com/thsottiaux/status/${id}`,
    sourceAuthor: "thsottiaux",
    sourcePostId: id,
    summary: body,
    body,
    source: "signed_feed",
    alertEligible: true,
    deliveredChannels: [],
    acknowledgedChannels: [],
  });
  const scheduled = persistedEvent(
    "2091407991736332689",
    "We will do a full reset of usage for all paid subscriptions tomorrow.",
  );
  const confirmed = persistedEvent(
    "2091688655828246890",
    "Reset has been propagated to accounts.",
  );
  const h = harness(async () => validSnapshot(BASE), {
    loadState: () => ({
      version: 2,
      events: [scheduled, confirmed],
      windows: {},
      restoreCandidates: {},
      acknowledgedEventIds: [],
      feed: null,
    }),
  });

  assert.deepEqual(
    h.service.listHistory().map((event) => event.sourcePostId),
    ["2091688655828246890"],
  );
});

test("startup keeps a previously acknowledged duplicate official post read after id compaction", () => {
  const sourcePost = {
    type: "official_reset_announcement",
    createdAt: new Date(BASE - 60_000).toISOString(),
    occurredAt: new Date(BASE - 60_000).toISOString(),
    expiresAt: new Date(BASE + 30 * 24 * 60 * 60_000).toISOString(),
    officialUrl: "https://chatgpt.com/codex",
    sourceUrl: "https://x.com/thsottiaux/status/2091688655828246890",
    sourceAuthor: "thsottiaux",
    sourcePostId: "2091688655828246890",
    summary: "Reset has been propagated to accounts.",
    body: "Reset has been propagated to accounts.",
    source: "signed_feed",
    alertEligible: true,
    deliveredChannels: [],
    acknowledgedChannels: [],
  };
  const h = harness(async () => validSnapshot(BASE), {
    loadState: () => ({
      version: 2,
      events: [
        { ...sourcePost, id: "official:first" },
        { ...sourcePost, id: "official:replacement" },
      ],
      windows: {},
      restoreCandidates: {},
      acknowledgedEventIds: ["official:replacement"],
      feed: null,
    }),
  });

  assert.deepEqual(h.service.listHistory().map((event) => event.id), ["official:first"]);
  assert.deepEqual(h.service.listUnread(), []);
  assert.deepEqual(h.service.listNotificationPending(), []);
});

test("offline or invalid feed keeps prior unexpired events and never blocks quota checks", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  let quotaReads = 0;
  let feedReads = 0;
  const validPayload = {
    generated_at: new Date(BASE).toISOString(),
    announcements: [{
      id: "official-reset",
      type: "official_reset_announcement",
      title: "Codex 重置活动",
      summary: "请以官方页面为准。",
      source_url: "https://openai.com/codex/",
      official_url: "https://chatgpt.com/codex",
      published_at: new Date(BASE - 60_000).toISOString(),
      expires_at: new Date(BASE + 24 * 60 * 60_000).toISOString(),
    }],
  };
  const h = harness(async () => {
    quotaReads += 1;
    return validSnapshot(h.getNow());
  }, {
    feedEnabled: true,
    feedPublicKey: keys.publicKey,
    fetchImpl: async () => {
      feedReads += 1;
      if (feedReads === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => createSignedCodexResetFeedEnvelope(validPayload, keys.privateKey),
        };
      }
      if (feedReads === 2) throw new Error("offline secret");
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ version: 1, payload_b64: "bad", signature_b64: "bad" }),
      };
    },
  });

  await h.service.checkFeed({ force: true });
  h.setNow(BASE + 31 * 60_000);
  await h.service.check({ reason: "manual", force: true });
  assert.equal(quotaReads, 1);
  assert.equal(h.service.listUnread().some((event) => event.id === "official:official-reset"), true);
  assert.equal(h.service.getStatus().feed_error_code, "network_error");
  assert.equal(h.service.getStatus().feed_stale, true);
  assert.equal(
    h.service.getStatus().feed_last_checked_at,
    new Date(BASE + 31 * 60_000).toISOString(),
  );

  h.setNow(BASE + 62 * 60_000);
  await h.service.checkFeed({ force: true });
  assert.equal(h.service.listUnread().some((event) => event.id === "official:official-reset"), true);
  assert.equal(h.service.getStatus().feed_error_code, "invalid_signature");
  assert.doesNotMatch(JSON.stringify(h.service.getStatus()), /offline|secret/);

  h.setNow(BASE + 25 * 60 * 60_000);
  assert.equal(h.service.listUnread().some((event) => event.id === "official:official-reset"), false);
});

test("feed polling can be disabled independently", async () => {
  let feedReads = 0;
  const h = harness(async () => validSnapshot(BASE), {
    feedEnabled: false,
    fetchImpl: async () => {
      feedReads += 1;
    },
  });
  const result = await h.service.checkFeed({ force: true });
  assert.equal(result.skipped, "disabled");
  await h.service.check({ reason: "manual", force: true });
  assert.equal(feedReads, 0);
  assert.equal(h.service.getStatus().last_successful_at, new Date(BASE).toISOString());
});

test("backs off 2, 10, then 30 minutes and caps there", async () => {
  const h = harness(async () => {
    throw new Error("secret network detail");
  });
  h.service.start();
  for (const expected of [
    FAILURE_BACKOFF_MS[0],
    FAILURE_BACKOFF_MS[1],
    FAILURE_BACKOFF_MS[2],
    FAILURE_BACKOFF_MS[2],
  ]) {
    await h.service.check({ reason: "timer", force: true });
    assert.equal(h.timers.at(-1).delay, expected);
  }
  assert.equal(h.service.getStatus().last_error_code, "network_error");
  assert.doesNotMatch(JSON.stringify(h.service.getStatus()), /secret|detail/);
});

test("single-flight, unconfigured state, valid-only evaluation, and stop are safe", async () => {
  let release;
  let calls = 0;
  const h = harness(() => {
    calls += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  h.service.start();
  const first = h.service.check({ reason: "manual", force: true });
  const second = h.service.check({ reason: "manual", force: true });
  assert.equal(first, second);
  assert.equal(calls, 1);
  release({ configured: false, checked_at: new Date(BASE).toISOString() });
  await first;
  assert.equal(h.service.getStatus().configured, false);
  assert.equal(h.service.getStatus().unread_count, 0);
  assert.equal(h.service.listUnread().length, 0);

  h.service.stop();
  assert.ok(h.cleared.length >= 1);
});

test("rolling quota snapshots never create a user-facing reset alert", async () => {
  const resetAt = new Date(BASE + 60 * 60_000).toISOString();
  const h = harness(async () => ({
    ...validSnapshot(BASE, h.getNow() <= Date.parse(resetAt) ? 80 : 0),
    checked_at: new Date(h.getNow()).toISOString(),
    primary_window: {
      used_percent: h.getNow() <= Date.parse(resetAt) ? 80 : 0,
      reset_at: h.getNow() <= Date.parse(resetAt)
        ? resetAt
        : new Date(h.getNow() + 5 * 60 * 60_000).toISOString(),
    },
  }));
  await h.service.check({ reason: "manual", force: true });
  h.setNow(BASE + 61 * 60_000);
  await h.service.check({ reason: "manual", force: true });
  const localEvent = h.getSaved().events.find((event) => event.type === "reset_completed");
  assert.ok(localEvent);
  assert.equal(h.service.listUnread().length, 0);
  assert.equal(h.service.listHistory().length, 0);
  h.service.acknowledge(localEvent.id);
  assert.equal(h.service.listUnread().length, 0);
  assert.ok(h.getSaved().acknowledgedEventIds.includes(localEvent.id));
});

test("service hides rolling-window ledger records from the official reset history", () => {
  const events = Array.from({ length: 6 }, (_, index) => ({
    id: `completed-${index}`,
    type: "reset_completed",
    window: "rolling_5_hour",
    createdAt: new Date(BASE + index * 60_000).toISOString(),
    resetAt: new Date(BASE + index * 60_000).toISOString(),
    officialUrl: "https://chatgpt.com/codex",
    source: "local_quota",
  }));
  events.push({
    ...events[0],
    id: "upcoming",
    type: "reset_upcoming",
    createdAt: new Date(BASE + 30 * 60_000).toISOString(),
  });
  const h = harness(async () => validSnapshot(BASE), {
    loadState: () => ({
      version: 1,
      events,
      windows: {},
      restoreCandidates: {},
      acknowledgedEventIds: [],
    }),
  });

  assert.deepEqual(h.service.listHistory(), []);
});
