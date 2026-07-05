import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TokenPlanSection } from "./TokenPlanSection.jsx";
import { getTokenPlans, saveTokenPlan, refreshTokenPlan, getUsageLimits, getTokenPlanCatalog, getConsoleSessions, saveTokenPlanSecret } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getTokenPlans: vi.fn(),
  saveTokenPlan: vi.fn(),
  refreshTokenPlan: vi.fn(),
  getUsageLimits: vi.fn(),
  getTokenPlanCatalog: vi.fn(),
  getConsoleSessions: vi.fn(),
  saveTokenPlanSecret: vi.fn(),
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
});

it("keeps the large token plan form collapsed until the user adds a plan", async () => {
  const user = userEvent.setup();
  render(<TokenPlanSection />);

  expect(await screen.findByText(/claude \/ Max/i)).toBeInTheDocument();
  expect(screen.queryByLabelText("Agent 来源")).not.toBeInTheDocument();

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增套餐" }));
  });

  expect(screen.getByLabelText("Agent 来源")).toBeInTheDocument();
  expect(screen.getByLabelText("套餐名称")).toBeInTheDocument();
});