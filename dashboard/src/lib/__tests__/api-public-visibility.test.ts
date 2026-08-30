import { beforeEach, describe, expect, it, vi } from "vitest";

const { getInsforgeAnonKeyMock, getInsforgeRemoteUrlMock, getInsforgeFunctionsUrlMock } = vi.hoisted(() => ({
  getInsforgeAnonKeyMock: vi.fn(() => "anon-key"),
  getInsforgeRemoteUrlMock: vi.fn(() => "https://example.insforge.app"),
  getInsforgeFunctionsUrlMock: vi.fn(() => "https://example.function2.insforge.app"),
}));

const { buildLocalApiUrlMock, getLocalApiAuthHeadersMock } = vi.hoisted(() => ({
  buildLocalApiUrlMock: vi.fn(async (path: string) => new URL(path, "http://127.0.0.1:7681").toString()),
  getLocalApiAuthHeadersMock: vi.fn(async () => ({
    "x-tokentracker-local-auth": "local-token",
  })),
}));
const tauriRuntime = vi.hoisted(() => ({ enabled: false }));
const verifySignedStaticFeedEnvelopeMock = vi.hoisted(() => vi.fn(async () => ({
  entries: [],
  page: 1,
  total_entries: 0,
  generated_at: "2026-08-30T08:00:00.000Z",
})));

vi.mock("../insforge-config", () => ({
  getInsforgeAnonKey: getInsforgeAnonKeyMock,
  getInsforgeRemoteUrl: getInsforgeRemoteUrlMock,
  getInsforgeFunctionsUrl: getInsforgeFunctionsUrlMock,
}));

vi.mock("../local-api-url", () => ({
  buildLocalApiUrl: buildLocalApiUrlMock,
  isTauriRuntime: () => tauriRuntime.enabled,
}));

vi.mock("../local-api-auth", () => ({
  getLocalApiAuthHeaders: getLocalApiAuthHeadersMock,
}));

vi.mock("../signed-static-feed", () => ({
  verifySignedStaticFeedEnvelope: verifySignedStaticFeedEnvelopeMock,
}));

import {
  deleteLeaderboardParticipation,
  getLeaderboard,
  getLocalLeaderboardActualCost,
  getPublicVisibility,
  setLeaderboardActualCost,
  refreshLeaderboardActualCost,
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
    getInsforgeFunctionsUrlMock.mockReset();
    getInsforgeFunctionsUrlMock.mockReturnValue("https://example.function2.insforge.app");
    buildLocalApiUrlMock.mockClear();
    getLocalApiAuthHeadersMock.mockClear();
    tauriRuntime.enabled = false;
    verifySignedStaticFeedEnvelopeMock.mockClear();
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
      "https://example.function2.insforge.app/tokentracker-public-visibility",
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
      "https://example.function2.insforge.app/tokentracker-public-visibility",
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
    const fetchMock = mockJsonFetch(true);
    const accessToken = makeJwt({ sub: "writer-1" });

    await setLeaderboardActualCost({
      accessToken,
      share: true,
      periodCosts: { today: 1, week: 2, "30d": 2.5, month: 3, total: 4 },
      capturedAt: "2026-07-20T08:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.insforge.app/api/database/rpc/set_my_leaderboard_actual_cost",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
          apikey: "anon-key",
        }),
        body: JSON.stringify({
          p_share: true,
          p_today_usd: 1,
          p_week_usd: 2,
          p_30d_usd: 2.5,
          p_month_usd: 3,
          p_total_usd: 4,
          p_captured_at: "2026-07-20T08:00:00.000Z",
        }),
      }),
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain("writer-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.function2.insforge.app/tokentracker-leaderboard-refresh",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ source: "dirty-state-change" }),
      }),
    );
  });

  it("does not wake the leaderboard publisher when actual-cost consent is unchanged", async () => {
    const fetchMock = mockJsonFetch(false);
    const accessToken = makeJwt({ sub: "writer-1" });

    await setLeaderboardActualCost({
      accessToken,
      share: true,
      periodCosts: { today: 1, week: 2, "30d": 2.5, month: 3, total: 4 },
      capturedAt: "2026-07-20T08:00:00.000Z",
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://example.function2.insforge.app/tokentracker-leaderboard-refresh",
      expect.anything(),
    );
  });

  it("reads the local rolling 30-day actual cost before consent upload", async () => {
    const fetchMock = mockJsonFetch({
      period_costs_usd: { today: 1, week: 2, "30d": 2.5, month: 3, total: 4 },
    });
    await expect(getLocalLeaderboardActualCost()).resolves.toEqual({
      today: 1,
      week: 2,
      "30d": 2.5,
      month: 3,
      total: 4,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:7681/functions/tokentracker-leaderboard-actual-cost",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: "application/json",
        "x-tokentracker-local-auth": "local-token",
      },
    });
  });

  it("refreshes actual-cost amounts without enabling server consent", async () => {
    const fetchMock = mockJsonFetch({ enabled: false, changed: false });
    const accessToken = makeJwt({ sub: "writer-1" });

    await expect(refreshLeaderboardActualCost({
      accessToken,
      periodCosts: { today: 1, week: 2, "30d": 2.5, month: 3, total: 4 },
      capturedAt: "2026-07-20T08:00:00.000Z",
    })).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.insforge.app/api/database/rpc/refresh_my_leaderboard_actual_cost",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          p_today_usd: 1,
          p_week_usd: 2,
          p_30d_usd: 2.5,
          p_month_usd: 3,
          p_total_usd: 4,
          p_captured_at: "2026-07-20T08:00:00.000Z",
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://example.function2.insforge.app/tokentracker-leaderboard-refresh",
      expect.anything(),
    );
  });

  it("keeps actual-cost consent enabled without a dirty wake-up when totals are unchanged", async () => {
    const fetchMock = mockJsonFetch({ enabled: true, changed: false });
    const accessToken = makeJwt({ sub: "writer-1" });

    await expect(refreshLeaderboardActualCost({
      accessToken,
      periodCosts: { today: 1, week: 2, "30d": 2.5, month: 3, total: 4 },
      capturedAt: "2026-07-20T08:00:00.000Z",
    })).resolves.toBe(true);

    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://example.function2.insforge.app/tokentracker-leaderboard-refresh",
      expect.anything(),
    );
  });

  it("wakes the leaderboard publisher only when refreshed actual-cost totals changed", async () => {
    const fetchMock = mockJsonFetch({ enabled: true, changed: true });
    const accessToken = makeJwt({ sub: "writer-1" });

    await expect(refreshLeaderboardActualCost({
      accessToken,
      periodCosts: { today: 2, week: 3, "30d": 4, month: 5, total: 6 },
      capturedAt: "2026-07-20T08:00:00.000Z",
    })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.function2.insforge.app/tokentracker-leaderboard-refresh",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ source: "dirty-state-change" }),
      }),
    );
  });

  it("deletes the private avatar before the auth-bound cleanup RPC", async () => {
    const fetchMock = mockJsonFetch({});
    const accessToken = makeJwt({ sub: "writer-1" });
    await deleteLeaderboardParticipation({ accessToken });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.insforge.app/functions/tokentracker-avatar",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ Authorization: `Bearer ${accessToken}` }),
      }),
    );
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
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://example.insforge.app/functions/tokentracker-avatar",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://example.insforge.app/api/database/rpc/delete_my_leaderboard_data",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.function2.insforge.app/tokentracker-leaderboard-refresh",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ source: "dirty-state-change" }),
      }),
    );
  });

  it("does not delete database participation when private avatar cleanup fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: "Static avatar deletion failed" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const accessToken = makeJwt({ sub: "writer-1" });

    await expect(deleteLeaderboardParticipation({ accessToken })).rejects.toThrow("HTTP 502");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws clearly when the InsForge backend URL is not configured", async () => {
    getInsforgeFunctionsUrlMock.mockReturnValue("");

    await expect(getPublicVisibility({ accessToken: "token" })).rejects.toThrow(
      "InsForge base URL not configured",
    );
  });
});

