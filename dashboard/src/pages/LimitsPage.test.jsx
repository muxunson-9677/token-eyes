import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  publishUsageLimitsPreloadState,
  resetDashboardPreload,
} from "../lib/dashboard-preload.js";
import { copy } from "../lib/copy";
import { LimitsPage } from "./LimitsPage.jsx";

const useUsageLimitsMock = vi.hoisted(() => vi.fn());
const useLimitAccountsMock = vi.hoisted(() => vi.fn());
const useLimitsDisplayPrefsMock = vi.hoisted(() => vi.fn());

vi.mock("../hooks/use-usage-limits", () => ({
  useUsageLimits: useUsageLimitsMock,
}));
vi.mock("../hooks/use-limit-accounts", () => ({
  useLimitAccounts: useLimitAccountsMock,
}));

vi.mock("../hooks/use-limits-display-prefs.js", () => ({
  useLimitsDisplayPrefs: useLimitsDisplayPrefsMock,
}));

vi.mock("../ui/dashboard/components/UsageLimitsPanel.jsx", () => ({
  UsageLimitsPanel: ({ kimi, codex, displayMode, accounts, accountsRefreshing }) => (
    <div
      data-testid="limits-panel"
      data-display-mode={displayMode ?? "absent"}
      data-account-count={accounts?.length ?? 0}
      data-accounts-refreshing={accountsRefreshing ? "true" : "false"}
    >
      {kimi?.configured ? "Kimi connected" : "Kimi missing"}
      {codex?.configured ? " Codex connected" : ""}
    </div>
  ),
}));

vi.mock("../components/LimitsPageSkeleton.jsx", () => ({
  LimitsPageSkeleton: () => <div data-testid="limits-skeleton" />,
}));

const apiLimits = {
  kimi: {
    configured: true,
    error: null,
    primary_window: { used_percent: 64, reset_at: "2026-05-04T06:02:56.054Z" },
  },
};

const preloadedLimits = {
  codex: {
    configured: true,
    error: null,
    primary_window: { used_percent: 22, reset_at: 1_779_999_999 },
  },
};

describe("LimitsPage", () => {
  beforeEach(() => {
    resetDashboardPreload();
    useUsageLimitsMock.mockReset();
    useUsageLimitsMock.mockImplementation(() => ({
      data: apiLimits,
      error: null,
      isLoading: false,
      refresh: vi.fn(),
    }));
    useLimitAccountsMock.mockReset();
    useLimitAccountsMock.mockImplementation(() => ({
      data: { accounts: [], forecasts: [] },
      error: null,
      isLoading: false,
      refresh: vi.fn(),
    }));
    useLimitsDisplayPrefsMock.mockReset();
    useLimitsDisplayPrefsMock.mockImplementation(() => ({
      order: ["kimi"],
      visibility: { kimi: true },
      displayMode: "used",
    }));
  });

  it("passes Kimi limits from the API response into the limits panel", () => {
    render(
      <MemoryRouter>
        <LimitsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Kimi connected")).toBeInTheDocument();
  });

  it("uses matching preloaded limits as the hook initial state and skips the full skeleton", () => {
    publishUsageLimitsPreloadState(preloadedLimits);
    useUsageLimitsMock.mockImplementation((options) => ({
      data: options.initialState?.data,
      error: null,
      isLoading: false,
    }));

    render(
      <MemoryRouter>
        <LimitsPage />
      </MemoryRouter>,
    );

    expect(useUsageLimitsMock).toHaveBeenCalledWith({
      initialRefresh: true,
      initialState: expect.objectContaining({
        data: preloadedLimits,
        source: "dashboard-existing",
      }),
      publishToPreloadCache: true,
    });
    expect(screen.queryByTestId("limits-skeleton")).not.toBeInTheDocument();
    expect(screen.getByTestId("limits-panel")).toHaveTextContent("Codex connected");
  });

  it("keeps the initialRefresh path when no preloaded state exists", () => {
    render(
      <MemoryRouter>
        <LimitsPage />
      </MemoryRouter>,
    );

    expect(useUsageLimitsMock).toHaveBeenCalledWith({
      initialRefresh: true,
      publishToPreloadCache: true,
    });
  });

  it("forwards the active displayMode to the limits panel", () => {
    useLimitsDisplayPrefsMock.mockImplementation(() => ({
      order: ["kimi"],
      visibility: { kimi: true },
      displayMode: "remaining",
    }));

    render(
      <MemoryRouter>
        <LimitsPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("limits-panel")).toHaveAttribute(
      "data-display-mode",
      "remaining",
    );
  });

  it("batch-refreshes usage and privacy-safe account rows from one control", async () => {
    const user = userEvent.setup();
    let resolveAccounts;
    const refreshUsage = vi.fn().mockResolvedValue(undefined);
    const refreshAccounts = vi.fn(() => new Promise((resolve) => {
      resolveAccounts = resolve;
    }));
    useUsageLimitsMock.mockImplementation(() => ({
      data: apiLimits,
      error: null,
      isLoading: false,
      refresh: refreshUsage,
    }));
    useLimitAccountsMock.mockImplementation(() => ({
      data: {
        accounts: [{ provider_id: "codex", account_key: "hashed", account_label: "Work" }],
        forecasts: [],
      },
      error: null,
      isLoading: false,
      refresh: refreshAccounts,
    }));

    render(
      <MemoryRouter>
        <LimitsPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("limits-panel")).toHaveAttribute("data-account-count", "1");
    await user.click(screen.getByRole("button", { name: copy("limits.accounts.refresh_all") }));
    expect(refreshUsage).toHaveBeenCalledTimes(1);
    expect(refreshAccounts).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("limits-panel")).toHaveAttribute(
      "data-accounts-refreshing",
      "true",
    );

    resolveAccounts();
    await waitFor(() => {
      expect(screen.getByTestId("limits-panel")).toHaveAttribute(
        "data-accounts-refreshing",
        "false",
      );
    });
  });
});
