"use strict";

const registry = require("../../shared/agent-registry.json");

if (registry?.schema_version !== 1 || !Array.isArray(registry.adapters)) {
  throw new Error("Invalid shared/agent-registry.json");
}

function projectAdapter(entry) {
  return {
    id: entry.id,
    displayName: entry.display_name,
    usageIdentity: entry.usage_identity,
    queueSource: entry.queue_source,
    family: entry.family,
    collectionMode: entry.collection_mode,
    parserExport: entry.parser_export,
    resolverExports: [...entry.resolver_exports],
    statusSurface: entry.status_surface,
    diagnosticsSurface: entry.diagnostics_surface,
    usageLimitsSurface: entry.usage_limits_surface,
    pathOverrideKey: entry.path_override_key,
    accountLevel: entry.account_level,
    ...(entry.notes ? { notes: entry.notes } : {}),
  };
}

const AGENT_ADAPTERS = registry.adapters.map(projectAdapter);

function normalizeAdapterId(id) {
  return String(id || "").trim().toLowerCase();
}

function listAgentAdapters() {
  return AGENT_ADAPTERS.map((entry) => ({
    ...entry,
    resolverExports: [...entry.resolverExports],
  }));
}

function getAgentAdapter(id) {
  const normalized = normalizeAdapterId(id);
  return AGENT_ADAPTERS.find((entry) => entry.id === normalized) || null;
}

function listAgentUsageIdentities() {
  const identities = new Map();
  for (const adapter of AGENT_ADAPTERS) {
    if (identities.has(adapter.usageIdentity)) continue;
    identities.set(adapter.usageIdentity, {
      id: adapter.usageIdentity,
      displayName: adapter.displayName,
      usageIdentity: adapter.usageIdentity,
      queueSource: adapter.queueSource,
    });
  }
  return Array.from(identities.values(), (entry) => ({ ...entry }));
}

function listUsageLimitAdapterIds() {
  return AGENT_ADAPTERS
    .filter((entry) => entry.usageLimitsSurface)
    .map((entry) => entry.id);
}

function listDataDirectoryAdapterKeys() {
  return AGENT_ADAPTERS.map((entry) => entry.pathOverrideKey).filter(Boolean);
}

function listAccountLevelSources() {
  return AGENT_ADAPTERS
    .filter((entry) => entry.accountLevel)
    .map((entry) => entry.queueSource);
}

module.exports = {
  AGENT_ADAPTERS,
  getAgentAdapter,
  listAgentAdapters,
  listAgentUsageIdentities,
  listUsageLimitAdapterIds,
  listDataDirectoryAdapterKeys,
  listAccountLevelSources,
};
