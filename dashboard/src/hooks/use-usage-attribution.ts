import { useCallback, useMemo, useState } from "react";
import {
  attributeUsage,
  computeUnattributedDelta,
  GROUP_BY_FIELDS,
  UNKNOWN_BUCKET,
} from "../lib/usage-attribution";
import type {
  AttributionFilter,
  AttributionResult,
  GroupByField,
  UnattributedDelta,
  UsageSnapshotV2,
} from "../lib/usage-attribution";

/**
 * O3 usage attribution hook.
 *
 * Accepts already-fetched v2 snapshots (eventually produced by the local API
 * in O6/O8) plus a `groupBy` + `filter` combination, and returns a memoized
 * `AttributionResult` plus an `unattributed` delta when an official quota
 * delta is supplied.
 *
 * Invariants (asserted in lib tests):
 *   1. Σ(group totals) == total_tokens (no rounding tolerance)
 *   2. Σ(agents) within env filter == env total
 *   3. Σ(environments) within device filter == device total
 *
 * The hook is deliberately decoupled from `dashboard/src/lib/api.ts` so O3
 * can ship without touching the shared API entry (file ownership: O6/O8).
 */

export interface UseUsageAttributionParams {
  snapshots: ReadonlyArray<UsageSnapshotV2> | null | undefined;
  groupBy: GroupByField;
  filter?: AttributionFilter;
  /**
   * Optional official quota delta (e.g., `used_percent` change × window cap).
   * When provided, the hook returns an `unattributed` estimate. Always
   * treated as `source_kind: "estimated"` per the v2 contract.
   */
  officialDeltaTokens?: number | null;
  /**
   * Optional explicit timestamp for the unattributed evidence. Defaults to
   * `new Date().toISOString()` at computation time.
   */
  observedAt?: string;
  /**
   * When true, the hook returns an "error" state instead of computing over
   * an empty snapshot list. Useful when the caller wants to surface a fetch
   * error rather than render an empty matrix.
   */
  error?: string | null;
}

export interface UseUsageAttributionReturn {
  result: AttributionResult | null;
  unattributed: UnattributedDelta | null;
  loading: boolean;
  error: string | null;
  /** Recompute on demand (e.g., after refetching snapshots). */
  refresh: () => void;
  /** The bucket name used for null/unknown dimensions. */
  unknownBucket: string;
  /** Supported group-by fields. */
  groupByFields: readonly GroupByField[];
}

const EMPTY_RESULT: AttributionResult = {
  schema_version: "token-observability/v2",
  group_by: "agent",
  filter: {},
  groups: [],
  total_tokens: 0,
  tokens: {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    conversation_count: 0,
  },
};

export function useUsageAttribution({
  snapshots,
  groupBy,
  filter,
  officialDeltaTokens = null,
  observedAt,
  error: externalError = null,
}: UseUsageAttributionParams): UseUsageAttributionReturn {
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => {
    setRevision((r) => r + 1);
  }, []);

  const result = useMemo<AttributionResult>(() => {
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      return { ...EMPTY_RESULT, group_by: groupBy, filter: filter || {} };
    }
    return attributeUsage(snapshots, { groupBy, filter });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots, groupBy, JSON.stringify(filter || {}), revision]);

  const unattributed = useMemo<UnattributedDelta | null>(() => {
    if (officialDeltaTokens === null || officialDeltaTokens === undefined) return null;
    return computeUnattributedDelta({
      officialDeltaTokens,
      attributedTotalTokens: result.total_tokens,
      observedAt,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officialDeltaTokens, result.total_tokens, observedAt, revision]);

  return {
    result,
    unattributed,
    loading: false,
    error: externalError,
    refresh,
    unknownBucket: UNKNOWN_BUCKET,
    groupByFields: GROUP_BY_FIELDS,
  };
}
