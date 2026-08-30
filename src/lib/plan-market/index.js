const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Raw catalog values may be cached, but every consumer must use the projected
// payload so freshness and promotion validity are evaluated for that read.
const CATALOG_PATH = path.join(__dirname, "..", "..", "..", "shared", "plan-market-catalog.json");
const PROVIDER_LINKS_PATH = path.join(__dirname, "..", "..", "..", "shared", "provider-links.json");
const DEFAULT_STALE_AFTER_SECONDS = 30 * 24 * 60 * 60;
const FRESHNESS_BADGES = new Set(["latest", "new", "hot"]);

let rawCache = null;
let providerLinksCache = null;

function loadRaw() {
  if (rawCache) return rawCache;
  const raw = fs.readFileSync(CATALOG_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.providers)) {
    throw new Error("plan-market catalog.json must contain a providers array");
  }
  rawCache = data;
  return data;
}

function loadProviderLinks() {
  if (providerLinksCache) return providerLinksCache;
  const registry = JSON.parse(fs.readFileSync(PROVIDER_LINKS_PATH, "utf8"));
  providerLinksCache = indexProviderLinks(registry);
  return providerLinksCache;
}

function indexProviderLinks(registry) {
  if (registry?.byId instanceof Map && registry?.byUrl instanceof Map) return registry;
  const byId = new Map();
  const byUrl = new Map();
  for (const link of registry.links || []) {
    byId.set(link.link_id, link);
    byUrl.set(link.url, link);
  }
  return { byId, byUrl };
}

function nowMilliseconds(now) {
  if (now === undefined) return Date.now();
  if (now === null) throw new TypeError("now must be a valid date");
  const value = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(value)) throw new TypeError("now must be a valid date");
  return value;
}

