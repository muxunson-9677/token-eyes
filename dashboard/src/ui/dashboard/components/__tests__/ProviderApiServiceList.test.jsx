import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderApiServiceList } from "../ProviderApiServiceList.jsx";

vi.mock("../../../../hooks/use-provider-stats", () => ({
  useRecentApiProviderStats: vi.fn(),
}));

vi.mock("../../../../hooks/useCurrency", () => ({
  useCurrency: () => ({ currency: "USD", rate: 1 }),
}));

vi.mock("../../../../lib/copy", () => ({
  copy: (key, vars = {}) => ({
    "spend.usage.provider_api.loading": "Loading API providers",
    "spend.usage.provider_api.error": "Failed to load API providers",
    "spend.usage.provider_api.retry": "Retry",
    "spend.usage.provider_api.empty": "No paid API providers in the last 7 days",
    "spend.usage.provider_api.account_unavailable": "Account unavailable",
    "spend.usage.provider_api.agent_count": `${vars.count} Agents`,
    "spend.usage.provider_api.model_count": `${vars.count} models`,
    "spend.usage.provider_api.period": `${vars.days} days`,
    "spend.usage.provider_api.balance": "Balance",
    "spend.usage.provider_api.cost_axis": "Spend (USD)",
    "spend.usage.provider_api.total_cost": "7-day spend",
    "spend.usage.provider_api.requests": "Requests",
    "spend.usage.provider_api.tokens": "Tokens",
    "spend.usage.provider_api.peak": "Peak",
    "spend.usage.provider_api.synced": `Synced ${vars.from} to ${vars.to}`,
    "observability.evidence.cached": "Cached",
    "spend.usage.provider_api.tooltip.agents": "Agent breakdown",
    "spend.usage.provider_api.tooltip.models": "Model breakdown",
    "spend.usage.provider_api.tooltip.cost": "Spend",
    "spend.usage.provider_api.tooltip.requests": "Requests",
    "spend.usage.provider_api.tooltip.tokens": "Tokens",
  }[key] || key),
  getCopyLocale: () => "en-US",
}));

import { useRecentApiProviderStats } from "../../../../hooks/use-provider-stats";

const DAYS = [
  ["2026-08-21", 1.2, 120, 2],
  ["2026-08-22", 2.4, 240, 3],
  ["2026-08-23", 1.8, 180, 4],
  ["2026-08-24", 3.2, 320, 5],
  ["2026-08-25", 2.8, 280, 4],
  ["2026-08-26", 4.6, 460, 6],
  ["2026-08-27", 3.4, 340, 5],
];

function provider(overrides = {}) {
  const period = { from: "2026-08-21", to: "2026-08-27", days: 7, time_zone: "UTC" };
  return {
    provider_id: "deepseek",
    display_name: "DeepSeek",
    account_label: "finance@company.com",
    agents: [{ id: "hermes", display_name: "Hermes", tokens: 1940, request_count: 29, cost_usd: 19.4 }],
    models: [{ id: "deepseek-chat", display_name: "deepseek-chat", tokens: 1940, request_count: 29, cost_usd: 19.4 }],
    period,
    daily: DAYS.map(([date, cost_usd, tokens, request_count]) => ({
      date,
      agents: [{ id: "hermes", display_name: "Hermes", tokens, request_count, cost_usd }],
      models: [{ id: "deepseek-chat", display_name: "deepseek-chat", tokens, request_count, cost_usd }],
      tokens,
      request_count,
      request_count_basis: "request_event",
      cost_usd,
      period,
    })),
    balance: { amount: 1245.8, currency: "CNY", observed_at: "2026-08-27T03:33:00.000Z" },
    request_count: 29,
    request_count_basis: "request_event",
    tokens: 1940,
    cost_usd: 19.4,
    cost_basis: { authority: "official_invoice", accuracy: "exact" },
    success_rate: 96.55,
    avg_latency_ms: 830,
    status_sample_count: 29,
    latency_sample_count: 27,
    ...overrides,
  };
}

const DEFAULT_HOOK = {
  providers: { providers: [], period: { from: "2026-08-21", to: "2026-08-27", days: 7 } },
  source: "edge",
  loading: false,
  error: null,
  refresh: vi.fn(),
  fetchedAt: "2026-08-27T03:33:00.000Z",
};

