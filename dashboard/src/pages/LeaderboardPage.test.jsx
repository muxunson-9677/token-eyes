import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLeaderboardPreloadContextKey,
  publishLeaderboardPreloadState,
  readLeaderboardPreloadState,
  resetDashboardPreload,
} from "../lib/dashboard-preload.js";
import {
  getLeaderboard,
  getLeaderboardProfile,
  getLocalLeaderboardActualCost,
  getMyLeaderboardRank,
  getUsageSummary,
} from "../lib/api";
import { getLocalLeaderboardState, syncLeaderboardState } from "../lib/leaderboard-state-client";
import { runCloudUsageSyncNow } from "../lib/cloud-sync";
import { copy } from "../lib/copy";
import {
  consumeLeaderboardLoginIntent,
  setLeaderboardParticipationState,
} from "../lib/leaderboard-sync-state";
import { LeaderboardPage } from "./LeaderboardPage.jsx";

const openLoginModalMock = vi.hoisted(() => vi.fn());
const signInWithOAuthMock = vi.hoisted(() => vi.fn());
const getPublicAuthConfigMock = vi.hoisted(() => vi.fn());
const signOutMock = vi.hoisted(() => vi.fn());
const developerPreviewGate = vi.hoisted(() => ({ enabled: false }));
const insforgeAuthMock = vi.hoisted(() => ({
  enabled: true,
  signedIn: true,
  loading: false,
  user: { id: "user-1" },
  signInWithOAuth: signInWithOAuthMock,
  getPublicAuthConfig: getPublicAuthConfigMock,
  signOut: signOutMock,
}));

vi.mock("../lib/api", () => ({
  getLeaderboard: vi.fn(),
  getLeaderboardProfile: vi.fn(),
  getLocalLeaderboardActualCost: vi.fn(),
  getMyLeaderboardRank: vi.fn(),
  getUsageSummary: vi.fn(),
  refreshLeaderboard: vi.fn(),
}));

vi.mock("../lib/leaderboard-state-client", () => ({
  getLocalLeaderboardState: vi.fn(),
  syncLeaderboardState: vi.fn(),
}));

vi.mock("../lib/cloud-sync", () => ({
  runCloudUsageSyncNow: vi.fn(),
}));

vi.mock("../lib/config", () => ({
  getLeaderboardBaseUrl: () => "https://edge.example",
}));

vi.mock("../lib/mock-data", () => ({
  isMockEnabled: () => false,
}));

vi.mock("../lib/developer-leaderboard-preview.js", () => ({
  isDeveloperLeaderboardLoginEnabled: () => developerPreviewGate.enabled,
}));

vi.mock("../contexts/LoginModalContext.jsx", () => ({
  useLoginModal: () => ({ openLoginModal: openLoginModalMock }),
}));

vi.mock("../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => insforgeAuthMock,
}));

vi.mock("../hooks/useCurrency.js", () => ({
  useCurrency: () => ({ currency: "USD", rate: 1 }),
}));

vi.mock("../components/LeaderboardSkeleton.jsx", () => ({
  LeaderboardSkeleton: () => <div data-testid="leaderboard-skeleton" />,
}));

vi.mock("../components/LeaderboardAvatar.jsx", () => ({
  LeaderboardAvatar: ({ displayName, className }) => <span data-testid="avatar" className={className}>{displayName}</span>,
}));

const preloadedData = {
  entries: [
    {
      rank: 1,
      user_id: "preloaded-user",
      display_name: "Preloaded User",
      total_tokens: 1234,
      estimated_cost_usd: 1.23,
    },
  ],
  me: null,
  page: 1,
  total_pages: 1,
  total_entries: 1,
  from: null,
  to: null,
  generated_at: null,
};

