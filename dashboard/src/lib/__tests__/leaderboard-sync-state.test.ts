import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearCloudDeviceSession } from "../cloud-sync-prefs";
import {
  clearLeaderboardSyncState,
  getLeaderboardSyncState,
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
      shareActualCost: true,
    });

    expect(getLeaderboardSyncState()).toEqual({
      pending: false,
      summaryHash: "d".repeat(64),
      accountId: "account-a",
      participationReady: true,
      shareActualCost: true,
    });

    setLeaderboardParticipationState({
      accountId: "account-a",
      shareActualCost: false,
    });
    expect(getLeaderboardSyncState()).toMatchObject({
      accountId: "account-a",
      participationReady: true,
      shareActualCost: false,
    });
  });

  it("does not expose cached consent to another authenticated account", () => {
    setLeaderboardParticipationState({
      accountId: "account-a",
      shareActualCost: true,
    });

    expect(getLeaderboardSyncState("account-a")).toMatchObject({
      participationReady: true,
      shareActualCost: true,
    });
    expect(getLeaderboardSyncState("account-b")).toEqual({ pending: false });
  });

  it("tolerates corrupt storage", () => {
    localStorage.setItem("tokentracker_leaderboard_sync_state_v1", "{broken");
    expect(getLeaderboardSyncState()).toEqual({ pending: false });
    expect(() => clearLeaderboardSyncState()).not.toThrow();
  });
});
