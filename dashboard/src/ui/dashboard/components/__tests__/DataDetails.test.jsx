import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { copy } from "../../../../lib/copy";
import { render } from "../../../../test/test-utils";
import { DataDetails } from "../DataDetails.jsx";

// Locale-independent tab finder: DataDetails renders the projects tab label
// via copy("dashboard.projects.title"), so we match on the same value.
async function clickProjectsTab() {
  const user = userEvent.setup();
  const label = copy("dashboard.projects.title");
  const tab = screen.getByRole("tab", { name: label });
  await user.click(tab);
}

// Integration test for the PRODUCTION component tree (DataDetails projects tab).
// Unlike the isolated ProjectUsagePanel.test.jsx, this renders the real
// DataDetails card that DashboardView mounts, and verifies that project path,
// cost, pricing coverage, remote repo and "no path" hint all reach the DOM
// through the production wiring — not just an orphan component.

function makeEntry(overrides = {}) {
  return {
    project_key: "base",
    project_name: "Base Project",
    project_path: "",
    path_kind: "unknown",
    path_status: "not_detected",
    project_ref: "",
    total_tokens: "1000",
    billable_total_tokens: "1000",
    cost_usd: "0",
    priced_tokens: "0",
    unpriced_tokens: "1000",
    pricing_coverage: "unpriced",
    request_count: "1",
    last_active_at: null,
    ...overrides,
  };
}

// Minimal daily-tab props so DataDetails doesn't crash on initial render
// (initial activeTab is "daily"; we click "projects" right away).
const dailyProps = {
  copy,
  hasDetailsActual: false,
  dailyEmptyPrefix: "",
  installSyncCmd: "",
  dailyEmptySuffix: "",
  detailsColumns: [],
  ariaSortFor: () => "none",
  toggleSort: () => {},
  sortIconFor: () => "",
  pagedDetails: [],
  dailyBreakdownRows: [],
  dailyBreakdownColumns: [],
  dailyBreakdownAriaSortFor: () => "none",
  dailyBreakdownSortIconFor: () => "",
  dailyBreakdownDateKey: "day",
  detailsDateKey: "day",
  renderDetailDate: (r) => r?.day || "",
  renderDailyBreakdownDate: (r) => r?.day || "",
  renderDetailCell: () => "",
  DETAILS_PAGED_PERIODS: new Set(),
  period: "7d",
  detailsPageCount: 0,
  detailsPage: 0,
  setDetailsPage: () => {},
};

describe("DataDetails projects tab (production component tree)", () => {
  beforeEach(() => {
    document.documentElement.classList.add("screenshot-capture");
  });
  afterEach(() => {
    document.documentElement.classList.remove("screenshot-capture");
  });

  it("renders real local path, cost, pricing status and remote repo for a fully-priced project with a path", async () => {
    const entries = [
      makeEntry({
        project_key: "owner/win-app",
        project_name: "Win App",
        project_path: "C:\\Users\\dev\\win-app",
        path_kind: "windows",
        path_status: "detected",
        project_ref: "https://github.com/owner/win-app",
        total_tokens: "50000",
        billable_total_tokens: "50000",
        cost_usd: "1.23",
        priced_tokens: "50000",
        unpriced_tokens: "0",
        pricing_coverage: "complete",
        request_count: "10",
        last_active_at: "2026-06-29T10:00:00Z",
      }),
    ];

    render(
      <DataDetails
        {...dailyProps}
        projectEntries={entries}
        projectLimit={10}
      />,
    );

    await clickProjectsTab();

    // Real local path must appear in the DOM
    expect(screen.getByText(/C:\\Users\\dev\\win-app/)).toBeInTheDocument();
    // Cost must appear (not hidden)
    expect(screen.getByText(/\$1\.2300/)).toBeInTheDocument();
    // Pricing status must appear
    expect(screen.getByText(copy("dashboard.projects.pricing_complete"))).toBeInTheDocument();
    // Remote repo info must appear somewhere in the card
    expect(screen.getByText(/github\.com\/owner\/win-app/)).toBeInTheDocument();
  });

  it("shows 'no path' hint and remote repo (not as local path) for a project with only a remote repo", async () => {
    const entries = [
      makeEntry({
        project_key: "owner/repo-only",
        project_name: "Repo Only",
        project_path: "",
        path_kind: "unknown",
        path_status: "not_detected",
        project_ref: "https://github.com/owner/repo-only",
        total_tokens: "30000",
        billable_total_tokens: "30000",
        cost_usd: "0.5",
        priced_tokens: "30000",
        unpriced_tokens: "0",
        pricing_coverage: "complete",
        request_count: "5",
      }),
    ];

    const { container } = render(
      <DataDetails
        {...dailyProps}
        projectEntries={entries}
        projectLimit={10}
      />,
    );

    await clickProjectsTab();

    // Missing local path is omitted; the remote repository remains visible.
    expect(screen.queryByText(copy("dashboard.projects.no_path"))).not.toBeInTheDocument();

    // Remote repo URL must appear somewhere as remote repo info
    expect(screen.getByText(/github\.com\/owner\/repo-only/)).toBeInTheDocument();

    // CRITICAL: the remote https:// URL must NOT appear in the local-path
    // position. No local-path slot is rendered for the missing value.
    const pathHolders = container.querySelectorAll('[data-slot="project-path"]');
    expect(pathHolders).toHaveLength(0);
    pathHolders.forEach((el) => {
      expect(el.textContent).not.toContain("https://");
      expect(el.textContent).not.toContain("github.com");
    });
  });

  it("does not render unpriced projects as real $0.0000 cost", async () => {
    const entries = [
      makeEntry({
        project_key: "owner/unpriced",
        project_name: "Unpriced Proj",
        project_path: "/home/user/unpriced",
        path_kind: "posix",
        path_status: "detected",
        project_ref: "",
        total_tokens: "20000",
        billable_total_tokens: "20000",
        cost_usd: "0",
        priced_tokens: "0",
        unpriced_tokens: "20000",
        pricing_coverage: "unpriced",
        request_count: "3",
      }),
    ];

    render(
      <DataDetails
        {...dailyProps}
        projectEntries={entries}
        projectLimit={10}
      />,
    );

    await clickProjectsTab();

    // "Unpriced" pricing label must appear
    expect(screen.getByText(copy("dashboard.projects.pricing_unpriced"))).toBeInTheDocument();

    // Must NOT show a real dollar cost for an unpriced project
    expect(screen.queryByText(/\$0\.0000/)).not.toBeInTheDocument();
  });

  it("renders all three project categories together in the real page node", async () => {
    const entries = [
      makeEntry({
        project_key: "owner/priced-with-path",
        project_name: "Priced With Path",
        project_path: "D:\\code\\priced",
        path_kind: "windows",
        path_status: "detected",
        project_ref: "https://github.com/owner/priced-with-path",
        total_tokens: "100000",
        billable_total_tokens: "100000",
        cost_usd: "5.67",
        priced_tokens: "100000",
        unpriced_tokens: "0",
        pricing_coverage: "complete",
      }),
      makeEntry({
        project_key: "owner/repo-no-path",
        project_name: "Repo No Path",
        project_path: "",
        path_kind: "unknown",
        path_status: "not_detected",
        project_ref: "https://github.com/owner/repo-no-path",
        total_tokens: "50000",
        billable_total_tokens: "50000",
        cost_usd: "2.34",
        pricing_coverage: "complete",
      }),
      makeEntry({
        project_key: "owner/unpriced",
        project_name: "Unpriced One",
        project_path: "/Users/dev/unpriced",
        path_kind: "posix",
        path_status: "detected",
        project_ref: "",
        total_tokens: "20000",
        billable_total_tokens: "20000",
        cost_usd: "0",
        pricing_coverage: "unpriced",
      }),
    ];

    render(
      <DataDetails
        {...dailyProps}
        projectEntries={entries}
        projectLimit={10}
      />,
    );

    await clickProjectsTab();

    // Category 1: real path + priced
    expect(screen.getByText(/D:\\code\\priced/)).toBeInTheDocument();
    expect(screen.getByText(/\$5\.6700/)).toBeInTheDocument();

    // Category 2: missing local path is hidden; remote repo remains visible.
    expect(screen.queryByText(copy("dashboard.projects.no_path"))).not.toBeInTheDocument();
    expect(screen.getByText(/github\.com\/owner\/repo-no-path/)).toBeInTheDocument();

    // Category 3: unpriced (label visible, no real $0.0000)
    expect(screen.getByText(copy("dashboard.projects.pricing_unpriced"))).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.0000/)).not.toBeInTheDocument();

    // Real POSIX path appears too
    expect(screen.getByText(/\/Users\/dev\/unpriced/)).toBeInTheDocument();
  });
});

