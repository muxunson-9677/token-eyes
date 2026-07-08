"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  loadKimiCredentials,
  normalizeKimiUsageResponse,
} = require("./usage-limits");

const KIMI_BALANCE_URL_CN = "https://api.moonshot.cn/v1/users/me/balance";
const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const KIMI_TOKEN_URL = "https://auth.kimi.com/api/oauth/token";
const MAX_RESPONSE_BYTES = 1024 * 1024;

class KimiTokenPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "KimiTokenPlanError";
    this.code = code;
  }
}

function mapKimiErrorCode(error) {
  if (!(error instanceof KimiTokenPlanError)) return "failed";
  switch (error.code) {
    case "KIMI_REAUTH_REQUIRED":
      return "reauth_required";
    case "KIMI_CONSOLE_SYNC_REQUIRED":
      return "not_configured";
    case "KIMI_RESPONSE_STRUCTURE_DRIFT":
      return "unsupported";
    default:
      return "failed";
  }
}

function parseMoneyNumber(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1e6) / 1e6;
}

function parseTokenInteger(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.trunc(n))) return null;
  return Math.trunc(n);
}

function parseResetAt(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const ts = Date.parse(raw);
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : "";
}

function usageEntryToQuotaWindow(entry, kind) {
  if (!entry || typeof entry !== "object") return null;
  const total = parseTokenInteger(entry.limit);
  let used = parseTokenInteger(entry.used);
  if (used === null) {
    const remaining = parseTokenInteger(entry.remaining);
    if (remaining !== null && total !== null) used = Math.max(0, total - remaining);
  }
  if (total === null || used === null) return null;
  return {
    kind,
    unit: "tokens",
    total,
    used,
    remaining: Math.max(0, total - used),
    percentage: total > 0 ? Math.round((used / total) * 10000) / 100 : 0,
    resets_at: parseResetAt(entry.resetTime || entry.reset_at || entry.resetAt),
  };
}

function parseKimiUsageBody(body) {
  const weekly = usageEntryToQuotaWindow(body?.usage, "rolling_weekly");
  const fiveHourDetail = Array.isArray(body?.limits) && body.limits[0]?.detail
    ? body.limits[0].detail
    : null;
  const fiveHour = usageEntryToQuotaWindow(fiveHourDetail, "rolling_5_hour");
  const quotaWindows = [fiveHour, weekly].filter(Boolean);
  if (quotaWindows.length === 0) {
    throw new KimiTokenPlanError("KIMI_RESPONSE_STRUCTURE_DRIFT", "Kimi usage windows are missing");
  }
  const primary = weekly || quotaWindows[quotaWindows.length - 1];
  return {
    quota_windows: quotaWindows,
    total_quota: primary.total,
    used_quota: primary.used,
    remaining_quota: primary.remaining,
    membership_level: typeof body?.user?.membership?.level === "string" ? body.user.membership.level : "",
    subscription_type: typeof body?.subType === "string" ? body.subType : "",
  };
}

function parseKimiBalanceResponse(payload) {
  const data = payload?.data;
  if (!data || typeof data !== "object") {
    throw new KimiTokenPlanError("KIMI_RESPONSE_STRUCTURE_DRIFT", "Kimi balance payload is missing data");
  }
  const available = parseMoneyNumber(data.available_balance);
  const voucher = parseMoneyNumber(data.voucher_balance);
  const cash = parseMoneyNumber(data.cash_balance);
  if (available === null) {
    throw new KimiTokenPlanError("KIMI_RESPONSE_STRUCTURE_DRIFT", "Kimi available_balance is invalid");
  }
  const remainingCents = Math.round(available * 100);
  return {
    balance: {
      available_balance: available,
      voucher_balance: voucher ?? 0,
      cash_balance: cash ?? 0,
      currency: "CNY",
      provider_reported_at: new Date().toISOString(),
    },
    total_quota: remainingCents,
    used_quota: 0,
    remaining_quota: remainingCents,
  };
}

function kimiCredentialsExpired(creds, nowMs = Date.now()) {
  const expiresAt = Number(creds?.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
  return expiresAt * 1000 <= nowMs + 30_000;
}

async function refreshKimiAccessToken({ refreshToken, saveCredentials, home, env, fetchImpl = globalThis.fetch }) {
  if (typeof refreshToken !== "string" || !refreshToken.trim()) {
    throw new KimiTokenPlanError("KIMI_REAUTH_REQUIRED", "Not logged in to Kimi Code");
  }
  const body = new URLSearchParams({
    client_id: "17e5f671-d194-4dfb-9706-5516cb48c098",
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetchImpl(KIMI_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Msh-Platform": "kimi_cli",
    },
    body,
  });
  if (response.status === 401 || response.status === 403) {
    throw new KimiTokenPlanError("KIMI_REAUTH_REQUIRED", "Kimi Code login expired");
  }
  if (!response.ok) {
    throw new KimiTokenPlanError("KIMI_PROVIDER_ERROR", `Kimi token refresh failed (HTTP ${response.status})`);
  }
  const json = await response.json();
  if (!json?.access_token) {
    throw new KimiTokenPlanError("KIMI_RESPONSE_STRUCTURE_DRIFT", "Kimi token refresh response is invalid");
  }
  const expiresIn = Number(json.expires_in);
  const next = {
    access_token: String(json.access_token),
    refresh_token: String(json.refresh_token || refreshToken),
    expires_at: Date.now() / 1000 + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900),
    scope: String(json.scope || "kimi-code"),
    token_type: String(json.token_type || "Bearer"),
    expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900,
  };
  if (typeof saveCredentials === "function") {
    saveCredentials(next, { home, env });
  }
  return next.access_token;
}

