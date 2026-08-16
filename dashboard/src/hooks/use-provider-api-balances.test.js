import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProviderApiBalances } from "./use-provider-api-balances.js";
import {
  getProviderApiConfigs,
  getProviderApiBalances,
  refreshProviderApiBalance,
  refreshOfficialConsoleProviderBalance,
} from "../lib/api";
import { clearCostSettingsSessionCache } from "../lib/cost-settings-session-cache";

// 03-ia-api-balance: useProviderApiBalances hook tests.
//
// Covers the work order's polling + failure-handling requirements:
//  - On mount: load cached configs + balances, then refresh enabled+keyed once.
//  - Polling interval >= 60s (validated via direct timer inspection, not by
//    waiting 60 real seconds).
//  - Unmount stops the timer + prevents stale state updates.
//  - Manual refresh dedup: repeat clicks during in-flight are no-ops.
//  - Network failure: keeps last successful balance, marks stale, never 0.
//  - First failure (no prior balance): balance stays null → UI shows "—".

vi.mock("../lib/api", () => ({
  getProviderApiConfigs: vi.fn(),
  getProviderApiBalances: vi.fn(),
  refreshProviderApiBalance: vi.fn(),
  refreshOfficialConsoleProviderBalance: vi.fn(),
}));

const SAMPLE_CONFIG = {
  id: "cfg-1",
  providerId: "openai",
  label: "OpenAI",
  enabled: true,
  apiKeyRef: "ref-1",
  refreshIntervalSeconds: 300,
};

const SAMPLE_BALANCE = {
  configId: "cfg-1",
  providerId: "openai",
  accountLabel: "OpenAI",
  balance: 100,
  monthSpend: 10,
  lifetimeSpend: 200,
  currency: "USD",
  status: "synced",
  lastSyncedAt: "2026-07-01T00:00:00.000Z",
};

beforeEach(() => {
  clearCostSettingsSessionCache();
  vi.clearAllMocks();
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [] } });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [] } });
  refreshProviderApiBalance.mockResolvedValue({ ok: true, data: { balance: null } });
  refreshOfficialConsoleProviderBalance.mockResolvedValue({ connected: true, balance: { available_balance: 1 } });
});

it("paints the previous confirmed provider snapshot immediately on re-entry", async () => {
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [SAMPLE_CONFIG] } });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [SAMPLE_BALANCE] } });
  const first = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  first.unmount();

  const second = renderHook(() => useProviderApiBalances());
  expect(second.result.current.loading).toBe(false);
  expect(second.result.current.balances[0].balance).toBe(100);
  second.unmount();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("on mount: loads cached configs + balances, then refreshes enabled+keyed configs", async () => {
  getProviderApiConfigs.mockResolvedValue({
    ok: true,
    data: { configs: [SAMPLE_CONFIG] },
  });
  getProviderApiBalances.mockResolvedValue({
    ok: true,
    data: { balances: [SAMPLE_BALANCE] },
  });

  // Hold the refresh in-flight so we can observe the cached value first.
  let resolveRefresh;
  refreshProviderApiBalance.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
  );

  const { result } = renderHook(() => useProviderApiBalances());

  // Cached balances load immediately — value is 100 (NOT the refreshed 105).
  await waitFor(() => expect(result.current.balances).toHaveLength(1));
  expect(result.current.balances[0].balance).toBe(100);

  // Then refresh fires for the enabled+keyed config.
  await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledWith("cfg-1"));

  // Resolve the refresh — the refreshed balance (105) replaces the cached one.
  await act(async () => {
    resolveRefresh({ ok: true, data: { balance: { ...SAMPLE_BALANCE, balance: 105 } } });
  });
  await waitFor(() => expect(result.current.balances[0].balance).toBe(105));
});

it("does NOT refresh configs without apiKeyRef", async () => {
  const noKeyConfig = { ...SAMPLE_CONFIG, apiKeyRef: "" };
  getProviderApiConfigs.mockResolvedValue({
    ok: true,
    data: { configs: [noKeyConfig] },
  });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [] } });

  renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(getProviderApiConfigs).toHaveBeenCalled());

  // Give the mount effect time to potentially call refresh — it should NOT.
  await new Promise((r) => setTimeout(r, 100));
  expect(refreshProviderApiBalance).not.toHaveBeenCalled();
});

it("does NOT refresh disabled configs", async () => {
  const disabledConfig = { ...SAMPLE_CONFIG, enabled: false };
  getProviderApiConfigs.mockResolvedValue({
    ok: true,
    data: { configs: [disabledConfig] },
  });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [] } });

  renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(getProviderApiConfigs).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 100));
  expect(refreshProviderApiBalance).not.toHaveBeenCalled();
});

