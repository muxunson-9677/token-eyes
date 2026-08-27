import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { expiryTimestamp, TokenServiceList } from "./TokenServiceList.jsx";
import { copy, setCopyLocale } from "../../../lib/copy";

afterEach(() => setCopyLocale("zh-CN"));

function formatLocalDateTime(value) {
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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

  it("keeps an ISO plan active at the exact expiry instant", () => {
    const exactExpiry = "2026-07-13T00:00:00.000Z";

    render(
      <TokenServiceList
        plans={[plan("equal-expiry", 250, 1_000, { expires_at: exactExpiry })]}
        now={new Date(exactExpiry)}
      />,
    );

    expect(screen.getByText("Service equal-expiry")).toBeInTheDocument();
  });

  it("sorts available plans by used quota, keeps expired records collapsed, and paginates five active rows with global ranks", async () => {
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
    expect(screen.getByRole("button", { name: "已过期 (1)" })).toHaveAttribute("aria-expanded", "false");

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

  it("supports a ten-card cost-page window without letting expired plans affect active pagination", async () => {
    const user = userEvent.setup();
    const plans = [
      ...Array.from({ length: 11 }, (_, index) => plan(`active-${index + 1}`, 900 - index * 10)),
      plan("expired-cost-plan", 950, 1_000, { expires_at: "2020-01-01" }),
    ];

    render(
      <TokenServiceList
        plans={plans}
        pageSize={10}
        now={new Date("2026-07-13T00:00:00Z")}
      />,
    );

    expect(screen.getAllByTestId("token-service-row")).toHaveLength(10);
    expect(screen.queryByText("Service expired-cost-plan")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已过期 (1)" })).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "下一页" }));
    });

    const secondPageRows = screen.getAllByTestId("token-service-row");
    expect(secondPageRows).toHaveLength(1);
    expect(within(secondPageRows[0]).getByText("11")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("keeps a future subscription in its own collapsed not-started group", async () => {
    const user = userEvent.setup();
    render(
      <TokenServiceList
        now={new Date(2026, 7, 27, 12, 0, 0, 0)}
        plans={[
          plan("active", 100, 1_000, { subscription_end_date: "2026-09-30" }),
          plan("scheduled", 100, 1_000, {
            subscription_start_date: "2026-09-01",
            subscription_end_date: "2026-09-30",
          }),
          plan("expired", 100, 1_000, { subscription_end_date: "2026-08-01" }),
        ]}
      />,
    );

    expect(screen.getAllByTestId("token-service-row")).toHaveLength(1);
    expect(screen.getByText("Service active")).toBeInTheDocument();
    expect(screen.queryByText("Service scheduled")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "未生效 (1)" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "已过期 (1)" })).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "未生效 (1)" }));
    });
    expect(screen.getByTestId("scheduled-token-service-cards")).toHaveTextContent("Service scheduled");
    expect(screen.getByTestId("scheduled-token-service-cards")).toHaveTextContent("2026");
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
        now={new Date("2026-08-01T00:00:00Z")}
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
    expect(within(cursorRow).getAllByTestId(/^token-service-reset-/)).toHaveLength(3);
  });

  it("hides the successful sync badge but keeps actionable sync states visible", () => {
    render(
      <TokenServiceList
        plans={[
          plan("healthy", 20, 100, {
            provider_id: "codex",
            plan_label: "Pro",
            detection_method: "official_account",
            sync_status: "success",
          }),
          plan("failed", 30, 100, {
            provider_id: "kimi",
            plan_label: "Moderato",
            detection_method: "official_account",
            sync_status: "failed",
          }),
        ]}
      />,
    );

    const healthyRow = screen.getByText("Pro").closest("li");
    const failedRow = screen.getByText("Moderato").closest("li");
    expect(within(healthyRow).queryByText("同步成功")).not.toBeInTheDocument();
    expect(within(failedRow).getByText("同步失败")).toBeInTheDocument();
  });

  it("uses the official model label for each quota lane", () => {
    render(
      <TokenServiceList
        plans={[plan("models", 0, 0, {
          provider_id: "codex",
          detection_method: "official_account",
          sync_status: "success",
          quota_windows: [
            { kind: "rolling_5_hour", model_label: "GPT 5.3 Codex · 5h", total: 100, used: 12, percentage: 12 },
            { kind: "rolling_weekly", model_label: "GPT 5.3 Codex · 7d", total: 100, used: 44, percentage: 44 },
          ],
        })]}
      />,
    );

    const row = screen.getByTestId("token-service-row");
    expect(row).toHaveTextContent("GPT 5.3 Codex · 5h");
    expect(row).toHaveTextContent("GPT 5.3 Codex · 7d");
    expect(within(row).getAllByTestId(/^token-service-reset-/)).toHaveLength(2);
    expect(within(row).getAllByText(/官方未提供/)).toHaveLength(2);
  });

  it("shows the account label attached to an official Codex authorization", () => {
    render(
      <TokenServiceList
        plans={[plan("codex-official", 3, 100, {
          provider_id: "codex",
          detection_method: "official_account",
          detection_config: {
            official_account: { display_name: "muxunson@gmail.com" },
          },
        })]}
        now={new Date("2026-08-01T00:00:00Z")}
      />,
    );

    expect(screen.getByTestId("token-service-row")).toHaveTextContent("muxunson@gmail.com");
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

  it("keeps the official GPT 5.3 Codex Spark weekly window alongside the standard Codex limits", () => {
    render(
      <TokenServiceList
        now={new Date("2026-07-13T00:00:00Z")}
        plans={[plan("codex-pro-20x", 0, 0, {
          provider_id: "codex",
          plan_label: "Pro 20x",
          detection_method: "official_account",
          detection_config: {
            official_account: { display_name: "muxunson@gmail.com" },
          },
          quota_windows: [
            { kind: "rolling_5_hour", total: 100, used: 3, percentage: 3 },
            { kind: "rolling_weekly", total: 100, used: 97, percentage: 97 },
            { kind: "gpt_5_3_codex_spark_weekly", total: 100, used: 44, percentage: 44 },
          ],
        })]}
      />,
    );

    const row = screen.getByTestId("token-service-row");
    expect(row).toHaveTextContent("muxunson@gmail.com");
    expect(within(row).getByTestId("token-service-window-gpt_5_3_codex_spark_weekly"))
      .toHaveTextContent("GPT 5.3 Codex Spark Weekly");
    expect(row).toHaveTextContent("44%");
  });

  it("shows independent reset countdowns and a separate subscription validity for Codex", () => {
    render(
      <TokenServiceList
        now={new Date("2026-08-14T00:00:00Z")}
        plans={[plan("codex-pro-20x", 0, 0, {
          provider_id: "codex",
          plan_label: "Pro 20x",
          expires_at: "2026-08-30T14:24:24Z",
          detection_method: "official_account",
          sync_status: "success",
          quota_windows: [
            { kind: "rolling_weekly", unit: "percent", total: 100, used: 4, percentage: 4, resets_at: "2026-08-20T00:00:00Z" },
            { kind: "gpt_5_3_codex_spark_weekly", unit: "percent", total: 100, used: 56, percentage: 56, resets_at: "2026-08-25T00:00:00Z" },
          ],
        })]}
      />,
    );

    const row = screen.getByTestId("token-service-row");
    expect(within(row).getByTestId("token-service-reset-rolling_weekly"))
      .toHaveTextContent("还剩 6天 0小时");
    expect(within(row).getByTestId("token-service-reset-gpt_5_3_codex_spark_weekly"))
      .toHaveTextContent("还剩 11天 0小时");
    expect(within(row).getByTestId("token-service-validity")).toHaveTextContent("有效期：16天 14小时");
    expect(within(row).getByTestId("token-service-validity")).toHaveTextContent(
      formatLocalDateTime("2026-08-30T14:24:24Z"),
    );
    expect(within(row).getByTestId("token-service-validity")).not.toHaveTextContent("到期");
  });

  it("shows an explicit validity state for a plan without a subscription expiry", () => {
    render(
      <TokenServiceList
        now={new Date("2026-08-14T00:00:00Z")}
        plans={[plan("manual-no-expiry", 10, 100, { expires_at: "" })]}
      />,
    );

    expect(screen.getByTestId("token-service-validity")).toHaveTextContent("有效期未设置");
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
    expect(within(row).getByTestId("token-service-reset-fast_request")).toBeInTheDocument();
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

  it("shows an active empty state while an all-expired group mounts only between expand and collapse", async () => {
    const user = userEvent.setup();
    render(<TokenServiceList plans={[plan("expired", 1_000, 1_000, { expires_at: "2020-01-01" })]} />);

    expect(screen.getByText("暂无当前有效的 Token 服务")).toBeInTheDocument();
    expect(screen.queryByTestId("token-service-row")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "已过期 (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("expired-token-service-cards")).not.toBeInTheDocument();

    await act(async () => {
      await user.click(toggle);
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("expired-token-service-cards")).toHaveTextContent("Service expired");

    await act(async () => {
      await user.click(toggle);
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("expired-token-service-cards")).not.toBeInTheDocument();
  });

  it.each([0, 1, 2, 5, 10])("reports the exact expired count for %i records", (count) => {
    render(
      <TokenServiceList
        plans={Array.from({ length: count }, (_, index) => (
          plan(`expired-${index + 1}`, 100, 1_000, { expires_at: "2020-01-01" })
        ))}
      />,
    );

    if (count === 0) {
      expect(screen.queryByRole("button", { name: /已过期/ })).not.toBeInTheDocument();
    } else {
      expect(screen.getByRole("button", { name: `已过期 (${count})` })).toBeInTheDocument();
    }
  });

  it("keeps Unix second and millisecond expiries active at equality and folds them one millisecond later", () => {
    const exactSeconds = "1785081600";
    const exactMilliseconds = "1785081600000";
    const now = new Date(1_785_081_600_000);

    render(
      <TokenServiceList
        now={now}
        plans={[
          plan("seconds-equal", 10, 100, { expires_at: exactSeconds }),
          plan("milliseconds-equal", 20, 100, { expires_at: exactMilliseconds }),
          plan("seconds-past", 30, 100, { expires_at: "1785081599" }),
          plan("milliseconds-past", 40, 100, { expires_at: "1785081599999" }),
        ]}
      />,
    );

    expect(screen.getAllByTestId("token-service-row")).toHaveLength(2);
    expect(screen.getByText("Service seconds-equal")).toBeInTheDocument();
    expect(screen.getByText("Service milliseconds-equal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已过期 (2)" })).toBeInTheDocument();
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
      "/plan-market-icons/xiaomi-mimo.png",
    );
    expect(within(xiaomiRow).getByText("Standard")).toHaveClass("text-oai-gray-400");
    expect(within(xiaomiRow).getByTestId("token-service-validity")).toHaveTextContent("有效期：");
    expect(within(xiaomiRow).getByTestId("token-service-validity")).toHaveTextContent(
      formatLocalDateTime("2099-12-31"),
    );
    expect(within(xiaomiRow).getByTestId("token-service-validity")).not.toHaveTextContent("到期");
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
    expect(rows[0]).toHaveTextContent("eve***@hotmail.com");
    expect(rows[1]).toHaveTextContent("she***@gmail.com");
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
