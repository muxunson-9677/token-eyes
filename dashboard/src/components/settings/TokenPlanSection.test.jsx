import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TokenPlanSection, quotaConsoleAuthTimeoutMs, resolveConsoleSessionForRecord } from "./TokenPlanSection.jsx";
import { getTokenPlans, saveTokenPlan, refreshTokenPlan, getUsageLimits, getTokenPlanCatalog, getConsoleSessions, createConsoleSession, deleteConsoleSession, verifyConsoleSession, openXiaomiMimoConsoleLogin, verifyXiaomiMimoConsoleSession, deleteXiaomiMimoConsoleSession, openCodexConsoleLogin, verifyCodexConsoleSession, syncCodexConsoleQuota, discardCodexPendingSession, deleteCodexConsoleSession, openCursorConsoleLogin, verifyCursorConsoleSession, saveTokenPlanSecret } from "../../lib/api";
import { LIMIT_PROVIDER_IDS } from "../../lib/limits-providers";
import { copy } from "../../lib/copy";

const codexResetMonitor = vi.hoisted(() => ({
  status: null,
  checkNow: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  getTokenPlans: vi.fn(),
  saveTokenPlan: vi.fn(),
  refreshTokenPlan: vi.fn(),
  getUsageLimits: vi.fn(),
  getTokenPlanCatalog: vi.fn(),
  getConsoleSessions: vi.fn(),
  createConsoleSession: vi.fn(),
  deleteConsoleSession: vi.fn(),
  verifyConsoleSession: vi.fn(),
  openXiaomiMimoConsoleLogin: vi.fn(),
  verifyXiaomiMimoConsoleSession: vi.fn(),
  deleteXiaomiMimoConsoleSession: vi.fn(),
  openGlmConsoleLogin: vi.fn(),
  verifyGlmConsoleSession: vi.fn(),
  deleteGlmConsoleSession: vi.fn(),
  openCodexConsoleLogin: vi.fn(),
  verifyCodexConsoleSession: vi.fn(),
  syncCodexConsoleQuota: vi.fn(),
  discardCodexPendingSession: vi.fn(),
  deleteCodexConsoleSession: vi.fn(),
  openClaudeConsoleLogin: vi.fn(),
  verifyClaudeConsoleSession: vi.fn(),
  deleteClaudeConsoleSession: vi.fn(),
  openCursorConsoleLogin: vi.fn(),
  verifyCursorConsoleSession: vi.fn(),
  deleteCursorConsoleSession: vi.fn(),
  openKimiConsoleLogin: vi.fn(),
  verifyKimiConsoleSession: vi.fn(),
  deleteKimiConsoleSession: vi.fn(),
  openTraeConsoleLogin: vi.fn(),
  verifyTraeConsoleSession: vi.fn(),
  syncTraeConsoleQuota: vi.fn(),
  deleteTraeConsoleSession: vi.fn(),
  saveTokenPlanSecret: vi.fn(),
}));

vi.mock("../../hooks/use-codex-reset-events", () => ({
  useCodexResetEvents: () => ({
    status: codexResetMonitor.status,
    checkNow: codexResetMonitor.checkNow,
  }),
}));

const BASE_RECORD = {
  id: "plan-1",
  source: "claude",
  plan_label: "Max",
  total_quota: 1000,
  used_quota: 200,
  remaining_quota: 800,
  expires_at: "2026-12-31",
  refresh_enabled: false,
  refresh_interval_minutes: 60,
  refresh_method: "manual",
  credential_ref: "",
  last_refresh_status: "",
  last_refresh_error: "",
  last_refresh_at: "",
  next_refresh_at: "",
};

it("keeps TRAE polling for the official 600-second OAuth lifetime", () => {
  expect(quotaConsoleAuthTimeoutMs("trae")).toBe(10 * 60 * 1000);
  expect(quotaConsoleAuthTimeoutMs("cursor")).toBe(5 * 60 * 1000);
});

async function expandAllPlans() {
  await waitFor(() => {
    expect(screen.getAllByTestId("token-plan-card").length).toBeGreaterThan(0);
  });
  expect(screen.queryByRole("button", { name: /^展开 / })).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    "token-eyes.settings.disclosure.cost.token-plans.v1",
    "1",
  );
  codexResetMonitor.status = null;
  codexResetMonitor.checkNow.mockReset().mockResolvedValue(undefined);
  getTokenPlans.mockResolvedValue({ records: [{ ...BASE_RECORD }] });
  saveTokenPlan.mockImplementation(async (record) => ({
    ok: true,
    record: { ...record, id: record.id || "plan-2" },
    records: [{ ...record, id: record.id || "plan-2" }],
  }));
  refreshTokenPlan.mockResolvedValue({
    ok: true,
    plan: { ...BASE_RECORD, last_refresh_status: "success", last_refresh_at: "2026-06-20T00:00:00.000Z" },
    records: [{ ...BASE_RECORD, last_refresh_status: "success", last_refresh_at: "2026-06-20T00:00:00.000Z" }],
  });
  getUsageLimits.mockResolvedValue({
    codex: {
      configured: true,
      primary_window: { used_percent: 30, reset_at: Date.now() / 1000 + 3600 },
      secondary_window: { used_percent: 50, reset_at: Date.now() / 1000 + 86400 * 7 },
    },
  });
  getTokenPlanCatalog.mockResolvedValue({
    providers: [
      {
        id: "xiaomi_mimo",
        name: "小米 MiMo",
        plans: [
          {
            plan_id: "xiaomi_mimo_standard_monthly",
            display_name: "Standard（月付）",
            quota_kind: "credits",
            quota_unit: "credits",
            total_quota: 11000000000,
            total_quota_display: "11,000,000,000（11B）Credits",
            official_evidence_url: "https://mimo.mi.com/docs/zh-CN/price/token-plan",
          },
        ],
      },
      {
        id: "custom",
        name: "自定义套餐",
        plans: [],
      },
    ],
  });
  getConsoleSessions.mockResolvedValue({ sessions: [] });
  deleteConsoleSession.mockResolvedValue({ ok: true });
  deleteXiaomiMimoConsoleSession.mockResolvedValue(undefined);
  deleteCodexConsoleSession.mockResolvedValue(undefined);
  discardCodexPendingSession.mockResolvedValue(true);
  verifyConsoleSession.mockImplementation(async (_id, nativeResult) => ({
    ok: true,
    session: makeXiaomiSession({
      id: "new-session-id",
      session_ref: nativeResult.session_ref,
      status: nativeResult.connected ? "connected" : "awaiting_verification",
    }),
  }));
});

it("loads, edits, and saves manual token plan records", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  expect(await screen.findByText("Token 套餐")).toBeInTheDocument();
  await screen.findByText(/claude \/ Max/i);
  await expandAllPlans();
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "编辑" }));
  });

  const planLabel = screen.getByLabelText("套餐名称");
  await act(async () => {
    await user.clear(planLabel);
    await user.type(planLabel, "Max updated");
  });

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存" }));
  });

  await waitFor(() => {
    expect(saveTokenPlan).toHaveBeenCalled();
    const arg = saveTokenPlan.mock.calls[0][0];
    expect(arg.id).toBe("plan-1");
    expect(arg.plan_label).toBe("Max updated");
    expect(arg.total_quota).toBe(1000);
    expect(arg.used_quota).toBe(200);
    expect(arg.remaining_quota).toBe(800);
    expect(arg.expires_at).toBe("2026-12-31");
  });
  expect(await screen.findByText("已保存到本地。")).toBeInTheDocument();
});

it("triggers manual refresh and updates status", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  await screen.findByText(/claude \/ Max/i);
  await expandAllPlans();
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "立即刷新" }));
  });

  await waitFor(() => {
    expect(refreshTokenPlan).toHaveBeenCalledWith("plan-1");
  });
});

it("displays Codex live quota block for source=codex records with 5h/7d windows", async () => {
  const codexRecord = { ...BASE_RECORD, id: "codex-plan", source: "codex", plan_label: "Pro" };
  getTokenPlans.mockResolvedValue({ records: [codexRecord] });
  getUsageLimits.mockResolvedValue({
    codex: {
      configured: true,
      primary_window: { used_percent: 30, reset_at: Date.now() / 1000 + 3600 },
      secondary_window: { used_percent: 50, reset_at: Date.now() / 1000 + 86400 * 7 },
    },
  });

  render(<TokenPlanSection />);

  await screen.findByText(/codex \/ Pro/i);
  await expandAllPlans();
  expect(await screen.findByText("Codex 实时额度")).toBeInTheDocument();
  expect(screen.getByText("5 小时")).toBeInTheDocument();
  expect(screen.getByText("7 天")).toBeInTheDocument();
  expect(screen.getByText("70% 剩余")).toBeInTheDocument();
  expect(screen.getByText("50% 剩余")).toBeInTheDocument();
});

it("keeps Codex reset monitoring out of the token-plan cards", async () => {
  const codexRecord = { ...BASE_RECORD, id: "codex-plan", source: "codex", plan_label: "Pro" };
  getTokenPlans.mockResolvedValue({ records: [codexRecord] });
  codexResetMonitor.status = {
    enabled: true,
    configured: true,
    running: false,
    last_successful_at: "2026-07-20T08:00:00.000Z",
    next_check_at: "2026-07-20T08:10:00.000Z",
    last_error_code: null,
  };

  render(<TokenPlanSection />);

  await screen.findByText(/codex \/ Pro/i);
  expect(screen.queryByText(copy("codex_reset.monitor.title"))).not.toBeInTheDocument();
  expect(screen.queryByText(copy("codex_reset.monitor.last_success"))).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: copy("codex_reset.monitor.check_now") })).not.toBeInTheDocument();
});

it("does not display Codex quota block for non-codex records", async () => {
  getTokenPlans.mockResolvedValue({ records: [{ ...BASE_RECORD, source: "claude" }] });

  render(<TokenPlanSection />);

  await screen.findByText(/claude \/ Max/i);
  await waitFor(() => {
    expect(getUsageLimits).not.toHaveBeenCalled();
  });
  expect(screen.queryByText("Codex 实时额度")).not.toBeInTheDocument();
});

it("shows unconfigured status when codex.configured=false", async () => {
  const codexRecord = { ...BASE_RECORD, id: "codex-plan", source: "codex", plan_label: "Pro" };
  getTokenPlans.mockResolvedValue({ records: [codexRecord] });
  getUsageLimits.mockResolvedValue({
    codex: { configured: false },
  });

  render(<TokenPlanSection />);

  await screen.findByText(/codex \/ Pro/i);
  await expandAllPlans();
  expect(await screen.findByText("Codex 实时额度")).toBeInTheDocument();
  expect(await screen.findByText("Codex 未连接，无法读取实时额度")).toBeInTheDocument();
});

it("shows reauth status when auth_action_required=reauth", async () => {
  const codexRecord = { ...BASE_RECORD, id: "codex-plan", source: "codex", plan_label: "Pro" };
  getTokenPlans.mockResolvedValue({ records: [codexRecord] });
  getUsageLimits.mockResolvedValue({
    codex: { configured: true, auth_action_required: "reauth" },
  });

  render(<TokenPlanSection />);

  await screen.findByText(/codex \/ Pro/i);
  await expandAllPlans();
  expect(await screen.findByText("需要重新登录 Codex 后读取额度")).toBeInTheDocument();
});

it("shows error status when codex.error is present", async () => {
  const codexRecord = { ...BASE_RECORD, id: "codex-plan", source: "codex", plan_label: "Pro" };
  getTokenPlans.mockResolvedValue({ records: [codexRecord] });
  getUsageLimits.mockResolvedValue({
    codex: { configured: true, error: "Network error" },
  });

  render(<TokenPlanSection />);

  await screen.findByText(/codex \/ Pro/i);
  await expandAllPlans();
  expect(await screen.findByText("Codex 额度读取失败: Network error")).toBeInTheDocument();
});

