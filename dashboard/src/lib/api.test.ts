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
  const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    const payload = String(url).endsWith("/api/local-auth")
      ? { token: "local-token" }
      : { records: [] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  await getTokenPlans();

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:17680/api/local-auth",
    expect.objectContaining({ method: "GET", cache: "no-store" }),
  );
  const functionCall = fetchMock.mock.calls.find(
    ([url]) => String(url) === "http://127.0.0.1:17680/functions/tokentracker-token-plans",
  );
  expect(functionCall?.[1]).toEqual(expect.objectContaining({ cache: "no-store" }));
  const functionHeaders = new Headers(functionCall?.[1]?.headers);
  expect(functionHeaders.get("accept")).toBe("application/json");
  expect(functionHeaders.get("x-tokentracker-local-auth")).toBe("local-token");
  expect(fetchMock.mock.calls.map(([url]) => String(url)).join("\n")).not.toContain("local-token");
});

it("passes the current unsaved data path to environment detection", async () => {
  setTauriRuntime(true);
  const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    const payload = String(url).endsWith("/api/local-auth")
      ? { token: "local-token" }
      : { ok: true };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  await getAgentEnvironment("claude", "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:17680/functions/tokentracker-agent-environment?agent=claude&path=%5C%5Cwsl.localhost%5CUbuntu%5Chome%5Cagent%5C.claude",
    expect.any(Object),
  );
});

it("routes local sync requests to the Tauri-reported loopback CLI API", async () => {
  setTauriRuntime(true);
  const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
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

it("renews an expired local auth token once without putting it in the URL", async () => {
  setTauriRuntime(true);
  let handshakeCount = 0;
  const fetchMock = vi.fn(async (url, init) => {
    if (String(url).endsWith("/api/local-auth")) {
      handshakeCount += 1;
      return new Response(JSON.stringify({
        token: handshakeCount === 1 ? "expired-token" : "current-token",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const headers = new Headers(init?.headers);
    const authorized = headers.get("x-tokentracker-local-auth") === "current-token";
    return new Response(JSON.stringify(authorized ? { records: [] } : { error: "Unauthorized" }), {
      status: authorized ? 200 : 401,
      headers: {
        "Content-Type": "application/json",
        ...(authorized ? {} : { "X-TokenTracker-Local-Auth-Required": "1" }),
      },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(getTokenPlans()).resolves.toEqual({ records: [] });
  expect(handshakeCount).toBe(2);
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(fetchMock.mock.calls.map(([url]) => String(url)).join("\n")).not.toMatch(
    /expired-token|current-token/,
  );
});

it("does not replay an unmarked business 401", async () => {
  setTauriRuntime(true);
  let functionCalls = 0;
  const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url).endsWith("/api/local-auth")) {
      return new Response(JSON.stringify({ token: "local-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    functionCalls += 1;
    return new Response(JSON.stringify({ error: "Business unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(getTokenPlans()).rejects.toThrow();
  expect(functionCalls).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("turns static HTML fallback responses into a readable local API error", async () => {
  setTauriRuntime(true);
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).endsWith("/api/local-auth")) {
      return new Response(JSON.stringify({ token: "local-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("<!DOCTYPE html><html></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }));

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
