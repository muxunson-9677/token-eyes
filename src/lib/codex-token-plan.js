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
const CODEX_RESET_CREDIT_ALLOWLIST = Object.freeze([
  "rate_limit_reset_credits.available_count",
  "rate_limit_reset_credits.applicable_available_count",
]);

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
    case "CODEX_ENDPOINT_UNSUPPORTED":
      return "unsupported";
    case "CODEX_TEMPORARY_ERROR":
    case "CODEX_NETWORK_ERROR":
      return "temporary";
    default:
      return "failed";
  }
}

function codexUsageErrorForHttpStatus(status) {
  if (status === 401 || status === 403) {
    return new CodexTokenPlanError("CODEX_REAUTH_REQUIRED", "Codex login expired — reauthenticate");
  }
  if (status === 404) {
    return new CodexTokenPlanError("CODEX_ENDPOINT_UNSUPPORTED", "Codex usage endpoint is unavailable");
  }
  if (status >= 500) {
    return new CodexTokenPlanError("CODEX_TEMPORARY_ERROR", "Codex usage service is temporarily unavailable");
  }
  return new CodexTokenPlanError("CODEX_PROVIDER_ERROR", "Codex usage request failed");
}

function codexUsageErrorState(error) {
  switch (error?.code) {
    case "CODEX_REAUTH_REQUIRED":
      return {
        auth_action_required: "reauth",
        error_code: "auth_required",
        error: "Codex authentication is required.",
      };
    case "CODEX_ENDPOINT_UNSUPPORTED":
      return {
        unsupported: true,
        error_code: "endpoint_unsupported",
        error: "Codex usage is unsupported.",
      };
    case "CODEX_RESPONSE_STRUCTURE_DRIFT":
    case "CODEX_NO_QUOTA_WINDOWS":
      return {
        unsupported: true,
        error_code: "response_unsupported",
        error: "Codex usage response is unsupported.",
      };
    case "CODEX_TEMPORARY_ERROR":
      return {
        error_code: "upstream_5xx",
        error: "Codex usage is temporarily unavailable.",
      };
    case "CODEX_NETWORK_ERROR":
      return {
        error_code: "network_error",
        error: "Codex usage is temporarily unavailable.",
      };
    default:
      return {
        error_code: "upstream_http_error",
        error: "Codex usage request failed.",
      };
  }
}

function clampPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && !value.trim()) return null;
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
    used_percent: usedPercent,
  };
}

function normalizeCodexRateWindows(rateLimit) {
  const primary = normalizeCodexRateWindow(rateLimit?.primary_window);
  const secondary = normalizeCodexRateWindow(rateLimit?.secondary_window);
  const candidates = [primary, secondary].filter(Boolean);
  let fiveHour = null;
  let weekly = null;
  for (const window of candidates) {
    const kind = classifyCodexWindow(window);
    if (kind === "rolling_5_hour" && !fiveHour) fiveHour = window;
    else if (kind === "rolling_weekly" && !weekly) weekly = window;
  }
  if (!fiveHour && !weekly && candidates.length > 0) {
    return { primary_window: primary, secondary_window: secondary };
  }
  return { primary_window: fiveHour, secondary_window: weekly };
}

function isCodexSparkLimit(entry) {
  if (!entry || typeof entry !== "object") return false;
  return [entry.limit_name, entry.metered_feature].some((value) => (
    typeof value === "string" && value.trim().toLowerCase().includes("spark")
  ));
}

function codexSparkFallbackCandidates(primary, secondary) {
  const primaryKind = classifyCodexWindow(primary);
  const secondaryKind = classifyCodexWindow(secondary);
  const out = [];
  const primaryDurationMissing = primary
    && (primary.limit_window_seconds === undefined
      || primary.limit_window_seconds === null
      || primary.limit_window_seconds === "");
  if (primaryKind || secondaryKind) {
    if (!primaryKind && primary && secondaryKind === "rolling_weekly") {
      out.push({ kind: "rolling_5_hour", window: primary });
    }
    if (!primaryKind && primaryDurationMissing && secondaryKind === "rolling_5_hour") {
      out.push({ kind: "rolling_weekly", window: primary });
    }
    if (!secondaryKind && secondary && primaryKind === "rolling_weekly") {
      out.push({ kind: "rolling_5_hour", window: secondary });
    }
    if (!secondaryKind && secondary && primaryKind === "rolling_5_hour") {
      out.push({ kind: "rolling_weekly", window: secondary });
    }
    return out;
  }
  if (primary) out.push({ kind: "rolling_5_hour", window: primary });
  if (secondary) out.push({ kind: "rolling_weekly", window: secondary });
  return out;
}

