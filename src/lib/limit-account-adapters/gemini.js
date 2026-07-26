"use strict";

// Gemini adapter: maps the single-account Gemini quota payload into a
// LimitAccountV2 entry. Gemini exposes up to three windows and an
// account_email field which serves as the stable account identifier.

const usageLimits = require("../usage-limits");
const { buildAccountFromProviderEntry, windowWithEvidence, LIMIT_WINDOW_KINDS } = require("./_shared");

async function geminiAdapter({ salt, home, env, platform, fetchImpl, scanDefaultWindowsDrives, windowsDriveRoots, securityRunner, commandRunner, providerTimeoutMs } = {}) {
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

  const entry = limits?.gemini;
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
    providerId: "gemini",
    rawAccountId,
    salt,
    entry,
    windows: windows.filter(Boolean),
    accountLabel: null,
  });
  return [account];
}

module.exports = geminiAdapter;
