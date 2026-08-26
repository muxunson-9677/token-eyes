import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProviderApiBalances } from "./use-provider-api-balances.js";
import {
  getProviderApiConfigs,
  getProviderApiBalances,
  refreshProviderApiBalance,
  refreshOfficialConsoleProviderBalance,
} from "../lib/api";
import {
  clearCostSettingsSessionCache,
  writeCostSettingsSessionCache,
} from "../lib/cost-settings-session-cache";

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

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

it.each([
  ["the failed account finishes first", ["cfg-a", "cfg-b"]],
  ["the successful account finishes first", ["cfg-b", "cfg-a"]],
])("keeps the aggregate stale when one enabled account fails and %s", async (_label, completionOrder) => {
  const configA = { ...SAMPLE_CONFIG, id: "cfg-a" };
  const configB = { ...SAMPLE_CONFIG, id: "cfg-b", providerId: "anthropic" };
  const balanceA = { ...SAMPLE_BALANCE, configId: "cfg-a" };
  const balanceB = { ...SAMPLE_BALANCE, configId: "cfg-b", providerId: "anthropic" };
  const requests = {
    "cfg-a": deferred(),
    "cfg-b": deferred(),
  };
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [configA, configB] } });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [balanceA, balanceB] } });
  refreshProviderApiBalance.mockImplementation((configId) => requests[configId].promise);

  const { result } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledTimes(2));

  for (const configId of completionOrder) {
    await act(async () => {
      if (configId === "cfg-a") requests[configId].reject(new Error("Network error"));
      else requests[configId].resolve({ ok: true, data: { balance: balanceB } });
    });
  }

  await waitFor(() => expect(result.current.refreshing).toBe(false));
  expect(result.current.stale).toBe(true);
  expect(result.current.balances.find((item) => item.configId === "cfg-a")).toMatchObject({
    balance: 100,
    status: "stale",
  });
});

it("treats a missing enabled account as partial while preserving cached stale balances", async () => {
  const configA = { ...SAMPLE_CONFIG, id: "cfg-a" };
  const configB = { ...SAMPLE_CONFIG, id: "cfg-b", providerId: "anthropic" };
  const staleBalanceA = { ...SAMPLE_BALANCE, configId: "cfg-a", status: "stale" };
  writeCostSettingsSessionCache("provider-api-balances", {
    configs: [configA, configB],
    balances: [staleBalanceA],
    stale: true,
    lastUpdatedAt: "2026-07-01T00:00:00.000Z",
  });
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [configA, configB] } });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [staleBalanceA] } });
  refreshProviderApiBalance.mockImplementation(() => new Promise(() => {}));

  const { result, unmount } = renderHook(() => useProviderApiBalances());

  expect(result.current.stale).toBe(true);
  await waitFor(() => expect(result.current.balances).toEqual([staleBalanceA]));
  expect(result.current.stale).toBe(true);
  unmount();
});

it("keeps the last confirmed balance visible when an enabled account returns no balance", async () => {
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [SAMPLE_CONFIG] } });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [SAMPLE_BALANCE] } });
  refreshProviderApiBalance.mockResolvedValue({ ok: true, data: { balance: null } });

  const { result } = renderHook(() => useProviderApiBalances());

  await waitFor(() => expect(result.current.refreshing).toBe(false));
  expect(result.current.stale).toBe(true);
  expect(result.current.balances).toEqual([{ ...SAMPLE_BALANCE, status: "stale" }]);
});

it.each(["error", "not-connected", "unsupported", "stale"])(
  "preserves the confirmed financial snapshot when refresh returns status=%s",
  async (status) => {
    getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [SAMPLE_CONFIG] } });
    getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [SAMPLE_BALANCE] } });
    refreshProviderApiBalance.mockResolvedValue({
      ok: true,
      data: {
        balance: {
          ...SAMPLE_BALANCE,
          balance: null,
          monthSpend: null,
          lifetimeSpend: null,
          status,
          errorCode: "provider_unavailable",
          errorMessage: "refresh failed",
          lastSyncedAt: null,
        },
      },
    });

    const { result } = renderHook(() => useProviderApiBalances());

    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.stale).toBe(true);
    expect(result.current.balances).toEqual([{
      ...SAMPLE_BALANCE,
      status: "stale",
      errorCode: "provider_unavailable",
      errorMessage: "refresh failed",
    }]);
  },
);

