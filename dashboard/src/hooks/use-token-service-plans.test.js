import { describe, expect, it, vi } from "vitest";
import {
  refreshConnectedCodexPlans,
  refreshConnectedCursorPlans,
  refreshConnectedTraePlans,
} from "./use-token-service-plans.js";
import {
  saveTokenPlan,
  syncCodexConsoleQuota,
  syncTraeConsoleQuota,
  verifyCursorConsoleSession,
} from "../lib/api";

vi.mock("../lib/api", () => ({
  getConsoleSessions: vi.fn(),
  getTokenPlans: vi.fn(),
  saveTokenPlan: vi.fn(),
  syncCodexConsoleQuota: vi.fn(),
  syncTraeConsoleQuota: vi.fn(),
  verifyCursorConsoleSession: vi.fn(),
}));

describe("refreshConnectedCodexPlans", () => {
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
    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({ id: "plan-one", used_quota: 12 }));
    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({ id: "plan-two", used_quota: 63 }));
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
    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({ id: "legacy-plan", used_quota: 24 }));
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
    }));
  });
});

describe("refreshConnectedCursorPlans", () => {
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
    }));
    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
      id: "cursor-b",
      used_quota: 6,
      detection_config: expect.objectContaining({
        official_account: expect.objectContaining({
          session_ref: "token-plan/cursor/session/b",
          account_id: "google-oauth2|user_01KK9F07TG4FGF3DREDACTED",
        }),
      }),
    }));
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
    }));
  });
});
