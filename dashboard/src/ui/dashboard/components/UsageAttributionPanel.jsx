import { useMemo, useState } from "react";
import { copy } from "../../../lib/copy";

const GROUPS = {
  environment: { field: "environment_id", labelKey: "usage.attribution.group.environment" },
  device: { field: "device_id", labelKey: "usage.attribution.group.device" },
  agent: { field: "agent_id", labelKey: "usage.attribution.group.agent" },
  project: { field: "project_key", labelKey: "usage.attribution.group.project" },
  model: { field: "model_id", labelKey: "usage.attribution.group.model" },
};

export function UsageAttributionPanel({ snapshots, loading = false, error = null }) {
  const [groupBy, setGroupBy] = useState("environment");
  const groups = useMemo(function calculateGroups() {
    return groupSnapshots(snapshots, groupBy);
  }, [snapshots, groupBy]);

  return (
    <section className="mb-6 rounded-xl border border-oai-gray-200 bg-white p-4 dark:border-oai-gray-800 dark:bg-oai-gray-900" aria-label={copy("usage.attribution.title")}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-oai-gray-900 dark:text-oai-gray-100">{copy("usage.attribution.title")}</h2>
          <p className="mt-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">{copy("usage.attribution.subtitle")}</p>
        </div>
        <label className="text-xs text-oai-gray-600 dark:text-oai-gray-300">
          {copy("usage.attribution.group_label")}
          <select className="ml-2 rounded border border-oai-gray-200 bg-white px-2 py-1 dark:border-oai-gray-700 dark:bg-oai-gray-950" value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
            {Object.entries(GROUPS).map(([key, value]) => <option key={key} value={key}>{copy(value.labelKey)}</option>)}
          </select>
        </label>
      </div>
      {loading ? <p className="text-sm text-oai-gray-500">{copy("usage.attribution.loading")}</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{copy("usage.attribution.error", { error })}</p> : null}
      {!loading && !error ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-oai-gray-500"><tr><th className="pb-2 font-medium">{copy(GROUPS[groupBy].labelKey)}</th><th className="pb-2 text-right font-medium">{copy("usage.attribution.column.tokens")}</th><th className="pb-2 text-right font-medium">{copy("usage.attribution.column.conversations")}</th></tr></thead>
            <tbody>
              {groups.length === 0 ? <tr><td colSpan="3" className="py-3 text-oai-gray-500">{copy("usage.attribution.empty")}</td></tr> : groups.map((group) => (
                <tr key={group.key} className="border-t border-oai-gray-100 dark:border-oai-gray-800">
                  <td className="py-2 font-medium">{group.key}</td><td className="py-2 text-right tabular-nums">{formatNumber(group.totalTokens)}</td><td className="py-2 text-right tabular-nums">{formatNumber(group.conversations)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function groupSnapshots(snapshots, groupBy) {
  const field = GROUPS[groupBy]?.field || GROUPS.environment.field;
  const grouped = new Map();
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const key = String(snapshot?.dimensions?.[field] || "unknown");
    const previous = grouped.get(key) || { key, totalTokens: 0, conversations: 0 };
    previous.totalTokens += nonNegativeInt(snapshot?.tokens?.total_tokens);
    previous.conversations += nonNegativeInt(snapshot?.tokens?.conversation_count);
    grouped.set(key, previous);
  }
  return [...grouped.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.key.localeCompare(b.key));
}

function nonNegativeInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}
