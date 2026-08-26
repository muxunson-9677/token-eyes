import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TokenPlanSection, paginateTokenPlans, tokenPlanDisplayStatus } from "./TokenPlanSection.jsx";
import { deleteTokenPlan, getTokenPlans, saveTokenPlan, refreshTokenPlan, getUsageLimits, getTokenPlanCatalog, getConsoleSessions, saveTokenPlanSecret, reorderTokenPlans, verifyCursorConsoleSession } from "../../lib/api";
import { clearCostSettingsSessionCache } from "../../lib/cost-settings-session-cache";

vi.mock("../../lib/api", () => ({
  getTokenPlans: vi.fn(),
  saveTokenPlan: vi.fn(),
  refreshTokenPlan: vi.fn(),
  getUsageLimits: vi.fn(),
  getTokenPlanCatalog: vi.fn(),
  getConsoleSessions: vi.fn(),
  verifyClaudeConsoleSession: vi.fn(),
  verifyCursorConsoleSession: vi.fn(),
  verifyTraeConsoleSession: vi.fn(),
  verifyKimiConsoleSession: vi.fn(),
  saveTokenPlanSecret: vi.fn(),
  reorderTokenPlans: vi.fn(),
  deleteTokenPlan: vi.fn(),
}));

const RECORD = {
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
  notes: "只在展开后出现的备注",
  sync_status: "success",
};

function formatLocalDateTime(value) {
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function expandPlan(planLabel) {
  const cards = await screen.findAllByTestId("token-plan-card");
  const card = cards.find((candidate) => candidate.textContent.includes(planLabel));
  expect(card).toBeDefined();
  expect(card).toHaveAttribute("data-expanded", "true");
  expect(within(card).queryByRole("button", { name: `展开 ${planLabel}` })).not.toBeInTheDocument();
  expect(within(card).queryByRole("button", { name: `收起 ${planLabel}` })).not.toBeInTheDocument();
  return card;
}

beforeEach(() => {
  clearCostSettingsSessionCache();
  vi.clearAllMocks();
  window.localStorage.setItem(
    "token-eyes.settings.disclosure.cost.token-plans.v1",
    "1",
  );
  getTokenPlans.mockResolvedValue({ records: [{ ...RECORD }] });
  saveTokenPlan.mockResolvedValue({ ok: true, records: [{ ...RECORD }] });
  refreshTokenPlan.mockResolvedValue({ ok: true, records: [{ ...RECORD }] });
  getUsageLimits.mockResolvedValue({ codex: { configured: false } });
  getTokenPlanCatalog.mockResolvedValue({ providers: [] });
  getConsoleSessions.mockResolvedValue({ sessions: [] });
  verifyCursorConsoleSession.mockResolvedValue({ connected: false });
  saveTokenPlanSecret.mockResolvedValue({ ok: true });
  reorderTokenPlans.mockResolvedValue({ ok: true, records: [{ ...RECORD }] });
  deleteTokenPlan.mockResolvedValue({ ok: true, records: [] });
});

it("reuses confirmed plans and catalog when the cost page is entered again", async () => {
  const first = render(<TokenPlanSection listOnly />);
  expect(await screen.findByText("1 个套餐")).toBeInTheDocument();
  await waitFor(() => expect(getTokenPlans).toHaveBeenCalledTimes(1));
  first.unmount();

  render(React.createElement(TokenPlanSection, { listOnly: true }));
  expect(screen.getByText("1 个套餐")).toBeInTheDocument();
  expect(getTokenPlans).toHaveBeenCalledTimes(1);
  expect(getTokenPlanCatalog).toHaveBeenCalledTimes(1);
});

it("classifies active, attention, and expired plans and paginates ten cards at a time", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");
  expect(tokenPlanDisplayStatus({ ...RECORD }, now)).toEqual({ kind: "active", reasons: [] });
  expect(tokenPlanDisplayStatus({ ...RECORD, expires_at: "2026-08-20" }, now)).toEqual({ kind: "attention", reasons: ["expiring"] });
  expect(tokenPlanDisplayStatus({ ...RECORD, used_quota: 800, remaining_quota: 200 }, now)).toEqual({ kind: "attention", reasons: ["usage"] });
  expect(tokenPlanDisplayStatus({
    ...RECORD,
    quota_windows: [
      { kind: "rolling_5_hour", total: 100, used: 20, remaining: 80 },
      { kind: "rolling_weekly", total: 100, used: 85, remaining: 15 },
    ],
  }, now)).toEqual({ kind: "attention", reasons: ["usage"] });
  expect(tokenPlanDisplayStatus({
    ...RECORD,
    source: "cursor",
    quota_windows: [
      { kind: "total", total: 100, used: 20, remaining: 80 },
      { kind: "auto_composer", percentage: 82 },
    ],
  }, now)).toEqual({ kind: "attention", reasons: ["usage"] });
  expect(tokenPlanDisplayStatus({ ...RECORD, sync_status: "error" }, now)).toEqual({ kind: "attention", reasons: ["sync"] });
  expect(tokenPlanDisplayStatus({ ...RECORD, sync_status: "success", last_refresh_status: "failed" }, now)).toEqual({ kind: "attention", reasons: ["sync"] });
  expect(tokenPlanDisplayStatus({ ...RECORD, sync_status: "reauth_required" }, now)).toEqual({ kind: "attention", reasons: ["sync"] });
  expect(tokenPlanDisplayStatus({ ...RECORD, expires_at: "2026-08-14" }, now)).toEqual({ kind: "expired", reasons: ["expired"] });

  const plans = Array.from({ length: 11 }, (_, index) => ({ id: `plan-${index + 1}` }));
  expect(paginateTokenPlans(plans, 0)).toMatchObject({ page: 0, pageCount: 2, records: plans.slice(0, 10) });
  expect(paginateTokenPlans(plans, 1)).toMatchObject({ page: 1, pageCount: 2, records: plans.slice(10) });
});

