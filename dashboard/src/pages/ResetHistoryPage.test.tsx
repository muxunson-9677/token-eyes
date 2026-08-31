import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexResetHistoryEvent, CodexResetMonitorStatus } from "../lib/api";
import zhDashboardRaw from "../content/i18n/zh/dashboard.json?raw";

const resetContext = vi.hoisted(() => ({
  value: {
    available: true,
    dataState: "current" as "loading" | "current" | "cached" | "unavailable",
    events: [],
    history: [] as CodexResetHistoryEvent[],
    unreadCount: 0,
    status: null as CodexResetMonitorStatus | null,
    acknowledge: vi.fn(),
    checkNow: vi.fn(),
  },
}));

const apiMocks = vi.hoisted(() => ({
  openExternalLink: vi.fn(),
}));

vi.mock("../hooks/use-codex-reset-events", () => ({
  useCodexResetEvents: () => resetContext.value,
}));

vi.mock("../lib/copy", () => ({
  copy: (key: string) => `copy:${key}`,
  getCopyLocale: () => "zh-CN",
}));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  openExternalLink: apiMocks.openExternalLink,
}));

vi.mock("../lib/local-api-url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/local-api-url")>()),
  isTauriRuntime: () => true,
}));

import { ResetHistoryPage } from "./ResetHistoryPage";

const TEST_NOW = new Date("2026-08-14T12:00:00.000Z");

function resetEvent(id: string, occurredAt: Date): CodexResetHistoryEvent {
  return {
    id,
    type: "manual_reset",
    agent: "codex",
    account_key: "account-a",
    window: "rolling_5_hour",
    created_at: occurredAt.toISOString(),
    reset_at: occurredAt.toISOString(),
    occurred_at: occurredAt.toISOString(),
    observed_at: occurredAt.toISOString(),
    previous_used_percent: 64,
    current_used_percent: 3,
    confidence: "confirmed",
    alert_eligible: false,
    official_url: "https://chatgpt.com/codex",
    source: "local_quota",
  } as unknown as CodexResetHistoryEvent;
}

