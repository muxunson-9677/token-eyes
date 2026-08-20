"use strict";

const {
  extractCursorSessionToken,
  fetchCursorUsageSummary,
  isCursorInstalled,
} = require("./cursor-config");

const MAX_RESPONSE_BYTES = 1024 * 1024;
const PERCENT_SCALE = 100;

class CursorTokenPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CursorTokenPlanError";
    this.code = code;
  }
}

function mapCursorErrorCode(error) {
  if (!(error instanceof CursorTokenPlanError)) return "failed";
  switch (error.code) {
    case "CURSOR_REAUTH_REQUIRED":
      return "reauth_required";
    case "CURSOR_CONSOLE_SYNC_REQUIRED":
      return "not_configured";
    case "CURSOR_RESPONSE_STRUCTURE_DRIFT":
    case "CURSOR_NO_QUOTA_WINDOWS":
      return "unsupported";
    default:
      return "failed";
  }
}

function parseResetAt(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const ts = Date.parse(raw);
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : "";
}

function clampPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(PERCENT_SCALE, number));
}

function cursorPercentFromUsedLimit(usedRaw, limitRaw) {
  if (usedRaw === null || usedRaw === undefined || limitRaw === null || limitRaw === undefined
    || (typeof usedRaw === "string" && !usedRaw.trim())
    || (typeof limitRaw === "string" && !limitRaw.trim())) return null;
  const used = Number(usedRaw);
  const limit = Number(limitRaw);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  return clampPercent((used / limit) * PERCENT_SCALE);
}

function buildUsageWindow(usedPercent, resetAt) {
  const percent = clampPercent(usedPercent);
  if (percent === null) return null;
  return {
    used_percent: percent,
    reset_at: typeof resetAt === "string" && resetAt ? resetAt : null,
  };
}

function quotaWindow({ usedPercent, resetAt, laneId, kind }) {
  const used = clampPercent(usedPercent);
  if (used === null) return null;
  return {
    kind,
    lane_id: laneId,
    unit: "percent",
    total: PERCENT_SCALE,
    used,
    remaining: PERCENT_SCALE - used,
    percentage: used,
    resets_at: parseResetAt(resetAt),
  };
}

function normalizeCursorUsageSummary(body) {
  const individualUsage = body?.individualUsage && typeof body.individualUsage === "object"
    ? body.individualUsage
    : {};
  const plan = individualUsage.plan && typeof individualUsage.plan === "object"
    ? individualUsage.plan
    : (body?.planUsage && typeof body.planUsage === "object" ? body.planUsage : individualUsage);
  const teamOnDemand = body?.teamUsage?.onDemand && typeof body.teamUsage.onDemand === "object"
    ? body.teamUsage.onDemand
    : null;
  const billingCycleEnd = typeof body?.billingCycleEnd === "string" ? body.billingCycleEnd : null;
  const membershipType = typeof body?.membershipType === "string" ? body.membershipType : "";
  const autoPercent = clampPercent(plan?.autoPercentUsed ?? plan?.auto_percent_used);
  const apiPercent = clampPercent(plan?.apiPercentUsed ?? plan?.api_percent_used);
  const explicitOverall = clampPercent(plan?.totalPercentUsed ?? plan?.total_percent_used);
  const semanticPlanTotal = cursorPercentFromUsedLimit(
    plan?.used ?? plan?.totalSpend ?? plan?.total_spend,
    plan?.limit,
  );
  const teamTotal = cursorPercentFromUsedLimit(teamOnDemand?.used, teamOnDemand?.limit);
  const overallPercent = explicitOverall ?? semanticPlanTotal;
  const headlineLaneId = overallPercent === null ? null : "overall";

  const quotaWindows = [
    quotaWindow({ usedPercent: overallPercent, resetAt: billingCycleEnd, laneId: "overall", kind: "total" }),
    quotaWindow({ usedPercent: autoPercent, resetAt: billingCycleEnd, laneId: "auto", kind: "auto_composer" }),
    quotaWindow({ usedPercent: apiPercent, resetAt: billingCycleEnd, laneId: "api", kind: "api" }),
    quotaWindow({ usedPercent: teamTotal, resetAt: billingCycleEnd, laneId: "team_pool", kind: "team_pool" }),
  ].filter(Boolean);

  return {
    membership_type: membershipType || null,
    headline_lane_id: headlineLaneId,
    primary_window: buildUsageWindow(overallPercent, billingCycleEnd),
    secondary_window: buildUsageWindow(autoPercent, billingCycleEnd),
    tertiary_window: buildUsageWindow(apiPercent, billingCycleEnd),
    team_pool_window: buildUsageWindow(teamTotal, billingCycleEnd),
    quota_windows: quotaWindows,
  };
}

