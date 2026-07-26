"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { normalizeDataEvidence } = require("./data-evidence");
const { isEvidenceStale } = require("./data-freshness");

// Frozen enums mirror shared/schemas/token-observability-v2.schema.json.
// O2 must NOT rename these — they are the v2 contract surface.
const LIMIT_WINDOW_KINDS = Object.freeze({
  FIVE_HOUR: "five_hour",
  SEVEN_DAY: "seven_day",
  MONTHLY: "monthly",
  CUSTOM: "custom",
});

const LIMIT_ACCOUNT_STATUS = Object.freeze({
  OK: "ok",
  STALE: "stale",
  UNAVAILABLE: "unavailable",
  AUTH_ERROR: "auth_error",
  RATE_LIMITED: "rate_limited",
});

const SCHEMA_VERSION = "token-observability/v2";
const IDENTITY_SALT_PATH = path.join(".tokentracker", "tracker", "identity-salt");
const SALT_BYTES = 32;
const DEFAULT_STALE_AFTER_SECONDS = 5 * 60;
// Cross-provider concurrency cap (single-flight still applies per provider
// inside its adapter). 3 keeps a multi-provider refresh from fanning out to
// 9 simultaneous upstream calls on the Limits page.
const MAX_PROVIDER_CONCURRENCY = 3;

const WINDOW_KINDS_SET = new Set(Object.values(LIMIT_WINDOW_KINDS));
const STATUS_SET = new Set(Object.values(LIMIT_ACCOUNT_STATUS));

// 2-minute in-memory cache; matches usage-limits.js so a Limits page navigation
// doesn't re-trigger the full provider round.
let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL_MS = 2 * 60 * 1000;
let inFlightFetch = null;
// Last successful/stale account snapshots keyed for failure isolation across
// refreshes. Callers can still pass previousAccounts to override.
let lastGoodAccounts = null;
const ACCOUNT_LABELS_PATH = path.join(".tokentracker", "tracker", "limit-account-labels.json");

function base64url(buffer) {
  return buffer.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function loadOrCreateIdentitySalt({ home } = {}) {
  const resolvedHome = home || os.homedir();
  const saltPath = path.join(resolvedHome, IDENTITY_SALT_PATH);
  try {
    const existing = fs.readFileSync(saltPath);
    if (Buffer.isBuffer(existing) && existing.length === SALT_BYTES) {
      return existing;
    }
  } catch (_error) {
    // Missing or unreadable — (re)create below.
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  fs.mkdirSync(path.dirname(saltPath), { recursive: true });
  const tmpPath = `${saltPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, salt, { encoding: null, mode: 0o600 });
  try {
    fs.renameSync(tmpPath, saltPath);
  } catch (_error) {
    // rename may fail across some Windows filesystems; fall back to a direct write.
    fs.writeFileSync(saltPath, salt, { encoding: null, mode: 0o600 });
    try { fs.unlinkSync(tmpPath); } catch (_e) { /* already gone */ }
  }
  // Re-assert 0o600 in case the destination inherited a different mode.
  try { fs.chmodSync(saltPath, 0o600); } catch (_error) { /* Windows no-op */ }
  return salt;
}

function computeAccountKey({ providerId, rawAccountId, salt }) {
  if (typeof providerId !== "string" || !providerId) {
    throw new TypeError("providerId must be a non-empty string.");
  }
  if (typeof rawAccountId !== "string" || !rawAccountId) {
    throw new TypeError("rawAccountId must be a non-empty string.");
  }
  if (!Buffer.isBuffer(salt) || salt.length !== SALT_BYTES) {
    throw new TypeError("salt must be a 32-byte Buffer.");
  }
  const message = `${providerId}:${rawAccountId}`;
  const digest = crypto.createHmac("sha256", salt).update(message, "utf8").digest();
  return base64url(digest);
}

function clampPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return n;
}

function optionalString(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new TypeError(`${fieldName} must be a string or null.`);
  return value;
}

function optionalIso(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Codex (and some fixtures) emit unix seconds or milliseconds.
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  if (typeof value !== "string") throw new TypeError(`${fieldName} must be an ISO-8601 string or null.`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`${fieldName} must be a valid ISO-8601 timestamp.`);
  return new Date(ms).toISOString();
}

function optionalNonNegativeInteger(value, fieldName) {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer or null.`);
  }
  return n;
}

