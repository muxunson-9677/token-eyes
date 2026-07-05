"use strict";

/**
 * Provider API Balance Parser & Refresh Manager (02 - 供应商 API 余额后端)
 *
 * Responsibilities:
 * - Parse provider financial responses using restricted dot paths.
 * - Map HTTP errors and response issues to stable status codes.
 * - Dedup concurrent refreshes for the same config (prevent refresh storms).
 * - Cache only financial values + status — never raw responses or secrets.
 * - Return ProviderAccountBalance per the data contract.
 *
 * This module NEVER calls model inference endpoints. It only parses
 * financial balance/spend data returned by the executor.
 */

const {
  executeFinancialRequest,
  sanitizeErrorMessage,
  ERROR_CODES: EXECUTOR_ERROR_CODES,
} = require("./provider-api-executor");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_SYNCED = "synced";
const STATUS_NOT_CONNECTED = "not-connected";
const STATUS_UNSUPPORTED = "unsupported";
const STATUS_ERROR = "error";

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

// Allowed currencies (ISO 4217 common set)
const ALLOWED_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "CNY", "JPY", "KRW", "AUD", "CAD", "CHF", "HKD", "SGD", "INR",
]);

// ---------------------------------------------------------------------------
// Restricted dot-path getter
// ---------------------------------------------------------------------------

/**
 * Get a value from an object using a restricted dot path.
 * Path format: "data.balance", "items[0].amount"
 * Returns undefined if the path doesn't exist or the object is not traversable.
 */
function getByDotPath(obj, dotPath) {
  if (dotPath == null || String(dotPath).trim() === "") return undefined;
  if (obj == null || typeof obj !== "object") return undefined;

  const trimmed = String(dotPath).trim();
  const segments = trimmed.split(".");

  let current = obj;
  for (const seg of segments) {
    if (!seg) return undefined;
    if (current == null || typeof current !== "object") return undefined;

    // Extract array index: "key[0]" or "[0]"
    const match = seg.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)?((?:\[(?:\d+|\*)\])*)$/);
    if (!match) return undefined;

    const key = match[1];
    const brackets = match[2];

    if (key) {
      if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined;
      current = current[key];
    }

    if (brackets) {
      const indices = brackets.match(/\[(\d+|\*)\]/g);
      if (!indices) return undefined;
      for (const idxStr of indices) {
        if (current == null || typeof current !== "object") return undefined;
        const idx = idxStr.slice(1, -1);
        if (idx === "*") {
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
      }
    }
  }

  return current;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Parse a financial response using the config's dot-path mappings.
 *
 * @param {Object} data - Parsed JSON response
 * @param {Object} config - ProviderApiConfig with path fields
 * @returns {{balance: number|null, monthSpend: number|null, lifetimeSpend: number|null, currency: string|null, error_code?: string}}
 */
function parseBalanceResponse(data, config) {
  if (!data || typeof data !== "object") {
    return {
      balance: null,
      monthSpend: null,
      lifetimeSpend: null,
      currency: null,
      error_code: ERROR_CODES.PROVIDER_RESPONSE_INVALID,
    };
  }

  // Extract balance (required)
  const balanceRaw = config.balancePath ? getByDotPath(data, config.balancePath) : undefined;
  const balance = parseFinancialNumber(balanceRaw);

  // If balance path was specified but value is invalid, that's an error
  if (config.balancePath && balance === null) {
    return {
      balance: null,
      monthSpend: null,
      lifetimeSpend: null,
      currency: null,
      error_code: ERROR_CODES.PROVIDER_RESPONSE_INVALID,
    };
  }

  // Reject negative balance (suspicious — likely an error or debt, not a real balance)
  if (balance !== null && balance < 0) {
    return {
      balance: null,
      monthSpend: null,
      lifetimeSpend: null,
      currency: null,
      error_code: ERROR_CODES.PROVIDER_RESPONSE_INVALID,
    };
  }

  // Extract optional fields
  const monthSpendRaw = config.monthSpendPath ? getByDotPath(data, config.monthSpendPath) : undefined;
  const lifetimeSpendRaw = config.lifetimeSpendPath ? getByDotPath(data, config.lifetimeSpendPath) : undefined;
  const currencyRaw = config.currencyPath ? getByDotPath(data, config.currencyPath) : undefined;

  const monthSpend = parseFinancialNumber(monthSpendRaw);
  const lifetimeSpend = parseFinancialNumber(lifetimeSpendRaw);
  const currency = parseCurrency(currencyRaw);

  // Validate month/lifetime spend are non-negative if present
  if (monthSpend !== null && monthSpend < 0) {
    return {
      balance: null,
      monthSpend: null,
      lifetimeSpend: null,
      currency: null,
      error_code: ERROR_CODES.PROVIDER_RESPONSE_INVALID,
    };
  }
  if (lifetimeSpend !== null && lifetimeSpend < 0) {
    return {
      balance: null,
      monthSpend: null,
      lifetimeSpend: null,
      currency: null,
      error_code: ERROR_CODES.PROVIDER_RESPONSE_INVALID,
    };
  }

  return { balance, monthSpend, lifetimeSpend, currency };
}

