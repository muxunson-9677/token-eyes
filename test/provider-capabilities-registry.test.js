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

test("authorization operations match the Tauri commands exposed by src-tauri/src/lib.rs", () => {
  const registryPath = path.join(__dirname, "..", "shared", "provider-capabilities.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const tauriLib = fs.readFileSync(
    path.join(__dirname, "..", "src-tauri", "src", "lib.rs"),
    "utf8",
  );
  const agentRegistry = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "shared", "agent-registry.json"),
    "utf8",
  ));
  const providers = new Map(registry.providers.map((provider) => [provider.id, provider]));
  const authorization = registry.authorization;
  const operationKeys = ["start", "reopen", "verify", "sync", "cancel", "delete"];
  const noOperations = Object.fromEntries(operationKeys.map((key) => [key, false]));
  const resolveAuthorization = (id) => authorization.providers[id] || authorization.default;
  const sourceOperations = new Map();
  const commandPattern = /\b([a-z0-9_]+)_session::(open|reopen|verify|sync|refresh|cancel|delete)_([a-z0-9_]+)_console_(login|session|quota),/gu;

  for (const match of tauriLib.matchAll(commandPattern)) {
    const [, moduleProvider, command, commandProvider] = match;
    assert.equal(commandProvider, moduleProvider, `${match[0]} must stay within one provider module`);
    const operation = command === "open" ? "start" : command === "refresh" ? "sync" : command;
    const current = sourceOperations.get(moduleProvider) || { ...noOperations };
    current[operation] = true;
    sourceOperations.set(moduleProvider, current);
  }

  assert.equal(authorization.contract_version, 2);
  assert.deepEqual(authorization.operation_keys, operationKeys);
  assert.equal(authorization.default.mode, "no_official_auth");
  assert.deepEqual(authorization.default.operations, noOperations);
  assert.ok(sourceOperations.size > 0, "src-tauri/src/lib.rs must expose native session commands");

  const nativeProviders = Object.entries(authorization.providers)
    .filter(([, state]) => state.mode === "native_session_commands")
    .map(([id]) => id)
    .sort();
  assert.deepEqual(nativeProviders, [...sourceOperations.keys()].sort());

  for (const [id, expectedOperations] of sourceOperations) {
    const state = resolveAuthorization(id);
    assert.equal(state.mode, "native_session_commands", `${id} must use source-backed native commands`);
    assert.deepEqual(state.operations, expectedOperations, `${id} operation matrix must match lib.rs`);
    assert.equal(providers.get(id)?.native_session_bridge, true, `${id} exposes native session commands`);
  }

  for (const adapter of agentRegistry.adapters) {
    const provider = providers.get(adapter.id);
    assert.ok(provider, `${adapter.id} must declare authorization capability`);
    const state = resolveAuthorization(adapter.id);
    assert.ok(state, `${adapter.id} must declare authorization state`);
    if (!sourceOperations.has(adapter.id) && adapter.id !== "workbuddy") {
      assert.equal(state.mode, "no_official_auth", `${adapter.id} has no Tauri authorization commands`);
      assert.deepEqual(state.operations, noOperations, `${adapter.id} must not invent authorization operations`);
    }
  }

  assert.equal(resolveAuthorization("workbuddy").mode, "read_only_credits");
  assert.deepEqual(resolveAuthorization("workbuddy").operations, noOperations);
  assert.equal(resolveAuthorization("codebuddy").mode, "no_official_auth");
  assert.deepEqual(resolveAuthorization("codebuddy").operations, noOperations);
});
