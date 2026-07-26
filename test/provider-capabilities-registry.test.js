const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("provider capability registry describes collected Codex, Cursor, and Trae sources", () => {
  const registryPath = path.join(__dirname, "..", "shared", "provider-capabilities.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const providers = new Map(registry.providers.map((provider) => [provider.id, provider]));

  assert.equal(registry.schema_version, 1);
  for (const id of ["codex", "cursor", "trae"]) {
    assert.equal(providers.get(id)?.token_usage_collection, true);
    assert.equal(typeof providers.get(id)?.queue_source, "string");
  }
});