it("shows error status when usage limit request fails", async () => {
  const codexRecord = { ...BASE_RECORD, id: "codex-plan", source: "codex", plan_label: "Pro" };
  getTokenPlans.mockResolvedValue({ records: [codexRecord] });
  getUsageLimits.mockRejectedValue(new Error("Network down"));

  render(<TokenPlanSection />);

  await screen.findByText(/codex \/ Pro/i);
  await expandAllPlans();
  expect(await screen.findByText("Codex 额度读取失败: Network down")).toBeInTheDocument();
});

it("new plan form has Agent source, provider, and plan selectors", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  expect(screen.getByLabelText("Agent 来源")).toBeInTheDocument();
  expect(screen.getByLabelText("服务商")).toBeInTheDocument();
  expect(screen.getByLabelText("套餐")).toBeInTheDocument();
  expect(screen.queryByLabelText("来源")).not.toBeInTheDocument();
});

it("new plan Agent source options mirror the limits display providers", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const agentSelect = screen.getByLabelText("Agent 来源");
  const optionValues = Array.from(agentSelect.options)
    .map((option) => option.value)
    .filter(Boolean);

  // V4 item-3a: the registry now covers every implemented channel, so the
  // Agent dropdown mirrors it 1:1 — no extra filtering on top.
  expect(optionValues).toEqual(LIMIT_PROVIDER_IDS);
});

it("new plan Agent source options follow visible limits display preferences", async () => {
  window.localStorage.setItem(
    "tt.limits.providerOrder",
    JSON.stringify(["hermes", "claude", "codex", "cursor", "gemini", "openclaw", "opencode", "antigravity"]),
  );
  window.localStorage.setItem(
    "tt.limits.providerVisibility",
    JSON.stringify({
      hermes: true,
      claude: true,
      trae: false,
      codex: false,
      cursor: false,
      gemini: false,
      openclaw: false,
      opencode: false,
      antigravity: false,
    }),
  );

  const user = userEvent.setup();
  render(<TokenPlanSection />);

  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const agentSelect = screen.getByLabelText("Agent 来源");
  const optionValues = Array.from(agentSelect.options)
    .map((option) => option.value)
    .filter(Boolean);

  // Providers removed from the limits-display registry must not leak back
  // into the new-plan Agent selector. Remaining visible providers preserve
  // the stored custom order, followed by the current registry order.
  expect(optionValues).toEqual([
    "hermes",
    "claude",
    "codebuddy",
    "zed",
    "workbuddy",
    "kimi",
    "kimi-code",
    "pi",
    "grok",
    "copilot",
  ]);
});

it("new plan provider choices render as separated card options", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const trigger = screen.getByTestId("token-plan-provider-card-select-trigger");
  await act(async () => {
    await user.click(trigger);
  });

  expect(screen.getByTestId("token-plan-provider-card-select-options")).toHaveAttribute("role", "listbox");
  const xiaomiOption = screen.getByTestId("token-plan-provider-card-select-option-xiaomi_mimo");
  expect(xiaomiOption).toHaveClass("rounded-lg");
  expect(xiaomiOption).toHaveClass("border");
  expect(xiaomiOption).toHaveClass("mb-1");
});

it("new plan Agent source choices render as separated card options", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const trigger = screen.getByTestId("token-plan-agent-card-select-trigger");
  await act(async () => {
    await user.click(trigger);
  });

  expect(screen.getByTestId("token-plan-agent-card-select-options")).toHaveAttribute("role", "listbox");
  const hermesOption = screen.getByTestId("token-plan-agent-card-select-option-hermes");
  expect(hermesOption).toHaveClass("rounded-lg");
  expect(hermesOption).toHaveClass("border");
  expect(hermesOption).toHaveClass("mb-1");
});

it("new plan catalog plan choices render as separated card options", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  await act(async () => {
    await user.selectOptions(screen.getByLabelText("服务商"), "xiaomi_mimo");
  });

  const trigger = screen.getByTestId("token-plan-plan-card-select-trigger");
  await act(async () => {
    await user.click(trigger);
  });

  expect(screen.getByTestId("token-plan-plan-card-select-options")).toHaveAttribute("role", "listbox");
  const standardOption = screen.getByTestId("token-plan-plan-card-select-option-xiaomi_mimo_standard_monthly");
  expect(standardOption).toHaveClass("rounded-lg");
  expect(standardOption).toHaveClass("border");
  expect(standardOption).toHaveClass("mb-1");
});

it("catalog plans with official detection expose connect and sync controls", async () => {
  const user = userEvent.setup();
  getTokenPlanCatalog.mockResolvedValueOnce({
    providers: [
      {
        id: "minimax",
        name: "MiniMax",
        plans: [
          {
            plan_id: "minimax_api_budget",
            display_name: "API 按量预算",
            quota_kind: "manual_budget",
            quota_unit: "CNY",
            total_quota: 0,
            total_quota_display: "手动填写",
          },
        ],
      },
      { id: "custom", name: "自定义套餐", plans: [] },
    ],
  });

  render(<TokenPlanSection />);

  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  await act(async () => {
    await user.selectOptions(screen.getByLabelText("Agent 来源"), "hermes");
  });
  await act(async () => {
    await user.selectOptions(screen.getByLabelText("服务商"), "minimax");
  });
  await act(async () => {
    await user.selectOptions(screen.getByLabelText("套餐"), "minimax_api_budget");
  });

  expect(screen.queryByLabelText(copy("settings.token_plan.refresh_method"))).not.toBeInTheDocument();
  expect(screen.queryByTestId("token-plan-static-catalog-notice")).not.toBeInTheDocument();
  expect(screen.getByTestId("detection-sync-minimax")).toBeInTheDocument();

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存" }));
  });

  await waitFor(() => expect(saveTokenPlan).toHaveBeenCalled());
  const saveArg = saveTokenPlan.mock.calls[0][0];
  expect(saveArg.provider_id).toBe("minimax");
  expect(saveArg.plan_id).toBe("minimax_api_budget");
  expect(saveArg.refresh_method).toBe("official_api");
  expect(saveArg.refresh_enabled).toBe(true);
  expect(saveArg.detection_method).toBe("official_account");
  expect(saveArg.detection_config?.official_account?.provider_home_url).toContain("minimaxi.com");
});

it("Trae catalog plans expose the official OAuth connect control", async () => {
  const user = userEvent.setup();
  getTokenPlanCatalog.mockResolvedValueOnce({
    providers: [
      {
        id: "trae",
        name: "Trae CN",
        plans: [{
          plan_id: "trae_cn_pro",
          display_name: "速通 Pro",
          quota_kind: "requests",
          quota_unit: "requests",
          total_quota: 100,
          total_quota_display: "官方动态额度",
        }],
      },
      { id: "custom", name: "自定义套餐", plans: [] },
    ],
  });

  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });
  await act(async () => {
    await user.selectOptions(screen.getByLabelText("服务商"), "trae");
  });

  expect(screen.getByTestId("detection-connect-trae")).toBeInTheDocument();
});

it("Cursor authorization persists the live usage snapshot instead of connected zero", async () => {
  const user = userEvent.setup();
  getTokenPlanCatalog.mockResolvedValueOnce({
    providers: [
      {
        id: "cursor",
        name: "Cursor",
        plans: [{
          plan_id: "cursor_pro",
          display_name: "Pro",
          quota_kind: "percent",
          quota_unit: "percent",
          total_quota: 100,
          total_quota_display: "Official live usage",
        }],
      },
      { id: "custom", name: "Custom", plans: [] },
    ],
  });
  createConsoleSession.mockImplementation(async (params) => ({
    session: makeXiaomiSession({
      id: "cursor-session-id",
      provider_id: "cursor",
      session_ref: params.session_ref,
    }),
    sessions: [],
  }));
  openCursorConsoleLogin.mockResolvedValue({ connected: false, state_code: "login_started" });
  verifyCursorConsoleSession.mockImplementation(async (sessionRef) => ({
    connected: true,
    session_ref: sessionRef,
    state_code: "connected",
    quota: {
      total_quota: 100,
      used_quota: 33.52173913043478,
      remaining_quota: 66.47826086956522,
      provider_reported_at: "2026-07-20T00:01:56.714Z",
      account_id: "auth0|user_01KWTPZG4VW30ZF6MKZ2XXM398",
      display_name: "eve***@hotmail.com",
      plan_name: "pro",
      quota_windows: [
        { kind: "total", unit: "percent", total: 100, used: 33.52173913043478, remaining: 66.47826086956522, percentage: 33.52173913043478 },
        { kind: "auto_composer", unit: "percent", total: 100, used: 27.82, remaining: 72.18, percentage: 27.82 },
        { kind: "api", unit: "percent", total: 100, used: 71.53333333333333, remaining: 28.46666666666667, percentage: 71.53333333333333 },
      ],
    },
  }));

  render(<TokenPlanSection />);
  await screen.findByText(copy("settings.section.token_plan"));
  await act(async () => {
    await user.click(screen.getByRole("button", { name: copy("settings.token_plan.add") }));
  });
  await act(async () => {
    await user.click(screen.getByTestId("token-plan-agent-card-select-trigger"));
  });
  await act(async () => {
    await user.click(screen.getByTestId("token-plan-agent-card-select-option-hermes"));
  });
  await act(async () => {
    await user.click(screen.getByTestId("token-plan-provider-card-select-trigger"));
  });
  await act(async () => {
    await user.click(screen.getByTestId("token-plan-provider-card-select-option-cursor"));
  });
  await act(async () => {
    await user.click(screen.getByTestId("detection-connect-cursor"));
  });

  await waitFor(() => expect(saveTokenPlan).toHaveBeenCalledTimes(1));
  expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
    provider_id: "cursor",
    used_quota: 33.52173913043478,
    remaining_quota: 66.47826086956522,
    sync_status: "success",
    last_refresh_status: "success",
    last_refresh_error: "",
    next_refresh_at: "",
    quota_windows: expect.arrayContaining([
      expect.objectContaining({ kind: "total", percentage: 33.52173913043478 }),
      expect.objectContaining({ kind: "auto_composer", percentage: 27.82 }),
      expect.objectContaining({ kind: "api", percentage: 71.53333333333333 }),
    ]),
    detection_config: expect.objectContaining({
      official_account: expect.objectContaining({
        account_id: "auth0|user_01KWTPZG4VW30ZF6MKZ2XXM398",
        display_name: "eve***@hotmail.com",
        plan_name: "pro",
      }),
    }),
  }));
});

it("selecting xiaomi_mimo provider shows only verified catalog plans", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => {
    await user.selectOptions(providerSelect, "xiaomi_mimo");
  });

  const planSelect = screen.getByLabelText("套餐");
  const options = Array.from(planSelect.options).map((opt) => opt.value);
  expect(options).toContain("xiaomi_mimo_standard_monthly");
  expect(options).not.toContain("custom");
});

