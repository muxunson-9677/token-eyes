"use strict";

// Kimi adapter: maps the single-account Kimi quota payload into a
// LimitAccountV2 entry. Kimi exposes up to three windows (primary/secondary/
// tertiary) plus a parallel-limit cap. The raw account id is derived from
// the Kimi credentials' account field when available; otherwise "default".

const usageLimits = require("../usage-limits");
const { buildAccountFromProviderEntry, windowWithEvidence, LIMIT_WINDOW_KINDS } = require("./_shared");

async function kimiAdapter({ salt, home, env, platform, fetchImpl, scanDefaultWindowsDrives, windowsDriveRoots, securityRunner, commandRunner, providerTimeoutMs } = {}) {
  const [limits, kimiCreds] = await Promise.all([
    usageLimits.getUsageLimits({
      home,
      env,
      platform,
      fetchImpl,
      scanDefaultWindowsDrives,
      windowsDriveRoots,
      securityRunner,
      commandRunner,
      providerTimeoutMs,
    }),
    Promise.resolve().then(() => usageLimits.loadKimiCredentials({ home, env: env || {} })).catch(() => null),
  ]);

  const entry = limits?.kimi;
  if (!entry || !entry.configured) return [];

  const rawAccountId = kimiCreds?.account || kimiCreds?.userId || "default";
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
    providerId: "kimi",
    rawAccountId,
    salt,
    entry,
    windows: windows.filter(Boolean),
    accountLabel: null,
  });
  return [account];
}

module.exports = kimiAdapter;
