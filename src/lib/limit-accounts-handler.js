"use strict";

// Independent O2 handler for the multi-account limit matrix. local-api.js
// only mounts this route; business logic stays here so O6/O8 can rewire
// without rewriting account hashing / adapter orchestration.

const { getLimitAccounts, resetLimitAccountsCache } = require("./limit-accounts");
const { getDefaultAdapters } = require("./limit-account-adapters");

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
} = {}) {
  if (refresh) {
    resetLimitAccountsCache();
  }

  return getLimitAccounts({
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
}

module.exports = {
  handleLimitAccountsRequest,
};
