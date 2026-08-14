import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  refreshConnectedCodexPlans,
  refreshConnectedCursorPlans,
  refreshConnectedTraePlans,
  useTokenServicePlans,
} from "./use-token-service-plans.js";
import {
  getConsoleSessions,
  getTokenPlans,
  saveTokenPlan,
  syncCodexConsoleQuota,
  syncTraeConsoleQuota,
  verifyCursorConsoleSession,
} from "../lib/api";

vi.mock("../lib/api", () => ({
  TOKEN_PLANS_CHANGED_EVENT: "token-eyes:token-plans-changed",
  getConsoleSessions: vi.fn(),
  getTokenPlans: vi.fn(),
  saveTokenPlan: vi.fn(),
  syncCodexConsoleQuota: vi.fn(),
  syncTraeConsoleQuota: vi.fn(),
  verifyCursorConsoleSession: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("useTokenServicePlans", () => {
  it("shows saved plans before connected account refreshes finish", async () => {
    const neverFinishes = new Promise(() => {});
    getConsoleSessions.mockResolvedValue({ sessions: [] });
    getTokenPlans.mockResolvedValue({
      records: [{
        id: "codex-local",
        provider_id: "codex",
        detection_method: "official_account",
        detection_config: {
          official_account: {
            account_binding_id: "console-codex-local",
            session_ref: "token-plan/codex/session/local",
          },
        },
      }],
    });
    syncCodexConsoleQuota.mockReturnValue(neverFinishes);

    const { result } = renderHook(() => useTokenServicePlans());

    await waitFor(() => expect(result.current.plans).toEqual([
      expect.objectContaining({ id: "codex-local" }),
    ]));
    expect(result.current.loading).toBe(false);
  });

  it("adds the bound official session name to a saved Codex plan", async () => {
    getConsoleSessions.mockResolvedValue({
      sessions: [{
        id: "console-codex-local",
        session_ref: "token-plan/codex/session/local",
        display_name: "muxunson@gmail.com",
      }],
    });
    getTokenPlans.mockResolvedValue({
      records: [{
        id: "codex-local",
        provider_id: "codex",
        detection_method: "official_account",
        detection_config: {
          official_account: { account_binding_id: "console-codex-local" },
        },
      }],
    });

    const { result } = renderHook(() => useTokenServicePlans());

    await waitFor(() => expect(result.current.plans[0]?.detection_config?.official_account?.display_name)
      .toBe("muxunson@gmail.com"));
  });

  it("reloads saved plans immediately after the settings page changes them", async () => {
    getConsoleSessions.mockResolvedValue({ sessions: [] });
    getTokenPlans
      .mockResolvedValueOnce({ records: [] })
      .mockResolvedValueOnce({ records: [{ id: "cursor-new", provider_id: "cursor" }] });

    const { result } = renderHook(() => useTokenServicePlans());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => window.dispatchEvent(new Event("token-eyes:token-plans-changed")));

    await waitFor(() => expect(result.current.plans).toEqual([
      expect.objectContaining({ id: "cursor-new" }),
    ]));
  });
});

describe("refreshConnectedCodexPlans", () => {
  it("persists both official weekly windows and the subscription expiry", async () => {
    syncCodexConsoleQuota.mockResolvedValue({
      state_code: "connected",
      session_ref: "token-plan/codex/session/direct",
      quota: {
        total_quota: 100,
        used_quota: 4,
        remaining_quota: 96,
        subscription_expires_at: "2026-08-30T14:24:24+00:00",
        quota_windows: [
          { kind: "rolling_weekly", total: 100, used: 4, remaining: 96, percentage: 4, resets_at: "1787196800" },
          { kind: "gpt_5_3_codex_spark_weekly", total: 100, used: 56, remaining: 44, percentage: 56, resets_at: "1787701607" },
        ],
      },
    });
    saveTokenPlan.mockResolvedValue({ records: [] });

    await refreshConnectedCodexPlans([{
      id: "direct-plan",
      provider_id: "codex",
      detection_method: "official_account",
      detection_config: { official_account: { session_ref: "token-plan/codex/session/direct" } },
    }]);

    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
      expires_at: "2026-08-30T14:24:24+00:00",
      quota_windows: [
        expect.objectContaining({ kind: "rolling_weekly", resets_at: "1787196800" }),
        expect.objectContaining({ kind: "gpt_5_3_codex_spark_weekly", resets_at: "1787701607" }),
      ],
    }), { notify: false });
  });

  it("refreshes an official Codex plan that is bound directly by session_ref", async () => {
    syncCodexConsoleQuota.mockResolvedValue({
      state_code: "connected",
      session_ref: "token-plan/codex/session/direct",
      quota: { total_quota: 100, used_quota: 3, remaining_quota: 97, quota_windows: [] },
    });
    saveTokenPlan.mockResolvedValue({ records: [] });

    await refreshConnectedCodexPlans([{
      id: "direct-plan",
      provider_id: "codex",
      detection_method: "official_account",
      detection_config: { official_account: { session_ref: "token-plan/codex/session/direct" } },
    }]);

    expect(syncCodexConsoleQuota).toHaveBeenCalledWith("token-plan/codex/session/direct");
    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
      id: "direct-plan",
      used_quota: 3,
    }), { notify: false });
  });

  it("refreshes every bound Codex account independently", async () => {
    syncCodexConsoleQuota.mockImplementation(async (sessionRef) => ({
      state_code: "connected",
      quota: {
        total_quota: 100,
        used_quota: sessionRef.endsWith("one") ? 12 : 63,
        remaining_quota: sessionRef.endsWith("one") ? 88 : 37,
        quota_windows: [{ kind: "rolling_weekly", total: 100, used: 12 }],
      },
    }));
    saveTokenPlan.mockResolvedValue({ records: [] });
    const makePlan = (id, binding) => ({
      id,
      provider_id: "codex",
      detection_method: "official_account",
      detection_config: { official_account: { account_binding_id: `console-${id}`, session_ref: binding } },
    });

    await refreshConnectedCodexPlans([
      makePlan("plan-one", "token-plan/codex/session/one"),
      makePlan("plan-two", "token-plan/codex/session/two"),
    ]);

    expect(syncCodexConsoleQuota).toHaveBeenCalledTimes(2);
    expect(syncCodexConsoleQuota).toHaveBeenCalledWith("token-plan/codex/session/one");
    expect(syncCodexConsoleQuota).toHaveBeenCalledWith("token-plan/codex/session/two");
    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({ id: "plan-one", used_quota: 12 }), { notify: false });
    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({ id: "plan-two", used_quota: 63 }), { notify: false });
  });

  it("resolves a legacy account binding to its native Codex session", async () => {
    syncCodexConsoleQuota.mockResolvedValue({
      state_code: "connected",
      quota: { total_quota: 100, used_quota: 24, remaining_quota: 76, quota_windows: [] },
    });
    saveTokenPlan.mockResolvedValue({ records: [] });

    await refreshConnectedCodexPlans([{
      id: "legacy-plan",
      provider_id: "codex",
      detection_method: "official_account",
      detection_config: { official_account: { account_binding_id: "console-account-one" } },
    }], [{ id: "console-account-one", session_ref: "token-plan/codex/session/account-one" }]);

    expect(syncCodexConsoleQuota).toHaveBeenCalledWith("token-plan/codex/session/account-one");
    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({ id: "legacy-plan", used_quota: 24 }), { notify: false });
  });
});

