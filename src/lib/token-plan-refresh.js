"use strict";

/**
 * Token Plan auto refresh scheduler (TE-FULL-F03).
 *
 * 设计要点（见 docs/dev-notes/token-eyes-full-plan-interfaces.md#F02）:
 * - 后台调度只在本地进程存活时运行，不新增系统服务。
 * - 同一 plan 同一时刻只允许一个 refresh in-flight。
 * - refresh_method:
 *   - manual: 不自动刷新，保留手动录入。
 *   - official_api: 第一批没有可用 provider quota API 时，写 failed 状态。
 *   - cookie_scrape: 仅展示风险提示和未配置状态，不执行真实抓取。
 * - 不保存原始 token/cookie；credential_ref 只能保存引用名。
 * - 失败必须给用户可读错误，不能静默失败。
 *
 * W03-R3A: Detection method contract additions.
 * - detection_method: "official_account" | "custom_api" | "not_configured"
 * - sync_status: replaces last_refresh_status as canonical sync state field
 * - Old refresh_* fields are mapped forward for compatibility
 */

const ALLOWED_INTERVALS = new Set([5, 15, 30, 60, 240, 1440]);
const ALLOWED_METHODS = new Set(["manual", "official_api", "cookie_scrape"]);
const ALLOWED_CREDENTIAL_REFS = new Set([
  "codex_auth_json",
  "claude_credentials_json",
  "",
]);

// W03-R3A: Detection method constants
const DETECTION_METHODS = new Set(["not_configured", "official_account", "custom_api"]);
const SYNC_STATUSES = new Set([
  "not_configured",
  "auth_required",
  "syncing",
  "success",
  "failed",
  "reauth_required",
  "unsupported",
]);

// W03-R3A: Forbidden plaintext credential fields — checked recursively
const FORBIDDEN_PLAINTEXT_FIELDS = new Set([
  "api_key",
  "apiKey",
  "cookie",
  "authorization",
  "authorization_header",
  "bearer",
  "token",
  "password",
  "secret",
]);

// 可识别的 provider quota API 实现注册表（第一批为空）。
// provider adapter 返回 { total_quota, used_quota, remaining_quota }。
const PROVIDER_ADAPTERS = new Map();

// W03-R3C: Custom API detection module (lazy-loaded to avoid circular deps)
let _customApiModule = null;
function getCustomApiModule() {
  if (!_customApiModule) {
    _customApiModule = require("./token-plan-custom-api");
  }
  return _customApiModule;
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutesIso(iso, minutes) {
  const base = iso ? new Date(iso) : new Date();
  if (Number.isFinite(minutes) && minutes > 0) {
    base.setUTCMinutes(base.getUTCMinutes() + Math.trunc(minutes));
  }
  return base.toISOString();
}

function isDue(plan, now = new Date()) {
  if (!plan || plan.refresh_enabled !== true) return false;
  if (plan.refresh_method === "manual") return false;
  const next = plan.next_refresh_at ? new Date(plan.next_refresh_at) : null;
  if (!next || Number.isNaN(next.getTime())) return true;
  return now.getTime() >= next.getTime();
}

function pickIntervalMinutes(value, fallback = 60) {
  const n = Number(value);
  if (Number.isFinite(n) && ALLOWED_INTERVALS.has(n)) return n;
  const fb = Number(fallback);
  return Number.isFinite(fb) && ALLOWED_INTERVALS.has(fb) ? fb : 60;
}

function pickMethod(value, fallback = "manual") {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (ALLOWED_METHODS.has(v)) return v;
  const fb = typeof fallback === "string" ? fallback.trim().toLowerCase() : "";
  return ALLOWED_METHODS.has(fb) ? fb : "manual";
}

function pickCredentialRef(value) {
  const v = typeof value === "string" ? value.trim() : "";
  // 只允许白名单引用名，避免保存任意字符串（更不允许原始 token/cookie）。
  return ALLOWED_CREDENTIAL_REFS.has(v) ? v : "";
}

// ---------------------------------------------------------------------------
// W03-R3A: Detection method normalization helpers
// ---------------------------------------------------------------------------

/**
 * Normalize detection_method from input value and fallback.
 * Valid values: "not_configured" | "official_account" | "custom_api"
 */
function pickDetectionMethod(value, fallback) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (DETECTION_METHODS.has(v)) return v;
  const fb = typeof fallback === "string" ? fallback.trim().toLowerCase() : "";
  return DETECTION_METHODS.has(fb) ? fb : "not_configured";
}

/**
 * Map old refresh_method to new detection_method.
 * - "official_api" -> "official_account"
 * - "cookie_scrape" / "manual" -> "not_configured"
 * Returns "not_configured" for unrecognized values.
 */
function mapRefreshMethodToDetectionMethod(refreshMethod) {
  const method = String(refreshMethod || "").trim().toLowerCase();
  if (method === "official_api") return "official_account";
  if (method === "custom_api") return "custom_api";
  return "not_configured";
}

