import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    enabled: true,
    loading: false,
    signedIn: false,
    user: null as null | { id: string },
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
  refreshActualCost: vi.fn(async () => true),
  setParticipation: vi.fn(),
  consumeIntent: vi.fn(() => false),
  clearIntent: vi.fn(),
}));

vi.mock("../../contexts/InsforgeAuthContext", () => ({
  useInsforgeAuth: () => mocks.auth,
}));

vi.mock("../../lib/leaderboard-state-client", () => ({
  syncLeaderboardState: mocks.sync,
}));

vi.mock("../../lib/leaderboard-sync-state", () => ({
  getLeaderboardSyncState: mocks.getSyncState,
  setLeaderboardParticipationState: mocks.setParticipation,
  consumeLeaderboardLoginIntent: mocks.consumeIntent,
  clearLeaderboardLoginIntent: mocks.clearIntent,
}));

vi.mock("../../lib/api", () => ({
  getPublicVisibility: mocks.getProfile,
  setPublicVisibility: mocks.setProfile,
  getLocalLeaderboardActualCost: mocks.getCosts,
  setLeaderboardActualCost: mocks.setActualCost,
  refreshLeaderboardActualCost: mocks.refreshActualCost,
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
    mocks.auth.user = null;
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
    mocks.refreshActualCost.mockReset();
    mocks.refreshActualCost.mockResolvedValue(true);
    mocks.setParticipation.mockReset();
    mocks.consumeIntent.mockReset();
    mocks.consumeIntent.mockReturnValue(false);
    mocks.clearIntent.mockReset();
  });

  it("never syncs while signed out", async () => {
    renderProbe("/leaderboard");
    await Promise.resolve();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("does not enroll or upload when a user signs in outside the leaderboard", async () => {
    const view = renderProbe();
    mocks.auth.signedIn = true;
    mocks.auth.user = { id: "account-a" };
    view.rerender(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Probe />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.getProfile).toHaveBeenCalled());
    expect(mocks.setProfile).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.clearIntent).not.toHaveBeenCalled();
  });

  it("checks the local summary hash whenever an authenticated user opens the leaderboard", async () => {
    mocks.auth.signedIn = true;
    mocks.auth.user = { id: "account-a" };
    mocks.getSyncState.mockReturnValue({
      pending: false,
      lastSuccessAt: new Date().toISOString(),
      participationReady: true,
      participant: true,
    });
    renderProbe("/leaderboard");

    await waitFor(() => {
      expect(mocks.sync).toHaveBeenCalledWith({
        getAccessToken: expect.any(Function),
        reason: "leaderboard-open",
        accountId: "account-a",
      });
    });
  });

  it("checks the cached local summary every five seconds without reading the public list", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    mocks.auth.signedIn = true;
    mocks.auth.user = { id: "account-a" };
    mocks.getSyncState.mockReturnValue({
      pending: false,
      participationReady: true,
      participant: true,
      shareActualCost: false,
    });
    renderProbe("/leaderboard");
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({
      reason: "leaderboard-open",
    })));
    await waitFor(() => expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000));

    const callback = intervalSpy.mock.calls.find((call) => call[1] === 5_000)?.[0];
    expect(callback).toBeTypeOf("function");
    mocks.sync.mockClear();
    callback?.();
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith({
      getAccessToken: mocks.auth.getAccessToken,
      reason: "meaningful-change",
      accountId: "account-a",
    }));
  });

  it("does not perform a daily client catch-up while another page is open", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    mocks.auth.signedIn = true;
    mocks.auth.user = { id: "account-a" };
    mocks.getSyncState.mockReturnValue({
      pending: false,
      lastSuccessAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      participationReady: true,
      participant: true,
      shareActualCost: false,
    });
    renderProbe("/dashboard");

    await Promise.resolve();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);
  });

  it("checks known participants for meaningful changes even after they leave the leaderboard", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    mocks.auth.signedIn = true;
    mocks.auth.user = { id: "account-a" };
    mocks.getSyncState.mockReturnValue({
      pending: false,
      participationReady: true,
      participant: true,
      shareActualCost: false,
    });
    renderProbe("/dashboard");
    await waitFor(() => expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000));

    const callback = intervalSpy.mock.calls.find((call) => call[1] === 5_000)?.[0];
    callback?.();
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith({
      getAccessToken: mocks.auth.getAccessToken,
      reason: "meaningful-change",
      accountId: "account-a",
    }));
  });

  it("keeps a signed-in nonparticipant private", async () => {
    mocks.auth.signedIn = true;
    mocks.auth.user = { id: "account-a" };
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
      expect(mocks.getProfile).toHaveBeenCalled();
    });
    expect(mocks.setProfile).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.setParticipation).toHaveBeenCalledWith({
      accountId: "account-a",
      participant: false,
      shareActualCost: false,
    });
  });

  it("enrolls once when leaderboard login intent completes on the leaderboard", async () => {
    const view = renderProbe("/leaderboard");
    mocks.consumeIntent.mockReturnValue(true);
    mocks.getProfile.mockResolvedValue({
      leaderboard_public: false,
      share_actual_cost: false,
    });
    mocks.auth.signedIn = true;
    mocks.auth.user = { id: "account-a" };
    view.rerender(
      <MemoryRouter initialEntries={["/leaderboard"]}>
        <Probe />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.setProfile).toHaveBeenCalledWith({
      accessToken: "jwt",
      leaderboard_public: true,
    }));
    expect(mocks.sync).toHaveBeenCalledWith({
      getAccessToken: expect.any(Function),
      reason: "leaderboard-consent",
      accountId: "account-a",
    });
  });

  it("preserves leaderboard consent across an auth callback and consumes it on return", async () => {
    mocks.auth.signedIn = true;
    mocks.auth.user = { id: "account-a" };
    mocks.consumeIntent.mockReturnValue(true);
    mocks.getProfile.mockResolvedValue({
      leaderboard_public: false,
      share_actual_cost: false,
    });
    mocks.getSyncState.mockReturnValue({ pending: false });
    const view = renderProbe("/auth/callback");

    await waitFor(() => expect(mocks.getProfile).toHaveBeenCalledTimes(1));
    expect(mocks.setProfile).not.toHaveBeenCalled();
    expect(mocks.clearIntent).not.toHaveBeenCalled();

    await act(async () => view.navigateRef.current?.("/leaderboard"));
    await waitFor(() => expect(mocks.setProfile).toHaveBeenCalledWith({
      accessToken: "jwt",
      leaderboard_public: true,
    }));
    expect(mocks.consumeIntent).toHaveBeenCalledTimes(1);
  });

  it("refreshes the four actual-cost totals when consent remains enabled", async () => {
    mocks.auth.signedIn = true;
    mocks.auth.user = { id: "account-a" };
    mocks.getProfile.mockResolvedValue({
      leaderboard_public: true,
      share_actual_cost: true,
    });
    mocks.getSyncState.mockReturnValue({
      pending: false,
      lastSuccessAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      participationReady: true,
      participant: true,
      shareActualCost: true,
    });
    renderProbe("/leaderboard");

    await waitFor(() => {
      expect(mocks.refreshActualCost).toHaveBeenCalledWith({
        accessToken: "jwt",
        periodCosts: { today: 1, week: 2, month: 3, total: 4 },
      });
    });
    expect(mocks.sync).toHaveBeenCalledWith({
      getAccessToken: expect.any(Function),
      reason: "leaderboard-open",
      accountId: "account-a",
    });
    expect(mocks.getProfile).not.toHaveBeenCalled();
  });

  it("does not refresh profile or actual cost again inside the daily budget", async () => {
    mocks.auth.signedIn = true;
    mocks.auth.user = { id: "account-a" };
    mocks.getSyncState.mockReturnValue({
      pending: false,
      lastSuccessAt: new Date().toISOString(),
      participationReady: true,
      participant: true,
      shareActualCost: true,
    });
    renderProbe("/dashboard");
    await Promise.resolve();

    expect(mocks.getProfile).not.toHaveBeenCalled();
    expect(mocks.refreshActualCost).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("does not schedule polling or catch up after a recent success", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    mocks.auth.signedIn = true;
    mocks.auth.user = { id: "account-a" };
    mocks.getSyncState.mockReturnValue({
      pending: false,
      lastSuccessAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    renderProbe("/dashboard");
    await Promise.resolve();

    expect(mocks.sync).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
  });

  it("re-reads the profile when the authenticated account changes", async () => {
    mocks.auth.signedIn = true;
    mocks.auth.user = { id: "account-b" };
    mocks.getProfile.mockResolvedValue({
      leaderboard_public: false,
      share_actual_cost: false,
    });
    mocks.getSyncState.mockImplementation((accountId?: string) =>
      accountId === "account-a"
        ? {
          pending: false,
          accountId: "account-a",
          participationReady: true,
          participant: true,
          shareActualCost: true,
        }
        : { pending: false },
    );

    renderProbe("/dashboard");

    await waitFor(() => expect(mocks.getProfile).toHaveBeenCalled());
    expect(mocks.setParticipation).toHaveBeenCalledWith({
      accountId: "account-b",
      participant: false,
      shareActualCost: false,
    });
    expect(mocks.refreshActualCost).not.toHaveBeenCalled();
  });
});
