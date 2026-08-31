"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

function request() {
  const req = new EventEmitter();
  req.method = "GET";
  req.headers = { host: "127.0.0.1" };
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

test("desktop widget endpoint composes existing usage, limits, lifecycle, and reset data", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-widget-api-"));
  try {
    const queuePath = path.join(root, "queue.jsonl");
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({
      tokenPlans: [{
        id: "codex-main",
        source: "codex",
        provider_id: "codex",
        plan_label: "Codex Plus",
        quota_windows: [{
          kind: "rolling_5_hour",
          percentage: 21,
          resets_at: "2026-07-29T16:00:00.000Z",
        }],
      }],
    }), "utf8");
    fs.writeFileSync(queuePath, `${JSON.stringify({
      source: "codex",
      model: "gpt-5",
      hour_start: "2026-07-29T08:00:00.000Z",
      input_tokens: 80,
      output_tokens: 20,
      total_tokens: 100,
      conversation_count: 1,
    })}\n`, "utf8");
    const reset = {
      id: "reset-safe",
      type: "official_reset_announcement",
      window: null,
      createdAt: "2026-07-29T08:30:00.000Z",
      occurredAt: "2026-07-29T08:30:00.000Z",
      officialUrl: "https://chatgpt.com/codex",
      sourceUrl: "https://x.com/thsottiaux/status/2082317452755751098",
      sourceAuthor: "thsottiaux",
      sourcePostId: "2082317452755751098",
      title: "Codex 官方额外重置",
      summary: "OpenAI 已为 Codex 用户额外重置使用额度。",
      expiresAt: "2026-08-29T08:30:00.000Z",
      source: "signed_feed",
      alertEligible: true,
    };
    const service = {
      start() {},
      stop() {},
      getStatus: () => ({}),
      listUnread: (channel) => channel === "widget" ? [reset] : [],
      listHistory: () => [],
      listNotificationPending: () => [],
    };
    const lifecycleCalls = [];
    const handler = createLocalApiHandler({
      queuePath,
      trackerDataDir: root,
      now: () => new Date("2026-07-29T08:30:00.000Z"),
      codexResetMonitorService: service,
      usageLimitsProvider: async () => ({
        codex: {
          configured: true,
          plan_label: "Codex Plus",
          primary_window: {
            used_percent: 21,
            limit_window_seconds: 18_000,
            reset_at: 1785312000,
          },
        },
      }),
      codexLifecycleProvider: async (options) => {
        lifecycleCalls.push(options);
        return [{
          agent: "codex",
          projectId: "project-safe",
          projectLabel: "Token Eyes",
          sessionId: "session-safe",
          taskLabel: "修复桌面小组件",
          status: "running",
          updatedAt: "2026-07-29T06:30:00.000Z",
        }];
      },
    });
    const res = response();
    const handled = await handler(
      request(),
      res,
      new URL(
        "http://127.0.0.1/functions/tokentracker-desktop-widget"
        + "?agent=codex&active_window=3h",
      ),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    const body = res.json();
    assert.equal(body.selectedAgent, "codex");
    assert.equal(body.totals.tokens, 100);
    assert.equal(body.totals.models[0].name, "gpt-5");
    assert.equal(body.projectStatus.yellow, 1);
    assert.equal(body.projectStatus.projects[0].label, "Token Eyes");
    assert.equal(body.projectStatus.projects[0].sessions[0].label, "修复桌面小组件");
    assert.equal(body.limits[0].usedPercent, 21);
    assert.equal(body.pendingReset.id, "reset-safe");
    assert.equal(lifecycleCalls[0].includeProjectLabels, true);

    const invalidWindowResponse = response();
    await handler(
      request(),
      invalidWindowResponse,
      new URL(
        "http://127.0.0.1/functions/tokentracker-desktop-widget"
        + "?agent=codex&active_window=30m",
      ),
    );
    assert.equal(invalidWindowResponse.json().projectStatus.yellow, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("desktop widget endpoint rejects non-loopback browser origins", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-widget-origin-"));
  try {
    const handler = createLocalApiHandler({
      queuePath: path.join(root, "queue.jsonl"),
      trackerDataDir: root,
      codexResetMonitorService: {
        start() {},
        stop() {},
        getStatus: () => ({}),
        listUnread: () => [],
        listHistory: () => [],
        listNotificationPending: () => [],
      },
    });
    const req = request();
    req.headers.origin = "https://example.com";
    const res = response();
    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-desktop-widget"),
    );
    assert.equal(handled, true);
    assert.equal(res.statusCode, 403);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