/**
 * Normalize sync_status from input value and fallback.
 */
function pickSyncStatus(value, fallback) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (SYNC_STATUSES.has(v)) return v;
  const fb = typeof fallback === "string" ? fallback.trim().toLowerCase() : "";
  return SYNC_STATUSES.has(fb) ? fb : "not_configured";
}

/**
 * Map old last_refresh_status to new sync_status.
 * - "success" -> "success"
 * - "failed" -> "failed"
 * - empty / other -> "not_configured"
 */
function mapRefreshStatusToSyncStatus(lastRefreshStatus) {
  const status = String(lastRefreshStatus || "").trim().toLowerCase();
  if (status === "success") return "success";
  if (status === "failed") return "failed";
  return "not_configured";
}

/**
 * Normalize detection_config. Ensures it is a plain object with only
 * allowed sub-objects (official_account, custom_api). Strips any
 * plaintext secret fields from custom_api config.
 */
function normalizeDetectionConfig(config, fallback) {
  const input = config && typeof config === "object" ? config : {};
  const fb = fallback && typeof fallback === "object" ? fallback : {};
  const result = {};

  // official_account config
  const oa = input.official_account || fb.official_account;
  if (oa && typeof oa === "object") {
    const apiKeyRef = String(oa.api_key_ref || "").trim();
    const claudeAccountModeRaw = String(oa.claude_account_mode || "").trim().toLowerCase();
    const claudeAccountMode = claudeAccountModeRaw === "official" || claudeAccountModeRaw === "routing"
      ? claudeAccountModeRaw
      : "";
    result.official_account = {
      provider_home_url: String(oa.provider_home_url || "").trim(),
      account_binding_id: String(oa.account_binding_id || "").trim(),
      api_key_ref: isValidApiKeyRef(apiKeyRef) ? apiKeyRef : "",
      ...(claudeAccountMode ? { claude_account_mode: claudeAccountMode } : {}),
    };
  }

  // custom_api config (must not contain plaintext secrets)
  const ca = input.custom_api || fb.custom_api;
  if (ca && typeof ca === "object") {
    result.custom_api = {
      api_key_ref: String(ca.api_key_ref || "").trim(),
      api_format: String(ca.api_format || "json_path").trim(),
      request_url: String(ca.request_url || "").trim(),
      official_url: String(ca.official_url || "").trim(),
      method: String(ca.method || "GET").toUpperCase() === "POST" ? "POST" : "GET",
      response_mapping: ca.response_mapping && typeof ca.response_mapping === "object"
        ? {
            total_quota_path: String(ca.response_mapping.total_quota_path || "").trim(),
            used_quota_path: String(ca.response_mapping.used_quota_path || "").trim(),
            remaining_quota_path: String(ca.response_mapping.remaining_quota_path || "").trim(),
            expires_at_path: String(ca.response_mapping.expires_at_path || "").trim(),
          }
        : {},
    };
    // W03-R3A P1 fix: These delete lines are defense-in-depth for legacy data
    // reads only. New writes are rejected upstream by checkForbiddenFields()
    // which recursively rejects nested secrets before they reach here.
    // Do NOT remove these deletes — they protect against pre-existing leaked
    // secrets in config.json from before this check was added.
    delete result.custom_api.api_key;
    delete result.custom_api.apiKey;
    delete result.custom_api.secret;
    delete result.custom_api.cookie;
    delete result.custom_api.authorization;
    delete result.custom_api.bearer;
    delete result.custom_api.token;
    delete result.custom_api.password;
  }

  return result;
}

/**
 * Check if payload contains any forbidden plaintext credential fields.
 * Recursively checks all nested objects (not just top-level and detection_config).
 * Returns { valid: true } or { valid: false, field: "name" }.
 *
 * W03-R3A P1 fix: was only checking top-level + detection_config, missing
 * nested custom_api.api_key, custom_api.secret etc. Now recursively walks
 * the entire object graph.
 */
function checkForbiddenFields(payload) {
  if (!payload || typeof payload !== "object") return { valid: true };
  // Check own keys first
  for (const field of FORBIDDEN_PLAINTEXT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      return { valid: false, field };
    }
  }
  // Recurse into all nested objects (skip arrays, buffers, etc.)
  for (const key of Object.keys(payload)) {
    const val = payload[key];
    if (val && typeof val === "object" && !Array.isArray(val) && !Buffer.isBuffer(val)) {
      const nested = checkForbiddenFields(val);
      if (!nested.valid) return nested;
    }
  }
  return { valid: true };
}

/**
 * Validate api_key_ref format: must match token-plan/<provider_id>/<purpose>/<uuid>
 */
