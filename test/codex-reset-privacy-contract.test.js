"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");
const {
  evaluateCodexResetSnapshot,
} = require("../src/lib/codex-reset-monitor");

const FORBIDDEN_KEYS = new Set([
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "raw_response",
  "account_id",
  "user_id",
  "project",
  "conversation",
  "skill",
  "mcp",
  "path",
  "x_bearer_token",
]);
const OPENAI_HOSTS = new Set([
  "help.openai.com",
  "openai.com",
  "www.openai.com",
  "chatgpt.com",
  "www.chatgpt.com",
]);

function assertNoForbiddenKeys(value, trail = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert.equal(
      FORBIDDEN_KEYS.has(key.toLowerCase()),
      false,
      `forbidden key ${trail}.${key}`,
    );
    assertNoForbiddenKeys(item, `${trail}.${key}`);
  }
}

function assertSafeEventUrls(event) {
  const official = new URL(event.official_url);
  assert.equal(official.protocol, "https:");
  assert.equal(OPENAI_HOSTS.has(official.hostname.toLowerCase()), true);

  if (!event.source_url) return;
  const source = new URL(event.source_url);
  if (source.hostname.toLowerCase() !== "x.com") {
    assert.equal(OPENAI_HOSTS.has(source.hostname.toLowerCase()), true);
    return;
  }
  const match = source.pathname.match(
    /^\/(OpenAI|thsottiaux)\/status\/([0-9]+)\/?$/u,
  );
  assert.ok(match, "X source must be an exact allowlisted status URL");
  assert.equal(event.source_author, match[1]);
  assert.equal(event.source_post_id, match[2]);
}

function request() {
  const req = new EventEmitter();
  req.method = "GET";
  req.headers = { host: "127.0.0.1" };
  process.nextTick(() => req.emit("end"));
  return req;
}

function response() {
  const chunks = [];
  return {
    statusCode: null,
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
    },
    json() {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    },
  };
}

async function readResetDto(service) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-reset-privacy-"));
  try {
    const handler = createLocalApiHandler({
      queuePath: path.join(root, "queue.jsonl"),
      trackerDataDir: root,
      codexResetMonitorService: service,
    });
    const res = response();
    const handled = await handler(
      request(),
      res,
      new URL("http://127.0.0.1/functions/tokentracker-codex-reset-events"),
    );
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    return res.json();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("persisted reset monitor state contains only aggregate reset metadata", () => {
  const nowMs = Date.parse("2026-07-20T08:00:00.000Z");
  const state = evaluateCodexResetSnapshot({}, {
    configured: true,
    checked_at: new Date(nowMs).toISOString(),
    primary_window: {
      used_percent: 45,
      reset_at: new Date(nowMs + 20 * 60_000).toISOString(),
    },
    access_token: "must-not-persist",
    project: "must-not-persist",
    path: "C:\\private",
  }, { nowMs });

  assertNoForbiddenKeys(state);
  assert.doesNotMatch(JSON.stringify(state), /must-not-persist|C:\\\\private/u);
});

test("local reset DTO strips secrets and rejects mismatched X source identity", async () => {
  const common = {
    id: "official:reset",
    type: "official_reset_announcement",
    window: null,
    createdAt: "2026-07-20T08:00:00.000Z",
    resetAt: null,
    officialUrl: "https://chatgpt.com/codex",
    title: "Codex reset",
    summary: "Confirm on the official page.",
    expiresAt: "2026-08-20T08:00:00.000Z",
    source: "signed_feed",
    access_token: "must-not-leak",
    raw_response: "must-not-leak",
    path: "C:\\private",
  };
  const dto = await readResetDto({
    getStatus: () => ({
      enabled: true,
      configured: true,
      unread_count: 2,
      authorization: "must-not-leak",
    }),
    listUnread: () => [
      {
        ...common,
        sourceUrl: "https://x.com/thsottiaux/status/2078990367241046272",
        sourceAuthor: "thsottiaux",
        sourcePostId: "2078990367241046272",
      },
      {
        ...common,
        id: "official:mismatch",
        sourceUrl: "https://x.com/OpenAI/status/2078990367241046273",
        sourceAuthor: "thsottiaux",
        sourcePostId: "2078990367241046272",
      },
    ],
    listHistory: () => [],
  });

  assertNoForbiddenKeys(dto);
  assert.doesNotMatch(JSON.stringify(dto), /must-not-leak|C:\\\\private/u);
  assert.equal(dto.events.length, 1);
  dto.events.forEach(assertSafeEventUrls);
});

test("desktop tray bridge has a narrow aggregate-only invoke payload", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../dashboard/src/lib/codex-reset-tray.ts"),
    "utf8",
  );
  const invokePayload = source.match(
    /invoke\("set_codex_reset_tray_status",\s*\{([^}]+)\}/u,
  );
  assert.ok(invokePayload);
  assert.match(invokePayload[1], /^\s*unreadCount,\s*latestType,\s*$/u);
  for (const key of FORBIDDEN_KEYS) {
    assert.doesNotMatch(invokePayload[1], new RegExp(`\\b${key}\\b`, "iu"));
  }
});
