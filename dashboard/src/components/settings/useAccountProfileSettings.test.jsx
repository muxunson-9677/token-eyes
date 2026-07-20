import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    enabled: true,
    signedIn: true,
    user: { id: "user-1", email: "user@example.com" },
    getAccessToken: vi.fn(async () => "jwt"),
    refreshDisplayName: vi.fn(),
    signOut: vi.fn(),
  },
  getProfile: vi.fn(),
  setProfile: vi.fn(),
  setActualCost: vi.fn(),
  getCosts: vi.fn(),
  deleteParticipation: vi.fn(),
}));

vi.mock("../../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => mocks.auth,
}));
vi.mock("../../lib/auth-token", () => ({
  resolveAuthAccessTokenWithRetry: async ({ getAccessToken }) => getAccessToken(),
}));
vi.mock("../../lib/api", () => ({
  getPublicVisibility: mocks.getProfile,
  setPublicVisibility: mocks.setProfile,
  setLeaderboardActualCost: mocks.setActualCost,
  getLocalLeaderboardActualCost: mocks.getCosts,
  deleteLeaderboardParticipation: mocks.deleteParticipation,
  uploadLeaderboardAvatar: vi.fn(),
}));

import { useAccountProfileSettings } from "./useAccountProfileSettings.js";

describe("useAccountProfileSettings consent", () => {
  beforeEach(() => {
    mocks.getProfile.mockReset();
    mocks.getProfile.mockResolvedValue({
      leaderboard_public: true,
      share_actual_cost: false,
    });
    mocks.setProfile.mockReset();
    mocks.setProfile.mockResolvedValue({});
    mocks.setActualCost.mockReset();
    mocks.setActualCost.mockResolvedValue(undefined);
    mocks.getCosts.mockReset();
    mocks.getCosts.mockResolvedValue({ today: 1, week: 2, month: 3, total: 4 });
    mocks.deleteParticipation.mockReset();
    mocks.auth.signOut.mockReset();
  });

  it("bootstraps login participation but keeps actual cost private by default", async () => {
    mocks.getProfile.mockResolvedValue({
      leaderboard_public: false,
      share_actual_cost: false,
    });
    const { result } = renderHook(() => useAccountProfileSettings());
    await waitFor(() => expect(result.current.profileLoading).toBeUndefined());
    await waitFor(() => {
      expect(mocks.setProfile).toHaveBeenCalledWith({
        accessToken: "jwt",
        leaderboard_public: true,
      });
    });
    expect(result.current.shareActualCost).toBe(false);
  });

  it("reads four local totals before enabling and sends no detail fields", async () => {
    const { result } = renderHook(() => useAccountProfileSettings());
    await waitFor(() => expect(mocks.getProfile).toHaveBeenCalled());
    await act(async () => result.current.handleActualCostToggle());

    expect(mocks.getCosts).toHaveBeenCalledTimes(1);
    expect(mocks.setActualCost).toHaveBeenLastCalledWith({
      accessToken: "jwt",
      share: true,
      periodCosts: { today: 1, week: 2, month: 3, total: 4 },
    });
    expect(result.current.shareActualCost).toBe(true);
  });

  it("nulls cloud cost before confirming the consent switch is off", async () => {
    mocks.getProfile.mockResolvedValue({
      leaderboard_public: true,
      share_actual_cost: true,
    });
    let resolveSave;
    mocks.setActualCost.mockImplementation(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));
    const { result } = renderHook(() => useAccountProfileSettings());
    await waitFor(() => expect(result.current.shareActualCost).toBe(true));

    let pending;
    act(() => {
      pending = result.current.handleActualCostToggle();
    });
    expect(result.current.shareActualCost).toBe(true);
    await waitFor(() => {
      expect(mocks.setActualCost).toHaveBeenCalledWith({
        accessToken: "jwt",
        share: false,
      });
    });
    expect(result.current.shareActualCost).toBe(true);
    await act(async () => {
      resolveSave({});
      await pending;
    });
    expect(result.current.shareActualCost).toBe(false);
  });
});
