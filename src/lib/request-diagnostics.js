"use strict";

const { normalizeDataEvidence } = require("./data-evidence");

const SOURCE_REQUEST_CAPABILITIES = Object.freeze({
  codex: { request_records: "measured", status: "measured", latency: "measured", first_token: "measured" },
  copilot: { request_records: "measured", status: "partial", latency: "partial", first_token: "unavailable" },
  claude: { request_records: "aggregate_only", status: "unavailable", latency: "unavailable", first_token: "unavailable" },
  cursor: { request_records: "aggregate_only", status: "unavailable", latency: "unavailable", first_token: "unavailable" },
});
const DEFAULT_CAPABILITY = Object.freeze({ request_records: "unavailable", status: "unavailable", latency: "unavailable", first_token: "unavailable" });
const TOKEN_FIELDS = ["input_tokens", "output_tokens", "cached_input_tokens", "cache_creation_input_tokens", "reasoning_output_tokens"];

function nonNegativeInt(value) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : 0; }
function text(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function getSourceRequestCapability(source) { return SOURCE_REQUEST_CAPABILITIES[String(source || "").toLowerCase()] || DEFAULT_CAPABILITY; }
function safeErrorCode(status) { const code = Number(status); if (code === 401 || code === 403) return "http_auth_error"; if (code === 429) return "http_rate_limited"; if (code >= 500 && code <= 599) return "http_server_error"; if (code >= 400 && code <= 499) return "http_client_error"; return null; }

function mapToRequestDiagnosticV2(row = {}, { observedAt = new Date().toISOString() } = {}) {
  const source = String(row.source || "unknown").toLowerCase();
  const recordKind = row.record_kind === "request_event" ? "request_event" : "aggregate_bucket";
  const status = Number.isInteger(Number(row.status)) && Number(row.status) >= 100 && Number(row.status) <= 599 ? Number(row.status) : null;
  const tokens = Object.fromEntries(TOKEN_FIELDS.map((field) => [field, nonNegativeInt(row[field])]));
  const unpriced = nonNegativeInt(row.unpriced_tokens);
  const totalCost = Number(row.cost_usd);
  const errorCode = safeErrorCode(status) || (text(row.error_message) ? "request_failed" : null);
  const dimensions = row.dimensions && typeof row.dimensions === "object" ? row.dimensions : {};
  const diagnostic = {
    request_id: text(row.request_id) || text(row.id) || `${source}:${text(row.timestamp) || "unknown"}`,
    timestamp: text(row.timestamp) || new Date(0).toISOString(),
    dimensions: {
      device_id: text(dimensions.device_id) || "unknown", environment_id: text(dimensions.environment_id) || "unknown",
      environment_kind: ["native", "wsl", "ssh", "container"].includes(dimensions.environment_kind) ? dimensions.environment_kind : "unknown",
      agent_id: text(dimensions.agent_id)?.toLowerCase() || source, account_scope: null, project_key: null,
      session_key: recordKind === "request_event" ? text(dimensions.session_key) || text(row.session_key) : null,
      model_id: text(dimensions.model_id) || text(row.model),
    },
    requested_model: text(row.requested_model) || text(row.model), response_model: recordKind === "request_event" ? text(row.response_model) || text(row.model) : null,
    pricing_model: text(row.pricing_model) || text(row.model), ...tokens,
    success: recordKind === "request_event" && status != null ? status >= 200 && status < 300 : null,
    status_code: recordKind === "request_event" ? status : null,
    latency_ms: recordKind === "request_event" ? nonNullableInt(row.latency_ms) : null,
    first_token_ms: recordKind === "request_event" ? nonNullableInt(row.first_token_ms) : null,
    total_cost_usd: unpriced > 0 || !Number.isFinite(totalCost) ? null : String(totalCost), unpriced_tokens: unpriced,
    evidence: normalizeDataEvidence({ source_kind: "session_log", accuracy: recordKind === "request_event" ? "exact" : "normalized", coverage: unpriced > 0 ? "unpriced" : recordKind === "request_event" ? "complete" : "partial", observed_at: observedAt, source_updated_at: text(row.timestamp), stale_after_seconds: 300, pricing_source: null, pricing_version: null, note_code: errorCode || (recordKind === "request_event" ? null : "aggregate_only_source") }),
  };
  return diagnostic;
}
function nonNullableInt(value) { return value == null ? null : nonNegativeInt(value); }

function buildRequestDiagnosticsResponse({ rows = [], filter = {}, page = 1, pageSize = 50, observedAt } = {}) {
  const seen = new Set();
  const mapped = rows.map((row) => mapToRequestDiagnosticV2(row, { observedAt })).filter((item) => !seen.has(item.request_id) && seen.add(item.request_id));
  const filtered = mapped.filter((item) => (!filter.source || item.dimensions.agent_id === filter.source) && (!filter.model || item.pricing_model === filter.model));
  const size = Math.min(200, Math.max(1, Number(pageSize) || 50)); const pageNumber = Math.max(1, Number(page) || 1);
  const diagnostics = filtered.slice((pageNumber - 1) * size, pageNumber * size);
  return { schema_version: "token-observability/v2", filter, diagnostics, page: { page: pageNumber, limit: size, returned_count: diagnostics.length, total_count: filtered.length }, source_capabilities: Object.fromEntries([...new Set(filtered.map((item) => item.dimensions.agent_id))].map((source) => [source, getSourceRequestCapability(source)])) };
}
module.exports = { SOURCE_REQUEST_CAPABILITIES, getSourceRequestCapability, mapToRequestDiagnosticV2, buildRequestDiagnosticsResponse };
