import { useMemo, useState } from "react";

const GROUPS = {
  environment: { field: "environment_id", label: "环境" },
  device: { field: "device_id", label: "设备" },
  agent: { field: "agent_id", label: "工具" },
  project: { field: "project_key", label: "项目" },
  model: { field: "model_id", label: "模型" },
};

export function UsageAttributionPanel({ snapshots, loading = false, error = null }) {
  const [groupBy, setGroupBy] = useState("environment");
  const groups = useMemo(() => groupSnapshots(snapshots, groupBy), [snapshots, groupBy]);

  return (
    <section className="mb-6 rounded-xl border border-oai-gray-200 bg-white p-4 dark:border-oai-gray-800 dark:bg-oai-gray-900" aria-label="使用归因">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-oai-gray-900 dark:text-oai-gray-100">使用归因</h2>
          <p className="mt-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">按真实本地采集环境拆分，不使用云端旧记录。</p>
        </div>
        <label className="text-xs text-oai-gray-600 dark:text-oai-gray-300">
          分组
          <select className="ml-2 rounded border border-oai-gray-200 bg-white px-2 py-1 dark:border-oai-gray-700 dark:bg-oai-gray-950" value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
            {Object.entries(GROUPS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </select>
        </label>
      </div>
      {loading ? <p className="text-sm text-oai-gray-500">正在读取本地归因数据…</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">归因数据读取失败：{error}</p> : null}
      {!loading && !error ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-oai-gray-500"><tr><th className="pb-2 font-medium">{GROUPS[groupBy].label}</th><th className="pb-2 text-right font-medium">Tokens</th><th className="pb-2 text-right font-medium">会话</th></tr></thead>
            <tbody>
              {groups.length === 0 ? <tr><td colSpan="3" className="py-3 text-oai-gray-500">暂无可归因的本地使用数据</td></tr> : groups.map((group) => (
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