/**
 * Parse a value into a finite, non-NaN number. Returns null if invalid.
 */
function parseFinancialNumber(raw) {
  if (raw == null || raw === "") return null;

  let n;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string") {
    // Handle string numbers like "1234.56" or "1,234.56"
    const cleaned = raw.trim().replace(/,/g, "");
    n = Number(cleaned);
  } else {
    return null;
  }

  if (!Number.isFinite(n)) return null;
  // Round to 6 decimal places to avoid floating-point noise
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Parse a currency string. Returns null if not a recognized currency.
 */
function parseCurrency(raw) {
  if (raw == null || raw === "") return null;
  const str = String(raw).trim().toUpperCase();
  if (!str) return null;
  // Accept exact match or 3-letter prefix
  if (ALLOWED_CURRENCIES.has(str)) return str;
  // Also accept unknown 3-letter codes (provider may use non-standard codes)
  if (/^[A-Z]{3}$/.test(str)) return str;
  return null;
}

// ---------------------------------------------------------------------------
// Status determination
// ---------------------------------------------------------------------------

/**
 * Map an HTTP status code or error condition to a status + error code.
 *
 * @param {number|string} statusCode - HTTP status code or "timeout"
 * @param {Object} [options]
 * @param {boolean} [options.returnCode=false] - Return {code} instead of just status
 * @returns {string|{status: string, code: string}}
 */
function determineStatus(statusCode, options = {}) {
  const returnCode = Boolean(options.returnCode);

  if (statusCode === "timeout") {
    return returnCode
      ? { status: STATUS_ERROR, code: ERROR_CODES.REQUEST_TIMEOUT }
      : STATUS_ERROR;
  }

  const code = Number(statusCode);
  if (!Number.isFinite(code)) {
    return returnCode
      ? { status: STATUS_ERROR, code: ERROR_CODES.PROVIDER_UNAVAILABLE }
      : STATUS_ERROR;
  }

  if (code === 401 || code === 403) {
    return returnCode
      ? { status: STATUS_ERROR, code: ERROR_CODES.PROVIDER_UNAUTHORIZED }
      : STATUS_ERROR;
  }
  if (code === 429) {
    return returnCode
      ? { status: STATUS_ERROR, code: ERROR_CODES.PROVIDER_RATE_LIMITED }
      : STATUS_ERROR;
  }
  if (code >= 500) {
    return returnCode
      ? { status: STATUS_ERROR, code: ERROR_CODES.PROVIDER_UNAVAILABLE }
      : STATUS_ERROR;
  }

  return returnCode
    ? { status: STATUS_ERROR, code: ERROR_CODES.PROVIDER_RESPONSE_INVALID }
    : STATUS_ERROR;
}

// ---------------------------------------------------------------------------
// Balance refresh manager (with concurrent dedup)
// ---------------------------------------------------------------------------

/**
 * Create a balance refresh manager that dedups concurrent refreshes.
 *
 * @param {Object} options
 * @param {Object} options.credentialStore - Credential store instance
 * @param {Function} [options.readConfigs] - () => ProviderApiConfig[]
 * @param {Function} [options.writeBalance] - (configId, balance) => void
 * @param {boolean} [options.testMode=false] - Allow HTTP for mock servers
 * @param {number} [options.timeoutMs=15000] - Request timeout
 */