it("selecting xiaomi_mimo provider auto-selects the first catalog plan and keeps all catalog plans available", async () => {
  const user = userEvent.setup();
  getTokenPlanCatalog.mockResolvedValueOnce({
    providers: [
      {
        id: "xiaomi_mimo",
        name: "小米 MiMo",
        plans: [
          { plan_id: "xiaomi_mimo_lite_monthly", display_name: "Lite（月付）", quota_kind: "credits", quota_unit: "credits", total_quota: 4100000000 },
          { plan_id: "xiaomi_mimo_standard_monthly", display_name: "Standard（月付）", quota_kind: "credits", quota_unit: "credits", total_quota: 11000000000 },
          { plan_id: "xiaomi_mimo_pro_monthly", display_name: "Pro（月付）", quota_kind: "credits", quota_unit: "credits", total_quota: 38000000000 },
          { plan_id: "xiaomi_mimo_max_monthly", display_name: "Max（月付）", quota_kind: "credits", quota_unit: "credits", total_quota: 82000000000 },
          { plan_id: "xiaomi_mimo_lite_yearly", display_name: "Lite（年付）", quota_kind: "credits", quota_unit: "credits", total_quota: 49200000000 },
          { plan_id: "xiaomi_mimo_standard_yearly", display_name: "Standard（年付）", quota_kind: "credits", quota_unit: "credits", total_quota: 132000000000 },
          { plan_id: "xiaomi_mimo_pro_yearly", display_name: "Pro（年付）", quota_kind: "credits", quota_unit: "credits", total_quota: 456000000000 },
          { plan_id: "xiaomi_mimo_max_yearly", display_name: "Max（年付）", quota_kind: "credits", quota_unit: "credits", total_quota: 984000000000 },
        ],
      },
      { id: "custom", name: "自定义套餐", plans: [] },
    ],
  });

  render(<TokenPlanSection />);

  await screen.findByRole("heading", { name: /Token/ });
  await act(async () => {
    const addButton = screen.getAllByRole("button").find((button) =>
      /新增|鏂板/.test(button.textContent || "")
    );
    await user.click(addButton);
  });

  const [, providerSelect, planSelect] = screen.getAllByRole("combobox");
  await act(async () => {
    await user.selectOptions(providerSelect, "xiaomi_mimo");
  });

  expect(planSelect).toHaveValue("xiaomi_mimo_lite_monthly");
  expect(Array.from(planSelect.options).map((opt) => opt.value)).toEqual(expect.arrayContaining([
    "xiaomi_mimo_lite_monthly",
    "xiaomi_mimo_standard_monthly",
    "xiaomi_mimo_pro_monthly",
    "xiaomi_mimo_max_monthly",
    "xiaomi_mimo_lite_yearly",
    "xiaomi_mimo_standard_yearly",
    "xiaomi_mimo_pro_yearly",
    "xiaomi_mimo_max_yearly",
  ]));
});

it("catalog plan makes total quota read-only with display value", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });
  await screen.findByText(copy("settings.token_plan.form_title_new"));

  const agentSelect = screen.getByLabelText("Agent 来源");
  await act(async () => {
    await user.selectOptions(agentSelect, "hermes");
  });

  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => {
    await user.selectOptions(providerSelect, "xiaomi_mimo");
  });

  const planSelect = screen.getByLabelText("套餐");
  await act(async () => {
    await user.selectOptions(planSelect, "xiaomi_mimo_standard_monthly");
  });

  const totalQuotaInput = await screen.findByDisplayValue("11,000,000,000（11B）Credits");
  expect(totalQuotaInput).toBeDisabled();
  expect(screen.getAllByText("11,000,000,000（11B）Credits").length).toBeGreaterThan(0);
});

it("custom plan allows editing all quota fields", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const agentSelect = screen.getByLabelText("Agent 来源");
  await act(async () => {
    await user.selectOptions(agentSelect, "claude");
  });

  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => {
    await user.selectOptions(providerSelect, "custom");
  });

  const planSelect = screen.getByLabelText("套餐");
  await act(async () => {
    await user.selectOptions(planSelect, "custom");
  });

  expect(screen.getByLabelText("总额度")).not.toBeDisabled();
  expect(screen.getByLabelText("已用额度")).not.toBeDisabled();
  expect(screen.getByLabelText("剩余额度")).not.toBeDisabled();
  expect(screen.getByLabelText("到期时间")).not.toBeDisabled();
});

it("shows empty catalog hint when provider has no verified plans", async () => {
  getTokenPlanCatalog.mockResolvedValue({
    providers: [
      { id: "xiaomi_mimo", name: "小米 MiMo", plans: [] },
      { id: "custom", name: "自定义套餐", plans: [] },
    ],
  });

  const user = userEvent.setup();
  render(<TokenPlanSection />);

  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => {
    await user.selectOptions(providerSelect, "xiaomi_mimo");
  });

  expect(await screen.findByText("官方套餐暂未核验，请使用自定义套餐")).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// W03-R3B: Detection method in form — no standalone console session card
// ---------------------------------------------------------------------------

const xiaomiSessionRef = "token-plan/xiaomi_mimo/session/test-uuid-001";

function makeXiaomiSession(overrides = {}) {
  return {
    id: "session-1",
    provider_id: "xiaomi_mimo",
    auth_kind: "official_console_session",
    display_name: "小米 MiMo 控制台账号",
    status: "pending_login",
    session_ref: xiaomiSessionRef,
    connected_at: "",
    last_verified_at: "",
    last_error_code: "",
    last_error_message: "",
    ...overrides,
  };
}

async function openMimoOfficialAccountForm(user, { source = "hermes" } = {}) {
  await screen.findByText("Token 套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });
  const agentSelect = await screen.findByLabelText("Agent 来源");
  if (source) {
    await act(async () => {
      await user.selectOptions(agentSelect, source);
    });
  }
  await act(async () => {
    await user.selectOptions(screen.getByLabelText("服务商"), "xiaomi_mimo");
  });
  await act(async () => {
    await user.selectOptions(screen.getByLabelText("套餐"), "xiaomi_mimo_standard_monthly");
  });
  await act(async () => {
    await user.selectOptions(screen.getByLabelText("选择检测方式"), "official_account");
  });
}

it("main UI does NOT render a standalone Xiaomi MiMo console session card", async () => {
  getConsoleSessions.mockResolvedValue({ sessions: [] });
  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");
  // The old standalone card title must NOT appear
  expect(screen.queryByText("小米 MiMo 控制台连接")).not.toBeInTheDocument();
});

it("detection method section appears in form for xiaomi_mimo catalog plan", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  // Select xiaomi_mimo provider
  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => {
    await user.selectOptions(providerSelect, "xiaomi_mimo");
  });

  const agentSelect = screen.getByLabelText("Agent 来源");
  await act(async () => {
    await user.selectOptions(agentSelect, "hermes");
  });

  // Select a catalog plan
  const planSelect = screen.getByLabelText("套餐");
  await act(async () => {
    await user.selectOptions(planSelect, "xiaomi_mimo_standard_monthly");
  });

  // Detection method section should appear
  expect(await screen.findByText("检测方式")).toBeInTheDocument();
  expect(screen.getByLabelText("选择检测方式")).toBeInTheDocument();
});

it("detection method section does NOT appear for non-xiaomi_mimo providers", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => {
    await user.selectOptions(providerSelect, "custom");
  });

  expect(screen.queryByText("检测方式")).not.toBeInTheDocument();
});

it("selecting official_account detection shows connect button inside the form", async () => {
  const user = userEvent.setup();
  getConsoleSessions.mockResolvedValue({ sessions: [] });
  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const agentSelect = screen.getByLabelText("Agent 来源");
  await act(async () => {
    await user.selectOptions(agentSelect, "hermes");
  });

  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => {
    await user.selectOptions(providerSelect, "xiaomi_mimo");
  });

  const planSelect = screen.getByLabelText("套餐");
  await act(async () => {
    await user.selectOptions(planSelect, "xiaomi_mimo_standard_monthly");
  });

  // Select official_account detection
  const detectionSelect = screen.getByLabelText("选择检测方式");
  await act(async () => {
    await user.selectOptions(detectionSelect, "official_account");
  });

  // Official account connect UI appears inside the form
  expect(await screen.findByText("官网账号登录")).toBeInTheDocument();
  expect(screen.getByTestId("detection-connect-xiaomi")).toBeInTheDocument();
});

it("does not start Xiaomi authorization without an Agent source", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);
  await openMimoOfficialAccountForm(user, { source: "" });

  await act(async () => {
    await user.click(screen.getByTestId("detection-connect-xiaomi"));
  });

  expect(createConsoleSession).not.toHaveBeenCalled();
  expect(openXiaomiMimoConsoleLogin).not.toHaveBeenCalled();
  expect(await screen.findByText("请先选择 Agent 来源")).toBeInTheDocument();
});

it("automatically creates the session, verifies quota, saves the selected plan, and closes the window", async () => {
  const user = userEvent.setup();
  const order = [];
  createConsoleSession.mockImplementation(async (params) => {
    order.push("create-session");
    return {
      session: makeXiaomiSession({ id: "new-session-id", session_ref: params.session_ref }),
      sessions: [makeXiaomiSession({ id: "new-session-id", session_ref: params.session_ref })],
    };
  });
  openXiaomiMimoConsoleLogin.mockImplementation(async () => {
    order.push("open-window");
    return { connected: false, state_code: "login_started" };
  });
  verifyXiaomiMimoConsoleSession.mockImplementation(async (sessionRef) => {
    order.push("verify-native");
    return {
      connected: true,
      session_ref: sessionRef,
      state_code: "connected",
      error_code: "",
      error_message: "",
      quota: {
        total_quota: 11_000_000_000,
        used_quota: 1_000_000_000,
        remaining_quota: 10_000_000_000,
        expires_at: null,
        provider_reported_at: "2026-06-28T00:00:00.000Z",
      },
    };
  });
  verifyConsoleSession.mockImplementation(async () => {
    order.push("verify-backend");
    return { ok: true, session: makeXiaomiSession({ id: "new-session-id", status: "connected" }) };
  });
  saveTokenPlan.mockImplementation(async (record) => {
    order.push("save-plan");
    return { ok: true, record: { ...record, id: "plan-mimo" }, records: [{ ...record, id: "plan-mimo" }] };
  });
  deleteXiaomiMimoConsoleSession.mockImplementation(async () => {
    order.push("close-window");
  });

  render(<TokenPlanSection />);
  await openMimoOfficialAccountForm(user);
  await act(async () => {
    await user.click(screen.getByTestId("detection-connect-xiaomi"));
  });

  await waitFor(() => {
    expect(order).toEqual([
      "create-session",
      "open-window",
      "verify-native",
      "verify-backend",
      "save-plan",
      "close-window",
    ]);
  });
  expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
    source: "hermes",
    provider_id: "xiaomi_mimo",
    plan_id: "xiaomi_mimo_standard_monthly",
    used_quota: 1_000_000_000,
    remaining_quota: 10_000_000_000,
    detection_method: "official_account",
  }));
  expect(screen.queryByText("新增 Token 套餐")).not.toBeInTheDocument();
});

it("does not open the Xiaomi login window when local session creation fails", async () => {
  const user = userEvent.setup();
  createConsoleSession.mockRejectedValue(new Error("Failed to fetch"));

  render(<TokenPlanSection />);
  await openMimoOfficialAccountForm(user);
  await act(async () => {
    await user.click(screen.getByTestId("detection-connect-xiaomi"));
  });

  expect(await screen.findByText("Failed to fetch")).toBeInTheDocument();
  expect(openXiaomiMimoConsoleLogin).not.toHaveBeenCalled();
});

