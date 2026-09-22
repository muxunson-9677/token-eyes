"use strict";

const { readClaudeCodeAccessToken } = require("./subscriptions");

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const PERCENT_SCALE = 100;

class ClaudeTokenPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ClaudeTokenPlanError";
    this.code = code;
  }
}

function mapClaudeErrorCode(error) {
  if (!(error instanceof ClaudeTokenPlanError)) return "failed";
  switch (error.code) {
    case "CLAUDE_REAUTH_REQUIRED":
      return "reauth_required";
    case "CLAUDE_CONSOLE_SYNC_REQUIRED":
      return "not_configured";
    case "CLAUDE_ROUTING_MODE":
    case "CLAUDE_RESPONSE_STRUCTURE_DRIFT":
    case "CLAUDE_NO_QUOTA_WINDOWS":
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

function utilizationToPercent(raw) {
  if ((typeof raw !== "number" && typeof raw !== "string") || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > PERCENT_SCALE) return null;
  if (n <= 1) return Math.round(n * PERCENT_SCALE * 100) / 100;
  return Math.max(0, Math.min(PERCENT_SCALE, Math.round(n * 100) / 100));
}

function claudeWindowToQuotaWindow(entry, kind) {
  if (!entry || typeof entry !== "object") return null;
  const pct = utilizationToPercent(entry.utilization);
  if (pct === null) return null;
  const used = pct;
  return {
    kind,
    unit: "percent",
    total: PERCENT_SCALE,
    used,
    remaining: Math.max(0, PERCENT_SCALE - used),
    percentage: pct,
    resets_at: parseResetAt(entry.resets_at || entry.reset_at),
  };
}

function parseClaudeUsageBody(body) {
  const fiveHour = claudeWindowToQuotaWindow(body?.five_hour, "rolling_5_hour");
  const weekly = claudeWindowToQuotaWindow(body?.seven_day, "rolling_weekly");
  const quotaWindows = [fiveHour, weekly].filter(Boolean);
  if (quotaWindows.length === 0) {
    throw new ClaudeTokenPlanError("CLAUDE_NO_QUOTA_WINDOWS", "Claude usage windows are missing");
  }
  const primary = weekly || quotaWindows[quotaWindows.length - 1];
  return {
    quota_windows: quotaWindows,
    quota_unit: "percent",
    total_quota: primary.total,
    used_quota: primary.used,
    remaining_quota: primary.remaining,
  };
}

function isClaudeRoutingPlan(plan) {
  const planId = String(plan?.plan_id || "").trim().toLowerCase();
  if (planId === "claude_routing") return true;
  const mode = String(plan?.detection_config?.official_account?.claude_account_mode || "").trim().toLowerCase();
  return mode === "routing";
}

async function fetchClaudeUsage(accessToken, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(CLAUDE_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json",
    },
    redirect: "manual",
  });
  if (response.status === 401 || response.status === 403) {
    throw new ClaudeTokenPlanError("CLAUDE_REAUTH_REQUIRED", "Claude token expired — run `claude` once to refresh");
  }
  if (!response.ok) {
    throw new ClaudeTokenPlanError("CLAUDE_PROVIDER_ERROR", `Claude usage endpoint returned HTTP ${response.status}`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new ClaudeTokenPlanError("CLAUDE_RESPONSE_TOO_LARGE", "Claude usage response exceeded the size limit");
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ClaudeTokenPlanError("CLAUDE_RESPONSE_STRUCTURE_DRIFT", "Claude usage response is not valid JSON");
  }
  return payload;
}

async function fetchClaudeQuota({
  home,
  platform,
  securityRunner,
  fetchImpl = globalThis.fetch,
  plan,
} = {}) {
  if (isClaudeRoutingPlan(plan)) {
    throw new ClaudeTokenPlanError(
      "CLAUDE_ROUTING_MODE",
      "Routing mode only tracks local token usage — official quota sync is not available",
    );
  }
  const accessToken = readClaudeCodeAccessToken({ platform, securityRunner, home });
  if (!accessToken) {
    throw new ClaudeTokenPlanError("CLAUDE_REAUTH_REQUIRED", "Claude Code is not configured — run `claude` to log in");
  }
  const body = await fetchClaudeUsage(accessToken, { fetchImpl });
  const parsed = parseClaudeUsageBody(body);
  return {
    ...parsed,
    provider_reported_at: new Date().toISOString(),
  };
}

function createClaudeProviderAdapter({ fetchImpl = globalThis.fetch, home, platform, securityRunner } = {}) {
  return async function claudeProviderAdapter(plan) {
    if (plan?.detection_method === "official_account" && !isClaudeRoutingPlan(plan)) {
      throw new ClaudeTokenPlanError(
        "CLAUDE_CONSOLE_SYNC_REQUIRED",
        "请点击「连接并同步」通过 Anthropic 官网登录刷新额度",
      );
    }
    return fetchClaudeQuota({ home, platform, securityRunner, fetchImpl, plan });
  };
}

module.exports = {
  CLAUDE_USAGE_URL,
  ClaudeTokenPlanError,
  mapClaudeErrorCode,
  parseClaudeUsageBody,
  isClaudeRoutingPlan,
  fetchClaudeQuota,
  createClaudeProviderAdapter,
};
