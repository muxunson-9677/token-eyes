import { beforeEach, expect, it, vi } from "vitest";
import {
  getAgentEnvironment,
  getObservabilityExport,
  getSpendTimeseries,
  getUsageBounds,
  getUsageAttribution,
  getTokenPlans,
  openXiaomiMimoConsoleLogin,
  reorderTokenPlans,
  triggerLocalSync,
  verifyOfficialModelPricing,
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

it("uses deterministic spend trend and Token service fixtures in screenshot mock mode", async () => {
  const fetchMock = vi.fn(() => {
    throw new Error("mock mode must not call the local API");
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(
    {},
    "",
    "/?mock=1&mock_seed=baseline&mock_today=2025-12-31&mock_now=2025-12-31T12:00:00Z",
  );

  try {
    const [trend, plans, bounds] = await Promise.all([
      getSpendTimeseries({ from: "2025-12-01", to: "2025-12-31" }),
      getTokenPlans(),
      getUsageBounds(),
    ]);

    expect(trend.ok).toBe(true);
    expect(trend.series.length).toBeGreaterThan(1);
    expect(trend.totals.api_usd).toBe(trend.totals.api_cost_usd);
    expect(trend.totals.subscription_usd).toBe(trend.totals.subscription_cost_usd);
    expect(trend.totals.other_ai_usd).toBe(0);
    expect(plans.records.length).toBeGreaterThan(0);
    expect(bounds).toEqual({
      ok: true,
      from: "2025-01-01",
      to: "2025-12-31",
      empty: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    window.history.replaceState({}, "", "/");
  }
});

it("requests local-only usage attribution with the active source and model filters", async () => {
  setTauriRuntime(true);
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ snapshots: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  await getUsageAttribution({
    from: "2026-07-01",
    to: "2026-07-27",
    sources: ["codex"],
    models: ["gpt-5"],
    timeZone: "Asia/Shanghai",
    tzOffsetMinutes: 480,
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:17680/functions/tokentracker-usage-attribution?from=2026-07-01&to=2026-07-27&group_by=environment&sources=codex&models=gpt-5&tz=Asia%2FShanghai&tz_offset_minutes=480",
    expect.any(Object),
  );
});

it("requests redacted JSON and CSV exports only through the Tauri loopback API", async () => {
  setTauriRuntime(true);
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: "[]" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  await getObservabilityExport({ format: "csv" });

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:17680/functions/tokentracker-observability-export?format=csv",
    expect.objectContaining({ cache: "no-store" }),
  );
});

it("sends an authenticated atomic Token plan order update", async () => {
  setTauriRuntime(true);
  const fetchMock = vi.fn(async (url) => {
    const payload = String(url).endsWith("/api/local-auth")
      ? { token: "local-token" }
      : { ok: true, records: [] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  await reorderTokenPlans(["c", "a", "b"]);

  expect(fetchMock).toHaveBeenLastCalledWith(
    "http://127.0.0.1:17680/functions/tokentracker-token-plans-order",
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ ids: ["c", "a", "b"] }),
      headers: expect.objectContaining({
        "Content-Type": "application/json",
        "x-tokentracker-local-auth": "local-token",
      }),
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

it("sends model pricing verification to the authenticated local API", async () => {
  setTauriRuntime(true);
  const fetchMock = vi.fn(async (url) => {
    const payload = String(url).endsWith("/api/local-auth")
      ? { token: "local-token" }
      : { ok: true, status: "verified" };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  await verifyOfficialModelPricing({ model: "gpt-5", source: "codex" });

  expect(fetchMock).toHaveBeenLastCalledWith(
    "http://127.0.0.1:17680/functions/tokentracker-official-model-pricing",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ model: "gpt-5", source: "codex" }),
      headers: expect.objectContaining({
        "Content-Type": "application/json",
        "x-tokentracker-local-auth": "local-token",
      }),
    }),
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
