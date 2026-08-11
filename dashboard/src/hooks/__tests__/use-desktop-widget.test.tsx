import React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  acknowledgeCodexResetEvent: vi.fn(),
  getDesktopWidgetViewModel: vi.fn(),
}));
vi.mock("../../lib/api", () => api);

import { useDesktopWidget } from "../use-desktop-widget";

const viewModel = {
  agents: ["all", "claude", "codex", "cursor", "hermes"],
  selectedAgent: "codex",
  projectStatus: { red: 0, yellow: 1, green: 0, unknown: 0, projects: [] },
  limits: [],
  totals: { tokens: 100, costUsd: 1, models: [] },
  pendingReset: { id: "reset-1" },
};

describe("useDesktopWidget", () => {
  const invoke = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset().mockImplementation(async (command: string) => {
      if (command === "get_desktop_widget_prefs") {
        return {
          version: 1,
          visible: true,
          width: 322,
          height: 72,
          selectedAgent: "codex",
          mode: "projects",
          expanded: false,
          material: "frost",
          opacity: 0.72,
          alwaysOnTop: true,
          activeSessionWindow: "3h",
        };
      }
      return undefined;
    });
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: { core: { invoke } },
    });
    api.getDesktopWidgetViewModel.mockReset().mockResolvedValue(viewModel);
    api.acknowledgeCodexResetEvent.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores preferences, polls without resizing, and persists selection", async () => {
    const { result } = renderHook(() => useDesktopWidget());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.getDesktopWidgetViewModel).toHaveBeenCalledWith("codex", "3h");
    expect(result.current.viewModel).toEqual(viewModel);

    await act(async () => {
      await result.current.updatePrefs({ selectedAgent: "claude" });
    });
    expect(invoke).toHaveBeenCalledWith(
      "set_desktop_widget_prefs",
      expect.objectContaining({
        prefs: expect.objectContaining({ selectedAgent: "claude" }),
      }),
    );
    expect(invoke.mock.calls.some(([command]) => command.includes("size"))).toBe(false);
  });

  it("reloads the view model with a newly saved active-session window", async () => {
    const { result } = renderHook(() => useDesktopWidget());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    invoke.mockImplementation(async (command: string) => {
      if (command === "get_desktop_widget_prefs") {
        return {
          ...result.current.prefs,
          activeSessionWindow: "3d",
        };
      }
      return undefined;
    });

    await act(async () => {
      window.dispatchEvent(new Event("token-eyes:desktop-widget-prefs-changed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.prefs.activeSessionWindow).toBe("3d");
    expect(api.getDesktopWidgetViewModel).toHaveBeenLastCalledWith("codex", "3d");
  });

  it("acknowledges the alert globally, then refreshes the same card", async () => {
    const { result } = renderHook(() => useDesktopWidget());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.acknowledgePendingReset();
    });
    expect(api.acknowledgeCodexResetEvent).toHaveBeenCalledWith("reset-1");
    expect(api.getDesktopWidgetViewModel).toHaveBeenCalledTimes(2);
  });

  it("opens and closes the native celebration canvas without persisting its temporary size", async () => {
    const { result } = renderHook(() => useDesktopWidget());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await result.current.setCelebrationOpen(true);
      await result.current.setCelebrationOpen(false);
    });
    expect(invoke).toHaveBeenCalledWith("set_desktop_widget_celebration", { open: true });
    expect(invoke).toHaveBeenCalledWith("set_desktop_widget_celebration", { open: false });
  });

  it("reloads saved project preferences immediately when the settings page synchronizes them", async () => {
    const { result } = renderHook(() => useDesktopWidget());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    invoke.mockImplementation(async (command: string) => {
      if (command === "get_desktop_widget_prefs") {
        return {
          ...result.current.prefs,
          selectedProjectIds: ["project-b"],
          selectedProjects: [{
            id: "project-b",
            label: "Website",
            path: "D:\\Work\\Website",
          }],
        };
      }
      return undefined;
    });

    await act(async () => {
      window.dispatchEvent(new Event("token-eyes:desktop-widget-prefs-changed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.prefs.selectedProjectIds).toEqual(["project-b"]);
    expect(result.current.prefs.selectedProjects).toEqual([
      expect.objectContaining({ id: "project-b", label: "Website" }),
    ]);
  });
});