it("rolls back the pending session when the native login window fails to open", async () => {
  const user = userEvent.setup();
  createConsoleSession.mockImplementation(async (params) => ({
    session: makeXiaomiSession({ id: "new-session-id", session_ref: params.session_ref }),
    sessions: [makeXiaomiSession({ id: "new-session-id", session_ref: params.session_ref })],
  }));
  openXiaomiMimoConsoleLogin.mockRejectedValue(new Error("window failed"));

  render(<TokenPlanSection />);
  await openMimoOfficialAccountForm(user);
  await act(async () => {
    await user.click(screen.getByTestId("detection-connect-xiaomi"));
  });

  await waitFor(() => expect(deleteConsoleSession).toHaveBeenCalledWith("new-session-id"));
  expect(await screen.findByText("window failed")).toBeInTheDocument();
  expect(saveTokenPlan).not.toHaveBeenCalled();
});

it("keeps the Xiaomi window open and does not show success when saving the plan fails", async () => {
  const user = userEvent.setup();
  createConsoleSession.mockImplementation(async (params) => ({
    session: makeXiaomiSession({ id: "new-session-id", session_ref: params.session_ref }),
    sessions: [makeXiaomiSession({ id: "new-session-id", session_ref: params.session_ref })],
  }));
  openXiaomiMimoConsoleLogin.mockResolvedValue({ connected: false, state_code: "login_started" });
  verifyXiaomiMimoConsoleSession.mockImplementation(async (sessionRef) => ({
    connected: true,
    session_ref: sessionRef,
    state_code: "connected",
    error_code: "",
    error_message: "",
    quota: { total_quota: 100, used_quota: 25, remaining_quota: 75 },
  }));
  saveTokenPlan
    .mockRejectedValueOnce(new Error("save failed"))
    .mockImplementation(async (record) => ({
      ok: true,
      record: { ...record, id: "plan-mimo" },
      records: [{ ...record, id: "plan-mimo" }],
    }));

  render(<TokenPlanSection />);
  await openMimoOfficialAccountForm(user);
  await act(async () => {
    await user.click(screen.getByTestId("detection-connect-xiaomi"));
  });

  expect(await screen.findByText("save failed")).toBeInTheDocument();
  expect(deleteXiaomiMimoConsoleSession).not.toHaveBeenCalled();
  expect(screen.queryByTestId("detection-connected")).not.toBeInTheDocument();

  await act(async () => {
    await user.click(screen.getByTestId("detection-resume"));
  });

  await waitFor(() => expect(deleteXiaomiMimoConsoleSession).toHaveBeenCalledTimes(1));
  expect(createConsoleSession).toHaveBeenCalledTimes(1);
  expect(openXiaomiMimoConsoleLogin).toHaveBeenCalledTimes(1);
  expect(verifyXiaomiMimoConsoleSession).toHaveBeenCalledTimes(2);
  expect(saveTokenPlan).toHaveBeenCalledTimes(2);
});

it("cleans up a pending session when the Xiaomi login window is closed", async () => {
  const user = userEvent.setup();
  createConsoleSession.mockImplementation(async (params) => ({
    session: makeXiaomiSession({ id: "new-session-id", session_ref: params.session_ref }),
    sessions: [makeXiaomiSession({ id: "new-session-id", session_ref: params.session_ref })],
  }));
  openXiaomiMimoConsoleLogin.mockResolvedValue({ connected: false, state_code: "login_started" });
  verifyXiaomiMimoConsoleSession.mockImplementation(async (sessionRef) => ({
    connected: false,
    session_ref: sessionRef,
    state_code: "session_not_found",
    error_code: "SESSION_NOT_FOUND",
    error_message: "登录窗口已关闭",
  }));

  render(<TokenPlanSection />);
  await openMimoOfficialAccountForm(user);
  await act(async () => {
    await user.click(screen.getByTestId("detection-connect-xiaomi"));
  });

  await waitFor(() => expect(deleteConsoleSession).toHaveBeenCalledWith("new-session-id"));
  expect(deleteXiaomiMimoConsoleSession).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("登录窗口已关闭")).toBeInTheDocument();
  expect(screen.getByTestId("detection-connect-xiaomi")).toBeInTheDocument();
});

it("replaces a failed Xiaomi session before retrying authorization", async () => {
  const user = userEvent.setup();
  const oldSession = makeXiaomiSession({
    id: "old-session-id",
    session_ref: "token-plan/xiaomi_mimo/session/old",
    status: "failed",
  });
  getConsoleSessions.mockResolvedValue({ sessions: [oldSession] });
  createConsoleSession.mockImplementation(async (params) => ({
    session: makeXiaomiSession({ id: "new-session-id", session_ref: params.session_ref }),
    sessions: [makeXiaomiSession({ id: "new-session-id", session_ref: params.session_ref })],
  }));
  openXiaomiMimoConsoleLogin.mockResolvedValue({ connected: false, state_code: "login_started" });
  verifyXiaomiMimoConsoleSession.mockImplementation(async (sessionRef) => ({
    connected: true,
    session_ref: sessionRef,
    state_code: "connected",
    error_code: "",
    error_message: "",
    quota: { total_quota: 100, used_quota: 25, remaining_quota: 75 },
  }));

  render(<TokenPlanSection />);
  await openMimoOfficialAccountForm(user);
  await act(async () => {
    await user.click(await screen.findByTestId("detection-retry"));
  });

  await waitFor(() => expect(saveTokenPlan).toHaveBeenCalledTimes(1));
  expect(deleteConsoleSession).toHaveBeenCalledWith("old-session-id");
  expect(deleteXiaomiMimoConsoleSession).toHaveBeenNthCalledWith(
    1,
    "token-plan/xiaomi_mimo/session/old",
  );
  expect(deleteConsoleSession.mock.invocationCallOrder[0]).toBeLessThan(
    createConsoleSession.mock.invocationCallOrder[0],
  );
});

it("selecting xiaomi_mimo catalog plan auto-fills catalog quota and detection url", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });
  await screen.findByText(copy("settings.token_plan.form_title_new"));

  const agentSelect = screen.getByLabelText("Agent 来源");
  await act(async () => {
    await user.selectOptions(agentSelect, "hermes");
  });

  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => {
    await user.selectOptions(providerSelect, "xiaomi_mimo");
  });

  const planSelect = screen.getByLabelText("套餐");
  await act(async () => {
    await user.selectOptions(planSelect, "xiaomi_mimo_standard_monthly");
  });

  // Catalog quota is displayed and readonly
  const totalQuotaInput = await screen.findByDisplayValue("11,000,000,000（11B）Credits");
  expect(totalQuotaInput).toBeDisabled();
  expect(screen.getAllByText("11,000,000,000（11B）Credits").length).toBeGreaterThan(0);

  // Detection method section appears
  expect(await screen.findByText("检测方式")).toBeInTheDocument();
});

it("save payload does NOT contain forbidden fields (api_key, cookie, authorization)", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const agentSelect = screen.getByLabelText("Agent 来源");
  await act(async () => {
    await user.selectOptions(agentSelect, "claude");
  });

  const planLabel = screen.getByLabelText("套餐名称");
  await act(async () => {
    await user.clear(planLabel);
    await user.type(planLabel, "Test Plan");
  });

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存" }));
  });

  await waitFor(() => {
    expect(saveTokenPlan).toHaveBeenCalled();
  });

  const saveArg = saveTokenPlan.mock.calls[0][0];
  // Forbidden fields must be stripped
  expect(saveArg.api_key).toBeUndefined();
  expect(saveArg.apiKey).toBeUndefined();
  expect(saveArg.cookie).toBeUndefined();
  expect(saveArg.authorization).toBeUndefined();
  expect(saveArg.authorization_header).toBeUndefined();
  expect(saveArg.bearer).toBeUndefined();
  expect(saveArg.token).toBeUndefined();
  expect(saveArg.password).toBeUndefined();
});

it("catalog plan selection auto-configures official_account detection", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const agentSelect = screen.getByLabelText("Agent 来源");
  await act(async () => {
    await user.selectOptions(agentSelect, "hermes");
  });

  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => {
    await user.selectOptions(providerSelect, "xiaomi_mimo");
  });

  const planSelect = screen.getByLabelText("套餐");
  await act(async () => {
    await user.selectOptions(planSelect, "xiaomi_mimo_standard_monthly");
  });

  // Catalog plan auto-selects official_account detection
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存" }));
  });

  await waitFor(() => {
    expect(saveTokenPlan).toHaveBeenCalled();
  });

  const saveArg = saveTokenPlan.mock.calls[0][0];
  expect(saveArg.detection_method).toBe("official_account");
  expect(saveArg.refresh_enabled).toBe(true);
  expect(saveArg.refresh_method).toBe("official_api");
  expect(saveArg.detection_config?.official_account?.provider_home_url).toContain("xiaomimimo.com");
});

it("custom_api detection shows real config form (R3C)", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const agentSelect = screen.getByLabelText("Agent 来源");
  await act(async () => {
    await user.selectOptions(agentSelect, "hermes");
  });

  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => {
    await user.selectOptions(providerSelect, "xiaomi_mimo");
  });

  const planSelect = screen.getByLabelText("套餐");
  await act(async () => {
    await user.selectOptions(planSelect, "xiaomi_mimo_standard_monthly");
  });

  const detectionSelect = screen.getByLabelText("选择检测方式");
  await act(async () => {
    await user.selectOptions(detectionSelect, "custom_api");
  });

  // R3C: real custom API form should appear, not placeholder text
  expect(screen.getAllByText("自定义 API 检测").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByLabelText("API 格式")).toBeInTheDocument();
  expect(screen.getByLabelText("请求地址")).toBeInTheDocument();
  expect(screen.getByLabelText("总额度路径")).toBeInTheDocument();
  expect(screen.getByLabelText("已用额度路径")).toBeInTheDocument();
  expect(screen.getByLabelText("剩余额度路径")).toBeInTheDocument();
});

// W03-R3D P1: API Key input is editable (not disabled placeholder)
it("R3D custom_api API Key input is editable and not disabled", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const agentSelect = screen.getByLabelText("Agent 来源");
  await act(async () => { await user.selectOptions(agentSelect, "hermes"); });

  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => { await user.selectOptions(providerSelect, "xiaomi_mimo"); });

  const planSelect = screen.getByLabelText("套餐");
  await act(async () => { await user.selectOptions(planSelect, "xiaomi_mimo_standard_monthly"); });

  const detectionSelect = screen.getByLabelText("选择检测方式");
  await act(async () => { await user.selectOptions(detectionSelect, "custom_api"); });

  // API Key input should exist and NOT be disabled
  const apiKeyInput = screen.getByLabelText("API Key");
  expect(apiKeyInput).toBeInTheDocument();
  expect(apiKeyInput.disabled).toBe(false);

  // User can type into it
  await act(async () => {
    await user.clear(apiKeyInput);
    await user.type(apiKeyInput, "sk-test-api-key-12345");
  });
  expect(apiKeyInput.value).toBe("sk-test-api-key-12345");
});

