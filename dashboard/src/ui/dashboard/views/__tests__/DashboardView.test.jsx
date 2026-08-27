import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView } from "../DashboardView.jsx";

const overviewStyles = readFileSync(resolve("src/ui/foundation/apple-glass.css"), "utf8");

vi.mock("motion/react", () => ({
  motion: {
    button: ({ children, ...props }) => <button {...props}>{children}</button>,
    div: ({ children, ...props }) => <div {...props}>{children}</div>,
    span: ({ children, ...props }) => <span {...props}>{children}</span>,
  },
}));

vi.mock("../../../components", () => ({
  Shell: ({ children, className }) => <main className={className}>{children}</main>,
  Card: ({ children }) => <div>{children}</div>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));
vi.mock("../../components/CostAnalysisModal.jsx", () => ({ CostAnalysisModal: () => null }));
vi.mock("../../components/DataDetails.jsx", () => ({
  DataDetails: () => <div data-testid="dashboard-data-details-content" />,
}));
vi.mock("../../components/StatsPanel.jsx", () => ({
  StatsPanel: ({ title }) => <div data-testid="dashboard-stats">{title}</div>,
}));
vi.mock("../../components/UsageOverview.jsx", () => ({
  UsageOverview: ({ className }) => <div className={className} data-testid="dashboard-usage-overview" />,
}));
vi.mock("../../components/TrendMonitor.jsx", () => ({
  TrendMonitor: ({ chartHeightClass }) => (
    <div data-testid="dashboard-trend" data-chart-height={chartHeightClass} />
  ),
}));
vi.mock("../../components/ModelUsageDonut.jsx", () => ({
  ModelUsageDonut: () => <div data-testid="dashboard-models" />,
}));
vi.mock("../../../foundation/FadeIn.jsx", () => ({
  FadeIn: ({ children, className }) => <div className={className}>{children}</div>,
}));
vi.mock("../../components/MacAppBanner.jsx", () => ({
  MacAppBanner: () => <div data-testid="dashboard-login-promotion" />,
}));
vi.mock("../../components/WidgetOnboardingCard.jsx", () => ({
  WidgetOnboardingCard: () => <div data-testid="dashboard-widget-promotion" />,
}));
vi.mock("../../../../components/LoginCard.jsx", () => ({ LoginCard: () => null }));
vi.mock("../../../../components/DashboardSkeleton.jsx", () => ({ DashboardSkeleton: () => null }));
vi.mock("../../../marketing/LogoCarousel.jsx", () => ({ LogoCarousel: () => null }));
vi.mock("../../../marketing/agent-logos.js", () => ({ AGENT_LOGOS: [] }));

describe("DashboardView overview hierarchy", () => {
  it("keeps the desktop Agent panel bottom aligned with the usage-trend card", () => {
    expect(overviewStyles).toMatch(
      /\/\* OV-01 desktop bottom-alignment contract \*\/[\s\S]*?@media \(min-width: 1081px\)[\s\S]*?\.tt-overview-provider-panel \{[\s\S]*?min-height: 247px;[\s\S]*?\}[\s\S]*?\.tt-overview-provider-panel \.tt-provider-card \{[\s\S]*?height: 144px;/,
    );
    expect(overviewStyles).toMatch(
      /\/\* OV-01 desktop bottom-alignment contract \*\/[\s\S]*?\.tt-overview-usage\.tt-overview-aligned-stack \{[\s\S]*?grid-template-rows: minmax\(0, 620px\) minmax\(247px, auto\);/,
    );
    expect(overviewStyles).toMatch(
      /\/\* OV-01 desktop bottom-alignment contract \*\/[\s\S]*?\.tt-overview-provider-panel \.grid\.grid-cols-2 \{[\s\S]*?grid-template-columns: none;[\s\S]*?grid-auto-flow: column;[\s\S]*?grid-auto-columns: clamp\(122px, 15\.75%, 129px\);[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: hidden;/,
    );
  });

  it("does not render the login or desktop-widget promotions in the locked overview", () => {
    render(
      <DashboardView
        copy={(key) => key}
        showAuthGate={false}
        showExpiredGate={false}
        initialDashboardLoading={false}
        screenshotMode={false}
        isLocalMode
        shouldShowInstall={false}
        periodsForDisplay={[]}
        projectUsageEntries={[]}
        trendRowsForDisplay={[]}
        modelUsageDistribution={{ rows: [], totalTokens: 0 }}
      />,
    );

    expect(screen.queryByTestId("dashboard-login-promotion")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-widget-promotion")).not.toBeInTheDocument();
  });

  it("keeps the top overview intact and aligns model distribution with daily details below", () => {
    const openUsageDetails = vi.fn();
    const openCost = vi.fn();
    const openDataSources = vi.fn();
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
        onOpenUsageDetails={openUsageDetails}
        onOpenCost={openCost}
        onOpenDataSources={openDataSources}
      />,
    );

    const overviewGrid = screen.getByTestId("dashboard-overview-grid");
    const primary = screen.getByTestId("dashboard-primary-workspace");
    const secondary = screen.getByTestId("dashboard-secondary-context");
    const details = screen.getByTestId("dashboard-detail-grid");
    expect(overviewGrid).toHaveClass("tt-reference-overview-grid");
    expect(overviewGrid.closest(".tt-reference-route-dashboard")).not.toBeNull();
    expect(overviewGrid.parentElement).toHaveClass("tt-overview-locked");
    expect(primary).toBeVisible();
    expect(primary).not.toHaveClass("lg:col-span-7");
    expect(secondary).toBeVisible();
    expect(secondary).not.toHaveClass("tt-overview-aligned-stack");
    expect(secondary).not.toHaveClass("lg:col-span-5");
    expect(within(primary).getByTestId("dashboard-usage-overview")).toBeVisible();
    expect(within(primary).getByTestId("dashboard-usage-overview")).toHaveClass("h-full");
    expect(within(primary).getByTestId("dashboard-usage-overview").parentElement).toHaveClass("h-full");
    expect(within(primary).queryByTestId("dashboard-data-details")).not.toBeInTheDocument();
    expect(within(secondary).getByText("dashboard.identity.title")).toBeVisible();
    expect(within(secondary).getByTestId("dashboard-trend")).toBeVisible();
    expect(within(secondary).getByTestId("dashboard-trend")).toHaveAttribute(
      "data-chart-height",
      "h-36",
    );
    expect(screen.queryByTestId("dashboard-trend-row")).not.toBeInTheDocument();
    expect(within(secondary).queryByTestId("dashboard-models")).not.toBeInTheDocument();
    expect(within(details).getByTestId("dashboard-models")).toBeVisible();
    expect(within(details).getByTestId("dashboard-data-details")).toBeVisible();
    expect(details).toHaveClass("lg:grid-cols-12", "lg:h-[32rem]");
    for (const column of Array.from(details.children)) {
      expect(column).toHaveClass("h-full", "min-h-0");
    }
    expect(screen.queryByTestId("dashboard-core-actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "dashboard.actions.usage_details" })).not.toBeInTheDocument();
    expect(openUsageDetails).not.toHaveBeenCalled();
  });

  it("never renders an initialization card inside the overview", () => {
    render(
      <DashboardView
        copy={(key) => key}
        showAuthGate={false}
        showExpiredGate={false}
        initialDashboardLoading={false}
        screenshotMode={false}
        isLocalMode={false}
        shouldShowInstall
        installPrompt="本地服务已连接"
        installInitCmdDisplay="npx --yes tokentracker-cli init"
        installCopyLabel="复制 Token Eyes 初始化命令"
        installCopiedLabel="已复制"
        handleCopyInstall={() => {}}
        periodsForDisplay={[]}
        projectUsageEntries={[]}
        trendRowsForDisplay={[]}
        modelUsageDistribution={{ rows: [], totalTokens: 0 }}
      />,
    );

    expect(screen.queryByText("本地服务已连接")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制 Token Eyes 初始化命令" })).not.toBeInTheDocument();
  });

  it("shows a recoverable error surface when overview data has never loaded", () => {
    const refresh = vi.fn();
    const openDataSources = vi.fn();
    const copyDiagnostics = vi.fn();

    render(
      <DashboardView
        copy={(key) => key}
        showAuthGate={false}
        showExpiredGate={false}
        initialDashboardLoading={false}
        screenshotMode={false}
        isLocalMode
        shouldShowInstall={false}
        usageError="local service unavailable"
        usageHasData={false}
        refreshAll={refresh}
        onOpenDataSources={openDataSources}
        onCopyUsageDiagnostics={copyDiagnostics}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("dashboard.usage_error.title");
    expect(screen.getByText("local service unavailable")).toBeInTheDocument();
    screen.getByRole("button", { name: "dashboard.usage_error.retry" }).click();
    screen.getByRole("button", { name: "dashboard.usage_error.open_data_sources" }).click();
    screen.getByRole("button", { name: "dashboard.usage_error.copy_diagnostics" }).click();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(openDataSources).toHaveBeenCalledTimes(1);
    expect(copyDiagnostics).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("dashboard-usage-overview")).not.toBeInTheDocument();
  });

  it("keeps overview data visible and labels it stale after refresh fails", () => {
    render(
      <DashboardView
        copy={(key) => key}
        showAuthGate={false}
        showExpiredGate={false}
        initialDashboardLoading={false}
        screenshotMode={false}
        isLocalMode
        shouldShowInstall={false}
        usageError="request timed out"
        usageHasData
        usageSource="cache"
        usageLastSuccessAt="2026-08-01T01:02:03.000Z"
        periodsForDisplay={[]}
        projectUsageEntries={[]}
        trendRowsForDisplay={[]}
        modelUsageDistribution={{ rows: [], totalTokens: 0 }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("dashboard.usage_error.stale_title");
    expect(screen.getByRole("status")).toHaveTextContent("request timed out");
    expect(screen.getByRole("status").querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-08-01T01:02:03.000Z",
    );
    expect(screen.getByTestId("dashboard-usage-overview")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-secondary-context")).toBeVisible();
    expect(screen.getByTestId("dashboard-data-details")).toBeVisible();
    expect(screen.queryByTestId("dashboard-system-strip")).not.toBeInTheDocument();
  });
});
