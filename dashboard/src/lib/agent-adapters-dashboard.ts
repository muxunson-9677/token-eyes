// ESM mirror of the agent registry for the dashboard bundle.
//
// `src/lib/agent-adapters.js` is CommonJS (runs in the Node CLI) and cannot
// be imported by the ESM dashboard bundle without a build-time shim. This
// file re-declares only the fields the dashboard UI needs ({ id, displayName,
// queueSource }) so components like AgentSwitcher / SourceFilter can render
// the agent list without crossing the CJS/ESM boundary.
//
// KEEP IN SYNC with `src/lib/agent-adapters.js` → `AGENT_ADAPTERS`. When you
// add or rename an adapter there, mirror the change here. The `id` and
// `queueSource` values must match exactly — they are the values stored in
// queue.jsonl and accepted by the `agent_ids` / `sources` API params.

export interface DashboardAgent {
  /** Stable lowercase registry id (matches AGENT_ADAPTERS[].id). */
  id: string;
  /** UI display name. */
  displayName: string;
  /** Value written to queue.jsonl `source` field (matches AGENT_ADAPTERS[].queueSource). */
  queueSource: string;
}

export const DASHBOARD_AGENTS: readonly DashboardAgent[] = [
  { id: "claude", displayName: "Claude Code", queueSource: "claude" },
  { id: "codex", displayName: "Codex", queueSource: "codex" },
  { id: "every-code", displayName: "Every Code", queueSource: "every-code" },
  { id: "cursor", displayName: "Cursor", queueSource: "cursor" },
  { id: "gemini", displayName: "Gemini CLI", queueSource: "gemini" },
  { id: "opencode", displayName: "OpenCode", queueSource: "opencode" },
  { id: "openclaw", displayName: "OpenClaw", queueSource: "openclaw" },
  { id: "kilo-cli", displayName: "Kilo CLI", queueSource: "kilo-cli" },
  { id: "kilocode", displayName: "Kilo Code", queueSource: "kilocode" },
  { id: "roocode", displayName: "Roo Code", queueSource: "roocode" },
  { id: "kiro", displayName: "Kiro", queueSource: "kiro" },
  { id: "kiro-cli", displayName: "Kiro CLI", queueSource: "kiro-cli" },
  { id: "hermes", displayName: "Hermes Agent", queueSource: "hermes" },
  { id: "kimi", displayName: "Kimi", queueSource: "kimi" },
  { id: "kimi-code", displayName: "Kimi Code", queueSource: "kimi-code" },
  { id: "codebuddy", displayName: "CodeBuddy", queueSource: "codebuddy" },
  { id: "omp", displayName: "oh-my-pi", queueSource: "omp" },
  { id: "pi", displayName: "pi", queueSource: "pi" },
  { id: "craft", displayName: "Craft Agents", queueSource: "craft" },
  { id: "grok", displayName: "Grok Build", queueSource: "grok" },
  { id: "copilot", displayName: "GitHub Copilot", queueSource: "copilot" },
  { id: "zed", displayName: "Zed Agent", queueSource: "zed" },
  { id: "goose", displayName: "Goose", queueSource: "goose" },
  { id: "droid", displayName: "Droid", queueSource: "droid" },
  { id: "antigravity", displayName: "Antigravity", queueSource: "antigravity" },
] as const;

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
