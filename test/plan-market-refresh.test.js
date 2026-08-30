"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PLAN_MARKET_FEED_SCHEMA,
  PLAN_MARKET_FEED_URL,
  createPlanMarketUpdateService,
  diffPlanMarketCatalogs,
  hashPlanMarketCatalog,
  resolvePlanMarketSnapshotPath,
} = require("../src/lib/plan-market");
const { createSignedStaticFeedEnvelope } = require("../src/lib/signed-static-feed");

const feedKeys = crypto.generateKeyPairSync("ed25519");

const bundledCatalog = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "shared", "plan-market-catalog.json"),
  "utf8",
));

test("plan market uses the signed public static feed URL", () => {
  assert.equal(PLAN_MARKET_FEED_URL, "https://feeds.tokentracker.cc/v1/plan-market/feed.json");
});

test("plan market accepts an exact HTTPS staging feed URL and binds the signed source to it", async () => {
  const trackerDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-staging-"));
  const feedUrl = "https://token-eyes-leaderboard-cache-staging.example.workers.dev/v1/plan-market/feed.json";
  const calls = [];
  const service = createPlanMarketUpdateService({
    trackerDataDir,
    feedUrl,
    publicKey: feedKeys.publicKey,
    now: () => new Date("2026-08-30T08:05:00.000Z"),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(signedFeed(bundledCatalog, {
        source_url: feedUrl,
        generated_at: "2026-08-30T08:00:00.000Z",
      }));
    },
  });

  try {
    const refreshed = await service.refresh();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, feedUrl);
    assert.equal(refreshed.refresh.source_url, feedUrl);
    assert.equal(refreshed.refresh.last_successful_at, "2026-08-30T08:05:00.000Z");
  } finally {
    await fsp.rm(trackerDataDir, { recursive: true, force: true });
  }
});

test("plan market rejects an unsigned catalog payload", async () => {
  const trackerDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-unsigned-"));
  const service = createPlanMarketUpdateService({
    trackerDataDir,
    fetchImpl: async () => response(feed()),
  });
  try {
    await assert.rejects(service.refresh(), (error) => error?.code === "feed_signature_invalid");
  } finally {
    await fsp.rm(trackerDataDir, { recursive: true, force: true });
  }
});

function response(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
  };
}

function feed(catalog = bundledCatalog, overrides = {}) {
  return {
    schema_version: PLAN_MARKET_FEED_SCHEMA,
    catalog_version: "2026-08-27.1",
    generated_at: "2026-08-27T08:00:00.000Z",
    source_url: PLAN_MARKET_FEED_URL,
    catalog_sha256: hashPlanMarketCatalog(catalog),
    catalog,
    ...overrides,
  };
}

function signedFeed(catalog = bundledCatalog, overrides = {}) {
  return createSignedStaticFeedEnvelope(feed(catalog, overrides), feedKeys.privateKey, {
    keyId: "token-eyes-static-test",
  });
}

function syntheticCatalog(plans, provider = {}) {
  return {
    _meta: { version: 1, updated_at: provider.updated_at || "2026-08-20" },
    providers: [{
      id: "provider-a",
      display_name: provider.display_name || "Provider A",
      plans,
    }],
  };
}

function plan(planId, {
  amount = 10,
  quota = "100 requests",
  status = "active",
  fetchedAt = "2026-08-20T00:00:00.000Z",
} = {}) {
  return {
    plan_id: planId,
    display_name: `Plan ${planId}`,
    status,
    price: { amount, currency: "USD", cycle: "monthly" },
    quota_summary: quota,
    highlights: ["Feature"],
    evidence: { fetched_at: fetchedAt, content_sha256: "a".repeat(64) },
  };
}