describe("refreshConnectedTraePlans", () => {
  it("refreshes the bound Trae account with its isolated OAuth session", async () => {
    syncTraeConsoleQuota.mockResolvedValue({
      state_code: "connected",
      quota: {
        total_quota: 100,
        used_quota: 25,
        remaining_quota: 75,
        quota_windows: [{ kind: "subscription", total: 100, used: 25 }],
      },
    });
    saveTokenPlan.mockResolvedValue({ records: [] });

    await refreshConnectedTraePlans([{
      id: "trae-plan",
      provider_id: "trae",
      detection_method: "official_account",
      detection_config: {
        official_account: {
          account_binding_id: "console-trae-one",
          session_ref: "token-plan/trae/session/one",
        },
      },
    }]);

    expect(syncTraeConsoleQuota).toHaveBeenCalledWith("token-plan/trae/session/one");
    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
      id: "trae-plan",
      total_quota: 100,
      used_quota: 25,
      remaining_quota: 75,
      sync_status: "success",
    }), { notify: false });
  });
});

describe("refreshConnectedCursorPlans", () => {
  it("persists the official billing-cycle expiry as plan validity", async () => {
    verifyCursorConsoleSession.mockResolvedValue({
      state_code: "connected",
      session_ref: "token-plan/cursor/session/validity",
      quota: {
        total_quota: 100,
        used_quota: 60,
        remaining_quota: 40,
        subscription_expires_at: "2026-08-22T04:17:12Z",
        quota_windows: [],
      },
    });
    saveTokenPlan.mockResolvedValue({ records: [] });

    await refreshConnectedCursorPlans([{
      id: "cursor-validity",
      provider_id: "cursor",
      detection_method: "official_account",
      detection_config: { official_account: { session_ref: "token-plan/cursor/session/validity" } },
    }]);

    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
      expires_at: "2026-08-22T04:17:12Z",
    }), { notify: false });
  });

  it("refreshes each Cursor plan via its own session_ref without sharing accounts", async () => {
    verifyCursorConsoleSession.mockImplementation(async (sessionRef) => ({
      state_code: "connected",
      session_ref: sessionRef,
      quota: {
        account_id: sessionRef.endsWith("a")
          ? "auth0|user_01KWTPZG4VW30ZF6MKZ2XXM398"
          : "google-oauth2|user_01KK9F07TG4FGF3DREDACTED",
        total_quota: 100,
        used_quota: sessionRef.endsWith("a") ? 29.5 : 6,
        remaining_quota: sessionRef.endsWith("a") ? 70.5 : 94,
        total_usage_percent: sessionRef.endsWith("a") ? 29.5 : 6,
        auto_composer_percent: sessionRef.endsWith("a") ? 23.2 : 1,
        api_usage_percent: sessionRef.endsWith("a") ? 71.5 : 39,
        quota_windows: [
          {
            kind: "total",
            total: 100,
            used: sessionRef.endsWith("a") ? 29.5 : 6,
            percentage: sessionRef.endsWith("a") ? 29.5 : 6,
          },
        ],
      },
    }));
    saveTokenPlan.mockResolvedValue({ records: [] });

    await refreshConnectedCursorPlans([
      {
        id: "cursor-a",
        provider_id: "cursor",
        detection_method: "official_account",
        detection_config: {
          official_account: { session_ref: "token-plan/cursor/session/a", account_binding_id: "c-a" },
        },
      },
      {
        id: "cursor-b",
        provider_id: "cursor",
        detection_method: "official_account",
        detection_config: {
          official_account: { session_ref: "token-plan/cursor/session/b", account_binding_id: "c-b" },
        },
      },
    ]);

    expect(verifyCursorConsoleSession).toHaveBeenCalledTimes(2);
    expect(verifyCursorConsoleSession).toHaveBeenCalledWith("token-plan/cursor/session/a");
    expect(verifyCursorConsoleSession).toHaveBeenCalledWith("token-plan/cursor/session/b");
    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
      id: "cursor-a",
      used_quota: 29.5,
      sync_status: "success",
      detection_config: expect.objectContaining({
        official_account: expect.objectContaining({
          session_ref: "token-plan/cursor/session/a",
          account_id: "auth0|user_01KWTPZG4VW30ZF6MKZ2XXM398",
        }),
      }),
    }), { notify: false });
    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
      id: "cursor-b",
      used_quota: 6,
      detection_config: expect.objectContaining({
        official_account: expect.objectContaining({
          session_ref: "token-plan/cursor/session/b",
          account_id: "google-oauth2|user_01KK9F07TG4FGF3DREDACTED",
        }),
      }),
    }), { notify: false });
  });

  it("marks sync_failed without inventing connected 0% usage", async () => {
    verifyCursorConsoleSession.mockResolvedValue({
      state_code: "sync_failed",
      error_code: "SYNC_FAILED",
      error_message: "usage failed",
    });
    saveTokenPlan.mockResolvedValue({ records: [] });

    await refreshConnectedCursorPlans([{
      id: "cursor-fail",
      provider_id: "cursor",
      detection_method: "official_account",
      detection_config: {
        official_account: { session_ref: "token-plan/cursor/session/fail" },
      },
      used_quota: 12,
    }]);

    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
      id: "cursor-fail",
      sync_status: "failed",
      last_error_code: "SYNC_FAILED",
      used_quota: 12,
    }), { notify: false });
  });
});
