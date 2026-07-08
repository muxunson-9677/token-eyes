import { afterEach, describe, expect, it, vi } from "vitest";

describe("isLocalDashboardRuntime", () => {
  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("treats localhost as local runtime", async () => {
    const { isLocalDashboardRuntime } = await import("./local-api-url");
    expect(window.location.hostname).toBe("localhost");
    expect(isLocalDashboardRuntime()).toBe(true);
  });

  it("treats Tauri WebView as local runtime", async () => {
    (window as any).__TAURI_INTERNALS__ = { invoke: vi.fn() };
    const { isLocalDashboardRuntime } = await import("./local-api-url");
    expect(isLocalDashboardRuntime()).toBe(true);
  });

  it("skips stale local API servers without provider API balance capability", async () => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue({ running: false, url: "" }),
    };
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const raw = String(url);
      if (raw.includes(":7681/")) {
        return new Response(JSON.stringify({
          token: "legacy",
          protocol_version: 2,
          capabilities: ["spend_usage_v2", "provider_model_stats", "request_usage_records"],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (raw.includes(":7682/")) {
        return new Response(JSON.stringify({
          token: "current",
          protocol_version: 2,
          capabilities: ["spend_usage_v2", "provider_model_stats", "request_usage_records", "provider_api_balance"],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new TypeError("connect failed");
    });

    const { getLocalApiOrigin } = await import("./local-api-url");
    await expect(getLocalApiOrigin()).resolves.toBe("http://127.0.0.1:7682");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("throws LocalApiRuntimeError when backend reports E_RUNTIME_MISSING_NODE", async () => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockRejectedValue(
        "[E_RUNTIME_MISSING_NODE] bundled node.exe not found at <HOME>/EmbeddedServer/node.exe",
      ),
    };
    const { getLocalApiOrigin, getLastLocalApiRuntimeError, LocalApiRuntimeError } = await import("./local-api-url");

    await expect(getLocalApiOrigin()).rejects.toThrow(LocalApiRuntimeError);
    const err = getLastLocalApiRuntimeError();
    expect(err).not.toBeNull();
    expect(err?.code).toBe("E_RUNTIME_MISSING_NODE");
  });

  it("throws LocalApiRuntimeError when backend reports E_RUNTIME_PORT_EXHAUSTED", async () => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockRejectedValue(
        "[E_RUNTIME_PORT_EXHAUSTED] no free local API port found; tried 7680 and 17680-17720",
      ),
    };
    const { getLocalApiOrigin, getLastLocalApiRuntimeError } = await import("./local-api-url");

    await expect(getLocalApiOrigin()).rejects.toThrow();
    const err = getLastLocalApiRuntimeError();
    expect(err?.code).toBe("E_RUNTIME_PORT_EXHAUSTED");
  });

  it("does not cache the broken default port when no server is found", async () => {
    // invoke returns running=false, and no port responds — the frontend
    // must throw E_RUNTIME_STARTUP_TIMEOUT instead of returning 7680.
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue({ running: false, url: "" }),
    };
    vi.spyOn(window, "fetch").mockImplementation(async () => {
      throw new TypeError("connect failed");
    });

    const { getLocalApiOrigin, getLastLocalApiRuntimeError, LocalApiRuntimeError } = await import("./local-api-url");

    await expect(getLocalApiOrigin()).rejects.toThrow(LocalApiRuntimeError);
    const err = getLastLocalApiRuntimeError();
    expect(err?.code).toBe("E_RUNTIME_STARTUP_TIMEOUT");
  });

  it("retryLocalApiOrigin clears the cached error and re-resolves", async () => {
    let invokeCallCount = 0;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockImplementation(async () => {
        invokeCallCount += 1;
        // First invoke call fails with a structured error; subsequent
        // calls (after retryLocalApiOrigin clears the cached promise)
        // must succeed. This proves the retry path re-invokes instead
        // of returning the poisoned cached promise.
        if (invokeCallCount === 1) {
          throw "[E_RUNTIME_MISSING_NODE] bundled node.exe not found";
        }
        return {
          running: true,
          url: "http://127.0.0.1:7777",
        };
      }),
    };

    const { getLocalApiOrigin, retryLocalApiOrigin, getLastLocalApiRuntimeError } = await import("./local-api-url");

    // First call fails with structured error — cache is poisoned.
    await expect(getLocalApiOrigin()).rejects.toThrow();
    expect(getLastLocalApiRuntimeError()?.code).toBe("E_RUNTIME_MISSING_NODE");

    // Retry — clears the cached promise, next call re-invokes and succeeds.
    retryLocalApiOrigin();
    await expect(getLocalApiOrigin()).resolves.toBe("http://127.0.0.1:7777");
    expect(getLastLocalApiRuntimeError()).toBeNull();
  });

  it("does not keep a rejected runtime promise after a transient backend crash", async () => {
    const invoke = vi.fn()
      .mockRejectedValueOnce("[E_RUNTIME_BACKEND_CRASHED] backend process exited unexpectedly")
      .mockResolvedValueOnce({
        running: true,
        url: "http://127.0.0.1:7778",
      });
    (window as any).__TAURI_INTERNALS__ = { invoke };

    const { getLocalApiOrigin, getLastLocalApiRuntimeError } = await import("./local-api-url");

    await expect(getLocalApiOrigin()).rejects.toThrow();
    expect(getLastLocalApiRuntimeError()?.code).toBe("E_RUNTIME_BACKEND_CRASHED");

    await expect(getLocalApiOrigin()).resolves.toBe("http://127.0.0.1:7778");
    expect(getLastLocalApiRuntimeError()).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
