"use strict";

const GLM_USAGE_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";
const MAX_RESPONSE_BYTES = 1024 * 1024;

class GlmTokenPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GlmTokenPlanError";
    this.code = code;
  }
}

function finiteNonNegative(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new GlmTokenPlanError("GLM_RESPONSE_STRUCTURE_DRIFT", `Invalid ${field}`);
  }
  return number;
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
  return {
    level: String(data.level || "").toLowerCase(),
    quota_windows: [
      parseWindow(fiveHour, "rolling_5_hour"),
      parseWindow(weekly, "rolling_weekly"),
    ],
  };
}

function mapGlmLevelToPlanId(level) {
  const value = String(level || "").trim().toLowerCase();
  if (!value) return "";
  if (value.includes("max")) return "glm_max";
  if (value.includes("pro")) return "glm_pro";
  if (value.includes("lite")) return "glm_lite";
  return "";
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
    const suggestedPlanId = mapGlmLevelToPlanId(result.level);
    return {
      quota_windows: result.quota_windows,
      suggested_plan_id: suggestedPlanId,
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
};
