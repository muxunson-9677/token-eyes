"use strict";

/**
 * Provider API Config CRUD (02 - 供应商 API 余额后端)
 *
 * Responsibilities:
 * - Validate ProviderApiConfig non-secret fields per the data contract.
 * - Persist configs to config.json under `providerApiConfigs` — NEVER secrets.
 * - apiKeyRef is a reference to the OS credential store, NOT a secret value.
 * - Field-path mapping only allows restricted dot paths (identifiers + array
 *   indices); rejects scripts, expressions, and prototype-chain fields.
 * - Deleting a config returns the apiKeyRef so the caller can delete the
 *   orphaned credential from the secure store.
 *
 * This module NEVER stores API keys, Authorization values, cookies, tokens,
 * or any reversible key material. It only stores non-sensitive configuration
 * metadata (URL, method, auth type, field paths, refresh interval, etc.).
 */

const crypto = require("node:crypto");
const { listProviderIdsByCapability } = require("./provider-capabilities");
const {
  isModelEndpoint,
  isFinancialProviderEndpoint,
  isCloudMetadataAddress,
} = require("./provider-api-executor");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_KEY = "providerApiConfigs";

const ALLOWED_METHODS = new Set(["GET", "POST"]);
const ALLOWED_AUTH_TYPES = new Set(["bearer", "header"]);

const FORBIDDEN_PATH_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

const SECRET_FIELD_NAMES = new Set([
  "api_key", "apikey", "api-key",
  "authorization",
  "secret",
  "token",
  "cookie",
  "password", "passwd",
  "credential", "credentials",
  "private_key", "privatekey",
  "access_token", "accesstoken",
  "refresh_token", "refreshtoken",
  "client_secret", "clientsecret",
]);

const SECRET_QUERY_PARAMS = new Set([
  "api_key", "apikey", "api-key",
  "key", "token", "secret",
  "access_token", "accesstoken",
  "refresh_token", "refreshtoken",
  "password", "passwd",
  "private_key", "privatekey",
]);

const ERROR_CODES = Object.freeze({
  INVALID_CONFIG: "invalid_config",
  CREDENTIAL_STORE_UNAVAILABLE: "credential_store_unavailable",
  CREDENTIAL_MISSING: "credential_missing",
  UNSUPPORTED_ENDPOINT: "unsupported_endpoint",
  REQUEST_TIMEOUT: "request_timeout",
  PROVIDER_UNAUTHORIZED: "provider_unauthorized",
  PROVIDER_RATE_LIMITED: "provider_rate_limited",
  PROVIDER_RESPONSE_INVALID: "provider_response_invalid",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
});

// ---------------------------------------------------------------------------
// Restricted dot-path validation
// ---------------------------------------------------------------------------

/**
 * Validate a restricted dot path.
 *
 * Allowed: identifiers (letters, digits, _, -) and array indices [0], [*].
 * Example: "data.balance", "items[0].amount", "data[0]"
 *
 * Rejected: __proto__, constructor, prototype, scripts, expressions,
 * bracket expressions with non-numeric content, empty segments.
 */