describe("DataDetails daily rows", () => {
  it("shows a plain empty state without an initialization or sync command card", () => {
    const { container } = render(
      <DataDetails
        {...dailyProps}
        dailyEmptyMessage="当前范围暂无活动数据，请先使用 AI CLI，然后点击刷新。"
        dailyEmptyPrefix="本地服务已连接，请运行："
        installSyncCmd="npx --yes tokentracker-cli init"
        dailyEmptySuffix=""
      />,
    );

    expect(screen.getByText("当前范围暂无活动数据，请先使用 AI CLI，然后点击刷新。")).toBeInTheDocument();
    expect(container.querySelector("code")).toBeNull();
    expect(container).not.toHaveTextContent("tokentracker-cli");
  });

  it("uses semantic icons for both daily and project view tabs", async () => {
    render(<DataDetails {...dailyProps} />);

    const dailyTab = screen.getByRole("tab", { name: copy("dashboard.daily.title") });
    const projectsTab = screen.getByRole("tab", { name: copy("dashboard.projects.title") });
    expect(dailyTab).toHaveClass(
      "tt-analytics-focusable",
      "tt-pressable",
      "rounded-[var(--tt-control-radius)]",
    );
    expect(projectsTab).toHaveClass(
      "tt-analytics-focusable",
      "tt-pressable",
      "rounded-[var(--tt-control-radius)]",
    );
    expect(dailyTab.querySelector("svg")).not.toBeNull();
    expect(projectsTab.querySelector("svg")).not.toBeNull();
  });

  it("omits days with no recorded usage instead of rendering an all-placeholder row", () => {
    const { container } = render(
      <DataDetails
        {...dailyProps}
        dailyBreakdownColumns={[{ key: "day", label: "Date" }]}
        dailyBreakdownRows={[
          { day: "2026-07-24", total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0 },
          { day: "2026-07-25", total_tokens: 120, input_tokens: 100, output_tokens: 20, cached_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 1 },
        ]}
        renderDetailCell={(row, key) => String(row[key] ?? "")}
      />,
    );

    expect(container.firstChild).toHaveClass("tt-surface-nested");
    expect(container.firstChild).toHaveClass("h-full", "min-h-0");
    expect(container.firstChild.firstElementChild).toHaveClass("flex", "h-full", "min-h-0", "flex-col");
    expect(container.firstChild).not.toHaveClass("tt-surface");
    expect(screen.queryByText("2026-07-24")).not.toBeInTheDocument();
    expect(screen.getByText("2026-07-25")).toBeInTheDocument();
  });
});
