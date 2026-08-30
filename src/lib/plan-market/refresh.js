"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { verifySignedStaticFeed } = require("../signed-static-feed");

const PLAN_MARKET_FEED_SCHEMA = "token-eyes.plan-market-feed/v1";
const PLAN_MARKET_FEED_URL = "https://feeds.tokentracker.cc/v1/plan-market/feed.json";
const PLAN_MARKET_SNAPSHOT_VERSION = 1;
const PLAN_MARKET_SNAPSHOT_FILE = "plan-market-snapshot.json";
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const PLAN_STATUS_VALUES = new Set(["active", "available", "discontinued", "removed", "unavailable"]);
const PLAN_CYCLE_VALUES = new Set(["monthly", "quarterly", "yearly", "one_time"]);
const PROVIDER_ACCESS_VALUES = new Set(["direct", "vpn"]);
const PROVIDER_RISK_VALUES = new Set(["low", "medium", "high", "extreme"]);
const PROVIDER_REGION_VALUES = new Set(["CN", "GLOBAL"]);
const PROVIDER_TAG_VALUES = new Set(["discount", "hot", "new"]);
const PLAN_BADGE_VALUES = new Set(["entry", "hot", "premium", "recommended"]);
const BUNDLED_CATALOG_PATH = path.join(__dirname, "..", "..", "..", "shared", "plan-market-catalog.json");
const PROVIDER_LINKS_PATH = path.join(__dirname, "..", "..", "..", "shared", "provider-links.json");
const STATIC_FEED_PUBLIC_KEY_PATH = path.join(__dirname, "..", "codex-reset-feed-public-key.pem");

class PlanMarketRefreshError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PlanMarketRefreshError";
    this.code = code;
  }
}

function normalizePlanMarketFeedUrl(value = PLAN_MARKET_FEED_URL) {
  let url;
  try {
    url = new URL(String(value || PLAN_MARKET_FEED_URL));
  } catch {
    throw new PlanMarketRefreshError("feed_source_rejected", "套餐目录来源不在允许列表中。");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || url.pathname !== "/v1/plan-market/feed.json"
    || url.search
    || url.hash
  ) {
    throw new PlanMarketRefreshError("feed_source_rejected", "套餐目录来源不在允许列表中。");
  }
  return url.toString();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPlanMarketCatalog(catalog) {
  return crypto.createHash("sha256").update(canonicalJson(catalog), "utf8").digest("hex");
}

function withoutVolatileEvidence(value) {
  if (Array.isArray(value)) return value.map(withoutVolatileEvidence);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if ([
      "evidence",
      "fetched_at",
      "last_verified",
      "updated_at",
      "content_sha256",
      "content_hash_kind",
      "is_stale",
    ].includes(key)) continue;
    result[key] = withoutVolatileEvidence(entry);
  }
  return result;
}

function listed(plan) {
  return !["discontinued", "unavailable", "removed"].includes(
    String(plan?.status || "active").trim().toLowerCase(),
  );
}

function providerBusinessValue(provider) {
  const { plans: _plans, evidence: _evidence, sources: _sources, last_verified: _verified, ...rest } = provider || {};
  return withoutVolatileEvidence(rest);
}

function planContentValue(plan) {
  const { price: _price, alt_prices: _altPrices, status: _status, ...rest } = plan || {};
  return {
    ...withoutVolatileEvidence(rest),
    effective_dates: {
      valid_from: plan?.evidence?.valid_from ?? null,
      valid_until: plan?.evidence?.valid_until ?? null,
    },
  };
}

function planPriceValue(plan) {
  return withoutVolatileEvidence({ price: plan?.price ?? null, alt_prices: plan?.alt_prices ?? null });
}

function indexCatalog(catalog) {
  const providers = new Map();
  const plans = new Map();
  for (const provider of catalog?.providers || []) {
    const providerId = String(provider?.id || "");
    if (!providerId) continue;
    providers.set(providerId, provider);
    for (const candidate of provider.plans || []) {
      const planId = String(candidate?.plan_id || "");
      if (planId) plans.set(`${providerId}\u0000${planId}`, candidate);
    }
  }
  return { providers, plans };
}

