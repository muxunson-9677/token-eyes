const { AGENT_ADAPTERS } = require("./agent-adapters");
const {
  applyKnownProviderPreset,
  KNOWN_PROVIDER_API_IDS,
} = require("./provider-api-configs");

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
  "configured_plan_provider_match",
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

const KNOWN_PROVIDER_ID_BY_PRESET_URL = new Map(
  KNOWN_PROVIDER_API_IDS.map((providerId) => {
    const preset = applyKnownProviderPreset({ providerId });
    return [String(preset?.requestUrl || ""), providerId];
  }).filter(([requestUrl]) => requestUrl),
);

function normalizeAttributionProviderId(value) {
  const providerId = String(value || "").trim().toLowerCase();
  if (!providerId) return "";
  if (KNOWN_ATTRIBUTION_PROVIDER_IDS.has(providerId)) return providerId;

  const candidates = [...new Set([
    providerId,
    providerId.replace(/[/-]+/g, "_"),
  ])];
  for (const candidate of candidates) {
    if (KNOWN_ATTRIBUTION_PROVIDER_IDS.has(candidate)) return candidate;
    const preset = applyKnownProviderPreset({ providerId: candidate });
    const canonicalId = KNOWN_PROVIDER_ID_BY_PRESET_URL.get(String(preset?.requestUrl || ""));
    if (canonicalId) return canonicalId;
  }
  return providerId;
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
    const value = field === "provider_id"
      ? normalizeAttributionProviderId(evidence[field])
      : evidence[field];
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

function normalizeAttributionIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function hasTimestampValue(value) {
  return value !== null
    && value !== undefined
    && (typeof value !== "string" || value.trim() !== "");
}

function firstTimestampValue(...values) {
  return values.find(hasTimestampValue);
}

function dateOnlyTimestamp(text, { endOfDate = false, timeZone = null, offsetMinutes = null } = {}) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return Number.NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = endOfDate ? 23 : 0;
  const minute = endOfDate ? 59 : 0;
  const second = endOfDate ? 59 : 0;
  const millisecond = endOfDate ? 999 : 0;
  const targetSecond = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return Number.NaN;
  }

  if (timeZone && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        calendar: "iso8601",
        numberingSystem: "latn",
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      let candidate = targetSecond;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const parts = Object.fromEntries(
          formatter.formatToParts(new Date(candidate))
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value]),
        );
        const displayed = Date.UTC(
          Number(parts.year),
          Number(parts.month) - 1,
          Number(parts.day),
          Number(parts.hour),
          Number(parts.minute),
          Number(parts.second),
          0,
        );
        if (!Number.isFinite(displayed)) break;
        const correction = targetSecond - displayed;
        candidate += correction;
        if (correction === 0) return candidate + millisecond;
      }
    } catch (_error) {
      // Invalid or unsupported IANA zones fall back to the explicit offset.
    }
  }

  if (Number.isFinite(Number(offsetMinutes))) {
    return targetSecond - Number(offsetMinutes) * 60_000 + millisecond;
  }
  return targetSecond + millisecond;
}

function parseAttributionTimestamp(value, {
  endOfDate = false,
  timeZone = null,
  offsetMinutes = null,
} = {}) {
  if (!hasTimestampValue(value)) return null;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.NaN;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return Number.NaN;
    return Math.abs(value) < 1e12 ? value * 1000 : value;
  }

  const text = String(value).trim();
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    const timestamp = Number(text);
    if (!Number.isFinite(timestamp)) return Number.NaN;
    return Math.abs(timestamp) < 1e12 ? timestamp * 1000 : timestamp;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return dateOnlyTimestamp(text, { endOfDate, timeZone, offsetMinutes });
  }
  const dateTime = text;
  const timestamp = Date.parse(dateTime);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function createConfiguredTokenPlanResolver(configuredPlans, timeZoneContext = {}) {
  const configuredOffsetMinutes = timeZoneContext?.offsetMinutes;
  const timestampContext = {
    timeZone: typeof timeZoneContext?.timeZone === "string" ? timeZoneContext.timeZone : null,
    offsetMinutes: configuredOffsetMinutes !== null
      && configuredOffsetMinutes !== undefined
      && configuredOffsetMinutes !== ""
      && Number.isFinite(Number(configuredOffsetMinutes))
      ? Number(configuredOffsetMinutes)
      : null,
  };
  const plansByIdentity = new Map();
  for (const plan of Array.isArray(configuredPlans) ? configuredPlans : []) {
    const source = normalizeAttributionIdentity(plan?.source);
    const providerId = normalizeAttributionProviderId(plan?.provider_id);
    if (!source || !providerId) continue;
    const key = `${source}\u0000${providerId}`;
    const matches = plansByIdentity.get(key) || [];
    const startedAt = parseAttributionTimestamp(
      firstTimestampValue(plan?.started_at, plan?.subscription_start_date),
      timestampContext,
    );
    const expiresAt = parseAttributionTimestamp(
      firstTimestampValue(plan?.subscription_end_date, plan?.expires_at),
      { ...timestampContext, endOfDate: true },
    );
    matches.push({
      plan_ref: isAllowedEvidenceReference("plan_ref", plan?.plan_ref)
        ? plan.plan_ref.trim()
        : null,
      started_at: startedAt,
      expires_at: expiresAt,
      window_valid: !Number.isNaN(startedAt)
        && !Number.isNaN(expiresAt)
        && (startedAt === null || expiresAt === null || startedAt <= expiresAt),
    });
    plansByIdentity.set(key, matches);
  }

  return function resolveConfiguredTokenPlan(input) {
    const evidence = input && typeof input === "object" ? input : {};
    const attribution = normalizeUsageAttribution(evidence);
    const confidence = attribution.billing_mode_confidence;
    const hasTrustedMode = attribution.billing_mode === "api_key"
      || attribution.billing_mode === "token_plan";
    if (hasTrustedMode && (confidence === "explicit_runtime" || confidence === "user_override")) {
      return attribution;
    }

    const source = normalizeAttributionIdentity(evidence.source);
    const providerId = normalizeAttributionProviderId(evidence.provider_id);
    const occurredAt = parseAttributionTimestamp(firstTimestampValue(
      evidence.occurred_at,
      evidence.timestamp,
      evidence.hour_start,
    ), timestampContext);
    const identityMatches = source && providerId
      ? plansByIdentity.get(`${source}\u0000${providerId}`) || []
      : [];
    const matches = occurredAt === null || Number.isNaN(occurredAt)
      ? []
      : identityMatches.filter((plan) => (
        plan.window_valid
        && (plan.started_at === null || occurredAt >= plan.started_at)
        && (plan.expires_at === null || occurredAt <= plan.expires_at)
      ));
    if (matches.length > 0) {
      const { plan_ref: _planRef, ...retainedEvidence } = attribution;
      return normalizeUsageAttribution({
        ...retainedEvidence,
        billing_mode: "token_plan",
        billing_mode_confidence: "configured_plan_provider_match",
        provider_id: providerId,
        ...(matches.length === 1 && matches[0].plan_ref
          ? { plan_ref: matches[0].plan_ref }
          : {}),
      });
    }

    if (hasTrustedMode && confidence === "provider_receipt") return attribution;
    return normalizeUsageAttribution({
      ...attribution,
      billing_mode: "unknown",
      billing_mode_confidence: "unavailable",
    });
  };
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
  createConfiguredTokenPlanResolver,
  normalizeAttributionProviderId,
  normalizeBillingMode,
  normalizeEndpointOrigin,
  normalizeUsageAttribution,
  queueUsageIdentity,
};
