import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView } from "../DashboardView.jsx";

vi.mock("motion/react", () => ({
  motion: {
    button: ({ children, ...props }) => <button {...props}>{children}</button>,
    div: ({ children, ...props }) => <div {...props}>{children}</div>,
    span: ({ children, ...props }) => <span {...props}>{children}</span>,
  },
}));

vi.mock("../../../components", () => ({
  Shell: ({ children }) => <main>{children}</main>,
  Card: ({ children }) => <div>{children}</div>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));
vi.mock("../../components/CostAnalysisModal.jsx", () => ({ CostAnalysisModal: () => null }));
vi.mock("../../components/DataDetails.jsx", () => ({
  DataDetails: () => <div data-testid="dashboard-data-details" />,
}));
vi.mock("../../components/StatsPanel.jsx", () => ({
  StatsPanel: () => <div data-testid="dashboard-stats" />,
}));
vi.mock("../../components/UsageOverview.jsx", () => ({
  UsageOverview: () => <div data-testid="dashboard-usage-overview" />,
}));
vi.mock("../../components/TrendMonitor.jsx", () => ({
  TrendMonitor: () => <div data-testid="dashboard-trend" />,
}));
vi.mock("../../components/ModelUsageDonut.jsx", () => ({
  ModelUsageDonut: () => <div data-testid="dashboard-models" />,
}));
vi.mock("../../../foundation/FadeIn.jsx", () => ({
  FadeIn: ({ children }) => <div>{children}</div>,
}));
vi.mock("../../components/MacAppBanner.jsx", () => ({ MacAppBanner: () => null }));
vi.mock("../../components/WidgetOnboardingCard.jsx", () => ({ WidgetOnboardingCard: () => null }));
vi.mock("../../../../components/LoginCard.jsx", () => ({ LoginCard: () => null }));
vi.mock("../../../../components/DashboardSkeleton.jsx", () => ({ DashboardSkeleton: () => null }));
vi.mock("../../../marketing/LogoCarousel.jsx", () => ({ LogoCarousel: () => null }));
vi.mock("../../../marketing/agent-logos.js", () => ({ AGENT_LOGOS: [] }));

describe("DashboardView overview hierarchy", () => {
  it("keeps the trend in the wide primary workspace and quieter model/detail content around it", () => {
    render(
      <DashboardView
        copy={(key) => key}
        showAuthGate={false}
        showExpiredGate={false}
        initialDashboardLoading={false}
        screenshotMode={false}
        isLocalMode={false}
        shouldShowInstall={false}
        periodsForDisplay={[]}
        projectUsageEntries={[]}
        trendRowsForDisplay={[{ billable_total_tokens: 10 }]}
        modelUsageDistribution={{ rows: [], totalTokens: 0 }}
      />,
    );

    const primary = screen.getByTestId("dashboard-primary-workspace");
    const secondary = screen.getByTestId("dashboard-secondary-context");

    expect(primary).toHaveClass("lg:col-span-8");
    expect(within(primary).getByTestId("dashboard-usage-overview")).toBeInTheDocument();
    expect(within(primary).getByTestId("dashboard-trend")).toBeInTheDocument();
    expect(within(primary).getByTestId("dashboard-data-details")).toBeInTheDocument();
    expect(within(secondary).getByTestId("dashboard-stats")).toBeInTheDocument();
    expect(within(secondary).getByTestId("dashboard-models")).toBeInTheDocument();
    expect(within(secondary).queryByTestId("dashboard-trend")).not.toBeInTheDocument();
  });
});