test("plan market diff reports real plan, price, listing, and content changes", () => {
  assert.equal(typeof diffPlanMarketCatalogs, "function");
  const before = syntheticCatalog([
    plan("price"),
    plan("removed"),
    plan("relisted", { status: "discontinued" }),
    plan("delisted"),
    plan("content"),
  ]);
  const after = syntheticCatalog([
    plan("price", { amount: 12 }),
    plan("relisted"),
    plan("delisted", { status: "discontinued" }),
    plan("content", { quota: "200 requests" }),
    plan("added"),
  ], { display_name: "Provider A updated" });

  assert.deepEqual(diffPlanMarketCatalogs(before, after), {
    providers_added: 0,
    providers_changed: 1,
    providers_removed: 0,
    plans_added: 1,
    plans_changed: 4,
    plans_removed: 1,
    price_changed: 1,
    listed: 2,
    delisted: 2,
  });
});

test("plan market diff ignores verification timestamps without hiding content changes", () => {
  const before = syntheticCatalog([plan("same")], { updated_at: "2026-08-20" });
  const timestampOnly = syntheticCatalog([
    plan("same", { fetchedAt: "2026-08-27T00:00:00.000Z" }),
  ], { updated_at: "2026-08-27" });
  assert.deepEqual(diffPlanMarketCatalogs(before, timestampOnly), {
    providers_added: 0,
    providers_changed: 0,
    providers_removed: 0,
    plans_added: 0,
    plans_changed: 0,
    plans_removed: 0,
    price_changed: 0,
    listed: 0,
    delisted: 0,
  });

  const effectiveDateChanged = structuredClone(timestampOnly);
  effectiveDateChanged.providers[0].plans[0].evidence.valid_until = "2026-09-30";
  assert.equal(diffPlanMarketCatalogs(before, effectiveDateChanged).plans_changed, 1);
});

test("plan market refresh validates the public feed and atomically persists its last-known-good snapshot", async () => {
  assert.equal(typeof createPlanMarketUpdateService, "function");
  const trackerDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-refresh-"));
  const calls = [];
  const service = createPlanMarketUpdateService({
    trackerDataDir,
    publicKey: feedKeys.publicKey,
    now: () => new Date("2026-08-27T08:05:00.000Z"),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(signedFeed());
    },
  });

  try {
    const refreshed = await service.refresh();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, PLAN_MARKET_FEED_URL);
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.redirect, "error");
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.refresh.last_successful_at, "2026-08-27T08:05:00.000Z");
    assert.equal(refreshed.refresh.catalog_version, "2026-08-27.1");
    assert.equal(refreshed.catalog.providers.length, bundledCatalog.providers.length);

    const snapshotPath = resolvePlanMarketSnapshotPath(trackerDataDir);
    const snapshot = JSON.parse(await fsp.readFile(snapshotPath, "utf8"));
    assert.equal(snapshot.catalog_sha256, hashPlanMarketCatalog(snapshot.catalog));
    assert.equal(snapshot.last_successful_at, "2026-08-27T08:05:00.000Z");
    assert.deepEqual(
      (await fsp.readdir(trackerDataDir)).filter((name) => name.includes(".tmp.")),
      [],
    );
  } finally {
    await fsp.rm(trackerDataDir, { recursive: true, force: true });
  }
});

test("plan market refresh rejects unallowlisted, unhashed, and incompatible payloads while retaining last-known-good data", async () => {
  const trackerDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-reject-"));
  const payloads = [
    signedFeed(),
    signedFeed(bundledCatalog, { source_url: "https://raw.githubusercontent.com/private/catalog.json" }),
    signedFeed(bundledCatalog, { catalog_sha256: "0".repeat(64) }),
    signedFeed(bundledCatalog, { schema_version: "token-eyes.plan-market-feed/v2" }),
  ];
  let nowMs = Date.parse("2026-08-27T08:05:00.000Z");
  const service = createPlanMarketUpdateService({
    trackerDataDir,
    publicKey: feedKeys.publicKey,
    now: () => new Date(nowMs),
    fetchImpl: async () => response(payloads.shift()),
  });

  try {
    const good = await service.refresh();
    const expectedHash = good.refresh.catalog_sha256;
    for (const expectedCode of ["feed_source_rejected", "feed_hash_mismatch", "feed_schema_unsupported"]) {
      nowMs += 60_000;
      await assert.rejects(
        service.refresh(),
        (error) => error?.code === expectedCode,
      );
      const current = service.read();
      assert.equal(current.refresh.catalog_sha256, expectedHash);
      assert.equal(current.refresh.last_successful_at, "2026-08-27T08:05:00.000Z");
      assert.equal(current.refresh.error_code, expectedCode);
    }
  } finally {
    await fsp.rm(trackerDataDir, { recursive: true, force: true });
  }
});