it("keeps a first provider failure diagnostic without inventing financial values", async () => {
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [SAMPLE_CONFIG] } });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [] } });
  refreshProviderApiBalance.mockResolvedValue({
    ok: true,
    data: {
      balance: {
        configId: SAMPLE_CONFIG.id,
        providerId: SAMPLE_CONFIG.providerId,
        status: "error",
        errorCode: "provider_unauthorized",
        errorMessage: "bad key",
      },
    },
  });

  const { result } = renderHook(() => useProviderApiBalances());

  await waitFor(() => expect(result.current.refreshing).toBe(false));
  expect(result.current.stale).toBe(true);
  expect(result.current.balances).toEqual([{
    configId: SAMPLE_CONFIG.id,
    providerId: SAMPLE_CONFIG.providerId,
    status: "stale",
    errorCode: "provider_unauthorized",
    errorMessage: "bad key",
  }]);
  expect(result.current.balances[0].balance).toBeUndefined();
});

it.each(["not-connected", "error"])(
  "keeps a cached first-failure status=%s when a later refresh has no balance payload",
  async (status) => {
    const failedBalance = {
      configId: SAMPLE_CONFIG.id,
      providerId: SAMPLE_CONFIG.providerId,
      accountLabel: SAMPLE_CONFIG.label,
      balance: null,
      monthSpend: null,
      lifetimeSpend: null,
      currency: null,
      status,
      errorMessage: status === "error" ? "request failed" : null,
      lastSyncedAt: null,
    };
    getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [SAMPLE_CONFIG] } });
    getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [failedBalance] } });
    refreshProviderApiBalance.mockResolvedValue({ ok: true, data: { balance: null } });

    const { result } = renderHook(() => useProviderApiBalances());

    await waitFor(() => expect(result.current.balances).toEqual([failedBalance]));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.stale).toBe(true);
    expect(result.current.balances).toEqual([failedBalance]);
  },
);

it("recovers a stale confirmed snapshot after a later trusted synced refresh", async () => {
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [SAMPLE_CONFIG] } });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [SAMPLE_BALANCE] } });
  refreshProviderApiBalance
    .mockResolvedValueOnce({
      ok: true,
      data: { balance: { ...SAMPLE_BALANCE, status: "error", errorCode: "request_timeout" } },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: { balance: { ...SAMPLE_BALANCE, balance: 140, status: "synced", errorCode: null } },
    });

  const { result } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(result.current.balances[0]?.status).toBe("stale"));

  await act(async () => {
    await result.current.refreshOne(SAMPLE_CONFIG.id);
  });

  expect(result.current.stale).toBe(false);
  expect(result.current.balances[0]).toMatchObject({ balance: 140, status: "synced", errorCode: null });
});

it("ignores an old refresh after reload replaces the enabled account set", async () => {
  const configA = { ...SAMPLE_CONFIG, id: "cfg-a" };
  const configB = { ...SAMPLE_CONFIG, id: "cfg-b", providerId: "anthropic" };
  const balanceA = { ...SAMPLE_BALANCE, configId: "cfg-a" };
  const balanceB = { ...SAMPLE_BALANCE, configId: "cfg-b", providerId: "anthropic" };
  const oldRequest = deferred();
  getProviderApiConfigs
    .mockResolvedValueOnce({ ok: true, data: { configs: [configA] } })
    .mockResolvedValueOnce({ ok: true, data: { configs: [configB] } });
  getProviderApiBalances
    .mockResolvedValueOnce({ ok: true, data: { balances: [balanceA] } })
    .mockResolvedValueOnce({ ok: true, data: { balances: [balanceB] } });
  refreshProviderApiBalance.mockImplementation((configId) => (
    configId === "cfg-a"
      ? oldRequest.promise
      : Promise.resolve({ ok: true, data: { balance: balanceB } })
  ));

  const { result } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledWith("cfg-a"));

  await act(async () => {
    await result.current.reload();
  });
  await waitFor(() => expect(result.current.configs).toEqual([configB]));
  await waitFor(() => expect(result.current.stale).toBe(false));

  await act(async () => {
    oldRequest.reject(new Error("late failure"));
  });

  expect(result.current.stale).toBe(false);
  expect(result.current.balances).toEqual([balanceB]);
});

