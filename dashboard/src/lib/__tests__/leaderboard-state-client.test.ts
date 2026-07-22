import { beforeEach, describe, expect, it, vi } from "vitest";

const { getInsforgeAnonKeyMock, getInsforgeRemoteUrlMock } = vi.hoisted(() => ({
  getInsforgeAnonKeyMock: vi.fn(() => "anon-key"),
  getInsforgeRemoteUrlMock: vi.fn(() => "https://cloud.example"),
}));

vi.mock("../insforge-config", () => ({
  getInsforgeAnonKey: getInsforgeAnonKeyMock,
  getInsforgeRemoteUrl: getInsforgeRemoteUrlMock,
}));

import { syncLeaderboardState } from "../leaderboard-state-client";
import {
  getLeaderboardSyncState,
  setLeaderboardSyncState,
} from "../leaderboard-sync-state";

const STATE = {
  version: 1,
  device_id: "stable-machine-id",
  captured_at: "2026-07-20T08:00:00.000Z",
  periods: {
    today: [["codex", "gpt-5.4", "100", "20", "10", "0", "0"]],
    week: [["codex", "gpt-5.4", "100", "20", "10", "0", "0"]],
    month: [["codex", "gpt-5.4", "100", "20", "10", "0", "0"]],
    total: [["codex", "gpt-5.4", "100", "20", "10", "0", "0"]],
  },
};
const SUMMARY_HASH = "a".repeat(64);

function response(ok: boolean, body: unknown = {}) {
  return {
    ok,
    status: ok ? 204 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function installStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
  });
}

function installFetch(options: { remoteOk?: boolean; state?: unknown } = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/functions/tokentracker-leaderboard-state") {
      return response(true, {
        ok: true,
        state: options.state ?? STATE,
        summary_hash: SUMMARY_HASH,
      });
    }
    if (url === "https://cloud.example/api/database/rpc/upsert_my_leaderboard_device_state") {
      return response(options.remoteOk !== false);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("leaderboard state client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installStorage();
    getInsforgeRemoteUrlMock.mockReturnValue("https://cloud.example");
  });

  it("fetches local state before resolving JWT and never writes without JWT", async () => {
    const events: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      events.push(`fetch:${url}`);
      return response(true, { ok: true, state: STATE, summary_hash: SUMMARY_HASH });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncLeaderboardState({
      reason: "first-login",
      accountId: "account-a",
      getAccessToken: async () => {
        events.push("token");
        return null;
      },
    })).resolves.toEqual({ status: "deferred", summaryHash: SUMMARY_HASH });

    expect(events).toEqual([
      "fetch:/functions/tokentracker-leaderboard-state",
      "token",
    ]);
    expect(getLeaderboardSyncState().pending).toBe(true);
  });

  it("calls only the authenticated RPC with a minimal, user-id-free body", async () => {
    const fetchMock = installFetch();
    const tokenWithSubject = "header.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature";
    setLeaderboardSyncState({
      pending: true,
      accountId: "account-a",
      participationReady: true,
      shareActualCost: true,
    });

    await expect(syncLeaderboardState({
      reason: "leaderboard-open",
      accountId: "account-a",
      getAccessToken: async () => tokenWithSubject,
    })).resolves.toEqual({ status: "uploaded", summaryHash: SUMMARY_HASH });

    const remoteCall = fetchMock.mock.calls[1];
    expect(remoteCall[0]).toBe(
      "https://cloud.example/api/database/rpc/upsert_my_leaderboard_device_state",
    );
    const init = remoteCall[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${tokenWithSubject}`,
      apikey: "anon-key",
      Prefer: "return=minimal",
    });
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      p_device_id: STATE.device_id,
      p_state_version: 1,
      p_summary_hash: SUMMARY_HASH,
      p_captured_at: STATE.captured_at,
      p_payload: STATE,
    });
    expect(JSON.stringify(body)).not.toContain("user-123");
    expect(body.user_id).toBeUndefined();
    expect(body.p_user_id).toBeUndefined();
    expect(getLeaderboardSyncState()).toMatchObject({
      pending: false,
      accountId: "account-a",
      participationReady: true,
      shareActualCost: true,
    });
  });

  it("skips an unchanged successful hash unless forced", async () => {
    setLeaderboardSyncState({
      pending: false,
      accountId: "account-a",
      summaryHash: SUMMARY_HASH,
      lastSuccessAt: "2026-07-20T08:01:00.000Z",
    });
    const fetchMock = installFetch();

    await expect(syncLeaderboardState({
      reason: "daily-catchup",
      accountId: "account-a",
      getAccessToken: async () => "jwt",
    })).resolves.toEqual({ status: "unchanged", summaryHash: SUMMARY_HASH });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uploads the same local hash again for a different signed-in account", async () => {
    setLeaderboardSyncState({
      pending: false,
      accountId: "account-a",
      summaryHash: SUMMARY_HASH,
      lastSuccessAt: "2026-07-20T08:01:00.000Z",
    });
    const fetchMock = installFetch();

    await expect(syncLeaderboardState({
      reason: "first-login",
      accountId: "account-b",
      getAccessToken: async () => "jwt-b",
    })).resolves.toEqual({ status: "uploaded", summaryHash: SUMMARY_HASH });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getLeaderboardSyncState("account-b")).toMatchObject({
      accountId: "account-b",
      pending: false,
    });
  });

  it("checks the 8 KiB payload limit before any network write", async () => {
    const fetchMock = installFetch({
      state: { ...STATE, oversized: "x".repeat(9 * 1024) },
    });

    await expect(syncLeaderboardState({
      reason: "manual-list-refresh",
      accountId: "account-a",
      getAccessToken: async () => "jwt",
    })).resolves.toEqual({ status: "deferred", summaryHash: SUMMARY_HASH });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getLeaderboardSyncState().pending).toBe(true);
  });

  it("persists pending retry metadata after an RPC failure", async () => {
    const fetchMock = installFetch({ remoteOk: false });

    await expect(syncLeaderboardState({
      reason: "app-exit",
      accountId: "account-a",
      getAccessToken: async () => "jwt",
    })).resolves.toEqual({ status: "deferred", summaryHash: SUMMARY_HASH });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getLeaderboardSyncState()).toMatchObject({
      pending: true,
      summaryHash: SUMMARY_HASH,
      lastReason: "app-exit",
    });
  });
});
