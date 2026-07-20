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
        getAccessToken: mocks.auth.getAccessToken,
        reason: "first-login",
      });
    });
  });

  it("syncs when an authenticated user opens the leaderboard", async () => {
    mocks.auth.signedIn = true;
    mocks.getSyncState.mockReturnValue({
      pending: false,
      lastSuccessAt: new Date().toISOString(),
    });
    renderProbe("/leaderboard");

    await waitFor(() => {
      expect(mocks.sync).toHaveBeenCalledWith({
        getAccessToken: mocks.auth.getAccessToken,
        reason: "leaderboard-open",
      });
    });
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
        getAccessToken: mocks.auth.getAccessToken,
        reason: "daily-catchup",
      });
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
