import { useMemo, useState } from "react";
import { copy } from "../../../lib/copy";
import { useUsageAttribution } from "../../../hooks/use-usage-attribution";
import { GROUP_BY_FIELDS } from "../../../lib/usage-attribution";
import { UsageAttributionMatrix } from "./UsageAttributionMatrix.jsx";

/**
 * @typedef {import("../../../lib/usage-attribution").AttributionFilter} AttributionFilter
 * @typedef {import("../../../lib/usage-attribution").GroupByField} GroupByField
 * @typedef {import("../../../lib/usage-attribution").UsageSnapshotV2} UsageSnapshotV2
 */

/**
 * O3 attribution panel: one shared filter drives the overview totals and the
 * matrix table (and any future trend card mounted beside them).
 *
 * @param {object} props
 * @param {ReadonlyArray<UsageSnapshotV2> | null | undefined} props.snapshots
 * @param {number | null} [props.officialDeltaTokens]
 * @param {string | null} [props.error]
 * @param {() => void} [props.onRetry]
 * @param {string} [props.className]
 */
export function UsageAttributionPanel({
  snapshots,
  officialDeltaTokens = null,
  error = null,
  onRetry,
  className,
}) {
  const [groupBy, setGroupBy] = useState(/** @type {GroupByField} */ ("agent"));
  const [filter, setFilter] = useState(/** @type {AttributionFilter} */ ({}));

  const filterOptions = useMemo(() => collectFilterOptions(snapshots), [snapshots]);

  const { result } = useUsageAttribution({
    snapshots,
    groupBy,
    filter,
    officialDeltaTokens,
    error,
  });

  return (
    <section
      className={`flex flex-col gap-4 ${className ?? ""}`}
      aria-label={copy("o3.attribution.panel.title")}
    >
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-oai-gray-900 dark:text-oai-gray-100">
            {copy("o3.attribution.panel.title")}
          </h2>
          <p className="mt-0.5 text-xs text-oai-gray-600 dark:text-oai-gray-400">
            {copy("o3.attribution.panel.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-oai-gray-600 dark:text-oai-gray-400">
            <span>{copy("o3.attribution.panel.group_by")}</span>
            <select
              className="rounded-md border border-oai-gray-200 bg-white px-2 py-1 text-xs text-oai-gray-900 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-100"
              value={groupBy}
              onChange={(event) => setGroupBy(/** @type {GroupByField} */ (event.target.value))}
            >
              {GROUP_BY_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {copy(`o3.attribution.group_by.${field}`)}
                </option>
              ))}
            </select>
          </label>
          <FilterSelect
            label={copy("o3.attribution.group_by.device")}
            value={filter.device_id || ""}
            options={filterOptions.device_id}
            onChange={(value) =>
              setFilter((prev) => ({ ...prev, device_id: value || undefined }))
            }
          />
          <FilterSelect
            label={copy("o3.attribution.group_by.environment")}
            value={filter.environment_id || ""}
            options={filterOptions.environment_id}
            onChange={(value) =>
              setFilter((prev) => ({ ...prev, environment_id: value || undefined }))
            }
          />
          <FilterSelect
            label={copy("o3.attribution.group_by.agent")}
            value={filter.agent_id || ""}
            options={filterOptions.agent_id}
            onChange={(value) =>
              setFilter((prev) => ({ ...prev, agent_id: value || undefined }))
            }
          />
          <FilterSelect
            label={copy("o3.attribution.group_by.project")}
            value={filter.project_key || ""}
            options={filterOptions.project_key}
            onChange={(value) =>
              setFilter((prev) => ({ ...prev, project_key: value || undefined }))
            }
          />
          <FilterSelect
            label={copy("o3.attribution.group_by.model")}
            value={filter.model_id || ""}
            options={filterOptions.model_id}
            onChange={(value) =>
              setFilter((prev) => ({ ...prev, model_id: value || undefined }))
            }
          />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <OverviewCard
          label={copy("o3.attribution.panel.overview.total")}
          value={formatNumber(result?.total_tokens ?? 0)}
        />
        <OverviewCard
          label={copy("o3.attribution.panel.overview.groups")}
          value={formatNumber(result?.groups.length ?? 0)}
        />
        <OverviewCard
          label={copy("o3.attribution.panel.overview.conversations")}
          value={formatNumber(result?.tokens.conversation_count ?? 0)}
        />
      </div>

      <UsageAttributionMatrix
        snapshots={snapshots}
        groupBy={groupBy}
        filter={filter}
        officialDeltaTokens={officialDeltaTokens}
        error={error}
        onRetry={onRetry}
      />
    </section>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-oai-gray-600 dark:text-oai-gray-400">
      <span>{label}</span>
      <select
        className="max-w-[10rem] rounded-md border border-oai-gray-200 bg-white px-2 py-1 text-xs text-oai-gray-900 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{copy("o3.attribution.panel.filter_all")}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function OverviewCard({ label, value }) {
  return (
    <div className="rounded-xl border border-oai-gray-200 bg-white px-3 py-2 dark:border-oai-gray-800 dark:bg-oai-gray-900">
      <div className="text-[10px] uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">
        {value}
      </div>
    </div>
  );
}

function collectFilterOptions(snapshots) {
  const empty = {
    device_id: [],
    environment_id: [],
    agent_id: [],
    project_key: [],
    model_id: [],
  };
  if (!Array.isArray(snapshots)) return empty;
  const sets = {
    device_id: new Set(),
    environment_id: new Set(),
    agent_id: new Set(),
    project_key: new Set(),
    model_id: new Set(),
  };
  for (const snapshot of snapshots) {
    const dims = snapshot?.dimensions || {};
    for (const field of Object.keys(sets)) {
      const value = dims[field];
      if (value !== null && value !== undefined && value !== "") {
        sets[field].add(String(value));
      }
    }
  }
  return Object.fromEntries(
    Object.entries(sets).map(([field, set]) => [field, Array.from(set).sort()]),
  );
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-US").format(n);
}
