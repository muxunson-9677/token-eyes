import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { RuntimeErrorBanner } from "./components/RuntimeErrorBanner.jsx";
import { AppBootSplash } from "./components/AppBootSplash.jsx";
import { useLocale } from "./hooks/useLocale.js";
import { ThemeProvider } from "./ui/foundation/ThemeProvider.jsx";
import { useInsforgeAuth } from "./contexts/InsforgeAuthContext.jsx";
import { LoginModalProvider } from "./contexts/LoginModalContext.jsx";
import { getBackendBaseUrl, getLeaderboardBaseUrl } from "./lib/config";
import { isMockEnabled } from "./lib/mock-data";
import { isScreenshotModeEnabled } from "./lib/screenshot-mode";
import { clearDashboardUsageCachesForRealData } from "./lib/usage-cache";
import { useLeaderboardParticipationSync } from "./hooks/use-leaderboard-participation-sync";
import { CodexResetEventsProvider } from "./hooks/use-codex-reset-events";
import { AppLayout } from "./ui/components/Sidebar.jsx";
import { ToastProvider } from "./ui/components/Toast.jsx";
import { UsageFiltersProvider } from "./hooks/use-usage-filters";
import { isTauriApp } from "./lib/native-bridge.js";
import {
  getLeaderboardPreloadContextKey,
  markDashboardMainContentVisible,
  preloadDashboardPageResources,
  preloadLeaderboardDefaultState,
} from "./lib/dashboard-preload.js";
// NativeAuthCallbackPage must be eager-imported: its module-level code
// captures the OAuth `insforge_code` query param synchronously at app
// boot, BEFORE the InsForge SDK's detectAuthCallback() strips it. Lazy
// loading delays the module until route render, by which point the
// param has already been removed 鈥?the page then falls through to the
// "Sign-in incomplete" failure state.
import { NativeAuthCallbackPage } from "./pages/NativeAuthCallbackPage.jsx";

