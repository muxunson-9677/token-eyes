import React, { useMemo, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { useUsageFilters, useUsageFilterActions } from "../../../hooks/use-usage-filters";
import { DASHBOARD_AGENTS } from "../../../lib/agent-adapters-dashboard";
import { ProviderIcon } from "./ProviderIcon";
import { normalizeVisibleProviderIds } from "../../../lib/spend-provider-visibility.js";

/**
 * Ticket-07 Task 2: Agent 切换图标组，受 visibleProviderIds 约束，实现折叠状态机。
 *
 * 状态机：
 * 1. 首次进入：全部范围，Agent 图标展开。
 * 2. 全部范围点击一次：只折叠图标，数据范围不变。
 * 3. 全部范围且折叠时再点击：展开图标。
 * 4. 选中单个 Agent 后点击全部：切回全部范围并折叠图标；再次点击才展开。
 * 5. 折叠后保留全部按钮；只隐藏 Agent 图标。
 * 6. 折叠状态只属于当前页面实例，不持久化。
 */
export function AgentSwitcher({ visibleProviderIds = [] }) {
  const { state } = useUsageFilters();
  const { setAgentIds } = useUsageFilterActions();

  const [expanded, setExpanded] = useState(true);

  // Map visibleProviderIds to actual agents from DASHBOARD_AGENTS registry.
  // Only render agents that are in the allowlist, preserving order.
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

  // Determine the aria-label/title for the 全部 button based on state.
  // Three cases:
  // 1. Single agent selected: "显示全部 Agent 并收起列表"
  // 2. All + expanded + has agents: "收起 Agent 列表"
  // 3. All + collapsed OR no agents: "展开 Agent 列表"
  const allButtonAriaLabel = useMemo(() => {
    if (!isAll) {
      return copy("ticket02.agent.show_all_collapse");
    }
    // When no agents are visible, always show "expand" since there's nothing to collapse
    if (visibleAgents.length === 0) {
      return copy("ticket02.agent.expand");
    }
    return expanded
      ? copy("ticket02.agent.collapse")
      : copy("ticket02.agent.expand");
  }, [isAll, expanded, visibleAgents.length]);

  const handleAllClick = () => {
    if (!isAll) {
      // State machine case 4: Selecting all from single agent mode.
      // First switch to all range, then collapse icons.
      setAgentIds(null);
      setExpanded(false);
      return;
    }
    // State machine cases 2 & 3: Toggle collapse when already in all mode.
    setExpanded((current) => !current);
  };

  return (
    <div
      role="group"
      aria-label={copy("ticket02.agent.aria")}
      className="inline-flex items-center gap-1 rounded-lg bg-oai-gray-100 p-1 dark:bg-oai-gray-900"
    >
      <button
        type="button"
        onClick={handleAllClick}
        aria-pressed={isAll}
        aria-expanded={visibleAgents.length > 0 ? expanded : false}
        aria-label={allButtonAriaLabel}
        title={isAll ? (visibleAgents.length > 0 ? (expanded ? copy("ticket02.agent.collapse") : copy("ticket02.agent.expand")) : copy("ticket02.agent.expand")) : copy("ticket02.agent.show_all_collapse")}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
          isAll
            ? "bg-white text-oai-black shadow-sm dark:bg-oai-gray-800 dark:text-white"
            : "text-oai-gray-500 hover:bg-oai-gray-200 hover:text-oai-black dark:text-oai-gray-400 dark:hover:bg-oai-gray-800 dark:hover:text-white",
        )}
      >
        <LayoutGrid className="h-4 w-4" aria-hidden="true" />
      </button>

      {expanded && visibleAgents.map((agent) => {
        const selected = selectedAgentId === agent.id;
        return (
          <button
            key={agent.id}
            type="button"
            onClick={() => setAgentIds([agent.id])}
            aria-pressed={selected}
            aria-label={copy("ticket02.agent.aria_one", { name: agent.displayName })}
            title={agent.displayName}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
              selected
                ? "bg-white text-oai-black shadow-sm dark:bg-oai-gray-800 dark:text-white"
                : "text-oai-gray-500 hover:bg-oai-gray-200 hover:text-oai-black dark:text-oai-gray-400 dark:hover:bg-oai-gray-800 dark:hover:text-white",
            )}
          >
            <ProviderIcon
              provider={agent.queueSource.toUpperCase()}
              size={16}
              className="shrink-0"
            />
          </button>
        );
      })}
    </div>
  );
}