function localLeaderboardState(codexTokens = "100", cursorTokens = "50") {
  const rows = [
    ["codex", "gpt-5", codexTokens, "0", "0", "0", "0"],
    ["cursor", "cursor-model", cursorTokens, "0", "0", "0", "0"],
  ];
  return {
    ok: true,
    summary_hash: "a".repeat(64),
    state: {
      version: 1,
      device_id: "device-user-1",
      captured_at: "2026-08-27T00:00:00.000Z",
      periods: {
        today: rows,
        week: rows,
        "30d": rows,
        month: rows,
        total: rows,
      },
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="leaderboard-location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderLeaderboard(initialEntry = "/leaderboard", props = {}) {
  const tree = React.createElement(
    MemoryRouter,
    { initialEntries: [initialEntry] },
    React.createElement(
      React.Fragment,
      null,
      React.createElement(LeaderboardPage, {
        auth: props.auth ?? null,
        signedIn: props.signedIn ?? true,
        sessionSoftExpired: false,
      }),
      React.createElement(LocationProbe),
    ),
  );
  return render(props.strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
}

describe("LeaderboardPage window-session cache reuse", () => {
  beforeEach(() => {
    resetDashboardPreload();
    getLeaderboard.mockReset();
    getMyLeaderboardRank.mockReset();
    getMyLeaderboardRank.mockResolvedValue({ me: null });
    getLeaderboardProfile.mockReset();
    getLeaderboardProfile.mockResolvedValue(null);
    getLocalLeaderboardState.mockReset();
    getLocalLeaderboardState.mockResolvedValue(localLeaderboardState());
    syncLeaderboardState.mockReset();
    syncLeaderboardState.mockResolvedValue({ status: "unchanged" });
    getUsageSummary.mockReset();
    getUsageSummary.mockResolvedValue({ totals: { cost_usd: 4.25 } });
    getLocalLeaderboardActualCost.mockReset();
    getLocalLeaderboardActualCost.mockResolvedValue({ today: 1, week: 2, "30d": 4, month: 3, total: 4 });
    runCloudUsageSyncNow.mockReset();
    runCloudUsageSyncNow.mockResolvedValue(undefined);
    openLoginModalMock.mockReset();
    signInWithOAuthMock.mockReset();
    signInWithOAuthMock.mockResolvedValue({ data: {}, error: null });
    getPublicAuthConfigMock.mockReset();
    getPublicAuthConfigMock.mockResolvedValue({
      data: { oAuthProviders: ["github"], customOAuthProviders: [] },
      error: null,
    });
    signOutMock.mockReset();
    signOutMock.mockResolvedValue(undefined);
    insforgeAuthMock.enabled = true;
    insforgeAuthMock.signedIn = true;
    insforgeAuthMock.loading = false;
    insforgeAuthMock.user = { id: "user-1" };
    developerPreviewGate.enabled = false;
    delete window.webkit;
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("activates leaderboard-only route styles while the page is mounted", () => {
    const routeClass = "tt-reference-route-leaderboard";
    document.documentElement.classList.remove(routeClass);

    const { unmount } = renderLeaderboard();

    expect(document.documentElement).toHaveClass(routeClass);

    unmount();
    expect(document.documentElement).not.toHaveClass(routeClass);
  });

  it("does not schedule background polling or focus refreshes", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    const addEventSpy = vi.spyOn(window, "addEventListener");
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard();
    await screen.findByText("排行榜");

    expect(intervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(addEventSpy).not.toHaveBeenCalledWith("focus", expect.any(Function));
  });

  it("requests one fixed Top 50 and exposes no pagination controls", async () => {
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard();

    await waitFor(() => expect(getLeaderboard).toHaveBeenCalledWith(expect.objectContaining({
      limit: 50,
      offset: 0,
    })));
    expect(getLeaderboard).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("leaderboard-pagination")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(copy("dashboard.daily.page_size_aria"))).not.toBeInTheDocument();
  });

  it("reads again only for an explicit manual refresh, not when participation sync completes", async () => {
    const user = userEvent.setup();
    const refreshedData = {
      ...preloadedData,
      period: "today",
      aggregate_total_tokens: 1234,
      aggregate_total_cost_usd: 1.23,
      summary_details: { tokens: "", cost: "" },
    };
    let resolveRefresh;
    getLeaderboard
      .mockResolvedValueOnce(refreshedData)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));

    renderLeaderboard("/leaderboard?period=today");
    await waitFor(() => expect(getLeaderboard).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new CustomEvent("token-eyes:leaderboard-sync", {
        detail: { status: "ready" },
      }));
    });
    await act(async () => Promise.resolve());
    expect(getLeaderboard).toHaveBeenCalledTimes(1);

    const refreshButton = screen.getByRole("button", { name: copy("usage.button.refresh") });
    await user.click(refreshButton);
    await waitFor(() => expect(getLeaderboard).toHaveBeenCalledTimes(2));
    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveAttribute("aria-busy", "true");
    expect(refreshButton).toHaveTextContent(copy("realtime.refreshing"));
    expect(getLeaderboard).toHaveBeenLastCalledWith(expect.objectContaining({
      limit: 50,
      offset: 0,
    }));
    resolveRefresh(refreshedData);
    await waitFor(() => expect(refreshButton).toBeEnabled());
  });

  it("manual refresh also checks an existing participant's compact hash without polling", async () => {
    const user = userEvent.setup();
    setLeaderboardParticipationState({
      accountId: "user-1",
      participant: true,
      shareActualCost: false,
    });
    getLeaderboard.mockResolvedValue({ ...preloadedData, period: "today" });
    renderLeaderboard("/leaderboard?period=today", {
      auth: () => Promise.resolve("test-token"),
    });
    await waitFor(() => expect(getLeaderboard).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: copy("usage.button.refresh") }));
    await waitFor(() => expect(syncLeaderboardState).toHaveBeenCalledWith({
      getAccessToken: expect.any(Function),
      reason: "manual-list-refresh",
      accountId: "user-1",
    }));
    await waitFor(() => expect(getLeaderboard).toHaveBeenCalledTimes(2));
  });

  it("renders a matching cache immediately and starts a background refresh", () => {
    const contextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    publishLeaderboardPreloadState(preloadedData, { contextKey });
    getLeaderboard.mockReturnValue(new Promise(() => {}));

    const { container } = renderLeaderboard("/leaderboard", {
      auth: () => Promise.resolve("test-token"),
    });

    expect(screen.getByRole("heading", { name: copy("leaderboard.title") })).toBeInTheDocument();
    expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-testid="leaderboard-period-control"] button')).toHaveLength(5);
    expect(container.querySelectorAll('[data-testid="leaderboard-metric-control"] button')).toHaveLength(3);
    expect(screen.getByTestId("leaderboard-filter-toolbar")).toHaveClass(
      "tt-surface-nested",
      "mb-6",
      "sm:mb-8",
    );
    expect(screen.getByTestId("leaderboard-filter-toolbar")).not.toHaveClass("p-2");
    // V4 item-8: period/metric filters render as raised button tabs (matching
    // the overview data tabs) instead of the old flat rounded-full pills.
    expect(screen.getByTestId("leaderboard-period-control")).toHaveClass("tt-overview-data-tabs");
    expect(screen.getByTestId("leaderboard-metric-control")).toHaveClass("tt-overview-data-tabs");
    expect(screen.getByTestId("leaderboard-list-surface")).toHaveClass("tt-surface");
    expect(screen.getByTestId("leaderboard-filter-toolbar")).toHaveClass("tt-pressable-group");
    expect(screen.getByTestId("leaderboard-list-surface")).toHaveClass("tt-pressable-group");
    expect(screen.getAllByText("Preloaded User")[0].closest("li")).toHaveClass(
      "tt-product-focusable",
    );
    expect(screen.queryByTestId("leaderboard-skeleton")).not.toBeInTheDocument();
    expect(getLeaderboard).toHaveBeenCalledWith({
      baseUrl: "https://edge.example",
      metric: "tokens",
      period: "total",
      source: "all",
      limit: 50,
      offset: 0,
    });
  });

  it("shows signed-in local usage beside public users before a cloud rank exists", async () => {
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard("/leaderboard", { auth: () => Promise.resolve("test-token") });

    expect((await screen.findAllByText("Preloaded User")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByText("150").length).toBeGreaterThan(0));
    expect(getLocalLeaderboardState).toHaveBeenCalledTimes(1);
    expect(getUsageSummary).toHaveBeenCalledWith(expect.objectContaining({
      sources: undefined,
      timeZone: "Asia/Shanghai",
    }));
    expect(getUsageSummary.mock.calls[0][0].from).toBe("1970-01-01");
    expect(screen.getAllByText("$4.25").length).toBeGreaterThan(0);
  });

  it("keeps the summary consistent with the visible local user before cloud publication", async () => {
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      entries: [],
      total_entries: 0,
      participant_count: 0,
      aggregate_total_tokens: 0,
      aggregate_total_cost_usd: 0,
    });

    renderLeaderboard("/leaderboard", { auth: () => Promise.resolve("test-token") });

    const summary = await screen.findByTestId("leaderboard-summary");
    await waitFor(() => {
      expect(within(summary).getByText("1")).toBeInTheDocument();
      expect(within(summary).getByText("150")).toBeInTheDocument();
      expect(within(summary).getByText("$4.25")).toBeInTheDocument();
    });
  });

  it("does not duplicate the signed-in user when a one-person cloud list has not returned self rank", async () => {
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      entries: [{
        rank: 1,
        display_name: "Watermelon",
        total_tokens: "6950299812",
        estimated_cost_usd: 2061,
      }],
      participant_count: 1,
      aggregate_total_tokens: 6950299812,
      aggregate_total_cost_usd: 2061,
    });

    renderLeaderboard("/leaderboard", { auth: () => Promise.resolve("test-token") });

    await waitFor(() => expect(getMyLeaderboardRank).toHaveBeenCalled());
    expect(screen.getAllByTestId("leaderboard-score")).toHaveLength(1);
  });

  it("keeps account controls available before the first rank is generated", async () => {
    const user = userEvent.setup();
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard("/leaderboard", { auth: () => Promise.resolve("test-token") });

    const accountButton = await screen.findByRole("button", { name: copy("settings.section.account") });
    await user.click(accountButton);
    await waitFor(() => {
      expect(screen.getByTestId("leaderboard-location")).toHaveTextContent("/settings/basic");
    });

    await user.click(screen.getByRole("button", { name: copy("settings.account.signOut") }));
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("renders account actions as explicit compact buttons", async () => {
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard("/leaderboard", { auth: () => Promise.resolve("test-token") });

    expect(await screen.findByRole("button", { name: copy("settings.section.account") }))
      .toHaveClass("tt-leaderboard-action-button");
    expect(screen.getByRole("button", { name: copy("settings.account.signOut") }))
      .toHaveClass("tt-leaderboard-action-button");
    expect(screen.getByRole("link", { name: copy("leaderboard.rules_link") }))
      .toHaveClass("tt-leaderboard-action-button");
  });

  it("keeps account and sign-out actions hidden from a signed-out public viewer", async () => {
    getLeaderboard.mockResolvedValue(preloadedData);
    insforgeAuthMock.signedIn = false;

    renderLeaderboard("/leaderboard", {
      auth: null,
      signedIn: false,
    });

    expect(await screen.findByRole("link", { name: copy("leaderboard.rules_link") })).toBeVisible();
    expect(screen.queryByRole("button", { name: copy("settings.section.account") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy("settings.account.signOut") })).not.toBeInTheDocument();
    expect(screen.queryByTestId("leaderboard-me-status")).not.toBeInTheDocument();
  });

  it("keeps my displayed usage local while reusing only the cloud rank", async () => {
    getLeaderboard.mockResolvedValue(preloadedData);
    getMyLeaderboardRank.mockResolvedValue({
      me: {
        rank: 7,
        user_id: "user-1",
        display_name: "Cloud Me",
        total_tokens: "999999",
        estimated_cost_usd: 999,
      },
    });

    renderLeaderboard("/leaderboard", { auth: () => Promise.resolve("test-token") });

    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    expect(screen.getAllByText("150").length).toBeGreaterThan(0);
    expect(screen.queryByText("999,999")).not.toBeInTheDocument();
  });

  it("never substitutes a stale cloud total when local usage statistics are unavailable", async () => {
    getLeaderboard.mockResolvedValue(preloadedData);
    getLocalLeaderboardState.mockRejectedValue(new Error("local leaderboard state unavailable"));
    getMyLeaderboardRank.mockResolvedValue({
      me: {
        rank: 7,
        user_id: "user-1",
        display_name: "Cloud Me",
        total_tokens: "999999",
        estimated_cost_usd: 999,
      },
    });

    const { container } = renderLeaderboard("/leaderboard", { auth: () => Promise.resolve("test-token") });

    await waitFor(() => expect(getLocalLeaderboardState).toHaveBeenCalled());
    await waitFor(() => expect(getMyLeaderboardRank).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(container.querySelector("ol")).queryByText("Cloud Me")).not.toBeInTheDocument();
  });

  it("normalizes an array-shaped self-rank response and replaces the stale cloud row", async () => {
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      entries: [{
        rank: 1,
        display_name: "Watermelon",
        total_tokens: "6950299812",
        estimated_cost_usd: 2061,
      }],
      participant_count: 1,
      aggregate_total_tokens: 6950299812,
      aggregate_total_cost_usd: 2061,
    });
    getLocalLeaderboardState.mockResolvedValue(localLeaderboardState("7075588836", "0"));
    getUsageSummary.mockResolvedValue({ totals: { cost_usd: 11156 } });
    getMyLeaderboardRank.mockResolvedValue({
      me: [{
        rank: 1,
        display_name: "Watermelon",
        total_tokens: "6950299812",
        estimated_cost_usd: 2061,
      }],
    });

    renderLeaderboard("/leaderboard", { auth: () => Promise.resolve("test-token") });

    await waitFor(() => expect(getMyLeaderboardRank).toHaveBeenCalled());
    expect(screen.queryByText(copy("leaderboard.rank_pending"))).not.toBeInTheDocument();
    expect(screen.getAllByTestId("leaderboard-score")).toHaveLength(1);
    expect(screen.getAllByText("70.76\u4ebf").length).toBeGreaterThan(0);
    const summary = screen.getByTestId("leaderboard-summary");
    expect(within(summary).getByText("70.76\u4ebf")).toBeInTheDocument();
    expect(within(summary).getByText("$11,156")).toBeInTheDocument();
  });

  it("uses the authenticated page account when the SDK user omits its id", async () => {
    insforgeAuthMock.user = { email: "local@example.com" };
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard("/leaderboard", {
      auth: {
        getAccessToken: () => Promise.resolve("test-token"),
        name: "Local User",
        userId: "user-1",
      },
    });

    await waitFor(() => expect(screen.getAllByText("150").length).toBeGreaterThan(0));
    expect(screen.getAllByText(copy("leaderboard.me_label")).length).toBeGreaterThan(0);
  });

  it("keeps matching cache visible under React StrictMode without render-time consumption", () => {
    const contextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    publishLeaderboardPreloadState(preloadedData, { contextKey });
    getLeaderboard.mockReturnValue(new Promise(() => {}));

    renderLeaderboard("/leaderboard", { strict: true });

    expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("leaderboard-skeleton")).not.toBeInTheDocument();
    expect(readLeaderboardPreloadState(contextKey)).toMatchObject({ data: preloadedData });
  });

  it("updates the matching cache when the background refresh succeeds", async () => {
    const contextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    const refreshedData = {
      ...preloadedData,
      entries: [
        {
          rank: 1,
          user_id: "refreshed-user",
          display_name: "Refreshed User",
          total_tokens: 4321,
          estimated_cost_usd: 4.32,
        },
      ],
    };
    publishLeaderboardPreloadState(preloadedData, { contextKey });
    getLeaderboard.mockResolvedValue(refreshedData);

    renderLeaderboard();

    expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getAllByText("Refreshed User").length).toBeGreaterThan(0);
      expect(readLeaderboardPreloadState(contextKey)).toMatchObject({
        data: refreshedData,
        source: "page-load",
      });
    });
  });

  it("keeps the last valid signed snapshot visible when refresh fails", async () => {
    const contextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    publishLeaderboardPreloadState(preloadedData, { contextKey });
    getLeaderboard.mockRejectedValue(new Error("network down"));

    renderLeaderboard();

    expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByText(copy("leaderboard.error.network"))).toBeInTheDocument();
      expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);
      expect(screen.getByTestId("leaderboard-summary")).toBeInTheDocument();
      expect(readLeaderboardPreloadState(contextKey)).toMatchObject({ data: preloadedData });
    });
    expect(screen.queryByTestId("leaderboard-skeleton")).not.toBeInTheDocument();
  });

  it("shows an error when cold-start fetch fails without cached data", async () => {
    const contextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    getLeaderboard.mockRejectedValue(new Error("network down"));

    renderLeaderboard();

    await waitFor(() => {
      expect(screen.getByText(copy("leaderboard.error.network"))).toBeInTheDocument();
    });
    expect(screen.queryByTestId("leaderboard-skeleton")).not.toBeInTheDocument();
    expect(readLeaderboardPreloadState(contextKey)).toBeNull();
  });

  it("hides raw abort errors and lets the user retry the public list", async () => {
    const user = userEvent.setup();
    insforgeAuthMock.signedIn = false;
    insforgeAuthMock.user = null;
    getLeaderboard
      .mockRejectedValueOnce(new Error("signal is aborted without reason"))
      .mockResolvedValueOnce(preloadedData);

    renderLeaderboard("/leaderboard", { signedIn: false });

    const retry = await screen.findByRole("button", { name: copy("leaderboard.retry") });
    expect(screen.queryByText(/signal is aborted without reason/i)).not.toBeInTheDocument();
    expect(screen.getByText(copy("leaderboard.error.network"))).toBeInTheDocument();

    await user.click(retry);

    await waitFor(() => {
      expect(getLeaderboard).toHaveBeenCalledTimes(2);
      expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);
    });
  });

  it("starts exactly one public snapshot request when the page opens", async () => {
    insforgeAuthMock.signedIn = false;
    insforgeAuthMock.user = null;
    let resolveLeaderboard;
    getLeaderboard.mockReturnValue(new Promise((resolve) => {
      resolveLeaderboard = resolve;
    }));

    renderLeaderboard("/leaderboard", { signedIn: false });
    await waitFor(() => expect(getLeaderboard).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveLeaderboard(preloadedData);
    });
    await waitFor(() => {
      expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);
      expect(getLeaderboard).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the existing loading path when the preload context does not match the page defaults", () => {
    const staleContextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      period: "week",
      userId: "user-1",
    });
    publishLeaderboardPreloadState(preloadedData, { contextKey: staleContextKey });
    getLeaderboard.mockReturnValue(new Promise(() => {}));

    renderLeaderboard();

    expect(screen.queryByText("Preloaded User")).not.toBeInTheDocument();
    expect(screen.getByTestId("leaderboard-skeleton")).toBeInTheDocument();
    expect(getLeaderboard).toHaveBeenCalledWith({
      baseUrl: "https://edge.example",
      metric: "tokens",
      period: "total",
      source: "all",
      limit: 50,
      offset: 0,
    });
  });

  it("keeps public reads available while auth state is loading", async () => {
    insforgeAuthMock.loading = true;
    insforgeAuthMock.signedIn = false;
    insforgeAuthMock.user = null;
    const cloudContextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    publishLeaderboardPreloadState(preloadedData, { contextKey: cloudContextKey });
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      entries: [{ rank: 1, user_id: "bad", display_name: "Should Not Fetch" }],
    });

    renderLeaderboard();

    await waitFor(() => expect(getLeaderboard).toHaveBeenCalled());
    expect(readLeaderboardPreloadState(cloudContextKey)).toMatchObject({ data: preloadedData });
    expect(
      readLeaderboardPreloadState(
        getLeaderboardPreloadContextKey({
          accessMode: "unavailable",
          baseUrl: "https://edge.example",
          mockEnabled: false,
          userId: null,
        }),
      ),
    ).toBeNull();
  });

  it("keeps signed-out public leaderboard reads available when base URL is configured", async () => {
    insforgeAuthMock.loading = false;
    insforgeAuthMock.signedIn = false;
    insforgeAuthMock.user = null;
    const publicData = {
      ...preloadedData,
      entries: [
        {
          rank: 1,
          user_id: "public-user",
          display_name: "Public User",
          total_tokens: 321,
          estimated_cost_usd: 0.32,
        },
      ],
    };
    getLeaderboard.mockResolvedValue(publicData);

    renderLeaderboard("/leaderboard", { signedIn: false });

    await waitFor(() => {
      expect(getLeaderboard).toHaveBeenCalledWith({
        baseUrl: "https://edge.example",
        metric: "tokens",
        period: "total",
        source: "all",
        limit: 50,
        offset: 0,
      });
      expect(screen.getAllByText("Public User").length).toBeGreaterThan(0);
    });
    expect(
      readLeaderboardPreloadState(
        getLeaderboardPreloadContextKey({
          accessMode: "public",
          baseUrl: "https://edge.example",
          mockEnabled: false,
          userId: null,
        }),
      ),
    ).toMatchObject({ data: publicData });
  });

  it("opens the focused email modal for leaderboard participation", async () => {
    const user = userEvent.setup();
    insforgeAuthMock.signedIn = false;
    insforgeAuthMock.user = null;
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard("/leaderboard", { signedIn: false });

    const button = await screen.findByRole("button", { name: "邮箱登录并参与排行榜" });
    expect(openLoginModalMock).not.toHaveBeenCalled();

    await user.click(button);

    expect(openLoginModalMock).toHaveBeenCalledWith({
      emailOnly: true,
      leaderboardParticipation: true,
    });
    expect(consumeLeaderboardLoginIntent()).toBe(true);
    expect(signInWithOAuthMock).not.toHaveBeenCalled();
  });

  it("keeps email participation available when GitHub is not configured", async () => {
    insforgeAuthMock.signedIn = false;
    insforgeAuthMock.user = null;
    getPublicAuthConfigMock.mockResolvedValue({
      data: { oAuthProviders: ["google"], customOAuthProviders: [] },
      error: null,
    });
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard("/leaderboard", { signedIn: false });

    const button = await screen.findByRole("button", { name: "邮箱登录并参与排行榜" });
    expect(button).toBeEnabled();
    expect(signInWithOAuthMock).not.toHaveBeenCalled();
    expect(getPublicAuthConfigMock).not.toHaveBeenCalled();
  });

  it("keeps developer direct login hidden in ordinary builds", async () => {
    insforgeAuthMock.signedIn = false;
    insforgeAuthMock.user = null;
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard("/leaderboard", { signedIn: false });

    expect((await screen.findAllByText("Preloaded User")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "开发者直登" })).not.toBeInTheDocument();
  });

  it("enters a local developer preview without starting GitHub OAuth", async () => {
    const user = userEvent.setup();
    developerPreviewGate.enabled = true;
    insforgeAuthMock.signedIn = false;
    insforgeAuthMock.user = null;
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard("/leaderboard", { signedIn: false });

    const oauthPlaceholder = await screen.findByRole("button", { name: copy("leaderboard.developer_preview.wechat_placeholder") });
    expect(oauthPlaceholder).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "开发者直登" }));

    await waitFor(() => {
      expect(screen.getByTestId("leaderboard-location")).toHaveTextContent("dev_login=1");
      expect(screen.getByTestId("leaderboard-location")).toHaveTextContent("mock=1");
      expect(getLeaderboard).toHaveBeenCalledWith(expect.objectContaining({ mock: true }));
    });
    expect(screen.getByText(/开发者预览已登录/)).toBeInTheDocument();
    expect(signInWithOAuthMock).not.toHaveBeenCalled();
  });

  it("exits the developer preview and removes only its query flags", async () => {
    const user = userEvent.setup();
    developerPreviewGate.enabled = true;
    insforgeAuthMock.signedIn = false;
    insforgeAuthMock.user = null;
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard("/leaderboard?period=today&dev_login=1&mock=1", { signedIn: false });

    await user.click(await screen.findByRole("button", { name: "退出开发者预览" }));

    await waitFor(() => {
      expect(screen.getByTestId("leaderboard-location")).toHaveTextContent("period=today");
      expect(screen.getByTestId("leaderboard-location")).not.toHaveTextContent("dev_login=1");
      expect(screen.getByTestId("leaderboard-location")).not.toHaveTextContent("mock=1");
    });
  });

  it("uses the same focused email modal inside the native app", async () => {
    const user = userEvent.setup();
    insforgeAuthMock.signedIn = false;
    insforgeAuthMock.user = null;
    window.webkit = { messageHandlers: { nativeOAuth: { postMessage: vi.fn() } } };
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard("/leaderboard", { signedIn: false });
    await user.click(await screen.findByRole("button", { name: "邮箱登录并参与排行榜" }));

    expect(openLoginModalMock).toHaveBeenCalledWith({
      emailOnly: true,
      leaderboardParticipation: true,
    });
    expect(signInWithOAuthMock).not.toHaveBeenCalled();
  });

  it("reuses matching cache again after remounting in the same window session", () => {
    const contextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    publishLeaderboardPreloadState(preloadedData, { contextKey });
    getLeaderboard.mockReturnValue(new Promise(() => {}));

    const first = renderLeaderboard();

    expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);

    first.unmount();
    renderLeaderboard();

    expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);
    expect(readLeaderboardPreloadState(contextKey)).toMatchObject({ data: preloadedData });
  });

  it("uses the matching cache for the fixed Top 50 context", () => {
    const contextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      pageSize: 50,
      userId: "user-1",
    });
    publishLeaderboardPreloadState(preloadedData, { contextKey });
    getLeaderboard.mockReturnValue(new Promise(() => {}));

    renderLeaderboard();

    expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);
    expect(getLeaderboard).toHaveBeenCalledWith({
      baseUrl: "https://edge.example",
      metric: "tokens",
      period: "total",
      source: "all",
      limit: 50,
      offset: 0,
    });
  });

  it("does not show old context data after period changes, but reuses matching cached context when returning", async () => {
    const user = userEvent.setup();
    const totalContextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    const weekContextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      period: "week",
      userId: "user-1",
    });
    publishLeaderboardPreloadState(preloadedData, { contextKey: totalContextKey });
    publishLeaderboardPreloadState(
      {
        ...preloadedData,
        entries: [
          {
            rank: 1,
            user_id: "week-user",
            display_name: "Week User",
            total_tokens: 777,
            estimated_cost_usd: 0.77,
          },
        ],
      },
      { contextKey: weekContextKey },
    );
    getLeaderboard.mockReturnValue(new Promise(() => {}));

    renderLeaderboard();

    expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);

    await act(async () => {
      await user.click(screen.getByRole("tab", { name: "本周" }));
    });

    expect(screen.getAllByText("Week User").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Preloaded User")).toHaveLength(0);

    await act(async () => {
      await user.click(screen.getByRole("tab", { name: copy("leaderboard.period.total") }));
    });

    expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);
  });

  it("clears stale public rows but keeps the signed-in local row for an uncached context", async () => {
    const user = userEvent.setup();
    const totalContextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    publishLeaderboardPreloadState(preloadedData, { contextKey: totalContextKey });
    getLeaderboard.mockReturnValue(new Promise(() => {}));

    renderLeaderboard();

    expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);

    await act(async () => {
      await user.click(screen.getByRole("tab", { name: "本周" }));
    });

    expect(screen.queryAllByText("Preloaded User")).toHaveLength(0);
    await waitFor(() => expect(screen.getByText(copy("leaderboard.rank_pending"))).toBeInTheDocument());
    expect(screen.queryByTestId("leaderboard-skeleton")).not.toBeInTheDocument();
  });

  it("offers five periods and the three approved ranking metrics", async () => {
    const user = userEvent.setup();
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard();

    expect(screen.getByRole("tab", { name: "今日" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "本周" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: copy("leaderboard.period.30d") })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "本月" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "总累计" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "总榜" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Codex" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Token" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "估算花销" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "实际成本" })).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: copy("leaderboard.source.label") }));
    expect(await screen.findByRole("option", { name: "Trae" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "DeepSeek Harness" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("tab", { name: "今日" }));
    await waitFor(() => {
      expect(screen.getByTestId("leaderboard-location")).toHaveTextContent("period=today");
    });
    await waitFor(() => expect(screen.getByRole("tab", { name: "估算花销" })).not.toBeDisabled());
    await user.click(screen.getByRole("tab", { name: "估算花销" }));

    await waitFor(() => {
      expect(getLeaderboard).toHaveBeenLastCalledWith({
        baseUrl: "https://edge.example",
        period: "today",
        source: "all",
        metric: "estimated_spend",
        limit: 50,
        offset: 0,
      });
    });
  });

  it("keeps metric buttons interactive while the public list refreshes", async () => {
    const user = userEvent.setup();
    getLeaderboard.mockReturnValue(new Promise(() => {}));

    renderLeaderboard();

    const actualCostButton = screen.getByRole("tab", { name: copy("leaderboard.metric.actual_cost") });
    expect(actualCostButton).not.toBeDisabled();
    await user.click(actualCostButton);
    await waitFor(() => {
      expect(screen.getByTestId("leaderboard-location")).toHaveTextContent("metric=actual_cost");
    });
  });

  it("keeps my local actual cost private until I choose to publish it", async () => {
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard("/leaderboard?metric=actual_cost");

    await waitFor(() => expect(getLocalLeaderboardState).toHaveBeenCalled());
    expect(getLocalLeaderboardActualCost).not.toHaveBeenCalled();
    const scores = await screen.findAllByTestId("leaderboard-score");
    expect(scores.some((score) => score.textContent === "$4.00")).toBe(false);
  });

  it("shows the combined Cost Accumulation total after actual-cost consent", async () => {
    getLeaderboard.mockResolvedValue(preloadedData);
    setLeaderboardParticipationState({ accountId: "user-1", shareActualCost: true });

    renderLeaderboard("/leaderboard?metric=actual_cost");

    await waitFor(() => expect(getLocalLeaderboardActualCost).toHaveBeenCalled());
    const scores = await screen.findAllByTestId("leaderboard-score");
    expect(scores.some((score) => score.textContent === "$4.00")).toBe(true);
  });

  it("ignores legacy Agent query filters and keeps the new client on the overall board", async () => {
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      entries: [{ ...preloadedData.entries[0], score: 987 }],
    });

    renderLeaderboard("/leaderboard?agent=codex&metric=without_cache");

    await waitFor(() => expect(getLeaderboard).toHaveBeenCalledWith(expect.objectContaining({ source: "all" })));
    expect(screen.queryByRole("button", { name: "Codex" })).not.toBeInTheDocument();
    expect(screen.getAllByText("1,234").length).toBeGreaterThan(0);
  });

  it("renders only each user's actually used Agents inside that user's row", async () => {
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      entries: [{
        ...preloadedData.entries[0],
        display_name: "Distributed User",
        total_tokens: 104_336_606_257,
        agent_metrics: {
          codex: { with_cache_tokens: 32_770_000, without_cache_tokens: 20_000_000 },
          cursor: { with_cache_tokens: 4_156_000, without_cache_tokens: 3_000_000 },
          claude: { with_cache_tokens: 0, without_cache_tokens: 0 },
        },
      }],
    });

    renderLeaderboard();

    const row = await screen.findByRole("button", { name: /Distributed User/ });
    expect(row).toHaveTextContent("Codex");
    expect(row).toHaveTextContent("3.28千万");
    expect(row).toHaveTextContent("Cursor");
    expect(row).toHaveTextContent("415.6万");
    expect(row).toHaveTextContent("1043.37亿");
    expect(row).not.toHaveTextContent("Claude Code");
    const userMeta = within(row).getByTestId("leaderboard-user-meta");
    expect(userMeta).toHaveClass("text-oai-gray-400");
    expect(screen.queryByRole("columnheader", { name: "Agent 使用分布" })).not.toBeInTheDocument();
  });

  it("gives the first-ranked row the dedicated medal, highlight and avatar treatment", async () => {
    insforgeAuthMock.signedIn = false;
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      entries: [{
        ...preloadedData.entries[0],
        display_name: "Top User",
        source_breakdown: [
          { source: "codex", total_tokens: 70 },
          { source: "cursor", total_tokens: 30 },
        ],
      }],
    });

    renderLeaderboard();

    const row = await screen.findByRole("button", { name: /Top User/ });
    expect(row).toHaveClass("tt-leaderboard-top-entry");
    expect(within(row).getByTestId("leaderboard-rank-1")).toHaveClass("tt-leaderboard-rank-medal");
    expect(within(row).getByTestId("avatar")).toHaveClass("tt-leaderboard-top-avatar");
  });

  it("lays out the first-ranked result as the compact two-tier reference row", async () => {
    insforgeAuthMock.signedIn = false;
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      entries: [{
        ...preloadedData.entries[0],
        display_name: "Reference User",
        is_me: true,
        show_actions: true,
        estimated_cost_usd: 2062,
        source_breakdown: [
          { source: "codex", total_tokens: 75 },
          { source: "hermes", total_tokens: 12 },
          { source: "cursor", total_tokens: 9 },
          { source: "claude", total_tokens: 3 },
          { source: "gemini", total_tokens: 1 },
        ],
      }],
    });

    renderLeaderboard();

    const rank = await screen.findByTestId("leaderboard-rank-1");
    const row = rank.closest("li");
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("data-layout", "reference-two-tier");
    expect(row).toHaveClass("tt-leaderboard-top-entry--reference");
    expect(row.innerHTML).toContain("tt-leaderboard-top-entry-content");
    expect(row.textContent).toContain("你");
    expect(row.innerHTML).toContain("tt-leaderboard-current-user");
    expect(row.querySelector(".tt-leaderboard-entry-distribution")).toBeInTheDocument();
    expect(row.querySelector(".tt-leaderboard-agent-bar")).toBeInTheDocument();
    expect(row.querySelectorAll('[data-testid="leaderboard-user-meta"] > [data-agent]')).toHaveLength(4);
    expect(row.querySelectorAll(".tt-leaderboard-agent-bar > span")).toHaveLength(5);
    expect(row.querySelector(".tt-leaderboard-score-column")).toBeInTheDocument();
    expect(row.querySelector(".tt-leaderboard-row-actions")).toBeInTheDocument();
  });

  it("anchors the first-ranked user's model distribution below the identity instead of centering it", async () => {
    insforgeAuthMock.signedIn = false;
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      entries: [{
        ...preloadedData.entries[0],
        display_name: "Bottom-aligned User",
        source_breakdown: [{ source: "codex", total_tokens: 100 }],
      }],
    });

    renderLeaderboard();

    const row = await screen.findByRole("button", { name: /Bottom-aligned User/ });
    expect(within(row).getByTestId("leaderboard-user-meta").closest(".tt-leaderboard-entry-copy"))
      .toHaveClass("tt-leaderboard-entry-copy");
    expect(row).toHaveClass("tt-leaderboard-top-entry--compact");
    expect(within(row).getByTestId("leaderboard-user-meta").closest(".tt-leaderboard-entry-distribution"))
      .toHaveClass("tt-leaderboard-entry-distribution--nearby");
  });

  it("marks the summary metrics and score header for the expanded visual treatment", async () => {
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard();

    const summary = await screen.findByTestId("leaderboard-summary");
    expect(summary.firstElementChild).toHaveClass("tt-leaderboard-summary-card");
    expect(screen.getByTestId("leaderboard-table-head")).toHaveClass("tt-leaderboard-table-head--expanded");
  });

  it("keeps the right-side #1 status chip for the sole signed-in participant", async () => {
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      participant_count: 1,
      ranked_entry_count: 1,
      total_entries: 1,
      entries: [{ ...preloadedData.entries[0], user_id: "user-1" }],
    });

    renderLeaderboard();

    await waitFor(() => {
      expect(screen.getByTestId("leaderboard-me-status")).toBeVisible();
    });
  });

  it("keeps the right-side status chip when the visible current-user row already has a rank", async () => {
    getLocalLeaderboardState.mockRejectedValue(new Error("local leaderboard state unavailable"));
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      participant_count: 1,
      ranked_entry_count: 1,
      total_entries: 1,
      entries: [{ ...preloadedData.entries[0], is_me: true, rank: 1 }],
    });

    renderLeaderboard();

    await waitFor(() => {
      expect(screen.getByTestId("leaderboard-me-status")).toBeVisible();
    });
  });

  it("does not invent a #1 status when the personal-rank request is unavailable", async () => {
    getLocalLeaderboardState.mockRejectedValue(new Error("local leaderboard state unavailable"));
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard();

    await waitFor(() => expect(getLeaderboard).toHaveBeenCalled());
    expect(screen.queryByTestId("leaderboard-me-status")).not.toBeInTheDocument();
  });

  it("uses the desktop sidebar as the exit and does not duplicate a return-overview link", async () => {
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard();

    expect(await screen.findByText("排行榜")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "返回概览" })).not.toBeInTheDocument();
  });

  it("formats an estimated-cost score as currency in the primary ranking column", async () => {
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      entries: [{ ...preloadedData.entries[0], estimated_cost_usd: 7.89 }],
    });

    renderLeaderboard("/leaderboard?metric=estimated_spend");

    const scores = await screen.findAllByTestId("leaderboard-score");
    expect(scores.some((score) => score.textContent === "$7.89")).toBe(true);
  });

  it("adds an unpublished local participant to the cloud aggregate exactly once", async () => {
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      participant_count: 55,
      ranked_entry_count: 41,
      total_entries: 41,
      total_score: 987654,
      aggregate_total_tokens: 123456789,
      aggregate_total_cost_usd: 4321.25,
      summary_details: {
        tokens: "较昨日  +123.4万（+1.01%）",
        cost: "较昨日  +$4（+0.10%）",
      },
    });

    renderLeaderboard();

    expect(await screen.findByText("总参与人数")).toBeInTheDocument();
    expect(screen.getByText("56")).toBeInTheDocument();
    expect(screen.getByText("全员 Token")).toBeInTheDocument();
    expect(screen.getByText("1.23亿")).toBeInTheDocument();
    expect(screen.getByText("全员预估花销")).toBeInTheDocument();
    expect(screen.getByText("$4,326")).toBeInTheDocument();
    expect(screen.getByText(copy("leaderboard.summary.active_today", { count: "56" }))).toBeInTheDocument();
    const summaryDetails = Array.from(document.querySelectorAll(".tt-leaderboard-summary-detail"))
      .map((element) => element.textContent);
    expect(summaryDetails).toContain("较昨日  +123.4万（+1.01%）");
    expect(summaryDetails).toContain("较昨日  +$4（+0.10%）");
    expect(screen.getAllByTestId("leaderboard-summary-icon")).toHaveLength(3);
    expect(screen.getByTestId("leaderboard-rank-1")).toHaveAttribute("data-rank-tier", "medal");
  });
});
