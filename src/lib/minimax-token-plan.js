"use strict";

const MINIMAX_TOKEN_PLAN_URL_CN = "https://api.minimaxi.com/v1/token_plan/remains";
const MINIMAX_TOKEN_PLAN_URL_GLOBAL = "https://api.minimax.io/v1/token_plan/remains";
const MAX_RESPONSE_BYTES = 1024 * 1024;

class MiniMaxTokenPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MiniMaxTokenPlanError";
    this.code = code;
  }
}

function mapMiniMaxErrorCode(error) {
  if (!(error instanceof MiniMaxTokenPlanError)) return "failed";
  switch (error.code) {
    case "MINIMAX_REAUTH_REQUIRED":
      return "reauth_required";
    case "MINIMAX_RESPONSE_STRUCTURE_DRIFT":
    case "MINIMAX_UNSUPPORTED":
      return "unsupported";
    default:
      return "failed";
  }
}

function parseTokenInteger(raw) {
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

function buildQuotaWindow({ kind, total, used, resetsAt }) {
  if (total === null || used === null) return null;
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

function pickPrimaryModelEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const preferred = entries.find((item) => {
    const name = String(item?.model_name || "").toLowerCase();
    return name.includes("minimax-m") || name === "general";
  });
  return preferred || entries[0];
}

function resolveIntervalUsed(entry) {
  const total = parseTokenInteger(entry?.current_interval_total_count);
  const usageCount = parseTokenInteger(entry?.current_interval_usage_count);
  const remainingCount = parseTokenInteger(
    entry?.current_interval_remaining_count ?? entry?.current_interval_remains_count,
  );
  if (total === null) return { total: null, used: null };
  if (usageCount !== null) {
    // Official token_plan/remains: usage_count is consumed prompts (MiniMax CLI).
    if (usageCount <= total) return { total, used: usageCount };
    // Defensive: treat as remaining when count exceeds total.
    return { total, used: Math.max(0, total - usageCount) };
  }
  if (remainingCount !== null) {
    return { total, used: Math.max(0, total - remainingCount) };
  }
  const remainingPercent = Number(entry?.current_interval_remaining_percent);
  if (Number.isFinite(remainingPercent) && remainingPercent >= 0 && remainingPercent <= 100) {
    const used = Math.round(total * (1 - remainingPercent / 100));
    return { total, used };
  }
  return { total, used: null };
}

function resolveWeeklyUsed(entry) {
  const total = parseTokenInteger(entry?.current_weekly_total_count);
  if (total === null || total <= 0) return null;
  const usageCount = parseTokenInteger(entry?.current_weekly_usage_count);
  const remainingCount = parseTokenInteger(
    entry?.current_weekly_remaining_count ?? entry?.current_weekly_remains_count,
  );
  if (usageCount !== null) {
    if (usageCount <= total) return { total, used: usageCount };
    return { total, used: Math.max(0, total - usageCount) };
  }
  if (remainingCount !== null) {
    return { total, used: Math.max(0, total - remainingCount) };
  }
  const remainingPercent = Number(entry?.current_weekly_remaining_percent);
  if (Number.isFinite(remainingPercent) && remainingPercent >= 0 && remainingPercent <= 100) {
    return { total, used: Math.round(total * (1 - remainingPercent / 100)) };
  }
  return null;
}

function weeklyWindowActive(entry) {
  const status = String(entry?.current_weekly_status || "").toLowerCase();
  if (status === "active" || status === "running") return true;
  const total = parseTokenInteger(entry?.current_weekly_total_count);
  return total !== null && total > 0;
}

function parseMiniMaxTokenPlanResponse(payload) {
  const statusCode = Number(payload?.base_resp?.status_code);
  if (statusCode !== 0) {
    if ([1004, 1008, 2049].includes(statusCode)) {
      throw new MiniMaxTokenPlanError("MINIMAX_REAUTH_REQUIRED", "MiniMax API Key is invalid or expired");
    }
    throw new MiniMaxTokenPlanError("MINIMAX_PROVIDER_ERROR", "MiniMax token plan endpoint returned an error");
  }
  const entry = pickPrimaryModelEntry(payload?.model_remains);
  if (!entry) {
    throw new MiniMaxTokenPlanError("MINIMAX_RESPONSE_STRUCTURE_DRIFT", "MiniMax model_remains is missing");
  }
  const interval = resolveIntervalUsed(entry);
  const fiveHour = buildQuotaWindow({
    kind: "rolling_5_hour",
    total: interval.total,
    used: interval.used,
    resetsAt: parseResetAt(entry.end_time || entry.remains_time),
  });
  const quotaWindows = [];
  if (fiveHour) quotaWindows.push(fiveHour);
  if (weeklyWindowActive(entry)) {
    const weekly = resolveWeeklyUsed(entry);
    const weeklyWindow = weekly
      ? buildQuotaWindow({
        kind: "rolling_weekly",
        total: weekly.total,
        used: weekly.used,
        resetsAt: parseResetAt(entry.weekly_end_time || entry.weekly_remains_time),
      })
      : null;
    if (weeklyWindow) quotaWindows.push(weeklyWindow);
  }
  if (quotaWindows.length === 0) {
    throw new MiniMaxTokenPlanError("MINIMAX_RESPONSE_STRUCTURE_DRIFT", "MiniMax quota windows are missing");
  }
  const primary = quotaWindows.find((window) => window.kind === "rolling_weekly") || quotaWindows[0];
  return {
    quota_windows: quotaWindows,
    total_quota: primary.total,
    used_quota: primary.used,
    remaining_quota: primary.remaining,
    plan_name: String(entry.current_subscribe_title || entry.plan_name || entry.plan || "").trim(),
    model_name: String(entry.model_name || "").trim(),
  };
}

async function fetchMiniMaxTokenPlanRemains({
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  urls = [MINIMAX_TOKEN_PLAN_URL_CN, MINIMAX_TOKEN_PLAN_URL_GLOBAL],
} = {}) {
  if (!String(apiKey || "").trim()) {
    throw new MiniMaxTokenPlanError("MINIMAX_REAUTH_REQUIRED", "MiniMax subscription API Key is missing");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let lastError = null;
  try {
    for (const url of urls) {
      try {
        const response = await fetchImpl(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${String(apiKey).trim()}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          redirect: "manual",
          signal: controller.signal,
        });
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
          throw new MiniMaxTokenPlanError("MINIMAX_RESPONSE_TOO_LARGE", "MiniMax response exceeded the size limit");
        }
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          throw new MiniMaxTokenPlanError("MINIMAX_RESPONSE_STRUCTURE_DRIFT", "MiniMax response is not valid JSON");
        }
        if (response.status === 401 || response.status === 403) {
          throw new MiniMaxTokenPlanError("MINIMAX_REAUTH_REQUIRED", "MiniMax API Key is invalid or expired");
        }
        const statusCode = Number(payload?.base_resp?.status_code);
        if (statusCode === 2049 || statusCode === 1004) {
          lastError = new MiniMaxTokenPlanError("MINIMAX_REAUTH_REQUIRED", "MiniMax API Key is invalid or expired");
          continue;
        }
        if (!response.ok) {
          lastError = new MiniMaxTokenPlanError("MINIMAX_PROVIDER_ERROR", `MiniMax token plan returned HTTP ${response.status}`);
          continue;
        }
        const parsed = parseMiniMaxTokenPlanResponse(payload);
        return {
          ...parsed,
          provider_reported_at: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof MiniMaxTokenPlanError) {
          lastError = error;
          if (error.code === "MINIMAX_REAUTH_REQUIRED") continue;
          throw error;
        }
        lastError = error;
      }
    }
    if (lastError instanceof MiniMaxTokenPlanError) throw lastError;
    throw new MiniMaxTokenPlanError("MINIMAX_NETWORK_ERROR", "Unable to query MiniMax token plan");
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new MiniMaxTokenPlanError("MINIMAX_TIMEOUT", "MiniMax token plan request timed out");
    }
    if (error instanceof MiniMaxTokenPlanError) throw error;
    throw new MiniMaxTokenPlanError("MINIMAX_NETWORK_ERROR", "Unable to query MiniMax token plan");
  } finally {
    clearTimeout(timeout);
  }
}

function createMiniMaxProviderAdapter({ fetchImpl = globalThis.fetch } = {}) {
  return async function miniMaxProviderAdapter(plan, { resolveApiKey } = {}) {
    const planId = String(plan?.plan_id || "").trim();
    if (planId === "minimax_api_budget") {
      throw new MiniMaxTokenPlanError(
        "MINIMAX_UNSUPPORTED",
        "MiniMax pay-as-you-go balance has no public API",
      );
    }
    const ref = plan?.detection_config?.official_account?.api_key_ref || "";
    const apiKey = resolveApiKey ? await resolveApiKey(ref) : "";
    return fetchMiniMaxTokenPlanRemains({ apiKey, fetchImpl });
  };
}

module.exports = {
  MINIMAX_TOKEN_PLAN_URL_CN,
  MINIMAX_TOKEN_PLAN_URL_GLOBAL,
  MiniMaxTokenPlanError,
  mapMiniMaxErrorCode,
  parseMiniMaxTokenPlanResponse,
  fetchMiniMaxTokenPlanRemains,
  createMiniMaxProviderAdapter,
};