test("plan market refresh rejects a redirect outside the exact public feed and an older replay", async () => {
  const trackerDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-replay-"));
  const redirected = {
    ...response(signedFeed()),
    redirected: true,
    url: "https://raw.githubusercontent.com/private/catalog.json",
  };
  const older = signedFeed(bundledCatalog, {
    catalog_version: "2026-08-26.1",
    generated_at: "2026-08-26T08:00:00.000Z",
  });
  const responses = [response(signedFeed()), redirected, response(older)];
  const service = createPlanMarketUpdateService({
    trackerDataDir,
    publicKey: feedKeys.publicKey,
    now: () => new Date("2026-08-27T08:05:00.000Z"),
    fetchImpl: async () => responses.shift(),
  });

  try {
    const good = await service.refresh();
    await assert.rejects(service.refresh(), (error) => error?.code === "feed_source_rejected");
    await assert.rejects(service.refresh(), (error) => error?.code === "feed_rollback_rejected");
    assert.equal(service.read().refresh.catalog_sha256, good.refresh.catalog_sha256);
  } finally {
    await fsp.rm(trackerDataDir, { recursive: true, force: true });
  }
});

test("plan market refresh is single-flight", async () => {
  const trackerDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-single-"));
  let resolveFetch;
  let fetchCount = 0;
  const service = createPlanMarketUpdateService({
    trackerDataDir,
    publicKey: feedKeys.publicKey,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Promise((resolve) => { resolveFetch = resolve; });
    },
  });

  try {
    const first = service.refresh();
    const second = service.refresh();
    assert.equal(fetchCount, 1);
    resolveFetch(response(signedFeed()));
    const [left, right] = await Promise.all([first, second]);
    assert.deepEqual(left, right);
    assert.equal(fetchCount, 1);
  } finally {
    await fsp.rm(trackerDataDir, { recursive: true, force: true });
  }
});

test("plan market reader ignores a structurally corrupt snapshot and falls back to the bundled catalog", async () => {
  const trackerDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-corrupt-"));
  try {
    await fsp.writeFile(resolvePlanMarketSnapshotPath(trackerDataDir), JSON.stringify({
      version: 1,
      source_url: PLAN_MARKET_FEED_URL,
      catalog_sha256: "f".repeat(64),
      last_successful_at: "2026-08-27T08:05:00.000Z",
    }));
    const service = createPlanMarketUpdateService({
      trackerDataDir,
      fetchImpl: async () => response(feed()),
    });
    const current = service.read();
    assert.equal(current.catalog.providers.length, bundledCatalog.providers.length);
    assert.equal(current.refresh.last_successful_at, null);
  } finally {
    await fsp.rm(trackerDataDir, { recursive: true, force: true });
  }
});

test("plan market refresh timeout covers a response body that never finishes", async () => {
  const trackerDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-body-timeout-"));
  const service = createPlanMarketUpdateService({
    trackerDataDir,
    fetchTimeoutMs: 10,
    fetchImpl: async () => ({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => new Promise(() => {}),
    }),
  });

  try {
    await assert.rejects(
      Promise.race([
        service.refresh(),
        new Promise((resolve, reject) => setTimeout(() => reject(new Error("body_timeout_not_enforced")), 100)),
      ]),
      (error) => error?.code === "feed_unavailable",
    );
  } finally {
    await fsp.rm(trackerDataDir, { recursive: true, force: true });
  }
});

