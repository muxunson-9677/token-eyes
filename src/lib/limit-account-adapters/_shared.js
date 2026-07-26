"use strict";

// Shared helpers for limit-account adapters. Each adapter maps a single
// provider's quota payload (as returned by usage-limits.js) into one or more
// LimitAccountV2 entries. O2's MVP scope is single-account-per-provider: the
// matrix can render multiple accounts, but the data source only provides the
// currently-logged-in account. Multi-account discovery is a future enhancement.

const {
  buildLimitAccountV2,
  buildLimitWindowV2,
  LIMIT_WINDOW_KINDS,
  LIMIT_ACCOUNT_STATUS,
} = require("../limit-accounts");

// Derive a LimitAccountV2 status from a usage-limits provider entry.
function statusFromProviderEntry(entry) {
  if (!entry || !entry.configured) return LIMIT_ACCOUNT_STATUS.UNAVAILABLE;
  if (entry.error) {
    const msg = String(entry.error).toLowerCase();
    if (msg.includes("401") || msg.includes("expired") || msg.includes("auth")) {
      return LIMIT_ACCOUNT_STATUS.AUTH_ERROR;
    }
    if (msg.includes("429") || msg.includes("rate")) {
      return LIMIT_ACCOUNT_STATUS.RATE_LIMITED;
    }
    return LIMIT_ACCOUNT_STATUS.UNAVAILABLE;
  }
  // A stale entry (cache-backed with `stale: true`) maps to the stale status.
  if (entry.stale) return LIMIT_ACCOUNT_STATUS.STALE;
  return LIMIT_ACCOUNT_STATUS.OK;
}

// Propagate the provider-level evidence (attached by decorateUsageLimitsWithEvidence)
// onto each window so the v2 schema's per-window evidence field is populated.
function windowWithEvidence({ kind, label, window, evidence }) {
  if (!window) return null;
  const usedPercent = window.used_percent ?? window.utilization ?? null;
  const resetAt = window.reset_at ?? window.resets_at ?? null;
  const windowSeconds = window.limit_window_seconds ?? window.window_seconds ?? null;
  return buildLimitWindowV2({
    kind,
    label,
    usedPercent,
    resetAt,
    windowSeconds,
    evidence: evidence || undefined,
  });
}

// Build a single LimitAccountV2 entry from a provider's usage-limits payload.
function buildAccountFromProviderEntry({
  providerId,
  rawAccountId,
  salt,
  entry,
  windows,
  accountLabel,
}) {
  if (!entry) {
    return buildLimitAccountV2({
      providerId,
      rawAccountId: rawAccountId || "unavailable",
      salt,
      accountLabel,
      planLabel: null,
      status: LIMIT_ACCOUNT_STATUS.UNAVAILABLE,
      windows: [],
      lastSuccessAt: null,
      errorCode: LIMIT_ACCOUNT_STATUS.UNAVAILABLE,
    });
  }
  const status = statusFromProviderEntry(entry);
  const planLabel = entry.plan_label || null;
  if (status !== LIMIT_ACCOUNT_STATUS.OK && status !== LIMIT_ACCOUNT_STATUS.STALE) {
    return buildLimitAccountV2({
      providerId,
      rawAccountId: rawAccountId || "default",
      salt,
      accountLabel,
      planLabel,
      status,
      windows: [],
      lastSuccessAt: entry.cached_at || null,
      errorCode: status,
    });
  }
  return buildLimitAccountV2({
    providerId,
    rawAccountId: rawAccountId || "default",
    salt,
    accountLabel,
    planLabel,
    status,
    windows: windows || [],
    lastSuccessAt: entry.cached_at || null,
    errorCode: null,
  });
}

module.exports = {
  statusFromProviderEntry,
  windowWithEvidence,
  buildAccountFromProviderEntry,
  LIMIT_WINDOW_KINDS,
  LIMIT_ACCOUNT_STATUS,
};
