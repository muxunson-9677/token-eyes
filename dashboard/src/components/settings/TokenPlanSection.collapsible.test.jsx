import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TokenPlanSection } from "./TokenPlanSection.jsx";
import { deleteTokenPlan, getTokenPlans, saveTokenPlan, refreshTokenPlan, getUsageLimits, getTokenPlanCatalog, getConsoleSessions, saveTokenPlanSecret, reorderTokenPlans } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getTokenPlans: vi.fn(),
  saveTokenPlan: vi.fn(),
  refreshTokenPlan: vi.fn(),
  getUsageLimits: vi.fn(),
  getTokenPlanCatalog: vi.fn(),
  getConsoleSessions: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  getTokenPlans.mockResolvedValue({ records: [{ ...RECORD }] });
  saveTokenPlan.mockResolvedValue({ ok: true, records: [{ ...RECORD }] });
  refreshTokenPlan.mockResolvedValue({ ok: true, records: [{ ...RECORD }] });
  getUsageLimits.mockResolvedValue({ codex: { configured: false } });
  getTokenPlanCatalog.mockResolvedValue({ providers: [] });
  getConsoleSessions.mockResolvedValue({ sessions: [] });
  saveTokenPlanSecret.mockResolvedValue({ ok: true });
  reorderTokenPlans.mockResolvedValue({ ok: true, records: [{ ...RECORD }] });
  deleteTokenPlan.mockResolvedValue({ ok: true, records: [] });
});

it("collapses the whole Token plan section from its first-level heading", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  expect(await screen.findByText(/claude \/ Max/i)).toBeInTheDocument();
  const sectionToggle = screen.getByRole("button", { name: "Token 套餐" });
  expect(sectionToggle).toHaveAttribute("aria-expanded", "true");
  await user.click(sectionToggle);
  expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText(/claude \/ Max/i)).not.toBeInTheDocument();
});

it("deletes a plan from expanded details after confirmation", async () => {
  const user = userEvent.setup();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<TokenPlanSection />);

  await user.click(await screen.findByRole("button", { name: "展开 Max" }));
  await user.click(screen.getByRole("button", { name: "删除 Max" }));

  await waitFor(() => expect(deleteTokenPlan).toHaveBeenCalledWith("plan-1"));
  expect(screen.queryByText(/claude \/ Max/i)).not.toBeInTheDocument();
});

it("starts each plan collapsed and reveals details only from its named expand control", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  expect(await screen.findByText(/claude \/ Max/i)).toBeInTheDocument();
  expect(screen.getByText(/200 \/ 1,000/)).toHaveClass("text-oai-gray-500");
  expect(screen.getByText("只在展开后出现的备注")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "拖动 Max" })).toBeInTheDocument();
  const expand = screen.getByRole("button", { name: "展开 Max" });
  expect(expand).toHaveAttribute("aria-expanded", "false");

  await act(async () => {
    await user.click(expand);
  });

  expect(screen.getByRole("textbox", { name: "备注" })).toHaveValue("只在展开后出现的备注");
  expect(screen.getByRole("button", { name: "收起 Max" })).toHaveAttribute("aria-expanded", "true");
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