// Pages are lazy-loaded so each route ships in its own chunk; keeps the
// initial main bundle small (was 1.9 MB before splitting, all 11 pages
// were bundled together). Routes are mutually exclusive, so only one
// chunk loads per navigation.
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage.jsx").then((m) => ({ default: m.DashboardPage })),
);
const IpCheckPage = lazy(() => import("./pages/IpCheckPage.jsx"));
const LandingPage = lazy(() =>
  import("./pages/LandingPage.jsx").then((m) => ({ default: m.LandingPage })),
);
const LeaderboardPage = lazy(() =>
  import("./pages/LeaderboardPage.jsx").then((m) => ({ default: m.LeaderboardPage })),
);
const LeaderboardRulesPage = lazy(() =>
  import("./pages/LeaderboardRulesPage.jsx").then((m) => ({ default: m.LeaderboardRulesPage })),
);
const LeaderboardProfilePage = lazy(() =>
  import("./pages/LeaderboardProfilePage.jsx").then((m) => ({ default: m.LeaderboardProfilePage })),
);
const ResetHistoryPage = lazy(() =>
  import("./pages/ResetHistoryPage").then((m) => ({ default: m.ResetHistoryPage })),
);
const LimitsPage = lazy(() =>
  import("./pages/LimitsPage.jsx").then((m) => ({ default: m.LimitsPage })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage.jsx").then((m) => ({ default: m.LoginPage })),
);
const ResetPasswordPage = lazy(() =>
  import("./pages/ResetPasswordPage.jsx").then((m) => ({ default: m.ResetPasswordPage })),
);
const DevicePage = lazy(() => import("./pages/DevicePage.jsx"));
const WrappedPage = lazy(() => import("./pages/WrappedPage.jsx"));
const SettingsBasicPage = lazy(() =>
  import("./pages/SettingsPage.jsx").then((m) => ({ default: m.SettingsBasicPage })),
);
const SettingsCostPage = lazy(() =>
  import("./pages/SettingsPage.jsx").then((m) => ({ default: m.SettingsCostPage })),
);
const TokenPlanEditorPage = lazy(() =>
  import("./pages/TokenPlanEditorPage.jsx").then((m) => ({ default: m.TokenPlanEditorPage })),
);
const SpendUsagePage = lazy(() =>
  import("./pages/SpendPage.jsx").then((m) => ({ default: m.SpendUsagePage })),
);
const SpendCostPage = lazy(() =>
  import("./pages/SpendPage.jsx").then((m) => ({ default: m.SpendCostPage })),
);
const SkillsPage = lazy(() =>
  import("./pages/SkillsPage.jsx").then((m) => ({ default: m.SkillsPage })),
);
const WidgetsPage = lazy(() =>
  import("./pages/WidgetsPage.jsx").then((m) => ({ default: m.WidgetsPage })),
);
const LoginModal = lazy(() =>
  import("./components/LoginModal.jsx").then((m) => ({ default: m.LoginModal })),
);
const CommandPalette = lazy(() =>
  import("./ui/dashboard/components/CommandPalette.jsx").then((m) => ({ default: m.CommandPalette })),
);
const Analytics = lazy(() =>
  import("@vercel/analytics/react").then((m) => ({ default: m.Analytics })),
);
const SpeedInsights = lazy(() =>
  import("@vercel/speed-insights/react").then((m) => ({ default: m.SpeedInsights })),
);

export default function App() {
  // Subscribing to locale here makes App rerender on language switch, which
  // rebuilds every child element reference and triggers copy() re-evaluation
  // across the tree 鈥?without unmounting lazy-loaded pages.
  const { resolvedLocale } = useLocale();
  const location = useLocation();
  const insforge = useInsforgeAuth();
  useLeaderboardParticipationSync();
  const dashboardMainContentVisibleRef = useRef(false);
  const dashboardResourcePreloadStartedRef = useRef(false);
  const leaderboardStatePreloadContextKeysRef = useRef(new Set());
  const mockEnabled = isMockEnabled();
  const screenshotMode = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isScreenshotModeEnabled(window.location.search);
  }, []);
  const pathname = location?.pathname || "/";
  const pageUrl = new URL(window.location.href);
  const sharePathname = pageUrl.pathname.replace(/\/+$/, "") || "/";
  const shareMatch = sharePathname.match(/^\/share\/([^/?#]+)$/i);
  const tokenFromPath = shareMatch?.[1] || null;
  const tokenFromQuery = pageUrl.searchParams.get("token") || null;
  const publicToken = tokenFromPath || tokenFromQuery;
  const publicMode =
    sharePathname === "/share" ||
    sharePathname === "/share.html" ||
    sharePathname.startsWith("/share/");
  const isTauriMode = isTauriApp();

  const isLocalMode =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      isTauriMode);

  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const isDashboardDefaultPath = normalizedPath === "/" || normalizedPath === "/dashboard";
  const isLeaderboardPath = normalizedPath === "/leaderboard";
  const isLeaderboardRulesPath = normalizedPath === "/leaderboard/rules";
  const isPublicLeaderboardPath = isLeaderboardPath || isLeaderboardRulesPath;
  // Standalone shareable profile page: /u/:userId (public, anonymous-visible).
  const profileMatch = normalizedPath.match(/^\/u\/([^/]+)$/i);
  const profileUserId = profileMatch ? profileMatch[1] : null;

  const cloudAuthSignedIn = Boolean(insforge.enabled && insforge.signedIn);
  const signedIn = isLocalMode || cloudAuthSignedIn;
  const sessionSoftExpired = false;
  const baseUrl = getBackendBaseUrl();
  const isAuthGateTriggered = !signedIn && !mockEnabled && !isLocalMode;
  const leaderboardAccessMode = mockEnabled
    ? "mock"
    : insforge.loading
      ? "unavailable"
      : cloudAuthSignedIn
        ? "cloud"
        : signedIn
          ? "public"
          : "unavailable";

  const tryPreloadLeaderboardDefaultState = useCallback(() => {
    if (!dashboardMainContentVisibleRef.current) return;
    if (!mockEnabled && insforge.loading) return;
    if (!mockEnabled && !signedIn) return;
    const preloadOptions = {
      accessMode: leaderboardAccessMode,
      baseUrl: getLeaderboardBaseUrl(),
      mockEnabled,
      signedIn,
      authLoading: Boolean(insforge.loading),
      userId: cloudAuthSignedIn ? insforge.user?.id || null : null,
    };
    const contextKey = getLeaderboardPreloadContextKey(preloadOptions);
    if (leaderboardStatePreloadContextKeysRef.current.has(contextKey)) return;
    leaderboardStatePreloadContextKeysRef.current.add(contextKey);
    void preloadLeaderboardDefaultState(preloadOptions);
  }, [
    cloudAuthSignedIn,
    insforge.loading,
    insforge.user?.id,
    leaderboardAccessMode,
    mockEnabled,
    signedIn,
  ]);

  const handleDashboardMainContentVisible = useCallback(() => {
    if (!isDashboardDefaultPath) return;
    if (!dashboardMainContentVisibleRef.current) {
      dashboardMainContentVisibleRef.current = true;
      markDashboardMainContentVisible();
    }
    if (!dashboardResourcePreloadStartedRef.current) {
      dashboardResourcePreloadStartedRef.current = true;
      void preloadDashboardPageResources();
    }
    tryPreloadLeaderboardDefaultState();
  }, [
    isDashboardDefaultPath,
    tryPreloadLeaderboardDefaultState,
  ]);

  useEffect(() => {
    tryPreloadLeaderboardDefaultState();
  }, [tryPreloadLeaderboardDefaultState]);

  useEffect(() => {
    if (!isLocalMode || mockEnabled) return;
    clearDashboardUsageCachesForRealData();
  }, [isLocalMode, mockEnabled]);

  const authObject = useMemo(() => {
    if (!insforge.enabled || !cloudAuthSignedIn) return null;
    return {
      getAccessToken: () => insforge.getAccessToken(),
      name: insforge.displayName || "",
      userId: insforge.user?.id || null,
    };
  }, [cloudAuthSignedIn, insforge]);

  let gate = isLocalMode || mockEnabled || screenshotMode ? "dashboard" : "landing";
  if (normalizedPath === "/landing") gate = "landing";
  if (normalizedPath === "/dashboard") gate = "dashboard";
  if (isPublicLeaderboardPath) gate = "dashboard";
  if (profileUserId) gate = "dashboard";

  const isLimitsPath = normalizedPath === "/limits";
  const isResetHistoryPath = normalizedPath === "/reset-history";
  // v2.0 IA: settings and spend are split into sub-routes. The bare
  // /spend and /settings paths redirect to their default children below.
  const isSettingsBasicPath = normalizedPath === "/settings/basic";
  const isSettingsCostPath = normalizedPath === "/settings/cost";
  const isTokenPlanNewPath = normalizedPath === "/settings/cost/token-plans/new";
  const isTokenPlanEditPath = /^\/settings\/cost\/token-plans\/[^/]+\/edit$/.test(normalizedPath);
  const isTokenPlanEditorPath = isTokenPlanNewPath || isTokenPlanEditPath;
  const isSettingsRootPath = normalizedPath === "/settings";
  const isSettingsSubPath =
    isSettingsBasicPath || isSettingsCostPath || isTokenPlanEditorPath || isSettingsRootPath;
  const isSpendUsagePath = normalizedPath === "/spend/usage";
  const isSpendCostPath = normalizedPath === "/spend/cost";
  const isSpendRootPath = normalizedPath === "/spend";
  const isSpendSubPath = isSpendUsagePath || isSpendCostPath || isSpendRootPath;
  const isSkillsPath = normalizedPath === "/skills";
  const isWidgetsPath = normalizedPath === "/widgets";
  const isIpCheckPath = normalizedPath === "/ip-check";
  if (
    isLimitsPath ||
    isResetHistoryPath ||
    isSettingsSubPath ||
    isSpendSubPath ||
    isSkillsPath ||
    isWidgetsPath ||
    isIpCheckPath
  )
    gate = "dashboard";
  // v2.0 IA: legacy bare routes redirect to the default child (replace so
  // the bare URL doesn't linger in history). Tauri root now lands on the
  // basic settings page per the IA spec.
  if (isSpendRootPath) {
    return <Navigate to="/spend/usage" replace />;
  }
  if (isSettingsRootPath) {
    return <Navigate to="/settings/basic" replace />;
  }
  if (isTauriMode && (normalizedPath === "/" || normalizedPath === "/index.html")) {
    return (
      <>
        <AppBootSplash />
        <Navigate to="/settings/basic" replace />
      </>
    );
  }

  let PageComponent = DashboardPage;
  if (profileUserId) {
    PageComponent = LeaderboardProfilePage;
  } else if (isLeaderboardRulesPath) {
    PageComponent = LeaderboardRulesPage;
  } else if (normalizedPath === "/leaderboard") {
    PageComponent = LeaderboardPage;
  } else if (isResetHistoryPath) {
    PageComponent = ResetHistoryPage;
  } else if (isLimitsPath) {
    PageComponent = LimitsPage;
  } else if (isSettingsBasicPath) {
    PageComponent = SettingsBasicPage;
  } else if (isTokenPlanEditorPath) {
    PageComponent = TokenPlanEditorPage;
  } else if (isSettingsCostPath) {
    PageComponent = SettingsCostPage;
  } else if (isSpendUsagePath) {
    PageComponent = SpendUsagePage;
  } else if (isSpendCostPath) {
    PageComponent = SpendCostPage;
  } else if (isSkillsPath) {
    PageComponent = SkillsPage;
  } else if (isWidgetsPath) {
    PageComponent = WidgetsPage;
  } else if (isIpCheckPath) {
    PageComponent = IpCheckPage;
  }

  const showSidebar =
    !publicMode &&
    !isAuthGateTriggered &&
    (normalizedPath === "/dashboard" ||
      normalizedPath === "/" ||
      isLimitsPath ||
      isResetHistoryPath ||
      isSettingsSubPath ||
      isSpendSubPath ||
      isSkillsPath ||
      isWidgetsPath ||
      isIpCheckPath ||
      (isLocalMode && isPublicLeaderboardPath));

  // Public-host gating: on www.tokentracker.cc et al. there is no local
  // CLI :7680 to fall back to, so dashboard / settings / etc. require a
  // signed-in user. publicMode (shared link) and the loading state are
  // exceptions that handle themselves.
  const publicHostNeedsLogin =
    !isLocalMode &&
    !cloudAuthSignedIn &&
    !publicMode &&
    !insforge.loading &&
    gate === "dashboard" &&
    // Public-readable routes must stay reachable for signed-out visitors:
    // /leaderboard, /leaderboard/rules and /u/:userId profiles are deliberate no-auth reads
    // (see api.ts getLeaderboard + LeaderboardProfilePage). Without these
    // exclusions the gate would bounce anonymous share-link traffic to /login.
    !isPublicLeaderboardPath &&
    !profileUserId &&
    normalizedPath !== "/login" &&
    normalizedPath !== "/reset-password" &&
    normalizedPath !== "/landing" &&
    normalizedPath !== "/auth/callback" &&
    normalizedPath !== "/auth/native-callback";
  if (publicHostNeedsLogin) {
    return <Navigate to="/login" replace />;
  }

  let content = null;
  if (normalizedPath === "/auth/callback" || normalizedPath === "/auth/native-callback") {
    content = <NativeAuthCallbackPage />;
  } else if (normalizedPath === "/login") {
    content = <LoginPage />;
  } else if (normalizedPath === "/reset-password") {
    content = <ResetPasswordPage />;
  } else if (normalizedPath === "/device") {
    // Headless-CLI device-flow approval page. Standalone (no sidebar) so
    // unsigned visitors hit the embedded sign-in CTA without sidebar nav
    // confusion. Auth check happens inside DevicePage itself.
    content = <DevicePage />;
  } else if (normalizedPath === "/wrapped") {
    // Year-end Wrapped page. Reads from /functions/tokentracker-wrapped
    // (provided by the local CLI server) 鈥?no auth required.
    content = <WrappedPage />;
  } else if (gate === "landing") {
    content = <LandingPage signInUrl="/login" signUpUrl="/login" />;
  } else {
    const pageNode = (
      <PageComponent
        key={resolvedLocale}
        baseUrl={baseUrl}
        auth={authObject}
        signedIn={signedIn}
        sessionSoftExpired={sessionSoftExpired}
        signOut={() => (insforge.enabled ? insforge.signOut() : Promise.resolve())}
        publicMode={publicMode}
        publicToken={publicToken}
        userId={profileUserId}
        signInUrl="/login"
        signUpUrl="/login"
        onMainContentVisible={handleDashboardMainContentVisible}
      />
    );
    if (showSidebar) {
      content = <AppLayout>{pageNode}</AppLayout>;
    } else {
      content = pageNode;
    }
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <RuntimeErrorBanner />
        <ToastProvider>
          <LoginModalProvider>
            <UsageFiltersProvider>
              <CodexResetEventsProvider enabled={isLocalMode && showSidebar}>
                <Suspense fallback={<AppBootSplash />}>{content}</Suspense>
                <Suspense fallback={null}>
                  {showSidebar ? <CommandPalette /> : null}
                  <LoginModal />
                  {!isLocalMode && <Analytics />}
                  {!isLocalMode && <SpeedInsights />}
                </Suspense>
              </CodexResetEventsProvider>
            </UsageFiltersProvider>
          </LoginModalProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
