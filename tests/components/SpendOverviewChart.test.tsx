import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SpendOverviewChart } from "@/components/usage/SpendOverviewChart";
import type { CostLedgerSummary } from "@/types/usage";

const useCostLedgerSummaryMock = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
    i18n: {
      resolvedLanguage: "en",
      language: "en",
    },
  }),
}));

vi.mock("@/lib/query/usage", () => ({
  useCostLedgerSummary: (params?: unknown, options?: unknown) =>
    useCostLedgerSummaryMock(params, options),
}));

vi.mock("lucide-react", () => ({
  Loader2: ({ className }: { className?: string }) => (
    <div data-testid="loader" className={className} />
  ),
}));

const mockSuccessData: CostLedgerSummary = {
  periodStart: 1710000000,
  periodEnd: 1710086400,
  tokenCostUsd: "12.34",
  subscriptionCostUsd: "5.00",
  totalCostUsd: "17.34",
  cumulativeTokenCostUsd: "150.50",
  cumulativeSubscriptionCostUsd: "25.00",
  cumulativeTotalCostUsd: "175.50",
  byAgent: [
    {
      agentType: "claude",
      tokenCostUsd: "10.00",
      subscriptionCostUsd: "5.00",
      totalCostUsd: "15.00",
    },
  ],
};

describe("SpendOverviewChart", () => {
  beforeEach(() => {
    useCostLedgerSummaryMock.mockReset();
  });

  it("renders loading state", () => {
    useCostLedgerSummaryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<SpendOverviewChart />);

    expect(screen.getByTestId("loader")).toBeDefined();
  });

  it("renders error state", () => {
    useCostLedgerSummaryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<SpendOverviewChart />);

    expect(screen.getByText("加载失败")).toBeDefined();
  });

  it("renders success state with period and cumulative amounts", () => {
    useCostLedgerSummaryMock.mockReturnValue({
      data: mockSuccessData,
      isLoading: false,
      isError: false,
    });

    render(<SpendOverviewChart />);

    expect(screen.getByText("花销概览")).toBeDefined();
    expect(screen.getByText("本周期花销")).toBeDefined();
    expect(screen.getByText("累计花销")).toBeDefined();
  });

  it("displays correct USD amounts from CostLedgerSummary", () => {
    useCostLedgerSummaryMock.mockReturnValue({
      data: mockSuccessData,
      isLoading: false,
      isError: false,
    });

    render(<SpendOverviewChart />);

    expect(screen.getByText("$17.3400")).toBeDefined();
    expect(screen.getByText("$175.5000")).toBeDefined();
  });

  it("renders bar chart with period and cumulative bars", () => {
    useCostLedgerSummaryMock.mockReturnValue({
      data: mockSuccessData,
      isLoading: false,
      isError: false,
    });

    const { container } = render(<SpendOverviewChart />);

    const periodBar = container.querySelector('[data-testid="bar-period"]');
    const cumulativeBar = container.querySelector(
      "[data-testid=\"bar-cumulative\"]",
    );

    expect(periodBar).toBeDefined();
    expect(cumulativeBar).toBeDefined();
  });

  it("passes params to useCostLedgerSummary hook", () => {
    useCostLedgerSummaryMock.mockReturnValue({
      data: mockSuccessData,
      isLoading: false,
      isError: false,
    });

    const params = { startDate: 1710000000, endDate: 1710086400 };

    render(<SpendOverviewChart params={params} />);

    expect(useCostLedgerSummaryMock).toHaveBeenCalledWith(params, {
      refetchInterval: 30000,
    });
  });

  it("handles empty data state", () => {
    useCostLedgerSummaryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });

    render(<SpendOverviewChart />);

    expect(screen.getByText("加载失败")).toBeDefined();
  });
});
