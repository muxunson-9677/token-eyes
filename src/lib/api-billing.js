"use strict";

/**
 * API Billing detection module (03-cost-billing).
 *
 * Design principles:
 * - Detects API billing accounts per provider using the same sync status
 *   pattern as token-plan-refresh.js (xiaomi status sync).
 * - API billing accounts are derived from spend records (manual entries) and
 *   detected credentials (API keys found in auth files).
 * - Returns ApiBillingAccount[] with provider, accountName, billingSource,
 *   monthCostUsd, lifetimeCostUsd, status, lastSyncedAt.
 *
 * The sync status follows the same states as token-plan-refresh.js:
 * - synced: account connected and cost data available
 * - not-connected: no account detected
 * - error: detection failed
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

// Sync status constants (same as token-plan-refresh.js)
const SYNC_STATUSES = {
  SYNCED: "synced",
  NOT_CONNECTED: "not-connected",
  ERROR: "error",
};

const BILLING_SOURCES = {
  API: "api",
  CONSOLE: "console",
  MANUAL: "manual",
};

// Provider display names
const PROVIDER_NAMES = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  xiaomi_mimo: "小米 MiMo",
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  custom: "自定义",
};

/**
 * Normalize billing source string
 */
function normalizeBillingSource(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "api") return BILLING_SOURCES.API;
  if (v === "console") return BILLING_SOURCES.CONSOLE;
  return BILLING_SOURCES.MANUAL;
}

/**
 * Normalize sync status string
 */
function normalizeSyncStatus(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "synced" || v === "success") return SYNC_STATUSES.SYNCED;
  if (v === "error" || v === "failed") return SYNC_STATUSES.ERROR;
  return SYNC_STATUSES.NOT_CONNECTED;
}

/**
 * Get provider display name
 */
function getProviderName(provider) {
  return PROVIDER_NAMES[String(provider || "").trim().toLowerCase()] || String(provider || "未知").trim();
}

/**
 * Collect API billing accounts from spend records.
 * Spend records contain user-entered subscription costs that map to providers.
 * IMPORTANT: Subscription/spend records are NOT API usage costs. They represent
 * fixed subscription fees (e.g., $20/month for Claude Max plan) which are
 * different from API usage-based costs. This function only establishes account
 * identity from spend records; it does NOT contribute to monthCostUsd or lifetimeCostUsd.
 * Actual API usage costs should come from usage rows (see collectApiBillingAccounts).
 */
function collectBillingFromSpendRecords(spendRecords = []) {
  const accountsByProvider = new Map();

  for (const record of spendRecords) {
    const source = String(record.source || "").trim().toLowerCase();
    if (!source) continue;

    if (!accountsByProvider.has(source)) {
      // Spend records establish account identity only - costs remain null
      // because subscription fees ≠ API usage costs
      accountsByProvider.set(source, {
        provider: source,
        accountName: getProviderName(source),
        billingSource: normalizeBillingSource(record.billing_cycle),
        monthCostUsd: null, // Not API usage cost - subscription fees are different semantics
        lifetimeCostUsd: null, // Not API usage cost - subscription fees are different semantics
        status: SYNC_STATUSES.NOT_CONNECTED,
        lastSyncedAt: null,
      });
    }
  }

  return Array.from(accountsByProvider.values());
}

/**
 * Detect API credentials presence from local auth files.
 * Returns list of detected accounts with their providers.
 */
