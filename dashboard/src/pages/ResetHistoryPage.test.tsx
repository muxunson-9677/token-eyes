import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CodexResetHistoryEvent } from "../lib/api";

const resetContext = vi.hoisted(() => ({
  value: {
    available: true,
    events: [],
    history: [] as CodexResetHistoryEvent[],
    unreadCount: 0,
    status: null,
    acknowledge: vi.fn(),
    checkNow: vi.fn(),
  },
}));

vi.mock("../hooks/use-codex-reset-events", () => ({
  useCodexResetEvents: () => resetContext.value,
}));

vi.mock("../lib/copy", () => ({
  copy: (key: string) => `copy:${key}`,
  getCopyLocale: () => "zh-CN",
}));

import { ResetHistoryPage } from "./ResetHistoryPage";

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
    source: "signed_feed",
    reset_kind: "hard",
    reset_scope: "all_codex_work_users",
    title: "Codex official extra reset",
    summary: "FULL_SUMMARY_MUST_NOT_RENDER",
  } as unknown as CodexResetHistoryEvent;
}

describe("ResetHistoryPage", () => {
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

  it("shows all retained records in descending occurrence order instead of capping at three", () => {
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
  });

  it("renders compact timeline nodes and indexes each unique official source once", () => {
    resetContext.value.history = [
      officialReset("newest", new Date(2026, 6, 29, 12, 9), "https://x.com/source/one"),
      officialReset("middle", new Date(2026, 6, 28, 11, 9), "https://x.com/source/one"),
      officialReset("oldest", new Date(2026, 6, 26, 3, 17), "https://x.com/source/two"),
    ];

    render(<ResetHistoryPage />);

    expect(screen.getByTestId("reset-history-timeline")).toBeInTheDocument();
    expect(screen.getAllByTestId("reset-history-node")).toHaveLength(3);
    expect(screen.getAllByTestId("reset-history-source-ref").map((node) => node.textContent))
      .toEqual(["[1]", "[1]", "[2]"]);
    const sourceIndex = screen.getByTestId("reset-history-source-index");
    expect(within(sourceIndex).getAllByRole("link")).toHaveLength(2);
    expect(sourceIndex).toHaveTextContent("copy:reset_history.sources_title");
    expect(sourceIndex).toHaveTextContent("[1]");
    expect(sourceIndex).toHaveTextContent("[2]");
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
      expect(within(stats).getAllByTestId("reset-history-stat")).toHaveLength(5);
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
});
