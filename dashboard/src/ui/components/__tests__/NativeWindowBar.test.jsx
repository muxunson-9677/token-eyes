import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeWindowBar } from "../NativeWindowBar.jsx";

const {
  close,
  getCurrentWindow,
  minimize,
  acknowledge,
  setTheme,
  toggleMaximize,
} = vi.hoisted(() => ({
  close: vi.fn(),
  getCurrentWindow: vi.fn(),
  minimize: vi.fn(),
  acknowledge: vi.fn(),
  setTheme: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }));

vi.mock("../../../lib/copy", () => ({
  copy: (key, params) => params?.when ? `copy:${key}:${params.when}` : `copy:${key}`,
}));

vi.mock("../../../hooks/useTheme.js", () => ({
  useTheme: () => ({ theme: "system", resolvedTheme: "light", setTheme }),
}));

vi.mock("../../../hooks/use-codex-reset-events", () => ({
  useCodexResetEvents: () => ({
    unreadCount: 2,
    events: [{
      id: "reset-1",
      title: "Codex quota reset",
      summary: "Your 5-hour quota window appears to have reset.",
      occurred_at: "2026-08-05T03:00:00.000Z",
    }],
    acknowledge,
  }),
}));

vi.mock("../../../lib/cloud-sync-prefs.ts", () => ({
  getLastCloudSyncTs: () => Date.now() - 60_000,
}));

describe("NativeWindowBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentWindow.mockReturnValue({ close, minimize, toggleMaximize });
  });

  it("renders the reference desktop identity and truthful passive statuses", () => {
    render(<NativeWindowBar />);

    expect(screen.getByText("copy:shared.app_name")).toBeInTheDocument();
    expect(screen.getByText("copy:native.window.status.label")).toBeInTheDocument();
    expect(screen.getByText("copy:native.window.status.normal")).toBeInTheDocument();
    expect(screen.getByText("copy:native.window.sync.recent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "copy:native.window.notifications" }))
      .toHaveAttribute("data-unread-count", "2");
  });

  it("opens the in-app reset notification panel and acknowledges an event", async () => {
    const user = userEvent.setup();
    render(<NativeWindowBar />);

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "copy:native.window.notifications" }));
    });

    expect(screen.getByText("Codex quota reset")).toBeInTheDocument();
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "copy:codex_reset.action.acknowledge" }));
    });
    expect(acknowledge).toHaveBeenCalledWith("reset-1");
  });

  it("uses existing theme and Tauri window actions", async () => {
    const user = userEvent.setup();
    render(<NativeWindowBar />);

    await user.click(screen.getByRole("button", { name: "copy:settings.appearance.theme.label" }));
    expect(setTheme).toHaveBeenCalledWith("dark");

    await user.click(screen.getByRole("button", { name: "copy:native.window.minimize" }));
    await user.click(screen.getByRole("button", { name: "copy:native.window.maximize" }));
    await user.click(screen.getByRole("button", { name: "copy:native.window.close" }));

    expect(minimize).toHaveBeenCalledTimes(1);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
