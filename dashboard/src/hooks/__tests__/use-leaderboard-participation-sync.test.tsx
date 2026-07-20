import React from "react";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    enabled: true,
    loading: false,
    signedIn: false,
    getAccessToken: vi.fn(async () => "jwt"),
  },
  getSyncState: vi.fn(() => ({ pending: false })),
  sync: vi.fn(async () => ({ status: "uploaded" })),
  getProfile: vi.fn(async () => ({
    leaderboard_public: true,
    share_actual_cost: false,
  })),
  setProfile: vi.fn(async () => ({})),
  getCosts: vi.fn(async () => ({ today: 1, week: 2, month: 3, total: 4 })),
  setActualCost: vi.fn(async () => undefined),
}));

vi.mock("../../contexts/InsforgeAuthContext", () => ({
  useInsforgeAuth: () => mocks.auth,
}));

vi.mock("../../lib/leaderboard-state-client", () => ({
  syncLeaderboardState: mocks.sync,
}));

vi.mock("../../lib/leaderboard-sync-state", () => ({
  getLeaderboardSyncState: mocks.getSyncState,
}));

vi.mock("../../lib/api", () => ({
  getPublicVisibility: mocks.getProfile,
  setPublicVisibility: mocks.setProfile,
  getLocalLeaderboardActualCost: mocks.getCosts,
  setLeaderboardActualCost: mocks.setActualCost,
}));

import { useLeaderboardParticipationSync } from "../use-leaderboard-participation-sync";

function Probe({ navigateRef }: { navigateRef?: { current?: (path: string) => void } }) {
  const navigate = useNavigate();
  if (navigateRef) navigateRef.current = navigate;
  useLeaderboardParticipationSync();
  return null;
}

function renderProbe(path = "/dashboard") {
  const navigateRef: { current?: (path: string) => void } = {};
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Probe navigateRef={navigateRef} />
    </MemoryRouter>,
  );
  return { ...view, navigateRef };
}

describe("leaderboard participation lifecycle", () => {
  beforeEach(() => {
    mocks.auth.enabled = true;
    mocks.auth.loading = false;
    mocks.auth.signedIn = false;
    mocks.auth.getAccessToken.mockClear();
    mocks.getSyncState.mockReset();
    mocks.getSyncState.mockReturnValue({ pending: false });
    mocks.sync.mockReset();
    mocks.sync.mockResolvedValue({ status: "uploaded" });
    mocks.getProfile.mockReset();
    mocks.getProfile.mockResolvedValue({
      leaderboard_public: true,
      share_actual_cost: false,
    });
    mocks.setProfile.mockReset();
    mocks.setProfile.mockResolvedValue({});
    mocks.getCosts.mockReset();
    mocks.getCosts.mockResolvedValue({ today: 1, week: 2, month: 3, total: 4 });
    mocks.setActualCost.mockReset();
    mocks.setActualCost.mockResolvedValue(undefined);
  });

  it("never syncs while signed out", async () => {
    renderProbe("/leaderboard");
    await Promise.resolve();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("syncs first-login only on a signed-out to signed-in transition", async () => {
    const view = renderProbe();
    mocks.auth.signedIn = true;
    view.rerender(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Probe />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.sync).toHaveBeenCalledWith({
        getAccessToken: expect.any(Function),
        reason: "first-login",
      });
    });
  });

  it("does not spend another upload when an authenticated user opens the leaderboard after a recent success", async () => {
    mocks.auth.signedIn = true;
    mocks.getSyncState.mockReturnValue({
      pending: false,
      lastSuccessAt: new Date().toISOString(),
    });
    renderProbe("/leaderboard");

    await waitFor(() => expect(mocks.getProfile).toHaveBeenCalled());
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("requests daily catch-up only when the last success is over 24 hours old", async () => {
    mocks.auth.signedIn = true;
    mocks.getSyncState.mockReturnValue({
      pending: false,
      lastSuccessAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });
    renderProbe("/dashboard");

    await waitFor(() => {
      expect(mocks.sync).toHaveBeenCalledWith({
        getAccessToken: expect.any(Function),
        reason: "daily-catchup",
      });
    });
  });

  it("makes every signed-in session public even when the daily upload is not due", async () => {
    mocks.auth.signedIn = true;
    mocks.getProfile.mockResolvedValue({
      leaderboard_public: false,
      share_actual_cost: false,
    });
    mocks.getSyncState.mockReturnValue({
      pending: false,
      lastSuccessAt: new Date().toISOString(),
    });
    renderProbe("/dashboard");

    await waitFor(() => {
      expect(mocks.setProfile).toHaveBeenCalledWith({
        accessToken: "jwt",
        leaderboard_public: true,
      });
    });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("refreshes the four actual-cost totals when consent remains enabled", async () => {
    mocks.auth.signedIn = true;
    mocks.getProfile.mockResolvedValue({
      leaderboard_public: true,
      share_actual_cost: true,
    });
    mocks.getSyncState.mockReturnValue({
      pending: false,
      lastSuccessAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });
    renderProbe("/dashboard");

    await waitFor(() => {
      expect(mocks.setActualCost).toHaveBeenCalledWith({
        accessToken: "jwt",
        share: true,
        periodCosts: { today: 1, week: 2, month: 3, total: 4 },
      });
    });
    expect(mocks.sync).toHaveBeenCalledWith({
      getAccessToken: expect.any(Function),
      reason: "daily-catchup",
    });
  });

  it("does not schedule polling or catch up after a recent success", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    mocks.auth.signedIn = true;
    mocks.getSyncState.mockReturnValue({
      pending: false,
      lastSuccessAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    renderProbe("/dashboard");
    await Promise.resolve();

    expect(mocks.sync).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
  });
});
