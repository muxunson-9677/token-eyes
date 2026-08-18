const { AGENT_ADAPTERS } = require("./agent-adapters");
const { KNOWN_PROVIDER_API_IDS } = require("./provider-api-configs");

const TOKEN_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
  "conversation_count",
];

const GROUP_FIELDS = {
  device: "device_id",
  environment: "environment_id",
  agent: "agent_id",
  project: "project_key",
  model: "model_id",
};

const BILLING_MODES = new Set(["api_key", "token_plan", "unknown"]);

const BILLING_MODE_CONFIDENCES = new Set([
  "explicit_runtime",
  "provider_receipt",
  "user_override",
  "unavailable",
]);

const EVIDENCE_REF_FIELDS = [
  "provider_id",
  "account_ref",
  "plan_ref",
  "credential_ref",
];

function emptyTotals() {
  return Object.fromEntries(TOKEN_FIELDS.map((field) => [field, 0]));
}

function attributeUsage(snapshots, { groupBy, filter = {} } = {}) {
  const field = GROUP_FIELDS[groupBy];
  if (!field) throw new TypeError(`Unsupported groupBy: ${String(groupBy)}`);

  const totals = emptyTotals();
  const groups = new Map();
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const dimensions = snapshot?.dimensions || {};
    if (!matchesFilter(dimensions, filter)) continue;
    const key = dimensions[field] || "unknown";
    if (!groups.has(key)) groups.set(key, { key, tokens: emptyTotals() });
    const group = groups.get(key);
    for (const tokenField of TOKEN_FIELDS) {
      const value = toNonNegativeInt(snapshot?.tokens?.[tokenField]);
      totals[tokenField] += value;
      group.tokens[tokenField] += value;
    }
  }

  return {
    schema_version: "token-observability/v2",
    group_by: groupBy,
    filter,
    groups: [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)),
    total_tokens: totals.total_tokens,
    tokens: totals,
  };
}

function matchesFilter(dimensions, filter) {
  return Object.entries(filter).every(([field, value]) =>
    value == null || value === "" || dimensions[field] === value,
  );
}

function toNonNegativeInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizeBillingMode(value) {
  return typeof value === "string" && BILLING_MODES.has(value) ? value : null;
}

function normalizeEndpointOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

const CREDENTIAL_STORE_REFS = new Set([
  "codex_auth_json",
  "claude_credentials_json",
]);

const KNOWN_ATTRIBUTION_PROVIDER_IDS = new Set(
  AGENT_ADAPTERS.flatMap(({ id, queueSource, family }) => [id, queueSource, family])
    .filter((value) => value && value !== "unknown"),
);

for (const providerId of KNOWN_PROVIDER_API_IDS) {
  KNOWN_ATTRIBUTION_PROVIDER_IDS.add(providerId);
}

function isAllowedEvidenceReference(field, value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (field === "provider_id") {
    return KNOWN_ATTRIBUTION_PROVIDER_IDS.has(trimmed);
  }
  if (field === "credential_ref" && CREDENTIAL_STORE_REFS.has(trimmed)) return true;
  return /^(provider-api|token-plan|account|plan)(\/[a-z0-9][a-z0-9._-]{0,127}){1,4}$/i.test(trimmed);
}

function normalizeUsageAttribution(input) {
  const evidence = input && typeof input === "object" ? input : {};
  const rawMode = evidence.billing_mode ?? evidence.billingMode ?? null;
  const normalizedMode = normalizeBillingMode(rawMode) || "unknown";
  const requestedConfidence = String(evidence.billing_mode_confidence || "").trim();
  const hasTrustedMode = normalizedMode === "api_key" || normalizedMode === "token_plan";
  const result = {
    billing_mode: normalizedMode,
    billing_mode_confidence:
      hasTrustedMode && BILLING_MODE_CONFIDENCES.has(requestedConfidence)
        ? requestedConfidence
        : hasTrustedMode
          ? "explicit_runtime"
          : "unavailable",
  };

  for (const field of EVIDENCE_REF_FIELDS) {
    const value = evidence[field];
    if (isAllowedEvidenceReference(field, value)) result[field] = value.trim();
  }

  if (
    Object.prototype.hasOwnProperty.call(evidence, "endpoint_origin") ||
    Object.prototype.hasOwnProperty.call(evidence, "endpoint")
  ) {
    result.endpoint_origin = normalizeEndpointOrigin(
      evidence.endpoint_origin ?? evidence.endpoint,
    );
  }

  return result;
}

function queueUsageIdentity(row, { dimensionsKey } = {}) {
  const record = row && typeof row === "object" ? row : {};
  const parts = [record.source || "", record.model || "", record.hour_start || ""];
  if (dimensionsKey != null) parts.push(dimensionsKey);
  parts.push(normalizeUsageAttribution(record).billing_mode);
  return parts.join("|");
}

function accumulateBillingModeAttribution(targets, row, evaluate = normalizeUsageAttribution) {
  const attribution = evaluate(row);
  const mode = attribution.billing_mode === "api_key" || attribution.billing_mode === "token_plan"
    ? attribution.billing_mode
    : "unknown";
  const confidence = attribution.billing_mode_confidence || "unavailable";
  const tokens = Math.max(0, Number(row?.total_tokens || 0));
  for (const target of Array.isArray(targets) ? targets : []) {
    if (!target?.tokenTotals) continue;
    target.tokenTotals[mode] += tokens;
    if (target.confidences && !target.confidences[mode]) {
      target.confidences[mode] = confidence;
    }
  }
  return { mode, confidence };
}

module.exports = {
  accumulateBillingModeAttribution,
  attributeUsage,
  normalizeBillingMode,
  normalizeEndpointOrigin,
  normalizeUsageAttribution,
  queueUsageIdentity,
};
