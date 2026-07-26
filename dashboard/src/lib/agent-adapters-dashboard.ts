import providerCapabilities from "../../../shared/provider-capabilities.json";

export interface DashboardAgent {
  /** Stable lowercase registry id (matches AGENT_ADAPTERS[].id). */
  id: string;
  /** UI display name. */
  displayName: string;
  /** Value written to queue.jsonl `source` field. */
  queueSource: string;
}

/** Agent metadata is sourced from the shared capability manifest. */
export const DASHBOARD_AGENTS: readonly DashboardAgent[] = providerCapabilities.providers
  .filter((provider) => provider.token_usage_collection)
  .sort((a, b) => (a.agent_order ?? 0) - (b.agent_order ?? 0))
  .map((provider) => ({
    id: provider.id,
    displayName: provider.agent_display_name || provider.display_name,
    queueSource: provider.queue_source || provider.id,
  }));
/**
 * Map a queueSource (the `source` value in queue.jsonl / API responses) back
 * to the dashboard agent id. Multiple adapters can share a queueSource in
 * theory; the first match wins. Used by the reverse cascade (selecting a
 * source auto-selects its agent).
 */
const SOURCE_TO_AGENT_ID: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const agent of DASHBOARD_AGENTS) {
    if (!map.has(agent.queueSource)) map.set(agent.queueSource, agent.id);
  }
  return map;
})();

export function getAgentIdByQueueSource(queueSource: string): string | undefined {
  return SOURCE_TO_AGENT_ID.get(queueSource);
}

/**
 * Map a queueSource to the agent's display name (falls back to the raw source
 * string when no adapter is registered for it).
 */
export function getAgentDisplayNameByQueueSource(queueSource: string): string {
  const agent = DASHBOARD_AGENTS.find((a) => a.queueSource === queueSource);
  return agent?.displayName ?? queueSource;
}
