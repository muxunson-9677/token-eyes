import { beforeEach, describe, expect, it } from "vitest";
import { isNativeWindowsApp, isTauriApp } from "./native-bridge.js";

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

describe("isNativeWindowsApp", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
    window.sessionStorage.clear();
  });

  it("enables the full Windows chrome in an explicit browser preview", () => {
    window.history.replaceState({}, "", "/dashboard?native_windows_preview=1");

    expect(isNativeWindowsApp()).toBe(true);
  });

  it("keeps the browser preview active while navigating between routes", () => {
    window.history.replaceState({}, "", "/dashboard?native_windows_preview=1");
    expect(isNativeWindowsApp()).toBe(true);

    window.history.replaceState({}, "", "/settings/data");
    expect(isNativeWindowsApp()).toBe(true);
  });

  const originalPlatform = navigator.platform;

  beforeEach(() => {
    delete window.__TAURI__;
    delete window.__TAURI_INTERNALS__;
    delete window.chrome;
    window.localStorage.clear();
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  });

  it("detects the current Tauri desktop runtime on Windows", () => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "Win32",
    });
    window.__TAURI_INTERNALS__ = { invoke: () => {} };

    expect(isNativeWindowsApp()).toBe(true);
  });

  it("does not label a macOS Tauri runtime as Windows", () => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
    window.__TAURI_INTERNALS__ = { invoke: () => {} };

    expect(isNativeWindowsApp()).toBe(false);
  });
});
