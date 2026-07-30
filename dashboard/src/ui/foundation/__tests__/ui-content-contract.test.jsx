import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBaselineJobs } from "../../../../scripts/visual-baseline-config.js";
import { copy, setCopyLocale } from "../../../lib/copy";
import { DataDetails } from "../../dashboard/components/DataDetails.jsx";
import { UsageStatsPanel } from "../../dashboard/components/UsageStatsPanel.jsx";

const usageSummary = {
  totals: {
    total_tokens: 150,
    input_tokens: 100,
    output_tokens: 50,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    request_count: 1,
    cost_usd: 0.01,
    cache_hit_rate: 0,
  },
};

const costSummary = {
  api_usd: 0.01,
  api_cny: 0.07,
  subscription_usd: 0,
  subscription_cny: 0,
  combined_usd: 0.01,
  combined_cny: 0.07,
  lifetime_combined_usd: 0.01,
  lifetime_combined_cny: 0.07,
};

const dailyColumns = [
  "day",
  "total_tokens",
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "reasoning_output_tokens",
  "conversation_count",
].map((key) => ({ key, label: key }));

const dailyRow = {
  day: "2025-12-31",
  total_tokens: 150,
  input_tokens: 100,
  output_tokens: 50,
  cached_input_tokens: 0,
  reasoning_output_tokens: 0,
  conversation_count: 1,
};

function UsageContentFixture() {
  return (
    <>
      <UsageStatsPanel summary={usageSummary} costSummary={costSummary} />
      <DataDetails
        copy={copy}
        dailyEmptyPrefix=""
        installSyncCmd=""
        dailyEmptySuffix=""
        dailyBreakdownRows={[dailyRow]}
        dailyBreakdownColumns={dailyColumns}
        dailyBreakdownAriaSortFor={() => "none"}
        dailyBreakdownSortIconFor={() => ""}
        dailyBreakdownDateKey="day"
        renderDailyBreakdownDate={(row) => row.day}
        renderDetailCell={(row, key) => String(row[key])}
        toggleSort={() => {}}
        DETAILS_PAGED_PERIODS={new Set()}
        period="7d"
        detailsPageCount={1}
        detailsPage={0}
        setDetailsPage={() => {}}
      />
    </>
  );
}

function directTexts(container) {
  return Array.from(container.querySelectorAll("*"))
    .flatMap((element) => Array.from(element.childNodes))
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent.trim())
    .filter(Boolean);
}

function captureContentContract(theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  const view = render(<UsageContentFixture />);
  const contract = {
    texts: directTexts(view.container),
    buttonCount: view.container.querySelectorAll("button").length,
    tableRowCount: view.container.querySelectorAll("tr").length,
    testIds: Array.from(view.container.querySelectorAll("[data-testid]"))
      .map((element) => element.getAttribute("data-testid"))
      .sort(),
  };
  view.unmount();
  return contract;
}

describe("visual baseline contract", () => {
  it("captures usage statistics in light, dark, and narrow-window modes", () => {
    const baseUrl = "http://localhost:5173";
    const jobs = createBaselineJobs(baseUrl);

    expect(jobs).toEqual(expect.arrayContaining([
      {
        name: "spend-usage-light-1180",
        url: `${baseUrl}/spend/usage?screenshot=1&theme=light&mock=1&mock_seed=baseline&mock_today=2025-12-31&mock_now=2025-12-31T12:00:00Z`,
        width: 1180,
        height: 760,
        dpr: 1,
      },
      {
        name: "spend-usage-dark-1180",
        url: `${baseUrl}/spend/usage?screenshot=1&theme=dark&mock=1&mock_seed=baseline&mock_today=2025-12-31&mock_now=2025-12-31T12:00:00Z`,
        width: 1180,
        height: 760,
        dpr: 1,
      },
      {
        name: "spend-usage-narrow-390",
        url: `${baseUrl}/spend/usage?screenshot=1&theme=light&mock=1&mock_seed=baseline&mock_today=2025-12-31&mock_now=2025-12-31T12:00:00Z`,
        width: 390,
        height: 844,
        dpr: 2,
      },
    ]));
  });
});

describe("theme content contract", () => {
  beforeEach(() => {
    setCopyLocale("zh-CN");
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("keeps usage text and controls identical across light and dark roots", () => {
    const light = captureContentContract("light");
    const dark = captureContentContract("dark");

    expect(dark.texts).toEqual(light.texts);
    expect(dark.buttonCount).toBe(light.buttonCount);
    expect(dark.tableRowCount).toBe(light.tableRowCount);
    expect(dark.testIds).toEqual(light.testIds);
  });
});

describe("usage statistics content contract", () => {
  beforeEach(() => {
    setCopyLocale("zh-CN");
  });

  it("preserves dimension labels and semantic hooks", () => {
    render(<UsageStatsPanel summary={usageSummary} costSummary={costSummary} />);

    expect(screen.getByText(copy("ticket02.stats.input"))).toBeInTheDocument();
    expect(screen.getByText(copy("ticket02.stats.output"))).toBeInTheDocument();
    expect(screen.getByText(copy("ticket02.stats.cache_create"))).toBeInTheDocument();
    expect(screen.getByText(copy("ticket02.stats.cache_hit"))).toBeInTheDocument();
    expect(screen.getByTestId("usage-cost-summary")).toBeInTheDocument();
    expect(screen.getAllByTestId("usage-dimension-icon")).toHaveLength(4);
  });
});
