import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetCodexResetTraySyncForTests,
  syncCodexResetTrayStatus,
} from "../codex-reset-tray";

describe("Codex reset tray bridge", () => {
  beforeEach(() => {
    resetCodexResetTraySyncForTests();
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: undefined,
    });
  });

  it("does nothing outside the Tauri desktop runtime", async () => {
    await syncCodexResetTrayStatus([{
      id: "reset-1",
      type: "reset_completed",
    }]);

    expect((window as any).__TAURI__).toBeUndefined();
  });

  it("invokes only when the derived tray label changes", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: { core: { invoke } },
    });

    const completed = [{ id: "reset-1", type: "reset_completed" }];
    await syncCodexResetTrayStatus(completed);
    await syncCodexResetTrayStatus(completed);
    await syncCodexResetTrayStatus([{
      id: "reset-1",
      type: "official_reset_announcement",
    }]);
    await syncCodexResetTrayStatus([
      { id: "reset-2", type: "official_reset_announcement" },
      { id: "reset-1", type: "reset_completed" },
    ]);

    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenNthCalledWith(1, "set_codex_reset_tray_status", {
      unreadCount: 1,
      latestType: "reset_completed",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "set_codex_reset_tray_status", {
      unreadCount: 1,
      latestType: "official_reset_announcement",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "set_codex_reset_tray_status", {
      unreadCount: 2,
      latestType: "official_reset_announcement",
    });
  });

  it("sends no event content, quota, timestamps, or URLs", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke },
    });

    await syncCodexResetTrayStatus([{
      id: "private-id",
      type: "official_reset_announcement",
      title: "private title",
      summary: "private summary",
      reset_at: "2026-07-20T00:00:00.000Z",
      official_url: "https://example.com/private",
      quota: 42,
    }]);

    expect(invoke).toHaveBeenCalledWith("set_codex_reset_tray_status", {
      unreadCount: 1,
      latestType: "official_reset_announcement",
    });
  });
});
