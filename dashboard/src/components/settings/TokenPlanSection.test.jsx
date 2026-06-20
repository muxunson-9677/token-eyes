import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TokenPlanSection } from "./TokenPlanSection.jsx";
import { getTokenPlans, saveTokenPlan, refreshTokenPlan } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getTokenPlans: vi.fn(),
  saveTokenPlan: vi.fn(),
  refreshTokenPlan: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
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
});

it("loads, edits, and saves manual token plan records", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  expect(await screen.findByText("Token 套餐")).toBeInTheDocument();
  await screen.findByText(/claude \/ Max/i);
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
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "立即刷新" }));
  });

  await waitFor(() => {
    expect(refreshTokenPlan).toHaveBeenCalledWith("plan-1");
  });
});
