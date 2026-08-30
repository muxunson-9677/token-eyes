"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

function request(method = "GET", headers = {}) {
  const req = Readable.from([]);
  req.method = method;
  req.headers = { host: "127.0.0.1", ...headers };
  return req;
}

function response() {
  const chunks = [];
  return {
    statusCode: 200,
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

async function call(handler, pathname, { method = "GET", headers = {} } = {}) {
  const res = response();
  const handled = await handler(
    request(method, headers),
    res,
    new URL(`http://127.0.0.1${pathname}`),
  );
  assert.equal(handled, true);
  return res;
}

test("one configured public origin drives leaderboard, Plan Market, and Reset without credentials", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "token-eyes-public-origin-"));
  const trackerDataDir = path.join(temporaryRoot, "tracker");
  const feedBaseUrl = "https://token-eyes-leaderboard-cache-staging.example.workers.dev/v1";
  const generatedAt = new Date().toISOString();
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const {
    PLAN_MARKET_FEED_SCHEMA,
    hashPlanMarketCatalog,
  } = require("../src/lib/plan-market");
  const { createSignedCodexResetFeedEnvelope } = require("../src/lib/codex-reset-feed");
  const { createSignedStaticFeedEnvelope } = require("../src/lib/signed-static-feed");
  const catalog = JSON.parse(await fs.readFile(
    path.join(__dirname, "..", "shared", "plan-market-catalog.json"),
    "utf8",
  ));
  const planMarketEnvelope = createSignedStaticFeedEnvelope({
    schema_version: PLAN_MARKET_FEED_SCHEMA,
    catalog_version: "2026-08-30.1",
    generated_at: generatedAt,
    source_url: `${feedBaseUrl}/plan-market/feed.json`,
    catalog_sha256: hashPlanMarketCatalog(catalog),
    catalog,
  }, privateKey, {
    keyId: "token-eyes-static-test-01",
    maxPayloadBytes: 5 * 1024 * 1024,
  });
  const resetEnvelope = createSignedCodexResetFeedEnvelope({
    generated_at: generatedAt,
    announcements: [],
  }, privateKey);
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const body = String(url).endsWith("/plan-market/feed.json")
      ? planMarketEnvelope
      : resetEnvelope;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { createLocalApiHandler } = require("../src/lib/local-api");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDataDir, "queue.jsonl"),
      trackerDataDir,
      leaderboardPublicFeedBaseUrl: feedBaseUrl,
      leaderboardPublicKey: publicKey,
    });
    const auth = (await call(handler, "/api/local-auth")).json().token;

    const planMarketResponse = await call(handler, "/functions/tokentracker-plan-market", {
      method: "POST",
      headers: { "x-tokentracker-local-auth": auth },
    });
    assert.equal(planMarketResponse.statusCode, 200);
    assert.equal(planMarketResponse.json().ok, true);
    const resetResult = await handler.codexResetMonitorService.checkFeed({ force: true });
    assert.equal(resetResult.status.feed_error_code, null);

    assert.deepEqual(calls.map((entry) => entry.url), [
      `${feedBaseUrl}/plan-market/feed.json`,
      `${feedBaseUrl}/codex-reset/feed.json`,
    ]);
    for (const callEntry of calls) {
      const headers = callEntry.options.headers || {};
      assert.equal(headers.Authorization, undefined);
      assert.equal(headers.Cookie, undefined);
    }
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../src/lib/local-api")];
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