function validateDotPath(p) {
  if (typeof p !== "string") return false;
  const trimmed = p.trim();
  if (!trimmed) return false;

  // Reject characters that could be used for injection
  if (/[\s;(){}'"`$\\]/.test(trimmed)) return false;

  const segments = trimmed.split(".");
  for (const seg of segments) {
    if (!seg) return false; // empty segment (e.g., "data..balance")

    // Each segment: optional identifier + zero or more [N] or [*]
    const match = seg.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)?((?:\[(?:\d+|\*)\])*)$/);
    if (!match) return false;

    const key = match[1];
    if (key && FORBIDDEN_PATH_KEYS.has(key.toLowerCase())) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Secret detection
// ---------------------------------------------------------------------------

/**
 * Detect if a field name or value looks like a secret.
 * Used to reject secrets being stored in config.json.
 *
 * Note: "apiKeyRef" is NOT flagged — it's a reference, not a secret value.
 */
function isSecretLikeValue(key, value) {
  if (typeof key !== "string") return false;
  const lower = key.toLowerCase();

  // Exact match against secret field names
  if (SECRET_FIELD_NAMES.has(lower)) return true;

  // Check value for secret-like patterns
  if (typeof value === "string" && value.length > 0) {
    // Allow internal hyphens/underscores in sk-/tp- keys (e.g. sk-proj-..., tp-antropic-test-...)
    if (/^sk-[a-zA-Z0-9\-_]{10,}/.test(value)) return true;
    if (/^Bearer\s+\S/i.test(value)) return true;
    if (/^tp-[a-zA-Z0-9\-_]{10,}/.test(value)) return true;
  }

  return false;
}

/**
 * Detect if a header NAME looks secret-like using word-split matching.
 * Catches X-Api-Key, X-Auth-Token, X-Redmine-Api-Key, etc. that the exact-match
 * SECRET_FIELD_NAMES set misses. Used to reject secrets being persisted in
 * config.json via nonSecretHeaders (B4-4 defense-in-depth).
 *
 * Note: "apiKeyRef" / "apikeyref" is NOT flagged — it's a reference, not a secret.
 */
const _STRONG_SECRET_WORDS = new Set([
  "secret", "password", "passwd", "credential", "credentials",
]);
const _API_AUTH_WORDS = new Set(["api", "auth", "access", "refresh"]);
const _KEY_TOKEN_WORDS = new Set(["key", "token"]);

function isSecretLikeHeaderName(name) {
  if (typeof name !== "string" || name.length === 0) return false;
  const lower = name.toLowerCase();

  // Exact match against secret field names (Authorization, Cookie, api_key, ...)
  if (SECRET_FIELD_NAMES.has(lower)) return true;

  // Word-split by hyphens, underscores, dots, spaces
  const words = lower.split(/[-_.\s]+/).filter((w) => w.length > 0);
  if (words.length === 0) return false;

  const hasStrong = words.some((w) => _STRONG_SECRET_WORDS.has(w));
  const hasApiAuth = words.some((w) => _API_AUTH_WORDS.has(w));
  const hasKeyToken = words.some((w) => _KEY_TOKEN_WORDS.has(w));
  const hasPrivate = words.includes("private");

  // e.g. X-Secret-Token, client.secret → strong secret word
  if (hasStrong) return true;
  // e.g. X-Api-Key, X-Auth-Token, X-Access-Token, X-Refresh-Token, api_key, auth_token
  if (hasApiAuth && hasKeyToken) return true;
  // e.g. X-Private-Key
  if (hasPrivate && hasKeyToken) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/**
 * Validate a ProviderApiConfig object.
 * @param {Object} config
 * @param {Object} [options]
 * @param {boolean} [options.testMode=false] - Allow HTTP URLs (for testing)
 * @returns {{ok: true} | {ok: false, error_code: string, error: string}}
 */
function validateProviderApiConfig(config, options = {}) {
  const testMode = Boolean(options.testMode);

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "配置无效" };
  }

  // Required string fields
  const providerId = String(config.providerId || "").trim();
  if (!providerId) {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "providerId 不能为空" };
  }

  const label = String(config.label || "").trim();
  if (!label) {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "label 不能为空" };
  }

  const requestUrl = String(config.requestUrl || "").trim();
  if (!requestUrl) {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "requestUrl 不能为空" };
  }

  // URL validation
  let parsedUrl;
  try {
    parsedUrl = new URL(requestUrl);
  } catch {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "requestUrl 格式无效" };
  }

  // Protocol check
  if (testMode) {
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "只允许 HTTP/HTTPS 协议" };
    }
  } else {
    if (parsedUrl.protocol !== "https:") {
      return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "生产模式下只允许 HTTPS" };
    }
  }

  // Reject cloud metadata addresses (SSRF protection)
  if (isCloudMetadataAddress(parsedUrl.hostname)) {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "不允许访问云元数据地址" };
  }

  // Reject model inference endpoints
  if (isModelEndpoint(requestUrl)) {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "不允许配置模型推理端点" };
  }

  // 05-供应商API财务端点白名单修复: 只允许财务 endpoint（allowlist）。
  // 非财务 POST endpoint（realtime/sessions、batches、countTokens、run-agent
  // 等）即使不是模型推理 endpoint，也会因 pathname 不含财务关键词而被拒绝。
  // 用独立的 unsupported_endpoint 错误码，让 UI 区分"配置格式不合法"
  // （invalid_config）和"endpoint 不受支持"（unsupported_endpoint）。
  if (!isFinancialProviderEndpoint(requestUrl)) {
    return {
      ok: false,
      error_code: ERROR_CODES.UNSUPPORTED_ENDPOINT,
      error: "只允许查询财务端点（余额/账单/用量/花销/订阅/发票/配额/支付）",
    };
  }

  // Reject secrets in URL query params
  for (const key of parsedUrl.searchParams.keys()) {
    if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) {
      return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "不允许在 URL 中传递密钥参数" };
    }
  }

  // Method validation
  const method = String(config.requestMethod || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "requestMethod 只允许 GET 或 POST" };
  }

  // Auth type validation
  const authType = String(config.authType || "bearer").trim().toLowerCase();
  if (!ALLOWED_AUTH_TYPES.has(authType)) {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "authType 只允许 bearer 或 header" };
  }

  // Auth header name required for header auth
  if (authType === "header") {
    const authHeaderName = String(config.authHeaderName || "").trim();
    if (!authHeaderName) {
      return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "header 鉴权需要 authHeaderName" };
    }
    // Header name must not contain secret-like values
    if (
      isSecretLikeValue(authHeaderName, authHeaderName)
      && authHeaderName.toLowerCase() !== "authorization"
    ) {
      return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "authHeaderName 不能是密钥字段名" };
    }
  }

  // Required path: balancePath
  const balancePath = String(config.balancePath || "").trim();
  if (!balancePath) {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "balancePath 不能为空" };
  }
  if (!validateDotPath(balancePath)) {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "balancePath 不是有效的受限点路径" };
  }

  // Optional paths
  for (const field of ["monthSpendPath", "lifetimeSpendPath", "currencyPath"]) {
    const val = String(config[field] || "").trim();
    if (val && !validateDotPath(val)) {
      return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: `${field} 不是有效的受限点路径` };
    }
  }

  // Refresh interval (minimum 60 seconds)
  const refreshInterval = Number(config.refreshIntervalSeconds);
  if (!Number.isFinite(refreshInterval) || refreshInterval < 60) {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "refreshIntervalSeconds 不能小于 60 秒" };
  }
  if (refreshInterval > 86400) {
    return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "refreshIntervalSeconds 不能超过 86400 秒" };
  }

  // nonSecretHeaders validation — no secret-like names or values
  if (config.nonSecretHeaders != null) {
    if (typeof config.nonSecretHeaders !== "object" || Array.isArray(config.nonSecretHeaders)) {
      return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "nonSecretHeaders 必须是对象" };
    }
    for (const [headerName, headerValue] of Object.entries(config.nonSecretHeaders)) {
      if (isSecretLikeValue(headerName, headerValue)) {
        return {
          ok: false,
          error_code: ERROR_CODES.INVALID_CONFIG,
          error: `nonSecretHeaders 中的字段 "${headerName}" 看起来是密钥，不允许保存在配置中`,
        };
      }
      // B4-4 defense-in-depth: reject secret-like header NAMES (X-Api-Key, X-Auth-Token, ...)
      // even when the value has no sk- prefix — the name itself indicates a secret field.
      if (isSecretLikeHeaderName(headerName)) {
        return {
          ok: false,
          error_code: ERROR_CODES.INVALID_CONFIG,
          error: `nonSecretHeaders 不允许包含密钥类 Header 名 "${headerName}"`,
        };
      }
    }
  }

  // Scan ALL fields for any sneaked-in secrets (defense in depth)
  for (const [key, value] of Object.entries(config)) {
    // apiKeyRef is a safe reference — not a secret
    if (key === "apiKeyRef") continue;
    // nonSecretHeaders already validated above
    if (key === "nonSecretHeaders") continue;
    if (isSecretLikeValue(key, value)) {
      return {
        ok: false,
        error_code: ERROR_CODES.INVALID_CONFIG,
        error: `配置字段 "${key}" 看起来是密钥，不允许保存在配置中`,
      };
    }
  }

  return { ok: true };
}

