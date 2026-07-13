import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSpendRecord,
  deleteSpendRecord,
  getSpendRecords,
  updateSpendRecord,
} from "../../lib/api";
import { OtherAiSpendSection } from "./OtherAiSpendSection.jsx";

vi.mock("../../lib/api", () => ({
  createSpendRecord: vi.fn(),
  deleteSpendRecord: vi.fn(),
  getSpendRecords: vi.fn(),
  updateSpendRecord: vi.fn(),
}));

vi.mock("../../lib/copy", () => ({
  copy: (key) => key,
}));

vi.mock("./Controls.jsx", () => ({
  SectionCard: ({ title, subtitle, action, children }) => (
    <section>
      <h2>{title}</h2>
      <p>{subtitle}</p>
      {action}
      {children}
    </section>
  ),
}));

const OTHER_AI_RECORD = {
  id: "other-ai-1",
  source: "other_ai",
  plan_label: "被封账号历史充值",
  amount: 72,
  currency: "CNY",
  billing_cycle: "one_time",
  start_date: "2026-07-10",
  note: "账号被封，余额无法退回",
};

describe("OtherAiSpendSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpendRecords.mockResolvedValue({ records: [] });
    createSpendRecord.mockResolvedValue({ ok: true });
    updateSpendRecord.mockResolvedValue({ ok: true });
    deleteSpendRecord.mockResolvedValue({ ok: true });
  });

  it("loads only the reserved other_ai source and renders saved notes", async () => {
    getSpendRecords.mockResolvedValue({
      records: [OTHER_AI_RECORD, { ...OTHER_AI_RECORD, id: "wrong", source: "claude" }],
    });

    render(<OtherAiSpendSection />);

    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    expect(getSpendRecords.mock.calls[0][0]).toEqual(expect.objectContaining({
      from: "2000-01-01",
      sources: ["other_ai"],
    }));
    expect(await screen.findByText("被封账号历史充值")).toBeInTheDocument();
    expect(screen.getByText("账号被封，余额无法退回")).toBeInTheDocument();
    expect(screen.queryByText("wrong")).not.toBeInTheDocument();
  });

  it("creates a one-time other_ai charge with amount, currency, date, and note", async () => {
    const user = userEvent.setup();
    render(<OtherAiSpendSection />);
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "settings.cost.other_ai.add" }));
    await user.type(screen.getByLabelText("settings.cost.other_ai.name_label"), "历史充值损失");
    await user.type(screen.getByLabelText("settings.cost.other_ai.amount_label"), "120");
    await user.selectOptions(screen.getByLabelText("settings.cost.other_ai.currency_label"), "USD");
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.date_label"), {
      target: { value: "2026-07-12" },
    });
    await user.type(screen.getByLabelText("settings.cost.other_ai.note_label"), "旧账号已封禁");
    await user.click(screen.getByRole("button", { name: "settings.cost.other_ai.save" }));

    await waitFor(() => expect(createSpendRecord).toHaveBeenCalledTimes(1));
    expect(createSpendRecord).toHaveBeenCalledWith({
      source: "other_ai",
      plan_label: "历史充值损失",
      amount: 120,
      currency: "USD",
      billing_cycle: "one_time",
      start_date: "2026-07-12",
      note: "旧账号已封禁",
    });
    expect(updateSpendRecord).not.toHaveBeenCalled();
  });

  it("requires name, positive amount, and spend date before saving", async () => {
    const user = userEvent.setup();
    render(<OtherAiSpendSection />);
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "settings.cost.other_ai.add" }));
    await user.type(screen.getByLabelText("settings.cost.other_ai.name_label"), "历史充值");
    await user.type(screen.getByLabelText("settings.cost.other_ai.amount_label"), "10");
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.date_label"), {
      target: { value: "" },
    });
    await user.click(screen.getByRole("button", { name: "settings.cost.other_ai.save" }));

    expect(await screen.findByText("settings.cost.other_ai.error_required")).toBeInTheDocument();
    expect(createSpendRecord).not.toHaveBeenCalled();
  });

  it("edits an existing record without changing its reserved accounting type", async () => {
    const user = userEvent.setup();
    getSpendRecords.mockResolvedValue({ records: [OTHER_AI_RECORD] });
    render(<OtherAiSpendSection />);

    await user.click(await screen.findByRole("button", { name: "settings.cost.other_ai.edit" }));
    const nameInput = screen.getByLabelText("settings.cost.other_ai.name_label");
    await user.clear(nameInput);
    await user.type(nameInput, "修正后的充值记录");
    const amountInput = screen.getByLabelText("settings.cost.other_ai.amount_label");
    await user.clear(amountInput);
    await user.type(amountInput, "144");
    await user.click(screen.getByRole("button", { name: "settings.cost.other_ai.save" }));

    await waitFor(() => expect(updateSpendRecord).toHaveBeenCalledTimes(1));
    expect(updateSpendRecord).toHaveBeenCalledWith(expect.objectContaining({
      id: "other-ai-1",
      source: "other_ai",
      plan_label: "修正后的充值记录",
      amount: 144,
      billing_cycle: "one_time",
    }));
    expect(createSpendRecord).not.toHaveBeenCalled();
  });

  it("deletes a confirmed record and reloads the list", async () => {
    const user = userEvent.setup();
    getSpendRecords.mockResolvedValue({ records: [OTHER_AI_RECORD] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<OtherAiSpendSection />);

    await user.click(await screen.findByRole("button", { name: "settings.cost.other_ai.delete" }));

    await waitFor(() => expect(deleteSpendRecord).toHaveBeenCalledWith("other-ai-1"));
    expect(getSpendRecords).toHaveBeenCalledTimes(2);
    confirmSpy.mockRestore();
  });
});
