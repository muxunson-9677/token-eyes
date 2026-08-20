"use strict";

// GitHub Copilot adapter: maps the single-account Copilot quota payload into
// a LimitAccountV2 entry. Copilot exposes a premium_interactions window and a
// chat window. There is no stable account id in the payload; the OAuth token
// hash is used as a stable identifier.

const usageLimits = require("../usage-limits");
const { buildAccountFromProviderEntry, windowWithEvidence, LIMIT_WINDOW_KINDS } = require("./_shared");

async function copilotAdapter({ salt, home, env, platform, fetchImpl, scanDefaultWindowsDrives, windowsDriveRoots, securityRunner, commandRunner, providerTimeoutMs } = {}) {
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

  const entry = limits?.copilot;
  if (!entry || !entry.configured) return [];

  const rawAccountId = usageLimits.getCopilotCredentialIdentity(entry) || "default";
  const evidence = entry.evidence;
  const windows = [];
  if (entry.primary_window) {
    windows.push(windowWithEvidence({
      kind: LIMIT_WINDOW_KINDS.CUSTOM,
      label: "premium",
      window: entry.primary_window,
      evidence,
    }));
  }
  if (entry.secondary_window) {
    windows.push(windowWithEvidence({
      kind: LIMIT_WINDOW_KINDS.CUSTOM,
      label: "chat",
      window: entry.secondary_window,
      evidence,
    }));
  }

  const account = buildAccountFromProviderEntry({
    providerId: "copilot",
    rawAccountId,
    salt,
    entry,
    windows: windows.filter(Boolean),
    accountLabel: null,
  });
  return [{
    ...account,
    error_code: entry.error_code || account.error_code,
  }];
}

module.exports = copilotAdapter;
