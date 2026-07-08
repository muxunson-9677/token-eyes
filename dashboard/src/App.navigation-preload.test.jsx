import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import {
  preloadDashboardPageResources,
  preloadLeaderboardDefaultState,
} from "./lib/dashboard-preload.js";

const TEXT = {
  dashboard: "Dashboard page",
  device: "Device page",
  ipCheck: "IP check",
  landing: "Landing page",
  // Navigation targets must be real Sidebar destinations that are NOT
  // MVP-hidden. App.jsx marks /limits, /leaderboard, /skills, /widgets,
  // /ip-check and /wrapped as isMvpHiddenProductPath and redirects them to
  // /dashboard, so they can never be reached. The real Sidebar only exposes
  // /dashboard, /spend and /settings; use the latter two to verify that
  // navigation completes while preload promises are still pending.
  settings: "Settings page",
  settingsNav: "Settings nav",
  spend: "Spend page",
  spendNav: "Spend nav",
  login: "Login page",
  nativeCallback: "Native callback",
  profile: "Profile page",
  reveal: "reveal main content",
  skills: "Skills page",
  widgets: "Widgets page",
  wrapped: "Wrapped page",
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

const pending = vi.hoisted(() => new Promise(() => {}));

vi.mock("./lib/dashboard-preload.js", () => ({
  getLeaderboardPreloadContextKey: vi.fn((options = {}) =>
    [
      options.accessMode || "",
      options.baseUrl || "",
      String(Boolean(options.mockEnabled)),
      String(Boolean(options.signedIn)),
      String(Boolean(options.authLoading)),
      options.userId || "null",
    ].join("|"),
  ),
  markDashboardMainContentVisible: vi.fn(),
  preloadDashboardPageResources: vi.fn(() => pending),
  preloadLeaderboardDefaultState: vi.fn(() => pending),
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

vi.mock("./ui/components/Sidebar.jsx", async () => {
  const { Link } = await vi.importActual("react-router-dom");
  return {
    AppLayout: ({ children }) => (
      <div>
        <nav>
          <Link to="/settings">{TEXT.settingsNav}</Link>
          <Link to="/spend">{TEXT.spendNav}</Link>
        </nav>
        {children}
      </div>
    ),
  };
});

vi.mock("./ui/dashboard/components/CommandPalette.jsx", () => ({
  CommandPalette: () => null,
}));

vi.mock("./pages/DashboardPage.jsx", () => ({
  DashboardPage: ({ onMainContentVisible }) => (
    <main>
      <h1>{TEXT.dashboard}</h1>
      <button type="button" onClick={onMainContentVisible}>
        {TEXT.reveal}
      </button>
    </main>
  ),
}));

vi.mock("./pages/NativeAuthCallbackPage.jsx", () => ({
  NativeAuthCallbackPage: () => <main>{TEXT.nativeCallback}</main>,
}));

vi.mock("./pages/IpCheckPage.jsx", () => ({ default: () => <main>{TEXT.ipCheck}</main> }));
vi.mock("./pages/LandingPage.jsx", () => ({ LandingPage: () => <main>{TEXT.landing}</main> }));
vi.mock("./pages/LeaderboardProfilePage.jsx", () => ({ LeaderboardProfilePage: () => <main>{TEXT.profile}</main> }));
vi.mock("./pages/LoginPage.jsx", () => ({ LoginPage: () => <main>{TEXT.login}</main> }));
vi.mock("./pages/DevicePage.jsx", () => ({ default: () => <main>{TEXT.device}</main> }));
vi.mock("./pages/WrappedPage.jsx", () => ({ default: () => <main>{TEXT.wrapped}</main> }));
vi.mock("./pages/SettingsPage.jsx", () => ({
  SettingsBasicPage: () => <main>{TEXT.settings}</main>,
  SettingsCostPage: () => <main>{TEXT.settings}</main>,
}));
vi.mock("./pages/SpendPage.jsx", () => ({
  SpendUsagePage: () => <main>{TEXT.spend}</main>,
  SpendCostPage: () => <main>{TEXT.spend}</main>,
}));
vi.mock("./pages/SkillsPage.jsx", () => ({ SkillsPage: () => <main>{TEXT.skills}</main> }));
vi.mock("./pages/WidgetsPage.jsx", () => ({ WidgetsPage: () => <main>{TEXT.widgets}</main> }));

function renderApp(initialPath = "/dashboard") {
  window.history.pushState({}, "", initialPath);
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

async function startPendingPreload(user) {
  renderApp("/dashboard");
  expect(await screen.findByText(TEXT.dashboard)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: TEXT.reveal }));
  await waitFor(() => {
    expect(preloadDashboardPageResources).toHaveBeenCalledTimes(1);
    expect(preloadLeaderboardDefaultState).toHaveBeenCalledTimes(1);
  });
}

describe("App navigation while preload is pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("switches to /settings without waiting for pending preload promises", async () => {
    const user = userEvent.setup();
    await startPendingPreload(user);

    await act(async () => {
      await user.click(screen.getByRole("link", { name: TEXT.settingsNav }));
    });

    expect(await screen.findByText(TEXT.settings)).toBeInTheDocument();
  });

  it("switches to /spend without waiting for pending preload promises", async () => {
    const user = userEvent.setup();
    await startPendingPreload(user);

    await act(async () => {
      await user.click(screen.getByRole("link", { name: TEXT.spendNav }));
    });

    expect(await screen.findByText(TEXT.spend)).toBeInTheDocument();
  });
});
