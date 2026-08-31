"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { after, afterEach, test } = require("node:test");
const { createSignedStaticFeedEnvelope } = require("../src/lib/signed-static-feed");

const trackerDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-leaderboard-public-"));
const keys = crypto.generateKeyPairSync("ed25519");
const feedBaseUrl = "https://feeds.example.test/v1";
const generatedAt = "2026-08-30T08:00:00.000Z";
const originalFetch = global.fetch;

after(() => fs.rmSync(trackerDataDir, { recursive: true, force: true }));
afterEach(() => {
  global.fetch = originalFetch;
  delete require.cache[require.resolve("../src/lib/local-api")];
});

function request() {
  const req = Readable.from([]);
  req.method = "GET";
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
      for (const [key, value] of Object.entries(values)) headers[key.toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
    },
    body() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

async function call(handler, search = "") {
  const res = response();
  const handled = await handler(
    request(),
    res,
    new URL(`http://127.0.0.1/functions/tokentracker-leaderboard-public${search}`),
  );
  assert.equal(handled, true);
  return res;
}

function signedPayload(overrides = {}) {
  const payload = {
    schema_version: "token-eyes.leaderboard-snapshot/v1",
    snapshot_key: "30d/tokens/all",
    generated_at: generatedAt,
    entries: [{ rank: 1, display_name: "Public User", total_tokens: "4321" }],
    participant_count: 2,
    ranked_entry_count: 2,
    aggregate_total_tokens: 5000,
    aggregate_total_cost_usd: 5,
    ...overrides,
  };
  return createSignedStaticFeedEnvelope(payload, keys.privateKey, {
    keyId: "token-eyes-static-2026-01",
  });
}

function createHandler() {
  const { createLocalApiHandler } = require("../src/lib/local-api");
  return createLocalApiHandler({
    queuePath: "",
    trackerDataDir,
    leaderboardPublicFeedBaseUrl: feedBaseUrl,
    leaderboardPublicKey: keys.publicKey,
    now: () => new Date("2026-08-30T08:01:00.000Z"),
  });
}

test("reads one signed fixed Top 50 object without credentials or InsForge fallback", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(signedPayload()), {
      status: 200,
      headers: { "Content-Type": "application/json", ETag: "\"snapshot-v1\"" },
    });
  };
  const res = await call(
    createHandler(),
    "?period=30d&metric=tokens&source=all&limit=50&offset=0",
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["x-leaderboard-cache"], "MISS");
  assert.equal(JSON.parse(res.body()).entries[0].display_name, "Public User");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${feedBaseUrl}/leaderboard/30d/tokens/all.json`);
  assert.deepEqual(calls[0].options.headers, { Accept: "application/json" });
  assert.doesNotMatch(calls[0].url, /insforge/u);
});

test("a fresh handler serves the disk LKG when the static object is unavailable", async () => {
  global.fetch = async () => new Response(JSON.stringify(signedPayload()), { status: 200 });
  const seeded = await call(createHandler(), "?period=30d&metric=tokens&source=all");
  assert.equal(seeded.statusCode, 200);

  global.fetch = async () => {
    throw new Error("offline private detail");
  };
  delete require.cache[require.resolve("../src/lib/local-api")];
  const stale = await call(createHandler(), "?period=30d&metric=tokens&source=all");

  assert.equal(stale.statusCode, 200);
  assert.equal(stale.headers["x-leaderboard-cache"], "LKG");
  assert.equal(JSON.parse(stale.body()).stale, true);
  assert.equal(JSON.parse(stale.body()).cache_state, "lkg");
  assert.equal(JSON.parse(stale.body()).revalidating, true);
  assert.equal(JSON.parse(stale.body()).entries[0].display_name, "Public User");
  assert.doesNotMatch(stale.body(), /offline|private detail/u);
});

test("returns a verified disk LKG immediately while one background refresh updates it", async () => {
  global.fetch = async () => new Response(JSON.stringify(signedPayload({
    entries: [{ rank: 1, display_name: "Cached User", total_tokens: "4321" }],
  })), { status: 200 });
  const seeded = await call(createHandler(), "?period=30d&metric=tokens&source=all&refresh=1");
  assert.equal(seeded.statusCode, 200);

  let releaseRefresh;
  global.fetch = async () => new Promise((resolve) => {
    releaseRefresh = () => resolve(new Response(JSON.stringify(signedPayload({
      generated_at: "2026-08-30T08:00:30.000Z",
      entries: [{ rank: 1, display_name: "Fresh User", total_tokens: "5432" }],
    })), { status: 200 }));
  });
  delete require.cache[require.resolve("../src/lib/local-api")];
  const fastResult = await Promise.race([
    call(createHandler(), "?period=30d&metric=tokens&source=all"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("LKG response exceeded 100ms")), 100)),
  ]);

  assert.equal(fastResult.headers["x-leaderboard-cache"], "LKG");
  assert.equal(JSON.parse(fastResult.body()).entries[0].display_name, "Cached User");
  assert.equal(JSON.parse(fastResult.body()).revalidating, true);
  releaseRefresh();

  await new Promise((resolve) => setTimeout(resolve, 25));
  global.fetch = async () => {
    throw new Error("offline after refresh");
  };
  delete require.cache[require.resolve("../src/lib/local-api")];
  const refreshedLkg = await call(createHandler(), "?period=30d&metric=tokens&source=all");
  assert.equal(JSON.parse(refreshedLkg.body()).entries[0].display_name, "Fresh User");
});

test("joins one in-flight cold refresh for normal and explicit refresh requests", async () => {
  let fetchCalls = 0;
  let releaseRefresh;
  global.fetch = async () => {
    fetchCalls += 1;
    return new Promise((resolve) => {
      releaseRefresh = () => resolve(new Response(JSON.stringify(signedPayload({
        snapshot_key: "today/tokens/all",
      })), { status: 200 }));
    });
  };
  const handler = createHandler();
  const normal = call(handler, "?period=today&metric=tokens&source=all");
  const explicit = call(handler, "?period=today&metric=tokens&source=all&refresh=1");

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetchCalls, 1);
  releaseRefresh();
  const [normalResult, explicitResult] = await Promise.all([normal, explicit]);

  assert.equal(normalResult.statusCode, 200);
  assert.equal(explicitResult.statusCode, 200);
  assert.equal(JSON.parse(normalResult.body()).cache_state, "live");
  assert.equal(JSON.parse(explicitResult.body()).cache_state, "live");
  assert.equal(fetchCalls, 1);
});

test("rejects pagination and non-whitelisted snapshot keys before any network read", async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(signedPayload()), { status: 200 });
  };
  const handler = createHandler();

  const paged = await call(handler, "?period=30d&metric=tokens&source=all&limit=20&offset=0");
  const offset = await call(handler, "?period=30d&metric=tokens&source=all&limit=50&offset=1");
  const unknown = await call(handler, "?period=30d&metric=tokens&source=secret-agent");

  assert.equal(paged.statusCode, 400);
  assert.equal(offset.statusCode, 400);
  assert.equal(unknown.statusCode, 400);
  assert.equal(calls, 0);
});
