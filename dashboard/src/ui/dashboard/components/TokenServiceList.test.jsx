import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TokenServiceList } from "./TokenServiceList.jsx";

function plan(id, used, total = 1_000, overrides = {}) {
  return {
    id,
    source: id,
    plan_label: `Service ${id}`,
    used_quota: used,
    total_quota: total,
    remaining_quota: Math.max(0, total - used),
    quota_unit: "tokens",
    expires_at: "2099-12-31",
    ...overrides,
  };
}

describe("TokenServiceList", () => {
  it("sorts by used quota, hides inactive records, and paginates five rows with global ranks", async () => {
    const user = userEvent.setup();
    const plans = [
      plan("G", 300),
      plan("C", 700),
      plan("A", 900),
      plan("F", 400),
      plan("B", 800),
      plan("E", 500),
      plan("D", 600),
      plan("exhausted", 1_000),
      plan("unused", 0),
      plan("expired", 950, 1_000, { expires_at: "2020-01-01" }),
    ];

    render(<TokenServiceList plans={plans} now={new Date("2026-07-13T00:00:00Z")} />);

    let rows = screen.getAllByTestId("token-service-row");
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getByText("1")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Service A")).toBeInTheDocument();
    expect(within(rows[4]).getByText("5")).toBeInTheDocument();
    expect(within(rows[4]).getByText("Service E")).toBeInTheDocument();
    expect(screen.queryByText("Service exhausted")).not.toBeInTheDocument();
    expect(screen.queryByText("Service unused")).not.toBeInTheDocument();
    expect(screen.queryByText("Service expired")).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "下一页" }));
    });

    rows = screen.getAllByTestId("token-service-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("6")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Service F")).toBeInTheDocument();
    expect(within(rows[1]).getByText("7")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Service G")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("uses the weekly live quota window when a rolling plan has no fixed total", () => {
    render(
      <TokenServiceList
        now={new Date("2026-07-13T00:00:00Z")}
        plans={[
          plan("rolling", 0, 0, {
            quota_windows: [
              { kind: "rolling_5_hour", total: 100, used: 20, remaining: 80, percentage: 20 },
              { kind: "rolling_weekly", total: 100, used: 45, remaining: 55, percentage: 45 },
            ],
          }),
        ]}
      />,
    );

    const row = screen.getByTestId("token-service-row");
    expect(row).toHaveTextContent("Service rolling");
    expect(row).toHaveTextContent("45%");
  });

  it("shows an explicit empty state", () => {
    render(<TokenServiceList plans={[plan("exhausted", 1_000)]} />);

    expect(screen.getByText("暂无未耗尽且已有用量的 Token 服务")).toBeInTheDocument();
    expect(screen.queryByTestId("token-service-row")).not.toBeInTheDocument();
  });

  it("returns to the last valid page when refreshed data shrinks", async () => {
    const user = userEvent.setup();
    const initialPlans = [
      plan("A", 900),
      plan("B", 800),
      plan("C", 700),
      plan("D", 600),
      plan("E", 500),
      plan("F", 400),
    ];
    const { rerender } = render(<TokenServiceList plans={initialPlans} />);

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "下一页" }));
    });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();

    act(() => {
      rerender(<TokenServiceList plans={initialPlans.slice(0, 2)} />);
    });

    await waitFor(() => expect(screen.getByText("1 / 1")).toBeInTheDocument());
    expect(screen.getAllByTestId("token-service-row")).toHaveLength(2);
    expect(screen.getByText("Service A")).toBeInTheDocument();
  });
});