it("keeps the newest account set when overlapping config loads finish out of order", async () => {
  const configA = { ...SAMPLE_CONFIG, id: "cfg-a" };
  const configB = { ...SAMPLE_CONFIG, id: "cfg-b", providerId: "anthropic" };
  const balanceA = { ...SAMPLE_BALANCE, configId: "cfg-a" };
  const balanceB = { ...SAMPLE_BALANCE, configId: "cfg-b", providerId: "anthropic" };
  const oldConfigs = deferred();
  const oldBalances = deferred();
  const newConfigs = deferred();
  const newBalances = deferred();
  getProviderApiConfigs
    .mockReturnValueOnce(oldConfigs.promise)
    .mockReturnValueOnce(newConfigs.promise);
  getProviderApiBalances
    .mockReturnValueOnce(oldBalances.promise)
    .mockReturnValueOnce(newBalances.promise);
  refreshProviderApiBalance.mockImplementation((configId) => Promise.resolve({
    ok: true,
    data: { balance: configId === "cfg-a" ? balanceA : balanceB },
  }));

  const { result } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(getProviderApiConfigs).toHaveBeenCalledTimes(1));
  let reloadPromise;
  act(() => {
    reloadPromise = result.current.reload();
  });
  await waitFor(() => expect(getProviderApiConfigs).toHaveBeenCalledTimes(2));

  await act(async () => {
    newConfigs.resolve({ ok: true, data: { configs: [configB] } });
    newBalances.resolve({ ok: true, data: { balances: [balanceB] } });
    await reloadPromise;
  });
  await waitFor(() => expect(result.current.configs).toEqual([configB]));

  await act(async () => {
    oldConfigs.resolve({ ok: true, data: { configs: [configA] } });
    oldBalances.resolve({ ok: true, data: { balances: [balanceA] } });
  });

  expect(result.current.configs).toEqual([configB]);
  expect(result.current.balances).toEqual([balanceB]);
});

it("does not let a disabled stale account poison enabled-account freshness", async () => {
  const enabledConfig = { ...SAMPLE_CONFIG, id: "cfg-enabled" };
  const disabledConfig = { ...SAMPLE_CONFIG, id: "cfg-disabled", enabled: false };
  const enabledBalance = { ...SAMPLE_BALANCE, configId: "cfg-enabled" };
  const disabledBalance = { ...SAMPLE_BALANCE, configId: "cfg-disabled", status: "stale" };
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [enabledConfig, disabledConfig] } });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [enabledBalance, disabledBalance] } });
  refreshProviderApiBalance.mockResolvedValue({ ok: true, data: { balance: enabledBalance } });

  const { result } = renderHook(() => useProviderApiBalances());

  await waitFor(() => expect(result.current.refreshing).toBe(false));
  expect(result.current.stale).toBe(false);
  expect(refreshProviderApiBalance).not.toHaveBeenCalledWith("cfg-disabled");
});

it.each([
  ["configs", { ok: false, error: "config HTTP failure" }, { ok: true, data: { balances: [{ ...SAMPLE_BALANCE, balance: 125 }] } }],
  ["balances", { ok: true, data: { configs: [{ ...SAMPLE_CONFIG, apiKeyRef: "", label: "Updated" }] } }, { ok: false, error: "balance HTTP failure" }],
  ["both", { ok: false, error: "config HTTP failure" }, { ok: false, error: "balance HTTP failure" }],
])("preserves the failed %s side when cached HTTP loading is partial", async (_side, configResult, balanceResult) => {
  const keylessConfig = { ...SAMPLE_CONFIG, apiKeyRef: "" };
  writeCostSettingsSessionCache("provider-api-balances", {
    configs: [keylessConfig],
    balances: [SAMPLE_BALANCE],
    stale: false,
    lastUpdatedAt: "2026-07-01T00:00:00.000Z",
  });
  getProviderApiConfigs.mockResolvedValue(configResult);
  getProviderApiBalances.mockResolvedValue(balanceResult);

  const { result } = renderHook(() => useProviderApiBalances());

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.stale).toBe(true);
  expect(result.current.error).toMatch(/failure/i);
  if (configResult.ok) expect(result.current.configs).toEqual(configResult.data.configs);
  else expect(result.current.configs).toEqual([keylessConfig]);
  if (balanceResult.ok) expect(result.current.balances).toEqual(balanceResult.data.balances);
  else expect(result.current.balances).toEqual([SAMPLE_BALANCE]);
});