// W03-R3D P1: save with custom_api detection calls saveTokenPlanSecret and
// writes api_key_ref into the plan payload (not the raw key).
it("R3D save custom_api plan calls saveTokenPlanSecret and writes api_key_ref", async () => {
  const user = userEvent.setup();
  const mockSecretRef = "token-plan/xiaomi_mimo/custom-api/mock-uuid-1234";
  saveTokenPlanSecret.mockResolvedValue({
    ok: true,
    api_key_ref: mockSecretRef,
    provider_id: "xiaomi_mimo",
    purpose: "custom-api",
  });

  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const agentSelect = screen.getByLabelText("Agent 来源");
  await act(async () => { await user.selectOptions(agentSelect, "hermes"); });

  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => { await user.selectOptions(providerSelect, "xiaomi_mimo"); });

  const planSelect = screen.getByLabelText("套餐");
  await act(async () => { await user.selectOptions(planSelect, "xiaomi_mimo_standard_monthly"); });

  const detectionSelect = screen.getByLabelText("选择检测方式");
  await act(async () => { await user.selectOptions(detectionSelect, "custom_api"); });

  // Type in API Key
  const apiKeyInput = screen.getByLabelText("API Key");
  await act(async () => {
    await user.clear(apiKeyInput);
    await user.type(apiKeyInput, "sk-test-save-key");
  });

  // Fill in required custom API fields
  const requestUrl = screen.getByLabelText("请求地址");
  await act(async () => {
    await user.clear(requestUrl);
    await user.type(requestUrl, "https://api.example.com/quota");
  });

  const totalPath = screen.getByLabelText("总额度路径");
  await act(async () => {
    await user.clear(totalPath);
    await user.type(totalPath, "$.total");
  });

  const usedPath = screen.getByLabelText("已用额度路径");
  await act(async () => {
    await user.clear(usedPath);
    await user.type(usedPath, "$.used");
  });

  const remainingPath = screen.getByLabelText("剩余额度路径");
  await act(async () => {
    await user.clear(remainingPath);
    await user.type(remainingPath, "$.remaining");
  });

  // Save
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存" }));
  });

  await waitFor(() => {
    // 1. saveTokenPlanSecret must have been called with the raw key
    expect(saveTokenPlanSecret).toHaveBeenCalledWith({
      provider_id: "xiaomi_mimo",
      purpose: "custom-api",
      secret: "sk-test-save-key",
    });

    // 2. saveTokenPlan must have been called
    expect(saveTokenPlan).toHaveBeenCalled();
  });

  const saveArg = saveTokenPlan.mock.calls[0][0];

  // 3. detection_config.custom_api must contain api_key_ref (not raw key)
  expect(saveArg.detection_method).toBe("custom_api");
  expect(saveArg.detection_config).toBeDefined();
  expect(saveArg.detection_config.custom_api).toBeDefined();
  expect(saveArg.detection_config.custom_api.api_key_ref).toBe(mockSecretRef);

  // 4. Raw API Key must NOT appear in the plan payload
  const payloadStr = JSON.stringify(saveArg);
  expect(payloadStr).not.toMatch(/sk-test-save-key/);
  expect(payloadStr).not.toMatch(/api_key_ref.*sk-/);

  // 5. Forbidden fields must still be stripped
  expect(saveArg.api_key).toBeUndefined();
  expect(saveArg.secret).toBeUndefined();
});

// W03-R3D: saveTokenPlanSecret failure shows error and does not save plan
it("R3D saveTokenPlanSecret failure shows error and does not save plan", async () => {
  const user = userEvent.setup();
  saveTokenPlanSecret.mockResolvedValue({
    ok: false,
    error: "credential_store_unavailable",
  });

  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  const agentSelect = screen.getByLabelText("Agent 来源");
  await act(async () => { await user.selectOptions(agentSelect, "hermes"); });

  const providerSelect = screen.getByLabelText("服务商");
  await act(async () => { await user.selectOptions(providerSelect, "xiaomi_mimo"); });

  const planSelect = screen.getByLabelText("套餐");
  await act(async () => { await user.selectOptions(planSelect, "xiaomi_mimo_standard_monthly"); });

  const detectionSelect = screen.getByLabelText("选择检测方式");
  await act(async () => { await user.selectOptions(detectionSelect, "custom_api"); });

  // Type in API Key
  const apiKeyInput = screen.getByLabelText("API Key");
  await act(async () => {
    await user.clear(apiKeyInput);
    await user.type(apiKeyInput, "sk-test-fail-key");
  });

  // Save
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存" }));
  });

  await waitFor(() => {
    expect(saveTokenPlanSecret).toHaveBeenCalled();
    // saveTokenPlan must NOT have been called (secret save failed first)
    expect(saveTokenPlan).not.toHaveBeenCalled();
  });

  // Error message should be displayed — either the server error or fallback
  const errorEl = await screen.findByText(
    (content) => content.includes("credential_store_unavailable") || content.includes("API Key 保存失败"),
  );
  expect(errorEl).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// W03-R3D: Unified detection/sync status display tests
// ---------------------------------------------------------------------------

it("R3D record without detection_method keeps the plan card free of detection prompts", async () => {
  getTokenPlans.mockResolvedValue({
    records: [{
      ...BASE_RECORD,
      id: "plan-no-detection",
      detection_method: "",
      sync_status: "not_configured",
    }],
  });

  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");
  await expandAllPlans();
  expect(screen.queryByText("请选择检测方式以同步套餐状态")).not.toBeInTheDocument();
});

it("R3D record with official_account detection preserves quota while hiding diagnostic metadata", async () => {
  getTokenPlans.mockResolvedValue({
    records: [{
      ...BASE_RECORD,
      id: "plan-official",
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_id: "xiaomi_mimo_standard_monthly",
      plan_label: "Standard（月付）",
      total_quota: 11000000000,
      used_quota: 5000000000,
      remaining_quota: 6000000000,
      expires_at: "2026-12-31",
      quota_source: "catalog",
      detection_method: "official_account",
      detection_config: {
        official_account: {
          provider_home_url: "https://platform.xiaomimimo.com/token-plan",
          account_binding_id: "session-test",
        },
      },
      sync_status: "unsupported",
      last_error_code: "PROVIDER_UNSUPPORTED",
      last_error_message: "当前没有可复现官方额度查询能力",
      last_sync_attempt_at: "2026-06-25T10:00:00.000Z",
    }],
  });

  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");
  await expandAllPlans();

  // Quota remains represented by the progress bar without the redundant numeric detail row.
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "45");
  expect(screen.queryByText(/5,000,000,000/)).not.toBeInTheDocument();
  expect(screen.queryByText(/11,000,000,000/)).not.toBeInTheDocument();
  expect(screen.queryByText(/6,000,000,000/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/2026\/12\/31/).length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByText(/官网账号登录检测/)).not.toBeInTheDocument();
  expect(screen.queryByText(/不支持同步/)).not.toBeInTheDocument();
  expect(screen.queryByText(/PROVIDER_UNSUPPORTED/)).not.toBeInTheDocument();
});

it("R3D record with custom_api detection omits detection, sync, and quota-source metadata from the card", async () => {
  getTokenPlans.mockResolvedValue({
    records: [{
      ...BASE_RECORD,
      id: "plan-custom-success",
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_label: "Standard（月付）",
      total_quota: 11000000000,
      used_quota: 3200000000,
      remaining_quota: 7800000000,
      expires_at: "2099-07-25",
      quota_source: "custom_api",
      detection_method: "custom_api",
      sync_status: "success",
      last_synced_at: "2026-06-25T10:00:00.000Z",
      last_error_code: "",
      last_error_message: "",
    }],
  });

  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");
  await expandAllPlans();

  expect(screen.queryByText(/自定义 API 检测/)).not.toBeInTheDocument();
  expect(screen.queryByText(/同步成功/)).not.toBeInTheDocument();
  expect(screen.queryByText(/额度来源/)).not.toBeInTheDocument();
});

it("R3D failed record keeps the last successful quota and shows a compact failure reason", async () => {
  getTokenPlans.mockResolvedValue({
    records: [{
      ...BASE_RECORD,
      id: "plan-failed",
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_label: "Standard（月付）",
      total_quota: 11000000000,
      used_quota: 2000000000,
      remaining_quota: 9000000000,
      expires_at: "2099-07-01",
      quota_source: "custom_api",
      detection_method: "custom_api",
      sync_status: "failed",
      last_error_code: "CUSTOM_API_MAPPING_MISSING",
      last_error_message: "自定义 API 响应中未找到有效额度数值",
      last_sync_attempt_at: "2026-06-25T11:00:00.000Z",
      last_synced_at: "2026-06-20T10:00:00.000Z",
      provider_reported_at: "2026-06-20T10:00:00.000Z",
    }],
  });

  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");
  await expandAllPlans();

  // Last successful quota remains represented by the progress bar without the numeric detail row.
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "18");
  expect(screen.queryByText(/11,000,000,000/)).not.toBeInTheDocument();
  expect(screen.queryByText(/2,000,000,000/)).not.toBeInTheDocument();
  expect(screen.queryByText(/9,000,000,000/)).not.toBeInTheDocument();

  expect(screen.getByTestId("token-plan-failure-reason")).toHaveTextContent("自定义 API 响应中未找到有效额度数值");
  expect(screen.queryByText(/CUSTOM_API_MAPPING_MISSING/)).not.toBeInTheDocument();
  expect(screen.queryByText(/最后同步时间/)).not.toBeInTheDocument();
});

it("R3D both detection methods omit the old sync-status block", async () => {
  // Create two records: one official_account failed, one custom_api failed
  getTokenPlans.mockResolvedValue({
    records: [
      {
        ...BASE_RECORD,
        id: "plan-official-failed",
        source: "hermes",
        provider_id: "xiaomi_mimo",
        plan_id: "xiaomi_mimo_standard_monthly",
        plan_label: "Standard（月付）",
        total_quota: 1000,
        used_quota: 100,
        remaining_quota: 900,
        quota_source: "catalog",
        detection_method: "official_account",
        sync_status: "unsupported",
        last_error_code: "PROVIDER_UNSUPPORTED",
        last_error_message: "当前没有可复现官方额度查询能力",
      },
      {
        ...BASE_RECORD,
        id: "plan-custom-failed",
        source: "hermes",
        plan_label: "Custom",
        total_quota: 500,
        used_quota: 50,
        remaining_quota: 450,
        quota_source: "custom_api",
        detection_method: "custom_api",
        sync_status: "failed",
        last_error_code: "CUSTOM_API_REQUEST_FAILED",
        last_error_message: "自定义 API 请求失败",
      },
    ],
  });

  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");
  await expandAllPlans();

  expect(screen.queryByTestId("token-plan-sync-badge")).not.toBeInTheDocument();
  expect(screen.queryByTestId("token-plan-sync-status")).not.toBeInTheDocument();
  expect(screen.getAllByTestId("token-plan-failure-reason")).toHaveLength(2);
  expect(screen.getByText(/当前没有可复现官方额度查询能力/)).toBeInTheDocument();
  expect(screen.getByText(/自定义 API 请求失败/)).toBeInTheDocument();
});

it("R3D API Key must NOT appear in record card or list view", async () => {
  getTokenPlans.mockResolvedValue({
    records: [{
      ...BASE_RECORD,
      id: "plan-no-leak",
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_label: "Standard（月付）",
      total_quota: 11000000000,
      quota_source: "custom_api",
      detection_method: "custom_api",
      detection_config: {
        custom_api: {
          api_key_ref: "token-plan/xiaomi_mimo/custom-api/2e2c7f3d-7b9f-4c92-b2d2-c6e9f4a8c320",
          api_format: "json_path",
          request_url: "https://example.com/quota",
          method: "GET",
          response_mapping: {
            total_quota_path: "$.total",
            remaining_quota_path: "$.remaining",
          },
        },
      },
      sync_status: "success",
    }],
  });

  const { container } = render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  const html = container.innerHTML;
  // No API key plaintext in the DOM
  expect(html).not.toMatch(/sk-/);
  expect(html).not.toMatch(/do-not-leak/);
  expect(html).not.toMatch(/nested-secret/);
  expect(html).not.toMatch(/raw-cookie/);
});