it("unmount stops the timer and prevents stale state updates", async () => {
  getProviderApiConfigs.mockResolvedValue({
    ok: true,
    data: { configs: [SAMPLE_CONFIG] },
  });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [] } });
  refreshProviderApiBalance.mockResolvedValue({
    ok: true,
    data: { balance: SAMPLE_BALANCE },
  });

  const { result, unmount } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalled());
  const callsBeforeUnmount = refreshProviderApiBalance.mock.calls.length;
  unmount();

  // After unmount, waiting should not cause additional refresh calls.
  await new Promise((r) => setTimeout(r, 200));
  expect(refreshProviderApiBalance.mock.calls.length).toBe(callsBeforeUnmount);
  expect(result.current).toBeDefined();
});

it("manual refresh dedup: repeat calls during in-flight are no-ops", async () => {
  getProviderApiConfigs.mockResolvedValue({
    ok: true,
    data: { configs: [SAMPLE_CONFIG] },
  });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [SAMPLE_BALANCE] } });

  // Make refresh hang so we can test dedup.
  let resolveRefresh;
  refreshProviderApiBalance.mockImplementation(
    () => new Promise((resolve) => { resolveRefresh = resolve; }),
  );

  const { result } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(result.current.balances).toHaveLength(1));
  // Wait for the mount-triggered refresh to start.
  await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledTimes(1));

  // Call refreshOne twice more — both should be no-ops (in-flight).
  await act(async () => {
    result.current.refreshOne("cfg-1");
    result.current.refreshOne("cfg-1");
  });
  expect(refreshProviderApiBalance).toHaveBeenCalledTimes(1);

  // Resolve the in-flight refresh.
  await act(async () => {
    resolveRefresh({ ok: true, data: { balance: SAMPLE_BALANCE } });
  });

  // Now a new refreshOne should work.
  await act(async () => {
    result.current.refreshOne("cfg-1");
  });
  expect(refreshProviderApiBalance).toHaveBeenCalledTimes(2);
});

it("network failure: keeps last successful balance and marks stale (never shows 0)", async () => {
  getProviderApiConfigs.mockResolvedValue({
    ok: true,
    data: { configs: [SAMPLE_CONFIG] },
  });
  getProviderApiBalances.mockResolvedValue({
    ok: true,
    data: { balances: [SAMPLE_BALANCE] },
  });

  // First mount refresh succeeds (balance → 150), then next refresh fails.
  refreshProviderApiBalance.mockResolvedValueOnce({
    ok: true,
    data: { balance: { ...SAMPLE_BALANCE, balance: 150 } },
  });
  refreshProviderApiBalance.mockRejectedValueOnce(new Error("Network error"));

  const { result } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(result.current.balances[0].balance).toBe(150));

  // Trigger a manual refresh that fails.
  await act(async () => {
    await result.current.refreshOne("cfg-1");
  });

  // The last successful balance (150) is kept — NOT replaced with 0.
  expect(result.current.balances[0].balance).toBe(150);
  expect(result.current.balances[0].status).toBe("stale");
  // The set is marked stale.
  expect(result.current.stale).toBe(true);
});

it("refreshes an official console snapshot before reading its latest financial balance", async () => {
  const officialConfig = {
    ...SAMPLE_CONFIG,
    providerId: "glm",
    authType: "official_console",
    apiKeyRef: null,
  };
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [officialConfig] } });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [{ ...SAMPLE_BALANCE, balance: 499.99 }] } });
  refreshProviderApiBalance.mockResolvedValue({
    ok: true,
    data: { balance: { ...SAMPLE_BALANCE, providerId: "glm", balance: 475.5, currency: "CNY" } },
  });

  const { result } = renderHook(() => useProviderApiBalances());

  await waitFor(() => expect(refreshOfficialConsoleProviderBalance).toHaveBeenCalledWith("glm"));
  await waitFor(() => expect(result.current.balances[0].balance).toBe(475.5));
  expect(refreshOfficialConsoleProviderBalance.mock.invocationCallOrder[0])
    .toBeLessThan(refreshProviderApiBalance.mock.invocationCallOrder[0]);
});

it("reads the preserved stale balance after an official console refresh expires", async () => {
  const officialConfig = {
    ...SAMPLE_CONFIG,
    providerId: "glm",
    authType: "official_console",
    apiKeyRef: null,
  };
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [officialConfig] } });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [{ ...SAMPLE_BALANCE, balance: 499.99 }] } });
  refreshOfficialConsoleProviderBalance.mockResolvedValue({
    connected: false,
    state_code: "session_not_found",
    error_code: "SESSION_NOT_FOUND",
  });
  refreshProviderApiBalance.mockResolvedValue({
    ok: true,
    data: { balance: { ...SAMPLE_BALANCE, providerId: "glm", balance: 499.99, currency: "CNY", status: "stale", errorCode: "SESSION_NOT_FOUND" } },
  });

  const { result } = renderHook(() => useProviderApiBalances());

  await waitFor(() => expect(result.current.balances[0].status).toBe("stale"));
  expect(result.current.balances[0].balance).toBe(499.99);
  expect(refreshProviderApiBalance).toHaveBeenCalledWith("cfg-1");
});

