/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://app.tokeneyes.example/"}
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";

// Route-resolution tests for the v2.0 IA refactor (work order 01).
// Verifies the four sub-routes render the right page component, the
// legacy /spend and /settings paths redirect to their default children,
// and the Tauri root entry starts the automatic discovery flow.

const TEXT = {
  dashboard: "Dashboard page",
  spendUsage: "Spend usage page",
  spendCost: "Spend cost page",
  planMarket: "Plan market page",
  settingsBasic: "Settings basic page",
  settingsCost: "Settings cost page",
  tokenPlanEditor: "Token plan editor page",
  leaderboard: "Leaderboard page",
  leaderboardRules: "Leaderboard rules page",
  leaderboardProfile: "Leaderboard profile page",
  resetHistory: "Reset history page",
  widgets: "Widgets page",
  login: "Login page",
  sidebarShell: "Sidebar shell",
  firstRun: "First run discovery page",
  dataSources: "Data sources page",
};

const insforgeMock = vi.hoisted(() => ({
  enabled: true,
  signedIn: true,
  loading: false,
  user: { id: "user-1" },
  displayName: "Ada",
  getAccessToken: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("./lib/dashboard-preload.js", () => ({
  getLeaderboardPreloadContextKey: vi.fn(() => "ctx"),
  markDashboardMainContentVisible: vi.fn(),
  preloadDashboardPageResources: vi.fn(() => Promise.resolve()),
  preloadLeaderboardDefaultState: vi.fn(() => Promise.resolve()),
}));

vi.mock("./hooks/useLocale.js", () => ({
  useLocale: () => ({ resolvedLocale: "en" }),
}));

vi.mock("./contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => insforgeMock,
}));

vi.mock("./hooks/use-leaderboard-participation-sync", () => ({
  useLeaderboardParticipationSync: vi.fn(),
}));

vi.mock("./lib/mock-data", () => ({
  isMockEnabled: () => false,
}));

vi.mock("./lib/config", () => ({
  getBackendBaseUrl: () => "",
  getLeaderboardBaseUrl: () => "https://edge.example",
}));

vi.mock("./lib/screenshot-mode", () => ({
  isScreenshotModeEnabled: () => false,
}));

vi.mock("./components/ErrorBoundary.jsx", () => ({
  ErrorBoundary: ({ children }) => <>{children}</>,
}));

vi.mock("./ui/foundation/ThemeProvider.jsx", () => ({
  ThemeProvider: ({ children }) => <>{children}</>,
}));

vi.mock("./contexts/LoginModalContext.jsx", () => ({
  LoginModalProvider: ({ children }) => <>{children}</>,
}));

vi.mock("./components/LoginModal.jsx", () => ({
  LoginModal: () => null,
}));

vi.mock("@vercel/analytics/react", () => ({
  Analytics: () => null,
}));

vi.mock("@vercel/speed-insights/react", () => ({
  SpeedInsights: () => null,
}));

vi.mock("./ui/components/Sidebar.jsx", () => ({
  // Real AppLayout wraps children so showSidebar-bearing routes render the
  // shell. The mock exposes a sentinel so tests can assert the sidebar is
  // present without depending on nav internals.
  AppLayout: ({ children }) => (
    <div data-testid="sidebar-shell">
      <span>{TEXT.sidebarShell}</span>
      {children}
    </div>
  ),
}));

vi.mock("./ui/dashboard/components/CommandPalette.jsx", () => ({
  CommandPalette: () => null,
}));

vi.mock("./pages/DashboardPage.jsx", () => ({
  DashboardPage: () => <main>{TEXT.dashboard}</main>,
}));

vi.mock("./pages/NativeAuthCallbackPage.jsx", () => ({
  NativeAuthCallbackPage: () => null,
}));

vi.mock("./pages/IpCheckPage.jsx", () => ({ default: () => null }));
vi.mock("./pages/LandingPage.jsx", () => ({ LandingPage: () => null }));
vi.mock("./pages/LeaderboardProfilePage.jsx", () => ({
  LeaderboardProfilePage: () => <main>{TEXT.leaderboardProfile}</main>,
}));
vi.mock("./pages/LoginPage.jsx", () => ({
  LoginPage: () => <main>{TEXT.login}</main>,
}));
vi.mock("./pages/DevicePage.jsx", () => ({ default: () => null }));
vi.mock("./pages/WrappedPage.jsx", () => ({ default: () => null }));
vi.mock("./pages/SkillsPage.jsx", () => ({ SkillsPage: () => null }));
vi.mock("./pages/WidgetsPage.jsx", () => ({ WidgetsPage: () => <main>{TEXT.widgets}</main> }));
vi.mock("./pages/LeaderboardPage.jsx", () => ({
  LeaderboardPage: () => <main>{TEXT.leaderboard}</main>,
}));
vi.mock("./pages/LeaderboardRulesPage.jsx", () => ({
  LeaderboardRulesPage: () => <main>{TEXT.leaderboardRules}</main>,
}));
vi.mock("./pages/ResetHistoryPage", () => ({
  ResetHistoryPage: () => <main>{TEXT.resetHistory}</main>,
}));

// SpendPage.jsx must export SpendUsagePage and SpendCostPage.
vi.mock("./pages/SpendPage.jsx", () => ({
  SpendUsagePage: () => <main>{TEXT.spendUsage}</main>,
  SpendCostPage: () => <main>{TEXT.spendCost}</main>,
}));
vi.mock("./pages/PlanMarketPage.jsx", () => ({
  PlanMarketPage: () => <main>{TEXT.planMarket}</main>,
}));

// SettingsPage.jsx must export SettingsBasicPage and SettingsCostPage.
vi.mock("./pages/SettingsPage.jsx", () => ({
  SettingsBasicPage: () => <main>{TEXT.settingsBasic}</main>,
  SettingsCostPage: () => <main>{TEXT.settingsCost}</main>,
}));
vi.mock("./pages/TokenPlanEditorPage.jsx", () => ({
  TokenPlanEditorPage: () => <main>{TEXT.tokenPlanEditor}</main>,
}));
vi.mock("./pages/FirstRunPage.jsx", () => ({
  FirstRunPage: () => <main>{TEXT.firstRun}</main>,
}));
vi.mock("./pages/DataSourcesPage.jsx", () => ({
  DataSourcesPage: () => <main>{TEXT.dataSources}</main>,
}));

function renderApp(initialPath = "/dashboard") {
  window.history.pushState({}, "", initialPath);
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  return <output data-testid="route-location">{useLocation().pathname}</output>;
}

describe("App routes (v2.0 IA refactor)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insforgeMock.enabled = true;
    insforgeMock.signedIn = true;
    insforgeMock.loading = false;
    insforgeMock.user = { id: "user-1" };
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
  });

  it("/spend/usage renders SpendUsagePage with sidebar", async () => {
    renderApp("/spend/usage");
    // React.lazy() suspends on first render; findByText waits for the
    // mocked chunk to resolve before asserting.
    expect(await screen.findByText(TEXT.spendUsage)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
  });

  it("/spend/cost renders SpendCostPage with sidebar", async () => {
    renderApp("/spend/cost");
    expect(await screen.findByText(TEXT.spendCost)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
  });

  it("/spend/plans renders the full-width plan market without the navigation shell", async () => {
    renderApp("/spend/plans");
    expect(await screen.findByText(TEXT.planMarket)).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-shell")).not.toBeInTheDocument();
  });

  it("/settings/basic renders SettingsBasicPage with sidebar", async () => {
    renderApp("/settings/basic");
    expect(await screen.findByText(TEXT.settingsBasic)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
  });

  it("/settings/data renders source diagnostics with sidebar", async () => {
    renderApp("/settings/data");
    expect(await screen.findByText(TEXT.dataSources)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent("/settings/data");
  });

  it("/data-sources redirects to the canonical settings data route", async () => {
    renderApp("/data-sources");
    expect(await screen.findByText(TEXT.dataSources)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent("/settings/data");
  });

  it("/settings/cost renders SettingsCostPage with sidebar", async () => {
    renderApp("/settings/cost");
    expect(await screen.findByText(TEXT.settingsCost)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
  });

  it("/reset-history renders ResetHistoryPage with sidebar", async () => {
    renderApp("/reset-history");
    expect(await screen.findByText(TEXT.resetHistory)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
  });

  it("/widgets remains reachable with the sidebar as pending macOS-only functionality", async () => {
    renderApp("/widgets");
    expect(await screen.findByText(TEXT.widgets)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
  });

  it("/settings/cost/token-plans/new renders the child editor with sidebar", async () => {
    renderApp("/settings/cost/token-plans/new");
    expect(await screen.findByText(TEXT.tokenPlanEditor)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
  });

  it("/settings/cost/token-plans/:id/edit renders the child editor with sidebar", async () => {
    renderApp("/settings/cost/token-plans/plan-1/edit");
    expect(await screen.findByText(TEXT.tokenPlanEditor)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
  });

  it("/spend redirects to /spend/usage (replace)", async () => {
    renderApp("/spend");
    expect(await screen.findByText(TEXT.spendUsage)).toBeInTheDocument();
    expect(screen.queryByText(TEXT.spendCost)).not.toBeInTheDocument();
  });

  it("/settings redirects to /settings/basic (replace)", async () => {
    renderApp("/settings");
    expect(await screen.findByText(TEXT.settingsBasic)).toBeInTheDocument();
    expect(screen.queryByText(TEXT.settingsCost)).not.toBeInTheDocument();
  });

  it("/leaderboard remains publicly reachable instead of redirecting to dashboard", async () => {
    insforgeMock.signedIn = false;
    insforgeMock.user = null;
    renderApp("/leaderboard");
    expect(window.location.hostname).toBe("app.tokeneyes.example");
    expect(await screen.findByText(TEXT.leaderboard)).toBeInTheDocument();
    expect(screen.queryByText(TEXT.login)).not.toBeInTheDocument();
    expect(screen.queryByText(TEXT.dashboard)).not.toBeInTheDocument();
    expect(screen.queryByText(TEXT.sidebarShell)).not.toBeInTheDocument();
  });

  it("/leaderboard/rules remains publicly reachable", async () => {
    insforgeMock.signedIn = false;
    insforgeMock.user = null;
    renderApp("/leaderboard/rules");
    expect(window.location.hostname).toBe("app.tokeneyes.example");
    expect(await screen.findByText(TEXT.leaderboardRules)).toBeInTheDocument();
    expect(screen.queryByText(TEXT.login)).not.toBeInTheDocument();
    expect(screen.queryByText(TEXT.dashboard)).not.toBeInTheDocument();
  });

  it("public leaderboard profiles remain reachable", async () => {
    insforgeMock.signedIn = false;
    insforgeMock.user = null;
    renderApp("/u/user-123");
    expect(window.location.hostname).toBe("app.tokeneyes.example");
    expect(await screen.findByText(TEXT.leaderboardProfile)).toBeInTheDocument();
    expect(screen.queryByText(TEXT.login)).not.toBeInTheDocument();
    expect(screen.queryByText(TEXT.dashboard)).not.toBeInTheDocument();
  });
});

describe("App Tauri root entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insforgeMock.enabled = true;
    insforgeMock.signedIn = true;
    insforgeMock.loading = false;
    insforgeMock.user = { id: "user-1" };
    window.history.pushState({}, "", "/");
  });

  it("Tauri root '/' opens automatic discovery before settings", async () => {
    vi.doMock("./lib/native-bridge.js", () => ({
      isTauriApp: () => true,
      isNativeApp: () => false,
      isNativeEmbed: () => false,
      isNativeWindowsApp: () => false,
    }));
    // Re-import App after the mock takes effect. Modules are cached, so we
    // reset the registry to force a fresh evaluation with the new mock.
    vi.resetModules();
    const { default: AppFresh } = await import("./App.jsx");
    window.history.pushState({}, "", "/");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppFresh />
      </MemoryRouter>,
    );
    // After vi.resetModules(), React.lazy() re-suspends on first render
    // (the mocked module re-resolves asynchronously). Use findByText to
    // wait for the redirected page content to appear.
    expect(await screen.findByText(TEXT.firstRun)).toBeInTheDocument();
    expect(screen.queryByText(TEXT.settingsBasic)).not.toBeInTheDocument();
    vi.doUnmock("./lib/native-bridge.js");
    vi.resetModules();
  });

  it("Tauri root opens the dashboard after first-run discovery was completed", async () => {
    window.localStorage.setItem("tokentracker.firstRun.completed.v1", "1");
    vi.doMock("./lib/native-bridge.js", () => ({
      isTauriApp: () => true,
      isNativeApp: () => false,
      isNativeEmbed: () => false,
      isNativeWindowsApp: () => false,
    }));
    vi.resetModules();
    const { default: AppFresh } = await import("./App.jsx");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppFresh />
      </MemoryRouter>,
    );

    expect(await screen.findByText(TEXT.dashboard)).toBeInTheDocument();
    expect(screen.queryByText(TEXT.firstRun)).not.toBeInTheDocument();
    vi.doUnmock("./lib/native-bridge.js");
    vi.resetModules();
  });

  it("Tauri leaderboard and rules routes render inside the sidebar shell", async () => {
    vi.doMock("./lib/native-bridge.js", () => ({
      isTauriApp: () => true,
      isNativeApp: () => true,
      isNativeEmbed: () => false,
      isNativeWindowsApp: () => false,
    }));
    vi.resetModules();
    const { default: AppFresh } = await import("./App.jsx");

    const leaderboardRender = render(
      <MemoryRouter initialEntries={["/leaderboard"]}>
        <AppFresh />
      </MemoryRouter>,
    );
    expect(await screen.findByText(TEXT.leaderboard)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
    leaderboardRender.unmount();

    render(
      <MemoryRouter initialEntries={["/leaderboard/rules"]}>
        <AppFresh />
      </MemoryRouter>,
    );
    expect(await screen.findByText(TEXT.leaderboardRules)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
    vi.doUnmock("./lib/native-bridge.js");
    vi.resetModules();
  });
});