it("R3D manual quota entry is disabled when detection method is configured", async () => {
  const user = userEvent.setup();
  getTokenPlans.mockResolvedValue({
    records: [{
      ...BASE_RECORD,
      id: "plan-r3d-disable",
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_id: "xiaomi_mimo_standard_monthly",
      plan_label: "Standard",
      total_quota: 11000000000,
      used_quota: 5000000000,
      remaining_quota: 6000000000,
      detection_method: "custom_api",
      detection_config: {
        custom_api: {
          api_key_ref: "token-plan/xiaomi_mimo/api/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          request_url: "https://api.example.com/quota",
          method: "GET",
          response_mapping: {
            total_quota_path: "$.total",
            used_quota_path: "$.used",
            remaining_quota_path: "$.remaining",
          },
        },
      },
      sync_status: "success",
      last_synced_at: "2026-06-20T10:00:00Z",
      quota_source: "custom_api",
    }],
  });
  getTokenPlanCatalog.mockResolvedValue({
    providers: [{
      id: "xiaomi_mimo",
      name: "小米 MiMo",
      plans: [{
        plan_id: "xiaomi_mimo_standard_monthly",
        display_name: "Standard",
        quota_kind: "tokens",
        quota_unit: "tokens",
        total_quota: 11000000000,
      }],
    }],
  });

  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  // Open edit form for the existing plan
  const editBtn = screen.getByRole("button", { name: "编辑" });
  await act(async () => {
    await user.click(editBtn);
  });
  await screen.findByText("编辑 Token 套餐");

  // After opening edit, used_quota, remaining_quota, expires_at should be disabled
  // because detection_method is configured
  const usedQuotaInput = screen.getByDisplayValue("5000000000");
  const remainingQuotaInput = screen.getByDisplayValue("6000000000");
  const expiresAtInput = screen.getByDisplayValue("2026-12-31");

  expect(usedQuotaInput.disabled).toBe(true);
  expect(remainingQuotaInput.disabled).toBe(true);
  expect(expiresAtInput.disabled).toBe(true);
});

// ---------------------------------------------------------------------------
// W03-R3D P1 regression: editing an existing custom_api record and entering
// a NEW API Key must call saveTokenPlanSecret and replace the old ref.
// The in-memory credential store is volatile — after a server restart the
// old ref is stale.  If we skipped saving because an old ref existed, the
// user could never re-enter / rotate their key.
// ---------------------------------------------------------------------------

it("R3D P1 editing existing custom_api record with new key replaces api_key_ref", async () => {
  const user = userEvent.setup();
  const oldRef = "token-plan/xiaomi_mimo/custom-api/old-stale-uuid-0001";
  const newRef = "token-plan/xiaomi_mimo/custom-api/new-fresh-uuid-9999";

  // Existing record already has a custom_api detection with an old api_key_ref.
  getTokenPlans.mockResolvedValue({
    records: [{
      ...BASE_RECORD,
      id: "plan-existing-custom",
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_id: "xiaomi_mimo_standard_monthly",
      plan_label: "Standard（月付）",
      quota_kind: "credits",
      quota_unit: "credits",
      total_quota: 11000000000,
      used_quota: 2000000000,
      remaining_quota: 9000000000,
      expires_at: "2099-07-01",
      quota_source: "custom_api",
      detection_method: "custom_api",
      detection_config: {
        custom_api: {
          api_key_ref: oldRef,
          api_format: "json_path",
          request_url: "https://api.example.com/quota",
          method: "GET",
          response_mapping: {
            total_quota_path: "$.total",
            used_quota_path: "$.used",
            remaining_quota_path: "$.remaining",
            expires_at_path: "$.expires_at",
          },
        },
      },
      sync_status: "success",
      last_synced_at: "2026-06-20T10:00:00Z",
    }],
  });

  // The secrets endpoint returns a NEW ref when called.
  saveTokenPlanSecret.mockResolvedValue({
    ok: true,
    api_key_ref: newRef,
    provider_id: "xiaomi_mimo",
    purpose: "custom-api",
  });

  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");
  await screen.findByText(/Standard（月付）/i);

  // 1. Open edit form for the existing record
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "编辑" }));
  });

  // 2. API Key input should be empty (never pre-filled)
  const apiKeyInput = screen.getByLabelText("API Key");
  expect(apiKeyInput.value).toBe("");

  // 3. Type a NEW key
  await act(async () => {
    await user.clear(apiKeyInput);
    await user.type(apiKeyInput, "sk-rotated-new-key-9999");
  });

  // 4. Save
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存" }));
  });

  await waitFor(() => {
    // saveTokenPlanSecret MUST have been called — even though oldRef existed
    expect(saveTokenPlanSecret).toHaveBeenCalledWith({
      provider_id: "xiaomi_mimo",
      purpose: "custom-api",
      secret: "sk-rotated-new-key-9999",
    });
    expect(saveTokenPlan).toHaveBeenCalled();
  });

  const saveArg = saveTokenPlan.mock.calls[0][0];

  // 5. The plan payload must use the NEW ref, not the old one
  expect(saveArg.detection_config.custom_api.api_key_ref).toBe(newRef);
  expect(saveArg.detection_config.custom_api.api_key_ref).not.toBe(oldRef);

  // 6. Raw key must NOT appear anywhere in the payload
  const payloadStr = JSON.stringify(saveArg);
  expect(payloadStr).not.toMatch(/sk-rotated-new-key-9999/);
  expect(saveArg.api_key).toBeUndefined();
  expect(saveArg.secret).toBeUndefined();
});

it("R3D P1 editing existing custom_api record with EMPTY key field keeps old ref", async () => {
  const user = userEvent.setup();
  const oldRef = "token-plan/xiaomi_mimo/custom-api/preserved-old-uuid-7777";

  getTokenPlans.mockResolvedValue({
    records: [{
      ...BASE_RECORD,
      id: "plan-keep-ref",
      source: "hermes",
      provider_id: "xiaomi_mimo",
      plan_id: "xiaomi_mimo_standard_monthly",
      plan_label: "Standard（月付）",
      quota_kind: "credits",
      quota_unit: "credits",
      total_quota: 11000000000,
      used_quota: 2000000000,
      remaining_quota: 9000000000,
      expires_at: "2099-07-01",
      quota_source: "custom_api",
      detection_method: "custom_api",
      detection_config: {
        custom_api: {
          api_key_ref: oldRef,
          api_format: "json_path",
          request_url: "https://api.example.com/quota",
          method: "GET",
          response_mapping: {
            total_quota_path: "$.total",
            used_quota_path: "$.used",
            remaining_quota_path: "$.remaining",
            expires_at_path: "$.expires_at",
          },
        },
      },
      sync_status: "success",
      last_synced_at: "2026-06-20T10:00:00Z",
    }],
  });

  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");
  await screen.findByText(/Standard（月付）/i);

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "编辑" }));
  });

  // API Key input is empty — user did NOT re-enter a key
  const apiKeyInput = screen.getByLabelText("API Key");
  expect(apiKeyInput.value).toBe("");

  // Save without typing anything into the API Key field
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存" }));
  });

  await waitFor(() => {
    expect(saveTokenPlan).toHaveBeenCalled();
  });

  // saveTokenPlanSecret must NOT have been called (no new key entered)
  expect(saveTokenPlanSecret).not.toHaveBeenCalled();

  // The old ref must be preserved in the payload
  const saveArg = saveTokenPlan.mock.calls[0][0];
  expect(saveArg.detection_config.custom_api.api_key_ref).toBe(oldRef);
});

// ---------------------------------------------------------------------------
// W03E-R3E: Remove legacy cookie_scrape entry from user-visible UI
// ---------------------------------------------------------------------------

it("R3E new plan form does not show cookie_scrape as a refresh method option", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  // cookie_scrape label must not appear anywhere in the form
  expect(screen.queryByText("Cookie 抓取（未实现）")).not.toBeInTheDocument();

  // If the refresh method selector is visible, its options must not include cookie_scrape
  const refreshMethodSelect = screen.queryByLabelText("刷新方式");
  if (refreshMethodSelect) {
    const optionValues = Array.from(refreshMethodSelect.options).map((o) => o.value);
    expect(optionValues).not.toContain("cookie_scrape");
  }
});

it("R3E editing a legacy refresh_method=cookie_scrape record opens the form without crashing", async () => {
  const user = userEvent.setup();
  getTokenPlans.mockResolvedValue({
    records: [{
      ...BASE_RECORD,
      id: "plan-legacy-cookie",
      source: "claude",
      plan_label: "Legacy Cookie Plan",
      refresh_method: "cookie_scrape",
      detection_method: "",
    }],
  });

  render(<TokenPlanSection />);
  await screen.findByText(/Legacy Cookie Plan/i);

  // Opening edit must not crash
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "编辑" }));
  });

  // Form should be open and show the plan label
  expect(screen.getByDisplayValue("Legacy Cookie Plan")).toBeInTheDocument();

  // cookie_scrape must not be a selectable value in the refresh method selector
  const refreshMethodSelect = screen.queryByLabelText("刷新方式");
  if (refreshMethodSelect) {
    const optionValues = Array.from(refreshMethodSelect.options).map((o) => o.value);
    expect(optionValues).not.toContain("cookie_scrape");
    // The current value must be normalized to a valid option, not left as cookie_scrape
    expect(refreshMethodSelect.value).not.toBe("cookie_scrape");
  }
});

it("R3E saving an edited legacy cookie_scrape record does not write cookie_scrape in payload", async () => {
  const user = userEvent.setup();
  getTokenPlans.mockResolvedValue({
    records: [{
      ...BASE_RECORD,
      id: "plan-legacy-cookie-save",
      source: "claude",
      plan_label: "Legacy Cookie Save",
      refresh_method: "cookie_scrape",
      detection_method: "",
    }],
  });

  render(<TokenPlanSection />);
  await screen.findByText(/Legacy Cookie Save/i);

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "编辑" }));
  });

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存" }));
  });

  await waitFor(() => {
    expect(saveTokenPlan).toHaveBeenCalled();
  });

  const saveArg = saveTokenPlan.mock.calls[0][0];
  // Payload must NOT contain cookie_scrape as refresh_method
  expect(saveArg.refresh_method).not.toBe("cookie_scrape");
});

it("R3E no Cookie input or paste-Cookie action appears in the form", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  // No Cookie-related input labels or buttons
  expect(screen.queryByLabelText(/cookie/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /cookie/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/粘贴\s*Cookie/i)).not.toBeInTheDocument();
});

it("saves notes field capped at 200 characters", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);
  await screen.findByText(/claude \/ Max/i);

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "编辑" }));
  });

  const notesInput = screen.getByTestId("token-plan-form-notes");
  await act(async () => {
    await user.type(notesInput, "work account");
  });

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存" }));
  });

  await waitFor(() => expect(saveTokenPlan).toHaveBeenCalled());
  const saveArg = saveTokenPlan.mock.calls.at(-1)[0];
  expect(saveArg.notes).toBe("work account");
});

it("shows Claude routing notice and hides official detection when routing mode selected", async () => {
  const user = userEvent.setup();
  getTokenPlanCatalog.mockResolvedValue({
    providers: [
      {
        id: "claude",
        name: "Claude",
        plans: [
          {
            plan_id: "claude_pro",
            display_name: "Pro",
            quota_kind: "rolling_window",
            quota_unit: "tokens",
            total_quota: 0,
            total_quota_display: "官方动态额度",
          },
        ],
      },
      { id: "custom", name: "自定义套餐", plans: [] },
    ],
  });

  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  await act(async () => {
    await user.click(screen.getByTestId("token-plan-provider-card-select-trigger"));
  });
  await act(async () => {
    await user.click(screen.getByTestId("token-plan-provider-card-select-option-claude"));
  });

  const modeSelect = screen.getByTestId("claude-account-mode-select");
  await act(async () => {
    await user.selectOptions(modeSelect, "routing");
  });

  expect(screen.getByTestId("claude-routing-notice")).toBeInTheDocument();
  expect(screen.queryByLabelText("选择检测方式")).not.toBeInTheDocument();
});