function parseCursorUsageBody(body) {
  const normalized = normalizeCursorUsageSummary(body);
  const quotaWindows = normalized.quota_windows;
  if (quotaWindows.length === 0) {
    throw new CursorTokenPlanError("CURSOR_NO_QUOTA_WINDOWS", "Cursor usage windows are missing");
  }
  const headline = normalized.headline_lane_id
    ? quotaWindows.find((window) => window.lane_id === normalized.headline_lane_id)
    : null;
  const result = {
    quota_windows: quotaWindows,
    membership_type: normalized.membership_type || "",
  };
  if (headline) {
    result.total_quota = headline.total;
    result.used_quota = headline.used;
    result.remaining_quota = headline.remaining;
    result.quota_unit = "percent";
  }
  return result;
}

async function fetchCursorQuota({ home, platform, env, fetchImpl = globalThis.fetch } = {}) {
  if (!isCursorInstalled({ home, platform, env })) {
    throw new CursorTokenPlanError("CURSOR_REAUTH_REQUIRED", "Cursor is not installed on this machine");
  }
  const auth = extractCursorSessionToken({ home, platform, env });
  if (!auth?.cookie) {
    throw new CursorTokenPlanError("CURSOR_REAUTH_REQUIRED", "Cursor session not found — log in via Cursor IDE");
  }
  let body;
  try {
    body = await fetchCursorUsageSummary({ cookie: auth.cookie, fetchImpl });
  } catch (error) {
    const message = error?.message || "Unable to query Cursor usage";
    if (/expired|401|403/i.test(message)) {
      throw new CursorTokenPlanError("CURSOR_REAUTH_REQUIRED", message);
    }
    throw new CursorTokenPlanError("CURSOR_PROVIDER_ERROR", message);
  }
  if (!body || typeof body !== "object") {
    throw new CursorTokenPlanError("CURSOR_RESPONSE_STRUCTURE_DRIFT", "Cursor usage response is invalid");
  }
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RESPONSE_BYTES) {
    throw new CursorTokenPlanError("CURSOR_RESPONSE_TOO_LARGE", "Cursor usage response exceeded the size limit");
  }
  const parsed = parseCursorUsageBody(body);
  return {
    ...parsed,
    provider_reported_at: new Date().toISOString(),
  };
}

function createCursorProviderAdapter({ fetchImpl = globalThis.fetch, home, platform, env } = {}) {
  return async function cursorProviderAdapter(plan) {
    if (plan?.detection_method === "official_account") {
      throw new CursorTokenPlanError(
        "CURSOR_CONSOLE_SYNC_REQUIRED",
        "请点击「连接并同步」通过 Cursor 官网登录刷新额度",
      );
    }
    return fetchCursorQuota({ home, platform, env, fetchImpl });
  };
}

module.exports = {
  CursorTokenPlanError,
  mapCursorErrorCode,
  normalizeCursorUsageSummary,
  parseCursorUsageBody,
  fetchCursorQuota,
  createCursorProviderAdapter,
};
