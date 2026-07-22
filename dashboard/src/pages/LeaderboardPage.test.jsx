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
import { getLeaderboard, getMyLeaderboardRank } from "../lib/api";
import { runCloudUsageSyncNow } from "../lib/cloud-sync";
import { copy } from "../lib/copy";
import { LeaderboardPage } from "./LeaderboardPage.jsx";

const openLoginModalMock = vi.hoisted(() => vi.fn());
const signInWithOAuthMock = vi.hoisted(() => vi.fn());
const getPublicAuthConfigMock = vi.hoisted(() => vi.fn());
const developerPreviewGate = vi.hoisted(() => ({ enabled: false }));
const insforgeAuthMock = vi.hoisted(() => ({
  enabled: true,
  signedIn: true,
  loading: false,
  user: { id: "user-1" },
  signInWithOAuth: signInWithOAuthMock,
  getPublicAuthConfig: getPublicAuthConfigMock,
}));

vi.mock("../lib/api", () => ({
  getLeaderboard: vi.fn(),
  getMyLeaderboardRank: vi.fn(),
  refreshLeaderboard: vi.fn(),
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
  LeaderboardAvatar: ({ displayName }) => <span data-testid="avatar">{displayName}</span>,
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
    insforgeAuthMock.enabled = true;
    insforgeAuthMock.signedIn = true;
    insforgeAuthMock.loading = false;
    insforgeAuthMock.user = { id: "user-1" };
    developerPreviewGate.enabled = false;
    delete window.webkit;
    window.localStorage.clear();
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

    renderLeaderboard("/leaderboard", { auth: () => Promise.resolve("test-token") });

    expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("leaderboard-skeleton")).not.toBeInTheDocument();
    expect(getLeaderboard).toHaveBeenCalledWith({
      baseUrl: "https://edge.example",
      metric: "tokens",
      period: "total",
      source: "all",
      limit: 20,
      offset: 0,
    });
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

  it("keeps cached data visible when the background refresh fails", async () => {
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
      expect(screen.getByText(/network down/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("leaderboard-skeleton")).not.toBeInTheDocument();
    expect(readLeaderboardPreloadState(contextKey)).toMatchObject({ data: preloadedData });
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
      expect(screen.getByText(/network down/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("leaderboard-skeleton")).not.toBeInTheDocument();
    expect(readLeaderboardPreloadState(contextKey)).toBeNull();
  });

  it("keeps the existing loading path when the preload context does not match the page defaults", () => {
    const staleContextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      pageSize: 50,
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
      limit: 20,
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
        limit: 20,
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

    expect(openLoginModalMock).toHaveBeenCalledWith({ emailOnly: true });
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

    expect(openLoginModalMock).toHaveBeenCalledWith({ emailOnly: true });
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

  it("uses the matching cache for pageSize-specific contexts", () => {
    window.localStorage.setItem("tokentracker:leaderboard:pageSize", "50");
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
      await user.click(screen.getByRole("button", { name: "本周" }));
    });

    expect(screen.getAllByText("Week User").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Preloaded User")).toHaveLength(0);

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "总累计" }));
    });

    expect(screen.getAllByText("Preloaded User").length).toBeGreaterThan(0);
  });

  it("clears the visible rows instead of rendering stale data when switching to an uncached context", async () => {
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
      await user.click(screen.getByRole("button", { name: "本周" }));
    });

    expect(screen.queryAllByText("Preloaded User")).toHaveLength(0);
    expect(screen.getByTestId("leaderboard-skeleton")).toBeInTheDocument();
  });

  it("offers four periods and the three approved ranking metrics", async () => {
    const user = userEvent.setup();
    getLeaderboard.mockResolvedValue(preloadedData);

    renderLeaderboard();

    expect(screen.getByRole("button", { name: "今日" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本周" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本月" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "总累计" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "总榜" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Codex" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Token" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "估算花销" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "实际成本" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "今日" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "估算花销" })).not.toBeDisabled());
    await user.click(screen.getByRole("button", { name: "估算花销" }));

    await waitFor(() => {
      expect(getLeaderboard).toHaveBeenLastCalledWith({
        baseUrl: "https://edge.example",
        period: "today",
        source: "all",
        metric: "estimated_spend",
        limit: 20,
        offset: 0,
      });
    });
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

    expect(await screen.findByTestId("leaderboard-score")).toHaveTextContent("$7.89");
  });

  it("shows stable participant, Token and estimated-cost totals returned by the ranking RPC", async () => {
    getLeaderboard.mockResolvedValue({
      ...preloadedData,
      participant_count: 55,
      ranked_entry_count: 41,
      total_entries: 41,
      total_score: 987654,
      aggregate_total_tokens: 123456789,
      aggregate_total_cost_usd: 4321.25,
    });

    renderLeaderboard();

    expect(await screen.findByText("总参与人数")).toBeInTheDocument();
    expect(screen.getByText("55")).toBeInTheDocument();
    expect(screen.getByText("全员累计 Token")).toBeInTheDocument();
    expect(screen.getByText("1.23亿")).toBeInTheDocument();
    expect(screen.getByText("全员累计预估花销")).toBeInTheDocument();
    expect(screen.getByText("$4,321")).toBeInTheDocument();
  });
});
