import { describe, expect, it } from "vitest";
import { normalizeAgentMetrics } from "../leaderboard-agent-metrics.js";

describe("normalizeAgentMetrics", () => {
  it("keeps only positive used agents and sorts them by the selected token metric", () => {
    expect(normalizeAgentMetrics({
      agent_metrics: {
        codex: { with_cache_tokens: 30, without_cache_tokens: 10 },
        claude: { with_cache_tokens: 0, without_cache_tokens: 0 },
        cursor: { with_cache_tokens: 20, without_cache_tokens: 15 },
      },
    }, "with_cache")).toEqual([
      { id: "codex", label: "Codex", value: 30 },
      { id: "cursor", label: "Cursor", value: 20 },
    ]);
  });

  it("uses without-cache values without leaking zero-value agents", () => {
    expect(normalizeAgentMetrics({
      agent_metrics: {
        codex: { with_cache_tokens: 30, without_cache_tokens: 10 },
        cursor: { with_cache_tokens: 20, without_cache_tokens: 15 },
      },
    }, "without_cache")).toEqual([
      { id: "cursor", label: "Cursor", value: 15 },
      { id: "codex", label: "Codex", value: 10 },
    ]);
  });

  it("falls back to legacy snapshot columns only when agent_metrics is absent", () => {
    expect(normalizeAgentMetrics({
      gpt_tokens: 11,
      claude_tokens: 7,
      cursor_tokens: 0,
    }, "with_cache")).toEqual([
      { id: "codex", label: "Codex", value: 11 },
      { id: "claude", label: "Claude Code", value: 7 },
    ]);

    expect(normalizeAgentMetrics({
      agent_metrics: {},
      gpt_tokens: 11,
    }, "with_cache")).toEqual([]);
  });

  it("renders the current leaderboard API source breakdown when legacy columns are absent", () => {
    expect(normalizeAgentMetrics({
      source_breakdown: [
        { source: "codex", total_tokens: 75, estimated_cost_usd: 19 },
        { source: "hermes", total_tokens: 15, estimated_cost_usd: 1 },
        { source: "cursor", total_tokens: 10, estimated_cost_usd: 0.5 },
      ],
    }, "tokens")).toEqual([
      { id: "codex", label: "Codex", value: 75 },
      { id: "hermes", label: "Hermes Agent", value: 15 },
      { id: "cursor", label: "Cursor", value: 10 },
    ]);
  });

  it("uses per-agent estimated cost for the estimated-cost view", () => {
    expect(normalizeAgentMetrics({
      agent_metrics: {
        codex: { estimated_cost_usd: 1.25 },
        claude: { estimated_cost_usd: 2.5 },
      },
    }, "estimated_cost")).toEqual([
      { id: "claude", label: "Claude Code", value: 2.5 },
      { id: "codex", label: "Codex", value: 1.25 },
    ]);
  });
});
