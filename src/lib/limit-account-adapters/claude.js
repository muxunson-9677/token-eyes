"use strict";

// Claude adapter: maps the single-account Claude quota payload into a
// LimitAccountV2 entry. Claude's usage-limits payload uses `five_hour` and
// `seven_day` slots (plus optional `seven_day_opus` and `extra_usage`).
// The raw account id is derived from the JWT `sub` claim when available;
// otherwise falls back to "default". The id is hashed before leaving process.

const crypto = require("node:crypto");
const usageLimits = require("../usage-limits");
const subscriptions = require("../subscriptions");
const { buildAccountFromProviderEntry, windowWithEvidence, LIMIT_WINDOW_KINDS } = require("./_shared");

function decodeJwtPayload(token) {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1];
  const padLen = (4 - (payload.length % 4)) % 4;
  const padded = payload + "=".repeat(padLen);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function deriveClaudeAccountId(accessToken) {
  if (!accessToken || typeof accessToken !== "string") return "default";
  const payload = decodeJwtPayload(accessToken);
  const sub = payload?.sub;
  if (typeof sub === "string" && sub.length > 0) return sub;
  // Fall back to a stable hash of the token so the account_key stays stable
  // across calls without leaking the token itself.
  return `sha256:${crypto.createHash("sha256").update(accessToken).digest("hex").slice(0, 16)}`;
}

async function claudeAdapter({ salt, home, env, platform, fetchImpl, scanDefaultWindowsDrives, windowsDriveRoots, securityRunner, commandRunner, providerTimeoutMs } = {}) {
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
    Promise.resolve().then(() => subscriptions.readClaudeCodeAccessToken({ platform, securityRunner, home })).catch(() => null),
  ]);

  const entry = limits?.claude;
  if (!entry || !entry.configured) return [];

  const rawAccountId = deriveClaudeAccountId(accessToken);
  const evidence = entry.evidence;
  const windows = [];
  if (entry.five_hour) {
    windows.push(windowWithEvidence({
      kind: LIMIT_WINDOW_KINDS.FIVE_HOUR,
      label: "5h",
      window: entry.five_hour,
      evidence,
    }));
  }
  if (entry.seven_day) {
    windows.push(windowWithEvidence({
      kind: LIMIT_WINDOW_KINDS.SEVEN_DAY,
      label: "7d",
      window: entry.seven_day,
      evidence,
    }));
  }
  // seven_day_opus is a model-specific weekly window; render it with a label
  // so the matrix can distinguish it from the default 7d window.
  if (entry.seven_day_opus) {
    windows.push(windowWithEvidence({
      kind: LIMIT_WINDOW_KINDS.SEVEN_DAY,
      label: "7d Opus",
      window: entry.seven_day_opus,
      evidence,
    }));
  }

  const account = buildAccountFromProviderEntry({
    providerId: "claude",
    rawAccountId,
    salt,
    entry,
    windows: windows.filter(Boolean),
    accountLabel: null,
  });
  return [account];
}

module.exports = claudeAdapter;
