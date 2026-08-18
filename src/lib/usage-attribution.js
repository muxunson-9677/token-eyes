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

const BILLING_MODE_ALIASES = new Map([
  ["api_key", "api_key"],
  ["api-key", "api_key"],
  ["api key", "api_key"],
  ["payg", "api_key"],
  ["pay_as_you_go", "api_key"],
  ["pay-as-you-go", "api_key"],
  ["token_plan", "token_plan"],
  ["token-plan", "token_plan"],
  ["token plan", "token_plan"],
  ["subscription", "token_plan"],
  ["plan", "token_plan"],
  ["unknown", "unknown"],
  ["mixed", "unknown"],
]);

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
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  return BILLING_MODE_ALIASES.get(raw) || null;
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
    if (typeof value === "string" && value.trim()) result[field] = value.trim();
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

module.exports = {
  attributeUsage,
  normalizeBillingMode,
  normalizeEndpointOrigin,
  normalizeUsageAttribution,
};
