"use strict";

const {
  extractCursorSessionToken,
  fetchCursorUsageSummary,
  isCursorInstalled,
} = require("./cursor-config");
const { normalizeCursorUsageSummary } = require("./usage-limits");

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

function percentWindowToQuotaWindow(window, kind) {
  const usedPercent = Number(window?.used_percent);
  if (!Number.isFinite(usedPercent)) return null;
  const used = Math.round(Math.max(0, Math.min(PERCENT_SCALE, usedPercent)));
  return {
    kind,
    unit: "tokens",
    total: PERCENT_SCALE,
    used,
    remaining: Math.max(0, PERCENT_SCALE - used),
    percentage: used,
    resets_at: parseResetAt(window.reset_at),
  };
}

function parseCursorUsageBody(body) {
  const normalized = normalizeCursorUsageSummary(body);
  const weekly = percentWindowToQuotaWindow(normalized.primary_window, "rolling_weekly");
  const quotaWindows = [weekly].filter(Boolean);
  if (quotaWindows.length === 0) {
    throw new CursorTokenPlanError("CURSOR_NO_QUOTA_WINDOWS", "Cursor usage windows are missing");
  }
  const primary = quotaWindows[0];
  return {
    quota_windows: quotaWindows,
    total_quota: primary.total,
    used_quota: primary.used,
    remaining_quota: primary.remaining,
    membership_type: normalized.membership_type || "",
  };
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
  parseCursorUsageBody,
  fetchCursorQuota,
  createCursorProviderAdapter,
};
