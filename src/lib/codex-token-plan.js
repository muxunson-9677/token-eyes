"use strict";

const { readCodexAuthBundle } = require("./subscriptions");
const {
  refreshCodexTokens,
  persistRefreshedAuth,
  isTokenStale,
} = require("./codex-token-refresh");

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CODEX_SESSION_WINDOW_SECONDS = 18000;
const CODEX_WEEKLY_WINDOW_SECONDS = 604800;
const PERCENT_SCALE = 100;

class CodexTokenPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CodexTokenPlanError";
    this.code = code;
  }
}

function mapCodexErrorCode(error) {
  if (!(error instanceof CodexTokenPlanError)) return "failed";
  switch (error.code) {
    case "CODEX_REAUTH_REQUIRED":
      return "reauth_required";
    case "CODEX_CONSOLE_SYNC_REQUIRED":
      return "not_configured";
    case "CODEX_RESPONSE_STRUCTURE_DRIFT":
    case "CODEX_NO_QUOTA_WINDOWS":
      return "unsupported";
    default:
      return "failed";
  }
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function parseResetAt(raw) {
  if (raw == null || raw === "") return "";
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const ts = new Date(ms);
    return Number.isFinite(ts.getTime()) ? ts.toISOString() : "";
  }
  if (typeof raw === "string" && raw.trim()) {
    const ts = Date.parse(raw);
    return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : "";
  }
  return "";
}

function classifyCodexWindow(window) {
  if (!window || typeof window !== "object") return null;
  const seconds = Number(window.limit_window_seconds);
  if (!Number.isFinite(seconds)) return null;
  if (seconds === CODEX_SESSION_WINDOW_SECONDS) return "rolling_5_hour";
  if (seconds === CODEX_WEEKLY_WINDOW_SECONDS) return "rolling_weekly";
  return null;
}

function normalizeCodexRateWindow(window) {
  if (!window || typeof window !== "object" || Array.isArray(window)) return null;
  const usedPercent = clampPercent(window.used_percent);
  if (usedPercent === null) return null;
  return {
    ...window,
    used_percent: Math.round(usedPercent),
  };
}

function percentWindowToQuotaWindow(window, kind) {
  const usedPercent = clampPercent(window?.used_percent);
  if (usedPercent === null) return null;
  const used = Math.round(usedPercent);
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

function parseCodexUsageBody(body) {
  const rateLimit = body?.rate_limit && typeof body.rate_limit === "object" ? body.rate_limit : {};
  const primary = normalizeCodexRateWindow(rateLimit.primary_window);
  const secondary = normalizeCodexRateWindow(rateLimit.secondary_window);
  const candidates = [primary, secondary].filter(Boolean);
  let fiveHour = null;
  let weekly = null;
  for (const window of candidates) {
    const kind = classifyCodexWindow(window);
    if (kind === "rolling_5_hour" && !fiveHour) fiveHour = window;
    else if (kind === "rolling_weekly" && !weekly) weekly = window;
  }
  if (!fiveHour && !weekly && candidates.length > 0) {
    if (primary) fiveHour = primary;
    if (secondary) weekly = secondary;
  }
  const quotaWindows = [
    percentWindowToQuotaWindow(fiveHour, "rolling_5_hour"),
    percentWindowToQuotaWindow(weekly, "rolling_weekly"),
  ].filter(Boolean);
  if (quotaWindows.length === 0) {
    throw new CodexTokenPlanError("CODEX_NO_QUOTA_WINDOWS", "Codex quota windows are missing");
  }
  const primaryWindow = quotaWindows.find((w) => w.kind === "rolling_weekly") || quotaWindows[quotaWindows.length - 1];
  return {
    quota_windows: quotaWindows,
    total_quota: primaryWindow.total,
    used_quota: primaryWindow.used,
    remaining_quota: primaryWindow.remaining,
  };
}

async function fetchCodexWhamUsage(accessToken, { fetchImpl = globalThis.fetch, accountId = null } = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }
  const response = await fetchImpl(CODEX_USAGE_URL, {
    method: "GET",
    headers,
    redirect: "manual",
  });
  if (response.status === 401 || response.status === 403) {
    throw new CodexTokenPlanError("CODEX_REAUTH_REQUIRED", "Codex login expired — run `codex` to re-authenticate");
  }
  if (response.status === 404) {
    throw new CodexTokenPlanError("CODEX_NO_QUOTA_WINDOWS", "Codex usage data is not available for this account");
  }
  if (!response.ok) {
    throw new CodexTokenPlanError("CODEX_PROVIDER_ERROR", `Codex usage endpoint returned HTTP ${response.status}`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new CodexTokenPlanError("CODEX_RESPONSE_TOO_LARGE", "Codex usage response exceeded the size limit");
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new CodexTokenPlanError("CODEX_RESPONSE_STRUCTURE_DRIFT", "Codex usage response is not valid JSON");
  }
  return payload;
}

async function fetchCodexQuota({ home, env, fetchImpl = globalThis.fetch } = {}) {
  const auth = await readCodexAuthBundle({ home, env });
  if (!auth?.accessToken) {
    throw new CodexTokenPlanError("CODEX_REAUTH_REQUIRED", "Codex is not configured — run `codex` to log in");
  }
  let accessToken = auth.accessToken;
  let accountId = auth.accountId || null;
  if (auth.refreshToken && isTokenStale(auth.lastRefresh)) {
    try {
      const newTokens = await refreshCodexTokens({
        refreshToken: auth.refreshToken,
        fetchImpl,
      });
      const updatedAuth = await persistRefreshedAuth(auth.authPath, auth.authJson, newTokens);
      accessToken = newTokens.access_token;
      accountId = auth.accountId || null;
      void updatedAuth;
    } catch (error) {
      if (error?.code === "REFRESH_TOKEN_EXPIRED") {
        throw new CodexTokenPlanError("CODEX_REAUTH_REQUIRED", error.message);
      }
    }
  }
  const body = await fetchCodexWhamUsage(accessToken, { fetchImpl, accountId });
  const parsed = parseCodexUsageBody(body);
  return {
    ...parsed,
    provider_reported_at: new Date().toISOString(),
  };
}

function createCodexProviderAdapter({ fetchImpl = globalThis.fetch, home, env } = {}) {
  return async function codexProviderAdapter(plan) {
    if (plan?.detection_method === "official_account") {
      throw new CodexTokenPlanError(
        "CODEX_CONSOLE_SYNC_REQUIRED",
        "请点击「连接并同步」通过 ChatGPT 官网登录刷新额度",
      );
    }
    return fetchCodexQuota({ home, env, fetchImpl });
  };
}

module.exports = {
  CODEX_USAGE_URL,
  CodexTokenPlanError,
  mapCodexErrorCode,
  parseCodexUsageBody,
  fetchCodexQuota,
  createCodexProviderAdapter,
};
