"use strict";

const BAILIAN_QUOTA_PATH = "/data/api.json";
const BAILIAN_QUOTA_QUERY = "action=zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2&product=broadscope-bailian&api=queryCodingPlanInstanceInfoV2";
const BAILIAN_REGIONS = [
  {
    id: "cn",
    host: "https://bailian.console.aliyun.com",
    commodityCode: "sfm_codingplan_public_cn",
    currentRegionId: "cn-beijing",
    dashboardUrl: "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/efm/coding_plan",
  },
  {
    id: "intl",
    host: "https://modelstudio.console.alibabacloud.com",
    commodityCode: "sfm_codingplan_public_intl",
    currentRegionId: "ap-southeast-1",
    dashboardUrl: "https://modelstudio.console.alibabacloud.com/ap-southeast-1/?tab=coding-plan#/efm/coding_plan",
  },
];
const MAX_RESPONSE_BYTES = 1024 * 1024;

class AliyunBailianTokenPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AliyunBailianTokenPlanError";
    this.code = code;
  }
}

function mapAliyunBailianErrorCode(error) {
  if (!(error instanceof AliyunBailianTokenPlanError)) return "failed";
  switch (error.code) {
    case "BAILIAN_REAUTH_REQUIRED":
    case "BAILIAN_CONSOLE_LOGIN_REQUIRED":
      return "reauth_required";
    case "BAILIAN_RESPONSE_STRUCTURE_DRIFT":
    case "BAILIAN_UNSUPPORTED":
      return "unsupported";
    default:
      return "failed";
  }
}

function parseInteger(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.trunc(n))) return null;
  return Math.trunc(n);
}

function parseResetAt(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "";
  const ms = n > 1e12 ? n : n * 1000;
  const ts = new Date(ms);
  return Number.isFinite(ts.getTime()) ? ts.toISOString() : "";
}

function expandedJson(value) {
  if (Array.isArray(value)) return value.map((item) => expandedJson(item));
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      try {
        const nested = JSON.parse(value);
        if (nested && typeof nested === "object") return expandedJson(nested);
      } catch {
        return value;
      }
    }
    return value;
  }
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = expandedJson(nested);
  }
  return out;
}

function findFirstArray(keys, dict) {
  for (const key of keys) {
    if (Array.isArray(dict?.[key])) return dict[key];
  }
  return null;
}

