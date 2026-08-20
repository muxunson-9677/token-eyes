const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("provider capabilities join canonical agent identity by id without duplicating it", () => {
  const registryPath = path.join(__dirname, "..", "shared", "provider-capabilities.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const agentRegistry = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "shared", "agent-registry.json"),
    "utf8",
  ));
  const providers = new Map(registry.providers.map((provider) => [provider.id, provider]));
  const agents = new Map(agentRegistry.adapters.map((adapter) => [adapter.id, adapter]));

  assert.equal(registry.schema_version, 1);
  for (const id of ["codex", "cursor", "trae"]) {
    assert.equal(providers.get(id)?.token_usage_collection, true);
    assert.ok(agents.has(id));
    assert.equal("agent_display_name" in providers.get(id), false);
    assert.equal("queue_source" in providers.get(id), false);
    assert.equal("agent_order" in providers.get(id), false);
  }

  assert.equal(providers.get("xiaomi_mimo")?.source_kind, "undocumented_console_api");
  assert.equal(providers.get("xiaomi_mimo")?.support_tier, "best_effort");
  assert.equal(providers.get("zcode")?.source_kind, "undocumented_api");
  assert.equal(providers.get("zcode")?.support_tier, "unsupported");
});