function dateMilliseconds(value, { endOfDay = false } = {}) {
  if (!value) return NaN;
  const raw = String(value);
  const suffix = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? (endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z")
    : "";
  return Date.parse(`${raw}${suffix}`);
}

function evidenceIsStale(evidence, nowMs) {
  if (!evidence?.verified) return true;
  const validFromMs = dateMilliseconds(evidence.valid_from);
  if (Number.isFinite(validFromMs) && nowMs < validFromMs) return true;
  const validUntilMs = dateMilliseconds(evidence.valid_until, { endOfDay: true });
  if (Number.isFinite(validUntilMs) && nowMs > validUntilMs) return true;
  const fetchedAtMs = dateMilliseconds(evidence.fetched_at);
  const ttlSeconds = Number(evidence.stale_after_seconds);
  if (!Number.isFinite(fetchedAtMs) || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return true;
  return nowMs - fetchedAtMs > ttlSeconds * 1000;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalCompare(left, right) {
  const leftJson = canonicalJson(left);
  const rightJson = canonicalJson(right);
  if (leftJson < rightJson) return -1;
  if (leftJson > rightJson) return 1;
  return 0;
}

function normalizedEvidenceClaim(claim) {
  const scope = claim.evidence?.claim_scope;
  const supports = [...(claim.evidence?.supports || [])].sort();
  const normalized = { claim_scope: scope, supports };
  if (scope === "market_provider") {
    if (supports.includes("provider_identity")) Object.assign(normalized, {
      id: claim.id,
      display_name: claim.display_name,
      vendor: claim.vendor,
      region: claim.region,
    });
    if (supports.includes("plan_inventory")) {
      normalized.plan_ids = (claim.plans || []).map((plan) => plan.plan_id).sort();
    }
    return normalized;
  }
  if (scope === "market_plan") {
    if (supports.includes("plan_identity")) Object.assign(normalized, {
      plan_id: claim.plan_id,
      display_name: claim.display_name,
      status: claim.status,
    });
    if (supports.includes("price")) Object.assign(normalized, {
      price: claim.price,
      alt_prices: claim.alt_prices ?? null,
    });
    if (supports.includes("quota")) Object.assign(normalized, {
      quota_summary: claim.quota_summary,
      entitlement_windows: (claim.entitlement_windows || []).map((window) => ({
        kind: window.kind,
        unit: window.unit,
        total: window.total,
      })),
    });
    if (supports.includes("eligibility")) normalized.highlights = claim.highlights ?? null;
    if (supports.includes("effective_dates")) Object.assign(normalized, {
      valid_from: claim.evidence.valid_from,
      valid_until: claim.evidence.valid_until,
    });
    if (supports.includes("promotion")) {
      normalized.promotion_prices = (claim.alt_prices || [])
        .filter((price) => price.promotion_id)
        .map((price) => ({ ...price }));
    }
    return normalized;
  }
  if (scope === "market_promotion") {
    if (supports.includes("promotion")) Object.assign(normalized, {
      promotion_id: claim.promotion_id,
      display: claim.display,
      offers: (claim.offers || []).map((offer) => ({
        promotion_id: offer.promotion_id,
        plan_id: offer.plan_id,
        amount: offer.amount,
        currency: offer.currency,
        cycle: offer.cycle,
        note: offer.note ?? null,
      })).sort(canonicalCompare),
    });
    if (supports.includes("effective_dates")) Object.assign(normalized, {
      valid_from: claim.evidence.valid_from,
      valid_until: claim.evidence.valid_until,
    });
    return normalized;
  }
  throw new Error(`Unsupported evidence claim scope: ${scope}`);
}

function assertEvidenceHash(claim) {
  const evidence = claim?.evidence;
  if (!evidence?.verified) {
    if (evidence?.content_sha256 !== null) throw new Error("Unverified evidence must not carry a content hash");
    return;
  }
  if (evidence.content_hash_kind !== "normalized_extracted_fields_v1") {
    throw new Error(`Market claims require normalized evidence hash kind: ${evidence.content_hash_kind}`);
  }
  const actual = crypto.createHash("sha256")
    .update(canonicalJson(normalizedEvidenceClaim(claim)), "utf8")
    .digest("hex");
  if (actual !== evidence.content_sha256) {
    throw new Error(`Evidence hash mismatch for ${evidence.claim_scope}`);
  }
}

function assertEvidenceSupportedBySource(claim, sourcesByLinkId) {
  const evidence = claim?.evidence;
  if (!evidence?.verified) return;
  const source = sourcesByLinkId.get(evidence.link_id);
  if (!source) {
    throw new Error(`Evidence source reference is missing: ${evidence.link_id}`);
  }
  const sourceSupports = new Set(source.supports || []);
  for (const support of evidence.supports || []) {
    if (!sourceSupports.has(support)) {
      throw new Error(`Evidence source ${evidence.link_id} does not support ${support}`);
    }
  }
}

function assertPromotionOffers(provider) {
  const planIds = new Set((provider.plans || []).map((plan) => plan.plan_id));
  const promotionsById = new Map();
  const offersByKey = new Map();
  for (const promotion of provider.promotions || []) {
    if (promotionsById.has(promotion.promotion_id)) {
      throw new Error(`Duplicate promotion ${promotion.promotion_id}`);
    }
    promotionsById.set(promotion.promotion_id, promotion);
    for (const offer of promotion.offers || []) {
      if (offer.promotion_id !== promotion.promotion_id) {
        throw new Error(`Promotion offer mismatch for ${promotion.promotion_id}/${offer.plan_id}`);
      }
      if (!planIds.has(offer.plan_id)) {
        throw new Error(`Promotion offer references unknown plan ${offer.plan_id}`);
      }
      const key = `${offer.promotion_id}\u0000${offer.plan_id}`;
      if (offersByKey.has(key)) {
        throw new Error(`Duplicate promotion offer for ${offer.promotion_id}/${offer.plan_id}`);
      }
      offersByKey.set(key, offer);
    }
  }
  const matchedOfferKeys = new Set();
  for (const plan of provider.plans || []) {
    for (const price of plan.alt_prices || []) {
      if (!price.promotion_id) continue;
      const promotion = promotionsById.get(price.promotion_id);
      if (!promotion) {
        throw new Error(`Orphan promotion price ${price.promotion_id} for plan ${plan.plan_id}`);
      }
      const key = `${price.promotion_id}\u0000${plan.plan_id}`;
      if (matchedOfferKeys.has(key)) {
        throw new Error(`Duplicate promotion price for ${price.promotion_id}/${plan.plan_id}`);
      }
      const offer = offersByKey.get(key);
      if (!offer
        || offer.amount !== price.amount
        || offer.currency !== price.currency
        || offer.cycle !== price.cycle
        || (offer.note ?? null) !== (price.note ?? null)) {
        throw new Error(`Promotion offer mismatch for ${price.promotion_id}/${plan.plan_id}`);
      }
      matchedOfferKeys.add(key);
    }
  }
  for (const [key, offer] of offersByKey) {
    if (!matchedOfferKeys.has(key)) {
      throw new Error(`Orphan promotion offer for ${offer.promotion_id}/${offer.plan_id}`);
    }
  }
}

function resolveLink(linkId, providerLinks) {
  const link = providerLinks.byId.get(linkId);
  if (!link) throw new Error(`Unknown provider link_id: ${linkId}`);
  return link;
}

function resolveEvidence(evidence, nowMs, providerLinks) {
  const link = resolveLink(evidence.link_id, providerLinks);
  return {
    ...structuredClone(evidence),
    source_type: link.source_type,
    source_url: link.url,
    is_stale: evidenceIsStale(evidence, nowMs),
  };
}

function resolveSource(source, providerLinks) {
  const link = resolveLink(source.link_id, providerLinks);
  return {
    ...structuredClone(source),
    url: link.url,
    source_type: link.source_type,
  };
}

function resolveEntitlementWindow(window, nowMs, providerLinks) {
  const link = window.link_id
    ? resolveLink(window.link_id, providerLinks)
    : providerLinks.byUrl.get(window.source_url);
  if (!link) throw new Error("Entitlement evidence must join provider-links");
  const evidence = {
    ...structuredClone(window),
    link_id: link.link_id,
    supports: structuredClone(window.supports || ["quota", "effective_dates"]),
    stale_after_seconds: Number(window.stale_after_seconds) || DEFAULT_STALE_AFTER_SECONDS,
  };
  return {
    ...evidence,
    source_type: link.source_type,
    source_url: link.url,
    is_stale: evidenceIsStale(evidence, nowMs),
  };
}

function withoutFreshnessBadges(values) {
  return (values || []).filter((value) => !FRESHNESS_BADGES.has(String(value).toLowerCase()));
}

function projectProvider(rawProvider, nowMs, providerLinks) {
  const sourcesByLinkId = new Map((rawProvider.sources || []).map((source) => [source.link_id, source]));
  assertEvidenceSupportedBySource(rawProvider, sourcesByLinkId);
  assertEvidenceHash(rawProvider);
  assertPromotionOffers(rawProvider);
  const provider = structuredClone(rawProvider);
  provider.evidence = resolveEvidence(provider.evidence, nowMs, providerLinks);
  provider.sources = (provider.sources || []).map((source) => resolveSource(source, providerLinks));
  provider.promotions = (provider.promotions || [])
    .map((promotion) => {
      assertEvidenceSupportedBySource(promotion, sourcesByLinkId);
      assertEvidenceHash(promotion);
      return {
        ...promotion,
        evidence: resolveEvidence(promotion.evidence, nowMs, providerLinks),
      };
    })
    .filter((promotion) => !promotion.evidence.is_stale);

  const activePromotionIds = new Set(provider.promotions.map((promotion) => promotion.promotion_id));
  provider.plans = (provider.plans || []).map((rawPlan) => {
    assertEvidenceSupportedBySource(rawPlan, sourcesByLinkId);
    assertEvidenceHash(rawPlan);
    const plan = structuredClone(rawPlan);
    plan.evidence = resolveEvidence(plan.evidence, nowMs, providerLinks);
    plan.entitlement_windows = (plan.entitlement_windows || []).map((window) => (
      resolveEntitlementWindow(window, nowMs, providerLinks)
    ));
    plan.alt_prices = (plan.alt_prices || []).filter((price) => (
      !price.promotion_id || activePromotionIds.has(price.promotion_id)
    ));
    if (plan.evidence.is_stale) plan.badges = withoutFreshnessBadges(plan.badges);
    return plan;
  });

  provider.announcement = [
    provider.announcement,
    ...provider.promotions.map((promotion) => promotion.display),
  ].filter(Boolean).join("；");
  provider.is_recent = Boolean(provider.is_recent) && !provider.evidence.is_stale;
  if (provider.evidence.is_stale) provider.tags = withoutFreshnessBadges(provider.tags);
  return provider;
}

function officialSourceCoverage(providers) {
  const sourceLinkIds = new Set();
  let providerCount = 0;
  let planCount = 0;
  for (const provider of providers) {
    const providerOfficial = provider.evidence.verified
      && provider.evidence.source_type.startsWith("official_");
    if (providerOfficial) {
      providerCount += 1;
      for (const source of provider.sources) {
        if (source.source_type.startsWith("official_")) sourceLinkIds.add(source.link_id);
      }
    }
    for (const plan of provider.plans) {
      if (plan.evidence.verified && plan.evidence.source_type.startsWith("official_")) {
        planCount += 1;
        sourceLinkIds.add(plan.evidence.link_id);
      }
    }
  }
  return {
    provider_count: providerCount,
    plan_count: planCount,
    source_link_ids: [...sourceLinkIds].sort(),
  };
}

function projectPlanMarketCatalog(data, registry, { now } = {}) {
  if (!data || !Array.isArray(data.providers)) {
    throw new Error("plan-market catalog.json must contain a providers array");
  }
  const providerLinks = indexProviderLinks(registry);
  const nowMs = nowMilliseconds(now);
  const providers = data.providers.map((provider) => projectProvider(provider, nowMs, providerLinks));
  return {
    updated_at: data._meta?.updated_at || "",
    providers,
    comparison_links: (data.comparison_links || []).map((source) => resolveSource(source, providerLinks)),
    official_source_coverage: officialSourceCoverage(providers),
  };
}

// Callers may decorate/sort the payload, so the pure projector always returns
// new objects instead of sharing the module-level raw caches.
function getPlanMarketCatalog({ now } = {}) {
  return projectPlanMarketCatalog(loadRaw(), loadProviderLinks(), { now });
}

const planMarketRefresh = require("./refresh");

function createPlanMarketUpdateService(options = {}) {
  return planMarketRefresh.createPlanMarketUpdateService({
    ...options,
    projectCatalog: projectPlanMarketCatalog,
  });
}

module.exports = {
  getPlanMarketCatalog,
  projectPlanMarketCatalog,
  createPlanMarketUpdateService,
  diffPlanMarketCatalogs: planMarketRefresh.diffPlanMarketCatalogs,
  hashPlanMarketCatalog: planMarketRefresh.hashPlanMarketCatalog,
  normalizePlanMarketFeedUrl: planMarketRefresh.normalizePlanMarketFeedUrl,
  resolvePlanMarketSnapshotPath: planMarketRefresh.resolvePlanMarketSnapshotPath,
  PLAN_MARKET_FEED_SCHEMA: planMarketRefresh.PLAN_MARKET_FEED_SCHEMA,
  PLAN_MARKET_FEED_URL: planMarketRefresh.PLAN_MARKET_FEED_URL,
};
