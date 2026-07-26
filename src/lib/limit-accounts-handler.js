"use strict";

// Independent O2 handler for the multi-account limit matrix. local-api.js
// only mounts this route; business logic stays here so O6/O8 can rewire
// without rewriting account hashing / adapter orchestration.

const { getLimitAccounts, resetLimitAccountsCache } = require("./limit-accounts");
const { getDefaultAdapters } = require("./limit-account-adapters");
const { appendQuotaSamplesFromAccounts, readQuotaSamples } = require("./quota-history");
const { computeQuotaForecastsForAccounts } = require("./quota-forecast");

async function handleLimitAccountsRequest({
  refresh = false,
  home,
  env,
  platform,
  scanDefaultWindowsDrives,
  windowsDriveRoots,
  securityRunner,
  commandRunner,
  providerTimeoutMs,
  fetchImpl,
  adapters,
  nowMs = Date.now(),
  recordSamples = true,
  includeForecasts = true,
} = {}) {
  if (refresh) {
    resetLimitAccountsCache();
  }

  const data = await getLimitAccounts({
    home,
    env,
    platform,
    scanDefaultWindowsDrives,
    windowsDriveRoots,
    securityRunner,
    commandRunner,
    providerTimeoutMs,
    fetchImpl,
    adapters: adapters || getDefaultAdapters(),
  });

  if (recordSamples) {
    try { appendQuotaSamplesFromAccounts(data.accounts, { home, nowMs }); } catch { /* history is best-effort */ }
  }
  if (!includeForecasts) return data;
  try {
    return { ...data, forecasts: computeQuotaForecastsForAccounts(data.accounts, readQuotaSamples({ home }), { nowMs }) };
  } catch {
    return { ...data, forecasts: [] };
  }
}

module.exports = {
  handleLimitAccountsRequest,
};
