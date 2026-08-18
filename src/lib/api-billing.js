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
 *   spendAuthority, monthCostUsd, lifetimeCostUsd, status, lastSyncedAt.
 *
 * The sync status follows the same states as token-plan-refresh.js:
 * - synced: account connected and local equivalent-cost data available
 * - not-connected: no account detected
 * - error: detection failed
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const { executeFinancialRequest } = require("./provider-api-executor");
const { queueUsageIdentity } = require("./usage-attribution");

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

const SPEND_AUTHORITIES = Object.freeze({
  OFFICIAL_INVOICE: "official_invoice",
  LOCAL_LIST_PRICE_ESTIMATE: "local_list_price_estimate",
  UNAVAILABLE: "unavailable",
});

const OPENAI_COSTS_PATH = "/v1/organization/costs";

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
 * Local API-equivalent estimates may come from usage rows (see collectApiBillingAccounts).
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
        spendAuthority: SPEND_AUTHORITIES.UNAVAILABLE,
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

  // Check Codex auth.json across all tracking-ready homes (AgentData + ~/.codex).
  try {
    const { listTrackingReadyCodexHomes } = require("./data-directories");
    const codexHomes = listTrackingReadyCodexHomes({ env, home });
    const homesToScan = codexHomes.length > 0 ? codexHomes : [path.join(home, ".codex")];
    for (const codexHome of homesToScan) {
      const authPath = path.join(codexHome, "auth.json");
      if (!fs.existsSync(authPath)) continue;
      const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
      const accountId = auth?.tokens?.account_id || auth?.tokens?.chatgpt_account_id;
      if (accountId) {
        detected.push({
          provider: "openai",
          accountName: String(accountId).substring(0, 8) + "...",
          billingSource: BILLING_SOURCES.API,
          hasCredentials: true,
        });
        break;
      }
    }
  } catch (_e) {
    // Ignore errors
  }

  // Check Opencode auth
  try {
    const opencodeDataDir = env.XDG_DATA_HOME
      ? path.join(env.XDG_DATA_HOME, "opencode")
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
      const runSecurity = securityRunner || cp.spawnSync;
      const result = runSecurity(
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
      // identity is verified, but local API-equivalent estimates must come from usage rows
      const existing = resultMap.get(provider);
      // Keep status as not-connected until we have local equivalent-cost data.
      // Spend records only establish identity, not API usage costs.
    } else {
      // Add new account from detected credentials
      resultMap.set(provider, {
        provider: cred.provider,
        accountName: cred.accountName,
        billingSource: cred.billingSource,
        spendAuthority: SPEND_AUTHORITIES.UNAVAILABLE,
        monthCostUsd: null, // No local API-equivalent estimate yet
        lifetimeCostUsd: null, // No local API-equivalent estimate yet
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

function calculateUsageCosts(queueRows, { monthKey = null } = {}) {
  const costsBySource = new Map();
  const selectedPeriod = getUtcMonthPeriod(monthKey);
  const now = new Date();
  const monthStart = selectedPeriod
    ? new Date(selectedPeriod.startSeconds * 1000)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = selectedPeriod
    ? new Date(selectedPeriod.endSeconds * 1000)
    : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const latestRows = new Map();
  for (const row of queueRows) latestRows.set(queueUsageIdentity(row), row);

  for (const row of latestRows.values()) {
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
        if (Number.isFinite(rowDate.getTime()) && rowDate >= monthStart && rowDate < monthEnd) {
          stats.monthCostUsd += costUsd;
        }
      } catch {
        // skip invalid date
      }
    }
  }

  return costsBySource;
}

function getUtcMonthPeriod(monthKey) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(monthKey || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const startSeconds = Date.UTC(year, monthIndex, 1) / 1000;
  const endSeconds = Date.UTC(year, monthIndex + 1, 1) / 1000;
  return {
    monthKey: match[0],
    startSeconds,
    endSeconds,
    billingPeriodStart: new Date(startSeconds * 1000).toISOString(),
    billingPeriodEnd: new Date(endSeconds * 1000).toISOString(),
  };
}

function isOpenAiCostsConfig(config, { allowTestEndpoint = false } = {}) {
  const providerId = String(config?.providerId || "").trim().toLowerCase();
  if (providerId !== "openai" && providerId !== "codex") return false;
  if (String(config?.authType || "bearer").trim().toLowerCase() !== "bearer") return false;
  if (String(config?.requestMethod || "GET").trim().toUpperCase() !== "GET") return false;
  try {
    const requestUrl = new URL(String(config?.requestUrl || ""));
    if (requestUrl.pathname.replace(/\/$/, "") !== OPENAI_COSTS_PATH) return false;
    return allowTestEndpoint
      ? requestUrl.protocol === "http:" || requestUrl.protocol === "https:"
      : requestUrl.protocol === "https:" && requestUrl.hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
}

function parseOpenAiCostsPage(page, period, seenBuckets) {
  if (!page || page.object !== "page" || !Array.isArray(page.data)) return null;
  if (typeof page.has_more !== "boolean") return null;
  if (page.has_more) {
    if (typeof page.next_page !== "string" || !page.next_page.trim()) return null;
  } else if (page.next_page !== null) {
    return null;
  }

  let totalUsd = 0;
  for (const bucket of page.data) {
    if (!bucket || bucket.object !== "bucket" || !Array.isArray(bucket.results)) return null;
    if (!Number.isInteger(bucket.start_time) || !Number.isInteger(bucket.end_time)) return null;
    if (
      bucket.start_time < period.startSeconds
      || bucket.end_time > period.endSeconds
      || bucket.end_time - bucket.start_time !== 86400
    ) return null;
    const bucketKey = `${bucket.start_time}:${bucket.end_time}`;
    if (seenBuckets.has(bucketKey)) return null;
    seenBuckets.add(bucketKey);

    for (const result of bucket.results) {
      if (!result || result.object !== "organization.costs.result") return null;
      if (!result.amount || result.amount.currency !== "usd") return null;
      if (typeof result.amount.value !== "number" || !Number.isFinite(result.amount.value) || result.amount.value < 0) return null;
      totalUsd += result.amount.value;
    }
  }

  return {
    totalUsd,
    hasMore: page.has_more,
    nextPage: page.next_page,
  };
}

async function fetchOpenAiCostsInvoice({
  config,
  secret,
  monthKey,
  allowTestEndpoint = false,
  executeRequest = executeFinancialRequest,
} = {}) {
  const period = getUtcMonthPeriod(monthKey);
  if (!period || !secret || !isOpenAiCostsConfig(config, { allowTestEndpoint })) {
    return { ok: false, errorCode: "official_invoice_unavailable" };
  }

  const seenPages = new Set();
  const seenBuckets = new Set();
  let cursor = null;
  let totalUsd = 0;
  for (;;) {
    const requestUrl = new URL(String(config.requestUrl));
    requestUrl.search = "";
    requestUrl.searchParams.set("start_time", String(period.startSeconds));
    requestUrl.searchParams.set("end_time", String(period.endSeconds));
    requestUrl.searchParams.set("bucket_width", "1d");
    requestUrl.searchParams.set("limit", "180");
    if (cursor) requestUrl.searchParams.set("page", cursor);

    let response;
    try {
      response = await executeRequest({
        ...config,
        requestUrl: requestUrl.toString(),
        requestMethod: "GET",
        authType: "bearer",
      }, secret, { testMode: allowTestEndpoint });
    } catch {
      return { ok: false, errorCode: "official_invoice_unavailable" };
    }
    if (!response?.ok) return { ok: false, errorCode: "official_invoice_unavailable" };

    const parsed = parseOpenAiCostsPage(response.data, period, seenBuckets);
    if (!parsed) return { ok: false, errorCode: "official_invoice_invalid" };
    totalUsd += parsed.totalUsd;
    if (!parsed.hasMore) break;
    if (seenPages.has(parsed.nextPage)) return { ok: false, errorCode: "official_invoice_invalid" };
    seenPages.add(parsed.nextPage);
    cursor = parsed.nextPage;
  }

  return {
    ok: true,
    invoice: {
      billingSource: BILLING_SOURCES.API,
      spendAuthority: SPEND_AUTHORITIES.OFFICIAL_INVOICE,
      monthCostUsd: Math.round(totalUsd * 1e6) / 1e6,
      lifetimeCostUsd: null,
      monthKey: period.monthKey,
      billingPeriodStart: period.billingPeriodStart,
      billingPeriodEnd: period.billingPeriodEnd,
      lastSyncedAt: new Date().toISOString(),
    },
  };
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
  monthKey = null,
} = {}) {
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const securityRunner = options.securityRunner;

  const costStats = queuePath ? calculateUsageCosts(readQueueRows(queuePath), { monthKey }) : new Map();

  // Collect from spend records
  const spendAccounts = collectBillingFromSpendRecords(spendRecords);

  // Detect credentials from local files
  const detectedCredentials = detectCredentialsFromAuthFiles({ home, env });

  // Detect credentials from macOS Keychain
  const keychainCredentials = detectCredentialsFromKeychain({ platform, securityRunner });
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

  const providerCostStats = new Map();
  for (const [source, stats] of costStats) {
    const provider = sourceToProvider[source] || source;
    const current = providerCostStats.get(provider) || { monthCostUsd: 0, lifetimeCostUsd: 0 };
    current.monthCostUsd += stats.monthCostUsd;
    current.lifetimeCostUsd += stats.lifetimeCostUsd;
    providerCostStats.set(provider, current);
  }

  for (const account of mergedAccounts) {
    const provider = sourceToProvider[account.provider] || account.provider;
    const stats = providerCostStats.get(provider);
    if (stats) {
      account.billingSource = BILLING_SOURCES.API;
      account.spendAuthority = SPEND_AUTHORITIES.LOCAL_LIST_PRICE_ESTIMATE;
      account.monthCostUsd = Number(stats.monthCostUsd.toFixed(6));
      account.lifetimeCostUsd = Number(stats.lifetimeCostUsd.toFixed(6));
      account.status = SYNC_STATUSES.SYNCED;
      account.lastSyncedAt = new Date().toISOString();
    }
  }

  for (const [provider, stats] of providerCostStats) {
    const existingAccount = mergedAccounts.find((a) => a.provider === provider);
    if (!existingAccount) {
      mergedAccounts.push({
        provider,
        accountName: getProviderName(provider),
        billingSource: BILLING_SOURCES.API,
        spendAuthority: SPEND_AUTHORITIES.LOCAL_LIST_PRICE_ESTIMATE,
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
  SPEND_AUTHORITIES,
  PROVIDER_NAMES,
  collectApiBillingAccounts,
  collectBillingFromSpendRecords,
  detectCredentialsFromAuthFiles,
  detectCredentialsFromKeychain,
  fetchOpenAiCostsInvoice,
  getUtcMonthPeriod,
  isOpenAiCostsConfig,
  mergeBillingAccounts,
  normalizeBillingSource,
  normalizeSyncStatus,
  getProviderName,
  getBillingSourceLabel,
  getSyncStatusLabel,
};
