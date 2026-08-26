import { beforeEach, expect, it, vi } from "vitest";
import apiSource from "./api.ts?raw";
import {
  getAgentEnvironment,
  getObservabilityExport,
  getSpendTimeseries,
  getUsageBounds,
  getUsageAttribution,
  getUsageModelBreakdown,
  fetchCloudUsageModelBreakdown,
  getTokenPlans,
  getRealtimeSessions,
  getValueComparison,
  peekRealtimeSessions,
  peekValueComparison,
  resetValueRealtimeCacheForTests,
  cancelCodexConsoleLogin,
  cleanupLegacyCodexAuthFile,
  reauthorizeCodexConsoleLogin,
  openXiaomiMimoConsoleLogin,
  reopenCodexConsoleLogin,
  refreshGlmConsoleSession,
  refreshOfficialConsoleProviderBalance,
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
  resetValueRealtimeCacheForTests();
  vi.restoreAllMocks();
});

it("retains the last safe aggregate for instant value and realtime remounts while still refreshing from the API", async () => {
  setTauriRuntime(true);
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({
    page: String(input).includes("value-comparison") ? "value" : "realtime",
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);

  expect(peekValueComparison("month", "2026-08")).toBeNull();
  expect(peekRealtimeSessions("today", "2026-08")).toBeNull();

  const value = await getValueComparison("month", undefined, "2026-08");
  const realtime = await getRealtimeSessions("today", undefined, "2026-08");

  expect(peekValueComparison("month", "2026-08")).toBe(value);
  expect(peekRealtimeSessions("today", "2026-08")).toBe(realtime);
  expect(peekValueComparison("month", "2026-07")).toBeNull();
  expect(peekRealtimeSessions("7d", "2026-08")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("keeps nullable WorkBuddy Credits and account identity out of the public contract", () => {
  const groupContract = apiSource.slice(
    apiSource.indexOf("export interface WorkbuddyQuotaGroup"),
    apiSource.indexOf("export interface WorkbuddyQuotaResponse"),
  );
  const responseContract = apiSource.slice(
    apiSource.indexOf("export interface WorkbuddyQuotaResponse"),
    apiSource.indexOf("export async function getWorkbuddyQuota"),
  );

  for (const field of ["total", "remain", "used", "used_percent"]) {
    expect(groupContract).toContain(`${field}: number | null;`);
  }
  expect(responseContract).not.toMatch(/\baccount\??\s*:/);
  expect(responseContract).not.toMatch(/\bnickname\b|\bphone(?:_masked)?\b/);
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

it("passes the daily model breakdown abort signal to the local native fetch", async () => {
  setTauriRuntime(true);
  const controller = new AbortController();
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ sources: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  await getUsageModelBreakdown({
    from: "2026-08-07",
    to: "2026-08-07",
    sources: [" Codex ", "CLAUDE", "codex"],
    signal: controller.signal,
  });

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("tokentracker-usage-model-breakdown"),
    expect.objectContaining({ signal: controller.signal }),
  );
  expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.getAll("source")).toEqual(["claude", "codex"]);
});

it("passes the daily model breakdown abort signal through the cloud account fetch", async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ sources: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  await fetchCloudUsageModelBreakdown({
    from: "2026-08-07",
    to: "2026-08-07",
    accessToken: "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1In0.",
    sources: [" CoDeX ", "CLAUDE", "codex"],
    signal: controller.signal,
  });

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("tokentracker-account-model-breakdown"),
    expect.objectContaining({ signal: controller.signal }),
  );
  expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.getAll("source")).toEqual(["claude", "codex"]);
});

it.each([
  ["legacy singular", { source: " CoDeX " }, ["codex"]],
  ["null means all", { sources: null }, []],
  ["empty means all", { sources: [] }, []],
])("keeps daily model breakdown source URL compatibility for %s", async (_label, filters, expectedSources) => {
  setTauriRuntime(true);
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ sources: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  await getUsageModelBreakdown({
    from: "2026-08-07",
    to: "2026-08-07",
    ...filters,
  });

  expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.getAll("source")).toEqual(expectedSources);
});

