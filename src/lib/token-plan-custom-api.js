"use strict";

/**
 * Custom API detection for Token Plan records (W03-R3C).
 *
 * Responsibilities:
 * - Fetch a user-configured custom API endpoint with a credential reference.
 * - Parse the JSON response using json_path mappings.
 * - Map HTTP errors (401/403) to `reauth_required`, network errors to `failed`.
 * - Never expose plaintext API keys in error messages, response payloads, or logs.
 *
 * The caller (token-plan-refresh.js) is responsible for merging the returned
 * snapshot into the plan record — this module only produces a detection
 * result, never mutates records directly.
 */

const https = require("node:https");
const http = require("node:http");

// ---------------------------------------------------------------------------
// JSON Path extractor (minimal, spec-compliant for W03-R3C).
// Supports $.key, $.nested.key, $[0], $.array[*], $.nested.array[0].key
// ---------------------------------------------------------------------------

function jsonPathGet(obj, path) {
  if (!path || typeof path !== "string") return undefined;
  const trimmed = path.trim();
  if (!trimmed || trimmed === "$") return obj;
  if (!trimmed.startsWith("$")) return undefined;

  const segments = trimmed
    .slice(1)
    .split(/\.(?![^\[]*\])/g)
    .map((s) => s.trim())
    .filter(Boolean);

  let current = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    // Handle array index: key[0] or [0]
    const bracketMatch = seg.match(/^([^[]*)\[(\d+|\*)\]$/);
    if (bracketMatch) {
      const key = bracketMatch[1];
      const idx = bracketMatch[2];
      if (key) {
        current = current[key];
        if (current === undefined) return undefined;
      }
      if (idx === "*") {
        // Return the first element for wildcard (safe default)
        if (Array.isArray(current) && current.length > 0) {
          current = current[0];
        } else {
          return undefined;
        }
      } else {
        const numIdx = Number(idx);
        if (Array.isArray(current) && numIdx < current.length) {
          current = current[numIdx];
        } else {
          return undefined;
        }
      }
    } else {
      current = current[seg];
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// API format constants
// ---------------------------------------------------------------------------

const API_FORMATS = new Set(["json_path", "openai_compatible", "custom_mapping"]);
const ALLOWED_METHODS = new Set(["GET", "POST"]);

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

const ERROR_CODES = {
  CUSTOM_API_MAPPING_MISSING: "CUSTOM_API_MAPPING_MISSING",
  CUSTOM_API_REQUEST_FAILED: "CUSTOM_API_REQUEST_FAILED",
  CUSTOM_API_INVALID_RESPONSE: "CUSTOM_API_INVALID_RESPONSE",
  CUSTOM_API_AUTH_EXPIRED: "CUSTOM_API_AUTH_EXPIRED",
  CUSTOM_API_NETWORK_ERROR: "CUSTOM_API_NETWORK_ERROR",
  CUSTOM_API_CONFIG_INVALID: "CUSTOM_API_CONFIG_INVALID",
};

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CustomApiConfig
 * @property {string} api_key_ref - Credential reference (token-plan/<provider>/<purpose>/<uuid>)
 * @property {string} api_format - "json_path" | "openai_compatible" | "custom_mapping"
 * @property {string} request_url - Full URL to call
 * @property {string} method - "GET" | "POST"
 * @property {Object} response_mapping - JSON path mappings for quota fields
 */

/**
 * @typedef {Object} CustomApiDetectionResult
 * @property {string} sync_status - "success" | "failed" | "reauth_required"
 * @property {string} last_error_code - Error code (empty on success)
 * @property {string} last_error_message - User-readable error (empty on success)
 * @property {number|null} total_quota
 * @property {number|null} used_quota
 * @property {number|null} remaining_quota
 * @property {string} expires_at
 * @property {string} provider_reported_at
 */

/**
 * Perform a custom API detection against a user-configured endpoint.
 *
 * @param {CustomApiConfig} config
 * @param {Object} options
 * @param {string} [options.apiKey] - The actual API key resolved from the credential store (NEVER logged or saved)
 * @returns {Promise<CustomApiDetectionResult>}
 */
async function detectCustomApi(config, options = {}) {
  const now = new Date().toISOString();

  // Validate config
  if (!config || typeof config !== "object") {
    return {
      sync_status: "failed",
      last_error_code: ERROR_CODES.CUSTOM_API_CONFIG_INVALID,
      last_error_message: "自定义 API 配置无效",
      total_quota: null,
      used_quota: null,
      remaining_quota: null,
      expires_at: "",
      provider_reported_at: now,
    };
  }

  const apiFormat = String(config.api_format || "json_path").trim();
  if (!API_FORMATS.has(apiFormat)) {
    return {
      sync_status: "failed",
      last_error_code: ERROR_CODES.CUSTOM_API_CONFIG_INVALID,
      last_error_message: `不支持的 API 格式：${apiFormat}`,
      total_quota: null,
      used_quota: null,
      remaining_quota: null,
      expires_at: "",
      provider_reported_at: now,
    };
  }

  const requestUrl = String(config.request_url || "").trim();
  if (!requestUrl) {
    return {
      sync_status: "failed",
      last_error_code: ERROR_CODES.CUSTOM_API_CONFIG_INVALID,
      last_error_message: "自定义 API 请求地址未配置",
      total_quota: null,
      used_quota: null,
      remaining_quota: null,
      expires_at: "",
      provider_reported_at: now,
    };
  }

  const mapping = config.response_mapping || {};

  // Resolve API key. The caller MUST pass the resolved key — we never
  // resolve it from disk here to keep this module stateless.
  const apiKey = String(options.apiKey || "").trim();
  if (!apiKey) {
    return {
      sync_status: "failed",
      last_error_code: ERROR_CODES.CUSTOM_API_CONFIG_INVALID,
      last_error_message: "自定义 API 密钥未配置或无法读取",
      total_quota: null,
      used_quota: null,
      remaining_quota: null,
      expires_at: "",
      provider_reported_at: now,
    };
  }

  const method = ALLOWED_METHODS.has(String(config.method || "GET").toUpperCase())
    ? String(config.method).toUpperCase()
    : "GET";

  // Perform HTTP request
  let responseBody;
  try {
    responseBody = await httpRequest(requestUrl, method, apiKey);
  } catch (err) {
    const msg = err?.message || String(err);
    // Do NOT include the API key in error messages
    const sanitizedMsg = sanitizeErrorMessage(msg);
    const statusCode = err?.statusCode || 0;

    if (statusCode === 401 || statusCode === 403) {
      return {
        sync_status: "reauth_required",
        last_error_code: ERROR_CODES.CUSTOM_API_AUTH_EXPIRED,
        last_error_message: `自定义 API 授权失败（HTTP ${statusCode}），请更新 API Key`,
        total_quota: null,
        used_quota: null,
        remaining_quota: null,
        expires_at: "",
        provider_reported_at: now,
      };
    }

    return {
      sync_status: "failed",
      last_error_code: ERROR_CODES.CUSTOM_API_REQUEST_FAILED,
      last_error_message: `自定义 API 请求失败：${sanitizedMsg}`,
      total_quota: null,
      used_quota: null,
      remaining_quota: null,
      expires_at: "",
      provider_reported_at: now,
    };
  }

  // Parse JSON response
  let data;
  try {
    data = typeof responseBody === "string" ? JSON.parse(responseBody) : responseBody;
  } catch {
    return {
      sync_status: "failed",
      last_error_code: ERROR_CODES.CUSTOM_API_INVALID_RESPONSE,
      last_error_message: "自定义 API 响应不是有效 JSON",
      total_quota: null,
      used_quota: null,
      remaining_quota: null,
      expires_at: "",
      provider_reported_at: now,
    };
  }

  // Extract values using response_mapping
  const result = parseResponseWithMapping(data, mapping, apiFormat);

  if (result.error) {
    return {
      sync_status: "failed",
      last_error_code: result.errorCode || ERROR_CODES.CUSTOM_API_MAPPING_MISSING,
      last_error_message: result.error,
      total_quota: null,
      used_quota: null,
      remaining_quota: null,
      expires_at: "",
      provider_reported_at: now,
    };
  }

  return {
    sync_status: "success",
    last_error_code: "",
    last_error_message: "",
    total_quota: result.total_quota,
    used_quota: result.used_quota,
    remaining_quota: result.remaining_quota,
    expires_at: result.expires_at || "",
    provider_reported_at: now,
    quota_source: "custom_api",
  };
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseResponseWithMapping(data, mapping, apiFormat) {
  // For json_path format, extract values via JSON path
  const totalPath = String(mapping.total_quota_path || "").trim();
  const usedPath = String(mapping.used_quota_path || "").trim();
  const remainingPath = String(mapping.remaining_quota_path || "").trim();
  const expiresPath = String(mapping.expires_at_path || "").trim();

  // At minimum, we need remaining_quota_path or total_quota_path
  if (!totalPath && !remainingPath) {
    return {
      error: "自定义 API 响应映射缺失：需要至少配置总额度或剩余额度路径",
      errorCode: ERROR_CODES.CUSTOM_API_MAPPING_MISSING,
    };
  }

  const totalRaw = totalPath ? jsonPathGet(data, totalPath) : undefined;
  const usedRaw = usedPath ? jsonPathGet(data, usedPath) : undefined;
  const remainingRaw = remainingPath ? jsonPathGet(data, remainingPath) : undefined;
  const expiresRaw = expiresPath ? jsonPathGet(data, expiresPath) : undefined;

  // Parse numeric values
  const totalQuota = parseQuotaValue(totalRaw);
  const usedQuota = parseQuotaValue(usedRaw);
  const remainingQuota = parseQuotaValue(remainingRaw);

  // Validation: at least one of total/remaining must be a valid number
  if (totalQuota === null && remainingQuota === null) {
    return {
      error: "自定义 API 响应中未找到有效额度数值",
      errorCode: ERROR_CODES.CUSTOM_API_MAPPING_MISSING,
    };
  }

  const expiresAt = expiresRaw !== undefined && expiresRaw !== null
    ? String(expiresRaw).trim()
    : "";

  return {
    total_quota: totalQuota,
    used_quota: usedQuota,
    remaining_quota: remainingQuota,
    expires_at: expiresAt,
    error: null,
    errorCode: null,
  };
}

function parseQuotaValue(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  // Try string parsing
  const str = String(raw).trim();
  const parsed = Number(str);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  return null;
}

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

function httpRequest(url, method, apiKey) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(Object.assign(new Error("自定义 API 请求地址格式无效"), { statusCode: 0 }));
      return;
    }

    const client = parsedUrl.protocol === "https:" ? https : http;
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
      timeout: 30_000,
    };

    const req = client.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(Object.assign(new Error("自定义 API 请求超时"), { statusCode: 0 }));
    });

    req.on("error", (err) => {
      reject(Object.assign(new Error(`网络错误：${err.message}`), { statusCode: 0 }));
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Sanitize error messages (never leak API keys)
// ---------------------------------------------------------------------------

function sanitizeErrorMessage(msg) {
  if (typeof msg !== "string") return String(msg);
  // Redact common API key patterns
  let sanitized = msg
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/sk-[a-zA-Z0-9]{10,}/g, "sk-***")
    .replace(/tp-[a-zA-Z0-9]{10,}/g, "tp-***")
    .replace(/api[_-]?key[=:]\s*\S+/gi, "api_key=***")
    .replace(/Authorization:\s*\S+/gi, "Authorization: ***");
  return sanitized;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  detectCustomApi,
  jsonPathGet,
  parseResponseWithMapping,
  parseQuotaValue,
  sanitizeErrorMessage,
  ERROR_CODES,
  API_FORMATS,
};
