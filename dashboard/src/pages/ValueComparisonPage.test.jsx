import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copy } from "../lib/copy";
import { ValueComparisonPage } from "./ValueComparisonPage.jsx";

const getValueComparison = vi.fn();
vi.mock("../lib/api", () => ({ getValueComparison }));

const payload = {
  actual_spend: { total_usd: { value: 10, unit: "USD", evidence_state: "exact" } },
  api_equivalent_value: { value: 20, unit: "USD", evidence_state: "estimated" },
  value_multiple: { value: 2, unit: "times", evidence_state: "estimated" },
  recognized_tokens: { value: 1000 }, pricing_coverage_percent: { value: 80 },
  actual_composition: [{ key: "subscription", value: 10, evidence_state: "exact" }],
  value_composition: [{ key: "api_key", value: 20, evidence_state: "estimated" }],
  attribution: { linked: [], unattributed: [{ source: "codex", api_equivalent_usd: 20 }] },
  monthly_trend: Array.from({ length: 6 }, (_, index) => ({ bucket_start: `2026-0${index + 3}-01`, label: `${index + 3}月`, actual_spend_usd: 10, api_equivalent_usd: 20 })),
};

afterEach(() => vi.restoreAllMocks());

describe("ValueComparisonPage", () => {
  it("changes the actual data range through the segmented control", async () => {
    const user = userEvent.setup();
    getValueComparison.mockResolvedValue(payload);
    render(<ValueComparisonPage />);
    await screen.findByText("$20.00");
    await user.click(screen.getByRole("button", { name: copy("value.range.7d") }));
    await waitFor(() => expect(getValueComparison).toHaveBeenLastCalledWith("7d", expect.any(AbortSignal)));
  });

  it("renders real attribution rows and expandable evidence sections", async () => {
    getValueComparison.mockResolvedValue(payload);
    render(<ValueComparisonPage />);
    expect(await screen.findByText(copy("value.table.unlinked", { source: "codex" }))).toBeInTheDocument();
    const detail = screen.getByText(copy("value.details.evidence")).closest("details");
    expect(detail.open).toBe(false);
    await userEvent.setup().click(screen.getByText(copy("value.details.evidence")));
    expect(detail.open).toBe(true);
  });
});
