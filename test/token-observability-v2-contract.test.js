const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildHourlyBucketKey,
  mapLegacyQueueRowToV2,
} = require("../src/lib/token-observability-v2");

const LEGACY_ROW = {
  hour_start: "2026-07-26T00:00:00.000Z",
  source: "codex",
  model: "gpt-5",
  input_tokens: 12,
  cached_input_tokens: 3,
  cache_creation_input_tokens: 2,
  output_tokens: 6,
  reasoning_output_tokens: 4,
  total_tokens: 27,
  conversation_count: 1,
};

const FIXTURES_DIR = path.join(__dirname, "fixtures", "token-observability-v2");
const SCHEMA_PATH = path.join(__dirname, "..", "shared", "schemas", "token-observability-v2.schema.json");

describe("token observability v2 contract", () => {
  it("maps a v1 queue row without changing known token fields", () => {
    const mapped = mapLegacyQueueRowToV2(LEGACY_ROW);

    assert.deepEqual(mapped.tokens, {
      input_tokens: 12,
      cached_input_tokens: 3,
      cache_creation_input_tokens: 2,
      output_tokens: 6,
      reasoning_output_tokens: 4,
      total_tokens: 27,
      conversation_count: 1,
    });
    assert.equal(mapped.dimensions.environment_kind, "unknown");
    assert.equal(mapped.dimensions.session_key, null);
  });

  it("excludes session_key but includes environment_id in an hourly bucket key", () => {
    const first = mapLegacyQueueRowToV2(LEGACY_ROW);
    const second = {
      ...first,
      dimensions: { ...first.dimensions, session_key: "session-b" },
    };
    const anotherEnvironment = {
      ...first,
      dimensions: { ...first.dimensions, environment_id: "wsl:ubuntu" },
    };

    assert.equal(buildHourlyBucketKey(first), buildHourlyBucketKey(second));
    assert.notEqual(buildHourlyBucketKey(first), buildHourlyBucketKey(anotherEnvironment));
  });

  it("keeps the fixture token total stable across the v1 to v2 mapping", () => {
    const legacy = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "legacy-queue-v1.jsonl"), "utf8"));
    const v2 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "usage-snapshot-v2.json"), "utf8"));

    assert.equal(mapLegacyQueueRowToV2(legacy).tokens.total_tokens, legacy.total_tokens);
    assert.equal(v2.tokens.total_tokens, legacy.total_tokens);
    assert.equal(v2.dimensions.environment_kind, "unknown");
  });

  it("publishes the v2 schema with the stable evidence and dimension definitions", () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));

    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.deepEqual(schema.definitions.dataEvidenceV1.properties.coverage.enum, ["complete", "partial", "unavailable", "unpriced"]);
    assert.deepEqual(schema.definitions.usageDimensionsV1.properties.environment_kind.enum, ["native", "wsl", "ssh", "container", "unknown"]);
    assert.ok(schema.definitions.limitAccountV2);
    assert.ok(schema.definitions.requestDiagnosticV2);
  });

  it("records the legacy limits and request diagnostics nullability without inventing values", () => {
    const limits = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "usage-limits-v1.json"), "utf8"));
    const requests = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "request-usage-records-v1.json"), "utf8"));

    assert.equal(limits.claude.error, null);
    assert.equal(requests.records[0].status, null);
    assert.equal(requests.records[0].latency_ms, null);
    assert.equal(requests.records[0].first_token_ms, null);
  });
});
