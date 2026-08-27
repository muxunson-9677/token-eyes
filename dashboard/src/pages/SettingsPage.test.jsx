import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsBasicPage, SettingsCostPage } from "./SettingsPage.jsx";

// SettingsPage split tests for the v2.0 IA refactor (work order 01).
// Verifies basic settings excludes TokenPlanSection, cost settings includes
// TokenPlanSection, and neither duplicates management entries.

vi.mock("../components/LimitsSettingsPanel.jsx", () => ({
  LimitsSettingsPanel: () => <div data-testid="limits-panel">LimitsPanel</div>,
}));

vi.mock("../components/settings/AccountSection.jsx", () => ({
  AccountSection: () => <section data-testid="account-section">Account</section>,
}));

vi.mock("../components/settings/DataDirectoriesSection.jsx", () => ({
  DataDirectoriesSection: () => <section data-testid="data-dirs-section">DataDirs</section>,
}));

vi.mock("../components/settings/AgentPricingSection.jsx", () => ({
  AgentPricingSection: ({ onSummaryChange }) => {
    React.useEffect(() => onSummaryChange?.({ configuredCount: 27, customCount: 2 }), [onSummaryChange]);
    return <section data-testid="agent-pricing-section">AgentPricing</section>;
  },
}));

vi.mock("../components/settings/TokenPlanSection.jsx", () => ({
  TokenPlanSection: ({ onSummaryChange }) => {
    React.useEffect(() => onSummaryChange?.({ activeCount: 2, attentionCount: 1, costCny: 682.04 }), [onSummaryChange]);
    return <section data-testid="token-plan-section">TokenPlan</section>;
  },
}));

// 03-ia-api-balance: mock ProviderApiConfigSection so SettingsPage structural
// tests don't need to wire up the full provider API config + balance mocks.
// The anchor attribute is asserted separately for the insertion-point test.
vi.mock("../components/settings/ProviderApiConfigSection.jsx", () => ({
  ProviderApiConfigSection: ({ onSummaryChange }) => {
    React.useEffect(() => onSummaryChange?.({ total: 4, connected: 3, disconnected: 1, totalBalanceCny: 682.04 }), [onSummaryChange]);
    return (
      <section data-testid="provider-api-config-section" data-provider-api-config-anchor>
        ProviderApiConfig
      </section>
    );
  },
}));

vi.mock("../components/settings/OtherAiSpendSection.jsx", () => ({
  OtherAiSpendSection: ({ onSummaryChange }) => {
    React.useEffect(() => onSummaryChange?.({ groupCount: 4, currentMonthCny: 89.6, recordCount: 3 }), [onSummaryChange]);
    return <section data-testid="other-ai-spend-section" />;
  },
}));

vi.mock("../components/settings/AppearanceSection.jsx", () => ({
  AppearanceSection: () => <section data-testid="appearance-section">Appearance</section>,
}));

vi.mock("../components/settings/Controls.jsx", () => ({
  SectionCard: ({ title, children, icon: Icon, iconTestId }) => (
    <section data-testid="section-card">
      <h2>{title}</h2>
      {Icon ? <Icon data-testid={iconTestId} /> : null}
      {children}
    </section>
  ),
  SegmentedControl: () => <div data-testid="segmented-control" />,
}));

vi.mock("../components/settings/MenuBarSection.jsx", () => ({
  MenuBarSection: () => <section data-testid="menubar-section">MenuBar</section>,
  NativeAppFooter: () => <footer data-testid="native-app-footer">Footer</footer>,
}));

vi.mock("../hooks/use-limits-display-prefs.js", () => ({
  LIMIT_DISPLAY_MODES: { USED: "used", REMAINING: "remaining" },
  useLimitsDisplayPrefs: () => ({
    displayMode: "used",
    setDisplayMode: vi.fn(),
    visibleOrdered: ["claude"],
  }),
}));

vi.mock("../lib/copy", () => ({
  copy: (key) => `copy:${key}`,
}));

