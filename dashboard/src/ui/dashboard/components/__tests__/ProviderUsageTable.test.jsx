import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProviderUsageTable } from "../ProviderUsageTable.jsx";

// Mock the Hook so tests focus on rendering / interaction, not API wiring.
vi.mock("../../../../hooks/use-provider-stats", () => ({
  useProviderStats: vi.fn(),
}));

vi.mock("../../../../hooks/useCurrency", () => ({
  useCurrency: () => ({ currency: "USD", rate: 1 }),
}));

vi.mock("../../../../lib/copy", () => ({
  copy: (key, vars = {}) => {
    const map = {
      "ticket04.provider.loading": "Loading providers",
      "ticket04.provider.empty": "No provider data",
      "ticket04.provider.error": "Failed to load",
      "ticket04.provider.retry": "Retry",
      "ticket04.provider.sort_aria": `Sort by ${vars.column}`,
      "ticket04.provider.column.provider": "Provider",
      "ticket04.provider.column.requests": "Requests",
      "ticket04.provider.column.tokens": "Tokens",
      "ticket04.provider.column.cost": "Cost",
      "ticket04.provider.column.success_rate": "Success Rate",
      "ticket04.provider.column.avg_latency": "Avg Latency",
    };
    return map[key] || key;
  },
  getCopyLocale: () => "en-US",
}));

import { useProviderStats } from "../../../../hooks/use-provider-stats";

function makeProvider(overrides = {}) {
  return {
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
  providers: null,
  source: "edge",
  loading: false,
  error: null,
  refresh: vi.fn(),
  fetchedAt: null,
};

describe("ProviderUsageTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProviderStats.mockReturnValue(HOOK_DEFAULTS);
  });

  it("renders loading state", () => {
    useProviderStats.mockReturnValue({ ...HOOK_DEFAULTS, loading: true });
    render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByRole("status", { name: "Loading providers" })).toBeInTheDocument();
  });

  it("renders error state with retry button", () => {
    const refresh = vi.fn();
    useProviderStats.mockReturnValue({ ...HOOK_DEFAULTS, error: "network down", refresh });
    render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("renders empty state when providers array is empty", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: { providers: [], totals: {} },
    });
    render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByText("No provider data")).toBeInTheDocument();
  });

  it("renders 6 column headers and provider rows", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: {
        providers: [
          makeProvider({ source: "codex", source_display_name: "Codex" }),
          makeProvider({ source: "claude", source_display_name: "Claude" }),
        ],
        totals: {},
      },
    });
    render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);

    const expectedHeaders = ["Provider", "Requests", "Tokens", "Cost", "Success Rate", "Avg Latency"];
    for (const header of expectedHeaders) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });

  it("default sort by tokens desc (higher tokens first)", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: {
        providers: [
          makeProvider({ source: "claude", source_display_name: "Claude", tokens: 1000 }),
          makeProvider({ source: "codex", source_display_name: "Codex", tokens: 50000 }),
        ],
        totals: {},
      },
    });
    const { container } = render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    const rows = container.querySelectorAll("tbody tr");
    // Codex (50000 tokens) should appear before Claude (1000 tokens)
    expect(rows[0].textContent).toContain("Codex");
    expect(rows[1].textContent).toContain("Claude");
  });

  it("success rate 100% is green, <100% is orange", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: {
        providers: [
          makeProvider({ source: "codex", source_display_name: "Codex", success_rate: 100 }),
          makeProvider({ source: "claude", source_display_name: "Claude", success_rate: 95.5 }),
        ],
        totals: {},
      },
    });
    render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    const codexRate = screen.getByText("100.0%");
    const claudeRate = screen.getByText("95.5%");
    expect(codexRate.className).toContain("text-emerald");
    expect(claudeRate.className).toContain("text-orange");
  });

  it("clicking cost column header toggles sort direction", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: {
        providers: [
          makeProvider({ source: "claude", source_display_name: "Claude", cost_usd: 0.5 }),
          makeProvider({ source: "codex", source_display_name: "Codex", cost_usd: 5.0 }),
        ],
        totals: {},
      },
    });
    const { container } = render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);

    // Default sort is tokens desc. Click "Cost" to sort by cost desc.
    fireEvent.click(screen.getByText("Cost"));
    let rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("Codex"); // cost 5.0 > 0.5

    // Click again to toggle to asc
    fireEvent.click(screen.getByText("Cost"));
    rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("Claude"); // cost 0.5 < 5.0
  });
});
