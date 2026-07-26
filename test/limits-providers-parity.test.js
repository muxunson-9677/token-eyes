"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  PROVIDER_CAPABILITY_KEYS,
  PROVIDER_CAPABILITIES,
  listProviderIdsByCapability,
  validateProviderCapabilityManifest,
} = require("../src/lib/provider-capabilities");
const { PROVIDER_API_PRESET_IDS } = require("../src/lib/provider-api-configs");
const { listCatalogProviderIds } = require("../src/lib/token-plan-catalog");

const repoRoot = path.join(__dirname, "..");
const swiftPath = path.join(
  repoRoot,
  "TokenTrackerBar",
  "TokenTrackerBar",
  "Models",
  "LimitsSettingsStore.swift",
);

test("provider capability manifest is complete and has unique stable ids", () => {
  assert.ok(PROVIDER_CAPABILITIES.length > 0);
  assert.equal(new Set(PROVIDER_CAPABILITIES.map((provider) => provider.id)).size, PROVIDER_CAPABILITIES.length);
  for (const provider of PROVIDER_CAPABILITIES) {
    assert.match(provider.id, /^[a-z0-9_-]+$/);
    assert.ok(provider.display_name);
    for (const key of PROVIDER_CAPABILITY_KEYS) {
      assert.equal(typeof provider[key], "boolean", `${provider.id}.${key} must be boolean`);
    }
  }
});

test("provider manifest validator rejects metadata drift and duplicate ordering", () => {
  const clone = () => JSON.parse(JSON.stringify({
    schema_version: 1,
    capability_keys: PROVIDER_CAPABILITY_KEYS,
    providers: PROVIDER_CAPABILITIES,
  }));

  const invalidNative = clone();
  invalidNative.providers.find((provider) => provider.id === "claude").native_session_bridge = "yes";
  assert.throws(() => validateProviderCapabilityManifest(invalidNative), /native_session_bridge must be boolean/);

  const invalidAgentOrder = clone();
  invalidAgentOrder.providers.find((provider) => provider.id === "codex").agent_order = 0;
  assert.throws(() => validateProviderCapabilityManifest(invalidAgentOrder), /unique non-negative agent_order/);

  const invalidCatalogOrder = clone();
  invalidCatalogOrder.providers.find((provider) => provider.id === "glm").catalog_order = 0;
  assert.throws(() => validateProviderCapabilityManifest(invalidCatalogOrder), /unique non-negative catalog_order/);
});
test("manual plans, balance presets and Dashboard agents stay bound to the manifest", () => {
  const catalogIds = PROVIDER_CAPABILITIES
    .filter((provider) => provider.catalog_token_plan)
    .sort((a, b) => a.catalog_order - b.catalog_order)
    .map((provider) => provider.id);
  assert.deepEqual(listCatalogProviderIds(), catalogIds);
  assert.deepEqual(
    [...PROVIDER_API_PRESET_IDS].sort(),
    listProviderIdsByCapability("provider_balance").sort(),
  );

  const dashboardAgents = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "agent-adapters-dashboard.ts"),
    "utf8",
  );
  assert.match(dashboardAgents, /provider-capabilities\.json/);
  assert.doesNotMatch(dashboardAgents, /KEEP IN SYNC/);
  assert.doesNotMatch(dashboardAgents, /\{ id: "claude"/);
});

test("Dashboard and macOS desktop provider constants are generated from the manifest", () => {
  const dashboardSource = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "limits-providers.js"),
    "utf8",
  );
  assert.match(dashboardSource, /provider-capabilities\.json/);
  assert.doesNotMatch(dashboardSource, /export const LIMIT_PROVIDER_IDS = \[/);

  const check = spawnSync(process.execPath, ["scripts/generate-provider-capabilities.cjs", "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);

  const swiftSource = fs.readFileSync(swiftPath, "utf8");
  const crlfCount = (swiftSource.match(/\r\n/g) || []).length;
  const loneLfCount = (swiftSource.match(/(?<!\r)\n/g) || []).length;
  assert.ok(crlfCount === 0 || loneLfCount === 0, "Swift source must use one EOL style");
  const ids = listProviderIdsByCapability("desktop_visibility");
  for (const id of ids) {
    assert.ok(swiftSource.includes(`"${id}"`), `Swift generated list is missing ${id}`);
  }
});

test("Trae is visible for locally collected usage without a fake official quota", () => {
  const trae = PROVIDER_CAPABILITIES.find((provider) => provider.id === "trae");
  assert.deepEqual(
    {
      token_usage_collection: trae.token_usage_collection,
      official_rate_limit: trae.official_rate_limit,
      manual_token_plan: trae.manual_token_plan,
      provider_balance: trae.provider_balance,
      desktop_visibility: trae.desktop_visibility,
    },
    {
      token_usage_collection: true,
      official_rate_limit: false,
      manual_token_plan: true,
      provider_balance: false,
      desktop_visibility: true,
    },
  );
});