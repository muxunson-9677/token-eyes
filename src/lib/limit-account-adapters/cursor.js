"use strict";

// Cursor adapter: maps the single-account Cursor quota payload into a
// LimitAccountV2 entry. The raw account id is read from the Cursor session
// token's userId field; it is hashed via computeAccountKey before leaving
// this process.

const usageLimits = require("../usage-limits");
const { isCursorInstalled, extractCursorSessionToken } = require("../cursor-config");
const { buildAccountFromProviderEntry, windowWithEvidence, LIMIT_WINDOW_KINDS } = require("./_shared");

async function cursorAdapter({ salt, home, env, platform, fetchImpl, scanDefaultWindowsDrives, windowsDriveRoots, securityRunner, commandRunner, providerTimeoutMs } = {}) {
  const [limits, cursorSession] = await Promise.all([
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
    Promise.resolve().then(() => (isCursorInstalled({ home, env, platform }) ? extractCursorSessionToken({ home, env, platform }) : null)).catch(() => null),
  ]);

  const entry = limits?.cursor;
  if (!entry || !entry.configured) return [];

  const rawAccountId = cursorSession?.userId || "default";
  const evidence = entry.evidence;
  const windows = [];
  if (entry.primary_window) {
    windows.push(windowWithEvidence({
      kind: LIMIT_WINDOW_KINDS.MONTHLY,
      label: "monthly",
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
    providerId: "cursor",
    rawAccountId,
    salt,
    entry,
    windows: windows.filter(Boolean),
    accountLabel: null,
  });
  return [account];
}

module.exports = cursorAdapter;