it("shows usable plans as status cards and advances after ten cards", async () => {
  const user = userEvent.setup();
  const expiringAt = new Date(Date.now() + (3 * 24 * 60 * 60 * 1000)).toISOString();
  const records = Array.from({ length: 11 }, (_, index) => ({
    ...RECORD,
    id: `page-plan-${index + 1}`,
    plan_label: `Plan ${index + 1}`,
    expires_at: index === 0 ? expiringAt : "2099-12-31",
    used_quota: index === 1 ? 850 : 200,
    remaining_quota: index === 1 ? 150 : 800,
    sync_status: index === 2 ? "error" : "success",
  }));
  expect(records.slice(0, 3).map((record) => tokenPlanDisplayStatus(record))).toEqual([
    { kind: "attention", reasons: ["expiring"] },
    { kind: "attention", reasons: ["usage"] },
    { kind: "attention", reasons: ["sync"] },
  ]);
  getTokenPlans.mockResolvedValue({ records });

  render(<TokenPlanSection />);

  const cards = await screen.findAllByTestId("token-plan-card");
  expect(cards).toHaveLength(10);
  expect(screen.getByTestId("active-token-plan-grid").style.getPropertyValue("--tt-token-plan-columns")).toBe("5");
  for (const [index, expectedStatus] of ["attention", "attention", "attention", "active"].entries()) {
    expect(within(cards[index]).getByTestId("token-plan-status"))
      .toHaveAttribute("data-status", expectedStatus);
  }
  expect(screen.getByText("第 1 / 2 页")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "下一页" }));

  expect(screen.getAllByTestId("token-plan-card")).toHaveLength(1);
  expect(screen.getByText(/Plan 11/i)).toBeInTheDocument();
  expect(screen.getByText("第 2 / 2 页")).toBeInTheDocument();
});

it("defaults the whole Token plan section closed and persists expansion", async () => {
  const user = userEvent.setup();
  window.localStorage.removeItem("token-eyes.settings.disclosure.cost.token-plans.v1");
  render(<TokenPlanSection />);

  const sectionToggle = screen.getByRole("button", { name: "Token 套餐" });
  expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText(/claude \/ Max/i)).not.toBeInTheDocument();
  await user.click(sectionToggle);
  expect(sectionToggle).toHaveAttribute("aria-expanded", "true");
  expect(await screen.findByText(/claude \/ Max/i)).toBeInTheDocument();
  expect(window.localStorage.getItem("token-eyes.settings.disclosure.cost.token-plans.v1"))
    .toBe("1");
  await user.click(sectionToggle);
  expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText(/claude \/ Max/i)).not.toBeInTheDocument();
});

