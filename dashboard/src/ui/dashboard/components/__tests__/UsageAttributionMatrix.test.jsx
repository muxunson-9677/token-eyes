import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { UsageAttributionMatrix } from "../UsageAttributionMatrix.jsx";

// Mock the copy module so the test stays isolated from copy.csv content.
vi.mock("../../../../lib/copy", () => ({
  copy: (key) => {
    const map = {
      "o3.attribution.title": "Token attribution",
      "o3.attribution.subtitle": "Local attribution by device, environment, agent, project, and model.",
      "o3.attribution.empty": "No attribution data for the current filter.",
      "o3.attribution.error": "Attribution unavailable.",
      "o3.attribution.retry": "Retry",
      "o3.attribution.column.bucket": "Bucket",
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
      cached_input_tokens: 10,
      cache_creation_input_tokens: 5,
      output_tokens: 50,
      reasoning_output_tokens: 20,
      total_tokens: 185,
      conversation_count: 2,
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
      session_key: "session-1",
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

describe("UsageAttributionMatrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the title and subtitle", () => {
    render(<UsageAttributionMatrix snapshots={SNAPSHOTS} groupBy="agent" />);
    expect(screen.getByText("Token attribution")).toBeTruthy();
    expect(
      screen.getByText(
        "Local attribution by device, environment, agent, project, and model.",
      ),
    ).toBeTruthy();
  });

  it("renders one row per agent group plus a totals row", () => {
    const { container } = render(
      <UsageAttributionMatrix snapshots={SNAPSHOTS} groupBy="agent" />,
    );
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
    expect(screen.getByText("claude")).toBeTruthy();
    expect(screen.getByText("codex")).toBeTruthy();
    // Totals row uses the Σ label.
    expect(screen.getByText("Σ")).toBeTruthy();
  });

  it("renders the agent column header as 'Agent'", () => {
    render(<UsageAttributionMatrix snapshots={SNAPSHOTS} groupBy="agent" />);
    expect(screen.getByText("Agent")).toBeTruthy();
  });

  it("renders the device column header when groupBy=device", () => {
    render(<UsageAttributionMatrix snapshots={SNAPSHOTS} groupBy="device" />);
    expect(screen.getByText("Device")).toBeTruthy();
  });

  it("renders the empty state when snapshots is null", () => {
    render(<UsageAttributionMatrix snapshots={null} groupBy="agent" />);
    expect(
      screen.getByText("No attribution data for the current filter."),
    ).toBeTruthy();
  });

  it("renders the unknown bucket label for null project_key rows", () => {
    const withNullProject = [
      {
        ...SNAPSHOTS[1],
        dimensions: { ...SNAPSHOTS[1].dimensions, project_key: null },
      },
    ];
    render(
      <UsageAttributionMatrix snapshots={withNullProject} groupBy="project" />,
    );
    expect(screen.getByText("Unknown")).toBeTruthy();
  });

  it("renders the error state with a retry button when error is set", () => {
    const onRetry = vi.fn();
    render(
      <UsageAttributionMatrix
        snapshots={null}
        groupBy="agent"
        error="fetch failed"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Attribution unavailable.")).toBeTruthy();
    expect(screen.getByText("fetch failed")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the unattributed delta row when officialDeltaTokens exceeds the local total", () => {
    render(
      <UsageAttributionMatrix
        snapshots={SNAPSHOTS}
        groupBy="agent"
        officialDeltaTokens={400}
        observedAt="2026-07-26T00:00:00.000Z"
      />,
    );
    // 400 - 305 = 95 unattributed tokens
    expect(screen.getByText(/Unattributed \(estimated\):/)).toBeTruthy();
    expect(screen.getByText(/95/)).toBeTruthy();
    expect(screen.getByTestId("evidence-badge")).toBeTruthy();
  });

  it("does not render the unattributed row when local exceeds official", () => {
    render(
      <UsageAttributionMatrix
        snapshots={SNAPSHOTS}
        groupBy="agent"
        officialDeltaTokens={100}
        observedAt="2026-07-26T00:00:00.000Z"
      />,
    );
    expect(screen.queryByText(/Unattributed \(estimated\):/)).toBeNull();
  });

  it("applies the filter before rendering rows", () => {
    render(
      <UsageAttributionMatrix
        snapshots={SNAPSHOTS}
        groupBy="agent"
        filter={{ agent_id: "claude" }}
      />,
    );
    expect(screen.getByText("claude")).toBeTruthy();
    expect(screen.queryByText("codex")).toBeNull();
    // Row total and footer total both reflect the filtered set: 185 tokens.
    expect(screen.getAllByText("185").length).toBeGreaterThanOrEqual(2);
  });
});
