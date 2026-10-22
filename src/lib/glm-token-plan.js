"use strict";

const GLM_ENTITLEMENT_CONTRACT = require("../../shared/provider-plan-contracts/glm.json");

const GLM_USAGE_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const GLM_CURRENT_CATALOG_VERSION = "2026-08-20";
const GLM_LEGACY_V2_CATALOG_VERSION = "2026-07-08";

class GlmTokenPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GlmTokenPlanError";
    this.code = code;
  }
}

function finiteNonNegative(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new GlmTokenPlanError("GLM_RESPONSE_STRUCTURE_DRIFT", `Invalid ${field}`);
  }
  return value;
}

function parseWindow(item, kind) {
  const total = finiteNonNegative(item.usage, `${kind}.usage`);
  const used = finiteNonNegative(item.currentValue, `${kind}.currentValue`);
  return {
    kind,
    unit: "tokens",
    total,
    used,
    remaining: Math.max(0, total - used),
    percentage: finiteNonNegative(
      item.percentage ?? (total ? (used / total) * 100 : 0),
      `${kind}.percentage`,
    ),
    resets_at: String(item.nextResetTime || ""),
  };
}

function parseGlmQuotaResponse(payload) {
  const data = payload?.data;
  const limits = Array.isArray(data?.limits) ? data.limits : [];
  const fiveHour = limits.find((item) => item?.type === "TOKENS_LIMIT" && Number(item.unit) === 3);
  const weekly = limits.find((item) => item?.type === "TOKENS_LIMIT" && Number(item.unit) === 6);
  if (!fiveHour || !weekly) {
    throw new GlmTokenPlanError("GLM_RESPONSE_STRUCTURE_DRIFT", "GLM quota windows are missing");
  }
  const quotaWindows = [
    parseWindow(fiveHour, "rolling_5_hour"),
    parseWindow(weekly, "rolling_weekly"),
  ];
  const primaryWindow = quotaWindows.find((window) => window.kind === "rolling_weekly");
  return {
    level: String(data.level || "").toLowerCase(),
    quota_kind: "rolling_window",
    quota_unit: primaryWindow.unit,
    total_quota: primaryWindow.total,
    used_quota: primaryWindow.used,
    remaining_quota: primaryWindow.remaining,
    quota_windows: quotaWindows,
    provider_reported_fields: [
      "total_quota",
      "used_quota",
      "remaining_quota",
      "quota_windows",
    ],
  };
}

function mapGlmLevelToPlanId(level) {
  const value = String(level || "").trim().toLowerCase();
  const aliases = new Map([
    ["lite", "glm_lite"],
    ["glm lite", "glm_lite"],
    ["glm_lite", "glm_lite"],
    ["pro", "glm_pro"],
    ["glm pro", "glm_pro"],
    ["glm_pro", "glm_pro"],
    ["max", "glm_max"],
    ["glm max", "glm_max"],
    ["glm_max", "glm_max"],
  ]);
  return aliases.get(value) || "";
}

function clone(value) {
  return structuredClone(value);
}

function sourceHashesFromContract(contract = GLM_ENTITLEMENT_CONTRACT) {
  return Object.fromEntries(Object.entries(contract.sources || {}).map(([sourceId, source]) => (
    [sourceId, String(source?.content_sha256 || "")]
  )));
}

function assessGlmContractSourceHashes(observedSourceHashes, contract = GLM_ENTITLEMENT_CONTRACT) {
  const observed = observedSourceHashes && typeof observedSourceHashes === "object"
    ? observedSourceHashes
    : {};
  const expected = sourceHashesFromContract(contract);
  const changedSources = Object.keys(expected).filter((sourceId) => (
    String(observed[sourceId] || "") !== expected[sourceId]
  ));
  return {
    status: changedSources.length > 0 ? "manual_evidence_required" : "verified",
    changed_sources: changedSources,
  };
}

function getGlmEntitlementPlan(revision, planId, contract = GLM_ENTITLEMENT_CONTRACT) {
  const cohort = contract.cohorts?.[String(revision || "")];
  const plan = (cohort?.plans || []).find((item) => item.plan_id === String(planId || ""));
  return plan ? clone(plan) : null;
}

function getGlmEntitlementWindows(revision, planId, contract = GLM_ENTITLEMENT_CONTRACT) {
  const windows = getGlmEntitlementPlan(revision, planId, contract)?.entitlement_windows || [];
  const { entitlementEvidenceIsStale } = require("./token-plan-catalog");
  return windows.map(window => ({ ...window, is_stale: entitlementEvidenceIsStale(window) }));
}

function entitlementWindowsMatch(record, revision, planId) {
  if (!Array.isArray(record?.entitlement_windows)) return false;
  // Freshness changes with time; it is not evidence of a different plan cohort.
  const evidenceOnly = windows => windows.map(({ is_stale, ...evidence }) => evidence);
  return JSON.stringify(evidenceOnly(record.entitlement_windows)) === JSON.stringify(
    evidenceOnly(getGlmEntitlementWindows(revision, planId)),
  );
}

