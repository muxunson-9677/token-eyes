"use strict";

// Antigravity adapter: maps the single-account Antigravity quota payload into
// a LimitAccountV2 entry. The account_email field serves as the stable
// account identifier.

const usageLimits = require("../usage-limits");
const { buildAccountFromProviderEntry, windowWithEvidence, LIMIT_WINDOW_KINDS } = require("./_shared");

async function antigravityAdapter({ salt, home, env, platform, fetchImpl, scanDefaultWindowsDrives, windowsDriveRoots, securityRunner, commandRunner, providerTimeoutMs } = {}) {
  const limits = await usageLimits.getUsageLimits({
    home,
    env,
    platform,
    fetchImpl,
    scanDefaultWindowsDrives,
    windowsDriveRoots,
    securityRunner,
    commandRunner,
    providerTimeoutMs,
  });

  const entry = limits?.antigravity;
  if (!entry || !entry.configured) return [];

  const rawAccountId = entry.account_email || "default";
  const evidence = entry.evidence;
  const windows = [];
  if (entry.primary_window) {
    windows.push(windowWithEvidence({
      kind: LIMIT_WINDOW_KINDS.CUSTOM,
      label: "primary",
      window: entry.primary_window,
      evidence,
    }));
  }
  if (entry.secondary_window) {
    windows.push(windowWithEvidence({
      kind: LIMIT_WINDOW_KINDS.CUSTOM,
      label: "secondary",
      window: entry.secondary_window,
      evidence,
    }));
  }
  if (entry.tertiary_window) {
    windows.push(windowWithEvidence({
      kind: LIMIT_WINDOW_KINDS.CUSTOM,
      label: "tertiary",
      window: entry.tertiary_window,
      evidence,
    }));
  }

  const account = buildAccountFromProviderEntry({
    providerId: "antigravity",
    rawAccountId,
    salt,
    entry,
    windows: windows.filter(Boolean),
    accountLabel: null,
  });
  return [account];
}

module.exports = antigravityAdapter;
