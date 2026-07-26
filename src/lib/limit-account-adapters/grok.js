"use strict";

// Grok Build adapter: maps the single-account Grok quota payload into a
// LimitAccountV2 entry. Grok exposes up to two windows. The access token hash
// is used as a stable account identifier (no plain id is exposed by the API).

const crypto = require("node:crypto");
const usageLimits = require("../usage-limits");
const { readGrokAccessToken } = require("../grok-limits");
const { buildAccountFromProviderEntry, windowWithEvidence, LIMIT_WINDOW_KINDS } = require("./_shared");

async function grokAdapter({ salt, home, env, platform, fetchImpl, scanDefaultWindowsDrives, windowsDriveRoots, securityRunner, commandRunner, providerTimeoutMs } = {}) {
  const [limits, accessToken] = await Promise.all([
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
    Promise.resolve().then(() => readGrokAccessToken({ home, env: env || {} })).catch(() => null),
  ]);

  const entry = limits?.grok;
  if (!entry || !entry.configured) return [];

  let rawAccountId = "default";
  if (accessToken && typeof accessToken === "string" && accessToken.length > 0) {
    rawAccountId = `sha256:${crypto.createHash("sha256").update(accessToken).digest("hex").slice(0, 16)}`;
  }
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
    providerId: "grok",
    rawAccountId,
    salt,
    entry,
    windows: windows.filter(Boolean),
    accountLabel: null,
  });
  return [account];
}

module.exports = grokAdapter;
