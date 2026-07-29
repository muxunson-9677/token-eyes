import React from "react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function resetEvent(
  id: string,
  type: "reset_completed" | "manual_reset" | "unexpected_quota_restore",
  occurredAt: Date,
  before = 21,
  after = 0,
): CodexResetHistoryEvent {
  return {
    id,
    type,
    agent: "codex",
    account_key: "account-a",
    window: "rolling_5_hour",
    created_at: occurredAt.toISOString(),
    reset_at: occurredAt.toISOString(),
    occurred_at: occurredAt.toISOString(),
    observed_at: occurredAt.toISOString(),
    previous_used_percent: before,
    current_used_percent: after,
    confidence: "confirmed",
    alert_eligible: false,
    official_url: "https://chatgpt.com/codex",
    source: "local_quota",
  };
}

describe("ResetHistoryPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 26, 18, 0));
    resetContext.value.history = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups every record by local date and shows the required reset metadata", () => {
    resetContext.value.history = [
      resetEvent("today", "reset_completed", new Date(2026, 6, 26, 14, 32)),
      resetEvent("past", "manual_reset", new Date(2026, 6, 25, 9, 8), 64, 3),
    ];

    render(<ResetHistoryPage />);

    const historyRegion = screen.getByTestId("reset-history-list");
    expect(screen.getAllByTestId("reset-history-group")).toHaveLength(2);
    expect(within(historyRegion).getAllByTestId("reset-history-item")).toHaveLength(2);
    expect(historyRegion).toHaveTextContent("Codex");
    expect(historyRegion).toHaveTextContent("account-a");
    expect(historyRegion).toHaveTextContent("5h");
    expect(historyRegion).toHaveTextContent("64% → 3%");
    expect(historyRegion).toHaveTextContent("copy:reset_history.manual");
    expect(historyRegion).toHaveTextContent("2026年7月26日 14:32");
    expect(historyRegion).toHaveTextContent("2026年7月25日 09:08");
  });

  it("shows all retained records in descending occurrence order instead of capping at three", () => {
    resetContext.value.history = Array.from({ length: 5 }, (_, index) =>
      resetEvent(
        `past-${index}`,
        "reset_completed",
        new Date(2026, 6, 25 - index, 8, index),
      ));

    render(<ResetHistoryPage />);

    const items = screen.getAllByTestId("reset-history-item");
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent("2026年7月25日 08:00");
    expect(items[4]).toHaveTextContent("2026年7月21日 08:04");
  });
});
