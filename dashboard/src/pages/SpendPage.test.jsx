import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SpendPage } from "./SpendPage.jsx";
import { createSpendRecord, deleteSpendRecord, getSpendRecords } from "../lib/api";

vi.mock("../lib/api", () => ({
  createSpendRecord: vi.fn(),
  deleteSpendRecord: vi.fn(),
  getSpendRecords: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getSpendRecords.mockResolvedValue({ records: [], totals: { total_usd: 0, total_cny: 0 } });
  createSpendRecord.mockResolvedValue({
    ok: true,
    records: [
      {
        id: "spend-1",
        source: "claude",
        plan_label: "Max",
        amount: 10,
        currency: "USD",
        note: "manual",
      },
    ],
    totals: { total_usd: 10, total_cny: 72 },
  });
  deleteSpendRecord.mockResolvedValue({ records: [], totals: { total_usd: 0, total_cny: 0 } });
});

it("adds spend records and updates totals without refresh", async () => {
  const user = userEvent.setup();
  render(<SpendPage />);

  await screen.findByText(/No spend records yet/i);

  await act(async () => {
    await user.type(screen.getByLabelText(/Source/i), "claude");
    await user.type(screen.getByLabelText(/Plan label/i), "Max");
    await user.clear(screen.getByLabelText(/Amount/i));
    await user.type(screen.getByLabelText(/Amount/i), "10");
    await user.type(screen.getByLabelText(/Note/i), "manual");
  });

  await act(async () => {
    await user.click(screen.getByRole("button", { name: /Add record/i }));
  });

  await waitFor(() => {
    expect(createSpendRecord).toHaveBeenCalledWith({
      source: "claude",
      plan_label: "Max",
      amount: 10,
      currency: "USD",
      note: "manual",
    });
  });
  expect(await screen.findByText(/claude \/ Max/i)).toBeInTheDocument();
  expect(screen.getByText("USD 10.00")).toBeInTheDocument();
  expect(screen.getByText("CNY 72.00")).toBeInTheDocument();
});