it("does not start the local model breakdown fetch when aborted while resolving the native URL", async () => {
  let resolveStatus: (value: { running: boolean; url: string }) => void = () => {};
  const statusPromise = new Promise<{ running: boolean; url: string }>((resolve) => {
    resolveStatus = resolve;
  });
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { core: { invoke: vi.fn(() => statusPromise) } },
  });
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sources: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();

  const request = getUsageModelBreakdown({
    from: "2026-08-07",
    to: "2026-08-07",
    signal: controller.signal,
  });
  controller.abort();
  resolveStatus({ running: true, url: "http://127.0.0.1:17680" });

  await expect(request).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).not.toHaveBeenCalled();
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

it("invokes Codex reauthorization, cancel, reopen, and legacy cleanup with the session reference", async () => {
  const invoke = vi.fn().mockResolvedValue({
    connected: false,
    authorized: false,
    session_ref: "session-ref",
    state_code: "failed",
    error_code: "AUTHORIZATION_CANCELLED",
    error_message: "",
  });
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { core: { invoke } },
  });

  await reauthorizeCodexConsoleLogin("session-ref");
  await cancelCodexConsoleLogin("session-ref", "timeout");
  await reopenCodexConsoleLogin("session-ref");
  await cleanupLegacyCodexAuthFile("session-ref");

  expect(invoke).toHaveBeenNthCalledWith(1, "reauthorize_codex_console_login", {
    sessionRef: "session-ref",
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "cancel_codex_console_login", {
    sessionRef: "session-ref",
    reason: "timeout",
  });
  expect(invoke).toHaveBeenNthCalledWith(3, "reopen_codex_console_login", {
    sessionRef: "session-ref",
  });
  expect(invoke).toHaveBeenNthCalledWith(4, "cleanup_legacy_codex_auth_file", {
    sessionRef: "session-ref",
  });
});

it("invokes the GLM silent refresh command with the persisted session reference", async () => {
  const invoke = vi.fn().mockResolvedValue({
    connected: true,
    state_code: "connected",
    balance: { balance: 475.5, available_balance: 475.5, credit_balance: 0, currency: "CNY" },
  });
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { core: { invoke } },
  });

  const status = await refreshGlmConsoleSession("session-ref");

  expect(status.balance?.balance).toBe(475.5);
  expect(invoke).toHaveBeenCalledWith("refresh_glm_console_session", {
    sessionRef: "session-ref",
  });
});

it("persists an expired official-console refresh so restart cannot report it synced", async () => {
  const nativeFailure = {
    connected: false,
    session_ref: "provider-api/glm/session/ref",
    state_code: "session_not_found",
    error_code: "SESSION_NOT_FOUND",
    error_message: "请重新连接",
  };
  const invoke = vi.fn(async (command: string) => {
    if (command === "local_server_status") return { running: true, url: "http://127.0.0.1:17680" };
    if (command === "refresh_glm_console_session") return nativeFailure;
    throw new Error(`unexpected native command: ${command}`);
  });
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { core: { invoke } },
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/local-auth")) {
      return new Response(JSON.stringify({ token: "local-token" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("tokentracker-token-plan-console-sessions/provider-session/verify")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("tokentracker-token-plan-console-sessions")) {
      return new Response(JSON.stringify({ sessions: [{
        id: "provider-session",
        provider_id: "glm",
        session_ref: "provider-api/glm/session/ref",
        status: "connected",
      }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(refreshOfficialConsoleProviderBalance("glm")).resolves.toEqual(nativeFailure);

  const verifyCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/provider-session/verify"));
  expect(verifyCall?.[1]).toEqual(expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ native_result: nativeFailure }),
  }));
});
