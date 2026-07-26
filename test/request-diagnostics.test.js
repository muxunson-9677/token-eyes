const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildRequestDiagnosticsResponse, mapToRequestDiagnosticV2 } = require("../src/lib/request-diagnostics");

test("request diagnostics retain measured fields but exclude prompt and message bodies", () => {
  const diagnostic = mapToRequestDiagnosticV2({ request_id: "r1", source: "codex", record_kind: "request_event", timestamp: "2026-07-27T00:00:00.000Z", model: "gpt-5", input_tokens: 10, output_tokens: 5, status: 200, latency_ms: 50, prompt: "secret", messages: [{ content: "secret" }], dimensions: { environment_id: "native", session_key: "s1" } });
  assert.equal(diagnostic.success, true);
  assert.equal(diagnostic.latency_ms, 50);
  assert.equal(JSON.stringify(diagnostic).includes("secret"), false);
});

test("request diagnostics keep aggregate-only sources explicitly unmeasured", () => {
  const response = buildRequestDiagnosticsResponse({ rows: [{ source: "claude", id: "a", timestamp: "2026-07-27T00:00:00.000Z", model: "claude", total_tokens: 50 }] });
  assert.equal(response.diagnostics[0].status_code, null);
  assert.equal(response.source_capabilities.claude.request_records, "aggregate_only");
});