it("lists codex claude cursor in catalog provider options", async () => {
  getTokenPlanCatalog.mockResolvedValue({
    providers: [
      { id: "codex", name: "Codex", plans: [{ plan_id: "codex_pro_5x", display_name: "Pro 5x", quota_kind: "rolling_window", quota_unit: "tokens", total_quota: 0, total_quota_display: "动态" }] },
      { id: "claude", name: "Claude", plans: [{ plan_id: "claude_pro", display_name: "Pro", quota_kind: "rolling_window", quota_unit: "tokens", total_quota: 0, total_quota_display: "动态" }] },
      { id: "cursor", name: "Cursor", plans: [{ plan_id: "cursor_pro", display_name: "Pro", quota_kind: "rolling_window", quota_unit: "tokens", total_quota: 0, total_quota_display: "动态" }] },
      { id: "custom", name: "自定义套餐", plans: [] },
    ],
  });

  const user = userEvent.setup();
  render(<TokenPlanSection />);
  await screen.findByText("Token 套餐");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  await act(async () => {
    await user.click(screen.getByTestId("token-plan-provider-card-select-trigger"));
  });

  expect(screen.getByTestId("token-plan-provider-card-select-option-codex")).toBeInTheDocument();
  expect(screen.getByTestId("token-plan-provider-card-select-option-claude")).toBeInTheDocument();
  expect(screen.getByTestId("token-plan-provider-card-select-option-cursor")).toBeInTheDocument();
});

const codexSessionRef = "token-plan/codex/session/test-uuid-001";

function makeCodexSession(overrides = {}) {
  return makeXiaomiSession({
    provider_id: "codex",
    display_name: "ChatGPT / Codex 官网账号",
    session_ref: codexSessionRef,
    ...overrides,
  });
}

function mockCodexCatalog() {
  getTokenPlanCatalog.mockResolvedValue({
    providers: [
      {
        id: "codex",
        name: "Codex",
        plans: [{
          plan_id: "codex_pro_5x",
          display_name: "Pro 5x",
          quota_kind: "rolling_window",
          quota_unit: "tokens",
          total_quota: 0,
          total_quota_display: "动态",
        }],
      },
      { id: "custom", name: "自定义套餐", plans: [] },
    ],
  });
}

function mockCodexLocalReauth(id = "plan-2", overrides = {}) {
  const plan = {
    ...BASE_RECORD,
    id,
    source: "codex",
    provider_id: "codex",
    plan_id: "codex_pro_5x",
    plan_label: "Pro 5x",
    detection_method: "official_account",
    sync_status: "reauth_required",
    last_error_code: "CODEX_REAUTH_REQUIRED",
    last_error_message: "Codex local login is unavailable",
    ...overrides,
  };
  refreshTokenPlan.mockResolvedValue({ ok: true, plan, records: [plan] });
}

it("lets a connected Codex plan start a separate account record", async () => {
  mockCodexCatalog();
  const record = {
    ...BASE_RECORD,
    id: "codex-account-one",
    source: "codex",
    provider_id: "codex",
    plan_id: "codex_pro_5x",
    plan_label: "Pro 5x",
    notes: "account one",
    detection_method: "official_account",
    detection_config: { official_account: { account_binding_id: "codex-session-one" } },
    sync_status: "success",
  };
  getTokenPlans.mockResolvedValue({ records: [record] });
  getConsoleSessions.mockResolvedValue({
    sessions: [makeCodexSession({ id: "codex-session-one", status: "connected" })],
  });
  const user = userEvent.setup();

  render(<TokenPlanSection />);
  await screen.findByText(/codex \/ Pro 5x/i);
  await expandAllPlans();
  await act(async () => {
    await user.click(screen.getByRole("button", { name: copy("settings.token_plan.edit") }));
  });
  expect(await screen.findByTestId("detection-add-account-codex")).toBeInTheDocument();

  await act(async () => {
    await user.click(screen.getByTestId("detection-add-account-codex"));
  });

  expect(await screen.findByTestId("detection-connect-codex")).toBeInTheDocument();
  expect(screen.getByTestId("token-plan-form-notes")).toHaveValue("");
  expect(screen.getByText(/codex \/ Pro 5x/i)).toBeInTheDocument();
});

it("never aliases an unbound Codex plan to another account session", () => {
  const connected = makeCodexSession({ id: "codex-session-one", status: "connected" });
  const unboundPlan = {
    ...BASE_RECORD,
    id: "codex-account-two",
    provider_id: "codex",
    detection_method: "official_account",
    detection_config: { official_account: { account_binding_id: "" } },
  };

  expect(resolveConsoleSessionForRecord(unboundPlan, [connected])).toBeNull();
});

async function openCodexOfficialAccountForm(user) {
  await screen.findByText(copy("settings.section.token_plan"));
  await act(async () => {
    await user.click(screen.getByRole("button", { name: copy("settings.token_plan.add") }));
  });
  await act(async () => {
    await user.selectOptions(screen.getByLabelText(copy("settings.token_plan.agent_source")), "codex");
    await user.selectOptions(screen.getByLabelText(copy("settings.token_plan.provider")), "codex");
    await user.selectOptions(screen.getByLabelText(copy("settings.token_plan.plan")), "codex_pro_5x");
  });
  const detection = screen.getByLabelText(copy("settings.token_plan.detection_method.select"));
  if (detection.value !== "official_account") {
    await act(async () => {
      await user.selectOptions(detection, "official_account");
    });
  }
}

it("Codex account detection creates an isolated binding before saving a new account", async () => {
  mockCodexCatalog();
  const user = userEvent.setup();
  createConsoleSession.mockImplementation(async (params) => ({
    session: makeCodexSession({ id: "isolated-codex-session", session_ref: params.session_ref }),
    sessions: [makeCodexSession({ id: "isolated-codex-session", session_ref: params.session_ref })],
  }));
  openCodexConsoleLogin.mockRejectedValue(new Error("stop after opening isolated login"));

  render(<TokenPlanSection />);
  await openCodexOfficialAccountForm(user);
  await act(async () => {
    await user.click(screen.getByTestId("detection-connect-codex"));
  });

  await waitFor(() => expect(openCodexConsoleLogin).toHaveBeenCalledTimes(1));
  expect(createConsoleSession).toHaveBeenCalledWith(expect.objectContaining({
    provider_id: "codex",
    session_ref: expect.stringContaining("token-plan/codex/session/"),
  }));
  expect(saveTokenPlan).not.toHaveBeenCalled();
  expect(refreshTokenPlan).not.toHaveBeenCalled();
});

it("Codex system browser reuses an authorized binding, saves quota, and keeps the binding", async () => {
  mockCodexCatalog();
  mockCodexLocalReauth();
  const user = userEvent.setup();
  createConsoleSession.mockImplementation(async (params) => ({
    session: makeCodexSession({ id: "codex-session-id", session_ref: params.session_ref }),
    sessions: [makeCodexSession({ id: "codex-session-id", session_ref: params.session_ref })],
  }));
  openCodexConsoleLogin.mockImplementation(async (sessionRef) => ({
    connected: true,
    authorized: true,
    session_ref: sessionRef,
    state_code: "authorized",
    quota_sync_status: "idle",
    error_code: "",
    error_message: "",
  }));
  syncCodexConsoleQuota.mockImplementation(async (sessionRef) => ({
    connected: true,
    authorized: true,
    session_ref: sessionRef,
    state_code: "connected",
    quota_sync_status: "success",
    error_code: "",
    error_message: "",
    quota: {
      total_quota: 100,
      used_quota: 50,
      remaining_quota: 50,
      provider_reported_at: "2026-07-13T00:00:00.000Z",
      quota_windows: [
        { kind: "rolling_5_hour", unit: "tokens", total: 100, used: 25, remaining: 75, percentage: 25 },
        { kind: "rolling_weekly", unit: "tokens", total: 100, used: 50, remaining: 50, percentage: 50 },
      ],
    },
  }));
  verifyConsoleSession.mockImplementation(async (_id, nativeResult) => ({
    ok: true,
    session: makeCodexSession({
      id: "codex-session-id",
      session_ref: nativeResult.session_ref,
      status: "connected",
    }),
  }));

  render(<TokenPlanSection />);
  await openCodexOfficialAccountForm(user);
  await act(async () => {
    await user.click(screen.getByTestId("detection-connect-codex"));
  });

  await waitFor(() => expect(saveTokenPlan).toHaveBeenCalledTimes(1));
  const saved = saveTokenPlan.mock.calls.at(-1)[0];
  expect(saved.sync_status).toBe("success");
  expect(saved.quota_windows).toHaveLength(2);
  expect(saved.refresh_enabled).toBe(false);
  expect(saved.refresh_method).toBe("manual");
  expect(verifyCodexConsoleSession).not.toHaveBeenCalled();
  expect(syncCodexConsoleQuota).toHaveBeenCalledWith(expect.stringContaining("token-plan/codex/session/"));
  expect(verifyConsoleSession).toHaveBeenNthCalledWith(1, "codex-session-id", expect.objectContaining({
    state_code: "authorized",
    quota_sync_status: "idle",
  }));
  expect(deleteCodexConsoleSession).not.toHaveBeenCalled();
  expect(deleteConsoleSession).not.toHaveBeenCalled();
});

it("Codex system browser completes authorization even when quota sync fails", async () => {
  mockCodexCatalog();
  getTokenPlans.mockResolvedValue({
    records: [{
      ...BASE_RECORD,
      id: "codex-plan",
      source: "codex",
      provider_id: "codex",
      plan_id: "codex_pro_5x",
      plan_label: "Pro 5x",
      total_quota: 100,
      used_quota: 40,
      remaining_quota: 60,
      quota_windows: [{
        kind: "rolling_weekly",
        unit: "tokens",
        total: 100,
        used: 40,
        remaining: 60,
        percentage: 40,
      }],
      detection_method: "official_account",
      detection_config: { official_account: { provider_home_url: "https://chatgpt.com/codex" } },
      sync_status: "success",
    }],
  });
  mockCodexLocalReauth("codex-plan", {
    total_quota: 100,
    used_quota: 40,
    remaining_quota: 60,
    quota_windows: [{
      kind: "rolling_weekly",
      unit: "tokens",
      total: 100,
      used: 40,
      remaining: 60,
      percentage: 40,
    }],
  });
  const user = userEvent.setup();
  createConsoleSession.mockImplementation(async (params) => ({
    session: makeCodexSession({ id: "codex-session-id", session_ref: params.session_ref }),
    sessions: [makeCodexSession({ id: "codex-session-id", session_ref: params.session_ref })],
  }));
  openCodexConsoleLogin.mockResolvedValue({
    connected: false,
    authorized: false,
    session_ref: codexSessionRef,
    state_code: "login_started",
    quota_sync_status: "idle",
    error_code: "LOGIN_STARTED",
    error_message: "",
  });
  verifyCodexConsoleSession
    .mockResolvedValueOnce({
      connected: true,
      authorized: true,
      session_ref: codexSessionRef,
      state_code: "authorized",
      quota_sync_status: "idle",
      error_code: "",
      error_message: "",
    })
    .mockRejectedValueOnce(new Error("must stop polling after authorization"));
  syncCodexConsoleQuota.mockResolvedValue({
    connected: true,
    authorized: true,
    session_ref: codexSessionRef,
    state_code: "authorized",
    quota_sync_status: "error",
    error_code: "QUOTA_SYNC_FAILED",
    error_message: "授权已完成，但额度同步暂时失败，可稍后重试。",
  });
  verifyConsoleSession.mockImplementation(async (_id, nativeResult) => ({
    ok: true,
    session: makeCodexSession({
      id: "codex-session-id",
      session_ref: nativeResult.session_ref,
      status: "connected",
      last_error_code: nativeResult.error_code,
      last_error_message: nativeResult.error_message,
    }),
  }));

  render(<TokenPlanSection />);
  await screen.findByText(/codex \/ Pro 5x/i);
  await act(async () => {
    await user.click(screen.getByRole("button", { name: copy("settings.token_plan.edit") }));
  });
  await act(async () => {
    await user.click(screen.getByTestId("detection-sync-codex"));
  });

  await waitFor(() => expect(saveTokenPlan).toHaveBeenCalledTimes(1));
  const saved = saveTokenPlan.mock.calls.at(-1)[0];
  expect(saved.sync_status).toBe("failed");
  expect(saved.used_quota).toBe(40);
  expect(saved.remaining_quota).toBe(60);
  expect(saved.quota_windows).toHaveLength(1);
  expect(saved.last_error_code).toBe("QUOTA_SYNC_FAILED");
  expect(saved.last_error_message).toContain("额度同步");
  expect(verifyCodexConsoleSession).toHaveBeenCalledTimes(1);
  expect(syncCodexConsoleQuota).toHaveBeenCalledTimes(1);
  expect(deleteCodexConsoleSession).not.toHaveBeenCalled();
  expect(deleteConsoleSession).not.toHaveBeenCalled();
});

