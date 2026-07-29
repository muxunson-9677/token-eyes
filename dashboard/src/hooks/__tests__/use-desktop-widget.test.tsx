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
    expect(api.getDesktopWidgetViewModel).toHaveBeenCalledWith("codex");
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
});
