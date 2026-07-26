import type {
  DataEvidenceV1,
  UsageDimensionsV1,
} from "./types/usage";

/**
 * v2 attribution types (mirrors the CommonJS contract in src/lib/usage-attribution.js).
 * O6/O8 will wire the local API to return this shape; until then the dashboard
 * hook computes it client-side from already-fetched snapshots.
 */

export type GroupByField = "device" | "environment" | "agent" | "project" | "model";

export const GROUP_BY_FIELDS: readonly GroupByField[] = [
  "device",
  "environment",
  "agent",
  "project",
  "model",
] as const;

export const UNKNOWN_BUCKET = "__unknown__";

export interface UsageSnapshotV2 {
  schema_version: "token-observability/v2";
  hour_start: string | null;
  dimensions: UsageDimensionsV1;
  tokens: AttributionTokenFields;
}

export interface AttributionTokenFields {
  input_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
  conversation_count: number;
}

export interface AttributionFilter {
  device_id?: string;
  environment_id?: string;
  agent_id?: string;
  project_key?: string;
  model_id?: string;
}

export interface AttributionGroup {
  key: string;
  dimensions: UsageDimensionsV1;
  tokens: AttributionTokenFields;
}

export interface AttributionResult {
  schema_version: "token-observability/v2";
  group_by: GroupByField;
  filter: AttributionFilter;
  groups: AttributionGroup[];
  total_tokens: number;
  tokens: AttributionTokenFields;
}

export interface UnattributedDelta {
  unattributed_tokens: number;
  evidence: DataEvidenceV1;
}

const TOKEN_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
  "conversation_count",
] as const;

const GROUP_BY_TO_DIMENSION_FIELD: Record<GroupByField, keyof UsageDimensionsV1> = {
  device: "device_id",
  environment: "environment_id",
  agent: "agent_id",
  project: "project_key",
  model: "model_id",
};

function isSupportedGroupBy(value: unknown): value is GroupByField {
  return typeof value === "string" && (GROUP_BY_FIELDS as readonly string[]).includes(value);
}

function zeroTotals(): AttributionTokenFields {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    conversation_count: 0,
  };
}

function toInteger(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return 0;
}

export function sumTokenTotals(snapshots: ReadonlyArray<UsageSnapshotV2>): AttributionTokenFields {
  const totals = zeroTotals();
  if (!Array.isArray(snapshots)) return totals;
  for (const snapshot of snapshots) {
    const tokens = snapshot?.tokens || ({} as AttributionTokenFields);
    for (const field of TOKEN_FIELDS) {
      totals[field] += toInteger(tokens[field]);
    }
  }
  return totals;
}

export function buildDimensionGroupKey(
  dimensions: UsageDimensionsV1 | null | undefined,
  groupBy: GroupByField,
): string {
  if (!isSupportedGroupBy(groupBy)) {
    throw new TypeError(
      `Unsupported group-by: ${String(groupBy)}. Supported: ${(GROUP_BY_FIELDS as readonly string[]).join(", ")}.`,
    );
  }
  const field = GROUP_BY_TO_DIMENSION_FIELD[groupBy];
  const value = dimensions?.[field];
  if (value === null || value === undefined || value === "") {
    return UNKNOWN_BUCKET;
  }
  return String(value);
}

export function filterByDimensions(
  snapshots: ReadonlyArray<UsageSnapshotV2>,
  filter: AttributionFilter = {},
): UsageSnapshotV2[] {
  if (!Array.isArray(snapshots)) return [];
  const filters: Array<[keyof UsageDimensionsV1, string]> = [];
  for (const [field, value] of Object.entries(filter)) {
    if (value === null || value === undefined || value === "") continue;
    if (field === "session_key") continue;
    filters.push([field as keyof UsageDimensionsV1, String(value)]);
  }
  if (filters.length === 0) return [...snapshots];
  return snapshots.filter((snapshot) => {
    const dims = snapshot?.dimensions || ({} as UsageDimensionsV1);
    return filters.every(([field, value]) => String(dims[field]) === value);
  });
}

