import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { UsageAttributionPanel } from "../UsageAttributionPanel.jsx";

vi.mock("../../../../lib/copy", () => ({
  copy: (key) => {
    const map = {
      "o3.attribution.panel.title": "Usage attribution",
      "o3.attribution.panel.subtitle": "Shared filter for overview and table.",
      "o3.attribution.panel.group_by": "Group by",
      "o3.attribution.panel.filter_all": "All",
      "o3.attribution.panel.overview.total": "Total tokens",
      "o3.attribution.panel.overview.groups": "Groups",
      "o3.attribution.panel.overview.conversations": "Conversations",
      "o3.attribution.title": "Token attribution",
      "o3.attribution.subtitle": "Local attribution by device, environment, agent, project, and model.",
      "o3.attribution.empty": "No attribution data for the current filter.",
      "o3.attribution.error": "Attribution unavailable.",
      "o3.attribution.retry": "Retry",
      "o3.attribution.column.tokens": "Total tokens",
      "o3.attribution.column.input": "Input",
      "o3.attribution.column.output": "Output",
      "o3.attribution.column.cache_read": "Cache read",
      "o3.attribution.column.cache_write": "Cache write",
      "o3.attribution.column.reasoning": "Reasoning",
      "o3.attribution.column.conversations": "Conversations",
      "o3.attribution.unknown_bucket": "Unknown",
      "o3.attribution.group_by.device": "Device",
      "o3.attribution.group_by.environment": "Environment",
      "o3.attribution.group_by.agent": "Agent",
      "o3.attribution.group_by.project": "Project",
      "o3.attribution.group_by.model": "Model",
      "o3.attribution.unattributed_label": "Unattributed (estimated)",
      "o3.attribution.unattributed_tooltip": "Official quota delta minus locally observed contribution. Always an estimate.",
    };
    return map[key] ?? key;
  },
}));

vi.mock("../EvidenceBadge.jsx", () => ({
  EvidenceBadge: ({ evidence }) => (
    <span data-testid="evidence-badge">{evidence.source_kind}</span>
  ),
}));

const SNAPSHOTS = [
  {
    schema_version: "token-observability/v2",
    hour_start: "2026-07-26T00:00:00.000Z",
    dimensions: {
      device_id: "device-a",
      environment_id: "native:host-a",
      environment_kind: "native",
      agent_id: "claude",
      account_scope: null,
      project_key: "c:\\app",
      session_key: null,
      model_id: "claude-opus-4-6",
    },
    tokens: {
      input_tokens: 100,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 50,
      reasoning_output_tokens: 0,
      total_tokens: 150,
      conversation_count: 1,
    },
  },
  {
    schema_version: "token-observability/v2",
    hour_start: "2026-07-26T00:00:00.000Z",
    dimensions: {
      device_id: "device-a",
      environment_id: "wsl:ubuntu",
      environment_kind: "wsl",
      agent_id: "codex",
      account_scope: null,
      project_key: "/home/user/app",
      session_key: null,
      model_id: "gpt-5",
    },
    tokens: {
      input_tokens: 80,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 40,
      reasoning_output_tokens: 0,
      total_tokens: 120,
      conversation_count: 1,
    },
  },
];

describe("UsageAttributionPanel", () => {
  it("keeps overview totals and matrix rows on the same filter", () => {
    const { container } = render(<UsageAttributionPanel snapshots={SNAPSHOTS} />);

    expect(screen.getByText("Usage attribution")).toBeTruthy();
    // Overview card and matrix footer both show the shared unfiltered total.
    expect(screen.getAllByText("270").length).toBeGreaterThanOrEqual(2);

    const agentFilter = screen.getAllByLabelText("Agent").find(
      (el) => el.tagName === "SELECT" && Array.from(el.options).some((o) => o.value === "claude"),
    );
    expect(agentFilter).toBeTruthy();
    fireEvent.change(agentFilter, { target: { value: "claude" } });

    // Overview total and table total both reflect the filtered 150 tokens.
    expect(screen.getAllByText("150").length).toBeGreaterThanOrEqual(2);
    const bodyText = Array.from(container.querySelectorAll("tbody tr")).map((row) =>
      row.textContent,
    );
    expect(bodyText.some((text) => text.includes("claude"))).toBe(true);
    expect(bodyText.some((text) => text.includes("codex"))).toBe(false);
  });
});