function normalizeCodexSparkRateWindows(additionalRateLimits) {
  let fiveHour = null;
  let weekly = null;
  if (!Array.isArray(additionalRateLimits)) {
    return { spark_primary_window: null, spark_secondary_window: null };
  }
  const classified = [];
  const fallback = [];
  for (const entry of additionalRateLimits) {
    if (!isCodexSparkLimit(entry) || !entry.rate_limit || typeof entry.rate_limit !== "object") continue;
    const primary = normalizeCodexRateWindow(entry.rate_limit.primary_window);
    const secondary = normalizeCodexRateWindow(entry.rate_limit.secondary_window);
    for (const window of [primary, secondary]) {
      const kind = classifyCodexWindow(window);
      if (kind) classified.push({ kind, window });
    }
    fallback.push(...codexSparkFallbackCandidates(primary, secondary));
  }
  for (const candidate of [...classified, ...fallback]) {
    if (candidate.kind === "rolling_5_hour" && !fiveHour) fiveHour = candidate.window;
    else if (candidate.kind === "rolling_weekly" && !weekly) weekly = candidate.window;
  }
  return { spark_primary_window: fiveHour, spark_secondary_window: weekly };
}

function parseCodexResetCreditFields(body) {
  const source = body?.rate_limit_reset_credits;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const available = Number(source.available_count);
  const applicable = Number(source.applicable_available_count);
  if (!Number.isSafeInteger(available) || available < 0
    || !Number.isSafeInteger(applicable) || applicable < 0) return null;
  return { available_count: available, applicable_available_count: applicable };
}

function mapCodexUsageResponse(body) {
  const regular = normalizeCodexRateWindows(body?.rate_limit);
  const spark = normalizeCodexSparkRateWindows(body?.additional_rate_limits);
  const resetCredits = parseCodexResetCreditFields(body);
  return {
    ...regular,
    ...spark,
    ...(resetCredits ? { reset_credits: resetCredits } : {}),
  };
}

function percentWindowToQuotaWindow(window, kind) {
  const usedPercent = clampPercent(window?.used_percent);
  if (usedPercent === null) return null;
  const used = usedPercent;
  return {
    kind,
    unit: "percent",
    total: PERCENT_SCALE,
    used,
    remaining: Math.max(0, PERCENT_SCALE - used),
    percentage: used,
    resets_at: parseResetAt(window.reset_at),
  };
}

function parseCodexUsageBody(body) {
  const mapped = mapCodexUsageResponse(body);
  const fiveHour = mapped.primary_window;
  const weekly = mapped.secondary_window;
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
    quota_unit: "percent",
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
  let response;
  try {
    response = await fetchImpl(CODEX_USAGE_URL, {
      method: "GET",
      headers,
      redirect: "manual",
    });
  } catch {
    throw new CodexTokenPlanError("CODEX_NETWORK_ERROR", "Codex usage request failed");
  }
  if (!response.ok) {
    throw codexUsageErrorForHttpStatus(response.status);
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

async function fetchCodexQuota({
  home,
  env,
  fetchImpl = globalThis.fetch,
  readAuthBundle = readCodexAuthBundle,
} = {}) {
  const auth = await readAuthBundle({ home, env });
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

function createCodexProviderAdapter({
  fetchImpl = globalThis.fetch,
  home,
  env,
  readAuthBundle = readCodexAuthBundle,
} = {}) {
  return async function codexProviderAdapter() {
    return fetchCodexQuota({ home, env, fetchImpl, readAuthBundle });
  };
}

module.exports = {
  CODEX_USAGE_URL,
  CODEX_RESET_CREDIT_ALLOWLIST,
  CodexTokenPlanError,
  codexUsageErrorForHttpStatus,
  codexUsageErrorState,
  mapCodexErrorCode,
  mapCodexUsageResponse,
  normalizeCodexRateWindow,
  parseCodexResetCreditFields,
  parseCodexUsageBody,
  fetchCodexWhamUsage,
  fetchCodexQuota,
  createCodexProviderAdapter,
};
