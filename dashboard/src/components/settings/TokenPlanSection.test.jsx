import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TokenPlanSection } from "./TokenPlanSection.jsx";
import { getTokenPlans, saveTokenPlan } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getTokenPlans: vi.fn(),
  saveTokenPlan: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getTokenPlans.mockResolvedValue({
    records: [
      {
        id: "plan-1",
        source: "claude",
        plan_label: "Max",
        total_quota: 1000,
        used_quota: 200,
        remaining_quota: 800,
        expires_at: "2026-12-31",
      },
    ],
  });
  saveTokenPlan.mockImplementation(async (record) => ({
    ok: true,
    record: { ...record, id: record.id || "plan-2" },
    records: [{ ...record, id: record.id || "plan-2" }],
  }));
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
    expect(saveTokenPlan).toHaveBeenCalledWith({
      id: "plan-1",
      source: "claude",
      plan_label: "Max updated",
      total_quota: 1000,
      used_quota: 200,
      remaining_quota: 800,
      expires_at: "2026-12-31",
    });
  });
  expect(await screen.findByText("已保存到本地。")).toBeInTheDocument();
});
