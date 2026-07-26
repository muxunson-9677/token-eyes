import { useCallback, useMemo } from "react";
import { copy } from "../../../lib/copy";
import { EvidenceBadge } from "./EvidenceBadge.jsx";
import { useUsageAttribution } from "../../../hooks/use-usage-attribution";

/**
 * @typedef {import("../../../lib/usage-attribution").AttributionFilter} AttributionFilter
 * @typedef {import("../../../lib/usage-attribution").GroupByField} GroupByField
 * @typedef {import("../../../lib/usage-attribution").UsageSnapshotV2} UsageSnapshotV2
 */

/**
 * O3 usage attribution matrix.
 *
 * Renders an aggregated table of v2 snapshots grouped by device /
 * environment / agent / project / model. The same filter is applied to
 * every cell so the overview, the table, and any downstream trend share
 * one consistent scope (per O3 task 6).
 *
 * Privacy: device_id, environment_id, project_key, and session_key are
 * local-only. We render the dimension value verbatim because the v2
 * contract already requires callers to normalize/hide sensitive path
 * segments before storing them in `project_key`.
 */

/**
 * @typedef {Object} UsageAttributionMatrixProps
 * @property {ReadonlyArray<UsageSnapshotV2> | null | undefined} snapshots
 * @property {GroupByField} groupBy
 * @property {AttributionFilter} [filter]
 * @property {number | null} [officialDeltaTokens]
 * @property {string | null} [error]
 * @property {() => void} [onRetry]
 * @property {string} [className]
 */

/**
 * @param {UsageAttributionMatrixProps} props
 */
export function UsageAttributionMatrix({
  snapshots,
  groupBy,
  filter,
  officialDeltaTokens = null,
  observedAt,
  error = null,
  onRetry,
  className,
}) {
  const { result, unattributed, unknownBucket } = useUsageAttribution({
    snapshots,
    groupBy,
    filter,
    officialDeltaTokens,
    observedAt,
    error,
  });

  const onRetryClick = useCallback(() => {
    onRetry?.();
  }, [onRetry]);

  const headerLabel = useMemo(() => {
    const map = {
      device: copy("o3.attribution.group_by.device"),
      environment: copy("o3.attribution.group_by.environment"),
      agent: copy("o3.attribution.group_by.agent"),
      project: copy("o3.attribution.group_by.project"),
      model: copy("o3.attribution.group_by.model"),
    };
    return map[groupBy];
  }, [groupBy]);

  if (error) {
    return (
      <section
        className={`rounded-2xl border border-red-200 bg-white p-4 dark:border-red-900/50 dark:bg-oai-gray-900 ${
          className ?? ""
        }`}
        aria-live="polite"
      >
        <header className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">
            {copy("o3.attribution.error")}
          </h3>
          {onRetry && (
            <button
              type="button"
              onClick={onRetryClick}
              className="rounded-md border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              {copy("o3.attribution.retry")}
            </button>
          )}
        </header>
        <p className="text-xs text-oai-gray-600 dark:text-oai-gray-300">{error}</p>
      </section>
    );
  }

  const groups = result?.groups ?? [];
  const isEmpty = groups.length === 0;

  return (
    <section
      className={`flex flex-col rounded-2xl border border-oai-gray-200 bg-white p-4 dark:border-oai-gray-800 dark:bg-oai-gray-900 ${
        className ?? ""
      }`}
      aria-label={copy("o3.attribution.title")}
    >
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-oai-gray-900 dark:text-oai-gray-100">
          {copy("o3.attribution.title")}
        </h3>
        <p className="mt-0.5 text-xs text-oai-gray-600 dark:text-oai-gray-400">
          {copy("o3.attribution.subtitle")}
        </p>
      </header>

      {isEmpty ? (
        <p className="py-6 text-center text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("o3.attribution.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-oai-gray-200 text-[10px] uppercase tracking-wide text-oai-gray-500 dark:border-oai-gray-800">
              <tr>
                <th className="py-1.5 pr-3 font-medium">{headerLabel}</th>
                <th className="py-1.5 pr-3 text-right font-medium">
                  {copy("o3.attribution.column.tokens")}
                </th>
                <th className="py-1.5 pr-3 text-right font-medium">
                  {copy("o3.attribution.column.input")}
                </th>
                <th className="py-1.5 pr-3 text-right font-medium">
                  {copy("o3.attribution.column.output")}
                </th>
                <th className="py-1.5 pr-3 text-right font-medium">
                  {copy("o3.attribution.column.cache_read")}
                </th>
                <th className="py-1.5 pr-3 text-right font-medium">
                  {copy("o3.attribution.column.cache_write")}
                </th>
                <th className="py-1.5 pr-3 text-right font-medium">
                  {copy("o3.attribution.column.reasoning")}
                </th>
                <th className="py-1.5 text-right font-medium">
                  {copy("o3.attribution.column.conversations")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oai-gray-100 dark:divide-oai-gray-800">
              {groups.map((group) => {
                const isUnknown = group.key === unknownBucket;
                const label = isUnknown
                  ? copy("o3.attribution.unknown_bucket")
                  : formatBucketLabel(groupBy, group.key);
                return (
                  <tr key={group.key} className="text-oai-gray-900 dark:text-oai-gray-100">
                    <td className="py-1.5 pr-3 font-medium">{label}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {formatNumber(group.tokens.total_tokens)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-400">
                      {formatNumber(group.tokens.input_tokens)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-400">
                      {formatNumber(group.tokens.output_tokens)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-400">
                      {formatNumber(group.tokens.cached_input_tokens)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-400">
                      {formatNumber(group.tokens.cache_creation_input_tokens)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-400">
                      {formatNumber(group.tokens.reasoning_output_tokens)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-400">
                      {formatNumber(group.tokens.conversation_count)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-oai-gray-200 font-semibold dark:border-oai-gray-800">
                <td className="py-1.5 pr-3">Σ</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatNumber(result?.total_tokens ?? 0)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatNumber(result?.tokens.input_tokens ?? 0)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatNumber(result?.tokens.output_tokens ?? 0)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatNumber(result?.tokens.cached_input_tokens ?? 0)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatNumber(result?.tokens.cache_creation_input_tokens ?? 0)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatNumber(result?.tokens.reasoning_output_tokens ?? 0)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatNumber(result?.tokens.conversation_count ?? 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {unattributed && unattributed.unattributed_tokens > 0 ? (
        <div
          className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
          title={copy("o3.attribution.unattributed_tooltip")}
        >
          <span className="font-medium">
            {copy("o3.attribution.unattributed_label")}:{" "}
            {formatNumber(unattributed.unattributed_tokens)}
          </span>
          <EvidenceBadge evidence={unattributed.evidence} />
        </div>
      ) : null}
    </section>
  );
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-US").format(n);
}

/**
 * Privacy: project buckets show the last path segment only, never a full path.
 * Other dimensions render the stable key as stored.
 */
function formatBucketLabel(groupBy, key) {
  if (groupBy !== "project" || typeof key !== "string") return key;
  const normalized = key.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : key;
}