function detectCredentialsFromAuthFiles({ home = os.homedir(), env = process.env } = {}) {
  const detected = [];

  // Check Codex auth.json
  try {
    const codexHome = path.join(home, ".codex");
    const authPath = path.join(codexHome, "auth.json");
    if (fs.existsSync(authPath)) {
      const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
      const accountId = auth?.tokens?.account_id || auth?.tokens?.chatgpt_account_id;
      if (accountId) {
        detected.push({
          provider: "openai",
          accountName: String(accountId).substring(0, 8) + "...",
          billingSource: BILLING_SOURCES.API,
          hasCredentials: true,
        });
      }
    }
  } catch (_e) {
    // Ignore errors
  }

  // Check Opencode auth
  try {
    const opencodeDataDir = process.env.XDG_DATA_HOME
      ? path.join(process.env.XDG_DATA_HOME, "opencode")
      : path.join(home, ".local", "share", "opencode");
    const authPath = path.join(opencodeDataDir, "auth.json");
    if (fs.existsSync(authPath)) {
      const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
      if (auth?.openai?.access || auth?.tokens?.access_token) {
        detected.push({
          provider: "openai",
          accountName: "OpenCode",
          billingSource: BILLING_SOURCES.API,
          hasCredentials: true,
        });
      }
    }
  } catch (_e) {
    // Ignore errors
  }

  // Check Claude Code credentials file (Linux/Windows)
  try {
    const claudeCredPath = path.join(home, ".claude", ".credentials.json");
    if (fs.existsSync(claudeCredPath)) {
      const cred = JSON.parse(fs.readFileSync(claudeCredPath, "utf8"));
      if (cred?.claudeAiOauth) {
        detected.push({
          provider: "anthropic",
          accountName: "Claude Code",
          billingSource: BILLING_SOURCES.API,
          hasCredentials: true,
        });
      }
    }
  } catch (_e) {
    // Ignore errors
  }

  return detected;
}

/**
 * Detect API credentials from macOS Keychain
 */
function detectCredentialsFromKeychain({ platform = process.platform, securityRunner } = {}) {
  const detected = [];

  if (platform !== "darwin") return detected;

  const keychainServices = ["Claude Code-credentials"];

  for (const service of keychainServices) {
    try {
      const result = cp.spawnSync(
        "/usr/bin/security",
        ["find-generic-password", "-s", service, "-w"],
        { stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }
      );

      if (result?.status === 0 && result.stdout) {
        const password = result.stdout.toString("utf8").trim();
        if (password.length > 0) {
          detected.push({
            provider: "anthropic",
            accountName: "Claude Code",
            billingSource: BILLING_SOURCES.API,
            hasCredentials: true,
          });
        }
      }
    } catch (_e) {
      // Ignore errors
    }
  }

  return detected;
}

/**
 * Merge detected credentials with spend record accounts.
 * Spend records take precedence for billing data.
 */
function mergeBillingAccounts(spendAccounts, detectedCredentials) {
  const resultMap = new Map();

  // Add spend record accounts first (identity only, costs are null)
  for (const account of spendAccounts) {
    resultMap.set(account.provider, { ...account });
  }

  // Merge detected credentials
  for (const cred of detectedCredentials) {
    const provider = cred.provider;
    if (resultMap.has(provider)) {
      // Update existing account - detected credentials mean the account
      // identity is verified, but actual API usage costs must come from usage rows
      const existing = resultMap.get(provider);
      // Keep status as not-connected until we have actual API usage cost data
      // Spend records only establish identity, not API usage costs
    } else {
      // Add new account from detected credentials
      resultMap.set(provider, {
        provider: cred.provider,
        accountName: cred.accountName,
        billingSource: cred.billingSource,
        monthCostUsd: null, // No actual API usage cost data yet
        lifetimeCostUsd: null, // No actual API usage cost data yet
        status: SYNC_STATUSES.NOT_CONNECTED,
        lastSyncedAt: null,
      });
    }
  }

  return Array.from(resultMap.values());
}