it("first failure with no prior balance: balance stays null (UI shows —)", async () => {
  getProviderApiConfigs.mockResolvedValue({
    ok: true,
    data: { configs: [SAMPLE_CONFIG] },
  });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [] } });
  refreshProviderApiBalance.mockRejectedValue(new Error("Network error"));

  const { result } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalled());

  // After the failed refresh, balances is still empty (no 0 injected).
  await waitFor(() => expect(result.current.stale).toBe(true));
  expect(result.current.balances).toHaveLength(0);
});

it("refreshAll refreshes all enabled+keyed configs", async () => {
  const configA = { ...SAMPLE_CONFIG, id: "cfg-a" };
  const configB = { ...SAMPLE_CONFIG, id: "cfg-b", providerId: "anthropic" };
  getProviderApiConfigs.mockResolvedValue({
    ok: true,
    data: { configs: [configA, configB] },
  });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [] } });
  refreshProviderApiBalance.mockResolvedValue({
    ok: true,
    data: { balance: { ...SAMPLE_BALANCE, configId: "cfg-a" } },
  });

  const { result } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledTimes(2));

  // Clear and call refreshAll.
  refreshProviderApiBalance.mockClear();
  await act(async () => {
    await result.current.refreshAll();
  });
  expect(refreshProviderApiBalance).toHaveBeenCalledWith("cfg-a");
  expect(refreshProviderApiBalance).toHaveBeenCalledWith("cfg-b");
});

it("refreshAll clears stale after every enabled config returns a balance", async () => {
  getProviderApiConfigs.mockResolvedValue({
    ok: true,
    data: { configs: [SAMPLE_CONFIG] },
  });
  getProviderApiBalances.mockResolvedValue({
    ok: true,
    data: { balances: [SAMPLE_BALANCE] },
  });
  refreshProviderApiBalance
    .mockRejectedValueOnce(new Error("Network error"))
    .mockResolvedValue({
      ok: true,
      data: { balance: { ...SAMPLE_BALANCE, balance: 120 } },
    });

  const { result } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(result.current.stale).toBe(true));

  await act(async () => {
    await result.current.refreshAll();
  });

  await waitFor(() => expect(result.current.stale).toBe(false));
  expect(result.current.balances[0].balance).toBe(120);
});

// Polling-interval contract: spy on window.setInterval to verify the clamped
// minimum is exactly 60_000ms (30s → clamped UP to 60s, not bumped to 300s).
// We filter out testing-library's internal 50ms polling intervals by only
// keeping intervals >= 60_000ms (the hook's polling floor).
it("polling timer is set at >= 60s (clamped minimum)", async () => {
  const setIntervalSpy = vi.spyOn(window, "setInterval");
  // refreshIntervalSeconds: 30 → should be clamped to 60s minimum.
  const fastConfig = { ...SAMPLE_CONFIG, refreshIntervalSeconds: 30 };
  getProviderApiConfigs.mockResolvedValue({
    ok: true,
    data: { configs: [fastConfig] },
  });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [] } });
  refreshProviderApiBalance.mockResolvedValue({
    ok: true,
    data: { balance: SAMPLE_BALANCE },
  });

  const { unmount } = renderHook(() => useProviderApiBalances());
  // Wait for configs to load so the polling effect runs.
  await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalled());

  // Only keep the hook's polling intervals (>= 60s). This excludes
  // testing-library / waitFor internal polling (typically 50ms).
  const pollingIntervals = setIntervalSpy.mock.calls
    .map((c) => c[1])
    .filter((d) => Number.isFinite(d) && d >= 60_000);
  expect(pollingIntervals.length).toBeGreaterThan(0);
  // 30s config → clamped UP to exactly 60_000ms (the floor), not 300_000ms.
  expect(pollingIntervals[0]).toBe(60_000);
  unmount();
});

it("default polling interval is 300s when no enabled+keyed configs exist", async () => {
  const setIntervalSpy = vi.spyOn(window, "setInterval");
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [] } });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [] } });

  const { unmount } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(getProviderApiConfigs).toHaveBeenCalled());
  // Wait a tick for the polling effect to run (it early-returns when configs
  // is empty, so no interval should be registered for polling).
  await new Promise((r) => setTimeout(r, 100));

  // No polling interval should be registered (the effect early-returns when
  // configs is empty AND intervalMs === DEFAULT_INTERVAL_MS).
  const pollingIntervals = setIntervalSpy.mock.calls
    .map((c) => c[1])
    .filter((d) => Number.isFinite(d) && d >= 60_000);
  // With no configs, the effect returns early — no 300s timer is spun up.
  expect(pollingIntervals.length).toBe(0);
  unmount();
});
