import { beforeEach, describe, expect, it, vi } from "vitest";

const { getInsforgeAnonKeyMock, getInsforgeRemoteUrlMock } = vi.hoisted(() => ({
  getInsforgeAnonKeyMock: vi.fn(() => "anon-key"),
  getInsforgeRemoteUrlMock: vi.fn(() => "https://example.insforge.app"),
}));

vi.mock("../insforge-config", () => ({
  getInsforgeAnonKey: getInsforgeAnonKeyMock,
  getInsforgeRemoteUrl: getInsforgeRemoteUrlMock,
}));

import {
  deleteLeaderboardParticipation,
  getLeaderboard,
  getLocalLeaderboardActualCost,
  getPublicVisibility,
  setLeaderboardActualCost,
  setPublicVisibility,
} from "../api";

function makeJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url").replace(/=/g, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.sig`;
}

function mockJsonFetch(payload: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("public visibility API", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    getInsforgeAnonKeyMock.mockClear();
    getInsforgeRemoteUrlMock.mockReset();
    getInsforgeRemoteUrlMock.mockReturnValue("https://example.insforge.app");
  });

  it("reads visibility through the public visibility edge function", async () => {
    const payload = {
      enabled: true,
      updated_at: "2026-03-28T16:00:00.000Z",
      share_token: "pv1-token",
    };
    const fetchMock = mockJsonFetch(payload);
    const accessToken = makeJwt({ sub: "user-123" });

    await expect(getPublicVisibility({ accessToken })).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.insforge.app/functions/tokentracker-public-visibility",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: "anon-key",
          Authorization: `Bearer ${accessToken}`,
        }),
      }),
    );
  });

  it("does not send malformed opaque tokens to the InsForge gateway", async () => {
    const fetchMock = mockJsonFetch({
      enabled: false,
      updated_at: null,
      share_token: null,
    });

    await getPublicVisibility({ accessToken: "opaque-token" });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.apikey).toBe("anon-key");
  });

  it("posts only the leaderboard profile contract", async () => {
    const payload = {
      enabled: true,
      updated_at: "2026-03-28T16:05:00.000Z",
      share_token: "existing-share-token",
    };
    const fetchMock = mockJsonFetch(payload);
    const accessToken = makeJwt({ sub: "writer-1" });

    await expect(
      setPublicVisibility({
        accessToken,
        leaderboard_public: true,
        display_name: "Writer",
      }),
    ).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.insforge.app/functions/tokentracker-public-visibility",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          leaderboard_public: true,
          display_name: "Writer",
        }),
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
          apikey: "anon-key",
        }),
      }),
    );
  });

  it("writes actual-cost consent through the authenticated RPC without a user id", async () => {
    const fetchMock = mockJsonFetch({});
    const accessToken = makeJwt({ sub: "writer-1" });

    await setLeaderboardActualCost({
      accessToken,
      share: true,
      periodCosts: { today: 1, week: 2, month: 3, total: 4 },
      capturedAt: "2026-07-20T08:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.insforge.app/api/database/rpc/set_my_leaderboard_actual_cost",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
          apikey: "anon-key",
          Prefer: "return=minimal",
        }),
        body: JSON.stringify({
          p_share: true,
          p_today_usd: 1,
          p_week_usd: 2,
          p_month_usd: 3,
          p_total_usd: 4,
          p_captured_at: "2026-07-20T08:00:00.000Z",
        }),
      }),
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain("writer-1");
  });

  it("reads only four local actual-cost totals before consent upload", async () => {
    const fetchMock = mockJsonFetch({
      period_costs_usd: { today: 1, week: 2, month: 3, total: 4 },
    });
    await expect(getLocalLeaderboardActualCost()).resolves.toEqual({
      today: 1,
      week: 2,
      month: 3,
      total: 4,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/functions/tokentracker-leaderboard-actual-cost",
    );
  });

  it("deletes participation through the auth-bound cleanup RPC", async () => {
    const fetchMock = mockJsonFetch({});
    const accessToken = makeJwt({ sub: "writer-1" });
    await deleteLeaderboardParticipation({ accessToken });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.insforge.app/api/database/rpc/delete_my_leaderboard_data",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
          Prefer: "return=minimal",
        }),
      }),
    );
  });

  it("throws clearly when the InsForge backend URL is not configured", async () => {
    getInsforgeRemoteUrlMock.mockReturnValue("");

    await expect(getPublicVisibility({ accessToken: "token" })).rejects.toThrow(
      "InsForge base URL not configured",
    );
  });
});

describe("leaderboard API", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    getInsforgeRemoteUrlMock.mockReset();
    getInsforgeRemoteUrlMock.mockReturnValue("https://example.insforge.app");
  });

  it("sends period, Agent and metric dimensions without an Authorization header", async () => {
    const fetchMock = mockJsonFetch({ entries: [], page: 1, total_entries: 0 });

    await getLeaderboard({
      accessToken: makeJwt({ sub: "user-123" }),
      userId: "user-123",
      period: "today",
      agent: "codex",
      metric: "without_cache",
      limit: 20,
      offset: 40,
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://example.insforge.app/functions/tokentracker-leaderboard?period=today&agent=codex&metric=without_cache&limit=20&offset=40&user_id=user-123",
    );
    expect((options.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("uses local leaderboard data when developer preview explicitly requests mock mode", async () => {
    const fetchMock = mockJsonFetch({ entries: [] });

    const result = await getLeaderboard({
      mock: true,
      userId: "developer-preview",
      period: "today",
      agent: "codex",
      metric: "with_cache",
      limit: 20,
      offset: 0,
    });

    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.me).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