function emptyDiff() {
  return {
    providers_added: 0,
    providers_changed: 0,
    providers_removed: 0,
    plans_added: 0,
    plans_changed: 0,
    plans_removed: 0,
    price_changed: 0,
    listed: 0,
    delisted: 0,
  };
}

function diffPlanMarketCatalogs(before, after) {
  const previous = indexCatalog(before);
  const next = indexCatalog(after);
  const diff = emptyDiff();

  for (const [id, provider] of next.providers) {
    const oldProvider = previous.providers.get(id);
    if (!oldProvider) diff.providers_added += 1;
    else if (canonicalJson(providerBusinessValue(oldProvider)) !== canonicalJson(providerBusinessValue(provider))) {
      diff.providers_changed += 1;
    }
  }
  for (const id of previous.providers.keys()) {
    if (!next.providers.has(id)) diff.providers_removed += 1;
  }

  for (const [key, candidate] of next.plans) {
    const oldPlan = previous.plans.get(key);
    if (!oldPlan) {
      diff.plans_added += 1;
      if (listed(candidate)) diff.listed += 1;
      continue;
    }
    const priceChanged = canonicalJson(planPriceValue(oldPlan)) !== canonicalJson(planPriceValue(candidate));
    const contentChanged = canonicalJson(planContentValue(oldPlan)) !== canonicalJson(planContentValue(candidate));
    const statusChanged = String(oldPlan.status || "active") !== String(candidate.status || "active");
    if (priceChanged) diff.price_changed += 1;
    if (priceChanged || contentChanged || statusChanged) diff.plans_changed += 1;
    if (!listed(oldPlan) && listed(candidate)) diff.listed += 1;
    if (listed(oldPlan) && !listed(candidate)) diff.delisted += 1;
  }
  for (const [key, candidate] of previous.plans) {
    if (next.plans.has(key)) continue;
    diff.plans_removed += 1;
    if (listed(candidate)) diff.delisted += 1;
  }
  return diff;
}

function resolvePlanMarketSnapshotPath(trackerDataDir) {
  if (typeof trackerDataDir !== "string" || trackerDataDir.trim() === "") {
    throw new TypeError("trackerDataDir is required");
  }
  return path.join(path.resolve(trackerDataDir), PLAN_MARKET_SNAPSHOT_FILE);
}

function safeIso(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError("now must be a valid date");
  return date.toISOString();
}