function createBalanceRefreshManager(options = {}) {
  const credentialStore = options.credentialStore;
  const testMode = Boolean(options.testMode);
  const timeoutMs = Number(options.timeoutMs) || 15_000;

  // Concurrent refresh dedup: configId → Promise<ProviderAccountBalance>
  const pendingRefreshes = new Map();

  // Cache: configId → { balance, timestamp }
  const cache = new Map();
  const CACHE_TTL_MS = 30_000; // 30s cache to avoid hammering provider

  /**
   * Refresh a single config's balance.
   * Dedups concurrent calls for the same configId.
   */
  async function refreshBalance(config) {
    if (!config || !config.id) {
      return makeErrorBalance(null, null, ERROR_CODES.INVALID_CONFIG, "配置无效");
    }

    // Check cache
    const cached = cache.get(config.id);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.balance;
    }

    // Dedup concurrent refreshes
    if (pendingRefreshes.has(config.id)) {
      return pendingRefreshes.get(config.id);
    }

    const promise = doRefresh(config).finally(() => {
      pendingRefreshes.delete(config.id);
    });
    pendingRefreshes.set(config.id, promise);

    return promise;
  }

  async function doRefresh(config) {
    const now = new Date().toISOString();

    // Check if credential store is available
    if (!credentialStore || typeof credentialStore.isAvailable !== "function" || !credentialStore.isAvailable()) {
      return makeBalance(config, {
        status: STATUS_ERROR,
        errorCode: ERROR_CODES.CREDENTIAL_STORE_UNAVAILABLE,
        errorMessage: "安全凭据存储不可用",
        lastSyncedAt: null,
      });
    }

    // Check if secret is configured
    const apiKeyRef = String(config.apiKeyRef || "").trim();
    if (!apiKeyRef) {
      return makeBalance(config, {
        status: STATUS_NOT_CONNECTED,
        errorCode: ERROR_CODES.CREDENTIAL_MISSING,
        errorMessage: "未配置 API Key",
        lastSyncedAt: null,
      });
    }

    // Read secret from credential store
    const secret = credentialStore.readSecret(apiKeyRef);
    if (!secret) {
      return makeBalance(config, {
        status: STATUS_NOT_CONNECTED,
        errorCode: ERROR_CODES.CREDENTIAL_MISSING,
        errorMessage: "API Key 不存在或已被删除",
        lastSyncedAt: null,
      });
    }

    // Execute financial request
    let result;
    try {
      result = await executeFinancialRequest(config, secret, {
        timeoutMs,
        testMode,
      });
    } catch (err) {
      // 01-密钥安全修复 (F1 错误脱敏): 把实际密钥作为 verbatim 脱敏目标传入，
      // 防止子进程/网络错误消息中出现的非 sk- 前缀密钥原文泄漏到 balance。
      const sanitized = sanitizeErrorMessage(err?.message || String(err), [secret].filter(Boolean));
      const balance = makeBalance(config, {
        status: STATUS_ERROR,
        errorCode: ERROR_CODES.PROVIDER_UNAVAILABLE,
        errorMessage: sanitized,
        lastSyncedAt: null,
      });
      cache.set(config.id, { balance, timestamp: Date.now() });
      return balance;
    }

    if (!result.ok) {
      const balance = makeBalance(config, {
        status: STATUS_ERROR,
        errorCode: result.error_code || ERROR_CODES.PROVIDER_UNAVAILABLE,
        // 01-密钥安全修复 (F1 错误脱敏): executor 内部已 sanitize，但此处再保险
        // 对密钥原文 verbatim 脱敏，覆盖 executor 未覆盖的非 sk- 前缀密钥。
        errorMessage: sanitizeErrorMessage(result.error || "未知错误", [secret].filter(Boolean)),
        lastSyncedAt: null,
      });
      cache.set(config.id, { balance, timestamp: Date.now() });
      return balance;
    }

    // Parse the response
    const parsed = parseBalanceResponse(result.data, config);
    if (parsed.error_code) {
      const balance = makeBalance(config, {
        status: STATUS_ERROR,
        errorCode: parsed.error_code,
        errorMessage: "供应商响应解析失败",
        lastSyncedAt: null,
      });
      cache.set(config.id, { balance, timestamp: Date.now() });
      return balance;
    }

    // Success
    const balance = makeBalance(config, {
      status: STATUS_SYNCED,
      balance: parsed.balance,
      monthSpend: parsed.monthSpend,
      lifetimeSpend: parsed.lifetimeSpend,
      currency: parsed.currency,
      errorCode: undefined,
      errorMessage: undefined,
      lastSyncedAt: now,
    });

    cache.set(config.id, { balance, timestamp: Date.now() });
    return balance;
  }

  /**
   * Get cached balance for a config (without refreshing).
   */
  function getCachedBalance(configId) {
    const cached = cache.get(configId);
    if (!cached) return null;
    return cached.balance;
  }

  /**
   * Clear cache for a specific config (e.g., after secret deletion).
   */
  function clearCache(configId) {
    if (configId) {
      cache.delete(configId);
    } else {
      cache.clear();
    }
  }

  return {
    refreshBalance,
    getCachedBalance,
    clearCache,
  };
}

// ---------------------------------------------------------------------------
// Balance object factory
// ---------------------------------------------------------------------------

function makeBalance(config, fields) {
  return {
    configId: config?.id || null,
    providerId: config?.providerId || "",
    accountLabel: config?.label || "",
    balance: fields.balance ?? null,
    monthSpend: fields.monthSpend ?? null,
    lifetimeSpend: fields.lifetimeSpend ?? null,
    currency: fields.currency ?? null,
    status: fields.status || STATUS_ERROR,
    lastSyncedAt: fields.lastSyncedAt ?? null,
    errorCode: fields.errorCode,
    errorMessage: fields.errorMessage,
  };
}

function makeErrorBalance(configId, providerId, errorCode, errorMessage) {
  return {
    configId,
    providerId: providerId || "",
    accountLabel: "",
    balance: null,
    monthSpend: null,
    lifetimeSpend: null,
    currency: null,
    status: STATUS_ERROR,
    lastSyncedAt: null,
    errorCode,
    errorMessage,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  STATUS_SYNCED,
  STATUS_NOT_CONNECTED,
  STATUS_UNSUPPORTED,
  STATUS_ERROR,
  ERROR_CODES,
  parseBalanceResponse,
  determineStatus,
  getByDotPath,
  parseFinancialNumber,
  parseCurrency,
  createBalanceRefreshManager,
  makeBalance,
  makeErrorBalance,
};
