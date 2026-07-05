import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri, selectDirectoryViaTauri } from "./tauri-directory.js";

describe("tauri-directory", () => {
  beforeEach(() => {
    delete window.__TAURI__;
    delete window.__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("uses Tauri v2 global invoke when available", async () => {
    const invoke = vi.fn().mockResolvedValue("C:\\Users\\admin\\.codex");
    window.__TAURI__ = { core: { invoke } };

    await expect(selectDirectoryViaTauri("C:\\Users\\admin")).resolves.toBe("C:\\Users\\admin\\.codex");
    expect(isTauri()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("pick_directory", { defaultPath: "C:\\Users\\admin" });
  });

  it("falls back to legacy Tauri internals invoke", async () => {
    const invoke = vi.fn().mockResolvedValue("D:\\logs");
    window.__TAURI_INTERNALS__ = { invoke };

    await expect(selectDirectoryViaTauri()).resolves.toBe("D:\\logs");
    expect(isTauri()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("pick_directory", {});
  });

  it("returns null outside Tauri", async () => {
    await expect(selectDirectoryViaTauri()).resolves.toBeNull();
    expect(isTauri()).toBe(false);
  });
});
