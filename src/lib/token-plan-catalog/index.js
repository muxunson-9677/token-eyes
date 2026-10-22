const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { projectGlmCatalog } = require("../glm-token-plan");
const GLM_ENTITLEMENT_CONTRACT = require("../../../shared/provider-plan-contracts/glm.json");

const CATALOG_DIR = __dirname;
const PROVIDER_LINKS_PATH = path.join(CATALOG_DIR, "..", "..", "..", "shared", "provider-links.json");
const DEFAULT_STALE_AFTER_SECONDS = 30 * 24 * 60 * 60;
const GLM_SOURCE_BODY_CLAIMS = new Set([
  "catalog_provider:glm",
  "catalog_plan:glm_lite",
  "catalog_plan:glm_pro",
  "catalog_plan:glm_max",
]);

const PROVIDER_CATALOG_FILES = {
  xiaomi_mimo: "xiaomi-mimo.catalog.json",
  glm: "glm.catalog.json",
  aliyun_bailian: "aliyun-bailian.catalog.json",
  kimi: "kimi.catalog.json",
  minimax: "minimax.catalog.json",
  codex: "codex.catalog.json",
  claude: "claude.catalog.json",
  cursor: "cursor.catalog.json",
  trae: "trae.catalog.json",
  zcode: "zcode.catalog.json",
};

const CUSTOM_PROVIDER = {
  id: "custom",
  name: "自定义套餐",
};

let catalogCache = null;
let providerLinksCache = null;