function buildLimitWindowV2({
  kind,
  label,
  usedPercent,
  resetAt,
  windowSeconds,
  evidence,
}) {
  if (!WINDOW_KINDS_SET.has(kind)) {
    throw new TypeError(`kind must be one of ${[...WINDOW_KINDS_SET].join(", ")}.`);
  }
  if (typeof label !== "string" || label.length === 0) {
    throw new TypeError("label must be a non-empty string.");
  }
  const pct = clampPercent(usedPercent);
  const normalizedEvidence = normalizeDataEvidence(evidence || {
    source_kind: "official_api",
    accuracy: "unknown",
    coverage: "unavailable",
    observed_at: new Date().toISOString(),
    source_updated_at: null,
    stale_after_seconds: DEFAULT_STALE_AFTER_SECONDS,
    pricing_source: null,
    pricing_version: null,
    note_code: null,
  });
  return {
    kind,
    label,
    used_percent: pct,
    reset_at: optionalIso(resetAt, "reset_at"),
    window_seconds: optionalNonNegativeInteger(windowSeconds, "window_seconds"),
    evidence: normalizedEvidence,
  };
}

function defaultAccountLabel(providerId) {
  if (typeof providerId !== "string" || !providerId) return "Account";
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

function buildLimitAccountV2({
  providerId,
  rawAccountId,
  salt,
  accountLabel,
  planLabel,
  status,
  windows,
  lastSuccessAt,
  errorCode,
}) {
  if (typeof providerId !== "string" || !providerId) {
    throw new TypeError("providerId must be a non-empty string.");
  }
  if (!STATUS_SET.has(status)) {
    throw new TypeError(`status must be one of ${[...STATUS_SET].join(", ")}.`);
  }
  if (!Array.isArray(windows)) {
    throw new TypeError("windows must be an array of LimitWindowV2.");
  }
  const accountKey = computeAccountKey({ providerId, rawAccountId, salt });
  return {
    provider_id: providerId,
    account_key: accountKey,
    account_label: optionalString(accountLabel, "account_label") || defaultAccountLabel(providerId),
    plan_label: optionalString(planLabel, "plan_label"),
    status,
    windows,
    last_success_at: optionalIso(lastSuccessAt, "last_success_at"),
    error_code: optionalString(errorCode, "error_code"),
  };
}

// Mark every window of a stale snapshot with cache + stale evidence so the UI
// can dim it and the badge reads "Cached". The schema keeps evidence per-window,
// so we do not add an account-level evidence field.
function markSnapshotStale(account, { nowMs = Date.now() } = {}) {
  if (!account || !Array.isArray(account.windows)) return account;
  const staleWindows = account.windows.map((w) => {
    if (!w || !w.evidence) return w;
    const observedAt = w.evidence.observed_at || new Date(nowMs).toISOString();
    const staleEvidence = normalizeDataEvidence({
      ...w.evidence,
      source_kind: "cache",
      source_updated_at: observedAt,
      stale_after_seconds: 0,
      note_code: w.evidence.note_code || "last_successful_value",
    }, { nowMs });
    return { ...w, evidence: staleEvidence };
  });
  return {
    ...account,
    status: LIMIT_ACCOUNT_STATUS.STALE,
    windows: staleWindows,
    error_code: null,
  };
}

function sortByProviderAndKey(accounts) {
  return [...accounts].sort((a, b) => {
    const providerCmp = String(a.provider_id).localeCompare(String(b.provider_id));
    if (providerCmp !== 0) return providerCmp;
    return String(a.account_key).localeCompare(String(b.account_key));
  });
}

function loadAccountLabels({ home } = {}) {
  const resolvedHome = home || os.homedir();
  const labelsPath = path.join(resolvedHome, ACCOUNT_LABELS_PATH);
  try {
    const raw = fs.readFileSync(labelsPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === "string" && key && typeof value === "string" && value.trim()) {
        out[key] = value.trim();
      }
    }
    return out;
  } catch (_error) {
    return {};
  }
}

function applyAccountLabels(accounts, labels) {
  if (!Array.isArray(accounts) || !labels || typeof labels !== "object") return accounts;
  return accounts.map((account) => {
    if (!account || typeof account !== "object") return account;
    const override = labels[account.account_key];
    if (!override) return account;
    return { ...account, account_label: override };
  });
}

function mergeLastGoodAccounts(previous, next) {
  const byKey = new Map();
  for (const account of previous || []) {
    if (account?.account_key) byKey.set(account.account_key, account);
  }
  for (const account of next || []) {
    if (!account?.account_key) continue;
    if (
      account.status === LIMIT_ACCOUNT_STATUS.OK
      || account.status === LIMIT_ACCOUNT_STATUS.STALE
      || (Array.isArray(account.windows) && account.windows.length > 0)
    ) {
      byKey.set(account.account_key, account);
    }
  }
  return sortByProviderAndKey([...byKey.values()]);
}

