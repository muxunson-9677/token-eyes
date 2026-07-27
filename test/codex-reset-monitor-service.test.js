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
  assert.equal(SUCCESS_INTERVAL_MS, 2 * 60_000);
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

test("signed feed uses a fixed URL, 5-minute cache, and conditional requests", async () => {
  assert.equal(
    FEED_URL,
    "https://a62b9nf2.ap-southeast.insforge.app/functions/tokentracker-codex-reset-feed",
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
  assert.equal(h.service.listUnread()[0].type, "official_reset_announcement");

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

test("valid snapshots enter the state machine and acknowledgement persists", async () => {
  const resetAt = new Date(BASE + 60 * 60_000).toISOString();
  const h = harness(async () => ({
    ...validSnapshot(BASE, 80),
    checked_at: new Date(h.getNow()).toISOString(),
    primary_window: {
      used_percent: 80,
      reset_at: resetAt,
    },
  }));
  await h.service.check({ reason: "manual", force: true });
  h.setNow(BASE + 31 * 60_000);
  await h.service.check({ reason: "manual", force: true });
  const unread = h.service.listUnread();
  assert.equal(unread.length, 1);
  h.service.acknowledge(unread[0].id);
  assert.equal(h.service.listUnread().length, 0);
  assert.ok(h.getSaved().acknowledgedEventIds.includes(unread[0].id));
});

test("service exposes only the latest three actual reset records", () => {
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

  assert.deepEqual(
    h.service.listHistory().map((event) => event.id),
    ["completed-5", "completed-4", "completed-3"],
  );
});