function findFirstString(keys, dict) {
  for (const key of keys) {
    const value = dict?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function findQuotaInfo(payload) {
  const direct = payload?.codingPlanQuotaInfo || payload?.coding_plan_quota_info;
  if (direct && typeof direct === "object") return direct;
  const instances = findFirstArray(["codingPlanInstanceInfos", "coding_plan_instance_infos"], payload);
  if (!instances) return null;
  for (const item of instances) {
    if (!item || typeof item !== "object") continue;
    const nested = item.codingPlanQuotaInfo || item.coding_plan_quota_info;
    if (nested && typeof nested === "object") return nested;
  }
  return null;
}

function findPlanName(payload) {
  const instances = findFirstArray(["codingPlanInstanceInfos", "coding_plan_instance_infos"], payload);
  if (instances) {
    for (const item of instances) {
      if (!item || typeof item !== "object") continue;
      const name = findFirstString(["planName", "plan_name", "instanceName", "instance_name", "packageName", "package_name"], item);
      if (name) return name;
    }
  }
  return findFirstString(["planName", "plan_name", "packageName", "package_name"], payload);
}

function buildQuotaWindow({ kind, used, total, resetsAt }) {
  if (total === null || used === null || total <= 0) return null;
  const safeUsed = Math.min(Math.max(0, used), total);
  return {
    kind,
    unit: "tokens",
    total,
    used: safeUsed,
    remaining: Math.max(0, total - safeUsed),
    percentage: total > 0 ? Math.round((safeUsed / total) * 10000) / 100 : 0,
    resets_at: resetsAt,
  };
}

function unwrapPayload(expanded) {
  const data = expanded?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return { ...expanded, ...data };
  }
  return expanded;
}

function parseAliyunBailianQuotaResponse(payload) {
  const expanded = unwrapPayload(expandedJson(payload));
  if (!expanded || typeof expanded !== "object") {
    throw new AliyunBailianTokenPlanError("BAILIAN_RESPONSE_STRUCTURE_DRIFT", "Bailian response is not an object");
  }

  const statusCode = parseInteger(expanded.statusCode ?? expanded.status_code ?? expanded.code);
  if (statusCode !== null && statusCode !== 0 && statusCode !== 200) {
    const message = findFirstString(["statusMessage", "status_msg", "message", "msg"], expanded) || `status code ${statusCode}`;
    const lower = message.toLowerCase();
    if (statusCode === 401 || statusCode === 403 || lower.includes("api key") || lower.includes("unauthorized")) {
      throw new AliyunBailianTokenPlanError("BAILIAN_REAUTH_REQUIRED", "Bailian Coding Plan API Key is invalid or expired");
    }
    throw new AliyunBailianTokenPlanError("BAILIAN_PROVIDER_ERROR", "Bailian quota endpoint returned an error");
  }

  const codeText = findFirstString(["code", "status", "statusCode"], expanded).toLowerCase();
  const messageText = findFirstString(["message", "msg", "statusMessage"], expanded).toLowerCase();
  if (codeText.includes("needlogin") || codeText.includes("login")
    || messageText.includes("log in") || messageText.includes("login")
    || messageText.includes("console session")) {
    throw new AliyunBailianTokenPlanError(
      "BAILIAN_CONSOLE_LOGIN_REQUIRED",
      "Bailian Coding Plan requires console login for this account or region",
    );
  }

  const quota = findQuotaInfo(expanded);
  if (!quota) {
    throw new AliyunBailianTokenPlanError("BAILIAN_RESPONSE_STRUCTURE_DRIFT", "Bailian coding plan quota data is missing");
  }

  const fiveHour = buildQuotaWindow({
    kind: "rolling_5_hour",
    used: parseInteger(quota.per5HourUsedQuota ?? quota.perFiveHourUsedQuota),
    total: parseInteger(quota.per5HourTotalQuota ?? quota.perFiveHourTotalQuota),
    resetsAt: parseResetAt(quota.per5HourQuotaNextRefreshTime ?? quota.perFiveHourQuotaNextRefreshTime),
  });
  const weekly = buildQuotaWindow({
    kind: "rolling_weekly",
    used: parseInteger(quota.perWeekUsedQuota),
    total: parseInteger(quota.perWeekTotalQuota),
    resetsAt: parseResetAt(quota.perWeekQuotaNextRefreshTime),
  });
  const quotaWindows = [fiveHour, weekly].filter(Boolean);
  if (quotaWindows.length === 0) {
    throw new AliyunBailianTokenPlanError("BAILIAN_RESPONSE_STRUCTURE_DRIFT", "Bailian quota windows are missing");
  }
  const primary = weekly || quotaWindows[quotaWindows.length - 1];
  return {
    quota_windows: quotaWindows,
    total_quota: primary.total,
    used_quota: primary.used,
    remaining_quota: primary.remaining,
    plan_name: findPlanName(expanded),
  };
}

function buildQuotaUrl(region) {
  return `${region.host}${BAILIAN_QUOTA_PATH}?${BAILIAN_QUOTA_QUERY}&currentRegionId=${encodeURIComponent(region.currentRegionId)}`;
}

function buildRequestBody(region) {
  return JSON.stringify({
    queryCodingPlanInstanceInfoRequest: {
      commodityCode: region.commodityCode,
    },
  });
}

async function fetchAliyunBailianCodingPlanQuota({
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  regions = BAILIAN_REGIONS,
} = {}) {
  const trimmedKey = String(apiKey || "").trim();
  if (!trimmedKey) {
    throw new AliyunBailianTokenPlanError("BAILIAN_REAUTH_REQUIRED", "Bailian Coding Plan API Key is missing");
  }
  if (!trimmedKey.startsWith("sk-sp-")) {
    throw new AliyunBailianTokenPlanError(
      "BAILIAN_REAUTH_REQUIRED",
      "Use a Coding Plan subscription key (sk-sp-), not a pay-as-you-go key",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let lastError = null;
  try {
    for (const region of regions) {
      try {
        const response = await fetchImpl(buildQuotaUrl(region), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${trimmedKey}`,
            "x-api-key": trimmedKey,
            "X-DashScope-API-Key": trimmedKey,
            "Content-Type": "application/json",
            Accept: "application/json",
            Origin: region.host,
            Referer: region.dashboardUrl,
          },
          body: buildRequestBody(region),
          redirect: "manual",
          signal: controller.signal,
        });
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
          throw new AliyunBailianTokenPlanError("BAILIAN_RESPONSE_TOO_LARGE", "Bailian response exceeded the size limit");
        }
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          throw new AliyunBailianTokenPlanError("BAILIAN_RESPONSE_STRUCTURE_DRIFT", "Bailian response is not valid JSON");
        }
        if (response.status === 401 || response.status === 403) {
          lastError = new AliyunBailianTokenPlanError("BAILIAN_REAUTH_REQUIRED", "Bailian Coding Plan API Key is invalid or expired");
          continue;
        }
        if (!response.ok) {
          lastError = new AliyunBailianTokenPlanError("BAILIAN_PROVIDER_ERROR", `Bailian quota endpoint returned HTTP ${response.status}`);
          continue;
        }
        const parsed = parseAliyunBailianQuotaResponse(payload);
        return {
          ...parsed,
          provider_reported_at: new Date().toISOString(),
          region: region.id,
        };
      } catch (error) {
        if (error instanceof AliyunBailianTokenPlanError) {
          lastError = error;
          if (["BAILIAN_REAUTH_REQUIRED", "BAILIAN_CONSOLE_LOGIN_REQUIRED"].includes(error.code)) continue;
          throw error;
        }
        lastError = error;
      }
    }
    if (lastError instanceof AliyunBailianTokenPlanError) throw lastError;
    throw new AliyunBailianTokenPlanError("BAILIAN_NETWORK_ERROR", "Unable to query Bailian Coding Plan quota");
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new AliyunBailianTokenPlanError("BAILIAN_TIMEOUT", "Bailian quota request timed out");
    }
    if (error instanceof AliyunBailianTokenPlanError) throw error;
    throw new AliyunBailianTokenPlanError("BAILIAN_NETWORK_ERROR", "Unable to query Bailian Coding Plan quota");
  } finally {
    clearTimeout(timeout);
  }
}

function createAliyunBailianProviderAdapter({ fetchImpl = globalThis.fetch } = {}) {
  return async function aliyunBailianProviderAdapter(plan, { resolveApiKey } = {}) {
    const planId = String(plan?.plan_id || "").trim();
    if (planId === "aliyun_bailian_pay_as_you_go_budget") {
      throw new AliyunBailianTokenPlanError(
        "BAILIAN_UNSUPPORTED",
        "Bailian pay-as-you-go balance has no public API",
      );
    }
    const ref = plan?.detection_config?.official_account?.api_key_ref || "";
    const apiKey = resolveApiKey ? await resolveApiKey(ref) : "";
    return fetchAliyunBailianCodingPlanQuota({ apiKey, fetchImpl });
  };
}

module.exports = {
  BAILIAN_REGIONS,
  AliyunBailianTokenPlanError,
  mapAliyunBailianErrorCode,
  parseAliyunBailianQuotaResponse,
  fetchAliyunBailianCodingPlanQuota,
  createAliyunBailianProviderAdapter,
};