function assertDisplayString(value, maximum = 240) {
  return typeof value === "string"
    && value.trim() !== ""
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function assertPriceSchema(price) {
  if (!price || typeof price !== "object" || Array.isArray(price)) return false;
  if (!Object.hasOwn(price, "amount")) return assertDisplayString(price.display, 240);
  return typeof price.amount === "number"
    && Number.isFinite(price.amount)
    && price.amount >= 0
    && price.amount <= 1_000_000_000
    && /^[A-Z]{3}$/u.test(String(price.currency || ""))
    && PLAN_CYCLE_VALUES.has(price.cycle);
}

function assertPlanMarketCatalogSchema(catalog) {
  if (
    !catalog
    || typeof catalog !== "object"
    || Array.isArray(catalog)
    || catalog?._meta?.version !== 1
    || !Array.isArray(catalog.providers)
  ) {
    throw new PlanMarketRefreshError("feed_catalog_invalid", "套餐目录内容无效。");
  }
  const providerIds = new Set();
  for (const provider of catalog.providers) {
    if (
      !provider
      || typeof provider !== "object"
      || Array.isArray(provider)
      || !PROVIDER_ID_PATTERN.test(String(provider.id || ""))
      || providerIds.has(provider.id)
      || !assertDisplayString(provider.display_name)
      || !Array.isArray(provider.plans)
      || !Array.isArray(provider.sources)
      || (provider.announcement !== undefined && !assertDisplayString(provider.announcement, 2000))
      || (provider.tags !== undefined && (
        !Array.isArray(provider.tags)
        || provider.tags.some((tag) => !PROVIDER_TAG_VALUES.has(tag))
      ))
      || (provider.region !== undefined && !PROVIDER_REGION_VALUES.has(provider.region))
      || (provider.access !== undefined && !PROVIDER_ACCESS_VALUES.has(provider.access))
      || (provider.risk !== undefined && !PROVIDER_RISK_VALUES.has(provider.risk))
    ) {
      throw new PlanMarketRefreshError("feed_catalog_invalid", "套餐目录内容无效。");
    }
    providerIds.add(provider.id);

    const sourceIds = new Set();
    for (const source of provider.sources) {
      if (
        !source
        || typeof source !== "object"
        || Array.isArray(source)
        || !assertDisplayString(source.link_id, 160)
        || !assertDisplayString(source.label, 320)
        || sourceIds.has(source.link_id)
        || !Array.isArray(source.supports)
        || source.supports.some((support) => !assertDisplayString(support, 80))
      ) {
        throw new PlanMarketRefreshError("feed_catalog_invalid", "套餐目录内容无效。");
      }
      sourceIds.add(source.link_id);
    }

    const planIds = new Set();
    for (const plan of provider.plans) {
      if (
        !plan
        || typeof plan !== "object"
        || Array.isArray(plan)
        || !PROVIDER_ID_PATTERN.test(String(plan.plan_id || ""))
        || planIds.has(plan.plan_id)
        || !assertDisplayString(plan.display_name)
        || !PLAN_STATUS_VALUES.has(plan.status)
        || !assertPriceSchema(plan.price)
        || !assertDisplayString(plan.quota_summary, 2000)
        || (plan.highlights !== undefined && (
          !Array.isArray(plan.highlights)
          || plan.highlights.some((highlight) => !assertDisplayString(highlight, 1000))
        ))
        || (plan.badges !== undefined && (
          !Array.isArray(plan.badges)
          || plan.badges.some((badge) => !PLAN_BADGE_VALUES.has(badge))
        ))
        || (plan.alt_prices !== undefined && (
          !Array.isArray(plan.alt_prices)
          || plan.alt_prices.some((price) => !assertPriceSchema(price))
        ))
      ) {
        throw new PlanMarketRefreshError("feed_catalog_invalid", "套餐目录内容无效。");
      }
      planIds.add(plan.plan_id);
    }
  }
}

function assertFeedEnvelope(payload, feedUrl) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PlanMarketRefreshError("feed_invalid", "套餐目录响应格式无效。");
  }
  if (payload.schema_version !== PLAN_MARKET_FEED_SCHEMA) {
    throw new PlanMarketRefreshError("feed_schema_unsupported", "套餐目录协议版本不受支持。");
  }
  if (payload.source_url !== feedUrl) {
    throw new PlanMarketRefreshError("feed_source_rejected", "套餐目录来源不在允许列表中。");
  }
  if (!/^\d{4}-\d{2}-\d{2}[^\s]{0,96}$/u.test(String(payload.catalog_version || ""))) {
    throw new PlanMarketRefreshError("feed_version_invalid", "套餐目录版本无效。");
  }
  if (!Number.isFinite(Date.parse(String(payload.generated_at || "")))) {
    throw new PlanMarketRefreshError("feed_generated_at_invalid", "套餐目录生成时间无效。");
  }
  assertPlanMarketCatalogSchema(payload.catalog);
  const actualHash = hashPlanMarketCatalog(payload.catalog);
  if (!/^[a-f0-9]{64}$/u.test(String(payload.catalog_sha256 || "")) || payload.catalog_sha256 !== actualHash) {
    throw new PlanMarketRefreshError("feed_hash_mismatch", "套餐目录完整性校验失败。");
  }
}

function readJson(pathname, fsImpl) {
  try {
    return JSON.parse(fsImpl.readFileSync(pathname, "utf8"));
  } catch {
    return null;
  }
}

function writeSnapshotAtomic(snapshotPath, value, fsImpl, nowMs) {
  fsImpl.mkdirSync(path.dirname(snapshotPath), { recursive: true, mode: 0o700 });
  const tempPath = `${snapshotPath}.tmp.${process.pid}.${nowMs}`;
  try {
    fsImpl.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fsImpl.renameSync(tempPath, snapshotPath);
  } finally {
    try {
      fsImpl.rmSync(tempPath, { force: true });
    } catch {
      // Atomic rename normally consumes the temporary path.
    }
  }
}