function officialReset(
  id: string,
  occurredAt: Date,
  sourceUrl = "https://x.com/thsottiaux/status/2082317452755751098",
  resetKind: "hard" | "banked" | "mixed" | "unknown" = "hard",
): CodexResetHistoryEvent {
  return {
    id,
    type: "official_reset_announcement",
    agent: "codex",
    account_key: null,
    window: null,
    created_at: occurredAt.toISOString(),
    reset_at: null,
    occurred_at: occurredAt.toISOString(),
    observed_at: occurredAt.toISOString(),
    previous_used_percent: null,
    current_used_percent: null,
    confidence: "confirmed",
    alert_eligible: true,
    official_url: "https://chatgpt.com/codex",
    source_url: sourceUrl,
    source_author: "thsottiaux",
    source_post_id: sourceUrl.match(/\/status\/([0-9]+)$/u)?.[1] || null,
    source: "signed_feed",
    reset_kind: resetKind,
    reset_scope: "all_codex_work_users",
    title: "Codex official extra reset",
    summary: "FULL_SUMMARY_MUST_NOT_RENDER",
    body: "FULL_BODY_FIRST_PARAGRAPH\n\nFULL_BODY_SECOND_PARAGRAPH",
    expires_at: new Date(occurredAt.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
  } as unknown as CodexResetHistoryEvent;
}

function feedErrorStatus(errorCode = "http_error"): CodexResetMonitorStatus {
  return {
    enabled: true,
    configured: true,
    running: false,
    last_checked_at: TEST_NOW.toISOString(),
    last_successful_at: TEST_NOW.toISOString(),
    next_check_at: null,
    last_error_code: null,
    failure_count: 0,
    unread_count: 0,
    feed_enabled: true,
    feed_last_checked_at: new Date(TEST_NOW.getTime() - 60_000).toISOString(),
    feed_generated_at: new Date(TEST_NOW.getTime() - 120_000).toISOString(),
    latest_published_at: new Date(TEST_NOW.getTime() - 180_000).toISOString(),
    feed_stale: true,
    feed_error_code: errorCode,
    backfill_error_code: null,
  };
}

describe("ResetHistoryPage", () => {
  it("ships explicit Chinese copy for unavailable and trusted-cache states", () => {
    const zhDashboard = JSON.parse(zhDashboardRaw) as Record<string, string>;
    expect(zhDashboard["reset_history.data_unavailable"]).toBe("数据不可用");
    expect(zhDashboard["reset_history.data_cached"])
      .toBe("公告刷新失败，正在显示上次已验证的重置记录");
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TEST_NOW);
    window.localStorage.clear();
    resetContext.value.available = true;
    resetContext.value.dataState = "current";
    resetContext.value.history = [];
    resetContext.value.status = null;
    resetContext.value.checkNow.mockReset();
    resetContext.value.checkNow.mockResolvedValue(undefined);
    apiMocks.openExternalLink.mockReset();
    apiMocks.openExternalLink.mockResolvedValue(true);
    document.documentElement.classList.remove("tt-reference-route-reset-history");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("activates reset-history-only route styles while the page is mounted", () => {
    const routeClass = "tt-reference-route-reset-history";
    const { unmount } = render(<ResetHistoryPage />);

    expect(document.documentElement).toHaveClass(routeClass);

    unmount();
    expect(document.documentElement).not.toHaveClass(routeClass);
  });

  it("never injects fixed preview reset records when the local API is unavailable", () => {
    resetContext.value.available = false;
    resetContext.value.dataState = "loading";
    resetContext.value.history = [];

    render(<ResetHistoryPage />);

    expect(screen.queryByTestId("reset-history-item")).not.toBeInTheDocument();
    expect(screen.getByTestId("reset-history-list").querySelector(".tt-reset-history-empty"))
      .toHaveTextContent("copy:reset_history.loading_detail");
  });

  it("shows data unavailable instead of zero when the local API reports a feed error without trusted history", () => {
    resetContext.value.status = feedErrorStatus();

    render(<ResetHistoryPage />);

    expect(screen.getByTestId("reset-history-data-state"))
      .toHaveTextContent("copy:reset_history.data_unavailable");
    expect(screen.queryByTestId("reset-history-statistics")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reset-history-activity")).not.toBeInTheDocument();
    expect(screen.getByTestId("reset-history-list").querySelector(".tt-reset-history-empty"))
      .toHaveTextContent("copy:reset_history.data_unavailable");
  });

  it("keeps trusted signed history visible and marks it as cached when feed refresh fails", () => {
    resetContext.value.status = feedErrorStatus("network_error");
    resetContext.value.history = [
      officialReset("trusted-cache", new Date("2026-08-13T04:00:00.000Z")),
    ];

    render(<ResetHistoryPage />);

    expect(screen.getByTestId("reset-history-data-state"))
      .toHaveTextContent("copy:reset_history.data_cached");
    expect(screen.getByTestId("reset-history-statistics")).toBeInTheDocument();
    expect(screen.getByTestId("reset-history-activity")).toBeInTheDocument();
    expect(screen.getByTestId("reset-history-item")).toBeInTheDocument();
  });

  it("does not call an old successful response verified after transport failure", () => {
    resetContext.value.available = false;
    resetContext.value.dataState = "cached";
    resetContext.value.status = {
      ...feedErrorStatus(),
      feed_error_code: null,
      feed_stale: false,
    };
    resetContext.value.history = [
      officialReset("last-known-good", new Date("2026-08-13T04:00:00.000Z")),
    ];

    render(<ResetHistoryPage />);

    expect(screen.getByTestId("reset-history-freshness"))
      .toHaveTextContent("copy:reset_history.freshness.cached");
    expect(screen.getByTestId("reset-history-data-state"))
      .toHaveTextContent("copy:reset_history.data_cached");
    expect(screen.getByTestId("reset-history-item")).toBeInTheDocument();
  });

  it("shows verified feed freshness and forces a real manual refresh", async () => {
    const user = userEvent.setup();
    resetContext.value.status = {
      ...feedErrorStatus(),
      feed_error_code: null,
      feed_stale: false,
    };

    render(<ResetHistoryPage />);

    const freshness = screen.getByTestId("reset-history-freshness");
    expect(freshness).toHaveTextContent("copy:reset_history.freshness.current");
    expect(freshness).toHaveTextContent("copy:reset_history.freshness.last_checked");
    expect(freshness).toHaveTextContent("copy:reset_history.freshness.feed_generated");
    expect(freshness).toHaveTextContent("copy:reset_history.freshness.latest_published");
    expect(within(freshness).getByTestId("reset-history-feed-checked"))
      .toHaveAttribute("datetime", resetContext.value.status.feed_last_checked_at);
    expect(within(freshness).getByTestId("reset-history-feed-generated"))
      .toHaveAttribute("datetime", resetContext.value.status.feed_generated_at);
    expect(within(freshness).getByTestId("reset-history-latest-published"))
      .toHaveAttribute("datetime", resetContext.value.status.latest_published_at);

    await act(async () => {
      await user.click(within(freshness).getByRole("button", {
        name: "copy:reset_history.refresh",
      }));
    });
    expect(resetContext.value.checkNow).toHaveBeenCalledWith(true);
  });

  it("keeps the heatmap and summary figures in one right-side divided group", () => {
    resetContext.value.history = [
      officialReset("activity", new Date("2026-08-01T11:32:00.000Z")),
    ];

    render(<ResetHistoryPage />);

    const activity = screen.getByTestId("reset-history-activity");
    const dataGroup = activity.querySelector(".tt-reset-activity-data");
    expect(dataGroup).not.toBeNull();
    expect(dataGroup).toHaveClass("tt-reset-activity-data--right-aligned");
    expect(dataGroup?.querySelector(".tt-reset-heatmap")).not.toBeNull();
    expect(dataGroup?.querySelectorAll(".tt-reset-activity-stat")).toHaveLength(2);
    expect(dataGroup?.querySelector(".tt-reset-activity-peak")).toHaveClass("tt-reset-activity-stat--divided");
  });

  it("assigns reset activity to the explicit Asia/Shanghai day across UTC midnight", () => {
    vi.setSystemTime(new Date("2026-08-22T04:00:00.000Z"));
    resetContext.value.history = [
      officialReset("before-shanghai-midnight", new Date("2026-08-21T15:59:59.999Z")),
      officialReset("after-shanghai-midnight", new Date("2026-08-21T16:00:00.000Z")),
    ];

    render(<ResetHistoryPage />);

    const days = screen.getByTestId("reset-history-activity")
      .querySelectorAll(".tt-reset-heatmap-day");
    const activeCells = (day: Element) => day.querySelectorAll('[data-level]:not([data-level="0"])').length;
    expect(activeCells(days[days.length - 2])).toBe(2);
    expect(activeCells(days[days.length - 1])).toBe(2);
  });

  it("shows only official extra resets with a concise source, reset type, scope, and exact time", () => {
    const official = officialReset("today", new Date(2026, 6, 26, 14, 32));
    resetContext.value.history = [
      official,
      resetEvent("past", new Date(2026, 6, 25, 9, 8)),
    ];

    render(<ResetHistoryPage />);

    const historyRegion = screen.getByTestId("reset-history-list");
    expect(within(historyRegion).getAllByTestId("reset-history-item")).toHaveLength(1);
    expect(historyRegion).not.toHaveTextContent("FULL_SUMMARY_MUST_NOT_RENDER");
    expect(historyRegion).not.toHaveTextContent("account-a");
    expect(historyRegion).not.toHaveTextContent("5h");
    expect(historyRegion).toHaveTextContent("copy:reset_history.source.tibo");
    expect(historyRegion).toHaveTextContent("copy:reset_history.kind.hard");
    expect(historyRegion).toHaveTextContent("copy:reset_history.scope.all_codex_work_users");
    expect(historyRegion.querySelector("time")).toHaveAttribute(
      "datetime",
      official.occurred_at,
    );
  });

  it("expands complete announcement details inline and preserves dismissal focus behavior", async () => {
    const user = userEvent.setup();
    resetContext.value.history = [
      officialReset("today", new Date(2026, 6, 26, 14, 32)),
    ];

    render(<ResetHistoryPage />);

    const item = screen.getByTestId("reset-history-item");
    expect(screen.queryByTestId("reset-history-detail")).not.toBeInTheDocument();
    expect(item).not.toHaveTextContent("FULL_SUMMARY_MUST_NOT_RENDER");

    expect(item).toHaveClass("tt-pressable");
    await act(async () => {
      await user.click(screen.getByTestId("reset-history-expand"));
    });

    const detail = screen.getByTestId("reset-history-detail");
    expect(detail).toHaveTextContent("Codex official extra reset");
    expect(detail).toHaveTextContent("copy:reset_history.detail_content");
    expect(detail).toHaveTextContent("FULL_BODY_FIRST_PARAGRAPH");
    expect(detail).toHaveTextContent("FULL_BODY_SECOND_PARAGRAPH");
    expect(detail).not.toHaveTextContent("FULL_SUMMARY_MUST_NOT_RENDER");
    expect(detail).toHaveTextContent("copy:reset_history.detail_source");
    expect(detail).toHaveTextContent("copy:reset_history.source.tibo");
    expect(detail).toHaveTextContent("copy:reset_history.detail_published");
    expect(detail).toHaveTextContent("copy:reset_history.kind.hard");
    expect(detail).toHaveTextContent("copy:reset_history.scope.all_codex_work_users");
    expect(detail).toHaveTextContent("copy:reset_history.detail_expires");
    expect(detail).toHaveAttribute("role", "region");
    expect(detail).not.toHaveClass("tt-reset-history-detail--overlay");
    expect(item).toContainElement(detail);
    expect(detail.parentElement).toBe(item);
    const source = within(detail).getByRole("link", {
      name: "copy:codex_reset.action.view_official",
    });
    expect(source).toHaveClass("tt-reset-history-source-action");
    expect(source).toHaveTextContent("https://x.com/thsottiaux/status/2082317452755751098");
    await user.click(source);
    expect(apiMocks.openExternalLink).toHaveBeenCalledWith(
      "reset-source:thsottiaux:2082317452755751098",
    );
    expect(item).toHaveAttribute("data-expanded", "true");

    act(() => fireEvent.keyDown(document, { key: "Escape" }));
    expect(screen.queryByTestId("reset-history-detail")).not.toBeInTheDocument();
    expect(screen.getByTestId("reset-history-expand")).toHaveFocus();

    await act(async () => {
      await user.click(screen.getByTestId("reset-history-expand"));
    });
    expect(screen.getByTestId("reset-history-detail")).toBeInTheDocument();
    act(() => fireEvent.pointerDown(document.body));
    expect(screen.queryByTestId("reset-history-detail")).not.toBeInTheDocument();
  });

  it("keeps rows 1, 3, 4, and 5 details in document flow instead of a portal or overlay", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    resetContext.value.history = Array.from({ length: 5 }, (_, index) => {
      const event = officialReset(
        `row-${index + 1}`,
        new Date(`2026-08-${String(13 - index).padStart(2, "0")}T08:0${index}:00.000Z`),
        `https://x.com/thsottiaux/status/20823174527557510${90 + index}`,
      );
      return {
        ...event,
        title: `ROW_${index + 1}_TITLE`,
        body: `ROW_${index + 1}_FULL_BODY`,
      };
    });

    try {
      render(<ResetHistoryPage />);

      const items = screen.getAllByTestId("reset-history-item");
      for (const index of [0, 2, 3, 4]) {
        const previouslyExpanded = items.find((item) => item.dataset.expanded === "true");
        if (previouslyExpanded) {
          await act(async () => {
            await user.click(previouslyExpanded);
          });
        }
        await act(async () => {
          await user.click(items[index]);
        });
        const detail = within(items[index]).getByTestId("reset-history-detail");
        expect(detail.parentElement).toBe(items[index]);
        expect(detail).toHaveTextContent(`ROW_${index + 1}_TITLE`);
        expect(detail).toHaveTextContent(`ROW_${index + 1}_FULL_BODY`);
        expect(detail).not.toHaveClass("tt-reset-history-detail--overlay");
        expect(["", "static"]).toContain(window.getComputedStyle(detail).position);
      }
      expect(scrollIntoView).toHaveBeenCalledTimes(4);
    } finally {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });

  it("shows all retained records in descending occurrence order instead of capping at three", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00.000Z"));
    try {
      resetContext.value.history = Array.from({ length: 5 }, (_, index) =>
        officialReset(
          `past-${index}`,
          new Date(2026, 6, 25 - index, 8, index),
        ));

      render(<ResetHistoryPage />);

      const items = screen.getAllByTestId("reset-history-item");
      expect(items).toHaveLength(5);
      expect(items[0].querySelector("time")).toHaveAttribute(
        "datetime",
        new Date(2026, 6, 25, 8, 0).toISOString(),
      );
      expect(items[4].querySelector("time")).toHaveAttribute(
        "datetime",
        new Date(2026, 6, 21, 8, 4).toISOString(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reveals the remaining official announcements from the history control", async () => {
    const user = userEvent.setup();
    resetContext.value.history = Array.from({ length: 13 }, (_, index) =>
      officialReset(`record-${index}`, new Date(2026, 7, 13 - index, 8, index)));

    render(<ResetHistoryPage />);

    expect(screen.getAllByTestId("reset-history-item")).toHaveLength(11);
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "copy:reset_history.load_more" }));
    });
    expect(screen.getAllByTestId("reset-history-item")).toHaveLength(13);
  });

  it("renders compact timeline nodes without legacy numbered source references", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));
    try {
      resetContext.value.history = [
        officialReset("newest", new Date(2026, 6, 29, 12, 9), "https://x.com/source/one"),
        officialReset("middle", new Date(2026, 6, 28, 11, 9), "https://x.com/source/one"),
        officialReset("oldest", new Date(2026, 6, 26, 3, 17), "https://x.com/source/two"),
      ];

      render(<ResetHistoryPage />);

      expect(screen.getByTestId("reset-history-timeline")).toBeInTheDocument();
      expect(screen.getAllByTestId("reset-history-node")).toHaveLength(3);
      expect(screen.queryByTestId("reset-history-source-ref")).not.toBeInTheDocument();
      expect(screen.queryByTestId("reset-history-source-index")).not.toBeInTheDocument();
      expect(screen.queryByRole("contentinfo", { name: "Token Eyes" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a compact thirty-day reset count and adjacent interval statistics", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));
    resetContext.value.history = [
      officialReset("one", new Date("2026-07-20T00:00:00.000Z")),
      officialReset("two", new Date("2026-07-22T00:00:00.000Z")),
      officialReset("three", new Date("2026-07-25T00:00:00.000Z")),
      officialReset("four", new Date("2026-07-29T00:00:00.000Z")),
      officialReset("outside", new Date("2026-06-29T00:00:00.000Z")),
    ];

    try {
      render(<ResetHistoryPage />);

      const stats = screen.getByTestId("reset-history-statistics");
      expect(stats).toHaveClass("tt-reset-statistics--compact");
      expect(within(stats).getAllByTestId("reset-history-stat")).toHaveLength(5);
      expect(within(stats).getAllByTestId("reset-history-stat-icon")).toHaveLength(5);
      expect(within(stats).getAllByTestId("reset-history-stat").map((node) => node.dataset.tone))
        .toEqual(["blue", "emerald", "violet", "amber", "rose"]);
      expect(within(stats).getAllByTestId("reset-history-stat").map((node) =>
        node.querySelector("dd")?.classList.contains("truncate")))
        .toEqual([false, false, false, false, false]);
      expect(stats).toHaveTextContent("copy:reset_history.stats.period");
      expect(stats).toHaveTextContent("copy:reset_history.stats.count");
      expect(stats).toHaveTextContent("copy:reset_history.stats.average");
      expect(stats).toHaveTextContent("copy:reset_history.stats.shortest");
      expect(stats).toHaveTextContent("copy:reset_history.stats.longest");
      expect(screen.getAllByTestId("reset-history-item")).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the complete statistics layout and labels unavailable interval data honestly", () => {
    resetContext.value.history = [
      officialReset("one", new Date()),
    ];

    render(<ResetHistoryPage />);

    expect(screen.getAllByTestId("reset-history-stat")).toHaveLength(5);
    expect(screen.getAllByTestId("reset-history-stat").filter((node) => node.dataset.empty === "true"))
      .toHaveLength(3);
    expect(document.body).toHaveTextContent("copy:reset_history.stats.insufficient");
  });

  it("uses a different semantic icon and tone for each reset kind", () => {
    resetContext.value.history = [
      officialReset("hard", new Date("2026-07-29T00:00:00.000Z"), "https://x.com/source/hard", "hard"),
      officialReset("banked", new Date("2026-07-28T00:00:00.000Z"), "https://x.com/source/banked", "banked"),
      officialReset("mixed", new Date("2026-07-27T00:00:00.000Z"), "https://x.com/source/mixed", "mixed"),
      officialReset("unknown", new Date("2026-07-26T00:00:00.000Z"), "https://x.com/source/unknown", "unknown"),
    ];

    render(<ResetHistoryPage />);

    const nodes = screen.getAllByTestId("reset-history-node");
    expect(nodes.map((node) => node.dataset.kind)).toEqual(["hard", "banked", "mixed", "unknown"]);
    expect(nodes.map((node) => node.dataset.tone)).toEqual(["emerald", "blue", "violet", "amber"]);
    expect(nodes.map((node) => node.querySelector("svg")?.getAttribute("data-kind")))
      .toEqual(["hard", "banked", "mixed", "unknown"]);
  });

  it("saves the selected surprise effect and previews it without reset side effects", async () => {
    const user = userEvent.setup();
    const previews: unknown[] = [];
    const listener = (event: Event) => previews.push((event as CustomEvent).detail);
    window.addEventListener("token-eyes:reset-celebration-preview", listener);
    window.localStorage.removeItem("token-eyes:official-reset-celebrated:v1");
    resetContext.value.history = [];

    try {
      render(<ResetHistoryPage />);
      const selector = screen.getByLabelText("copy:reset_history.effect.label");
      const button = screen.getByRole("button", {
        name: "copy:reset_history.preview_celebration_aria",
      });

      expect(selector).toHaveValue("meteors");
      fireEvent.pointerDown(selector, { button: 0 });
      expect(selector).toHaveClass("tt-reset-control-click-bounce");
      fireEvent.animationEnd(selector, { animationName: "tt-widget-press-rebound" });
      expect(selector).not.toHaveClass("tt-reset-control-click-bounce");
      fireEvent.change(selector, { target: { value: "fireworks" } });
      expect(selector).toHaveValue("fireworks");
      expect(window.localStorage.getItem("token-eyes:reset-celebration-effect:v1"))
        .toBe("fireworks");
      expect(within(button).getByTestId("reset-history-preview-icon")).toBeInTheDocument();
      await user.click(button);

      expect(previews).toEqual([{ effectId: "fireworks" }]);
      expect(window.localStorage.getItem("token-eyes:official-reset-celebrated:v1")).toBeNull();
    } finally {
      window.removeEventListener("token-eyes:reset-celebration-preview", listener);
    }
  });
});
