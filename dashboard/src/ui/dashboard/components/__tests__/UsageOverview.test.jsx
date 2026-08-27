import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_AGENTS } from "../../../../lib/agent-adapters-dashboard";
import { copy } from "../../../../lib/copy";
import { UsageOverview } from "../UsageOverview.jsx";

const breakdownProps = [];
const { getWorkbuddyQuotaMock } = vi.hoisted(() => ({
  getWorkbuddyQuotaMock: vi.fn(),
}));

vi.mock("../../../../lib/api", () => ({
  getWorkbuddyQuota: getWorkbuddyQuotaMock,
}));

vi.mock("../ContextBreakdownPanel.jsx", () => ({
  ContextBreakdownPanel: (props) => {
    breakdownProps.push(props);
    return <div data-testid="context-breakdown">{`${props.source}:${props.from}:${props.to}`}</div>;
  },
}));

vi.mock("../../../../hooks/useTheme.js", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

// Q02: a small but representative fleet so we can exercise the filter,
// the source-level badge, and the empty state. We hand-roll the fleet
// shape because the production `buildFleetData` adds percentages and
// identifiers; the filter operates on the bare shape too.
const mixedFleet = [
  {
    source: "codex",
    label: "CODEX",
    totalPercent: "60.0",
    usage: 600,
    usd: 6,
    billingMode: "mixed",
    billingModes: ["api_key", "token_plan"],
    models: [
      { id: "gpt-4o", name: "GPT-4o", share: 50, usage: 300, cost: 3, billingMode: "api_key" },
      { id: "gpt-5-pro", name: "GPT-5 Pro", share: 50, usage: 300, cost: 3, billingMode: "token_plan" },
    ],
  },
  {
    source: "hermes",
    label: "HERMES",
    totalPercent: "40.0",
    usage: 400,
    usd: 4,
    billingMode: "mixed",
    billingModes: ["api_key", "token_plan", "unknown"],
    models: [
      { id: "mimo-v2.5-pro", name: "MiMo v2.5 Pro", share: 25, usage: 100, cost: 1, billingMode: "token_plan" },
      { id: "deepseek-v4-pro", name: "DeepSeek v4 Pro", share: 25, usage: 100, cost: 1, billingMode: "api_key" },
      { id: "totally-unrecognized", name: "Mystery Model", share: 50, usage: 200, cost: 2, billingMode: "unknown" },
    ],
  },
];

function fleetEntryForAgent(agent, index = 0) {
  return {
    source: agent.queueSource,
    label: agent.displayName,
    totalPercent: (100 / DASHBOARD_AGENTS.length).toFixed(1),
    usage: 100 + index,
    usd: 1 + index / 100,
    billingMode: "unknown",
    billingModes: ["unknown"],
    models: [{
      id: `${agent.id}-model`,
      name: `${agent.displayName} real model`,
      share: 100,
      usage: 100 + index,
      cost: 1 + index / 100,
      billingMode: "unknown",
    }],
  };
}

describe("UsageOverview", () => {
  beforeEach(() => {
    breakdownProps.length = 0;
    getWorkbuddyQuotaMock.mockReset();
    getWorkbuddyQuotaMock.mockResolvedValue({ signed_in: false });
  });

  it("renders every visible registry Agent card as a native button", () => {
    const { container } = render(
      <UsageOverview
        period="total"
        periods={[]}
        summaryLabel="Total"
        summaryValue="123"
        fleetData={DASHBOARD_AGENTS.map(fleetEntryForAgent)}
      />,
    );

    const agentButtons = container.querySelectorAll(
      'button[aria-controls^="provider-details-"]',
    );
    expect(agentButtons).toHaveLength(DASHBOARD_AGENTS.length);
    expect(Array.from(agentButtons, (button) => button.getAttribute("aria-controls"))).toEqual(
      DASHBOARD_AGENTS.map((agent) => `provider-details-${agent.displayName}`),
    );
    for (const button of agentButtons) {
      expect(button).toHaveProperty("tagName", "BUTTON");
      expect(button).toHaveAttribute("type", "button");
    }
  });

  it("announces an unreadable Agent cost as unavailable without an attribution badge", () => {
    render(
      <UsageOverview
        period="total"
        periods={[]}
        summaryLabel="Total"
        summaryValue="123"
        fleetData={[
          mixedFleet[0],
          {
            source: "trae",
            label: "TRAE",
            totalPercent: "0.0",
            usage: 0,
            usd: null,
            billingMode: "unknown",
            billingModes: [],
            models: [],
            collectionStatus: "connected_no_precise_tokens",
          },
        ]}
      />,
    );

    const card = screen.getByRole("button", { name: /TRAE/i });
    expect(card).toHaveAccessibleName(expect.stringContaining(copy("usage.overview.cost_unavailable")));
    expect(card).not.toHaveAccessibleName(expect.stringContaining("$0"));
    expect(within(card).queryByText(copy("usage.billing_mode.unknown"))).not.toBeInTheDocument();
    expect(within(card).getByText(copy("usage.provider.trae_encrypted_db"))).toBeInTheDocument();
  });

  it("opens an unsupported Agent breakdown by mouse without hiding its real models", async () => {
    const user = userEvent.setup();
    const cursor = DASHBOARD_AGENTS.find((agent) => agent.id === "cursor");
    const cursorFleet = { ...fleetEntryForAgent(cursor), label: "CURSOR" };
    render(
      <UsageOverview
        period="total"
        periods={[]}
        summaryLabel="Total"
        summaryValue="123"
        fleetData={[cursorFleet]}
        from="2026-05-01"
        to="2026-05-31"
      />,
    );

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Cursor/i }));
    });

    expect(screen.getByText("CURSOR 上下文拆解")).toBeInTheDocument();
    expect(screen.getByTestId("context-breakdown")).toHaveTextContent(
      "cursor:2026-05-01:2026-05-31",
    );
    expect(screen.getByText("Cursor real model")).toBeInTheDocument();
    expect(breakdownProps.at(-1)).toMatchObject({
      source: "cursor",
      providerLabel: "CURSOR",
      referenceTotalTokens: 100,
    });
  });

  it("opens registry Agent breakdowns with Enter and Space", async () => {
    const user = userEvent.setup();
    const agents = DASHBOARD_AGENTS.filter((agent) => ["gemini", "hermes"].includes(agent.id));
    render(
      <UsageOverview
        period="total"
        periods={[]}
        summaryLabel="Total"
        summaryValue="203"
        fleetData={agents.map(fleetEntryForAgent)}
      />,
    );

    const geminiButton = screen.getByRole("button", { name: /Gemini CLI/i });
    geminiButton.focus();
    await act(async () => {
      await user.keyboard("{Enter}");
    });
    expect(screen.getByTestId("context-breakdown")).toHaveTextContent("gemini");

    const hermesButton = screen.getByRole("button", { name: /Hermes Agent/i });
    hermesButton.focus();
    await act(async () => {
      await user.keyboard(" ");
    });
    expect(screen.getByTestId("context-breakdown")).toHaveTextContent("hermes");
  });

  it("hides the primary total when it was not provided", () => {
    render(
      <UsageOverview
        summaryLabel="Total"
        summaryValue={null}
        fleetData={[]}
      />,
    );

    expect(screen.queryByTestId("usage-primary-total")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("—");
  });
  it("keeps overview toolbar controls at least 40px high", () => {
    render(
      <UsageOverview
        period="today"
        periods={[{ key: "today", label: "Today" }]}
        summaryLabel="Total"
        summaryValue="1,000"
        fleetData={[]}
        refreshInterval="1m"
        onRefreshIntervalChange={() => {}}
        onOpenShare={() => {}}
      />,
    );

    expect(screen.getByRole("tab", { name: "Today" })).toHaveClass("min-h-10");
    expect(screen.getByRole("combobox")).toHaveClass("h-10");
    expect(screen.getByRole("button", { name: /share|分享/i })).toHaveClass("h-10");
  });

  it("wraps the overview toolbar before narrow desktop widths clip period tabs", () => {
    render(
      <UsageOverview
        period="total"
        periods={[
          { key: "day", label: "Day" },
          { key: "week", label: "Week" },
          { key: "30d", label: "30d" },
          { key: "month", label: "Month" },
          { key: "total", label: "Total" },
          { key: "custom", label: "Custom" },
        ]}
        summaryLabel="Total"
        summaryValue="1,000"
        fleetData={[]}
        onOpenShare={() => {}}
      />,
    );

    const tablist = screen.getByRole("tablist");
    expect(tablist.parentElement).toHaveClass("flex-wrap", "lg:flex-nowrap");
    expect(tablist).toHaveClass("order-2", "w-full", "lg:order-none", "lg:flex-1");
  });

  it("places token and cost confidence evidence next to their authoritative totals", () => {
    render(
      <UsageOverview
        period="day"
        periods={[]}
        summaryLabel="Total"
        summaryValue="1,000"
        summaryCostValue="$2.50"
        fleetData={[]}
        tokenConfidence={{ state: "exact", states: ["exact"], sourceLabel: "Local logs" }}
        costConfidence={{
          state: "partial",
          states: ["partial", "estimated"],
          coveragePercent: 75,
          unpricedTokens: 250,
          unpricedPercent: 25,
        }}
      />,
    );

    expect(screen.getByTestId("usage-token-confidence")).toHaveAttribute("data-confidence-state", "exact");
    expect(screen.getByTestId("usage-cost-confidence")).toHaveAttribute("data-confidence-state", "partial");
  });

  it("passes the overview usage range to Codex context breakdown", async () => {
    breakdownProps.length = 0;
    const user = userEvent.setup();

    render(
      <UsageOverview
        className="h-full"
        period="month"
        periods={[]}
        summaryLabel="Total"
        summaryValue="123"
        fleetData={[
          {
            source: "codex",
            label: "CODEX",
            totalPercent: "100.0",
            usage: 123,
            usd: 0,
            models: [{ id: "gpt-5.5", name: "gpt-5.5", share: 100, usage: 123, cost: 0 }],
          },
        ]}
        from="2026-05-01"
        to="2026-05-31"
      />,
    );

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /CODEX/i }));
    });

    expect(screen.getByTestId("context-breakdown")).toHaveTextContent(
      "codex:2026-05-01:2026-05-31",
    );
    expect(screen.getByTestId("context-breakdown").closest('[role="region"]'))
      .toHaveClass("tt-provider-expanded-region");
    expect(screen.getByTestId("context-breakdown").closest('[role="region"]'))
      .toHaveAttribute("data-layout", "overlay");
    expect(screen.getByTestId("context-breakdown").closest('[role="region"]')?.parentElement)
      .toHaveClass("tt-provider-card-stage");
    expect(screen.getByTestId("usage-overview-providers"))
      .toHaveClass("tt-overview-provider-panel--expanded");
    expect(breakdownProps[0]).toMatchObject({
      source: "codex",
      from: "2026-05-01",
      to: "2026-05-31",
      referenceTotalTokens: 123,
    });
  });

  it("uses Chinese copy for the Codex context breakdown heading", async () => {
    const user = userEvent.setup();

    render(
      <UsageOverview
        period="month"
        periods={[]}
        summaryLabel="Total"
        summaryValue="123"
        fleetData={[
          {
            source: "codex",
            label: "CODEX",
            totalPercent: "100.0",
            usage: 123,
            usd: 0,
            models: [{ id: "gpt-5.5", name: "gpt-5.5", share: 100, usage: 123, cost: 0 }],
          },
        ]}
        from="2026-05-01"
        to="2026-05-31"
      />,
    );

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /CODEX/i }));
    });

    expect(screen.getByText("Codex 上下文拆解")).toBeInTheDocument();
    expect(screen.queryByText("Codex Context Breakdown")).not.toBeInTheDocument();
  });

  // ───────────────────────────────────────────────────────────────────────
  // Q02: billing filter + badges
  // ───────────────────────────────────────────────────────────────────────

  it("renders the billing filter segmented control with copy-registry labels", () => {
    render(
      <UsageOverview
        period="month"
        periods={[]}
        summaryLabel="Total"
        summaryValue="123"
        fleetData={mixedFleet}
        from="2026-05-01"
        to="2026-05-31"
      />,
    );

    // The aria-label comes from copy('usage.billing_filter.label') which is
    // "计费方式" in the default zh-CN locale.
    const tablist = screen.getByRole("tablist", { name: "计费方式" });
    expect(tablist).toBeInTheDocument();
    // Four tabs: 全部 / API Key / 套餐 / 归属未知.
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "全部",
      "API Key",
      "套餐",
      "归属未知",
    ]);
    // 'all' is the default.
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("shows source-level 混合 badge for mixed providers", () => {
    render(
      <UsageOverview
        period="month"
        periods={[]}
        summaryLabel="Total"
        summaryValue="123"
        fleetData={mixedFleet}
        from="2026-05-01"
        to="2026-05-31"
      />,
    );

    // Both providers are mixed in the fixture; the 混合 badge should appear
    // for each provider card. We can't getByText because the badge text
    // shows in multiple cards, so we assert presence + count.
    const mixedBadges = screen.getAllByText("混合");
    expect(mixedBadges.length).toBeGreaterThanOrEqual(2);
  });

  it("uses copy-registry billing labels for source-level provider badges", () => {
    const fleet = [
      {
        source: "codex",
        label: "CODEX",
        totalPercent: "34.0",
        usage: 340,
        usd: 3.4,
        billingMode: "api_key",
        billingModes: ["api_key"],
        models: [
          { id: "gpt-4o", name: "GPT-4o", share: 100, usage: 340, cost: 3.4, billingMode: "api_key" },
        ],
      },
      {
        source: "claude",
        label: "CLAUDE",
        totalPercent: "33.0",
        usage: 330,
        usd: 3.3,
        billingMode: "token_plan",
        billingModes: ["token_plan"],
        models: [
          { id: "claude-pro", name: "Claude Pro", share: 100, usage: 330, cost: 3.3, billingMode: "token_plan" },
        ],
      },
      {
        source: "cursor",
        label: "CURSOR",
        totalPercent: "33.0",
        usage: 330,
        usd: 3.3,
        billingMode: "unknown",
        billingModes: ["unknown"],
        models: [
          { id: "cursor-unknown", name: "Cursor Unknown", share: 100, usage: 330, cost: 3.3, billingMode: "unknown" },
        ],
      },
    ];

    render(
      <UsageOverview
        period="month"
        periods={[]}
        summaryLabel="Total"
        summaryValue="1,000"
        fleetData={fleet}
        from="2026-05-01"
        to="2026-05-31"
      />,
    );

    expect(screen.getAllByText("API Key").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("套餐").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("归属未知").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("直连")).not.toBeInTheDocument();
    expect(screen.queryByText("未配置计费")).not.toBeInTheDocument();
  });

  it("filters out non-matching models when API Key tab is selected", async () => {
    const user = userEvent.setup();
    render(
      <UsageOverview
        period="month"
        periods={[]}
        summaryLabel="Total"
        summaryValue="123"
        fleetData={mixedFleet}
        from="2026-05-01"
        to="2026-05-31"
      />,
    );

    // Open the codex card so its model rows are rendered.
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /CODEX/i }));
    });
    expect(screen.getByText("GPT-4o")).toBeInTheDocument();
    expect(screen.getByText("GPT-5 Pro")).toBeInTheDocument();

    // Switch to API Key filter.
    await act(async () => {
      await user.click(screen.getByRole("tab", { name: "API Key" }));
    });
    expect(screen.getByText("GPT-4o")).toBeInTheDocument();
    expect(screen.queryByText("GPT-5 Pro")).not.toBeInTheDocument();
  });

  it("shows the empty state when the active filter has no matches", async () => {
    const user = userEvent.setup();
    // Fleet with only api_key models → selecting 归属未知 should drop them all.
    const apiKeyOnlyFleet = [
      {
        source: "codex",
        label: "CODEX",
        totalPercent: "100.0",
        usage: 100,
        usd: 1,
        billingMode: "api_key",
        billingModes: ["api_key"],
        models: [
          { id: "gpt-4o", name: "GPT-4o", share: 100, usage: 100, cost: 1, billingMode: "api_key" },
        ],
      },
    ];

    render(
      <UsageOverview
        period="month"
        periods={[]}
        summaryLabel="Total"
        summaryValue="100"
        fleetData={apiKeyOnlyFleet}
        from="2026-05-01"
        to="2026-05-31"
      />,
    );

    await act(async () => {
      await user.click(screen.getByRole("tab", { name: "归属未知" }));
    });
    // The card disappears AND the empty-state copy is rendered.
    expect(screen.queryByRole("button", { name: /CODEX/i })).not.toBeInTheDocument();
    expect(screen.getByText("当前计费方式下暂无数据")).toBeInTheDocument();
  });

  it("renders the per-model billing badge with copy-registry text in the expanded view", async () => {
    const user = userEvent.setup();
    render(
      <UsageOverview
        period="month"
        periods={[]}
        summaryLabel="Total"
        summaryValue="123"
        fleetData={mixedFleet}
        from="2026-05-01"
        to="2026-05-31"
      />,
    );

    // Open the codex card so its model rows are rendered.
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /CODEX/i }));
    });
    // gpt-4o → api_key badge, gpt-5-pro → 套餐 badge.
    // Both text labels already exist on the page from the filter control,
    // so we assert they're present rather than unique. The expanded view
    // adds more instances.
    const apiKeyBadges = screen.getAllByText("API Key");
    const tokenPlanBadges = screen.getAllByText("套餐");
    // The filter has 1 "API Key" tab and 1 "套餐" tab; the expanded view
    // adds 1 "API Key" badge (gpt-4o) and 1 "套餐" badge (gpt-5-pro). So we
    // expect at least 2 of each.
    expect(apiKeyBadges.length).toBeGreaterThanOrEqual(2);
    expect(tokenPlanBadges.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps Token and cost evidence inside one centered summary card", () => {
    render(
      <UsageOverview
        period="month"
        periods={[]}
        summaryLabel="TOKEN 总数"
        summaryValue="100.3亿"
        summaryCostValue="USD 24,345.45 / CNY 175,287.25"
        fleetData={[]}
        tokenConfidence={{ state: "exact", states: ["exact"], sourceLabel: "本地用量日志" }}
        costConfidence={{
          state: "partial",
          states: ["partial", "estimated"],
          coveragePercent: 97.9,
          unpricedTokens: 215000000,
          unpricedPercent: 2.1,
        }}
      />,
    );

    const summary = screen.getByTestId("usage-overview-summary-card");
    const details = screen.getByTestId("usage-summary-details");

    expect(summary).toContainElement(screen.getByTestId("usage-primary-total"));
    expect(screen.getByTestId("usage-primary-total")).toContainElement(screen.getByTestId("usage-token-wave"));
    expect(screen.getByTestId("usage-token-wave")).toHaveAttribute("viewBox", "0 0 728 260");
    expect(summary).toHaveClass("flex", "flex-1", "flex-col");
    expect(screen.getByTestId("usage-primary-total")).toHaveClass("flex-1");
    expect(summary.closest(".tt-surface").firstElementChild).toHaveClass(
      "flex",
      "h-full",
      "flex-col",
    );
    expect(summary).toContainElement(details);
    expect(details).toHaveClass(
      "border-t",
      "grid",
      "sm:grid-cols-2",
    );
    expect(details).not.toHaveClass("divide-y");
    expect(screen.getByTestId("usage-primary-total")).toHaveClass("text-center");
    expect(screen.getByTestId("usage-primary-total").querySelector(".text-7xl")).not.toBeNull();
    expect(screen.getByTestId("usage-token-summary")).toHaveClass(
      "grid-rows-[1.25rem_1.5rem]",
    );
    expect(screen.getByTestId("usage-cost-summary")).toHaveClass(
      "grid-rows-[1.25rem_1.5rem]",
      "sm:border-l",
    );
    expect(screen.getByTestId("usage-token-summary")).not.toHaveClass("flex-wrap");
    expect(screen.getByTestId("usage-cost-summary")).not.toHaveClass("flex-wrap");
    expect(screen.getByTestId("usage-token-summary-heading")).toBeVisible();
    expect(screen.getByTestId("usage-cost-summary-heading")).toHaveTextContent(
      "USD 24,345.45 / CNY 175,287.25",
    );
    expect(screen.getByTestId("usage-cost-summary")).toHaveTextContent(
      "USD 24,345.45 / CNY 175,287.25",
    );
    expect(screen.getByTestId("usage-token-confidence")).toHaveAttribute("data-confidence-state", "exact");
    expect(screen.getByTestId("usage-cost-confidence")).toHaveAttribute("data-confidence-state", "partial");
  });

  it("matches the reference overview by separating the hero and provider surfaces", () => {
    const { container } = render(
      <UsageOverview
        period="total"
        periods={[{ key: "total", label: "Total" }]}
        summaryLabel="TOKEN total"
        summaryValue="1,000"
        fleetData={mixedFleet}
      />,
    );

    expect(container.firstChild).toHaveClass("tt-overview-usage");
    expect(screen.getByTestId("usage-overview-hero")).toHaveClass("tt-surface");
    expect(screen.getByTestId("usage-overview-providers")).toHaveClass("tt-surface");
    expect(screen.getByTestId("usage-overview-hero")).not.toBe(
      screen.getByTestId("usage-overview-providers"),
    );
    expect(screen.queryByTestId("usage-hero-footer-well")).not.toBeInTheDocument();
  });

  it("separates the Token total number and unit for reference typography", () => {
    render(
      <UsageOverview
        period="total"
        periods={[{ key: "total", label: "总计" }]}
        summaryLabel="TOKEN 总数"
        summaryValue="124亿"
        summaryCostValue="USD 3,867.29 / CNY 27,844.47"
        fleetData={[]}
        tokenConfidence={{ state: "exact", states: ["exact"], sourceLabel: "本地用量日志" }}
        costConfidence={{ state: "estimated", states: ["estimated"] }}
      />,
    );

    expect(screen.getByTestId("usage-summary-value")).toHaveAttribute("aria-label", "124亿");
    expect(screen.getByTestId("usage-summary-number")).toHaveTextContent("124");
    expect(screen.getByTestId("usage-summary-unit")).toHaveTextContent("亿");
  });

  it("keeps unknown WorkBuddy Credits distinct from exact zero without exposing account fields", async () => {
    getWorkbuddyQuotaMock.mockResolvedValueOnce({
      signed_in: true,
      plan: "PRO",
      account: {
        nickname: "SYNTHETIC_PRIVATE_NICKNAME",
        phone_masked: "SYNTHETIC_PRIVATE_PHONE",
        type: "synthetic",
      },
      groups: [
        {
          id: "base",
          items: null,
          total: null,
          remain: null,
          used: null,
          used_percent: null,
        },
        {
          id: "extra",
          items: 1,
          total: 100,
          remain: 0,
          used: 100,
          used_percent: 100,
        },
      ],
    });
    const user = userEvent.setup();

    render(
      <UsageOverview
        period="total"
        periods={[{ key: "total", label: "Total" }]}
        summaryLabel="Total"
        summaryValue="100"
        fleetData={[
          {
            source: "workbuddy",
            label: "WorkBuddy",
            totalPercent: "100.0",
            usage: 100,
            usd: 0,
            billingMode: "token_plan",
            billingModes: ["token_plan"],
            models: [{ id: "workbuddy", name: "WorkBuddy", share: 100, usage: 100, cost: 0 }],
          },
        ]}
      />,
    );

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /WorkBuddy/i }));
    });
    const section = await screen.findByTestId("workbuddy-quota-section");
    const rows = within(section).getAllByTestId("workbuddy-credit-row");
    const unknownRow = rows.find((row) => row.dataset.group === "base");
    const zeroRow = rows.find((row) => row.dataset.group === "extra");

    expect(unknownRow).toHaveTextContent(copy("data_sources.unknown"));
    expect(unknownRow).not.toHaveTextContent("null");
    expect(unknownRow).not.toHaveTextContent(
      copy("limits.workbuddy.credits_remaining", { remain: "0", total: "0" }),
    );
    expect(within(unknownRow).getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(within(unknownRow).getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      copy("data_sources.unknown"),
    );
    expect(zeroRow).toHaveTextContent(
      copy("limits.workbuddy.credits_remaining", { remain: "0", total: "100" }),
    );
    expect(section).toHaveTextContent("SYNTHETIC_PRIVATE_NICKNAME");
    expect(section).toHaveTextContent("SYNTHETIC_PRIVATE_PHONE");
  });

  it("shows a fixed WorkBuddy unreadable state instead of a blank quota section", async () => {
    getWorkbuddyQuotaMock.mockResolvedValueOnce({
      signed_in: null,
      plan: null,
      groups: [],
      fetched_at: null,
      error: "unavailable",
    });
    const user = userEvent.setup();
    render(
      <UsageOverview
        period="total"
        periods={[{ key: "total", label: "Total" }]}
        summaryLabel="Total"
        summaryValue="100"
        fleetData={[{
          source: "workbuddy",
          label: "WorkBuddy",
          totalPercent: "100.0",
          usage: 100,
          usd: null,
          billingMode: "token_plan",
          billingModes: ["token_plan"],
          models: [{ id: "workbuddy", name: "WorkBuddy", share: 100, usage: 100, cost: null }],
        }]}
      />,
    );

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /WorkBuddy/i }));
    });

    expect(await screen.findByTestId("workbuddy-quota-status")).toHaveTextContent(
      copy("limits.workbuddy.error_fetch"),
    );
  });
});