function abortPromise(signal) {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("aborted"));
      return;
    }
    signal?.addEventListener("abort", () => reject(signal.reason || new Error("aborted")), { once: true });
  });
}

function withAbort(promise, signal) {
  return signal ? Promise.race([promise, abortPromise(signal)]) : promise;
}

async function readLimitedResponseText(response, signal) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FEED_BYTES) {
    throw new PlanMarketRefreshError("feed_too_large", "套餐目录响应超出大小限制。");
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let byteLength = 0;
    let complete = false;
    try {
      while (true) {
        const { done, value } = await withAbort(reader.read(), signal);
        if (done) {
          complete = true;
          break;
        }
        const chunk = Buffer.from(value);
        byteLength += chunk.byteLength;
        if (byteLength > MAX_FEED_BYTES) {
          throw new PlanMarketRefreshError("feed_too_large", "套餐目录响应超出大小限制。");
        }
        chunks.push(chunk);
      }
    } finally {
      if (!complete) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return Buffer.concat(chunks, byteLength).toString("utf8");
  }

  const text = await withAbort(response.text(), signal);
  if (Buffer.byteLength(text, "utf8") > MAX_FEED_BYTES) {
    throw new PlanMarketRefreshError("feed_too_large", "套餐目录响应超出大小限制。");
  }
  return text;
}

