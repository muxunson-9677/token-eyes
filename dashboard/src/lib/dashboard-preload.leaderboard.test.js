import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDashboardPreloadSnapshot,
  getLeaderboardPreloadContextKey,
  getLeaderboardPreloadPageSize,
  preloadLeaderboardDefaultState,
  publishLeaderboardPreloadState,
  readLeaderboardPreloadState,
  resetDashboardPreload,
} from "./dashboard-preload.js";
import { getLeaderboard } from "./api";

vi.mock("./api", () => ({
  getLeaderboard: vi.fn(),
}));

describe("leaderboard default state preload", () => {
  beforeEach(() => {
    resetDashboardPreload();
    getLeaderboard.mockReset();
    window.localStorage.clear();
  });

  it("builds the public leaderboard context without reading before the page opens", async () => {
    window.localStorage.setItem("tokentracker:leaderboard:pageSize", "50");
    const contextKey = getLeaderboardPreloadContextKey({
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
      metric: "estimated_spend",
      source: "codex",
    });

    expect(getLeaderboardPreloadPageSize()).toBe(50);
    expect(contextKey).toBe(
      "leaderboard:accessMode=cloud|baseUrl=https://edge.example|metric=estimated_spend|mockEnabled=false|offset=0|pageSize=50|period=total|source=codex",
    );

    await expect(
      preloadLeaderboardDefaultState({
        baseUrl: "https://edge.example",
        mockEnabled: false,
        signedIn: true,
        authLoading: false,
        userId: "user-1",
        metric: "estimated_spend",
        source: "codex",
      }),
    ).resolves.toMatchObject({
      status: "skipped",
      contextKey,
    });
    expect(getLeaderboard).not.toHaveBeenCalled();
    expect(getDashboardPreloadSnapshot().targets.leaderboard).toMatchObject({
      stateStatus: "skipped",
      error: "page-only-read",
    });
    expect(readLeaderboardPreloadState(contextKey)).toBeNull();
  });

  it("separates cache by fixed public dimensions and ignores pagination overrides", () => {
    const baseOptions = {
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      offset: 0,
      pageSize: 20,
      period: "total",
      metric: "tokens",
      source: "all",
    };
    const contextKey = getLeaderboardPreloadContextKey(baseOptions);
    const data = { entries: [{ rank: 1, display_name: "Ada" }], page: 1 };

    publishLeaderboardPreloadState(data, { contextKey });

    expect(readLeaderboardPreloadState(contextKey)).toMatchObject({
      status: "fulfilled",
      data,
    });

    for (const variant of [
      { period: "week" },
      { metric: "estimated_spend" },
      { source: "codex" },
      { baseUrl: "https://other.example" },
      { mockEnabled: true, accessMode: "mock" },
      { accessMode: "public" },
    ]) {
      const variantKey = getLeaderboardPreloadContextKey({
        ...baseOptions,
        ...variant,
      });

      expect(variantKey).not.toBe(contextKey);
      expect(readLeaderboardPreloadState(variantKey)).toBeNull();
    }

    expect(getLeaderboardPreloadContextKey({ ...baseOptions, pageSize: 50 })).toBe(contextKey);
    expect(getLeaderboardPreloadContextKey({ ...baseOptions, offset: 20 })).toBe(contextKey);
  });

  it("restores the last public leaderboard from localStorage after a new app session", () => {
    const contextKey = getLeaderboardPreloadContextKey({
      accessMode: "public",
      baseUrl: "https://edge.example",
      period: "total",
    });
    const data = { entries: [{ rank: 1, display_name: "Cached User" }], total_entries: 1 };

    publishLeaderboardPreloadState(data, { contextKey });
    resetDashboardPreload();

    expect(readLeaderboardPreloadState(contextKey)).toMatchObject({ data });
  });

  it("skips silently when no leaderboard base URL is configured outside mock mode", async () => {
    await expect(
      preloadLeaderboardDefaultState({
        baseUrl: "",
        mockEnabled: false,
        signedIn: true,
        authLoading: false,
        userId: "user-1",
      }),
    ).resolves.toMatchObject({ status: "skipped" });

    expect(getLeaderboard).not.toHaveBeenCalled();
    expect(getDashboardPreloadSnapshot().targets.leaderboard).toMatchObject({
      stateStatus: "skipped",
      error: "page-only-read",
    });
    expect(readLeaderboardPreloadState(getLeaderboardPreloadContextKey({ baseUrl: "", mockEnabled: false }))).toBeNull();
  });

  it("does not let mock mode bypass the page-only read boundary", async () => {
    getLeaderboard.mockResolvedValue({ entries: [], page: 1, total_entries: 0 });

    await expect(
      preloadLeaderboardDefaultState({
        baseUrl: "",
        mockEnabled: true,
        signedIn: false,
        authLoading: true,
        userId: null,
      }),
    ).resolves.toMatchObject({ status: "skipped", error: "page-only-read" });

    expect(getLeaderboard).not.toHaveBeenCalled();
  });

  it("does not let signed-out public route preloading issue a snapshot request", async () => {
    const contextKey = getLeaderboardPreloadContextKey({
      accessMode: "public",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: null,
    });
    await expect(
      preloadLeaderboardDefaultState({
        accessMode: "public",
        baseUrl: "https://edge.example",
        mockEnabled: false,
        signedIn: false,
        authLoading: false,
        userId: null,
      }),
    ).resolves.toMatchObject({
      status: "skipped",
      error: "page-only-read",
      contextKey,
    });
    expect(getLeaderboard).not.toHaveBeenCalled();
  });

  it("never starts a route-preload fetch even when the API mock would fail", async () => {
    getLeaderboard.mockRejectedValue(new Error("network down"));

    await expect(
      preloadLeaderboardDefaultState({
        baseUrl: "https://edge.example",
        mockEnabled: false,
        signedIn: true,
        authLoading: false,
        userId: "user-1",
      }),
    ).resolves.toMatchObject({ status: "skipped", error: "page-only-read" });

    expect(getDashboardPreloadSnapshot().targets.leaderboard).toMatchObject({
      stateStatus: "skipped",
      error: "page-only-read",
    });
    expect(getLeaderboard).not.toHaveBeenCalled();
    expect(
      readLeaderboardPreloadState(
        getLeaderboardPreloadContextKey({
          baseUrl: "https://edge.example",
          mockEnabled: false,
          userId: "user-1",
        }),
      ),
    ).toBeNull();
  });

  it("does not persist a skipped route preload across a new app session", async () => {
    const contextKey = getLeaderboardPreloadContextKey({
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    const preload = preloadLeaderboardDefaultState({
      baseUrl: "https://edge.example",
      mockEnabled: false,
      signedIn: true,
      authLoading: false,
      userId: "user-1",
    });
    await expect(preload).resolves.toMatchObject({ status: "skipped", error: "page-only-read" });

    resetDashboardPreload();
    expect(readLeaderboardPreloadState(contextKey)).toBeNull();
    expect(getDashboardPreloadSnapshot().targets.leaderboard).toMatchObject({
      stateStatus: "idle",
      error: null,
    });
  });

  it("does not let rejected leaderboard state overwrite an existing fulfilled cache entry", () => {
    const contextKey = getLeaderboardPreloadContextKey({
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    const data = { entries: [{ rank: 1, display_name: "Ada" }], page: 1 };

    publishLeaderboardPreloadState(data, { contextKey });
    publishLeaderboardPreloadState(null, {
      contextKey,
      status: "rejected",
      error: "network down",
    });

    expect(getDashboardPreloadSnapshot().targets.leaderboard).toMatchObject({
      stateStatus: "rejected",
      error: "network down",
    });
    expect(readLeaderboardPreloadState(contextKey)).toMatchObject({
      status: "fulfilled",
      data,
      contextKey,
    });
  });

  it("reads fulfilled leaderboard state repeatedly without consuming it", () => {
    const contextKey = getLeaderboardPreloadContextKey({
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    const data = { entries: [{ rank: 1, display_name: "Ada" }], page: 1 };

    publishLeaderboardPreloadState(data, { contextKey });

    expect(readLeaderboardPreloadState(contextKey)).toMatchObject({ data });
    expect(readLeaderboardPreloadState(contextKey)).toMatchObject({ data });
  });

  it("evicts older leaderboard contexts when the window-session cache reaches its configured max", () => {
    resetDashboardPreload({ leaderboardMaxEntries: 2 });
    const firstKey = getLeaderboardPreloadContextKey({
      baseUrl: "https://edge.example",
      mockEnabled: false,
      period: "total",
      userId: "user-1",
    });
    const secondKey = getLeaderboardPreloadContextKey({
      baseUrl: "https://edge.example",
      mockEnabled: false,
      period: "week",
      userId: "user-1",
    });
    const thirdKey = getLeaderboardPreloadContextKey({
      baseUrl: "https://edge.example",
      mockEnabled: false,
      period: "month",
      userId: "user-1",
    });

    publishLeaderboardPreloadState({ entries: [{ display_name: "First" }] }, { contextKey: firstKey });
    publishLeaderboardPreloadState({ entries: [{ display_name: "Second" }] }, { contextKey: secondKey });
    publishLeaderboardPreloadState({ entries: [{ display_name: "Third" }] }, { contextKey: thirdKey });

    expect(getDashboardPreloadSnapshot().cache.leaderboard).toMatchObject({
      maxEntries: 2,
      size: 2,
      keys: [secondKey, thirdKey],
    });
    expect(readLeaderboardPreloadState(firstKey)).toBeNull();
    expect(readLeaderboardPreloadState(secondKey)).toMatchObject({
      data: { entries: [{ display_name: "Second" }] },
    });
    expect(readLeaderboardPreloadState(thirdKey)).toMatchObject({
      data: { entries: [{ display_name: "Third" }] },
    });
  });

  it("does not evict the active leaderboard context when trimming old entries", () => {
    resetDashboardPreload({ leaderboardMaxEntries: 2 });
    const activeKey = getLeaderboardPreloadContextKey({
      baseUrl: "https://edge.example",
      mockEnabled: false,
      period: "total",
      userId: "user-1",
    });
    const oldKey = getLeaderboardPreloadContextKey({
      baseUrl: "https://edge.example",
      mockEnabled: false,
      period: "week",
      userId: "user-1",
    });
    const newKey = getLeaderboardPreloadContextKey({
      baseUrl: "https://edge.example",
      mockEnabled: false,
      period: "month",
      userId: "user-1",
    });

    publishLeaderboardPreloadState({ entries: [{ display_name: "Active" }] }, { contextKey: activeKey });
    publishLeaderboardPreloadState({ entries: [{ display_name: "Old" }] }, { contextKey: oldKey });
    publishLeaderboardPreloadState(
      { entries: [{ display_name: "New" }] },
      {
        activeContextKey: activeKey,
        contextKey: newKey,
      },
    );

    expect(getDashboardPreloadSnapshot().cache.leaderboard.keys).toEqual([activeKey, newKey]);
    expect(readLeaderboardPreloadState(activeKey)).toMatchObject({
      data: { entries: [{ display_name: "Active" }] },
    });
    expect(readLeaderboardPreloadState(oldKey)).toBeNull();
    expect(readLeaderboardPreloadState(newKey)).toMatchObject({
      data: { entries: [{ display_name: "New" }] },
    });
  });
});