function readQueueRows(queuePath) {
  try {
    const raw = fs.readFileSync(queuePath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const rows = [];
    for (const line of lines) {
      try {
        rows.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function calculateUsageCosts(queueRows) {
  const costsBySource = new Map();

  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  for (const row of queueRows) {
    const source = String(row.source || "").trim().toLowerCase();
    if (!source) continue;

    const costUsd = Number(row.cost_usd || 0);
    if (!Number.isFinite(costUsd) || costUsd <= 0) continue;

    if (!costsBySource.has(source)) {
      costsBySource.set(source, {
        monthCostUsd: 0,
        lifetimeCostUsd: 0,
      });
    }

    const stats = costsBySource.get(source);
    stats.lifetimeCostUsd += costUsd;

    const hourStart = row.hour_start;
    if (hourStart) {
      try {
        const rowDate = new Date(hourStart);
        if (rowDate >= currentMonthStart) {
          stats.monthCostUsd += costUsd;
        }
      } catch {
        // skip invalid date
      }
    }
  }

  return costsBySource;
}

/**
 * Main function to collect API billing accounts.
 *
 * @param {Object} options
 * @param {Array} options.spendRecords - User-entered spend records
 * @param {Object} options.options - Detection options (home, env, platform)
 * @param {string} options.queuePath - Path to queue.jsonl for usage-based cost calculation
 * @returns {Promise<Array<ApiBillingAccount>>}
 */
async function collectApiBillingAccounts({
  spendRecords = [],
  options = {},
  queuePath = null,
} = {}) {
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const platform = options.platform || process.platform;

  const costStats = queuePath ? calculateUsageCosts(readQueueRows(queuePath)) : new Map();

  // Collect from spend records
  const spendAccounts = collectBillingFromSpendRecords(spendRecords);

  // Detect credentials from local files
  const detectedCredentials = detectCredentialsFromAuthFiles({ home, env });

  // Detect credentials from macOS Keychain
  const keychainCredentials = detectCredentialsFromKeychain({ platform });
  detectedCredentials.push(...keychainCredentials);

  // Merge all sources
  const mergedAccounts = mergeBillingAccounts(spendAccounts, detectedCredentials);

  const sourceToProvider = {
    claude: "claude",
    anthropic: "anthropic",
    codex: "openai",
    openai: "openai",
    gemini: "google",
    google: "google",
    hermes: "hermes",
    cursor: "openai",
    opencode: "openai",
    openclaw: "openai",
  };

  for (const account of mergedAccounts) {
    const mappedSource = sourceToProvider[account.provider] || account.provider;
    const stats = costStats.get(mappedSource) || costStats.get(account.provider);
    if (stats) {
      account.monthCostUsd = Number(stats.monthCostUsd.toFixed(6));
      account.lifetimeCostUsd = Number(stats.lifetimeCostUsd.toFixed(6));
      account.status = SYNC_STATUSES.SYNCED;
      account.lastSyncedAt = new Date().toISOString();
    }
  }

  for (const [source, stats] of costStats) {
    const provider = sourceToProvider[source] || source;
    const existingAccount = mergedAccounts.find((a) => a.provider === provider);
    if (!existingAccount) {
      mergedAccounts.push({
        provider,
        accountName: getProviderName(provider),
        billingSource: BILLING_SOURCES.API,
        monthCostUsd: Number(stats.monthCostUsd.toFixed(6)),
        lifetimeCostUsd: Number(stats.lifetimeCostUsd.toFixed(6)),
        status: SYNC_STATUSES.SYNCED,
        lastSyncedAt: new Date().toISOString(),
      });
    }
  }

  mergedAccounts.sort((a, b) => a.provider.localeCompare(b.provider));

  return mergedAccounts;
}

/**
 * Get billing source display label
 */
function getBillingSourceLabel(source) {
  switch (source) {
    case BILLING_SOURCES.API:
      return "API";
    case BILLING_SOURCES.CONSOLE:
      return "控制台";
    case BILLING_SOURCES.MANUAL:
    default:
      return "手动";
  }
}

/**
 * Get sync status display label
 */
function getSyncStatusLabel(status) {
  switch (status) {
    case SYNC_STATUSES.SYNCED:
      return "已同步";
    case SYNC_STATUSES.ERROR:
      return "同步错误";
    case SYNC_STATUSES.NOT_CONNECTED:
    default:
      return "未连接";
  }
}

module.exports = {
  SYNC_STATUSES,
  BILLING_SOURCES,
  PROVIDER_NAMES,
  collectApiBillingAccounts,
  collectBillingFromSpendRecords,
  detectCredentialsFromAuthFiles,
  detectCredentialsFromKeychain,
  mergeBillingAccounts,
  normalizeBillingSource,
  normalizeSyncStatus,
  getProviderName,
  getBillingSourceLabel,
  getSyncStatusLabel,
};