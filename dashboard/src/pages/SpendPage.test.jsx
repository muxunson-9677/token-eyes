import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SpendPage } from "./SpendPage.jsx";
import { createSpendRecord, deleteSpendRecord, getSpendRecords, updateSpendRecord } from "../lib/api";

vi.mock("../lib/api", () => ({
  createSpendRecord: vi.fn(),
  deleteSpendRecord: vi.fn(),
  getSpendRecords: vi.fn(),
  updateSpendRecord: vi.fn(),
}));

const EMPTY_RESULT = {
  records: [],
  totals: {
    subscription_usd: 0, subscription_cny: 0,
    api_usd: 0, api_cny: 0,
    combined_usd: 0, combined_cny: 0,
    lifetime_subscription_usd: 0, lifetime_subscription_cny: 0,
    lifetime_api_usd: 0, lifetime_api_cny: 0,
    lifetime_combined_usd: 0, lifetime_combined_cny: 0,
    total_usd: 0, total_cny: 0,
  },
  by_source: [],
};

const SAMPLE_RECORD = {
  id: "spend-1",
  source: "claude",
  plan_label: "Max",
  amount: 10,
  currency: "USD",
  billing_cycle: "monthly",
  start_date: "2026-06-01",
  end_date: "",
  note: "manual",
  created_at: "2026-06-21T00:00:00.000Z",
  updated_at: "2026-06-21T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  getSpendRecords.mockResolvedValue(EMPTY_RESULT);
  createSpendRecord.mockResolvedValue({
    ok: true,
    record: SAMPLE_RECORD,
    records: [SAMPLE_RECORD],
    totals: { ...EMPTY_RESULT.totals, subscription_usd: 10, subscription_cny: 72, combined_usd: 10, combined_cny: 72, total_usd: 10, total_cny: 72 },
    by_source: [{ source: "claude", subscription_usd: 10, subscription_cny: 72, api_usd: 0, api_cny: 0, combined_usd: 10, combined_cny: 72 }],
  });
  deleteSpendRecord.mockResolvedValue(EMPTY_RESULT);
  updateSpendRecord.mockResolvedValue({
    ok: true,
    record: { ...SAMPLE_RECORD, amount: 20, note: "updated" },
    records: [{ ...SAMPLE_RECORD, amount: 20, note: "updated" }],
    totals: { ...EMPTY_RESULT.totals, subscription_usd: 20, subscription_cny: 144, combined_usd: 20, combined_cny: 144, total_usd: 20, total_cny: 144 },
    by_source: [{ source: "claude", subscription_usd: 20, subscription_cny: 144, api_usd: 0, api_cny: 0, combined_usd: 20, combined_cny: 144 }],
  });
});

it("loads and displays records, totals, and by_source", async () => {
  getSpendRecords.mockResolvedValue({
    records: [SAMPLE_RECORD],
    totals: { ...EMPTY_RESULT.totals, subscription_usd: 10, subscription_cny: 72, combined_usd: 10, combined_cny: 72, total_usd: 10, total_cny: 72 },
    by_source: [{ source: "claude", subscription_usd: 10, subscription_cny: 72, api_usd: 0, api_cny: 0, combined_usd: 10, combined_cny: 72 }],
  });

  render(<SpendPage />);

  // Should display record
  await screen.findByText(/claude \/ Max/i);

  // Should display monthly subscription total
  expect(await screen.findByText("本月订阅成本")).toBeInTheDocument();

  // Should display by_source breakdown
  expect(await screen.findByText("按来源拆分")).toBeInTheDocument();
});

it("adds a new spend record", async () => {
  const user = userEvent.setup();
  render(<SpendPage />);

  await screen.findByText("暂无支出记录。");

  // Fill in form fields - the form fields are labeled with unique labels
  const sourceInput = screen.getByLabelText("来源");
  const planInput = screen.getByLabelText("套餐名称");
  const amountInput = screen.getByLabelText("金额");
  const noteInput = screen.getByLabelText("备注");

  await act(async () => {
    await user.type(sourceInput, "claude");
    await user.type(planInput, "Max");
    await user.clear(amountInput);
    await user.type(amountInput, "10");
    await user.type(noteInput, "manual");
  });

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "添加记录" }));
  });

  await waitFor(() => {
    expect(createSpendRecord).toHaveBeenCalled();
  });

  // After adding, the record should appear - use getAllByText since it appears in multiple places
  const items = await screen.findAllByText(/claude \/ Max/i);
  expect(items.length).toBeGreaterThan(0);
});

