"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildUsageAttributionResponse,
} = require("../src/lib/usage-attribution-handler");

describe("usage-attribution-handler", () => {
  it("maps queue rows and returns grouped attribution", () => {
    const response = buildUsageAttributionResponse({
      rows: [
        {
          hour_start: "2026-07-26T00:00:00.000Z",
          source: "claude",
          model: "claude-opus-4-6",
          total_tokens: 100,
          input_tokens: 60,
          output_tokens: 40,
          cached_input_tokens: 0,
          cache_creation_input_tokens: 0,
          reasoning_output_tokens: 0,
          conversation_count: 1,
          dimensions: {
            device_id: "device-a",
            environment_id: "native:host-a",
            environment_kind: "native",
            agent_id: "claude",
            account_scope: null,
            project_key: null,
            session_key: null,
            model_id: "claude-opus-4-6",
          },
        },
        {
          hour_start: "2026-07-26T00:00:00.000Z",
          source: "codex",
          model: "gpt-5",
          total_tokens: 50,
          input_tokens: 30,
          output_tokens: 20,
          cached_input_tokens: 0,
          cache_creation_input_tokens: 0,
          reasoning_output_tokens: 0,
          conversation_count: 1,
        },
      ],
      groupBy: "agent",
      officialDeltaTokens: 200,
      generatedAt: "2026-07-26T00:00:00.000Z",
    });

    assert.equal(response.schema_version, "token-observability/v2");
    assert.equal(response.attribution.total_tokens, 150);
    assert.equal(response.unattributed.unattributed_tokens, 50);
    assert.equal(response.unattributed.evidence.source_kind, "estimated");
    assert.equal(response.snapshots_count, 2);
  });
});
