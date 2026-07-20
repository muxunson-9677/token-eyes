"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { afterEach, beforeEach, test } = require("node:test");

let tmpHome;
let previousHome;
let previousUserProfile;
let previousDeviceToken;
let previousInsforgeKey;
let previousFetch;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-leaderboard-state-"));
  previousHome = process.env.HOME;
  previousUserProfile = process.env.USERPROFILE;
  previousDeviceToken = process.env.TOKENTRACKER_DEVICE_TOKEN;
  previousInsforgeKey = process.env.TOKENTRACKER_INSFORGE_ANON_KEY;
  previousFetch = global.fetch;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.TOKENTRACKER_DEVICE_TOKEN = "super-secret-device-token";
  process.env.TOKENTRACKER_INSFORGE_ANON_KEY = "super-secret-insforge-key";
});

afterEach(() => {
  for (const [key, value] of [
    ["HOME", previousHome],
    ["USERPROFILE", previousUserProfile],
    ["TOKENTRACKER_DEVICE_TOKEN", previousDeviceToken],
    ["TOKENTRACKER_INSFORGE_ANON_KEY", previousInsforgeKey],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  global.fetch = previousFetch;
  delete require.cache[require.resolve("../src/lib/local-api")];
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function createHandler() {
  const trackerDir = path.join(tmpHome, ".tokentracker", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(
    path.join(trackerDir, "config.json"),
    JSON.stringify({ machineId: "stable-machine-id", deviceToken: "never-return-this" }),
  );
  fs.writeFileSync(
    queuePath,
    `${JSON.stringify({
      hour_start: "2026-07-20T01:00:00.000Z",
      source: "codex",
      model: "gpt-5.4",
      input_tokens: 100,
      output_tokens: 20,
      cached_input_tokens: 10,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 130,
      conversation_count: 42,
      project: "private-project",
      cwd: "C:\\Users\\private\\secret",
      skill: "private-skill",
      mcp: "private-mcp",
      path: "C:\\Users\\private\\chat.jsonl",
    })}\n`,
  );
  delete require.cache[require.resolve("../src/lib/local-api")];
  const { createLocalApiHandler } = require("../src/lib/local-api");
  return createLocalApiHandler({ queuePath, trackerDataDir: trackerDir });
}

function request(method = "GET") {
  const req = Readable.from([]);
  req.method = method;
  req.headers = { host: "127.0.0.1" };
  return req;
}

function response() {
  const chunks = [];
  const headers = {};
  return {
    statusCode: 200,
    headers,
    writeHead(statusCode, values = {}) {
      this.statusCode = statusCode;
      for (const [key, value] of Object.entries(values)) {
        headers[key.toLowerCase()] = value;
      }
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
    },
    body() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

async function call(handler, method = "GET") {
  const res = response();
  const handled = await handler(
    request(method),
    res,
    new URL("http://127.0.0.1/functions/tokentracker-leaderboard-state"),
  );
  assert.equal(handled, true);
  return res;
}

test("returns only compact allowlisted state without contacting InsForge", async () => {
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    throw new Error("leaderboard state endpoint must remain local");
  };
  const res = await call(createHandler());
  const body = JSON.parse(res.body());

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(body.ok, true);
  assert.match(body.summary_hash, /^[a-f0-9]{64}$/);
  assert.equal(body.state.device_id, "stable-machine-id");
  assert.equal(body.state.version, 1);
  assert.match(body.state.captured_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(body.state.periods.total, [
    ["codex", "gpt-5.4", "100", "20", "10", "0", "0"],
  ]);
  assert.ok(Buffer.byteLength(JSON.stringify(body.state), "utf8") <= 8192);
  assert.equal(fetchCalls.length, 0);

  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "super-secret-device-token",
    "super-secret-insforge-key",
    "never-return-this",
    "private-project",
    "private-skill",
    "private-mcp",
    "conversation_count",
    "chat.jsonl",
    "C:\\Users\\private",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `must omit ${forbidden}`);
  }
});

test("rejects non-GET leaderboard state requests", async () => {
  const res = await call(createHandler(), "POST");
  assert.equal(res.statusCode, 405);
  assert.deepEqual(JSON.parse(res.body()), {
    ok: false,
    error: "Method Not Allowed",
  });
});