it("deletes a plan directly from its complete card after confirmation", async () => {
  const user = userEvent.setup();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<TokenPlanSection />);

  await expandPlan("Max");
  await user.click(await screen.findByRole("button", { name: "删除 Max" }));

  await waitFor(() => expect(deleteTokenPlan).toHaveBeenCalledWith("plan-1"));
  expect(screen.queryByText(/claude \/ Max/i)).not.toBeInTheDocument();
});

it("shows each plan's complete facts directly without a nested disclosure", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  expect(await screen.findByText(/claude \/ Max/i)).toBeInTheDocument();
  const card = screen.getByTestId("token-plan-card");
  const detail = screen.getByTestId("token-plan-detail-plan-1");
  expect(card).toHaveAttribute("data-expanded", "true");
  expect(screen.queryByRole("button", { name: "展开 Max" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "收起 Max" })).not.toBeInTheDocument();
  expect(detail).not.toHaveTextContent("200 / 1,000 · 800");
  expect(detail).not.toHaveTextContent("已用额度");
  expect(detail).not.toHaveTextContent("剩余额度");
  expect(detail).not.toHaveTextContent("总额度");
  expect(screen.getByTestId("token-plan-card-identity-meta")).toHaveTextContent("xx 元");
  expect(screen.getByTestId("token-plan-detail-plan-1")).not.toHaveTextContent("只在展开后出现的备注");
  expect(screen.getByRole("button", { name: "拖动 Max" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "编辑" }));
  expect(card).toHaveAttribute("data-expanded", "true");
  expect(screen.getByTestId("token-plan-detail-plan-1")).toBeInTheDocument();
});

