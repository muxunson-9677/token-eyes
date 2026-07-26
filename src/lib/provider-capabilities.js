"use strict";

const manifest = require("../../shared/provider-capabilities.json");

const EXPECTED_CAPABILITY_KEYS = [
  "token_usage_collection",
  "official_rate_limit",
  "manual_token_plan",
  "provider_balance",
  "desktop_visibility",
];

function validateProviderCapabilityManifest(value) {
  if (value.schema_version !== 1) {
    throw new Error(`Unsupported provider capability schema: ${value.schema_version}`);
  }
  if (JSON.stringify(value.capability_keys) !== JSON.stringify(EXPECTED_CAPABILITY_KEYS)) {
    throw new Error("Provider capability keys do not match the supported schema");
  }
  if (!Array.isArray(value.providers) || value.providers.length === 0) {
    throw new Error("Provider capability manifest requires a non-empty providers array");
  }

  const seenIds = new Set();
  const seenAgentOrders = new Set();
  const seenCatalogOrders = new Set();
  for (const provider of value.providers) {
    if (!/^[a-z0-9_-]+$/.test(provider.id) || seenIds.has(provider.id)) {
      throw new Error(`Invalid or duplicate provider capability id: ${provider.id}`);
    }
    seenIds.add(provider.id);
    if (typeof provider.display_name !== "string" || !provider.display_name.trim()) {
      throw new Error(`Provider ${provider.id} requires a display_name`);
    }
    for (const key of EXPECTED_CAPABILITY_KEYS) {
      if (typeof provider[key] !== "boolean") {
        throw new Error(`Provider capability ${provider.id}.${key} must be boolean`);
      }
    }
    for (const key of ["native_session_bridge", "catalog_token_plan"]) {
      if (typeof provider[key] !== "boolean") {
        throw new Error(`Provider metadata ${provider.id}.${key} must be boolean`);
      }
    }

    if (provider.token_usage_collection) {
      if (typeof provider.agent_display_name !== "string" || !provider.agent_display_name.trim()
        || typeof provider.queue_source !== "string" || !provider.queue_source.trim()) {
        throw new Error(`Collected provider ${provider.id} requires agent display and queue metadata`);
      }
      if (!Number.isInteger(provider.agent_order) || provider.agent_order < 0
        || seenAgentOrders.has(provider.agent_order)) {
        throw new Error(`Collected provider ${provider.id} requires a unique non-negative agent_order`);
      }
      seenAgentOrders.add(provider.agent_order);
    } else if (provider.agent_display_name !== null || provider.queue_source !== null || provider.agent_order !== null) {
      throw new Error(`Uncollected provider ${provider.id} must not define agent metadata`);
    }

    if (provider.native_session_bridge && !provider.official_rate_limit) {
      throw new Error(`Native session provider ${provider.id} must support official rate limits`);
    }
    if (provider.catalog_token_plan) {
      if (!provider.manual_token_plan || !provider.official_rate_limit) {
        throw new Error(`Catalog provider ${provider.id} has inconsistent capabilities`);
      }
      if (!Number.isInteger(provider.catalog_order) || provider.catalog_order < 0
        || seenCatalogOrders.has(provider.catalog_order)) {
        throw new Error(`Catalog provider ${provider.id} requires a unique non-negative catalog_order`);
      }
      seenCatalogOrders.add(provider.catalog_order);
    } else if (provider.catalog_order !== null) {
      throw new Error(`Non-catalog provider ${provider.id} must use a null catalog_order`);
    }
  }
  return value.providers;
}

const validatedProviders = validateProviderCapabilityManifest(manifest);
const PROVIDER_CAPABILITY_KEYS = Object.freeze([...EXPECTED_CAPABILITY_KEYS]);
const PROVIDER_CAPABILITIES = Object.freeze(
  validatedProviders.map((provider) => Object.freeze({ ...provider })),
);

function listProviderIdsByCapability(capability) {
  if (!PROVIDER_CAPABILITY_KEYS.includes(capability)) {
    throw new TypeError(`Unknown provider capability: ${capability}`);
  }
  return PROVIDER_CAPABILITIES
    .filter((provider) => provider[capability])
    .map((provider) => provider.id);
}

function getProviderRecord(id) {
  const normalized = String(id || "").trim().toLowerCase();
  return PROVIDER_CAPABILITIES.find((entry) => entry.id === normalized) || null;
}

function getProviderCapabilities(id) {
  const provider = getProviderRecord(id);
  if (!provider) return null;
  return Object.fromEntries(
    PROVIDER_CAPABILITY_KEYS.map((key) => [key, provider[key]]),
  );
}

function providerHasCapability(id, capability) {
  if (!PROVIDER_CAPABILITY_KEYS.includes(capability)) {
    throw new TypeError(`Unknown provider capability: ${capability}`);
  }
  return getProviderRecord(id)?.[capability] === true;
}

module.exports = {
  PROVIDER_CAPABILITY_KEYS,
  PROVIDER_CAPABILITIES,
  listProviderIdsByCapability,
  getProviderCapabilities,
  getProviderRecord,
  providerHasCapability,
  validateProviderCapabilityManifest,
};