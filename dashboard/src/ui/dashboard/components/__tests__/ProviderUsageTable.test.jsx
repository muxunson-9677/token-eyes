import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
      "ticket06.metric.unavailable": "—",
      "usage.provider.connected_no_precise_tokens": "Connected; precise tokens unavailable",
      "spend.usage.metric.not_collected": "Not collected",
      "spend.usage.metric.no_request_samples": "No request samples",
      "spend.usage.metric.request_total_unavailable": "Request total unavailable",
      "spend.usage.metric.no_status_samples": "No status samples",
      "spend.usage.metric.no_completed_status_samples": "No completed status samples",
      "spend.usage.metric.no_latency_samples": "No latency samples",
      "spend.usage.metric.sample_count": `${vars.count} samples`,
      "ticket06.pricing.partial_hint": "Some tokens are not priced",
      "observability.evidence.cached": "Cached",
    };
    return map[key] || key;
  },
  getCopyLocale: () => "en-US",
}));

import { useProviderStats } from "../../../../hooks/use-provider-stats";

function makeProvider(overrides = {}) {
  const result = {
    provider_id: "codex",
    display_name: "Codex",
    request_count: 100,
    request_count_basis: "request_event",
    tokens: 50000,
    cost_usd: 1.5,
    success_rate: 100,
    avg_latency_ms: 830,
    status_sample_count: 100,
    success_rate_sample_count: 100,
    latency_sample_count: 90,
    ...overrides,
  };
  return result;
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

  it("keeps a refresh failure visible when an existing row remains on screen", () => {
    const refresh = vi.fn();
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: { providers: [makeProvider()], totals: {} },
      error: "network down",
      refresh,
    });

    render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("labels an initial cached range instead of presenting it as live", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      source: "cache",
      providers: { providers: [makeProvider()], totals: {} },
    });

    render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Cached");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
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
          makeProvider({ provider_id: "codex", display_name: "Codex" }),
          makeProvider({ provider_id: "anthropic", display_name: "Anthropic" }),
        ],
        totals: {},
      },
    });
    render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);

    const expectedHeaders = ["Provider", "Requests", "Tokens", "Cost", "Success Rate", "Avg Latency"];
    for (const header of expectedHeaders) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
    expect(screen.getByRole("table")).not.toHaveTextContent("Local list-price estimate");
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
  });

  it("default sort by tokens desc (higher tokens first)", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: {
        providers: [
          makeProvider({ provider_id: "anthropic", display_name: "Anthropic", tokens: 1000 }),
          makeProvider({ provider_id: "openai", display_name: "OpenAI", tokens: 50000 }),
        ],
        totals: {},
      },
    });
    const { container } = render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("OpenAI");
    expect(rows[1].textContent).toContain("Anthropic");
  });

  it("renders the true Provider identity instead of the Agent/source alias", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: {
        providers: [makeProvider({
          provider_id: "deepseek",
          display_name: "DeepSeek API",
          source: "hermes",
          source_display_name: "Hermes Agent",
        })],
        totals: {},
      },
    });
    render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByText("DeepSeek API")).toBeInTheDocument();
    expect(screen.queryByText("Hermes Agent")).not.toBeInTheDocument();
  });

  it("labels unavailable request, status, and latency samples precisely", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: {
        providers: [makeProvider({
          request_count: null,
          request_count_basis: "unavailable",
          conversation_count: 1623,
          success_rate: null,
          avg_latency_ms: null,
          status_sample_count: 0,
          latency_sample_count: 0,
        })],
        totals: {},
      },
    });

    const { container } = render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByText("Request total unavailable")).toBeInTheDocument();
    expect(screen.getByText("No status samples")).toBeInTheDocument();
    expect(screen.getByText("No latency samples")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("Not collected");
  });

  it("shows the measured sample denominator beside success rate and latency", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: { providers: [makeProvider({ status_sample_count: 26, success_rate_sample_count: 25, latency_sample_count: 23 })], totals: {} },
    });
    render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByText("25 samples")).toBeInTheDocument();
    expect(screen.getByText("23 samples")).toBeInTheDocument();
  });

  it("does not report unpriced cost as zero and distinguishes interrupted-only status samples", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: {
        providers: [makeProvider({
          cost_usd: 0,
          pricing_coverage: "unpriced",
          success_rate: null,
          status_sample_count: 4,
          success_rate_sample_count: 0,
        })],
        totals: {},
      },
    });

    const { container } = render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    const row = container.querySelector("tbody tr");
    expect(row).toHaveTextContent("—");
    expect(row).not.toHaveTextContent("$0");
    expect(within(row).getByText("No completed status samples")).toBeInTheDocument();
    expect(within(row).queryByText("No status samples")).not.toBeInTheDocument();
  });

  it("marks a partially priced subtotal as incomplete instead of presenting it as full coverage", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: { providers: [makeProvider({ cost_usd: 1.5, pricing_coverage: "partial" })], totals: {} },
    });

    render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);
    expect(screen.getByTitle("Some tokens are not priced")).toHaveTextContent("$1.50+");
  });

  it("requests the selected-range Provider view and never consumes legacy Agent aliases", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: {
        providers: [makeProvider({
          provider_id: "deepseek",
          display_name: "DeepSeek",
          source: "hermes",
          source_display_name: "Hermes Agent",
        })],
        totals: {},
      },
    });

    render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);

    expect(useProviderStats).toHaveBeenCalledWith(expect.objectContaining({
      from: "2026-06-01",
      to: "2026-06-30",
    }));
    expect(screen.getByText("DeepSeek")).toBeInTheDocument();
    expect(screen.queryByText("Hermes Agent")).not.toBeInTheDocument();
  });

  it("success rate 100% is green, <100% is orange", () => {
    useProviderStats.mockReturnValue({
      ...HOOK_DEFAULTS,
      providers: {
        providers: [
          makeProvider({ provider_id: "openai", display_name: "OpenAI", success_rate: 100 }),
          makeProvider({ provider_id: "anthropic", display_name: "Anthropic", success_rate: 95.5 }),
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
          makeProvider({ provider_id: "anthropic", display_name: "Anthropic", cost_usd: 0.5 }),
          makeProvider({ provider_id: "openai", display_name: "OpenAI", cost_usd: 5.0 }),
        ],
        totals: {},
      },
    });
    const { container } = render(<ProviderUsageTable from="2026-06-01" to="2026-06-30" />);

    // Default sort is tokens desc. Click "Cost" to sort by cost desc.
    fireEvent.click(screen.getByText("Cost"));
    let rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("OpenAI"); // cost 5.0 > 0.5

    // Click again to toggle to asc
    fireEvent.click(screen.getByText("Cost"));
    rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("Anthropic"); // cost 0.5 < 5.0
  });
});