it("matches the cost-and-quota card hierarchy with account, cost, detailed validity, and no sync block", async () => {
  getTokenPlans.mockResolvedValue({
    records: [{
      ...RECORD,
      source: "codex",
      provider_id: "codex",
      plan_label: "Pro 20x",
      detection_method: "official_account",
      detection_config: { official_account: { display_name: "alex@example.com" } },
      last_synced_at: "2026-08-15T11:08:56.995Z",
      subscription_amount: 99,
      subscription_currency: "CNY",
      subscription_cycle: "monthly",
      subscription_end_date: "2026-08-30T14:24:24.000Z",
      quota_source: "provider_reported",
      quota_windows: [{ kind: "rolling_weekly", used: 32, remaining: 68, total: 100 }],
    }],
  });
  render(<TokenPlanSection />);

  await expandPlan("Pro 20x");
  const card = await screen.findByTestId("token-plan-card");
  expect(card).toHaveClass("tt-token-plan-card--reference");
  expect(card).toHaveClass("tt-token-service-card", "tt-surface-nested");
  expect(card.querySelector('img[src="/brand-logos/codex.svg"]')).not.toBeNull();
  const identityMeta = within(card).getByTestId("token-plan-card-identity-meta");
  expect(within(card).getByTestId("token-plan-card-copy")).toContainElement(identityMeta);
  expect(identityMeta).toHaveTextContent("ale***@example.com");
  expect(identityMeta).toHaveTextContent("99 元");
  expect(identityMeta).not.toHaveTextContent("套餐成本");
  expect(identityMeta).not.toHaveTextContent("未设置");

  const quotaWindow = within(card).getByTestId("token-plan-quota-window");
  expect(within(quotaWindow).getByTestId("token-plan-quota-window-percent")).toHaveTextContent("32%");
  expect(within(quotaWindow).queryByTestId("token-plan-quota-window-values")).not.toBeInTheDocument();
  expect(quotaWindow).not.toHaveTextContent("32 / 100 · 68");
  expect(quotaWindow).not.toHaveTextContent("已用额度");
  expect(quotaWindow).not.toHaveTextContent("剩余额度");
  expect(quotaWindow).not.toHaveTextContent("总额度");

  expect(within(card).queryByTestId("token-plan-sync-status")).not.toBeInTheDocument();
  expect(card).not.toHaveTextContent("检测方式");
  expect(card).not.toHaveTextContent("最后同步时间");
  expect(card).not.toHaveTextContent("额度来源");
  expect(card).not.toHaveTextContent("只在展开后出现的备注");

  const validity = within(card).getByTestId("token-plan-validity");
  expect(validity).toHaveTextContent(
    new RegExp(`有效期：.+${formatLocalDateTime("2026-08-30T14:24:24.000Z").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  expect(validity).toHaveClass("tt-token-plan-summary-expiry--single-line");
});

it("uses the authorized account and lets settings switch between masked and full email", async () => {
  const user = userEvent.setup();
  window.localStorage.removeItem("token-eyes.settings.token-plan.show-full-email.v1");
  getTokenPlans.mockResolvedValue({
    records: [{
      ...RECORD,
      source: "codex",
      provider_id: "codex",
      account_label: "wrong-account@example.com",
      detection_method: "official_account",
      detection_config: { official_account: { display_name: "authorized@example.com" } },
    }],
  });

  render(<TokenPlanSection />);

  const meta = await screen.findByTestId("token-plan-card-identity-meta");
  const account = meta.querySelector(".tt-token-plan-card-account");
  expect(meta).toHaveTextContent("aut***@example.com");
  expect(account).not.toHaveClass("tt-token-plan-card-account--full");
  expect(meta).not.toHaveTextContent("wrong-account@example.com");
  expect(meta).not.toHaveTextContent("authorized@example.com");

  await user.click(screen.getByRole("button", { name: "显示完整邮箱" }));

  expect(meta).toHaveTextContent("authorized@example.com");
  expect(account).toHaveClass("tt-token-plan-card-account--full");
  expect(window.localStorage.getItem("token-eyes.settings.token-plan.show-full-email.v1"))
    .toBe("1");
  expect(screen.getByRole("button", { name: "隐藏邮箱" })).toBeInTheDocument();
});

it("refreshes a connected Cursor account when showing a previously masked email", async () => {
  const user = userEvent.setup();
  window.localStorage.removeItem("token-eyes.settings.token-plan.show-full-email.v1");
  const maskedRecord = {
    ...RECORD,
    source: "cursor",
    provider_id: "cursor",
    detection_method: "official_account",
    detection_config: {
      official_account: {
        account_binding_id: "cursor-binding",
        session_ref: "cursor/session-1",
        display_name: "ale***@example.com",
      },
    },
  };
  const fullRecord = {
    ...maskedRecord,
    detection_config: {
      official_account: {
        ...maskedRecord.detection_config.official_account,
        display_name: "alex.authorized@example.com",
      },
    },
  };
  getTokenPlans
    .mockResolvedValueOnce({ records: [maskedRecord] })
    .mockResolvedValue({ records: [fullRecord] });
  getConsoleSessions.mockResolvedValue({
    sessions: [{
      id: "cursor-binding",
      provider_id: "cursor",
      status: "connected",
      session_ref: "cursor/session-1",
    }],
  });
  verifyCursorConsoleSession.mockResolvedValue({
    connected: true,
    session_ref: "cursor/session-1",
    quota: {
      account_id: "auth0|cursor-user",
      display_name: "alex.authorized@example.com",
      plan_name: "pro",
      total_quota: 100,
      used_quota: 60,
      remaining_quota: 40,
      quota_windows: [],
    },
  });

  render(<TokenPlanSection />);

  expect(await screen.findByText("ale***@example.com")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "显示完整邮箱" }));

  await waitFor(() => {
    expect(verifyCursorConsoleSession).toHaveBeenCalledWith("cursor/session-1");
    expect(screen.getByText("alex.authorized@example.com")).toBeInTheDocument();
    expect(saveTokenPlan).toHaveBeenCalledWith(expect.objectContaining({
      detection_config: expect.objectContaining({
        official_account: expect.objectContaining({
          account_id: "auth0|cursor-user",
          display_name: "alex.authorized@example.com",
        }),
      }),
    }));
  });
  expect(screen.queryByText("ale***@example.com")).not.toBeInTheDocument();
});

it("refreshes a masked Cursor email on startup when full-email mode is already enabled", async () => {
  window.localStorage.setItem("token-eyes.settings.token-plan.show-full-email.v1", "1");
  const maskedRecord = {
    ...RECORD,
    source: "cursor",
    provider_id: "cursor",
    detection_method: "official_account",
    detection_config: {
      official_account: {
        account_binding_id: "cursor-binding",
        session_ref: "cursor/session-1",
        display_name: "ale***@example.com",
      },
    },
  };
  getTokenPlans
    .mockResolvedValueOnce({ records: [maskedRecord] })
    .mockResolvedValue({
      records: [{
        ...maskedRecord,
        detection_config: {
          official_account: {
            ...maskedRecord.detection_config.official_account,
            display_name: "alex.authorized@example.com",
          },
        },
      }],
    });
  getConsoleSessions.mockResolvedValue({
    sessions: [{
      id: "cursor-binding",
      provider_id: "cursor",
      status: "connected",
      session_ref: "cursor/session-1",
    }],
  });
  verifyCursorConsoleSession.mockResolvedValue({
    connected: true,
    session_ref: "cursor/session-1",
    quota: {
      display_name: "alex.authorized@example.com",
      total_quota: 100,
      used_quota: 60,
      remaining_quota: 40,
      quota_windows: [],
    },
  });

  render(<TokenPlanSection />);

  await waitFor(() => {
    expect(verifyCursorConsoleSession).toHaveBeenCalledWith("cursor/session-1");
    expect(screen.getByText("alex.authorized@example.com")).toBeInTheDocument();
  });
  expect(screen.getByRole("button", { name: "隐藏邮箱" })).toBeInTheDocument();
});

it("renders complete quota and subscription details immediately inside each plan card", async () => {
  getTokenPlans.mockResolvedValue({
    records: [{
      ...RECORD,
      account_label: "工作账户",
      subscription_amount: 99,
      subscription_currency: "CNY",
      subscription_cycle: "monthly",
      subscription_start_date: "2026-08-01",
      subscription_end_date: "2026-09-01",
      quota_source: "provider_reported",
      quota_windows: [{ kind: "rolling_5_hour", remaining: 40, total: 50, resets_at: "2026-08-15T15:00:00Z" }],
    }],
  });
  render(<TokenPlanSection />);

  await expandPlan("Max");
  const detail = await screen.findByTestId("token-plan-detail-plan-1");
  expect(screen.getByTestId("token-plan-card-identity-meta")).toHaveTextContent("工作账户");
  expect(detail).not.toHaveTextContent("10 / 50 · 40");
  expect(within(detail).getByTestId("token-plan-quota-window-percent")).toHaveTextContent("20%");
  expect(detail).not.toHaveTextContent("已用额度");
  expect(detail).not.toHaveTextContent("剩余额度");
  expect(detail).not.toHaveTextContent("总额度");
  expect(screen.getByTestId("token-plan-card-identity-meta")).toHaveTextContent("99 元");
  expect(detail).not.toHaveTextContent("2026-08-01");
  expect(within(detail).getByTestId("token-plan-validity")).toHaveTextContent(/2026\/09\/01/);
  expect(detail).toHaveTextContent("5 小时额度");
});

it("shows every Codex and Cursor quota window with used, remaining, total, and reset details", async () => {
  getTokenPlans.mockResolvedValue({
    records: [
      {
        ...RECORD,
        id: "codex-plan",
        source: "codex",
        provider_id: "codex",
        plan_label: "Plus",
        quota_windows: [
          { kind: "rolling_5_hour", used: 32, remaining: 68, total: 100, resets_at: "2026-08-15T15:00:00Z" },
          { kind: "rolling_weekly", used: 47, remaining: 53, total: 100, resets_at: "2026-08-20T15:00:00Z" },
        ],
      },
      {
        ...RECORD,
        id: "cursor-plan",
        source: "cursor",
        provider_id: "cursor",
        plan_label: "Pro",
        quota_windows: [
          { kind: "total", used: 27, remaining: 73, total: 100, percentage: 27, resets_at: "2026-08-25T15:00:00Z" },
          { kind: "auto_composer", used: 20, remaining: 80, total: 100, percentage: 20, resets_at: "2026-08-20T15:00:00Z" },
          { kind: "api", used: 72, remaining: 28, total: 100, percentage: 72, resets_at: "2026-08-18T15:00:00Z" },
        ],
      },
    ],
  });
  render(<TokenPlanSection />);

  await expandPlan("Plus");
  await expandPlan("Pro");
  const codexDetail = await screen.findByTestId("token-plan-detail-codex-plan");
  expect(within(codexDetail).getByText("5 小时")).toBeInTheDocument();
  expect(within(codexDetail).getByText("7 天")).toBeInTheDocument();
  expect(within(codexDetail).queryByTestId("token-plan-quota-window-values")).not.toBeInTheDocument();
  expect(within(codexDetail).getAllByTestId("token-plan-quota-window-percent").map((node) => node.textContent)).toEqual(["32%", "47%"]);

  const cursorDetail = screen.getByTestId("token-plan-detail-cursor-plan");
  expect(within(cursorDetail).getByText("Total Usage")).toBeInTheDocument();
  expect(within(cursorDetail).getByText("Auto + Composer Usage")).toBeInTheDocument();
  expect(within(cursorDetail).getByText("API Usage")).toBeInTheDocument();
  expect(within(cursorDetail).queryByTestId("token-plan-quota-window-values")).not.toBeInTheDocument();
  expect(within(cursorDetail).getAllByTestId("token-plan-quota-window-percent").map((node) => node.textContent)).toEqual(["27%", "20%", "72%"]);
  expect(within(cursorDetail).getAllByRole("progressbar")).toHaveLength(3);
  expect(screen.getByTestId("active-token-plan-grid").style.getPropertyValue("--tt-token-plan-columns")).toBe("5");
  expect(within(screen.getAllByTestId("token-plan-card")[0]).getByTestId("token-plan-status"))
    .toHaveClass("tt-token-plan-status--corner");
});

it("keeps every official model window reset independent and marks missing facts unavailable", async () => {
  getTokenPlans.mockResolvedValue({
    records: [{
      ...RECORD,
      expires_at: "",
      subscription_end_date: "",
      quota_windows: [
        { kind: "rolling_5_hour", model_label: "模型 A · 5h", used: 20, remaining: 80, total: 100, resets_at: "2026-08-18T01:00:00Z" },
        { kind: "rolling_weekly", model_label: "模型 B · 7d", used: 40, remaining: 60, total: 100, resets_at: "2026-08-22T09:30:00Z" },
        { kind: "model_c_weekly", model_label: "模型 C · 7d", used: 10, remaining: 90, total: 100 },
      ],
    }],
  });
  render(<TokenPlanSection />);

  await expandPlan("Max");

  const card = screen.getByTestId("token-plan-card");
  expect(card).toHaveTextContent("模型 A · 5h");
  expect(card).toHaveTextContent("模型 B · 7d");
  expect(card).toHaveTextContent("模型 C · 7d");
  const resets = within(card).getAllByTestId("token-plan-quota-window-reset");
  expect(resets).toHaveLength(3);
  expect(resets[0].textContent).not.toBe(resets[1].textContent);
  expect(resets[2]).toHaveTextContent("官方未提供");
  expect(within(card).getByTestId("token-plan-validity")).toHaveTextContent("有效期：未设置");
});

it("maps live Codex Spark windows and Unix-second reset timestamps without duplicating Cursor totals", async () => {
  getTokenPlans.mockResolvedValue({
    records: [
      {
        ...RECORD,
        id: "live-codex",
        source: "codex",
        provider_id: "codex",
        plan_label: "Pro 20x",
        quota_windows: [
          { kind: "rolling_weekly", used: 15, remaining: 85, total: 100, percentage: 15, resets_at: "1787196800" },
          { kind: "gpt_5_3_codex_spark_weekly", used: 56, remaining: 44, total: 100, percentage: 56, resets_at: "1787198612" },
        ],
      },
      {
        ...RECORD,
        id: "live-cursor",
        source: "cursor",
        provider_id: "cursor",
        plan_label: "Pro",
        quota_windows: [
          { kind: "total", used: 100, remaining: 0, total: 100, percentage: 100, resets_at: "2026-08-22T04:17:12.000Z" },
          { kind: "rolling_weekly", used: 100, remaining: 0, total: 100, percentage: 100, resets_at: "2026-08-22T04:17:12.000Z" },
          { kind: "auto_composer", used: 60.4, remaining: 39.6, total: 100, percentage: 60.4, resets_at: "2026-08-22T04:17:12.000Z" },
          { kind: "api", used: 100, remaining: 0, total: 100, percentage: 100, resets_at: "2026-08-22T04:17:12.000Z" },
        ],
      },
    ],
  });
  render(<TokenPlanSection />);

  await expandPlan("Pro 20x");
  await expandPlan("Pro");
  const cursorCard = (await screen.findAllByTestId("token-plan-card"))
    .find((card) => card.textContent.includes("cursor / Pro"));
  expect(cursorCard).toHaveTextContent("Total Usage");
  expect(cursorCard).toHaveTextContent("Auto + Composer Usage");
  expect(cursorCard).toHaveTextContent("API Usage");
  const codexCard = (await screen.findAllByTestId("token-plan-card"))
    .find((card) => card.textContent.includes("codex / Pro 20x"));
  expect(codexCard).not.toHaveTextContent("15 / 100 · 85");
  expect(codexCard).not.toHaveTextContent("56 / 100 · 44");

  const codexDetail = await screen.findByTestId("token-plan-detail-live-codex");
  expect(within(codexDetail).getByText("7 天")).toBeInTheDocument();
  expect(within(codexDetail).getByText("GPT 5.3 Codex Spark")).toBeInTheDocument();
  expect(codexDetail).not.toHaveTextContent("Invalid Date");

  const cursorDetail = screen.getByTestId("token-plan-detail-live-cursor");
  expect(within(cursorDetail).getAllByText("Total Usage")).toHaveLength(1);
  expect(cursorDetail).not.toHaveTextContent("100 / 100 · 0");
  expect(within(cursorDetail).getByText("Auto + Composer Usage")).toBeInTheDocument();
  expect(within(cursorDetail).getByText("API Usage")).toBeInTheDocument();
});

it("moves a plan with the keyboard handle and persists the complete order", async () => {
  const user = userEvent.setup();
  const records = ["A", "B", "C"].map((label, index) => ({
    ...RECORD,
    id: `plan-${label}`,
    plan_label: label,
    display_order: index,
  }));
  getTokenPlans.mockResolvedValue({ records });
  reorderTokenPlans.mockImplementation(async (ids) => ({
    ok: true,
    records: ids.map((id, index) => ({ ...records.find((record) => record.id === id), display_order: index })),
  }));
  render(<TokenPlanSection />);

  const handle = await screen.findByRole("button", { name: "拖动 A" });
  handle.focus();
  await act(async () => {
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
  });

  await waitFor(() => expect(reorderTokenPlans).toHaveBeenCalledWith(["plan-B", "plan-A", "plan-C"]));
  expect(screen.getAllByTestId("token-plan-card").map((card) => card.textContent)).toEqual([
    expect.stringContaining("B"),
    expect.stringContaining("A"),
    expect.stringContaining("C"),
  ]);
});

it("list-only mode navigates to child editor routes without mounting the editor form", async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  render(<TokenPlanSection listOnly onNavigate={onNavigate} />);

  await screen.findByText(/claude \/ Max/i);
  await user.click(screen.getByRole("button", { name: "新增套餐" }));
  expect(onNavigate).toHaveBeenCalledWith("/settings/cost/token-plans/new");
  expect(screen.queryByLabelText("Agent 来源")).not.toBeInTheDocument();

  await expandPlan("Max");
  await user.click(screen.getByRole("button", { name: "编辑" }));
  expect(onNavigate).toHaveBeenCalledWith("/settings/cost/token-plans/plan-1/edit");
  expect(screen.queryByLabelText("Agent 来源")).not.toBeInTheDocument();
});

it("editor mode opens the shared form directly and cancel returns to cost settings", async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  render(<TokenPlanSection editorPlanId="new" onNavigate={onNavigate} />);

  expect(await screen.findByLabelText("Agent 来源")).toBeInTheDocument();
  await act(async () => {
    await user.click(screen.getAllByRole("button", { name: "取消" })[0]);
  });
  expect(onNavigate).toHaveBeenCalledWith("/settings/cost");
});

it("editor mode loads an existing plan by route ID", async () => {
  render(<TokenPlanSection editorPlanId="plan-1" onNavigate={vi.fn()} />);

  expect(await screen.findByDisplayValue("Max")).toBeInTheDocument();
  expect(screen.getByLabelText("Agent 来源")).toHaveValue("claude");
});

it("editor mode reports a missing route ID and offers a return action", async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  render(<TokenPlanSection editorPlanId="missing-plan" onNavigate={onNavigate} />);

  expect(await screen.findByText("未找到该 Token 套餐")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "返回成本设置" }));
  expect(onNavigate).toHaveBeenCalledWith("/settings/cost");
});
