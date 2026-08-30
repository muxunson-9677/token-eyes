import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearCloudDeviceSession } from "../cloud-sync-prefs";
import {
  clearLeaderboardSyncState,
  consumeLeaderboardLoginIntent,
  getLeaderboardSyncState,
  markLeaderboardLoginIntent,
  setLeaderboardParticipationState,
  setLeaderboardSyncState,
} from "../leaderboard-sync-state";

function installStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
  });
  const sessionStore = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => sessionStore.get(key) ?? null,
    setItem: (key: string, value: string) => sessionStore.set(key, String(value)),
    removeItem: (key: string) => sessionStore.delete(key),
  });
}

describe("leaderboard retry state", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installStorage();
  });

  it("round-trips only bounded retry metadata", () => {
    setLeaderboardSyncState({
      pending: true,
      summaryHash: "b".repeat(64),
      lastAttemptAt: "2026-07-20T08:00:00.000Z",
      lastReason: "daily-catchup",
    });
    expect(getLeaderboardSyncState()).toEqual({
      pending: true,
      summaryHash: "b".repeat(64),
      lastAttemptAt: "2026-07-20T08:00:00.000Z",
      lastReason: "daily-catchup",
    });
  });

  it("sign-out clears retry metadata without touching local usage", () => {
    localStorage.setItem("tokentracker-local-usage-cache", "keep-me");
    setLeaderboardSyncState({ pending: true, summaryHash: "c".repeat(64) });

    clearCloudDeviceSession();

    expect(getLeaderboardSyncState()).toEqual({ pending: false });
    expect(localStorage.getItem("tokentracker-local-usage-cache")).toBe("keep-me");
  });

  it("persists participation bootstrap and actual-cost consent without user data", () => {
    setLeaderboardSyncState({
      pending: false,
      summaryHash: "d".repeat(64),
    });
    setLeaderboardParticipationState({
      accountId: "account-a",
      participant: true,
      shareActualCost: true,
    });

    expect(getLeaderboardSyncState()).toEqual({
      pending: false,
      summaryHash: "d".repeat(64),
      accountId: "account-a",
      participationReady: true,
      participant: true,
      shareActualCost: true,
    });

    setLeaderboardParticipationState({
      accountId: "account-a",
      participant: true,
      shareActualCost: false,
    });
    expect(getLeaderboardSyncState()).toMatchObject({
      accountId: "account-a",
      participationReady: true,
      participant: true,
      shareActualCost: false,
    });
  });

  it("does not expose cached consent to another authenticated account", () => {
    setLeaderboardParticipationState({
      accountId: "account-a",
      participant: true,
      shareActualCost: true,
    });

    expect(getLeaderboardSyncState("account-a")).toMatchObject({
      participationReady: true,
      participant: true,
      shareActualCost: true,
    });
    expect(getLeaderboardSyncState("account-b")).toEqual({ pending: false });
  });

  it("consumes a leaderboard login intent once and expires it after ten minutes", () => {
    markLeaderboardLoginIntent(1_000);
    expect(consumeLeaderboardLoginIntent(1_000 + 9 * 60_000)).toBe(true);
    expect(consumeLeaderboardLoginIntent(1_000 + 9 * 60_000)).toBe(false);

    markLeaderboardLoginIntent(2_000);
    expect(consumeLeaderboardLoginIntent(2_000 + 11 * 60_000)).toBe(false);
  });

  it("binds login consent to the current browser session instead of durable local storage", () => {
    markLeaderboardLoginIntent(1_000);
    expect(localStorage.getItem("tokentracker_leaderboard_login_intent_v1")).toBeNull();
    expect(sessionStorage.getItem("tokentracker_leaderboard_login_intent_v1")).not.toBeNull();
  });

  it("tolerates corrupt storage", () => {
    localStorage.setItem("tokentracker_leaderboard_sync_state_v1", "{broken");
    expect(getLeaderboardSyncState()).toEqual({ pending: false });
    expect(() => clearLeaderboardSyncState()).not.toThrow();
  });
});