it("clears a partial-load error after a later complete load succeeds", async () => {
  const keylessConfig = { ...SAMPLE_CONFIG, apiKeyRef: "" };
  writeCostSettingsSessionCache("provider-api-balances", {
    configs: [keylessConfig],
    balances: [SAMPLE_BALANCE],
    stale: false,
    lastUpdatedAt: "2026-07-01T00:00:00.000Z",
  });
  getProviderApiConfigs
    .mockResolvedValueOnce({ ok: false, error: "config HTTP failure" })
    .mockResolvedValueOnce({ ok: true, data: { configs: [keylessConfig] } });
  getProviderApiBalances
    .mockResolvedValueOnce({ ok: true, data: { balances: [SAMPLE_BALANCE] } })
    .mockResolvedValueOnce({ ok: true, data: { balances: [SAMPLE_BALANCE] } });

  const { result } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(result.current.error).toMatch(/failure/i));
  expect(result.current.stale).toBe(true);

  await act(async () => {
    await result.current.reload();
  });

  expect(result.current.error).toBeNull();
  expect(result.current.stale).toBe(false);
});

it("clears only a balance-list load error after every account in the latest config set refreshes successfully", async () => {
  const configs = [
    { ...SAMPLE_CONFIG, id: "cfg-a" },
    { ...SAMPLE_CONFIG, id: "cfg-b", providerId: "anthropic" },
  ];
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs } });
  getProviderApiBalances.mockResolvedValue({ ok: false, error: "balance list unavailable" });
  refreshProviderApiBalance.mockImplementation(async (configId) => ({
    ok: true,
    data: { balance: { ...SAMPLE_BALANCE, configId, status: "synced" } },
  }));

  const { result } = renderHook(() => useProviderApiBalances());

  await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.balances).toHaveLength(2));
  expect(result.current.balances).toHaveLength(2);
  expect(result.current.error).toBeNull();
  expect(result.current.stale).toBe(false);
});

it("clears a balance-list load error when the only required account succeeds on retry", async () => {
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [SAMPLE_CONFIG] } });
  getProviderApiBalances.mockResolvedValue({ ok: false, error: "balance list unavailable" });
  refreshProviderApiBalance
    .mockResolvedValueOnce({ ok: false, error: "account unavailable", data: { balance: null } })
    .mockResolvedValueOnce({ ok: true, data: { balance: SAMPLE_BALANCE } });

  const { result } = renderHook(() => useProviderApiBalances());
  await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current.error).toMatch(/balance list unavailable/i));

  await act(async () => {
    await result.current.refreshOne(SAMPLE_CONFIG.id);
  });

  expect(result.current.error).toBeNull();
  expect(result.current.stale).toBe(false);
});

it("keeps a balance-list load error when any account in the latest config set fails refresh", async () => {
  const configs = [
    { ...SAMPLE_CONFIG, id: "cfg-a" },
    { ...SAMPLE_CONFIG, id: "cfg-b", providerId: "anthropic" },
  ];
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs } });
  getProviderApiBalances.mockResolvedValue({ ok: false, error: "balance list unavailable" });
  refreshProviderApiBalance.mockImplementation(async (configId) => (configId === "cfg-a"
    ? { ok: true, data: { balance: { ...SAMPLE_BALANCE, configId, status: "synced" } } }
    : { ok: false, error: "account unavailable", data: { balance: null } }));

  const { result } = renderHook(() => useProviderApiBalances());

  await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.error).toMatch(/balance list unavailable/i));
  expect(result.current.stale).toBe(true);
});

