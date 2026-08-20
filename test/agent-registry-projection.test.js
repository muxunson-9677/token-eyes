"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const canonicalPath = path.join(repoRoot, "shared", "agent-registry.json");
const dashboardProjectionPath = path.join(
  repoRoot,
  "dashboard",
  "src",
  "lib",
  "agent-adapters-dashboard.ts",
);
const generatorPath = path.join(repoRoot, "scripts", "generate-agent-dashboard-registry.cjs");

function readCanonicalRegistry() {
  return JSON.parse(fs.readFileSync(canonicalPath, "utf8"));
}

test("canonical agent registry owns exactly 28 adapters and 27 usage identities", () => {
  const registry = readCanonicalRegistry();
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.adapters.length, 28);
  assert.equal(new Set(registry.adapters.map((adapter) => adapter.id)).size, 28);
  assert.equal(new Set(registry.adapters.map((adapter) => adapter.usage_identity)).size, 27);

  const requiredFields = [
    "id",
    "display_name",
    "usage_identity",
    "queue_source",
    "family",
    "collection_mode",
    "parser_export",
    "resolver_exports",
    "status_surface",
    "diagnostics_surface",
    "usage_limits_surface",
    "path_override_key",
    "account_level",
  ];
  for (const adapter of registry.adapters) {
    for (const field of requiredFields) {
      assert.ok(Object.prototype.hasOwnProperty.call(adapter, field), `${adapter.id} missing ${field}`);
    }
    assert.ok(Array.isArray(adapter.resolver_exports), `${adapter.id} resolver_exports must be an array`);
  }

  const duplicateIdentities = registry.adapters
    .map((adapter) => adapter.usage_identity)
    .filter((identity, index, all) => all.indexOf(identity) !== index);
  assert.deepEqual(duplicateIdentities, ["kiro"]);

  const kiro = registry.adapters.find((adapter) => adapter.id === "kiro");
  const kiroCli = registry.adapters.find((adapter) => adapter.id === "kiro-cli");
  for (const adapter of [kiro, kiroCli]) {
    assert.ok(adapter);
    assert.equal(adapter.usage_identity, "kiro");
    assert.equal(adapter.queue_source, "kiro");
  }
});

test("Node agent adapter runtime is an exact camelCase projection of the canonical registry", () => {
  const registry = readCanonicalRegistry();
  const runtime = require("../src/lib/agent-adapters");
  assert.deepEqual(
    runtime.AGENT_ADAPTERS,
    registry.adapters.map((adapter) => ({
      id: adapter.id,
      displayName: adapter.display_name,
      usageIdentity: adapter.usage_identity,
      queueSource: adapter.queue_source,
      family: adapter.family,
      collectionMode: adapter.collection_mode,
      parserExport: adapter.parser_export,
      resolverExports: adapter.resolver_exports,
      statusSurface: adapter.status_surface,
      diagnosticsSurface: adapter.diagnostics_surface,
      usageLimitsSurface: adapter.usage_limits_surface,
      pathOverrideKey: adapter.path_override_key,
      accountLevel: adapter.account_level,
      ...(adapter.notes ? { notes: adapter.notes } : {}),
    })),
  );
  assert.equal(runtime.listAgentUsageIdentities().length, 27);
});

test("Dashboard agent registry is a deterministic byte-for-byte canonical projection", () => {
  assert.ok(fs.existsSync(generatorPath), "dashboard registry generator must exist");
  const { projectDashboardAgents, renderDashboardRegistry } = require(generatorPath);
  const projectedAgents = projectDashboardAgents(readCanonicalRegistry());
  assert.equal(projectedAgents.length, 27);
  assert.deepEqual(
    projectedAgents.filter((agent) => agent.usageIdentity === "kiro"),
    [{ id: "kiro", displayName: "Kiro（含 CLI）", usageIdentity: "kiro", queueSource: "kiro" }],
  );
  const first = Buffer.from(renderDashboardRegistry(readCanonicalRegistry()), "utf8");
  const second = Buffer.from(renderDashboardRegistry(readCanonicalRegistry()), "utf8");
  assert.deepEqual(first, second, "generator output must be deterministic");
  assert.deepEqual(first, fs.readFileSync(dashboardProjectionPath));
});

test("agents:check verifies the generated Dashboard projection without rewriting it", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts?.["agents:check"],
    "node scripts/generate-agent-dashboard-registry.cjs --check",
  );
  assert.ok(packageJson.files.includes("shared/"), "npm runtime must include shared registries");

  const before = fs.readFileSync(dashboardProjectionPath);
  const cleanCheck = spawnSync(process.execPath, [generatorPath, "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(cleanCheck.status, 0, cleanCheck.stderr || cleanCheck.stdout);
  assert.deepEqual(fs.readFileSync(dashboardProjectionPath), before);

  const targetRoot = path.join(repoRoot, "src-tauri", "target");
  fs.mkdirSync(targetRoot, { recursive: true });
  const isolatedDir = fs.mkdtempSync(path.join(targetRoot, "agent-registry-check-test-"));
  const driftTarget = path.join(isolatedDir, "agent-adapters-dashboard.ts");
  fs.writeFileSync(driftTarget, "drift\n", "utf8");
  try {
    const driftCheck = spawnSync(
      process.execPath,
      [generatorPath, "--check", "--target", driftTarget],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.notEqual(driftCheck.status, 0, "drifted target must fail agents:check");
    assert.equal(fs.readFileSync(driftTarget, "utf8"), "drift\n", "check mode must not rewrite target");
  } finally {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }
});

test("provider capability registry does not duplicate canonical agent identity fields", () => {
  const canonicalIds = new Set(readCanonicalRegistry().adapters.map((adapter) => adapter.id));
  const capabilityRegistry = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "shared", "provider-capabilities.json"), "utf8"),
  );
  const capabilityIds = capabilityRegistry.providers.map((provider) => provider.id);
  assert.equal(new Set(capabilityIds).size, capabilityIds.length, "capability ids must be unique");
  for (const id of canonicalIds) {
    assert.ok(capabilityIds.includes(id), `${id} must join provider capabilities by id`);
  }
  for (const provider of capabilityRegistry.providers) {
    assert.equal("agent_display_name" in provider, false, `${provider.id} duplicates agent_display_name`);
    assert.equal("queue_source" in provider, false, `${provider.id} duplicates queue_source`);
    assert.equal("agent_order" in provider, false, `${provider.id} duplicates agent_order`);
  }
});

test("Windows runtime bundler explicitly preflights the canonical agent registry", () => {
  const script = fs.readFileSync(
    path.join(repoRoot, "src-tauri", "scripts", "bundle-runtime.ps1"),
    "utf8",
  );
  assert.match(script, /shared\\agent-registry\.json/);
  assert.match(script, /Test-Path \$agentRegistry/);
});
