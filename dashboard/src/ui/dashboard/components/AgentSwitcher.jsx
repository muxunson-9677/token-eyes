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
  const compactCardStyle = {
    height: "34px",
    minHeight: "34px",
    minWidth: 0,
    padding: "0 10px",
    fontSize: "10px",
  };
  const compactLabelStyle = { display: "inline", fontSize: "10px", lineHeight: 1 };

  return (
    <div
      role="group"
      aria-label={copy("ticket02.agent.aria")}
      className="inline-flex flex-wrap items-center gap-2"
    >
      <button
        type="button"
        onClick={() => setAgentIds(null)}
        aria-pressed={isAll}
        aria-label={copy("ticket02.agent.aria_all")}
        title={copy("ticket02.agent.all")}
        className={cn(
          "tt-agent-switcher-card tt-pressable inline-flex items-center gap-1 rounded-md border text-left transition-[background-color,border-color,box-shadow,transform]",
          isAll
            ? "border-oai-brand bg-oai-brand-50 text-oai-brand shadow-[0_8px_20px_rgb(20_91_177_/_0.16)] dark:bg-oai-brand-500/10"
            : "border-oai-gray-200 bg-white text-oai-gray-600 shadow-[0_3px_8px_rgb(31_43_56_/_0.08)] hover:-translate-y-0.5 hover:border-oai-gray-300 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-300",
        )}
        style={compactCardStyle}
      >
        <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="tt-agent-switcher-text whitespace-nowrap" style={compactLabelStyle}>{copy("ticket02.agent.all")}</span>
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
              "tt-agent-switcher-card tt-pressable inline-flex items-center gap-1 rounded-md border text-left transition-[background-color,border-color,box-shadow,transform]",
              selected
                ? "border-oai-brand bg-oai-brand-50 text-oai-brand shadow-[0_8px_20px_rgb(20_91_177_/_0.16)] dark:bg-oai-brand-500/10"
                : "border-oai-gray-200 bg-white text-oai-gray-600 shadow-[0_3px_8px_rgb(31_43_56_/_0.08)] hover:-translate-y-0.5 hover:border-oai-gray-300 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-300",
            )}
            style={selected
              ? { ...compactCardStyle, boxShadow: `inset 0 0 0 2px ${brandColor}, 0 8px 20px rgb(20 91 177 / 16%)` }
              : compactCardStyle}
          >
            <ProviderIcon
              provider={agent.queueSource.toUpperCase()}
              size={14}
              className="shrink-0"
              color={selected ? brandColor : undefined}
            />
            <span className="tt-agent-switcher-text whitespace-nowrap" style={compactLabelStyle}>{agent.displayName}</span>
          </button>
        );
      })}
    </div>
  );
}
