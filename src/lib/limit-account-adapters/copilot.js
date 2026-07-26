"use strict";

// GitHub Copilot adapter: maps the single-account Copilot quota payload into
// a LimitAccountV2 entry. Copilot exposes a premium_interactions window and a
// chat window. There is no stable account id in the payload; the OAuth token
// hash is used as a stable identifier.

const crypto = require("node:crypto");
const usageLimits = require("../usage-limits");
const { buildAccountFromProviderEntry, windowWithEvidence, LIMIT_WINDOW_KINDS } = require("./_shared");

async function copilotAdapter({ salt, home, env, platform, fetchImpl, scanDefaultWindowsDrives, windowsDriveRoots, securityRunner, commandRunner, providerTimeoutMs } = {}) {
  const [limits, token] = await Promise.all([
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
    Promise.resolve().then(() => usageLimits.readCopilotOauthToken({ home, platform, securityRunner })).catch(() => null),
  ]);

  const entry = limits?.copilot;
  if (!entry || !entry.configured) return [];

  let rawAccountId = "default";
  if (token && typeof token === "string" && token.length > 0) {
    rawAccountId = `sha256:${crypto.createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
  }
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
  return [account];
}

module.exports = copilotAdapter;