it("edits an existing spend record", async () => {
  const user = userEvent.setup();
  getSpendRecords.mockResolvedValue({
    records: [SAMPLE_RECORD],
    totals: { ...EMPTY_RESULT.totals, subscription_usd: 10, subscription_cny: 72, combined_usd: 10, combined_cny: 72, total_usd: 10, total_cny: 72 },
    by_source: [{ source: "claude", subscription_usd: 10, subscription_cny: 72, api_usd: 0, api_cny: 0, combined_usd: 10, combined_cny: 72 }],
  });

  render(<SpendPage />);
  await screen.findByText(/claude \/ Max/i);

  // Click edit button
  const editBtn = screen.getByLabelText("编辑");
  await act(async () => {
    await user.click(editBtn);
  });

  // Form should switch to edit mode
  await screen.findByText("编辑订阅记录");

  // Change amount
  const amountInput = screen.getByLabelText("金额");
  await act(async () => {
    await user.clear(amountInput);
    await user.type(amountInput, "20");
  });

  // Save
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存修改" }));
  });

  await waitFor(() => {
    expect(updateSpendRecord).toHaveBeenCalled();
  });
});

it("deletes a spend record", async () => {
  const user = userEvent.setup();
  getSpendRecords.mockResolvedValue({
    records: [SAMPLE_RECORD],
    totals: { ...EMPTY_RESULT.totals, subscription_usd: 10, subscription_cny: 72, combined_usd: 10, combined_cny: 72, total_usd: 10, total_cny: 72 },
    by_source: [{ source: "claude", subscription_usd: 10, subscription_cny: 72, api_usd: 0, api_cny: 0, combined_usd: 10, combined_cny: 72 }],
  });

  render(<SpendPage />);
  await screen.findByText(/claude \/ Max/i);

  // Click delete button
  const deleteBtn = screen.getByLabelText("删除记录");
  await act(async () => {
    await user.click(deleteBtn);
  });

  await waitFor(() => {
    expect(deleteSpendRecord).toHaveBeenCalledWith("spend-1");
  });
});

it("displays monthly API, subscription, combined, and lifetime costs", async () => {
  getSpendRecords.mockResolvedValue({
    records: [SAMPLE_RECORD],
    totals: {
      subscription_usd: 10, subscription_cny: 72,
      api_usd: 5, api_cny: 36,
      combined_usd: 15, combined_cny: 108,
      lifetime_subscription_usd: 120, lifetime_subscription_cny: 864,
      lifetime_api_usd: 50, lifetime_api_cny: 360,
      lifetime_combined_usd: 170, lifetime_combined_cny: 1224,
      total_usd: 15, total_cny: 108,
    },
    by_source: [{ source: "claude", subscription_usd: 10, subscription_cny: 72, api_usd: 5, api_cny: 36, combined_usd: 15, combined_cny: 108 }],
  });

  render(<SpendPage />);

  // Should show all 4 summary tiles
  expect(await screen.findByText("本月 API 成本")).toBeInTheDocument();
  expect(screen.getByText("本月订阅成本")).toBeInTheDocument();
  expect(screen.getByText("本月总成本")).toBeInTheDocument();
  expect(screen.getByText("累计总成本")).toBeInTheDocument();

  // Check values - use getAllByText since same amounts appear in by_source table
  expect(screen.getAllByText("USD 5.00").length).toBeGreaterThan(0);
  expect(screen.getAllByText("USD 10.00").length).toBeGreaterThan(0);
  expect(screen.getAllByText("USD 15.00").length).toBeGreaterThan(0);
  expect(screen.getAllByText("USD 170.00").length).toBeGreaterThan(0);
});

it("displays by_source breakdown table", async () => {
  getSpendRecords.mockResolvedValue({
    records: [SAMPLE_RECORD],
    totals: { ...EMPTY_RESULT.totals, subscription_usd: 10, subscription_cny: 72, combined_usd: 10, combined_cny: 72, total_usd: 10, total_cny: 72 },
    by_source: [{ source: "claude", subscription_usd: 10, subscription_cny: 72, api_usd: 0, api_cny: 0, combined_usd: 10, combined_cny: 72 }],
  });

  render(<SpendPage />);

  // Should show by_source title and table
  expect(await screen.findByText("按来源拆分")).toBeInTheDocument();
  expect(screen.getByText("claude")).toBeInTheDocument();
  expect(screen.getByText("订阅成本")).toBeInTheDocument();
  expect(screen.getByText("API 成本")).toBeInTheDocument();
  expect(screen.getByText("合计")).toBeInTheDocument();
});
