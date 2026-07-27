"use strict";

const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { afterEach, test } = require("node:test");

const previousFetch = global.fetch;

afterEach(() => {
  global.fetch = previousFetch;
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

test("preserves the rolling 30-day public leaderboard period without credentials", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push([url, options]);
    return new Response(JSON.stringify({ entries: [{ rank: 1, display_name: "Public User" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath: "" });

  const res = await call(handler, "?period=30d&metric=tokens&source=all&limit=20&offset=0");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body()), {
    entries: [{ rank: 1, display_name: "Public User" }],
  });
  assert.equal(calls.length, 1);
  const upstream = new URL(calls[0][0]);
  assert.equal(upstream.hostname, "a62b9nf2.function2.insforge.app");
  assert.equal(upstream.searchParams.get("period"), "30d");
  assert.equal(upstream.searchParams.get("metric"), "tokens");
  assert.equal(upstream.searchParams.get("source"), "all");
  assert.deepEqual(calls[0][1].headers, { Accept: "application/json" });
});

test("serves a repeated public leaderboard request from the local cache", async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      entries: [],
      participant_count: 0,
      aggregate_total_tokens: 0,
      aggregate_total_cost_usd: 0,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath: "" });

  const first = await call(handler, "?period=total&metric=tokens&source=all&limit=20&offset=0");
  const second = await call(handler, "?period=total&metric=tokens&source=all&limit=20&offset=0");

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(calls, 1);
  assert.equal(second.headers["x-leaderboard-cache"], "HIT");
});

test("falls back to the public snapshot table when the edge function is slow or unavailable", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("function2.insforge.app")) {
      return new Response("unavailable", { status: 503 });
    }
    if (String(url).includes("select=total_tokens%2Cestimated_cost_usd")) {
      return new Response(JSON.stringify([
        { total_tokens: "4321", estimated_cost_usd: "4.32" },
        { total_tokens: "679", estimated_cost_usd: "0.68" },
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify([{
      rank: 1,
      total_tokens: "4321",
      estimated_cost_usd: "4.32",
      actual_cost_usd: null,
      source_breakdown: [],
      display_name: "Snapshot User",
      generated_at: "2026-07-22T08:00:00.000Z",
    }]), {
      status: 200,
      headers: { "Content-Type": "application/json", "Content-Range": "0-0/2" },
    });
  };
  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath: "" });

  const res = await call(handler, "?period=total&metric=tokens&source=all&limit=20&offset=0");

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body()).entries[0].display_name, "Snapshot User");
  assert.equal(JSON.parse(res.body()).total_entries, 2);
  assert.equal(JSON.parse(res.body()).participant_count, 2);
  assert.equal(JSON.parse(res.body()).aggregate_total_tokens, 5000);
  assert.equal(JSON.parse(res.body()).aggregate_total_cost_usd, 5);
  assert.equal(calls.length, 3);
  assert.match(calls[1], /leaderboard_snapshots_v2/);
});
