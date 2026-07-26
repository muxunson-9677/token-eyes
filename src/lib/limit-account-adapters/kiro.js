"use strict";

// Kiro adapter: maps the single-account Kiro quota payload into a
// LimitAccountV2 entry. Kiro exposes up to two windows. There is no stable
// account id in the payload, so "default" is used (the matrix only shows one
// Kiro account in O2's MVP scope).

const usageLimits = require("../usage-limits");
const { buildAccountFromProviderEntry, windowWithEvidence, LIMIT_WINDOW_KINDS } = require("./_shared");

async function kiroAdapter({ salt, home, env, platform, fetchImpl, scanDefaultWindowsDrives, windowsDriveRoots, securityRunner, commandRunner, providerTimeoutMs } = {}) {
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

  const entry = limits?.kiro;
  if (!entry || !entry.configured) return [];

  const rawAccountId = "default";
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

  const account = buildAccountFromProviderEntry({
    providerId: "kiro",
    rawAccountId,
    salt,
    entry,
    windows: windows.filter(Boolean),
    accountLabel: null,
  });
  return [account];
}

module.exports = kiroAdapter;
