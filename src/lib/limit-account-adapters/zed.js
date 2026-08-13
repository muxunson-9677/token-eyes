"use strict";

// Zed adapter: maps the single-account Zed subscription usage payload into a
// LimitAccountV2 entry. Zed exposes a token-spend window (USD cents) and an
// edit-predictions window per billing period. The credential lives in the OS
// credential store; the user id doubles as a stable account identifier.

const crypto = require("node:crypto");
const usageLimits = require("../usage-limits");
const { readZedCredential } = require("../zed-limits");
const { buildAccountFromProviderEntry, windowWithEvidence, LIMIT_WINDOW_KINDS } = require("./_shared");

async function zedAdapter({ salt, home, env, platform, fetchImpl, scanDefaultWindowsDrives, windowsDriveRoots, securityRunner, commandRunner, providerTimeoutMs } = {}) {
  const [limits, credential] = await Promise.all([
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
    Promise.resolve()
      .then(() => readZedCredential({ platform, env: env || {}, securityRunner, commandRunner }))
      .catch(() => null),
  ]);

  const entry = limits?.zed;
  if (!entry || !entry.configured) return [];

  let rawAccountId = "default";
  if (credential?.userId) {
    rawAccountId = `sha256:${crypto.createHash("sha256").update(String(credential.userId)).digest("hex").slice(0, 16)}`;
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
    providerId: "zed",
    rawAccountId,
    salt,
    entry,
    windows: windows.filter(Boolean),
    accountLabel: null,
  });
  return [account];
}

module.exports = zedAdapter;
