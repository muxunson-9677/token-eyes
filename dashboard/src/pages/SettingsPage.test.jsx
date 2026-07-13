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
  AgentPricingSection: () => <section data-testid="agent-pricing-section">AgentPricing</section>,
}));

vi.mock("../components/settings/TokenPlanSection.jsx", () => ({
  TokenPlanSection: () => <section data-testid="token-plan-section">TokenPlan</section>,
}));

// 03-ia-api-balance: mock ProviderApiConfigSection so SettingsPage structural
// tests don't need to wire up the full provider API config + balance mocks.
// The anchor attribute is asserted separately for the insertion-point test.
vi.mock("../components/settings/ProviderApiConfigSection.jsx", () => ({
  ProviderApiConfigSection: () => (
    <section data-testid="provider-api-config-section" data-provider-api-config-anchor>
      ProviderApiConfig
    </section>
  ),
}));

vi.mock("../components/settings/OtherAiSpendSection.jsx", () => ({
  OtherAiSpendSection: () => <section data-testid="other-ai-spend-section" />,
}));

vi.mock("../components/settings/AppearanceSection.jsx", () => ({
  AppearanceSection: () => <section data-testid="appearance-section">Appearance</section>,
}));

vi.mock("../components/settings/Controls.jsx", () => ({
  SectionCard: ({ title, children }) => (
    <section data-testid="section-card">
      <h2>{title}</h2>
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

  it("renders Appearance, MenuBar, Account, DataDirs, AgentPricing, Limits, Footer", () => {
    render(
      <MemoryRouter>
        <SettingsBasicPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("appearance-section")).toBeInTheDocument();
    expect(screen.getByTestId("menubar-section")).toBeInTheDocument();
    expect(screen.getByTestId("account-section")).toBeInTheDocument();
    expect(screen.getByTestId("data-dirs-section")).toBeInTheDocument();
    expect(screen.getByTestId("agent-pricing-section")).toBeInTheDocument();
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
});

describe("SettingsCostPage (v2.0 IA split)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders TokenPlanSection", () => {
    render(
      <MemoryRouter>
        <SettingsCostPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("token-plan-section")).toBeInTheDocument();
  });

  // 03-ia-api-balance: cost settings MUST contain provider API config.
  it("renders ProviderApiConfigSection (03 work order)", () => {
    render(
      <MemoryRouter>
        <SettingsCostPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("provider-api-config-section")).toBeInTheDocument();
  });

  it("renders OtherAiSpendSection as the third cost-settings category", () => {
    render(
      <MemoryRouter>
        <SettingsCostPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("other-ai-spend-section")).toBeInTheDocument();
  });

  it("does NOT render Appearance / Account / DataDirs / AgentPricing / MenuBar", () => {
    render(
      <MemoryRouter>
        <SettingsCostPage />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("appearance-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("account-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("data-dirs-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-pricing-section")).not.toBeInTheDocument();
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