it("does not clear a config-list load error after account refresh succeeds", async () => {
  writeCostSettingsSessionCache("provider-api-balances", {
    configs: [SAMPLE_CONFIG],
    balances: [SAMPLE_BALANCE],
    stale: false,
    lastUpdatedAt: "2026-07-01T00:00:00.000Z",
  });
  getProviderApiConfigs.mockResolvedValue({ ok: false, error: "config list unavailable" });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [SAMPLE_BALANCE] } });
  refreshProviderApiBalance.mockResolvedValue({ ok: true, data: { balance: SAMPLE_BALANCE } });

  const { result } = renderHook(() => useProviderApiBalances());

  await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current.error).toMatch(/config list unavailable/i));
  expect(result.current.stale).toBe(true);
});

it("uses a successful config list as authority to remove deleted cached balances when balance loading fails", async () => {
  const currentConfig = { ...SAMPLE_CONFIG, apiKeyRef: "" };
  writeCostSettingsSessionCache("provider-api-balances", {
    configs: [currentConfig, { ...SAMPLE_CONFIG, id: "cfg-deleted", apiKeyRef: "" }],
    balances: [SAMPLE_BALANCE, { ...SAMPLE_BALANCE, configId: "cfg-deleted" }],
    stale: false,
    lastUpdatedAt: "2026-07-01T00:00:00.000Z",
  });
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [currentConfig] } });
  getProviderApiBalances.mockResolvedValue({ ok: false, error: "balance list unavailable" });

  const { result } = renderHook(() => useProviderApiBalances());

  await waitFor(() => expect(result.current.error).toMatch(/balance list unavailable/i));
  expect(result.current.configs).toEqual([currentConfig]);
  expect(result.current.balances).toEqual([SAMPLE_BALANCE]);
  expect(result.current.balances.some((balance) => balance.configId === "cfg-deleted")).toBe(false);
});

it("restores cached stale and load-error state synchronously, then clears both after a complete load", async () => {
  const keylessConfig = { ...SAMPLE_CONFIG, apiKeyRef: "" };
  writeCostSettingsSessionCache("provider-api-balances", {
    configs: [keylessConfig],
    balances: [SAMPLE_BALANCE],
    stale: true,
    loadErrors: { balances: "cached balance list unavailable" },
    lastUpdatedAt: "2026-07-01T00:00:00.000Z",
  });
  const configsRequest = deferred();
  const balancesRequest = deferred();
  getProviderApiConfigs.mockReturnValue(configsRequest.promise);
  getProviderApiBalances.mockReturnValue(balancesRequest.promise);

  const { result } = renderHook(() => useProviderApiBalances());

  expect(result.current.stale).toBe(true);
  expect(result.current.error).toMatch(/cached balance list unavailable/i);

  await act(async () => {
    configsRequest.resolve({ ok: true, data: { configs: [keylessConfig] } });
    balancesRequest.resolve({ ok: true, data: { balances: [SAMPLE_BALANCE] } });
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBeNull();
  expect(result.current.stale).toBe(false);
});

it("clears cached stale after every cached required account refreshes while list loading is still pending", async () => {
  writeCostSettingsSessionCache("provider-api-balances", {
    configs: [SAMPLE_CONFIG],
    balances: [{ ...SAMPLE_BALANCE, status: "stale" }],
    stale: true,
    lastUpdatedAt: "2026-07-01T00:00:00.000Z",
  });
  getProviderApiConfigs.mockReturnValue(new Promise(() => {}));
  getProviderApiBalances.mockReturnValue(new Promise(() => {}));
  refreshProviderApiBalance.mockResolvedValue({ ok: true, data: { balance: SAMPLE_BALANCE } });

  const { result } = renderHook(() => useProviderApiBalances());
  expect(result.current.stale).toBe(true);

  await act(async () => {
    await result.current.refreshOne(SAMPLE_CONFIG.id);
  });

  expect(result.current.stale).toBe(false);
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