test("plan market refresh aborts and cancels a stalled streamed response body", async () => {
  const trackerDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-stream-timeout-"));
  let cancelCount = 0;
  const body = new ReadableStream({
    pull() {},
    cancel() { cancelCount += 1; },
  });
  const service = createPlanMarketUpdateService({
    trackerDataDir,
    fetchTimeoutMs: 10,
    fetchImpl: async () => new Response(body, {
      headers: { "content-type": "application/json" },
    }),
  });

  try {
    await assert.rejects(
      Promise.race([
        service.refresh(),
        new Promise((resolve, reject) => setTimeout(() => reject(new Error("stream_timeout_not_enforced")), 100)),
      ]),
      (error) => error?.code === "feed_unavailable",
    );
    assert.equal(cancelCount, 1);
  } finally {
    await fsp.rm(trackerDataDir, { recursive: true, force: true });
  }
});

test("plan market refresh stops reading an oversized streamed body at the byte limit", async () => {
  const trackerDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-stream-limit-"));
  const chunk = new Uint8Array(1024 * 1024);
  const totalChunks = 20;
  let pullCount = 0;
  const body = new ReadableStream({
    pull(controller) {
      pullCount += 1;
      if (pullCount <= totalChunks) controller.enqueue(chunk);
      if (pullCount === totalChunks) controller.close();
    },
  });
  const service = createPlanMarketUpdateService({
    trackerDataDir,
    fetchImpl: async () => new Response(body, {
      headers: { "content-type": "application/json" },
    }),
  });

  try {
    await assert.rejects(
      service.refresh(),
      (error) => error?.code === "feed_too_large",
    );
    assert.ok(pullCount < totalChunks, `oversized body was fully buffered (${pullCount} chunks)`);
  } finally {
    await fsp.rm(trackerDataDir, { recursive: true, force: true });
  }
});

test("plan market refresh rejects duplicate provider identities before replacing LKG", async () => {
  const trackerDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-duplicate-provider-"));
  const duplicateCatalog = structuredClone(bundledCatalog);
  duplicateCatalog.providers.push(structuredClone(bundledCatalog.providers[0]));
  const service = createPlanMarketUpdateService({
    trackerDataDir,
    publicKey: feedKeys.publicKey,
    fetchImpl: async () => response(signedFeed(duplicateCatalog)),
  });

  try {
    await assert.rejects(
      service.refresh(),
      (error) => error?.code === "feed_catalog_invalid",
    );
    assert.equal(service.read().refresh.last_successful_at, null);
  } finally {
    await fsp.rm(trackerDataDir, { recursive: true, force: true });
  }
});

test("plan market refresh rejects duplicate plans and invalid status or price values", async () => {
  const invalidCatalogs = [
    (() => {
      const catalog = structuredClone(bundledCatalog);
      catalog.providers[0].plans.push(structuredClone(catalog.providers[0].plans[0]));
      return catalog;
    })(),
    (() => {
      const catalog = structuredClone(bundledCatalog);
      catalog.providers[0].plans[0].status = "surprise";
      return catalog;
    })(),
    (() => {
      const catalog = structuredClone(bundledCatalog);
      catalog.providers[0].plans[0].price.amount = -1;
      return catalog;
    })(),
    (() => {
      const catalog = structuredClone(bundledCatalog);
      catalog.providers[0].sources[0].label = { unsafe: true };
      return catalog;
    })(),
    (() => {
      const catalog = structuredClone(bundledCatalog);
      catalog.providers[0].plans[0].highlights = [{ unsafe: true }];
      return catalog;
    })(),
  ];

  for (const [index, catalog] of invalidCatalogs.entries()) {
    const trackerDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), `tokentracker-plan-market-invalid-${index}-`));
    const service = createPlanMarketUpdateService({
      trackerDataDir,
      publicKey: feedKeys.publicKey,
      fetchImpl: async () => response(signedFeed(catalog)),
    });
    try {
      await assert.rejects(
        service.refresh(),
        (error) => error?.code === "feed_catalog_invalid",
      );
      assert.equal(service.read().refresh.last_successful_at, null);
    } finally {
      await fsp.rm(trackerDataDir, { recursive: true, force: true });
    }
  }
});