describe("ProviderApiServiceList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRecentApiProviderStats.mockReturnValue(DEFAULT_HOOK);
  });

  it("renders only positive-cost Provider cards with identity, period, metrics, and reliable balance", () => {
    useRecentApiProviderStats.mockReturnValue({
      ...DEFAULT_HOOK,
      providers: { providers: [provider(), provider({ provider_id: "glm", display_name: "GLM", cost_usd: 0 })] },
    });

    render(<ProviderApiServiceList from="2026-08-01" to="2026-08-27" visibleProviderIds={["hermes"]} />);

    expect(useRecentApiProviderStats).toHaveBeenCalledWith(expect.not.objectContaining({
      from: expect.anything(),
      to: expect.anything(),
    }));

    const cards = screen.getAllByTestId("provider-api-card");
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText("DeepSeek")).toBeInTheDocument();
    expect(within(cards[0]).getByText("finance@company.com")).toBeInTheDocument();
    expect(within(cards[0]).getByText("1 Agents")).toBeInTheDocument();
    expect(within(cards[0]).getByText("1 models")).toBeInTheDocument();
    expect(within(cards[0]).getByText("7 days · UTC")).toBeInTheDocument();
    expect(within(cards[0]).getByText(/CNY\s*1,245\.80/)).toBeInTheDocument();
    expect(within(cards[0]).getByText("29")).toBeInTheDocument();
    expect(within(cards[0]).getByText("1,940")).toBeInTheDocument();
    expect(cards[0]).not.toHaveTextContent("Local list-price estimate");
    expect(cards[0].querySelector('img[src="/brand-logos/deepseek.png"]')).not.toBeNull();
    expect(screen.queryByText("GLM")).not.toBeInTheDocument();
  });

  it("draws a smooth seven-day area and exposes the complete focused-day breakdown", () => {
    useRecentApiProviderStats.mockReturnValue({ ...DEFAULT_HOOK, providers: { providers: [provider()] } });
    render(<ProviderApiServiceList from="2026-08-01" to="2026-08-27" />);

    const line = screen.getByTestId("provider-api-area-line");
    expect(line.getAttribute("d")).toContain("C");
    expect(screen.getAllByTestId("provider-api-day-point")).toHaveLength(7);

    fireEvent.focus(screen.getAllByTestId("provider-api-day-point")[5]);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("2026-08-26");
    expect(tooltip).toHaveTextContent("Agent breakdown");
    expect(tooltip).toHaveTextContent("Hermes");
    expect(tooltip).toHaveTextContent("Model breakdown");
    expect(tooltip).toHaveTextContent("deepseek-chat");
    expect(tooltip).toHaveTextContent("460");
    expect(tooltip).toHaveTextContent("4.60");
    expect(tooltip).not.toHaveTextContent("%");
  });

  it("shows unavailable Agent and model cash attribution instead of fabricated zero spend", () => {
    const fixture = provider();
    fixture.daily[0].agents[0].cost_usd = null;
    fixture.daily[0].models[0].cost_usd = null;
    useRecentApiProviderStats.mockReturnValue({ ...DEFAULT_HOOK, providers: { providers: [fixture] } });

    render(<ProviderApiServiceList />);
    fireEvent.focus(screen.getAllByTestId("provider-api-day-point")[0]);

    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getAllByText("—")).toHaveLength(2);
    expect(tooltip).not.toHaveTextContent("$0.0000");
  });

  it("scales low-cost Provider curves to their real seven-day peak", () => {
    useRecentApiProviderStats.mockReturnValue({
      ...DEFAULT_HOOK,
      providers: {
        providers: [provider({
          cost_usd: 0.19,
          daily: provider().daily.map((day, index) => ({
            ...day,
            cost_usd: (index + 1) / 100,
          })),
        })],
      },
    });

    render(<ProviderApiServiceList from="2026-08-01" to="2026-08-27" />);

    const points = screen.getAllByTestId("provider-api-day-point");
    expect(Number(points.at(-1).getAttribute("cy"))).toBe(18);
  });

  it("does not fabricate an account or balance and retries a failed request", () => {
    const refresh = vi.fn();
    useRecentApiProviderStats.mockReturnValue({
      ...DEFAULT_HOOK,
      providers: { providers: [provider({ account_label: null, balance: null })] },
      error: "offline",
      refresh,
    });
    const { rerender } = render(<ProviderApiServiceList />);
    expect(screen.getByText("Account unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Balance")).not.toBeInTheDocument();

    useRecentApiProviderStats.mockReturnValue({ ...DEFAULT_HOOK, providers: null, error: "offline", refresh });
    rerender(<ProviderApiServiceList />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("labels cached fallback as stale, keeps the refresh failure visible, and never calls it synced", () => {
    const refresh = vi.fn();
    useRecentApiProviderStats.mockReturnValue({
      ...DEFAULT_HOOK,
      providers: { providers: [provider({ account_label: null, balance: null })] },
      source: "cache",
      error: "offline",
      refresh,
    });

    render(<ProviderApiServiceList />);

    expect(screen.getByText("Cached")).toBeInTheDocument();
    expect(screen.queryByText("Synced 2026-08-21 to 2026-08-27")).not.toBeInTheDocument();
    expect(screen.getByText("Failed to load API providers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Balance")).not.toBeInTheDocument();
  });
});
