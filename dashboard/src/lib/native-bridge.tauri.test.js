import { beforeEach, describe, expect, it } from "vitest";
import { isTauriApp } from "./native-bridge.js";

describe("isTauriApp", () => {
  beforeEach(() => {
    delete window.__TAURI__;
    delete window.__TAURI_INTERNALS__;
  });

  it("detects the Tauri IPC runtime injected into the desktop WebView", () => {
    window.__TAURI_INTERNALS__ = { invoke: () => {} };

    expect(isTauriApp()).toBe(true);
  });

  it("does not mark a regular browser window as Tauri", () => {
    expect(isTauriApp()).toBe(false);
  });
});