function loadProviderLinks() {
  if (providerLinksCache) return providerLinksCache;
  const registry = JSON.parse(fs.readFileSync(PROVIDER_LINKS_PATH, "utf8"));
  const byId = new Map();
  const byUrl = new Map();
  for (const link of registry.links || []) {
    byId.set(link.link_id, link);
    byUrl.set(link.url, link);
  }
  providerLinksCache = { byId, byUrl };
  return providerLinksCache;
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

function normalizedEvidenceClaim(claim) {
  const scope = claim.evidence?.claim_scope;
  const supports = [...(claim.evidence?.supports || [])].sort();
  const normalized = { claim_scope: scope, supports };
  if (scope === "catalog_provider") {
    if (supports.includes("provider_identity")) Object.assign(normalized, {
      provider_id: claim.provider_id,
      provider_name: claim.provider_name,
      catalog_version: claim.catalog_version,
    });
    return normalized;
  }
  if (scope === "catalog_plan") {
    if (supports.includes("plan_identity")) Object.assign(normalized, {
      plan_id: claim.plan_id,
      display_name: claim.display_name,
    });
    if (supports.includes("quota")) normalized.quota = claim.quota;
    if (supports.includes("effective_dates")) Object.assign(normalized, {
      valid_from: claim.evidence.valid_from,
      valid_until: claim.evidence.valid_until,
    });
    return normalized;
  }
  throw new Error(`Unsupported evidence claim scope: ${scope}`);
}

function assertEvidenceHash(claim, providerId) {
  const evidence = claim?.evidence;
  if (!evidence?.verified) {
    if (evidence?.content_sha256 !== null) throw new Error("Unverified evidence must not carry a content hash");
    return;
  }
  const claimId = evidence.claim_scope === "catalog_provider" ? claim.provider_id : claim.plan_id;
  const sourceBodyClaim = providerId === "glm"
    && evidence.link_id === "catalog-glm-overview-markdown"
    && GLM_SOURCE_BODY_CLAIMS.has(`${evidence.claim_scope}:${claimId}`);
  if (sourceBodyClaim) {
    if (evidence.content_hash_kind !== "source_body_utf8_lf") {
      throw new Error(`GLM source-body claim requires source_body_utf8_lf hash kind: ${claimId}`);
    }
    const expectedHash = GLM_ENTITLEMENT_CONTRACT.sources?.overview_md?.content_sha256;
    if (evidence.content_sha256 !== expectedHash) {
      throw new Error(`GLM source-body evidence hash mismatch for ${claimId}`);
    }
    return;
  }
  if (evidence.content_hash_kind !== "normalized_extracted_fields_v1") {
    throw new Error(`Normalized catalog claim has unsupported evidence hash kind: ${evidence.content_hash_kind}`);
  }
  const actual = crypto.createHash("sha256")
    .update(canonicalJson(normalizedEvidenceClaim(claim)), "utf8")
    .digest("hex");
  if (actual !== evidence.content_sha256) {
    throw new Error(`Evidence hash mismatch for ${evidence.claim_scope}`);
  }
}

function assertEvidenceSupportedByCatalogSource(catalog) {
  const sourcesByLinkId = new Map((catalog.sources || []).map((source) => [source.link_id, source]));
  for (const claim of [catalog, ...(catalog.plans || [])]) {
    const evidence = claim?.evidence;
    if (!evidence?.verified) continue;
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
}

function resolveLink(linkId) {
  const link = loadProviderLinks().byId.get(linkId);
  if (!link) throw new Error(`Unknown provider link_id: ${linkId}`);
  return link;
}

function resolveEvidence(evidence, nowMs) {
  if (!evidence || typeof evidence !== "object") return null;
  const link = resolveLink(evidence.link_id);
  return {
    ...structuredClone(evidence),
    source_type: link.source_type,
    source_url: link.url,
    is_stale: evidenceIsStale(evidence, nowMs),
  };
}

function resolveSource(source) {
  const link = resolveLink(source.link_id);
  return {
    ...structuredClone(source),
    url: link.url,
    source_type: link.source_type,
  };
}

function resolveEntitlementWindow(window, nowMs) {
  const link = window.link_id
    ? resolveLink(window.link_id)
    : loadProviderLinks().byUrl.get(window.source_url);
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

function entitlementEvidenceIsStale(window, nowMs = Date.now()) {
  return evidenceIsStale({ ...window, stale_after_seconds: Number(window.stale_after_seconds) || DEFAULT_STALE_AFTER_SECONDS }, nowMs);
}

function loadCatalogs() {
  if (catalogCache) return catalogCache;

  const providers = {};

  for (const [providerId, fileName] of Object.entries(PROVIDER_CATALOG_FILES)) {
    const filePath = path.join(CATALOG_DIR, fileName);
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      assertEvidenceSupportedByCatalogSource(parsed);
      assertEvidenceHash(parsed, providerId);
      for (const plan of parsed.plans || []) assertEvidenceHash(plan, providerId);
      const data = providerId === "glm" ? projectGlmCatalog(parsed) : parsed;
      providers[providerId] = data;
    } catch (e) {
      console.error(`[token-plan-catalog] Failed to load ${fileName}:`, e?.message);
    }
  }

  catalogCache = providers;
  return providers;
}

function projectCatalog(data, now) {
  const nowMs = nowMilliseconds(now);
  const providerHome = resolveLink(data.official_site_link_id);
  return {
    ...structuredClone(data),
    official_site_url: providerHome.url,
    official_site_source_type: providerHome.source_type,
    evidence: resolveEvidence(data.evidence, nowMs),
    sources: (data.sources || []).map(resolveSource),
    account_access: structuredClone(data.account_access || {}),
    plans: (data.plans || []).map((plan) => {
      const evidence = resolveEvidence(plan.evidence, nowMs);
      return {
        ...structuredClone(plan),
        quota_kind: plan.quota?.kind || "unknown",
        quota_unit: plan.quota?.unit || "tokens",
        total_quota: Number(plan.quota?.total || 0),
        total_quota_display: plan.quota?.display || "",
        official_evidence_url: evidence?.source_url || "",
        evidence,
        entitlement_revision: plan.entitlement_revision || "",
        entitlement_windows: (plan.entitlement_windows || []).map((window) => (
          resolveEntitlementWindow(window, nowMs)
        )),
      };
    }),
  };
}

function getProviderCatalog(providerId, { now } = {}) {
  const catalogs = loadCatalogs();
  const id = String(providerId || "").trim().toLowerCase();
  if (!id || !catalogs[id]) return null;
  return projectCatalog(catalogs[id], now);
}

function getPlanById(providerId, planId, { now } = {}) {
  const catalog = getProviderCatalog(providerId, { now });
  if (!catalog) return null;
  const pid = String(planId || "").trim();
  const plan = catalog.plans.find((p) => p.plan_id === pid);
  if (!plan) return null;
  const result = structuredClone(plan);
  // Token-plan records historically persist the resolved entitlement shape.
  // Registry-only join metadata remains on the provider catalog projection.
  result.entitlement_windows = result.entitlement_windows.map((window) => {
    const {
      link_id: _linkId,
      supports: _supports,
      stale_after_seconds: _staleAfterSeconds,
      ...persistedWindow
    } = window;
    return persistedWindow;
  });
  return result;
}

function listProviderOptions() {
  const catalogs = loadCatalogs();
  const options = [];
  for (const [id, catalog] of Object.entries(catalogs)) {
    options.push({ id, name: catalog.provider_name });
  }
  options.push({ id: CUSTOM_PROVIDER.id, name: CUSTOM_PROVIDER.name });
  return options;
}

module.exports = {
  entitlementEvidenceIsStale,
  getProviderCatalog,
  getPlanById,
  listProviderOptions,
};
