import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { setCopyLocale } from "../../../../lib/copy";
import {
  UsageFiltersProvider,
  useUsageFilterActions,
} from "../../../../hooks/use-usage-filters";
import { RefreshIntervalPicker } from "../RefreshIntervalPicker.jsx";

// Ticket-02 D: RefreshIntervalPicker must format the "last updated" label
// with the hours-ago branch when the elapsed time exceeds 60 minutes
// (regression test for the prior bug where >60min fell through to
// seconds_ago, producing values like "3600 秒前").

const NOW_MS = Date.UTC(2026, 5, 29, 12, 0, 0); // 2026-06-29 12:00:00 UTC

function Probe() {
  useUsageFilterActions();
  return null;
}

function renderPicker(props = {}) {
  return render(
    <UsageFiltersProvider>
      <Probe />
      <RefreshIntervalPicker {...props} />
    </UsageFiltersProvider>,
  );
}

describe("RefreshIntervalPicker", () => {
  beforeEach(() => {
    setCopyLocale("zh-CN");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the 4 interval options when opened", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPicker();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "刷新间隔" }));
    });

    // Options come from dashboard.refresh.interval.* copy keys (zh-CN CSV).
    // The current interval also appears on the trigger button, so use
    // getAllByText and assert at least one match per option.
    expect(screen.getAllByText("30秒").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1分钟").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("5分钟").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("手动").length).toBeGreaterThanOrEqual(1);
  });

  it("shows '刚刚' when lastUpdatedAt is within 60 seconds", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPicker({ lastUpdatedAt: new Date(NOW_MS - 30 * 1000) });

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "刷新间隔" }));
    });

    expect(screen.getByText(/最后更新：刚刚/)).toBeInTheDocument();
  });

  it("shows 'N 分钟前' when elapsed time is between 1 and 60 minutes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPicker({ lastUpdatedAt: new Date(NOW_MS - 5 * 60 * 1000) });

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "刷新间隔" }));
    });

    expect(screen.getByText(/最后更新：5 分钟前/)).toBeInTheDocument();
  });

  it("shows 'N 小时前' when elapsed time exceeds 60 minutes (hours_ago branch)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // 2 hours ago — previously this would have rendered "7200 秒前"
    renderPicker({ lastUpdatedAt: new Date(NOW_MS - 2 * 60 * 60 * 1000) });

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "刷新间隔" }));
    });

    expect(screen.getByText(/最后更新：2 小时前/)).toBeInTheDocument();
  });

  it("shows 'N 小时前' for elapsed times beyond 24h as well", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // 26 hours ago
    renderPicker({ lastUpdatedAt: new Date(NOW_MS - 26 * 60 * 60 * 1000) });

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "刷新间隔" }));
    });

    expect(screen.getByText(/最后更新：26 小时前/)).toBeInTheDocument();
  });
});