function validateProviderApiConfigSecrets(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: true };
  }

  if (config.nonSecretHeaders != null) {
    if (typeof config.nonSecretHeaders !== "object" || Array.isArray(config.nonSecretHeaders)) {
      return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG, error: "nonSecretHeaders must be an object" };
    }
    for (const [headerName, headerValue] of Object.entries(config.nonSecretHeaders)) {
      if (isSecretLikeValue(headerName, headerValue)) {
        return {
          ok: false,
          error_code: ERROR_CODES.INVALID_CONFIG,
          error: `nonSecretHeaders field "${headerName}" looks like a secret and cannot be stored`,
        };
      }
      if (isSecretLikeHeaderName(headerName)) {
        return {
          ok: false,
          error_code: ERROR_CODES.INVALID_CONFIG,
          error: `nonSecretHeaders cannot include secret-like header "${headerName}"`,
        };
      }
    }
  }

  for (const [key, value] of Object.entries(config)) {
    if (key === "apiKeyRef") continue;
    if (key === "nonSecretHeaders") continue;
    if (isSecretLikeValue(key, value)) {
      return {
        ok: false,
        error_code: ERROR_CODES.INVALID_CONFIG,
        error: `Config field "${key}" looks like a secret and cannot be stored`,
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const KNOWN_PROVIDER_PRESETS = [
  {
    providerId: "deepseek",
    label: "DeepSeek",
    aliases: ["deepseek", "deep seek"],
    hosts: ["api.deepseek.com"],
    defaultRequestUrl: "https://api.deepseek.com/user/balance",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "balance_infos[*].total_balance",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "balance_infos[*].currency",
  },
  {
    providerId: "dashscope",
    label: "DashScope",
    aliases: ["dashscope", "百炼", "bailian", "aliyun", "灵积", "aliyuncs"],
    hosts: ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "dashscope-us.aliyuncs.com"],
    defaultRequestUrl: "https://dashscope.aliyuncs.com/api/v1/recharge/recharge-balance/query",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "output.available_balance",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "output.currency",
  },
  {
    providerId: "moonshot",
    label: "Moonshot",
    aliases: ["moonshot", "kimi", "月之暗面", "moon shot"],
    hosts: ["api.moonshot.cn", "api.moonshot.com"],
    defaultRequestUrl: "https://api.moonshot.cn/v1/users/me/balance",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "data.available_balance",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "",
  },
  {
    providerId: "glm",
    label: "智谱 GLM",
    aliases: ["glm", "zhipu", "智谱", "bigmodel", "智谱ai", "zhipuai"],
    hosts: ["open.bigmodel.cn", "www.bigmodel.cn", "bigmodel.cn"],
    defaultRequestUrl: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    requestMethod: "GET",
    authType: "header",
    authHeaderName: "Authorization",
    balancePath: "data.limits[*].usage",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "",
  },
  {
    providerId: "siliconflow",
    label: "SiliconFlow",
    aliases: ["siliconflow", "silicon flow"],
    hosts: ["api.siliconflow.cn", "api.siliconflow.com"],
    defaultRequestUrl: "https://api.siliconflow.cn/v1/user/info",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "data.totalBalance",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "",
  },
  {
    providerId: "openrouter",
    label: "OpenRouter",
    aliases: ["openrouter", "open router"],
    hosts: ["openrouter.ai"],
    defaultRequestUrl: "https://openrouter.ai/api/v1/auth/key",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "data.limit_remaining",
    monthSpendPath: "data.usage",
    lifetimeSpendPath: "",
    currencyPath: "",
  },
];

const providerBalanceIds = listProviderIdsByCapability("provider_balance").sort();
const presetProviderIds = KNOWN_PROVIDER_PRESETS.map((preset) => preset.providerId).sort();
if (JSON.stringify(providerBalanceIds) !== JSON.stringify(presetProviderIds)) {
  throw new Error("Provider balance presets do not match the capability manifest");
}

function lowerTrim(value) {
  return String(value || "").trim().toLowerCase();
}

function hostFromUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function detectKnownProviderPreset(config) {
  const providerText = lowerTrim(config?.providerId);
  const labelText = lowerTrim(config?.label);
  const host = hostFromUrl(config?.requestUrl);
  for (const preset of KNOWN_PROVIDER_PRESETS) {
    if (providerText === preset.providerId) return preset;
    if (preset.aliases.some((alias) => providerText === alias || labelText.includes(alias))) return preset;
    if (preset.hosts.includes(host)) return preset;
  }
  return null;
}

function shouldUsePresetRequestUrl(rawUrl, preset) {
  const value = String(rawUrl || "").trim();
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return preset.hosts.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function slugifyProviderId(label) {
  const slug = String(label || "").trim().toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
  return slug || "custom";
}

function applyKnownProviderPreset(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return config;
  const preset = detectKnownProviderPreset(config);
  const next = { ...config };

  if (preset) {
    const usePresetUrl = shouldUsePresetRequestUrl(next.requestUrl, preset);
    if (!String(next.providerId || "").trim()) next.providerId = preset.providerId;
    if (!String(next.label || "").trim()) next.label = preset.label;
    if (usePresetUrl) {
      next.requestUrl = preset.defaultRequestUrl;
      next.balancePath = preset.balancePath;
      next.monthSpendPath = preset.monthSpendPath;
      next.lifetimeSpendPath = preset.lifetimeSpendPath;
      next.currencyPath = preset.currencyPath;
    } else {
      if (!String(next.balancePath || "").trim()) next.balancePath = preset.balancePath;
      if (!String(next.monthSpendPath || "").trim()) next.monthSpendPath = preset.monthSpendPath;
      if (!String(next.lifetimeSpendPath || "").trim()) next.lifetimeSpendPath = preset.lifetimeSpendPath;
      if (!String(next.currencyPath || "").trim()) next.currencyPath = preset.currencyPath;
    }
    if (!String(next.requestMethod || "").trim()) next.requestMethod = preset.requestMethod;
    if (!String(next.authType || "").trim()) next.authType = preset.authType;
    if (!String(next.authHeaderName || "").trim()) next.authHeaderName = preset.authHeaderName;
    if (!Number(next.refreshIntervalSeconds)) next.refreshIntervalSeconds = 300;
    if (preset.providerId === "deepseek") {
      if (String(next.balancePath || "").trim() === "balance_infos[0].total_balance") {
        next.balancePath = preset.balancePath;
      }
      if (String(next.currencyPath || "").trim() === "balance_infos[0].currency") {
        next.currencyPath = preset.currencyPath;
      }
    }
    if (preset.providerId === "glm") {
      next.authType = "header";
      next.authHeaderName = "Authorization";
      if (
        String(next.balancePath || "").trim() === "data.limits[0].currentValue"
        || String(next.balancePath || "").trim() === "data.limits[*].currentValue"
      ) {
        next.balancePath = preset.balancePath;
      }
    }
  }

  if (!String(next.providerId || "").trim()) next.providerId = slugifyProviderId(next.label);
  if (!String(next.label || "").trim() && next.providerId) next.label = next.providerId;
  return next;
}

/**
 * Normalize a ProviderApiConfig into a clean object with consistent types.
 * Does NOT include any secret values — only non-sensitive metadata + apiKeyRef.
 */
function normalizeProviderApiConfig(config) {
  const prepared = applyKnownProviderPreset(config);
  const normalized = {
    id: String(prepared.id || crypto.randomUUID()),
    providerId: String(prepared.providerId || "").trim(),
    label: String(prepared.label || "").trim(),
    requestUrl: String(prepared.requestUrl || "").trim(),
    requestMethod: String(prepared.requestMethod || "GET").toUpperCase().trim(),
    authType: String(prepared.authType || "bearer").trim().toLowerCase(),
    authHeaderName: prepared.authHeaderName ? String(prepared.authHeaderName).trim() : "",
    apiKeyRef: String(prepared.apiKeyRef || "").trim(),
    nonSecretHeaders: {},
    balancePath: String(prepared.balancePath || "").trim(),
    monthSpendPath: prepared.monthSpendPath ? String(prepared.monthSpendPath).trim() : "",
    lifetimeSpendPath: prepared.lifetimeSpendPath ? String(prepared.lifetimeSpendPath).trim() : "",
    currencyPath: prepared.currencyPath ? String(prepared.currencyPath).trim() : "",
    refreshIntervalSeconds: Number(prepared.refreshIntervalSeconds) || 300,
    enabled: prepared.enabled !== false,
  };

  // Normalize nonSecretHeaders
  if (prepared.nonSecretHeaders && typeof prepared.nonSecretHeaders === "object" && !Array.isArray(prepared.nonSecretHeaders)) {
    for (const [k, v] of Object.entries(prepared.nonSecretHeaders)) {
      const lower = k.toLowerCase();
      // Never include auth/cookie headers in nonSecretHeaders
      if (lower === "authorization" || lower === "cookie") continue;
      normalized.nonSecretHeaders[k] = String(v);
    }
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Sanitization for output
// ---------------------------------------------------------------------------

/**
 * Remove any secret-like fields from a config before returning it to the UI.
 * apiKeyRef is kept — it's a safe reference, not a secret value.
 */
function sanitizeConfigForOutput(config) {
  if (!config || typeof config !== "object") return config;
  const sanitized = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "apiKeyRef") {
      sanitized[key] = value; // safe reference
      continue;
    }
    if (key === "nonSecretHeaders") {
      sanitized[key] = value; // already validated, non-secret
      continue;
    }
    if (isSecretLikeValue(key, value)) {
      continue; // skip secret-like fields
    }
    sanitized[key] = value;
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// CRUD helpers (operate on config arrays, don't touch disk directly)
// ---------------------------------------------------------------------------

/**
 * Find a config by ID in a configs array.
 */
function findConfigById(configs, id) {
  if (!Array.isArray(configs)) return null;
  return configs.find((c) => c && c.id === id) || null;
}

/**
 * Insert or update a config in a configs array.
 * Returns { configs: newArray, config: normalizedConfig }.
 */
function upsertProviderApiConfig(configs, config) {
  const next = Array.isArray(configs) ? configs.slice() : [];
  const normalized = normalizeProviderApiConfig(config);

  const existingIndex = next.findIndex((c) => c && c.id === normalized.id);
  if (existingIndex >= 0) {
    next[existingIndex] = normalized;
  } else {
    next.push(normalized);
  }

  return { configs: next, config: normalized };
}

/**
 * Remove a config by ID.
 * Returns { configs: newArray, removed: config|null, apiKeyRef: string }.
 * The caller MUST use apiKeyRef to delete the orphaned credential.
 */
function deleteProviderApiConfig(configs, id) {
  if (!Array.isArray(configs)) return { configs: [], removed: null, apiKeyRef: "" };
  const idx = configs.findIndex((c) => c && c.id === id);
  if (idx < 0) return { configs: configs.slice(), removed: null, apiKeyRef: "" };

  const removed = configs[idx];
  const next = configs.slice();
  next.splice(idx, 1);
  return { configs: next, removed, apiKeyRef: String(removed.apiKeyRef || "") };
}

// ---------------------------------------------------------------------------
// Persistence helpers (read/write from config.json)
// ---------------------------------------------------------------------------

/**
 * Read provider API configs from a config object (from config.json).
 */
function readProviderApiConfigs(config) {
  if (!config || !Array.isArray(config[CONFIG_KEY])) return [];
  return config[CONFIG_KEY].map((item) => normalizeProviderApiConfig(item));
}

/**
 * Write provider API configs into a config object (for config.json).
 * Mutates and returns the config object.
 */
function writeProviderApiConfigs(config, configs) {
  const c = config && typeof config === "object" ? config : {};
  c[CONFIG_KEY] = Array.isArray(configs) ? configs : [];
  return c;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  CONFIG_KEY,
  PROVIDER_API_PRESET_IDS: Object.freeze(KNOWN_PROVIDER_PRESETS.map((preset) => preset.providerId)),
  ERROR_CODES,
  validateDotPath,
  isSecretLikeValue,
  isSecretLikeHeaderName,
  validateProviderApiConfig,
  validateProviderApiConfigSecrets,
  normalizeProviderApiConfig,
  applyKnownProviderPreset,
  sanitizeConfigForOutput,
  findConfigById,
  upsertProviderApiConfig,
  deleteProviderApiConfig,
  readProviderApiConfigs,
  writeProviderApiConfigs,
};
