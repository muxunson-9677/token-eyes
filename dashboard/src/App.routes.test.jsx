import React from "react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";

// Route-resolution tests for the v2.0 IA refactor (work order 01).
// Verifies the four sub-routes render the right page component, the
// legacy /spend and /settings paths redirect to their default children,
// and the Tauri root entry redirects to /settings/basic.

const TEXT = {
  dashboard: "Dashboard page",
  spendUsage: "Spend usage page",
  spendCost: "Spend cost page",
  settingsBasic: "Settings basic page",
  settingsCost: "Settings cost page",
  sidebarShell: "Sidebar shell",
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

vi.mock("./hooks/use-cloud-usage-sync", () => ({
  useCloudUsageSync: vi.fn(),
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
vi.mock("./pages/LeaderboardProfilePage.jsx", () => ({ LeaderboardProfilePage: () => null }));
vi.mock("./pages/LoginPage.jsx", () => ({ LoginPage: () => null }));
vi.mock("./pages/DevicePage.jsx", () => ({ default: () => null }));
vi.mock("./pages/WrappedPage.jsx", () => ({ default: () => null }));
vi.mock("./pages/SkillsPage.jsx", () => ({ SkillsPage: () => null }));
vi.mock("./pages/WidgetsPage.jsx", () => ({ WidgetsPage: () => null }));
vi.mock("./pages/LeaderboardPage.jsx", () => ({ LeaderboardPage: () => null }));

// SpendPage.jsx must export SpendUsagePage and SpendCostPage.
vi.mock("./pages/SpendPage.jsx", () => ({
  SpendUsagePage: () => <main>{TEXT.spendUsage}</main>,
  SpendCostPage: () => <main>{TEXT.spendCost}</main>,
}));

// SettingsPage.jsx must export SettingsBasicPage and SettingsCostPage.
vi.mock("./pages/SettingsPage.jsx", () => ({
  SettingsBasicPage: () => <main>{TEXT.settingsBasic}</main>,
  SettingsCostPage: () => <main>{TEXT.settingsCost}</main>,
}));

function renderApp(initialPath = "/dashboard") {
  window.history.pushState({}, "", initialPath);
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App routes (v2.0 IA refactor)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
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

  it("/settings/basic renders SettingsBasicPage with sidebar", async () => {
    renderApp("/settings/basic");
    expect(await screen.findByText(TEXT.settingsBasic)).toBeInTheDocument();
    expect(screen.getByText(TEXT.sidebarShell)).toBeInTheDocument();
  });

  it("/settings/cost renders SettingsCostPage with sidebar", async () => {
    renderApp("/settings/cost");
    expect(await screen.findByText(TEXT.settingsCost)).toBeInTheDocument();
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
});

describe("App Tauri root entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("Tauri root '/' redirects to /settings/basic", async () => {
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
    expect(await screen.findByText(TEXT.settingsBasic)).toBeInTheDocument();
    vi.doUnmock("./lib/native-bridge.js");
    vi.resetModules();
  });
});