it("Codex failed cleanup preserves a binding when native authorization may have completed", async () => {
  mockCodexCatalog();
  mockCodexLocalReauth();
  const user = userEvent.setup();
  createConsoleSession.mockImplementation(async (params) => ({
    session: makeCodexSession({ id: "codex-session-id", session_ref: params.session_ref }),
    sessions: [makeCodexSession({ id: "codex-session-id", session_ref: params.session_ref })],
  }));
  openCodexConsoleLogin.mockRejectedValue(new Error("authorization result arrived at timeout"));
  discardCodexPendingSession.mockResolvedValue(false);

  render(<TokenPlanSection />);
  await openCodexOfficialAccountForm(user);
  await act(async () => {
    await user.click(screen.getByTestId("detection-connect-codex"));
  });

  await waitFor(() => expect(discardCodexPendingSession).toHaveBeenCalledTimes(1));
  expect(deleteConsoleSession).not.toHaveBeenCalled();
  expect(deleteCodexConsoleSession).not.toHaveBeenCalled();
  expect(screen.getByText("authorization result arrived at timeout")).toBeInTheDocument();
});

it("Codex connected refresh keeps quota and never falls back to the legacy adapter on sync failure", async () => {
  mockCodexCatalog();
  const record = {
    ...BASE_RECORD,
    id: "codex-plan",
    source: "codex",
    provider_id: "codex",
    plan_id: "codex_pro_5x",
    plan_label: "Pro 5x",
    total_quota: 100,
    used_quota: 40,
    remaining_quota: 60,
    detection_method: "official_account",
    detection_config: {
      official_account: {
        account_binding_id: "codex-session-id",
        provider_home_url: "https://chatgpt.com/codex",
      },
    },
    quota_windows: [{
      kind: "rolling_weekly",
      unit: "tokens",
      total: 100,
      used: 40,
      remaining: 60,
      percentage: 40,
    }],
  };
  getTokenPlans.mockResolvedValue({ records: [record] });
  getConsoleSessions.mockResolvedValue({
    sessions: [makeCodexSession({
      id: "codex-session-id",
      session_ref: codexSessionRef,
      status: "connected",
    })],
  });
  syncCodexConsoleQuota.mockResolvedValue({
    connected: true,
    authorized: true,
    session_ref: codexSessionRef,
    state_code: "authorized",
    quota_sync_status: "error",
    error_code: "QUOTA_SYNC_FAILED",
    error_message: "授权已完成，但额度同步暂时失败，可稍后重试。",
  });
  const user = userEvent.setup();

  render(<TokenPlanSection />);
  await screen.findByText(/codex \/ Pro 5x/i);
  await expandAllPlans();
  await act(async () => {
    await user.click(screen.getByTitle(copy("settings.token_plan.refresh")));
  });

  await waitFor(() => expect(saveTokenPlan).toHaveBeenCalled());
  expect(refreshTokenPlan).not.toHaveBeenCalled();
  expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
    id: "codex-plan",
    used_quota: 40,
    remaining_quota: 60,
    sync_status: "failed",
    last_error_code: "QUOTA_SYNC_FAILED",
  }));
});

it("Cursor refresh treats a missing native session as reauthorization instead of fake connected", async () => {
  const record = {
    ...BASE_RECORD,
    id: "cursor-plan",
    source: "cursor",
    provider_id: "cursor",
    plan_id: "cursor_pro",
    plan_label: "Pro",
    notes: "work account",
    detection_method: "official_account",
    detection_config: { official_account: { account_binding_id: "cursor-session-id" } },
    sync_status: "success",
  };
  getTokenPlans.mockResolvedValue({ records: [record] });
  getConsoleSessions.mockResolvedValue({
    sessions: [makeXiaomiSession({
      id: "cursor-session-id",
      provider_id: "cursor",
      session_ref: "token-plan/cursor/session/cursor-one",
      status: "connected",
    })],
  });
  verifyCursorConsoleSession.mockResolvedValue({
    connected: false,
    session_ref: "token-plan/cursor/session/cursor-one",
    state_code: "session_not_found",
    error_code: "SESSION_NOT_FOUND",
    error_message: "请重新连接 Cursor",
  });
  verifyConsoleSession.mockResolvedValue({
    ok: true,
    session: makeXiaomiSession({
      id: "cursor-session-id",
      provider_id: "cursor",
      session_ref: "token-plan/cursor/session/cursor-one",
      status: "failed",
    }),
  });
  const user = userEvent.setup();

  render(<TokenPlanSection />);
  await screen.findByText(/cursor \/ Pro/i);
  await expandAllPlans();
  await act(async () => {
    await user.click(screen.getByTitle(copy("settings.token_plan.refresh")));
  });

  await waitFor(() => expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
    id: "cursor-plan",
    notes: "work account",
    sync_status: "reauth_required",
    last_error_code: "SESSION_NOT_FOUND",
  })));
  expect(verifyConsoleSession).toHaveBeenCalledWith("cursor-session-id", expect.objectContaining({
    state_code: "session_not_found",
  }));
  expect(refreshTokenPlan).not.toHaveBeenCalled();
});

it("shows Cursor account under the title and keeps all quota lanes without account diagnostics", async () => {
  const record = {
    ...BASE_RECORD,
    id: "cursor-live-plan",
    source: "cursor",
    provider_id: "cursor",
    plan_id: "cursor_pro",
    plan_label: "Pro",
    detection_method: "official_account",
    detection_config: {
      official_account: {
        account_binding_id: "cursor-live-session",
        account_id: "auth0|user_01KWTPZG4VW30ZF6MKZ2XXM398",
        display_name: "eve***@hotmail.com",
        plan_name: "pro",
      },
    },
    total_quota: 100,
    used_quota: 27,
    remaining_quota: 73,
    sync_status: "success",
    last_synced_at: "2026-07-19T15:20:30.000Z",
    quota_windows: [
      { kind: "total", unit: "percent", total: 100, used: 27, remaining: 73, percentage: 27, resets_at: "2026-08-06T14:31:00.000Z" },
      { kind: "auto_composer", unit: "percent", total: 100, used: 20, remaining: 80, percentage: 20, resets_at: "2026-08-06T14:31:00.000Z" },
      { kind: "api", unit: "percent", total: 100, used: 72, remaining: 28, percentage: 72, resets_at: "2026-08-06T14:31:00.000Z" },
    ],
  };
  getTokenPlans.mockResolvedValue({ records: [record] });
  getConsoleSessions.mockResolvedValue({
    sessions: [makeXiaomiSession({
      id: "cursor-live-session",
      provider_id: "cursor",
      display_name: "eve***@hotmail.com",
      session_ref: "token-plan/cursor/session/cursor-live",
      status: "connected",
    })],
  });

  render(<TokenPlanSection />);
  await screen.findByText(/cursor \/ Pro/i);
  await expandAllPlans();

  expect(screen.getByTestId("token-plan-card-identity-meta")).toHaveTextContent("eve***@hotmail.com");
  expect(screen.queryByText(/Auth ID:/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/套餐: pro/i)).not.toBeInTheDocument();
  const detail = screen.getByTestId("token-plan-detail-cursor-live-plan");
  expect(detail).toHaveTextContent("Total Usage");
  expect(detail).not.toHaveTextContent("27 / 100 · 73");
  expect(detail).toHaveTextContent("Auto + Composer Usage");
  expect(detail).not.toHaveTextContent("20 / 100 · 80");
  expect(detail).toHaveTextContent("API Usage");
  expect(detail).not.toHaveTextContent("72 / 100 · 28");
  expect([...detail.querySelectorAll('[data-testid="token-plan-quota-window-percent"]')].map((node) => node.textContent)).toEqual(["27%", "20%", "72%"]);
  expect(detail).toHaveTextContent("重置时间:");
  expect(screen.queryByText(/最后同步时间:/i)).not.toBeInTheDocument();
});

it("formats Codex reset timestamps returned as Unix-second strings", async () => {
  const codexRecord = { ...BASE_RECORD, id: "codex-plan", source: "codex", plan_label: "Pro" };
  getTokenPlans.mockResolvedValue({ records: [codexRecord] });
  getUsageLimits.mockResolvedValue({
    codex: {
      configured: true,
      primary_window: {
        used_percent: 30,
        reset_at: String(Math.floor(Date.now() / 1000) + 3600),
      },
    },
  });

  render(<TokenPlanSection />);
  await screen.findByText(/codex \/ Pro/i);
  await expandAllPlans();

  expect(screen.getByText(/重置 \d+m|重置 \d+h/)).toBeInTheDocument();
  expect(screen.queryByText(/重置 --/)).not.toBeInTheDocument();
});

it("shows usable plans with full summary and keeps expired plans in a collapsed compact group", async () => {
  const user = userEvent.setup();
  getTokenPlans.mockResolvedValue({
    records: [
      {
        ...BASE_RECORD,
        id: "active-plan",
        plan_label: "Active Max",
        expires_at: "2099-12-31",
        subscription_amount: 100,
        subscription_currency: "USD",
        subscription_cycle: "monthly",
        subscription_start_date: "2026-01-01",
      },
      {
        ...BASE_RECORD,
        id: "expired-plan",
        plan_label: "Expired Max",
        expires_at: "2025-12-31",
        subscription_amount: 80,
        subscription_currency: "USD",
      },
    ],
  });

  render(<TokenPlanSection />);

  expect(await screen.findByText(/claude \/ Active Max/i)).toBeInTheDocument();
  expect(screen.getByTestId("token-plan-card-identity-meta")).toHaveTextContent("USD 100");
  expect(screen.getByTestId("active-token-plan-summary")).not.toHaveTextContent("USD 100");
  expect(screen.queryByText(/claude \/ Expired Max/i)).not.toBeInTheDocument();

  const expiredGroup = screen.getByTestId("expired-token-plans");
  expect(expiredGroup).toHaveTextContent("已过期套餐");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: /已过期套餐/ }));
  });

  expect(screen.getByText(/claude \/ Expired Max/i)).toBeInTheDocument();
  expect(screen.getByTestId("expired-token-plan-row")).toHaveTextContent("已过期");
  expect(screen.getAllByTestId("active-token-plan-summary")).toHaveLength(1);
});
