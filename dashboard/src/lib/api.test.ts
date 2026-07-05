import { beforeEach, expect, it, vi } from "vitest";
import {
  getAgentEnvironment,
  getTokenPlans,
  openXiaomiMimoConsoleLogin,
  triggerLocalSync,
  verifyXiaomiMimoConsoleSession,
} from "./api";
import { clearLocalApiAuthToken, getLocalApiAuthHeaders } from "./local-api-auth";
import { resetLocalApiOriginForTests } from "./local-api-url";

function setTauriRuntime(enabled: boolean, url = "http://127.0.0.1:17680") {
  if (enabled) {
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: { core: { invoke: vi.fn().mockResolvedValue({ running: true, url }) } },
    });
    return;
  }
  Reflect.deleteProperty(window, "__TAURI__");
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
}

beforeEach(() => {
  setTauriRuntime(false);
  clearLocalApiAuthToken();
  resetLocalApiOriginForTests();
  vi.restoreAllMocks();
});

it("routes local function requests to the Tauri-reported loopback CLI API", async () => {
  setTauriRuntime(true);
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ records: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  await getTokenPlans();

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:17680/functions/tokentracker-token-plans",
    expect.objectContaining({
      cache: "no-store",
      headers: expect.objectContaining({ Accept: "application/json" }),
    }),
  );
});

it("passes the current unsaved data path to environment detection", async () => {
  setTauriRuntime(true);
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  await getAgentEnvironment("claude", "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:17680/functions/tokentracker-agent-environment?agent=claude&path=%5C%5Cwsl.localhost%5CUbuntu%5Chome%5Cagent%5C.claude",
    expect.any(Object),
  );
});

it("routes local sync requests to the Tauri-reported loopback CLI API", async () => {
  setTauriRuntime(true);
  const fetchMock = vi.fn(async (url) => {
    const payload = String(url).endsWith("/api/local-auth") ? { token: "local-token" } : { ok: true };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  await triggerLocalSync();

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:17680/functions/tokentracker-local-sync",
    expect.objectContaining({ method: "POST", cache: "no-store" }),
  );
});

it("routes local auth token requests to the Tauri-reported loopback CLI API", async () => {
  setTauriRuntime(true);
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: "local-token" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(getLocalApiAuthHeaders()).resolves.toEqual({ "x-tokentracker-local-auth": "local-token" });
  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:17680/api/local-auth",
    expect.objectContaining({ method: "GET", cache: "no-store" }),
  );
});

it("turns static HTML fallback responses into a readable local API error", async () => {
  setTauriRuntime(true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<!DOCTYPE html><html></html>", {
    status: 200,
    headers: { "Content-Type": "text/html" },
  })));

  await expect(getTokenPlans()).rejects.toThrow("本地 API");
});

it("invokes the Xiaomi MiMo native commands with camelCase arguments", async () => {
  const invoke = vi.fn()
    .mockResolvedValueOnce({ connected: false, state_code: "login_started" })
    .mockResolvedValueOnce({
      connected: true,
      state_code: "connected",
      quota: { total_quota: 100, used_quota: 25, remaining_quota: 75 },
    });
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { core: { invoke } },
  });

  await openXiaomiMimoConsoleLogin("session-ref");
  const status = await verifyXiaomiMimoConsoleSession("session-ref");

  expect(status.quota?.remaining_quota).toBe(75);
  expect(invoke).toHaveBeenNthCalledWith(1, "open_xiaomi_mimo_console_login", {
    sessionRef: "session-ref",
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "verify_xiaomi_mimo_console_session", {
    sessionRef: "session-ref",
  });
});