function createPlanMarketUpdateService({
  trackerDataDir,
  projectCatalog,
  fetchImpl = globalThis.fetch,
  fsImpl = fs,
  now = () => new Date(),
  feedUrl = PLAN_MARKET_FEED_URL,
  publicKey,
  fetchTimeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  if (typeof projectCatalog !== "function") throw new TypeError("projectCatalog is required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  const resolvedFeedUrl = normalizePlanMarketFeedUrl(feedUrl);
  const snapshotPath = resolvePlanMarketSnapshotPath(trackerDataDir);
  const bundledCatalog = readJson(BUNDLED_CATALOG_PATH, fsImpl);
  const providerLinks = readJson(PROVIDER_LINKS_PATH, fsImpl);
  const feedPublicKey = publicKey || fsImpl.readFileSync(STATIC_FEED_PUBLIC_KEY_PATH, "utf8");
  if (!bundledCatalog || !providerLinks) throw new Error("Bundled plan market data is unavailable");

  let cache;
  let lastErrorCode = null;
  let lastCheckedAt = null;
  let inFlight = null;

  function validateCatalog(catalog, at) {
    try {
      assertPlanMarketCatalogSchema(catalog);
      return projectCatalog(catalog, providerLinks, { now: at });
    } catch (_error) {
      throw new PlanMarketRefreshError("feed_catalog_invalid", "套餐目录证据校验失败。");
    }
  }

  function loadSnapshot() {
    if (cache !== undefined) return cache;
    const parsed = readJson(snapshotPath, fsImpl);
    if (
      parsed?.version === PLAN_MARKET_SNAPSHOT_VERSION
      && parsed.source_url === resolvedFeedUrl
      && parsed.catalog
      && typeof parsed.catalog === "object"
      && !Array.isArray(parsed.catalog)
      && Array.isArray(parsed.catalog.providers)
      && parsed.catalog_sha256 === hashPlanMarketCatalog(parsed.catalog)
      && Number.isFinite(Date.parse(String(parsed.last_successful_at || "")))
    ) {
      try {
        validateCatalog(parsed.catalog, now());
        cache = parsed;
        return cache;
      } catch {
        // Corrupt or no-longer-valid snapshots never replace the bundled seed.
      }
    }
    cache = null;
    return cache;
  }

  function currentRaw() {
    return loadSnapshot()?.catalog || bundledCatalog;
  }

  function publicState() {
    const stored = loadSnapshot();
    const at = now();
    return {
      ok: true,
      catalog: validateCatalog(currentRaw(), at),
      refresh: {
        source_url: resolvedFeedUrl,
        source_status: lastErrorCode ? "unreachable" : "configured",
        last_checked_at: lastCheckedAt,
        last_successful_at: stored?.last_successful_at || null,
        catalog_version: stored?.catalog_version || null,
        catalog_sha256: stored?.catalog_sha256 || hashPlanMarketCatalog(bundledCatalog),
        changes: stored?.changes || emptyDiff(),
        error_code: lastErrorCode,
      },
    };
  }

  async function refreshOnce() {
    const checkedAt = safeIso(now());
    lastCheckedAt = checkedAt;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller && fetchTimeoutMs > 0
      ? setTimeout(() => controller.abort(), fetchTimeoutMs)
      : null;
    let response;
    let text;
    try {
      response = await withAbort(fetchImpl(resolvedFeedUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller?.signal,
      }), controller?.signal);
      if (!response?.ok) {
        throw new PlanMarketRefreshError("feed_unavailable", "远程套餐目录暂不可用，已保留上次成功数据。");
      }
      const responseUrl = String(response.url || resolvedFeedUrl);
      if (responseUrl !== resolvedFeedUrl) {
        throw new PlanMarketRefreshError("feed_source_rejected", "套餐目录来源不在允许列表中。");
      }
      const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
      if (!contentType.includes("application/json")) {
        throw new PlanMarketRefreshError("feed_invalid", "套餐目录响应格式无效。");
      }
      text = await readLimitedResponseText(response, controller?.signal);
    } catch (error) {
      if (error?.name === "PlanMarketRefreshError") {
        lastErrorCode = error.code;
        throw error;
      }
      lastErrorCode = "feed_unavailable";
      throw new PlanMarketRefreshError(lastErrorCode, "远程套餐目录暂不可用，已保留上次成功数据。");
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      lastErrorCode = "feed_invalid";
      throw new PlanMarketRefreshError(lastErrorCode, "套餐目录响应格式无效。");
    }
    let payload;
    try {
      payload = verifySignedStaticFeed(envelope, {
        publicKey: feedPublicKey,
        nowMs: now().getTime(),
        maxPayloadBytes: MAX_FEED_BYTES,
      });
    } catch {
      lastErrorCode = "feed_signature_invalid";
      throw new PlanMarketRefreshError(lastErrorCode, "套餐目录签名校验失败，已保留上次成功数据。");
    }
    try {
      assertFeedEnvelope(payload, resolvedFeedUrl);
      const generatedAtMs = Date.parse(payload.generated_at);
      const currentSnapshot = loadSnapshot();
      const previousGeneratedAtMs = Date.parse(String(currentSnapshot?.generated_at || ""));
      if (Number.isFinite(previousGeneratedAtMs) && generatedAtMs < previousGeneratedAtMs) {
        throw new PlanMarketRefreshError("feed_rollback_rejected", "套餐目录版本早于上次成功快照。");
      }
      if (
        Number.isFinite(previousGeneratedAtMs)
        && generatedAtMs === previousGeneratedAtMs
        && currentSnapshot.catalog_sha256 !== payload.catalog_sha256
      ) {
        throw new PlanMarketRefreshError("feed_version_conflict", "套餐目录版本与已保存快照冲突。");
      }
      validateCatalog(payload.catalog, now());
    } catch (error) {
      lastErrorCode = error?.code || "feed_catalog_invalid";
      throw error;
    }
    const changes = diffPlanMarketCatalogs(currentRaw(), payload.catalog);
    const snapshot = {
      version: PLAN_MARKET_SNAPSHOT_VERSION,
      source_url: resolvedFeedUrl,
      catalog_version: payload.catalog_version,
      catalog_sha256: payload.catalog_sha256,
      generated_at: payload.generated_at,
      last_successful_at: checkedAt,
      changes,
      catalog: payload.catalog,
    };
    writeSnapshotAtomic(snapshotPath, snapshot, fsImpl, new Date(checkedAt).getTime());
    cache = snapshot;
    lastErrorCode = null;
    return publicState();
  }

  function refresh() {
    if (inFlight) return inFlight;
    inFlight = refreshOnce().finally(() => { inFlight = null; });
    return inFlight;
  }

  return { read: publicState, refresh, snapshotPath };
}

module.exports = {
  PLAN_MARKET_FEED_SCHEMA,
  PLAN_MARKET_FEED_URL,
  PlanMarketRefreshError,
  createPlanMarketUpdateService,
  diffPlanMarketCatalogs,
  hashPlanMarketCatalog,
  normalizePlanMarketFeedUrl,
  resolvePlanMarketSnapshotPath,
};