async function fetchKimiUsage(accessToken, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(KIMI_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    redirect: "manual",
  });
  if (response.status === 401 || response.status === 403) {
    throw new KimiTokenPlanError("KIMI_REAUTH_REQUIRED", "Kimi Code login expired");
  }
  if (!response.ok) {
    throw new KimiTokenPlanError("KIMI_PROVIDER_ERROR", `Kimi usage endpoint returned HTTP ${response.status}`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new KimiTokenPlanError("KIMI_RESPONSE_TOO_LARGE", "Kimi usage response exceeded the size limit");
  }
  return JSON.parse(text);
}

function hasKimiCodeConfig({ home, env } = {}) {
  const explicit = typeof env?.KIMI_HOME === "string" ? env.KIMI_HOME.trim() : "";
  const kimiHome = explicit ? path.resolve(explicit) : path.join(home || os.homedir(), ".kimi");
  return fs.existsSync(path.join(kimiHome, "config.toml"));
}

async function fetchKimiCodeQuota({
  home,
  env,
  fetchImpl = globalThis.fetch,
  loadCredentials = loadKimiCredentials,
  saveCredentials,
} = {}) {
  if (!hasKimiCodeConfig({ home, env })) {
    throw new KimiTokenPlanError("KIMI_REAUTH_REQUIRED", "Kimi Code is not configured on this machine");
  }
  const creds = loadCredentials({ home, env });
  let accessToken = typeof creds?.access_token === "string" ? creds.access_token.trim() : "";
  if (!accessToken) {
    throw new KimiTokenPlanError("KIMI_REAUTH_REQUIRED", "Run kimi in Terminal to authenticate");
  }
  if (kimiCredentialsExpired(creds) && creds?.refresh_token) {
    accessToken = await refreshKimiAccessToken({
      refreshToken: creds.refresh_token,
      saveCredentials,
      home,
      env,
      fetchImpl,
    });
  }
  let body;
  try {
    body = await fetchKimiUsage(accessToken, { fetchImpl });
  } catch (error) {
    if (error instanceof KimiTokenPlanError && error.code === "KIMI_REAUTH_REQUIRED" && creds?.refresh_token) {
      accessToken = await refreshKimiAccessToken({
        refreshToken: creds.refresh_token,
        saveCredentials,
        home,
        env,
        fetchImpl,
      });
      body = await fetchKimiUsage(accessToken, { fetchImpl });
    } else {
      throw error;
    }
  }
  const parsed = parseKimiUsageBody(body);
  normalizeKimiUsageResponse(body);
  return {
    ...parsed,
    provider_reported_at: new Date().toISOString(),
  };
}

async function fetchKimiBalance({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 10_000, balanceUrl = KIMI_BALANCE_URL_CN }) {
  if (!String(apiKey || "").trim()) {
    throw new KimiTokenPlanError("KIMI_REAUTH_REQUIRED", "Moonshot API Key is missing");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(balanceUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${String(apiKey).trim()}`,
        Accept: "application/json",
      },
      redirect: "manual",
      signal: controller.signal,
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new KimiTokenPlanError("KIMI_RESPONSE_TOO_LARGE", "Kimi balance response exceeded the size limit");
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new KimiTokenPlanError("KIMI_RESPONSE_STRUCTURE_DRIFT", "Kimi balance response is not valid JSON");
    }
    if (response.status === 401 || response.status === 403) {
      throw new KimiTokenPlanError("KIMI_REAUTH_REQUIRED", "Moonshot API Key is invalid or expired");
    }
    if (!response.ok || payload?.status === false) {
      throw new KimiTokenPlanError("KIMI_PROVIDER_ERROR", "Kimi balance endpoint returned an error");
    }
    const parsed = parseKimiBalanceResponse(payload);
    return {
      ...parsed,
      provider_reported_at: parsed.balance.provider_reported_at,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new KimiTokenPlanError("KIMI_TIMEOUT", "Kimi balance request timed out");
    }
    if (error instanceof KimiTokenPlanError) throw error;
    throw new KimiTokenPlanError("KIMI_NETWORK_ERROR", "Unable to query Kimi balance");
  } finally {
    clearTimeout(timeout);
  }
}

function createKimiProviderAdapter({ fetchImpl = globalThis.fetch, home, env } = {}) {
  return async function kimiProviderAdapter(plan, { resolveApiKey } = {}) {
    const planId = String(plan?.plan_id || "").trim();
    if (planId === "kimi_api_budget") {
      const ref = plan?.detection_config?.official_account?.api_key_ref || "";
      const apiKey = resolveApiKey ? await resolveApiKey(ref) : "";
      return fetchKimiBalance({ apiKey, fetchImpl });
    }
    if (plan?.detection_method === "official_account") {
      throw new KimiTokenPlanError(
        "KIMI_CONSOLE_SYNC_REQUIRED",
        "请点击「连接并同步」通过 Kimi Code 官网登录刷新额度",
      );
    }
    return fetchKimiCodeQuota({ home, env, fetchImpl });
  };
}

module.exports = {
  KIMI_BALANCE_URL_CN,
  KIMI_USAGE_URL,
  KimiTokenPlanError,
  mapKimiErrorCode,
  parseKimiBalanceResponse,
  parseKimiUsageBody,
  fetchKimiBalance,
  fetchKimiCodeQuota,
  createKimiProviderAdapter,
};