function isValidApiKeyRef(value) {
  if (typeof value !== "string" || !value.trim()) return true; // empty is allowed
  return /^token-plan\/[a-z0-9_]+\/[a-z0-9_-]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

/**
 * Normalize detection-related fields for a token plan record.
 * Merges new detection fields (detection_method, detection_config, sync_status)
 * with old refresh_* fields for backward compatibility.
 */
function normalizeDetectionFields(record, fallback = {}) {
  const input = record && typeof record === "object" ? record : {};
  const fb = fallback && typeof fallback === "object" ? fallback : {};

  // Determine detection_method: prefer new field, then map from old refresh_method
  const explicitDetectionMethod = input.detection_method ?? fb.detection_method;
  const oldRefreshMethod = String(
    input.refresh_method ?? fb.refresh_method ?? "",
  ).trim().toLowerCase();
  const detectionMethod = explicitDetectionMethod !== undefined
    ? pickDetectionMethod(explicitDetectionMethod)
    : mapRefreshMethodToDetectionMethod(oldRefreshMethod);

  // Normalize detection_config
  const detectionConfig = normalizeDetectionConfig(
    input.detection_config,
    fb.detection_config,
  );

  // Determine sync_status: prefer new field.
  // For legacy records with refresh_method=manual, always map to not_configured
  // regardless of old last_refresh_status (per W03-R3A contract).
  const explicitSyncStatus = input.sync_status ?? fb.sync_status;
  let syncStatus;
  if (explicitSyncStatus !== undefined) {
    syncStatus = pickSyncStatus(explicitSyncStatus);
  } else if (oldRefreshMethod === "manual") {
    syncStatus = "not_configured";
  } else {
    syncStatus = mapRefreshStatusToSyncStatus(
      input.last_refresh_status ?? fb.last_refresh_status,
    );
  }

  // Sync timestamps — map old refresh_* fields when new fields are absent
  const oldRefreshAt = String(
    input.last_refresh_at ?? fb.last_refresh_at ?? "",
  ).trim();
  const lastSyncAttemptAt = String(
    input.last_sync_attempt_at ?? fb.last_sync_attempt_at ??
    oldRefreshAt ?? "",
  ).trim();
  // If the record had a successful refresh, the old last_refresh_at is the last_synced_at
  const lastSyncedAt = String(
    input.last_synced_at ?? fb.last_synced_at ??
    (syncStatus === "success" ? oldRefreshAt : "") ?? "",
  ).trim();
  const lastErrorCode = String(
    input.last_error_code ?? fb.last_error_code ?? "",
  ).trim();
  const lastErrorMessage = String(
    input.last_error_message ?? fb.last_error_message ??
    input.last_refresh_error ?? fb.last_refresh_error ?? "",
  ).trim();
  const providerReportedAt = String(
    input.provider_reported_at ?? fb.provider_reported_at ?? "",
  ).trim();

  return {
    detection_method: detectionMethod,
    detection_config: detectionConfig,
    sync_status: syncStatus,
    last_sync_attempt_at: lastSyncAttemptAt,
    last_synced_at: lastSyncedAt,
    last_error_code: lastErrorCode,
    last_error_message: lastErrorMessage,
    provider_reported_at: providerReportedAt,
  };
}

/**
 * 把任意输入归一化成合法的 token plan 刷新配置/状态字段。
 * 与 MVP 字段合并使用；不覆盖 source/plan_label/total_quota 等。
 */
function normalizeRefreshFields(record, fallback = {}) {
  const input = record && typeof record === "object" ? record : {};
  const fallbackInput = fallback && typeof fallback === "object" ? fallback : {};
  const refreshEnabledRaw = input.refresh_enabled ?? fallbackInput.refresh_enabled;
  const refreshEnabled = refreshEnabledRaw === true || refreshEnabledRaw === "true";
  const interval = pickIntervalMinutes(
    input.refresh_interval_minutes ?? fallbackInput.refresh_interval_minutes,
    fallbackInput.refresh_interval_minutes,
  );
  const method = pickMethod(
    input.refresh_method ?? fallbackInput.refresh_method,
    fallbackInput.refresh_method || "manual",
  );
  const credentialRef = pickCredentialRef(
    input.credential_ref ?? fallbackInput.credential_ref,
  );
  const lastStatus = String(
    input.last_refresh_status ?? fallbackInput.last_refresh_status ?? "",
  ).trim().toLowerCase();
  const lastError = String(input.last_refresh_error ?? fallbackInput.last_refresh_error ?? "");
  const lastRefreshAt = String(input.last_refresh_at ?? fallbackInput.last_refresh_at ?? "").trim();
  const nextRefreshAt = String(input.next_refresh_at ?? fallbackInput.next_refresh_at ?? "").trim();
  return {
    refresh_enabled: refreshEnabled,
    refresh_interval_minutes: interval,
    refresh_method: method,
    credential_ref: credentialRef,
    last_refresh_status: lastStatus,
    last_refresh_error: lastError,
    last_refresh_at: lastRefreshAt,
    next_refresh_at: nextRefreshAt,
  };
}

/**
 * 为 plan 计算下一次 next_refresh_at。
 * manual 方法下不安排下次。
 */
function computeNextRefreshAt(plan, fromIso = nowIso()) {
  if (!plan) return "";
  if (plan.refresh_method === "manual" || plan.refresh_enabled !== true) return "";
  const interval = pickIntervalMinutes(plan.refresh_interval_minutes, 60);
  return addMinutesIso(fromIso, interval);
}

function ensureStatusFields(plan) {
  const base = normalizeRefreshFields(plan);
  // 初次落库时，next_refresh_at 可能为空——若启用且非 manual，补一个。
  if (plan && plan.refresh_enabled === true && plan.refresh_method !== "manual" && !base.next_refresh_at) {
    base.next_refresh_at = computeNextRefreshAt(plan, base.last_refresh_at || nowIso());
  }
  return base;
}

/**
 * 注册 provider quota adapter。第一批无内置 adapter。
 * adapter 签名: async (plan, { credentialRef }) => { total_quota, used_quota, remaining_quota }
 */
function registerProviderAdapter(source, adapter) {
  if (typeof source !== "string" || !source.trim()) return;
  if (typeof adapter !== "function") return;
  PROVIDER_ADAPTERS.set(source.trim().toLowerCase(), adapter);
}

function getProviderAdapter(source) {
  if (typeof source !== "string") return null;
  return PROVIDER_ADAPTERS.get(source.trim().toLowerCase()) || null;
}

function getProviderAdapterForPlan(plan) {
  const providerId = String(plan?.provider_id || "").trim().toLowerCase();
  if (providerId && PROVIDER_ADAPTERS.has(providerId)) {
    return PROVIDER_ADAPTERS.get(providerId);
  }
  return getProviderAdapter(plan?.source);
}

function normalizeQuotaWindows(input, fallback = []) {
  const allowedKinds = new Set(["rolling_5_hour", "rolling_weekly"]);
  const source = Array.isArray(input) ? input : (Array.isArray(fallback) ? fallback : []);
  const toSafeInteger = (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  };
  return source
    .filter((item) => item && allowedKinds.has(item.kind))
    .map((item) => ({
      kind: item.kind,
      unit: "tokens",
      total: toSafeInteger(item.total),
      used: toSafeInteger(item.used),
      remaining: toSafeInteger(item.remaining),
      percentage: Math.max(0, Math.min(100, Number(item.percentage) || 0)),
      resets_at: String(item.resets_at || ""),
    }));
}

const { getPlanById } = require("./token-plan-catalog");

function shouldPreserveCatalogTotal(plan) {
  const catalogPlan = getPlanById(plan?.provider_id, plan?.plan_id);
  if (!catalogPlan) return false;
  return Number(catalogPlan.total_quota) > 0;
}

function mergeAdapterResultIntoRecord(plan, quota, now) {
  const weekly = Array.isArray(quota?.quota_windows)
    ? quota.quota_windows.find((window) => window.kind === "rolling_weekly")
    : null;
  const fiveHour = Array.isArray(quota?.quota_windows)
    ? quota.quota_windows.find((window) => window.kind === "rolling_5_hour")
    : null;
  const liveWindow = weekly || fiveHour;
  const quotaWindows = normalizeQuotaWindows(quota?.quota_windows, plan.quota_windows);
  const preserveCatalogTotal = shouldPreserveCatalogTotal(plan);
  const catalogPlan = getPlanById(plan.provider_id, plan.plan_id);
  const total = preserveCatalogTotal
    ? Number(catalogPlan?.total_quota ?? plan.total_quota ?? 0)
    : (liveWindow
      ? liveWindow.total
      : (Number.isFinite(Number(quota?.total_quota)) ? Number(quota.total_quota) : plan.total_quota));
  const used = liveWindow
    ? liveWindow.used
    : (Number.isFinite(Number(quota?.used_quota)) ? Number(quota.used_quota) : plan.used_quota);
  const remaining = liveWindow
    ? liveWindow.remaining
    : (Number.isFinite(Number(quota?.remaining_quota)) ? Number(quota.remaining_quota) : plan.remaining_quota);
  const merged = {
    total_quota: total,
    used_quota: used,
    remaining_quota: remaining,
    quota_source: quotaWindows.length > 0 ? "provider_reported" : plan.quota_source,
    last_refresh_status: "success",
    last_refresh_error: "",
    last_refresh_at: now,
    next_refresh_at: computeNextRefreshAt(plan, now),
    sync_status: "success",
    last_synced_at: now,
    last_sync_attempt_at: now,
    last_error_code: "",
    last_error_message: "",
    provider_reported_at: quota?.provider_reported_at || now,
  };
  if (quotaWindows.length > 0) {
    merged.quota_windows = quotaWindows;
  }
  if (catalogPlan?.total_quota_display) {
    merged.total_quota_display = catalogPlan.total_quota_display;
  }
  const suggestedPlanId = String(quota?.suggested_plan_id || "").trim();
  if (suggestedPlanId) {
    merged.plan_id = suggestedPlanId;
  }
  return merged;
}

function mapAdapterErrorToSyncStatus(error) {
  try {
    const glmTokenPlan = require("./glm-token-plan");
    if (error instanceof glmTokenPlan.GlmTokenPlanError) {
      return {
        syncStatus: glmTokenPlan.mapGlmErrorCode(error),
        errorCode: error.code,
        errorMessage: error.message,
      };
    }
  } catch {
    // glm module unavailable — fall through
  }
  try {
    const kimiTokenPlan = require("./kimi-token-plan");
    if (error instanceof kimiTokenPlan.KimiTokenPlanError) {
      return {
        syncStatus: kimiTokenPlan.mapKimiErrorCode(error),
        errorCode: error.code,
        errorMessage: error.message,
      };
    }
  } catch {
    // kimi module unavailable — fall through
  }
  try {
    const miniMaxTokenPlan = require("./minimax-token-plan");
    if (error instanceof miniMaxTokenPlan.MiniMaxTokenPlanError) {
      return {
        syncStatus: miniMaxTokenPlan.mapMiniMaxErrorCode(error),
        errorCode: error.code,
        errorMessage: error.message,
      };
    }
  } catch {
    // minimax module unavailable — fall through
  }
  try {
    const aliyunBailianTokenPlan = require("./aliyun-bailian-token-plan");
    if (error instanceof aliyunBailianTokenPlan.AliyunBailianTokenPlanError) {
      return {
        syncStatus: aliyunBailianTokenPlan.mapAliyunBailianErrorCode(error),
        errorCode: error.code,
        errorMessage: error.message,
      };
    }
  } catch {
    // aliyun bailian module unavailable — fall through
  }
  try {
    const codexTokenPlan = require("./codex-token-plan");
    if (error instanceof codexTokenPlan.CodexTokenPlanError) {
      return {
        syncStatus: codexTokenPlan.mapCodexErrorCode(error),
        errorCode: error.code,
        errorMessage: error.message,
      };
    }
  } catch {
    // codex module unavailable — fall through
  }
  try {
    const claudeTokenPlan = require("./claude-token-plan");
    if (error instanceof claudeTokenPlan.ClaudeTokenPlanError) {
      return {
        syncStatus: claudeTokenPlan.mapClaudeErrorCode(error),
        errorCode: error.code,
        errorMessage: error.message,
      };
    }
  } catch {
    // claude module unavailable — fall through
  }
  try {
    const cursorTokenPlan = require("./cursor-token-plan");
    if (error instanceof cursorTokenPlan.CursorTokenPlanError) {
      return {
        syncStatus: cursorTokenPlan.mapCursorErrorCode(error),
        errorCode: error.code,
        errorMessage: error.message,
      };
    }
  } catch {
    // cursor module unavailable — fall through
  }
  const msg = error && error.message ? error.message : String(error);
  return {
    syncStatus: "failed",
    errorCode: "REFRESH_ERROR",
    errorMessage: msg,
  };
}

/**
 * 执行单个 plan 的刷新。
 * 返回 { status, error, record }，其中 record 是合并了刷新结果的新 plan 记录
 * （不含 id/source/plan_label 等 MVP 字段，仅含刷新相关字段及可能的 quota 更新）。
 *
 * W03-R3A: On failure, updates sync_status / last_error_* but never clears
 * quota fields (total_quota, used_quota, remaining_quota, expires_at).
 *
 * 调用方负责把返回的 record 写回 config 并更新 next_refresh_at。
 */
async function refreshPlan(plan, options = {}) {
  const opts = options || {};
  const now = opts.now || nowIso();
  if (!plan || !plan.id) {
    return {
      status: "failed",
      error: "Invalid plan: missing id",
      record: null,
    };
  }
  const method = pickMethod(plan.refresh_method, "manual");

  // W03-R3C/R3D: Determine detection_method first — even when refresh_method is
  // "manual", the detection_method field may indicate a configured detection path
  // (official_account or custom_api). In that case we should execute detection
  // instead of returning a no-op success.
  const detectionMethod = pickDetectionMethod(
    plan.detection_method,
    mapRefreshMethodToDetectionMethod(method),
  );

  if (method === "manual" && detectionMethod === "not_configured") {
    // 手动方法 + 未配置检测 = 不自动刷新，保留手动录入；视为 no-op 成功。
    return {
      status: "success",
      error: "",
      record: {
        ...plan,
        last_refresh_status: "success",
        last_refresh_error: "",
        last_refresh_at: now,
        next_refresh_at: computeNextRefreshAt(plan, now),
        sync_status: "success",
        last_sync_attempt_at: now,
        last_error_code: "",
        last_error_message: "",
      },
    };
  }

  // W03-R3C: Custom API detection path — checked before cookie_scrape/official_api
  // because detection_method is the canonical field for W03-R3A+ plans.
  if (detectionMethod === "custom_api") {
    const customConfig = plan.detection_config?.custom_api;
    if (!customConfig || !customConfig.request_url) {
      const errorMsg = "自定义 API 检测未配置：缺少请求地址或 API 配置。请在套餐设置中填写自定义 API 信息。";
      return {
        status: "failed",
        error: errorMsg,
        record: {
          ...plan,
          last_refresh_status: "failed",
          last_refresh_error: errorMsg,
          last_refresh_at: now,
          next_refresh_at: computeNextRefreshAt(plan, now),
          sync_status: "failed",
          last_sync_attempt_at: now,
          last_error_code: "CUSTOM_API_NOT_CONFIGURED",
          last_error_message: errorMsg,
        },
      };
    }

    // Resolve API key from credential store (if available)
    const resolvedApiKey = opts.resolveApiKey
      ? await opts.resolveApiKey(customConfig.api_key_ref)
      : "";

    try {
      const customApi = getCustomApiModule();
      const detectionResult = await customApi.detectCustomApi(customConfig, {
        apiKey: resolvedApiKey,
      });

      if (detectionResult.sync_status === "success") {
        // Success: merge quota values from detection result
        const total = Number.isFinite(Number(detectionResult.total_quota))
          ? Number(detectionResult.total_quota)
          : plan.total_quota;
        const used = Number.isFinite(Number(detectionResult.used_quota))
          ? Number(detectionResult.used_quota)
          : plan.used_quota;
        const remaining = Number.isFinite(Number(detectionResult.remaining_quota))
          ? Number(detectionResult.remaining_quota)
          : plan.remaining_quota;
        const expiresAt = detectionResult.expires_at || plan.expires_at;

        return {
          status: "success",
          error: "",
          record: {
            ...plan,
            total_quota: total,
            used_quota: used,
            remaining_quota: remaining,
            expires_at: expiresAt,
            quota_source: "custom_api",
            last_refresh_status: "success",
            last_refresh_error: "",
            last_refresh_at: now,
            next_refresh_at: computeNextRefreshAt(plan, now),
            sync_status: "success",
            last_synced_at: now,
            last_sync_attempt_at: now,
            last_error_code: "",
            last_error_message: "",
            provider_reported_at: detectionResult.provider_reported_at || now,
          },
        };
      }

      // Failure: preserve existing quota, only update error fields
      return {
        status: "failed",
        error: detectionResult.last_error_message,
        record: {
          ...plan,
          last_refresh_status: "failed",
          last_refresh_error: detectionResult.last_error_message,
          last_refresh_at: now,
          next_refresh_at: computeNextRefreshAt(plan, now),
          sync_status: detectionResult.sync_status,
          last_sync_attempt_at: now,
          last_error_code: detectionResult.last_error_code,
          last_error_message: detectionResult.last_error_message,
        },
      };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      return {
        status: "failed",
        error: msg,
        record: {
          ...plan,
          last_refresh_status: "failed",
          last_refresh_error: msg,
          last_refresh_at: now,
          next_refresh_at: computeNextRefreshAt(plan, now),
          sync_status: "failed",
          last_sync_attempt_at: now,
          last_error_code: "CUSTOM_API_ERROR",
          last_error_message: msg,
        },
      };
    }
  }

  // W03-R3D: official_account detection — when no reproducible quota data
  // source exists, return unsupported (not failed, not success). The old
  // official_api path with provider adapters handles adapter-based detection.
  if (detectionMethod === "official_account") {
    const adapter = getProviderAdapterForPlan(plan);
    if (typeof adapter === "function") {
      try {
        const quota = await adapter(plan, {
          credentialRef: plan.credential_ref || "",
          resolveApiKey: opts.resolveApiKey,
        });
        if (!quota || typeof quota !== "object") {
          throw new Error("provider adapter 返回非法数据");
        }
        return {
          status: "success",
          error: "",
          record: {
            ...plan,
            ...mergeAdapterResultIntoRecord(plan, quota, now),
          },
        };
      } catch (e) {
        const mapped = mapAdapterErrorToSyncStatus(e);
        if (mapped.errorCode === "GLM_API_KEY_MISSING") {
          const catalogPlan = getPlanById(plan.provider_id, plan.plan_id);
          const hint = catalogPlan
            ? "填写 Coding Plan API Key 可同步实时用量；套餐参考额度已填入总额度。"
            : "请填写 Coding Plan API Key 以同步实时用量。";
          const record = {
            ...plan,
            last_refresh_status: "failed",
            last_refresh_error: hint,
            last_refresh_at: now,
            next_refresh_at: computeNextRefreshAt(plan, now),
            sync_status: "not_configured",
            last_sync_attempt_at: now,
            last_error_code: mapped.errorCode,
            last_error_message: hint,
          };
          if (catalogPlan) {
            record.total_quota = Number(catalogPlan.total_quota || 0);
            record.total_quota_display = catalogPlan.total_quota_display || "";
            if (!Array.isArray(plan.quota_windows) || plan.quota_windows.length === 0) {
              record.used_quota = 0;
              record.remaining_quota = 0;
            }
          }
          return {
            status: "failed",
            error: hint,
            record,
          };
        }
        const hasStoredQuota = Number(plan.remaining_quota) > 0
          || Number(plan.used_quota) > 0
          || (Array.isArray(plan.quota_windows) && plan.quota_windows.length > 0);
        if (mapped.errorCode === "GLM_API_KEY_MISSING" && hasStoredQuota) {
          const hint = "Token 额度需填写 Coding Plan API Key；已保留上次同步的余额/额度。";
          return {
            status: "success",
            error: "",
            record: {
              ...plan,
              last_refresh_status: "success",
              last_refresh_error: "",
              last_refresh_at: now,
              next_refresh_at: computeNextRefreshAt(plan, now),
              sync_status: "not_configured",
              last_sync_attempt_at: now,
              last_error_code: mapped.errorCode,
              last_error_message: hint,
            },
          };
        }
        return {
          status: "failed",
          error: mapped.errorMessage,
          record: {
            ...plan,
            last_refresh_status: "failed",
            last_refresh_error: mapped.errorMessage,
            last_refresh_at: now,
            next_refresh_at: computeNextRefreshAt(plan, now),
            sync_status: mapped.syncStatus,
            last_sync_attempt_at: now,
            last_error_code: mapped.errorCode,
            last_error_message: mapped.errorMessage,
          },
        };
      }
    }

    // No provider adapter: the official_account detection has no reproducible
    // quota data source. Return unsupported — never fake success.
    const errorMsg = "当前没有可复现官方额度查询能力。桌面端暂无法验证控制台登录后读取实际额度，请改用自定义 API 检测。";
    return {
      status: "failed",
      error: errorMsg,
      record: {
        ...plan,
        last_refresh_status: "failed",
        last_refresh_error: errorMsg,
        last_refresh_at: now,
        next_refresh_at: computeNextRefreshAt(plan, now),
        sync_status: "unsupported",
        last_sync_attempt_at: now,
        last_error_code: "PROVIDER_UNSUPPORTED",
        last_error_message: errorMsg,
      },
    };
  }

  if (method === "cookie_scrape") {
    // 第一批不实现真实 cookie 抓取，只写未配置/风险状态。
    const errorMsg = "Cookie 抓取未配置：当前版本不执行真实 Cookie 读取，存在账号风控风险。请改为手动录入或 official_api。";
    return {
      status: "failed",
      error: errorMsg,
      record: {
        ...plan,
        last_refresh_status: "failed",
        last_refresh_error: errorMsg,
        last_refresh_at: now,
        next_refresh_at: computeNextRefreshAt(plan, now),
        sync_status: "failed",
        last_sync_attempt_at: now,
        last_error_code: "COOKIE_SCRAPE_NOT_SUPPORTED",
        last_error_message: errorMsg,
      },
    };
  }

  // official_api (old path, when no detection_method is set)
  const adapter = getProviderAdapterForPlan(plan);
  if (typeof adapter !== "function") {
    const errorMsg = "不支持自动刷新：缺少官方接口。当前没有可用的 provider quota API，请改为手动录入。";
    return {
      status: "failed",
      error: errorMsg,
      record: {
        ...plan,
        last_refresh_status: "failed",
        last_refresh_error: errorMsg,
        last_refresh_at: now,
        next_refresh_at: computeNextRefreshAt(plan, now),
        sync_status: "failed",
        last_sync_attempt_at: now,
        last_error_code: "NO_PROVIDER_ADAPTER",
        last_error_message: errorMsg,
      },
    };
  }

  try {
    const quota = await adapter(plan, {
      credentialRef: plan.credential_ref || "",
      resolveApiKey: opts.resolveApiKey,
    });
    if (!quota || typeof quota !== "object") {
      throw new Error("provider adapter 返回非法数据");
    }
    return {
      status: "success",
      error: "",
      record: {
        ...plan,
        ...mergeAdapterResultIntoRecord(plan, quota, now),
      },
    };
  } catch (e) {
    const mapped = mapAdapterErrorToSyncStatus(e);
    return {
      status: "failed",
      error: mapped.errorMessage,
      record: {
        ...plan,
        last_refresh_status: "failed",
        last_refresh_error: mapped.errorMessage,
        last_refresh_at: now,
        next_refresh_at: computeNextRefreshAt(plan, now),
        sync_status: mapped.syncStatus,
        last_sync_attempt_at: now,
        last_error_code: mapped.errorCode,
        last_error_message: mapped.errorMessage,
      },
    };
  }
}

/**
 * 创建一个本地进程内的调度器实例。
 * 依赖注入 readAll/upsertAll 回调，避免与具体存储耦合。
 *
 * readAll: () => Plan[]
 * upsertAll: (plans: Plan[]) => void  （整体写回，调用方负责读取/合并）
 *
 * 返回控制器：
 *   start(): 启动后台定时器（仅进程存活时有效）
 *   stop(): 停止
 *   runDueOnce(): 立即扫描并刷新所有 due plan（供 server 启动调用与测试）
 *   refreshById(id): 手动触发某个 plan 的刷新
 */
function createScheduler({ readAll, upsertAll, intervalMs = 60_000, logger = console, resolveApiKey } = {}) {
  if (typeof readAll !== "function" || typeof upsertAll !== "function") {
    throw new Error("createScheduler: readAll and upsertAll are required");
  }
  let timer = null;
  const inFlight = new Set();

  async function runDueOnce() {
    let plans;
    try {
      plans = readAll() || [];
    } catch (e) {
      logger.error?.(`[token-plan-refresh] readAll failed: ${e?.message || e}`);
      return { refreshed: 0 };
    }
    const now = new Date();
    const due = plans.filter((p) => isDue(p, now));
    let refreshed = 0;
    for (const plan of due) {
      if (inFlight.has(plan.id)) continue;
      inFlight.add(plan.id);
      try {
        const result = await refreshPlan(plan, { now: now.toISOString(), resolveApiKey });
        if (result.record) {
          const idx = plans.findIndex((p) => p.id === plan.id);
          if (idx >= 0) {
            plans[idx] = result.record;
            refreshed++;
          }
        }
      } catch (e) {
        logger.error?.(`[token-plan-refresh] refresh failed for ${plan.id}: ${e?.message || e}`);
      } finally {
        inFlight.delete(plan.id);
      }
    }
    if (refreshed > 0) {
      try {
        upsertAll(plans);
      } catch (e) {
        logger.error?.(`[token-plan-refresh] upsertAll failed: ${e?.message || e}`);
      }
    }
    return { refreshed };
  }

  async function refreshById(id) {
    let plans;
    try {
      plans = readAll() || [];
    } catch (e) {
      return { ok: false, error: `readAll failed: ${e?.message || e}` };
    }
    const idx = plans.findIndex((p) => String(p?.id || "") === String(id || ""));
    if (idx < 0) {
      return { ok: false, error: "plan not found", statusCode: 404 };
    }
    if (inFlight.has(id)) {
      return { ok: false, error: "refresh already in-flight", statusCode: 409 };
    }
    inFlight.add(id);
    try {
      const result = await refreshPlan(plans[idx], { now: nowIso(), resolveApiKey });
      if (result.record) {
        plans[idx] = result.record;
        try {
          upsertAll(plans);
        } catch (e) {
          return { ok: false, error: `upsertAll failed: ${e?.message || e}` };
        }
        return { ok: true, plan: result.record };
      }
      return { ok: false, error: result.error || "refresh failed" };
    } finally {
      inFlight.delete(id);
    }
  }

  function start() {
    if (timer) return;
    const period = Number.isFinite(intervalMs) && intervalMs > 1000 ? intervalMs : 60_000;
    timer = setInterval(() => {
      runDueOnce().catch((e) => {
        logger.error?.(`[token-plan-refresh] tick error: ${e?.message || e}`);
      });
    }, period);
    // Node 定时器不阻塞退出
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, runDueOnce, refreshById };
}

const glmTokenPlan = require("./glm-token-plan");
const kimiTokenPlan = require("./kimi-token-plan");
const miniMaxTokenPlan = require("./minimax-token-plan");
const aliyunBailianTokenPlan = require("./aliyun-bailian-token-plan");
const codexTokenPlan = require("./codex-token-plan");
const claudeTokenPlan = require("./claude-token-plan");
const cursorTokenPlan = require("./cursor-token-plan");
registerProviderAdapter("glm", glmTokenPlan.createGlmProviderAdapter());
registerProviderAdapter("kimi", kimiTokenPlan.createKimiProviderAdapter());
registerProviderAdapter("minimax", miniMaxTokenPlan.createMiniMaxProviderAdapter());
registerProviderAdapter("aliyun_bailian", aliyunBailianTokenPlan.createAliyunBailianProviderAdapter());
registerProviderAdapter("codex", codexTokenPlan.createCodexProviderAdapter());
registerProviderAdapter("claude", claudeTokenPlan.createClaudeProviderAdapter());
registerProviderAdapter("cursor", cursorTokenPlan.createCursorProviderAdapter());

module.exports = {
  ALLOWED_INTERVALS,
  ALLOWED_METHODS,
  ALLOWED_CREDENTIAL_REFS,
  DETECTION_METHODS,
  SYNC_STATUSES,
  FORBIDDEN_PLAINTEXT_FIELDS,
  normalizeRefreshFields,
  ensureStatusFields,
  computeNextRefreshAt,
  isDue,
  pickIntervalMinutes,
  pickMethod,
  pickCredentialRef,
  pickDetectionMethod,
  pickSyncStatus,
  mapRefreshMethodToDetectionMethod,
  mapRefreshStatusToSyncStatus,
  normalizeDetectionFields,
  normalizeDetectionConfig,
  checkForbiddenFields,
  isValidApiKeyRef,
  refreshPlan,
  registerProviderAdapter,
  getProviderAdapter,
  getProviderAdapterForPlan,
  normalizeQuotaWindows,
  mergeAdapterResultIntoRecord,
  createScheduler,
  nowIso,
  addMinutesIso,
};
