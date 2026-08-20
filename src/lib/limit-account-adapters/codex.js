"use strict";

// Codex adapter: maps the single-account Codex quota payload (returned by
// usage-limits.js) into a LimitAccountV2 entry. The raw account id is read
// from the Codex auth bundle; it is hashed via computeAccountKey before
// leaving this process, so the real id never appears in the response.

const usageLimits = require("../usage-limits");
const subscriptions = require("../subscriptions");
const { buildAccountFromProviderEntry, windowWithEvidence, LIMIT_WINDOW_KINDS } = require("./_shared");

function classifyCodexWindowKind(window) {
  if (!window || typeof window !== "object") return LIMIT_WINDOW_KINDS.CUSTOM;
  const seconds = Number(window.limit_window_seconds);
  if (seconds === 18000) return LIMIT_WINDOW_KINDS.FIVE_HOUR;
  if (seconds === 604800) return LIMIT_WINDOW_KINDS.SEVEN_DAY;
  return LIMIT_WINDOW_KINDS.CUSTOM;
}

function labelForCodexWindow(window, fallbackLabel) {
  const kind = classifyCodexWindowKind(window);
  if (kind === LIMIT_WINDOW_KINDS.FIVE_HOUR) return "5h";
  if (kind === LIMIT_WINDOW_KINDS.SEVEN_DAY) return "7d";
  return fallbackLabel || "custom";
}

async function codexAdapter({ salt, home, env, platform, fetchImpl, scanDefaultWindowsDrives, windowsDriveRoots, securityRunner, commandRunner, providerTimeoutMs } = {}) {
  const [limits, codexAuth] = await Promise.all([
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
    subscriptions.readCodexAuthBundle({
      home,
      env: env || {},
      platform,
      scanDefaultWindowsDrives,
      windowsDriveRoots,
    }).catch(() => null),
  ]);

  const entry = limits?.codex;
  if (!entry || !entry.configured) return [];

  const rawAccountId = codexAuth?.accountId || "default";
  const evidence = entry.evidence;
  const windows = [];
  if (entry.primary_window) {
    windows.push(windowWithEvidence({
      kind: classifyCodexWindowKind(entry.primary_window),
      label: labelForCodexWindow(entry.primary_window, "5h"),
      window: entry.primary_window,
      evidence,
    }));
  }
  if (entry.secondary_window) {
    windows.push(windowWithEvidence({
      kind: classifyCodexWindowKind(entry.secondary_window),
      label: labelForCodexWindow(entry.secondary_window, "7d"),
      window: entry.secondary_window,
      evidence,
    }));
  }
  // Spark windows are a separate sub-plan; render them with a "Spark " prefix
  // so the matrix can distinguish them from the primary plan's windows.
  if (entry.spark_primary_window) {
    windows.push(windowWithEvidence({
      kind: classifyCodexWindowKind(entry.spark_primary_window),
      label: `Spark ${labelForCodexWindow(entry.spark_primary_window, "5h")}`,
      window: entry.spark_primary_window,
      evidence,
    }));
  }
  if (entry.spark_secondary_window) {
    windows.push(windowWithEvidence({
      kind: classifyCodexWindowKind(entry.spark_secondary_window),
      label: `Spark ${labelForCodexWindow(entry.spark_secondary_window, "7d")}`,
      window: entry.spark_secondary_window,
      evidence,
    }));
  }

  const account = buildAccountFromProviderEntry({
    providerId: "codex",
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

module.exports = codexAdapter;
