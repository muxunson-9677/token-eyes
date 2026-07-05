import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UsageOverview } from "../UsageOverview.jsx";

const breakdownProps = [];

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

describe("UsageOverview", () => {
  it("passes the overview usage range to Codex context breakdown", async () => {
    breakdownProps.length = 0;
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

    expect(screen.getByTestId("context-breakdown")).toHaveTextContent(
      "codex:2026-05-01:2026-05-31",
    );
    expect(breakdownProps[0]).toMatchObject({
      source: "codex",
      from: "2026-05-01",
      to: "2026-05-31",
      referenceTotalTokens: 123,
    });
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
    // Four tabs: 全部 / API Key / 套餐 / 未标注.
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "全部",
      "API Key",
      "套餐",
      "未标注",
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
    // Fleet with only api_key models → selecting 未标注 should drop them all.
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
      await user.click(screen.getByRole("tab", { name: "未标注" }));
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
});
