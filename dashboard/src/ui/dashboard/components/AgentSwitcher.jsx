import React, { useMemo } from "react";
import { LayoutGrid } from "lucide-react";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { useUsageFilters, useUsageFilterActions } from "../../../hooks/use-usage-filters";
import { DASHBOARD_AGENTS } from "../../../lib/agent-adapters-dashboard";
import { ProviderIcon } from "./ProviderIcon";
import { getProviderColor } from "./UsageOverview.jsx";
import { normalizeVisibleProviderIds } from "../../../lib/spend-provider-visibility.js";

/**
 * Agent 切换图标组：网格 = 全部 Agent 汇总；点单个图标仅显示该 Agent 数据。
 * 选中态使用 Provider 品牌色边框/标题强调。
 */
export function AgentSwitcher({ visibleProviderIds = [] }) {
  const { state } = useUsageFilters();
  const { setAgentIds } = useUsageFilterActions();

  const visibleAgents = useMemo(() => {
    const normalized = normalizeVisibleProviderIds(visibleProviderIds);
    const bySource = new Map(
      DASHBOARD_AGENTS.map((agent) => [agent.queueSource, agent]),
    );
    return normalized
      .map((source) => bySource.get(source))
      .filter(Boolean);
  }, [visibleProviderIds]);

  const selectedAgentId =
    state.agentIds && state.agentIds.length === 1 ? state.agentIds[0] : null;
  const isAll = state.agentIds === null || state.agentIds.length === 0;

  return (
    <div
      role="group"
      aria-label={copy("ticket02.agent.aria")}
      className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-oai-gray-100 p-1 dark:bg-oai-gray-900"
    >
      <button
        type="button"
        onClick={() => setAgentIds(null)}
        aria-pressed={isAll}
        aria-label={copy("ticket02.agent.aria_all")}
        title={copy("ticket02.agent.all")}
        className={cn(
          "tt-pressable inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors",
          isAll
            ? "bg-white text-oai-black shadow-sm ring-2 ring-oai-gray-400 dark:bg-oai-gray-800 dark:text-white dark:ring-oai-gray-500"
            : "text-oai-gray-500 hover:bg-oai-gray-200 hover:text-oai-black dark:text-oai-gray-400 dark:hover:bg-oai-gray-800 dark:hover:text-white",
        )}
      >
        <LayoutGrid className="h-4 w-4" aria-hidden="true" />
        <span className="tt-agent-switcher-text">{copy("ticket02.agent.all")}</span>
      </button>

      {visibleAgents.map((agent) => {
        const selected = selectedAgentId === agent.id;
        const brandColor = getProviderColor(agent.queueSource.toUpperCase(), 0);
        return (
          <button
            key={agent.id}
            type="button"
            onClick={() => setAgentIds([agent.id])}
            aria-pressed={selected}
            aria-label={copy("ticket02.agent.aria_one", { name: agent.displayName })}
            title={agent.displayName}
            className={cn(
              "tt-pressable inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors",
              selected
                ? "bg-white shadow-sm dark:bg-oai-gray-800"
                : "text-oai-gray-500 hover:bg-oai-gray-200 hover:text-oai-black dark:text-oai-gray-400 dark:hover:bg-oai-gray-800 dark:hover:text-white",
            )}
            style={selected ? { boxShadow: `inset 0 0 0 2px ${brandColor}` } : undefined}
          >
            <ProviderIcon
              provider={agent.queueSource.toUpperCase()}
              size={16}
              className="shrink-0"
              color={selected ? brandColor : undefined}
            />
            <span className="tt-agent-switcher-text">{agent.displayName}</span>
          </button>
        );
      })}
    </div>
  );
}