function resolveGlmEntitlementRevision(record, { isNewCatalogSelection = false } = {}) {
  const input = record && typeof record === "object" ? record : {};
  const planId = String(input.plan_id || "");
  const explicit = String(input.entitlement_revision || "");
  if (explicit === "legacy_v1" || explicit === "unknown") return explicit;
  if (
    (explicit === "legacy_v2_prompts" || explicit === "current_v3_points")
    && entitlementWindowsMatch(input, explicit, planId)
  ) {
    return explicit;
  }
  const catalogVersion = String(input.quota_catalog_version || "");
  const quotaUnit = String(input.quota_unit || "").toLowerCase();
  if (catalogVersion === GLM_LEGACY_V2_CATALOG_VERSION && quotaUnit === "prompts") {
    return "legacy_v2_prompts";
  }
  if (catalogVersion === GLM_CURRENT_CATALOG_VERSION && quotaUnit === "points") {
    return "current_v3_points";
  }
  return isNewCatalogSelection ? "current_v3_points" : "unknown";
}

function projectGlmCatalog(rawCatalog, {
  contract = GLM_ENTITLEMENT_CONTRACT,
  observedSourceHashes,
} = {}) {
  const projected = clone(rawCatalog && typeof rawCatalog === "object" ? rawCatalog : {});
  const current = contract.cohorts?.current_v3_points || { plans: [] };
  const sourceHashes = observedSourceHashes
    || projected.source_hashes
    || sourceHashesFromContract(contract);
  const assessment = assessGlmContractSourceHashes(sourceHashes, contract);
  projected.entitlement_revision = "current_v3_points";
  projected.cohort_display_name = current.user_facing_name || "新版积分套餐";
  projected.evidence_status = assessment.status;
  projected.source_hashes = clone(projected.source_hashes || sourceHashesFromContract(contract));
  projected.plans = (current.plans || []).map((contractPlan) => {
    const existing = (projected.plans || []).find((plan) => plan.plan_id === contractPlan.plan_id) || {};
    return {
      ...existing,
      plan_id: contractPlan.plan_id,
      display_name: contractPlan.display_name,
      entitlement_revision: "current_v3_points",
      entitlement_windows: clone(contractPlan.entitlement_windows),
      quota: {
        ...(existing.quota || {}),
        kind: "entitlement_windows",
        total: 0,
        unit: "points",
        display: contractPlan.quota_display,
      },
    };
  });
  return projected;
}

function mapGlmErrorCode(error) {
  if (!(error instanceof GlmTokenPlanError)) return "failed";
  switch (error.code) {
    case "GLM_API_KEY_MISSING":
      return "not_configured";
    case "GLM_REAUTH_REQUIRED":
      return "reauth_required";
    case "GLM_RESPONSE_STRUCTURE_DRIFT":
      return "unsupported";
    default:
      return "failed";
  }
}

async function fetchGlmQuota({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 10_000 }) {
  if (!String(apiKey || "").trim()) {
    throw new GlmTokenPlanError("GLM_API_KEY_MISSING", "GLM API Key is missing");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(GLM_USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: String(apiKey).trim(),
        Accept: "application/json",
        "Accept-Language": "zh-CN,zh",
      },
      redirect: "manual",
      signal: controller.signal,
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new GlmTokenPlanError("GLM_RESPONSE_TOO_LARGE", "GLM response exceeded the size limit");
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new GlmTokenPlanError("GLM_RESPONSE_STRUCTURE_DRIFT", "GLM usage response is not valid JSON");
    }
    if (response.status === 401 || response.status === 403 || [1001, 1002].includes(Number(payload?.code))) {
      throw new GlmTokenPlanError("GLM_REAUTH_REQUIRED", "GLM API Key is invalid or expired");
    }
    const businessCode = Number(payload?.code || 0);
    if (!response.ok || payload?.success === false || ![0, 200].includes(businessCode)) {
      throw new GlmTokenPlanError("GLM_PROVIDER_ERROR", "GLM usage endpoint returned an error");
    }
    return parseGlmQuotaResponse(payload);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new GlmTokenPlanError("GLM_TIMEOUT", "GLM usage request timed out");
    }
    if (error instanceof GlmTokenPlanError) throw error;
    throw new GlmTokenPlanError("GLM_NETWORK_ERROR", "Unable to query GLM usage");
  } finally {
    clearTimeout(timeout);
  }
}

function createGlmProviderAdapter({ fetchImpl = globalThis.fetch } = {}) {
  return async function glmProviderAdapter(plan, { resolveApiKey } = {}) {
    const ref = plan?.detection_config?.official_account?.api_key_ref || "";
    const apiKey = resolveApiKey ? await resolveApiKey(ref) : "";
    const result = await fetchGlmQuota({ apiKey, fetchImpl });
    return {
      quota_kind: result.quota_kind,
      quota_unit: result.quota_unit,
      total_quota: result.total_quota,
      used_quota: result.used_quota,
      remaining_quota: result.remaining_quota,
      quota_windows: result.quota_windows,
      provider_reported_fields: result.provider_reported_fields,
      provider_reported_at: new Date().toISOString(),
    };
  };
}

module.exports = {
  GLM_USAGE_URL,
  GlmTokenPlanError,
  parseGlmQuotaResponse,
  fetchGlmQuota,
  mapGlmLevelToPlanId,
  mapGlmErrorCode,
  createGlmProviderAdapter,
  assessGlmContractSourceHashes,
  getGlmEntitlementPlan,
  getGlmEntitlementWindows,
  resolveGlmEntitlementRevision,
  projectGlmCatalog,
};