function buildGroupDimensions(
  groupBy: GroupByField,
  dimensions: UsageDimensionsV1,
): UsageDimensionsV1 {
  const field = GROUP_BY_TO_DIMENSION_FIELD[groupBy];
  const raw = dimensions?.[field];
  const isNullableField = field === "project_key" || field === "model_id";
  const groupValue =
    raw === null || raw === undefined || raw === ""
      ? isNullableField
        ? null
        : "unknown"
      : String(raw);
  const envKind = groupBy === "environment" ? dimensions.environment_kind : "unknown";

  return {
    device_id: groupBy === "device" ? (groupValue as string) : "unknown",
    environment_id: groupBy === "environment" ? (groupValue as string) : "unknown",
    environment_kind: envKind,
    agent_id: groupBy === "agent" ? (groupValue as string) : "unknown",
    account_scope: null,
    project_key: groupBy === "project" ? groupValue : null,
    session_key: null,
    model_id: groupBy === "model" ? groupValue : null,
  };
}

export function attributeUsage(
  snapshots: ReadonlyArray<UsageSnapshotV2>,
  { groupBy, filter }: { groupBy: GroupByField; filter?: AttributionFilter },
): AttributionResult {
  if (!isSupportedGroupBy(groupBy)) {
    throw new TypeError(
      `Unsupported groupBy: ${String(groupBy)}. Supported: ${(GROUP_BY_FIELDS as readonly string[]).join(", ")}.`,
    );
  }
  const filtered = filterByDimensions(snapshots, filter || {});
  const totals = zeroTotals();
  const groups = new Map<string, AttributionGroup>();

  for (const snapshot of filtered) {
    const dims = snapshot?.dimensions || ({} as UsageDimensionsV1);
    const key = buildDimensionGroupKey(dims, groupBy);
    const tokens = snapshot?.tokens || ({} as AttributionTokenFields);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        dimensions: buildGroupDimensions(groupBy, dims),
        tokens: zeroTotals(),
      });
    }

    const group = groups.get(key)!;
    for (const field of TOKEN_FIELDS) {
      const value = toInteger(tokens[field]);
      group.tokens[field] += value;
      totals[field] += value;
    }
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );

  return {
    schema_version: "token-observability/v2",
    group_by: groupBy,
    filter: filter || {},
    groups: sortedGroups,
    total_tokens: totals.total_tokens,
    tokens: totals,
  };
}

/**
 * Returns the unattributed delta between an official quota change and the
 * locally observed contribution. Always labeled `estimated` per the contract.
 *
 * Mirrors src/lib/usage-attribution.js#computeUnattributedDelta. Reimplemented
 * in TS so the dashboard can compute it client-side without the local API.
 */
export function computeUnattributedDelta({
  officialDeltaTokens,
  attributedTotalTokens,
  observedAt = new Date().toISOString(),
}: {
  officialDeltaTokens: number | null;
  attributedTotalTokens: number | null;
  observedAt?: string;
}): UnattributedDelta {
  if (officialDeltaTokens !== null && (!Number.isInteger(officialDeltaTokens) || officialDeltaTokens < 0)) {
    throw new TypeError("officialDeltaTokens must be a non-negative integer or null.");
  }
  if (attributedTotalTokens !== null && (!Number.isInteger(attributedTotalTokens) || attributedTotalTokens < 0)) {
    throw new TypeError("attributedTotalTokens must be a non-negative integer or null.");
  }

  const official = Number.isInteger(officialDeltaTokens) ? (officialDeltaTokens as number) : null;
  const local = Number.isInteger(attributedTotalTokens) ? (attributedTotalTokens as number) : 0;

  if (official === null) {
    return {
      unattributed_tokens: 0,
      evidence: {
        source_kind: "estimated",
        accuracy: "estimated",
        coverage: "unavailable",
        observed_at: observedAt,
        source_updated_at: null,
        stale_after_seconds: 0,
        is_stale: true,
        pricing_source: null,
        pricing_version: null,
        note_code: "official_unavailable",
      },
    };
  }

  let delta = official - local;
  let noteCode = "official_minus_local";
  if (delta < 0) {
    delta = 0;
    noteCode = "local_exceeds_official";
  } else if (local === 0) {
    noteCode = "no_local_attribution";
  }
  const coverage = delta > 0 ? "partial" : "complete";

  return {
    unattributed_tokens: delta,
    evidence: {
      source_kind: "estimated",
      accuracy: "estimated",
      coverage,
      observed_at: observedAt,
      source_updated_at: null,
      stale_after_seconds: 0,
      is_stale: false,
      pricing_source: null,
      pricing_version: null,
      note_code: noteCode,
    },
  };
}
