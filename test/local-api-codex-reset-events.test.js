"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

function request({ method = "GET", headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { host: "127.0.0.1", ...headers };
  process.nextTick(() => {
    if (body !== undefined) req.emit("data", Buffer.from(JSON.stringify(body)));
    req.emit("end");
  });
  return req;
}

function response() {
  const chunks = [];
  return {
    statusCode: null,
    headers: {},
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
      );
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
    },
    json() {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    },
  };
}

async function call(handler, pathname, options = {}) {
  const res = response();
  const handled = await handler(
    request(options),
    res,
    new URL(`http://127.0.0.1${pathname}`),
  );
  assert.equal(handled, true);
  return res;
}

async function authToken(handler) {
  return (await call(handler, "/api/local-auth")).json().token;
}

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-reset-api-"));
  const acknowledgements = [];
  const checks = [];
  const deliveries = [];
  const officialEvent = {
    id: "official:reset-july",
    type: "official_reset_announcement",
    window: null,
    createdAt: "2026-07-20T08:00:00.000Z",
    occurredAt: "2026-07-20T08:00:00.000Z",
    resetAt: null,
    officialUrl: "https://chatgpt.com/codex",
    sourceUrl: "https://x.com/thsottiaux/status/2078990367241046272",
    sourceAuthor: "thsottiaux",
    sourcePostId: "2078990367241046272",
    title: "Codex 官方额外重置",
    summary: "OpenAI 已为 Codex 用户额外重置使用额度。",
    expiresAt: "2026-08-20T08:00:00.000Z",
    source: "signed_feed",
    confidence: "confirmed",
    alertEligible: true,
    access_token: "must-not-leak",
    path: "C:\\private",
  };
  const service = {
    start() {},
    stop() {},
    getStatus: () => ({
      enabled: true,
      configured: true,
      running: false,
      last_checked_at: "2026-07-20T08:00:00.000Z",
      last_successful_at: "2026-07-20T08:00:00.000Z",
      next_check_at: "2026-07-20T08:10:00.000Z",
      last_error_code: null,
      failure_count: 0,
      unread_count: 1,
      feed_enabled: true,
      feed_last_checked_at: "2026-07-20T08:00:00.000Z",
      feed_error_code: null,
      raw_response: "must-not-leak",
    }),
    listUnread: () => [officialEvent],
    listHistory: () => [officialEvent],
    listNotificationPending() {
      return this.listHistory();
    },
    markDelivered: (id, channel) => deliveries.push({ id, channel }),
    acknowledge: (id, options) => acknowledgements.push({ id, options }),
    check: async (options) => {
      checks.push(options);
    },
  };
  const handler = createLocalApiHandler({
    queuePath: path.join(root, "queue.jsonl"),
    trackerDataDir: root,
    codexResetMonitorService: service,
  });
  return { root, handler, acknowledgements, checks, deliveries };
}

test("GET returns no-store sanitized official reset events without auth", async () => {
  const h = harness();
  try {
    const res = await call(h.handler, "/functions/tokentracker-codex-reset-events");
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    const body = res.json();
    assert.equal(body.status.unread_count, 1);
    assert.equal(body.events[0].id, "official:reset-july");
    assert.equal(body.events[0].source_url, "https://x.com/thsottiaux/status/2078990367241046272");
    assert.equal(body.history.length, 1);
    assert.equal(body.history[0].type, "official_reset_announcement");
    assert.equal(body.history[0].source_url, "https://x.com/thsottiaux/status/2078990367241046272");
    assert.equal(body.history[0].occurred_at, "2026-07-20T08:00:00.000Z");
    assert.equal(body.history[0].confidence, "confirmed");
    assert.equal(body.history[0].alert_eligible, true);
    assert.equal(body.notification_events.length, 1);
    assert.doesNotMatch(JSON.stringify(body), /access_token|raw_response|C:\\\\private/i);
  } finally {
    fs.rmSync(h.root, { recursive: true, force: true });
  }
});

test("delivery endpoint persists the allowlisted Windows channel with local auth", async () => {
  const h = harness();
  try {
    const token = await authToken(h.handler);
    const headers = {
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };
    const delivered = await call(
      h.handler,
      "/functions/tokentracker-codex-reset-events/delivered",
      {
        method: "POST",
        headers,
        body: {
          event_id: "official:reset-july",
          channel: "windows_notification",
        },
      },
    );
    assert.equal(delivered.statusCode, 200);
    assert.deepEqual(h.deliveries, [{
      id: "official:reset-july",
      channel: "windows_notification",
    }]);
  } finally {
    fs.rmSync(h.root, { recursive: true, force: true });
  }
});

test("ack and check require local mutation auth and validate bounded inputs", async () => {
  const h = harness();
  try {
    const unauthorized = await call(
      h.handler,
      "/functions/tokentracker-codex-reset-events/ack",
      { method: "POST", body: { event_id: "official:reset-july" } },
    );
    assert.equal(unauthorized.statusCode, 401);

    const token = await authToken(h.handler);
    const headers = {
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };
    const ack = await call(
      h.handler,
      "/functions/tokentracker-codex-reset-events/ack",
      { method: "POST", headers, body: { event_id: "official:reset-july" } },
    );
    assert.equal(ack.statusCode, 200);
    assert.deepEqual(h.acknowledgements, [{
      id: "official:reset-july",
      options: undefined,
    }]);

    const widgetAck = await call(
      h.handler,
      "/functions/tokentracker-codex-reset-events/ack",
      {
        method: "POST",
        headers,
        body: {
          event_id: "official:reset-july",
          channels: ["widget", "tray"],
        },
      },
    );
    assert.equal(widgetAck.statusCode, 200);
    assert.deepEqual(h.acknowledgements[1], {
      id: "official:reset-july",
      options: { channels: ["widget", "tray"] },
    });

    const invalid = await call(
      h.handler,
      "/functions/tokentracker-codex-reset-events/ack",
      { method: "POST", headers, body: { event_id: "x".repeat(129) } },
    );
    assert.equal(invalid.statusCode, 400);

    const checked = await call(
      h.handler,
      "/functions/tokentracker-codex-reset-events/check",
      { method: "POST", headers, body: { force: true } },
    );
    assert.equal(checked.statusCode, 200);
    assert.deepEqual(h.checks, [{ reason: "manual", force: true }]);
  } finally {
    fs.rmSync(h.root, { recursive: true, force: true });
  }
});

test("non-loopback browser origins are rejected", async () => {
  const h = harness();
  try {
    const res = await call(
      h.handler,
      "/functions/tokentracker-codex-reset-events",
      { headers: { origin: "https://evil.example" } },
    );
    assert.equal(res.statusCode, 403);
  } finally {
    fs.rmSync(h.root, { recursive: true, force: true });
  }
});