// Run adapters with a bounded concurrency so a 9-provider refresh never fans
// out to 9 simultaneous upstream calls. Single-flight per provider is each
// adapter's own responsibility (the existing usage-limits.js already does it).
async function runAdaptersWithConcurrency(adapterEntries, salt, previousAccounts, options) {
  const results = [];
  const queue = [...adapterEntries];
  const workers = new Array(Math.min(MAX_PROVIDER_CONCURRENCY, queue.length || 1))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const [providerId, adapter] = queue.shift();
        try {
          const accounts = await adapter({ salt, previousAccounts, ...options });
          if (!Array.isArray(accounts)) {
            throw new TypeError(`Adapter for ${providerId} must return an array.`);
          }
          for (const acc of accounts) {
            // Re-stamp the account_key with the active salt so a rotated salt
            // doesn't leak the previous account_key shape. The adapter may
            // also pass a pre-built account; we trust its account_key only if
            // it matches the recomputed value.
            results.push(acc);
          }
        } catch (error) {
          // Failed adapter → synthesize one unavailable account entry so the
          // matrix can still render the other providers. If a previous
          // snapshot exists for this provider, prefer the stale snapshot
          // over a bare unavailable entry (preserves last successful value).
          const previous = previousAccounts?.filter((a) => a.provider_id === providerId) || [];
          if (previous.length > 0) {
            for (const acc of previous) {
              results.push(markSnapshotStale(acc));
            }
          } else {
            results.push(buildLimitAccountV2({
              providerId,
              rawAccountId: "unavailable",
              salt,
              accountLabel: null,
              planLabel: null,
              status: LIMIT_ACCOUNT_STATUS.UNAVAILABLE,
              windows: [],
              lastSuccessAt: null,
              errorCode: LIMIT_ACCOUNT_STATUS.UNAVAILABLE,
            }));
          }
        }
      }
    });
  await Promise.all(workers);
  return sortByProviderAndKey(results);
}

async function getLimitAccounts(options = {}) {
  const nowMs = Date.now();
  if (cache.data && nowMs - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  if (inFlightFetch) {
    return inFlightFetch;
  }
  const promise = fetchLimitAccountsUncached(options).finally(() => {
    if (inFlightFetch === promise) inFlightFetch = null;
  });
  inFlightFetch = promise;
  return promise;
}

async function fetchLimitAccountsUncached(options = {}) {
  const hasInjectedHome = typeof options.home === "string" && options.home.length > 0;
  const home = hasInjectedHome ? options.home : os.homedir();
  const env = options.env === undefined ? (hasInjectedHome ? {} : process.env) : (options.env || {});
  const adapters = options.adapters || {};
  const previousAccounts = Array.isArray(options.previousAccounts)
    ? options.previousAccounts
    : lastGoodAccounts;
  const nowMs = Date.now();

  const salt = loadOrCreateIdentitySalt({ home });
  const labels = loadAccountLabels({ home });
  const adapterEntries = Object.entries(adapters);
  const rawAccounts = await runAdaptersWithConcurrency(adapterEntries, salt, previousAccounts, { home, env });
  const accounts = applyAccountLabels(rawAccounts, labels);

  lastGoodAccounts = mergeLastGoodAccounts(previousAccounts, accounts);

  const result = {
    schema_version: SCHEMA_VERSION,
    fetched_at: new Date(nowMs).toISOString(),
    accounts,
  };
  cache = { data: result, fetchedAt: nowMs };
  return result;
}

function resetLimitAccountsCache() {
  // Force-refresh clears the TTL payload only. lastGoodAccounts stays so a
  // failed upstream round can still serve the previous successful snapshot.
  cache = { data: null, fetchedAt: 0 };
}

function clearLimitAccountsState() {
  cache = { data: null, fetchedAt: 0 };
  lastGoodAccounts = null;
}

module.exports = {
  LIMIT_WINDOW_KINDS,
  LIMIT_ACCOUNT_STATUS,
  SCHEMA_VERSION,
  DEFAULT_STALE_AFTER_SECONDS,
  MAX_PROVIDER_CONCURRENCY,
  loadOrCreateIdentitySalt,
  computeAccountKey,
  buildLimitWindowV2,
  buildLimitAccountV2,
  getLimitAccounts,
  resetLimitAccountsCache,
  clearLimitAccountsState,
  markSnapshotStale,
  sortByProviderAndKey,
  loadAccountLabels,
  applyAccountLabels,
  mergeLastGoodAccounts,
};
