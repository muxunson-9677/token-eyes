import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { expiryTimestamp, TokenServiceList } from "./TokenServiceList.jsx";
import { setCopyLocale } from "../../../lib/copy";

afterEach(() => setCopyLocale("zh-CN"));

function plan(id, used, total = 1_000, overrides = {}) {
  return {
    id,
    source: id,
    provider_id: "custom",
    plan_label: `Service ${id}`,
    quota_source: "manual",
    used_quota: used,
    total_quota: total,
    remaining_quota: Math.max(0, total - used),
    quota_unit: "tokens",
    expires_at: "2099-12-31",
    ...overrides,
  };
}

describe("TokenServiceList", () => {
  it("uses one glass service panel with quiet nested rows", () => {
    render(
      <TokenServiceList
        plans={[plan("codex", 250, 1000)]}
        now={new Date("2026-07-13T00:00:00Z")}
      />,
    );

    expect(screen.getByTestId("token-service-list")).toHaveClass("tt-surface");
    expect(screen.getByTestId("token-service-list")).toHaveClass("p-4");
    expect(screen.getByTestId("token-service-list-title")).toBeInTheDocument();
    expect(screen.getByTestId("token-service-row")).toHaveClass("tt-surface-nested");
  });

  it("treats a date-only expiry as the end of that date in the local timezone", () => {
    expect(expiryTimestamp("2026-07-19")).toBe(new Date(2026, 6, 19, 23, 59, 59, 999).getTime());
  });

  it("sorts available plans by used quota before exhausted plans, hides expired records, and paginates five rows with global ranks", async () => {
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
    expect(within(rows[0]).getByText("A")).toBeInTheDocument();
    expect(within(rows[0]).getByText("90%")).toBeInTheDocument();
    expect(within(rows[4]).getByText("5")).toBeInTheDocument();
    expect(within(rows[4]).getByText("E")).toBeInTheDocument();
    expect(screen.queryByText("Service expired")).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "下一页" }));
    });

    rows = screen.getAllByTestId("token-service-row");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("6")).toBeInTheDocument();
    expect(within(rows[0]).getByText("F")).toBeInTheDocument();
    expect(within(rows[1]).getByText("7")).toBeInTheDocument();
    expect(within(rows[1]).getByText("G")).toBeInTheDocument();
    expect(within(rows[2]).getByText("8")).toBeInTheDocument();
    expect(within(rows[2]).getByText("unused")).toBeInTheDocument();
    expect(within(rows[3]).getByText("9")).toBeInTheDocument();
    expect(within(rows[3]).getByText("exhausted")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Service exhausted")).toHaveClass("text-oai-gray-400");
    expect(within(rows[3]).getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("renders five compact independent cards without hiding multi-lane quota values", () => {
    const sharedReset = "2026-08-06T14:31:29.000Z";
    const cursor = plan("cursor-live", 0, 0, {
      provider_id: "cursor",
      plan_label: "Pro",
      notes: "eve***@hotmail.com",
      quota_source: "official",
      quota_unit: "percent",
      detection_method: "official_account",
      sync_status: "success",
      expires_at: null,
      quota_windows: [
        { kind: "total", unit: "percent", total: 100, used: 33.522, percentage: 33.522, resets_at: sharedReset },
        { kind: "auto_composer", unit: "percent", total: 100, used: 27.82, percentage: 27.82, resets_at: sharedReset },
        { kind: "api", unit: "percent", total: 100, used: 71.533, percentage: 71.533, resets_at: sharedReset },
      ],
    });

    render(
      <TokenServiceList
        plans={[cursor, plan("A", 90), plan("B", 80), plan("C", 70), plan("D", 60)]}
      />,
    );

    const list = screen.getByTestId("token-service-cards");
    const rows = within(list).getAllByTestId("token-service-row");
    expect(rows).toHaveLength(5);
    expect(list).toHaveClass("gap-1.5");
    for (const row of rows) expect(row).toHaveClass("border");
    const cursorRow = screen.getByText("eve***@hotmail.com").closest("li");
    expect(cursorRow).not.toBeNull();
    expect(within(cursorRow).getByTestId("token-service-window-total")).toHaveTextContent("33.522");
    expect(within(cursorRow).getByTestId("token-service-window-auto_composer")).toHaveTextContent("27.82");
    expect(within(cursorRow).getByTestId("token-service-window-api")).toHaveTextContent("71.533");
    expect(within(cursorRow).getAllByTestId("token-service-shared-reset")).toHaveLength(1);
  });

  it("shows every live quota window when a rolling plan has no fixed total", () => {
    render(
      <TokenServiceList
        now={new Date("2026-07-13T00:00:00Z")}
        plans={[
          plan("rolling", 0, 0, {
            quota_windows: [
              { kind: "rolling_5_hour", total: 100, used: 20, remaining: 80, percentage: 20, resets_at: "2026-07-13T05:00:00Z" },
              { kind: "rolling_weekly", total: 100, used: 45, remaining: 55, percentage: 45, resets_at: "2026-07-20T00:00:00Z" },
            ],
          }),
        ]}
      />,
    );

    const row = screen.getByTestId("token-service-row");
    expect(row).toHaveTextContent("rolling");
    expect(row).toHaveTextContent("Service rolling");
    expect(within(row).getByTestId("token-service-window-rolling_5_hour")).toHaveTextContent("5 小时");
    expect(within(row).getByTestId("token-service-window-rolling_5_hour")).toHaveTextContent("20%");
    expect(within(row).getByTestId("token-service-window-rolling_weekly")).toHaveTextContent("每周");
    expect(row).toHaveTextContent("45%");
  });

  it("renders TRAE fast-request usage, percentage, and reset time", () => {
    render(
      <TokenServiceList
        now={new Date("2026-07-20T01:23:22Z")}
        plans={[plan("trae-live", 25, 100, {
          source: "trae",
          provider_id: "trae",
          plan_label: "速通 Pro",
          quota_source: "provider_reported",
          quota_unit: "requests",
          detection_method: "official_account",
          sync_status: "success",
          expires_at: null,
          quota_windows: [{
            kind: "fast_request",
            unit: "requests",
            total: 100,
            used: 25,
            remaining: 75,
            percentage: 25,
            resets_at: "2026-08-01T00:03:00Z",
          }],
        })]}
      />,
    );

    const row = screen.getByTestId("token-service-row");
    expect(row).toHaveTextContent("Trae");
    expect(row).toHaveTextContent("速通 Pro");
    const metric = within(row).getByTestId("token-service-window-fast_request");
    expect(metric).toHaveTextContent("已用 25 requests");
    expect(metric).toHaveTextContent("总量 100 requests");
    expect(metric).toHaveTextContent("25%");
    expect(within(row).getByTestId("token-service-shared-reset")).toBeInTheDocument();
  });

  it("hides a rolling service after its only official reset/validity timestamp has passed", () => {
    render(
      <TokenServiceList
        now={new Date("2026-07-20T00:00:00Z")}
        plans={[plan("stale-window", 0, 0, {
          expires_at: null,
          quota_windows: [
            { kind: "rolling_weekly", total: 100, used: 100, remaining: 0, percentage: 100, resets_at: "2026-07-19T00:00:00Z" },
          ],
        })]}
      />,
    );

    expect(screen.queryByTestId("token-service-row")).not.toBeInTheDocument();
  });

  it("hides an exhausted service when no valid future expiry proves that it is still current", () => {
    render(
      <TokenServiceList
        now={new Date("2026-07-19T00:00:00Z")}
        plans={[plan("xiaomi-stale", 11_000_864_960, 11_000_000_000, {
          provider_id: "xiaomi_mimo",
          plan_label: "Standard（月付）",
          expires_at: null,
          detection_method: "official_account",
          sync_status: "success",
        })]}
      />,
    );

    expect(screen.queryByTestId("token-service-row")).not.toBeInTheDocument();
  });

  it("shows an explicit empty state", () => {
    render(<TokenServiceList plans={[plan("expired", 1_000, 1_000, { expires_at: "2020-01-01" })]} />);

    expect(screen.getByText("暂无未过期的 Token 服务")).toBeInTheDocument();
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
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("keeps every saved non-expired plan visible even when automatic refresh fails", () => {
    render(
      <TokenServiceList
        now={new Date("2026-07-13T00:00:00Z")}
        plans={[
          plan("xiaomi", 1_000, 1_000, {
            provider_id: "xiaomi_mimo",
            plan_label: "Standard（月付）",
            quota_source: "catalog",
            detection_method: "official_account",
            sync_status: "success",
          }),
          plan("codex", 95, 100, {
            provider_id: "codex",
            plan_label: "Plus",
            quota_source: "catalog",
            detection_method: "official_account",
            sync_status: "success",
          }),
          plan("glm", 0, 400, {
            provider_id: "glm",
            plan_label: "Lite",
            quota_source: "catalog",
            detection_method: "official_account",
            sync_status: "not_configured",
          }),
          plan("failed", 50, 100, {
            provider_id: "kimi",
            plan_label: "Pro",
            quota_source: "catalog",
            detection_method: "official_account",
            sync_status: "failed",
          }),
          plan("manual", 20, 200),
        ]}
      />,
    );

    const rows = screen.getAllByTestId("token-service-row");
    expect(rows).toHaveLength(5);
    const xiaomiRow = screen.getByText("Xiaomi").closest("li");
    expect(xiaomiRow).not.toBeNull();
    const xiaomiIcon = screen.getByTestId("token-service-provider-icon-xiaomi_mimo");
    expect(xiaomiIcon).toBeInTheDocument();
    expect(xiaomiIcon.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.cnbj1.fds.api.mi-img.com/aife/mimo-blog-fe/doc_build/mimo.ico",
    );
    expect(within(xiaomiRow).getByText("Standard")).toHaveClass("text-oai-gray-400");
    expect(within(xiaomiRow).getByText("有效期至 2099/12/31")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Plus")).toHaveClass("text-oai-gray-400");
    expect(screen.getByText("manual")).toBeInTheDocument();
    expect(screen.getByText("Lite")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
  });

  it("formats token quota values with Chinese units", () => {
    render(
      <TokenServiceList
        now={new Date("2026-07-13T00:00:00Z")}
        plans={[plan("large", 11_000_000_000, 20_000_000_000)]}
      />,
    );

    const row = screen.getByTestId("token-service-row");
    expect(row).toHaveTextContent("已用 110亿");
    expect(row).toHaveTextContent("总量 200亿");
    expect(row).not.toHaveTextContent("11.00B");
  });

  it("shows the saved plan note so same-provider accounts are distinguishable", () => {
    render(
      <TokenServiceList
        plans={[plan("codex-work", 30, 100, {
          provider_id: "codex",
          plan_label: "Plus",
          notes: "工作账号",
        })]}
      />,
    );

    expect(screen.getByText("工作账号")).toBeInTheDocument();
  });

  it("shows Cursor Total Usage / Auto + Composer / API Usage percentages per account", () => {
    setCopyLocale("en");
    render(
      <TokenServiceList
        now={new Date("2026-07-19T00:00:00Z")}
        plans={[
          plan("cursor-a", 0, 0, {
            provider_id: "cursor",
            plan_label: "Pro",
            notes: "eve***@hotmail.com",
            quota_source: "official",
            quota_unit: "percent",
            detection_method: "official_account",
            sync_status: "success",
            expires_at: null,
            quota_windows: [
              { kind: "total", unit: "percent", total: 100, used: 29.5, remaining: 70.5, percentage: 29.5, resets_at: "2026-08-06T14:31:29.000Z" },
              { kind: "rolling_weekly", unit: "percent", total: 100, used: 29.5, remaining: 70.5, percentage: 29.5, resets_at: "2026-08-06T14:31:29.000Z" },
              { kind: "auto_composer", unit: "percent", total: 100, used: 23.2, remaining: 76.8, percentage: 23.2, resets_at: "2026-08-06T14:31:29.000Z" },
              { kind: "api", unit: "percent", total: 100, used: 71.5, remaining: 28.5, percentage: 71.5, resets_at: "2026-08-06T14:31:29.000Z" },
            ],
          }),
          plan("cursor-b", 0, 0, {
            provider_id: "cursor",
            plan_label: "Pro",
            notes: "she***@gmail.com",
            quota_source: "official",
            quota_unit: "percent",
            detection_method: "official_account",
            sync_status: "success",
            expires_at: null,
            quota_windows: [
              { kind: "total", unit: "percent", total: 100, used: 6, remaining: 94, percentage: 6, resets_at: "2026-08-13T09:08:00.000Z" },
              { kind: "auto_composer", unit: "percent", total: 100, used: 1, remaining: 99, percentage: 1, resets_at: "2026-08-13T09:08:00.000Z" },
              { kind: "api", unit: "percent", total: 100, used: 39, remaining: 61, percentage: 39, resets_at: "2026-08-13T09:08:00.000Z" },
            ],
          }),
        ]}
      />,
    );

    const rows = screen.getAllByTestId("token-service-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("token-service-window-total")).toHaveTextContent("Total Usage");
    expect(within(rows[0]).getByTestId("token-service-window-total")).toHaveTextContent("30%");
    expect(within(rows[0]).getByTestId("token-service-window-auto_composer")).toHaveTextContent("Auto + Composer");
    expect(within(rows[0]).getByTestId("token-service-window-auto_composer")).toHaveTextContent("23%");
    expect(within(rows[0]).getByTestId("token-service-window-api")).toHaveTextContent("API Usage");
    expect(within(rows[0]).getByTestId("token-service-window-api")).toHaveTextContent("72%");
    expect(within(rows[1]).getByTestId("token-service-window-total")).toHaveTextContent("6%");
    expect(within(rows[1]).getByTestId("token-service-window-auto_composer")).toHaveTextContent("1%");
    expect(within(rows[1]).getByTestId("token-service-window-api")).toHaveTextContent("39%");
  });

  it("localizes Cursor window labels and percent quota units in Chinese", () => {
    setCopyLocale("zh-CN");
    render(
      <TokenServiceList
        now={new Date("2026-07-19T00:00:00Z")}
        plans={[plan("cursor-zh", 0, 0, {
          provider_id: "cursor",
          plan_label: "Pro",
          quota_source: "official",
          quota_unit: "percent",
          detection_method: "official_account",
          sync_status: "success",
          expires_at: null,
          quota_windows: [
            { kind: "total", unit: "percent", total: 100, used: 32, percentage: 32 },
            { kind: "auto_composer", unit: "percent", total: 100, used: 27, percentage: 27 },
            { kind: "api", unit: "percent", total: 100, used: 4, percentage: 4 },
          ],
        })]}
      />,
    );

    const row = screen.getByTestId("token-service-row");
    expect(within(row).getByTestId("token-service-window-total")).toHaveTextContent("总用量");
    expect(within(row).getByTestId("token-service-window-auto_composer")).toHaveTextContent("自动与 Composer");
    expect(within(row).getByTestId("token-service-window-api")).toHaveTextContent("API 用量");
    expect(row).toHaveTextContent("已用 32% / 总量 100%");
    expect(row).not.toHaveTextContent("percent");
  });
});