describe("leaderboard API", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    tauriRuntime.enabled = false;
    getInsforgeRemoteUrlMock.mockReset();
    getInsforgeRemoteUrlMock.mockReturnValue("https://example.insforge.app");
    getInsforgeFunctionsUrlMock.mockReset();
    getInsforgeFunctionsUrlMock.mockReturnValue("https://example.function2.insforge.app");
  });

  it("reads exactly one fixed Top 50 static object without an Authorization header", async () => {
    const envelope = { version: 1, algorithm: "Ed25519", payload_b64: "signed" };
    const fetchMock = mockJsonFetch(envelope);

    await getLeaderboard({
      period: "today",
      source: "codex",
      metric: "tokens",
      limit: 20,
      offset: 40,
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://token-eyes-leaderboard-cache-staging.token-eyes-labs.workers.dev/v1/leaderboard/today/tokens/codex.json",
    );
    expect((options.headers as Record<string, string>).Authorization).toBeUndefined();
    expect((options.headers as Record<string, string>).apikey).toBeUndefined();
    expect((options.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(options.signal).toBeDefined();
    expect(verifySignedStaticFeedEnvelopeMock).toHaveBeenCalledWith(envelope, {
      expectedSchema: "token-eyes.leaderboard-snapshot/v1",
      expectedSnapshotKey: "today/tokens/codex",
      maxEntries: 50,
    });
  });

  it("uses local leaderboard data when developer preview explicitly requests mock mode", async () => {
    const fetchMock = mockJsonFetch({ entries: [] });

    const result = await getLeaderboard({
      mock: true,
      period: "today",
      source: "codex",
      metric: "tokens",
      limit: 20,
      offset: 0,
    });

    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.me).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the signed disk-backed local proxy in the Tauri desktop runtime", async () => {
    tauriRuntime.enabled = true;
    const payload = { entries: [{ rank: 1, display_name: "Desktop Cache" }] };
    const fetchMock = mockJsonFetch(payload);

    await expect(getLeaderboard({
      period: "30d",
      source: "all",
      metric: "tokens",
      limit: 50,
      offset: 0,
    })).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://127.0.0.1:7681/functions/tokentracker-leaderboard-public?period=30d&metric=tokens&source=all&limit=50&offset=0",
    );
  });

  it("never falls back to an InsForge function or public database when the static read fails", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "unavailable" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLeaderboard({
      period: "30d",
      source: "all",
      metric: "tokens",
      limit: 50,
      offset: 0,
    })).rejects.toThrow("HTTP 503");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://token-eyes-leaderboard-cache-staging.token-eyes-labs.workers.dev/v1/leaderboard/30d/tokens/all.json",
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("/api/database/");
  });
});
