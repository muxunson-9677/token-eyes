import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ModelUsageTable } from "../ModelUsageTable.jsx";

// Mock the Hook so tests focus on rendering / interaction, not API wiring.
vi.mock("../../../../hooks/use-model-stats", () => ({
  useModelStats: vi.fn(),
}));

vi.mock("../../../../hooks/useCurrency", () => ({
  useCurrency: () => ({ currency: "USD", rate: 1 }),
}));

vi.mock("../../../../lib/copy", () => ({
  copy: (key, vars = {}) => {
    const map = {
      "ticket04.model.loading": "Loading models",
      "ticket04.model.empty": "No model data",
      "ticket04.model.error": "Failed to load",
      "ticket04.model.retry": "Retry",
      "ticket04.model.sort_aria": `Sort by ${vars.column}`,
      "ticket04.model.column.model": "Model",
      "ticket04.model.column.requests": "Requests",
      "ticket04.model.column.tokens": "Tokens",
      "ticket04.model.column.cost": "Cost",
      "ticket04.model.column.success_rate": "Success Rate",
      "ticket04.model.column.avg_latency": "Avg Latency",
      "spend.usage.metric.not_collected": "Not collected",
      "spend.usage.pagination.records": `${vars.total} records`,
      "spend.usage.pagination.previous": "Previous",
      "spend.usage.pagination.next": "Next",
    };
    return map[key] || key;
  },
  getCopyLocale: () => "en-US",
}));

import { useModelStats } from "../../../../hooks/use-model-stats";

function makeModel(overrides = {}) {
  return {
    model: "gpt-5",
    source: "codex",
    source_display_name: "Codex",
    request_count: 100,
    tokens: 50000,
    cost_usd: 1.5,
    success_rate: 100,
    avg_latency_ms: 830,
    ...overrides,
  };
}

const HOOK_DEFAULTS = {
  models: null,
  source: "edge",
  loading: false,
  error: null,
  refresh: vi.fn(),
  fetchedAt: null,
};

describe("ModelUsageTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelStats.mockReturnValue(HOOK_DEFAULTS);
  });

  it("renders loading state", () => {
    useModelStats.mockReturnValue({ ...HOOK_DEFAULTS, loading: true });
    render(<ModelUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByRole("status", { name: "Loading models" })).toBeInTheDocument();
  });

  it("renders error state with retry button", () => {
    const refresh = vi.fn();
    useModelStats.mockReturnValue({ ...HOOK_DEFAULTS, error: "network down", refresh });
    render(<ModelUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("renders empty state when models array is empty", () => {
    useModelStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      models: { models: [], totals: {} },
    });
    render(<ModelUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByText("No model data")).toBeInTheDocument();
  });

  it("renders 6 column headers and model rows", () => {
    useModelStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      models: {
        models: [
          makeModel({ model: "gpt-5", source_display_name: "Codex" }),
          makeModel({ model: "claude-sonnet", source_display_name: "Claude" }),
        ],
        totals: {},
      },
    });
    render(<ModelUsageTable from="2026-06-01" to="2026-06-30" />);

    const expectedHeaders = ["Model", "Requests", "Tokens", "Cost", "Success Rate", "Avg Latency"];
    for (const header of expectedHeaders) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet")).toBeInTheDocument();
  });

  it("renders provider name as subline under model name", () => {
    useModelStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      models: {
        models: [makeModel({ model: "gpt-5", source_display_name: "Codex" })],
        totals: {},
      },
    });
    const { container } = render(<ModelUsageTable from="2026-06-01" to="2026-06-30" />);
    // Both model name and provider subline should be in the first row
    const firstRow = container.querySelector("tbody tr");
    expect(firstRow.textContent).toContain("gpt-5");
    expect(firstRow.textContent).toContain("Codex");
  });

  it("default sort by tokens desc (higher tokens first)", () => {
    useModelStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      models: {
        models: [
          makeModel({ model: "claude-sonnet", tokens: 1000 }),
          makeModel({ model: "gpt-5", tokens: 50000 }),
        ],
        totals: {},
      },
    });
    const { container } = render(<ModelUsageTable from="2026-06-01" to="2026-06-30" />);
    const rows = container.querySelectorAll("tbody tr");
    // gpt-5 (50000 tokens) should appear before claude-sonnet (1000 tokens)
    expect(rows[0].textContent).toContain("gpt-5");
    expect(rows[1].textContent).toContain("claude-sonnet");
  });

  it("keeps the model card fixed to ten rows and paginates the rest", () => {
    const modelRows = Array.from({ length: 12 }, (_, index) => makeModel({
      model: `model-${index + 1}`,
      tokens: 12 - index,
    }));
    useModelStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      models: { models: modelRows, totals: {} },
    });

    const { container } = render(<ModelUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(screen.getByText("12 records")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByText("model-11")).toBeInTheDocument();
  });

  it("uses aggregate conversation counts and labels genuinely uncollected metrics", () => {
    useModelStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      models: {
        models: [makeModel({
          request_count: null,
          conversation_count: 168,
          success_rate: null,
          avg_latency_ms: null,
        })],
        totals: {},
      },
    });

    const { container } = render(<ModelUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByText("168")).toBeInTheDocument();
    expect(screen.getAllByText("Not collected")).toHaveLength(2);
    expect(container).not.toHaveTextContent("—");
  });

  it("success rate 100% is green, <100% is orange", () => {
    useModelStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      models: {
        models: [
          makeModel({ model: "gpt-5", success_rate: 100 }),
          makeModel({ model: "claude-sonnet", success_rate: 88.5 }),
        ],
        totals: {},
      },
    });
    render(<ModelUsageTable from="2026-06-01" to="2026-06-30" />);
    const gpt5Rate = screen.getByText("100.0%");
    const claudeRate = screen.getByText("88.5%");
    expect(gpt5Rate.className).toContain("text-emerald");
    expect(claudeRate.className).toContain("text-orange");
  });

  it("clicking cost column header toggles sort direction", () => {
    useModelStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      models: {
        models: [
          makeModel({ model: "claude-sonnet", cost_usd: 0.5 }),
          makeModel({ model: "gpt-5", cost_usd: 5.0 }),
        ],
        totals: {},
      },
    });
    const { container } = render(<ModelUsageTable from="2026-06-01" to="2026-06-30" />);

    // Default sort is tokens desc. Click "Cost" to sort by cost desc.
    fireEvent.click(screen.getByText("Cost"));
    let rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("gpt-5"); // cost 5.0 > 0.5

    // Click again to toggle to asc
    fireEvent.click(screen.getByText("Cost"));
    rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("claude-sonnet"); // cost 0.5 < 5.0
  });
});
