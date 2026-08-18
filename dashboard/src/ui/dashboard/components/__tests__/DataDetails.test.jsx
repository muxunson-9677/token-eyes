import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { copy } from "../../../../lib/copy";
import { render } from "../../../../test/test-utils";
import { buildDailyOverlayCacheKey, DataDetails } from "../DataDetails.jsx";

// Locale-independent tab finder: DataDetails renders the projects tab label
// via copy("dashboard.projects.title"), so we match on the same value.
async function clickProjectsTab() {
  const user = userEvent.setup();
  const label = copy("dashboard.projects.title");
  const tab = screen.getByRole("tab", { name: label });
  await act(async () => user.click(tab));
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const dailyRowsWithUsage = [{ day: "2026-08-07", total_tokens: 120 }];
const dailyColumns = [{ key: "day", label: "Date" }];

function dailyScope(overrides = {}) {
  return {
    accountId: "account-a",
    mode: "local",
    baseUrl: "http://127.0.0.1:7680",
    timeZone: "UTC",
    tzOffsetMinutes: 0,
    sources: ["codex", "claude"],
    ...overrides,
  };
}

async function openDailyOverlay(user) {
  await act(async () => user.click(within(screen.getByRole("table")).getByText("2026-08-07")));
}

describe("DataDetails projects tab (production component tree)", () => {
  it("uses one permanently reserved scroll viewport for project disclosure", async () => {
    render(<DataDetails {...dailyProps} projectEntries={[makeEntry()]} projectLimit={3} />);

    await clickProjectsTab();

    expect(screen.getByTestId("project-scroll-viewport")).toHaveClass("overflow-y-scroll");
    expect(screen.getByTestId("project-usage-grid")).toHaveClass("tt-overview-project-grid--stable");
  });

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
  it("builds a canonical daily overlay cache key from every observable request input", () => {
    const base = dailyScope();
    const canonical = buildDailyOverlayCacheKey("2026-08-07", base);

    expect(buildDailyOverlayCacheKey("2026-08-07", { ...base, sources: [" CLAUDE ", "Codex", "codex"] })).toBe(canonical);
    expect(buildDailyOverlayCacheKey("2026-08-08", base)).not.toBe(canonical);
    expect(buildDailyOverlayCacheKey("2026-08-07", { ...base, accountId: "account-b" })).not.toBe(canonical);
    expect(buildDailyOverlayCacheKey("2026-08-07", { ...base, mode: "cloud" })).not.toBe(canonical);
    expect(buildDailyOverlayCacheKey("2026-08-07", { ...base, baseUrl: "https://usage.example.test" })).not.toBe(canonical);
    expect(buildDailyOverlayCacheKey("2026-08-07", { ...base, timeZone: "Asia/Shanghai" })).not.toBe(canonical);
    expect(buildDailyOverlayCacheKey("2026-08-07", { ...base, tzOffsetMinutes: 480 })).not.toBe(canonical);
    expect(buildDailyOverlayCacheKey("2026-08-07", { ...base, sources: ["codex"] })).not.toBe(canonical);
    expect(buildDailyOverlayCacheKey("2026-08-07", { ...base, sources: null })).toBe(
      buildDailyOverlayCacheKey("2026-08-07", { ...base, sources: [] }),
    );
  });

  it("invalidates an in-flight request when the loader identity changes inside the same scope", async () => {
    const user = userEvent.setup();
    const oldRequest = deferred();
    const newRequest = deferred();
    let oldSignal;
    const oldLoader = vi.fn((_day, options) => {
      oldSignal = options.signal;
      return oldRequest.promise;
    });
    const newLoader = vi.fn(() => newRequest.promise);
    const scope = dailyScope();
    const { rerender } = render(
      <DataDetails
        {...dailyProps}
        dailyBreakdownRows={dailyRowsWithUsage}
        dailyBreakdownColumns={dailyColumns}
        renderDetailCell={(row, key) => String(row[key] ?? 0)}
        dailyBreakdownScope={scope}
        onLoadDailyModelBreakdown={oldLoader}
      />,
    );

    await openDailyOverlay(user);
    rerender(
      <DataDetails
        {...dailyProps}
        dailyBreakdownRows={dailyRowsWithUsage}
        dailyBreakdownColumns={dailyColumns}
        renderDetailCell={(row, key) => String(row[key] ?? 0)}
        dailyBreakdownScope={scope}
        onLoadDailyModelBreakdown={newLoader}
      />,
    );

    expect(oldSignal.aborted).toBe(true);
    expect(screen.queryByTestId("daily-breakdown-overlay")).not.toBeInTheDocument();
    await openDailyOverlay(user);

    await act(async () => {
      newRequest.resolve({ sources: [{ source: "claude", totals: { total_tokens: 120 }, models: [] }] });
      await newRequest.promise;
    });
    await act(async () => {
      oldRequest.resolve({ sources: [{ source: "codex", totals: { total_tokens: 120 }, models: [] }] });
      await oldRequest.promise;
    });

    expect(screen.getByTestId("daily-breakdown-overlay")).toHaveTextContent("Claude");
    expect(screen.getByTestId("daily-breakdown-overlay")).not.toHaveTextContent("Codex");
  });

  it("isolates same-day cache entries by scope and ignores reverse-order stale completions", async () => {
    const user = userEvent.setup();
    const accountA = deferred();
    const accountB = deferred();
    const loadA = vi.fn(() => accountA.promise);
    const loadB = vi.fn(() => accountB.promise);
    const { rerender } = render(
      <DataDetails
        {...dailyProps}
        dailyBreakdownRows={dailyRowsWithUsage}
        dailyBreakdownColumns={dailyColumns}
        renderDetailCell={(row, key) => String(row[key] ?? 0)}
        dailyBreakdownScope={dailyScope()}
        onLoadDailyModelBreakdown={loadA}
      />,
    );

    await openDailyOverlay(user);
    expect(loadA).toHaveBeenCalledTimes(1);

    rerender(
      <DataDetails
        {...dailyProps}
        dailyBreakdownRows={dailyRowsWithUsage}
        dailyBreakdownColumns={dailyColumns}
        renderDetailCell={(row, key) => String(row[key] ?? 0)}
        dailyBreakdownScope={dailyScope({
          accountId: "account-b",
          mode: "cloud",
          baseUrl: "https://usage.example.test",
          timeZone: "Asia/Shanghai",
          tzOffsetMinutes: 480,
          sources: ["gemini"],
        })}
        onLoadDailyModelBreakdown={loadB}
      />,
    );

    expect(screen.queryByTestId("daily-breakdown-overlay")).not.toBeInTheDocument();
    await openDailyOverlay(user);
    expect(loadB).toHaveBeenCalledTimes(1);

    await act(async () => {
      accountB.resolve({ sources: [{ source: "gemini", totals: { total_tokens: 120 }, models: [] }] });
      await accountB.promise;
    });
    expect(await screen.findByTestId("daily-breakdown-overlay")).toHaveTextContent("Gemini");

    await act(async () => {
      accountA.resolve({ sources: [{ source: "codex", totals: { total_tokens: 120 }, models: [] }] });
      await accountA.promise;
    });
    expect(screen.getByTestId("daily-breakdown-overlay")).toHaveTextContent("Gemini");
    expect(screen.getByTestId("daily-breakdown-overlay")).not.toHaveTextContent("Codex");

    await openDailyOverlay(user);
    await openDailyOverlay(user);
    expect(loadB).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("daily-breakdown-overlay")).toHaveTextContent("Gemini");
  });

  it("cancels the old day when a different day is opened before it completes", async () => {
    const user = userEvent.setup();
    const first = deferred();
    const second = deferred();
    let firstSignal;
    const loader = vi.fn((day, options) => {
      if (day === "2026-08-07") {
        firstSignal = options.signal;
        return first.promise;
      }
      return second.promise;
    });
    render(
      <DataDetails
        {...dailyProps}
        dailyBreakdownRows={[
          { day: "2026-08-07", total_tokens: 120 },
          { day: "2026-08-06", total_tokens: 80 },
        ]}
        dailyBreakdownColumns={dailyColumns}
        renderDetailCell={(row, key) => String(row[key] ?? 0)}
        dailyBreakdownScope={dailyScope()}
        onLoadDailyModelBreakdown={loader}
      />,
    );

    await act(async () => user.click(within(screen.getByRole("table")).getByText("2026-08-06")));
    await act(async () => {
      second.resolve({ sources: [{ source: "claude", totals: { total_tokens: 80 }, models: [] }] });
      await second.promise;
    });
    expect(await screen.findByTestId("daily-breakdown-overlay")).toHaveTextContent("2026-08-06");
    expect(screen.getByTestId("daily-breakdown-overlay")).toHaveTextContent("Claude");
    await act(async () => user.click(within(screen.getByRole("table")).getByText("2026-08-06")));

    await act(async () => user.click(within(screen.getByRole("table")).getByText("2026-08-07")));
    await act(async () => user.click(within(screen.getByRole("table")).getByText("2026-08-06")));
    expect(firstSignal.aborted).toBe(true);
    expect(loader.mock.calls.filter(([day]) => day === "2026-08-06")).toHaveLength(1);
    expect(screen.getByTestId("daily-breakdown-overlay")).toHaveTextContent("Claude");

    await act(async () => {
      first.resolve({ sources: [{ source: "codex", totals: { total_tokens: 120 }, models: [] }] });
      await first.promise;
    });
    expect(screen.getByTestId("daily-breakdown-overlay")).toHaveTextContent("Claude");
    expect(screen.getByTestId("daily-breakdown-overlay")).not.toHaveTextContent("Codex");
  });

  it("keeps a newer success when an older request fails and aborts work on scope change or unmount", async () => {
    const user = userEvent.setup();
    const oldRequest = deferred();
    const newRequest = deferred();
    let oldSignal;
    let newSignal;
    const loadOld = vi.fn((_day, options) => {
      oldSignal = options.signal;
      return oldRequest.promise;
    });
    const loadNew = vi.fn((_day, options) => {
      newSignal = options.signal;
      return newRequest.promise;
    });
    const { rerender, unmount } = render(
      <DataDetails
        {...dailyProps}
        dailyBreakdownRows={dailyRowsWithUsage}
        dailyBreakdownColumns={dailyColumns}
        renderDetailCell={(row, key) => String(row[key] ?? 0)}
        dailyBreakdownScope={dailyScope()}
        onLoadDailyModelBreakdown={loadOld}
      />,
    );

    await openDailyOverlay(user);
    rerender(
      <DataDetails
        {...dailyProps}
        dailyBreakdownRows={dailyRowsWithUsage}
        dailyBreakdownColumns={dailyColumns}
        renderDetailCell={(row, key) => String(row[key] ?? 0)}
        dailyBreakdownScope={dailyScope({ timeZone: "Asia/Shanghai", tzOffsetMinutes: 480 })}
        onLoadDailyModelBreakdown={loadNew}
      />,
    );
    expect(oldSignal.aborted).toBe(true);

    await openDailyOverlay(user);
    await act(async () => {
      newRequest.resolve({ sources: [{ source: "claude", totals: { total_tokens: 120 }, models: [] }] });
      await newRequest.promise;
    });
    expect(await screen.findByTestId("daily-breakdown-overlay")).toHaveTextContent("Claude");

    await act(async () => {
      oldRequest.reject(new Error("old request failed"));
      try { await oldRequest.promise; } catch { /* expected */ }
    });
    expect(screen.getByTestId("daily-breakdown-overlay")).toHaveTextContent("Claude");
    expect(screen.getByTestId("daily-breakdown-overlay")).not.toHaveTextContent(copy("dashboard.daily.overlay_error"));

    const pendingAtUnmount = deferred();
    let unmountSignal;
    rerender(
      <DataDetails
        {...dailyProps}
        dailyBreakdownRows={dailyRowsWithUsage}
        dailyBreakdownColumns={dailyColumns}
        renderDetailCell={(row, key) => String(row[key] ?? 0)}
        dailyBreakdownScope={dailyScope({ baseUrl: "http://127.0.0.1:9000" })}
        onLoadDailyModelBreakdown={vi.fn((_day, options) => {
          unmountSignal = options.signal;
          return pendingAtUnmount.promise;
        })}
      />,
    );
    await openDailyOverlay(user);
    unmount();
    expect(unmountSignal.aborted).toBe(true);
  });

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
    const { container } = render(<DataDetails {...dailyProps} />);

    expect(container.firstChild).toHaveClass("tt-pressable-parent");

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

  it("keeps the daily pagination bar visible and switches table pages", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 11 }, (_, index) => ({
      day: `2026-08-${String(11 - index).padStart(2, "0")}`,
      total_tokens: index + 1,
    }));

    render(
      <DataDetails
        {...dailyProps}
        dailyBreakdownColumns={[{ key: "day", label: "Date" }]}
        dailyBreakdownRows={rows}
        renderDetailCell={(row, key) => String(row[key] ?? "")}
      />,
    );

    expect(screen.getByTestId("daily-pagination-total")).toHaveTextContent("11");
    expect(screen.getByTestId("daily-pagination")).toHaveClass("tt-overview-pagination");
    expect(screen.getByText("2026-08-11")).toBeInTheDocument();

    await act(async () => user.click(screen.getByRole("button", { name: "2" })));

    expect(screen.getByText("2026-08-01")).toBeInTheDocument();
    expect(screen.queryByText("2026-08-11")).not.toBeInTheDocument();
  });

  it("restores the accepted daily summary, date range and yesterday comparison column", () => {
    render(
      <DataDetails
        {...dailyProps}
        dailyBreakdownColumns={[
          { key: "day", label: "日期" },
          { key: "total_tokens", label: "总计" },
          { key: "input_tokens", label: "输入" },
          { key: "output_tokens", label: "输出" },
          { key: "cached_input_tokens", label: "缓存" },
          { key: "reasoning_output_tokens", label: "推理" },
          { key: "conversation_count", label: "对话数" },
        ]}
        dailyBreakdownRows={[
          { day: "2026-08-07", total_tokens: 200, input_tokens: 10, output_tokens: 20, cached_input_tokens: 150, reasoning_output_tokens: 20, conversation_count: 2 },
          { day: "2026-08-06", total_tokens: 100, input_tokens: 10, output_tokens: 10, cached_input_tokens: 70, reasoning_output_tokens: 10, conversation_count: 1 },
        ]}
        renderDetailCell={(row, key) => String(row[key] ?? "")}
      />,
    );

    expect(screen.getByTestId("daily-summary-peak")).toHaveTextContent("200");
    expect(screen.getByTestId("daily-summary-average")).toHaveTextContent("150");
    expect(screen.getByTestId("daily-summary-active-days")).toHaveTextContent("2");
    expect(screen.getByTestId("daily-summary-peak").parentElement).toHaveClass("ml-auto");
    expect(screen.getByTestId("daily-date-range")).toHaveTextContent("2026-08-06");
    expect(screen.getByTestId("daily-date-range")).toHaveTextContent("2026-08-07");
    expect(screen.getByRole("columnheader", { name: "较昨日" })).toBeInTheDocument();
    expect(screen.getByTestId("daily-change-2026-08-07")).toHaveTextContent("100.0%");
  });

  it("opens an overlay breakdown for a day without inserting another table row", async () => {
    const user = userEvent.setup();
    const onLoadDailyModelBreakdown = vi.fn().mockResolvedValue({
      sources: [{
        source: "codex",
        totals: { total_tokens: 120 },
        models: [
          { model: "gpt-5.6-sol", totals: { total_tokens: 90 } },
          { model: "gpt-5.5", totals: { total_tokens: 30 } },
        ],
      }],
    });

    render(
      <DataDetails
        {...dailyProps}
        dailyBreakdownColumns={[
          { key: "day", label: "日期" },
          { key: "total_tokens", label: "总计" },
          { key: "input_tokens", label: "输入" },
          { key: "output_tokens", label: "输出" },
          { key: "cached_input_tokens", label: "缓存" },
          { key: "reasoning_output_tokens", label: "推理" },
          { key: "conversation_count", label: "对话数" },
        ]}
        dailyBreakdownRows={[
          { day: "2026-08-07", total_tokens: 120 },
          { day: "2026-08-06", total_tokens: 80 },
        ]}
        renderDetailCell={(row, key) => String(row[key] ?? 0)}
        onLoadDailyModelBreakdown={onLoadDailyModelBreakdown}
      />,
    );

    const table = screen.getByRole("table");
    const originalRows = table.querySelectorAll("tbody > tr").length;
    const targetRow = table.querySelector("tbody > tr");
    expect(targetRow).not.toBeNull();
    const totalCell = within(targetRow).getByText("120");
    await act(async () => user.click(totalCell));

    expect(onLoadDailyModelBreakdown).toHaveBeenCalledWith(
      "2026-08-07",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const overlay = await screen.findByTestId("daily-breakdown-overlay");
    expect(overlay).toHaveAttribute("data-overlay-layout", "cover");
    expect(overlay).toHaveTextContent("Codex");
    expect(overlay).toHaveTextContent("gpt-5.6-sol");
    expect(overlay).toHaveTextContent("75.0%");
    expect(table.querySelectorAll("tbody > tr")).toHaveLength(originalRows);

    await act(async () => user.click(totalCell));
    expect(screen.queryByTestId("daily-breakdown-overlay")).not.toBeInTheDocument();
  });
});