describe("SettingsBasicPage (v2.0 IA split)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders local settings without an account login card", () => {
    render(
      <MemoryRouter>
        <SettingsBasicPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("appearance-section")).toBeInTheDocument();
    expect(screen.getByTestId("menubar-section")).toBeInTheDocument();
    expect(screen.getByTestId("data-dirs-section")).toBeInTheDocument();
    expect(screen.queryByTestId("account-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-pricing-section")).not.toBeInTheDocument();
    expect(screen.getByTestId("limits-panel")).toBeInTheDocument();
    expect(screen.getByTestId("native-app-footer")).toBeInTheDocument();
  });

  it("does NOT render TokenPlanSection", () => {
    render(
      <MemoryRouter>
        <SettingsBasicPage />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("token-plan-section")).not.toBeInTheDocument();
  });

  // 03-ia-api-balance: basic settings must NOT contain provider API config.
  it("does NOT render ProviderApiConfigSection (03 work order)", () => {
    render(
      <MemoryRouter>
        <SettingsBasicPage />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("provider-api-config-section")).not.toBeInTheDocument();
  });

  it("uses a basic-settings page title (not the generic settings title)", () => {
    render(
      <MemoryRouter>
        <SettingsBasicPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("copy:settings.basic.page.title")).toBeInTheDocument();
  });

  it("keeps the accepted basic-settings visual identity without preview query parameters", () => {
    render(
      <MemoryRouter initialEntries={["/settings/basic"]}>
        <SettingsBasicPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("settings-basic-page")).toHaveClass(
      "tt-reference-route-settings-basic",
    );
  });

  it("uses the reference shield icon for limits display", () => {
    render(
      <MemoryRouter>
        <SettingsBasicPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("settings-limits-icon")).toHaveClass("lucide-shield");
  });
});

describe("SettingsCostPage (v2.0 IA split)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders TokenPlanSection", async () => {
    render(
      <MemoryRouter>
        <SettingsCostPage />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("token-plan-section")).toBeInTheDocument();
  });

  // 03-ia-api-balance: cost settings MUST contain provider API config.
  it("renders ProviderApiConfigSection (03 work order)", async () => {
    render(
      <MemoryRouter>
        <SettingsCostPage />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("provider-api-config-section")).toBeInTheDocument();
  });

  it("renders OtherAiSpendSection as the third cost-settings category", async () => {
    render(
      <MemoryRouter>
        <SettingsCostPage />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("other-ai-spend-section")).toBeInTheDocument();
  });

  it("renders four aligned cost overview cards from live section summaries", async () => {
    render(
      <MemoryRouter>
        <SettingsCostPage />
      </MemoryRouter>,
    );

    const cards = await screen.findAllByTestId(/cost-overview-card-/);
    expect(cards).toHaveLength(4);
    expect(screen.getByTestId("cost-overview-card-pricing")).toHaveTextContent("27");
    expect(screen.getByTestId("cost-overview-card-plans")).toHaveTextContent("2");
    expect(screen.getByTestId("cost-overview-card-providers")).toHaveTextContent("3 / 1");
    expect(screen.getByTestId("cost-overview-card-other")).toHaveTextContent("4");
    expect(screen.getByTestId("cost-overview-card-plans")).toHaveTextContent("682.04");
    expect(screen.getByTestId("cost-overview-card-other")).toHaveTextContent("89.60");
  });

  it("keeps cost configuration together and excludes general preferences", () => {
    render(
      <MemoryRouter>
        <SettingsCostPage />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("appearance-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("account-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("data-dirs-section")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-pricing-section")).toBeInTheDocument();
    expect(screen.queryByTestId("menubar-section")).not.toBeInTheDocument();
  });

  it("uses a cost-settings page title (not the generic settings title)", () => {
    render(
      <MemoryRouter>
        <SettingsCostPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("copy:settings.cost.page.title")).toBeInTheDocument();
  });

  it("does not expose inert import, export, or validation actions", () => {
    render(
      <MemoryRouter>
        <SettingsCostPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "copy:settings.reference.import" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "copy:settings.reference.export" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "copy:settings.reference.validate" })).not.toBeInTheDocument();
  });

  it("leaves a documented insertion point for ProviderApiConfigSection (work order 03)", () => {
    const { container } = render(
      <MemoryRouter>
        <SettingsCostPage />
      </MemoryRouter>,
    );
    // The 03 workorder will mount ProviderApiConfigSection below TokenPlan.
    // We assert a stable anchor comment/data attribute so 03 can target it.
    // Acceptable: a data attribute OR a comment node referencing the section.
    const html = container.innerHTML;
    expect(html).toMatch(/ProviderApiConfig|provider-api-config|provider_api_config/i);
  });
});
