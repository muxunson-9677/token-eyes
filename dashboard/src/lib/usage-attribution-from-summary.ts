import type { ProviderStat } from "./types/usage";
import type { UsageSnapshotV2 } from "./usage-attribution";

/**
 * Interim adapter: convert existing provider-stats rows into v2 snapshots with
 * unknown environment dimensions. O6 will replace this with dimension-aware
 * queue snapshots from the local attribution handler.
 */
export function snapshotsFromProviderStats(
  providers: ReadonlyArray<ProviderStat> | null | undefined,
  hourStart: string | null = null,
): UsageSnapshotV2[] {
  if (!Array.isArray(providers)) return [];

  return providers.map((row) => {
    const source =
      typeof row?.source === "string" && row.source.trim()
        ? row.source.trim().toLowerCase()
        : "unknown";
    const total = toNonNegInt(row?.tokens);

    return {
      schema_version: "token-observability/v2",
      hour_start: hourStart,
      dimensions: {
        device_id: "unknown",
        environment_id: "unknown",
        environment_kind: "unknown",
        agent_id: source,
        account_scope: null,
        project_key: null,
        session_key: null,
        model_id: null,
      },
      tokens: {
        input_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: total,
        conversation_count: toNonNegInt(row?.conversation_count),
      },
    };
  });
}

function toNonNegInt(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return 0;
}
