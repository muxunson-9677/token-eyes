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
  type: "reset_completed" | "unexpected_quota_restore",
  occurredAt: Date,
) {
  return {
    id,
    type,
    window: "rolling_5_hour" as const,
    created_at: occurredAt.toISOString(),
    reset_at: occurredAt.toISOString(),
    occurred_at: occurredAt.toISOString(),
    official_url: "https://chatgpt.com/codex",
    source: "local_quota" as const,
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

  it("prominently shows today's latest reset once and keeps older records in history", () => {
    const today = new Date(2026, 6, 26, 14, 32);
    const yesterday = new Date(2026, 6, 25, 9, 8);
    resetContext.value.history = [
      resetEvent("today", "reset_completed", today),
      resetEvent("past", "unexpected_quota_restore", yesterday),
    ];

    render(<ResetHistoryPage />);

    const todayRegion = screen.getByTestId("reset-today");
    expect(todayRegion).toHaveTextContent("2026年7月26日 14:32");
    expect(within(todayRegion).getByText("copy:reset_history.completed")).toBeInTheDocument();

    const historyRegion = screen.getByTestId("reset-history-list");
    expect(historyRegion).toHaveTextContent("2026年7月25日 09:08");
    expect(historyRegion).not.toHaveTextContent("2026年7月26日 14:32");
  });

  it("leaves today's reminder content empty and shows up to five past timestamps", () => {
    resetContext.value.history = Array.from({ length: 5 }, (_, index) =>
      resetEvent(
        `past-${index}`,
        "reset_completed",
        new Date(2026, 6, 25 - index, 8, index),
      ));

    render(<ResetHistoryPage />);

    expect(screen.getByTestId("reset-today")).toBeEmptyDOMElement();
    expect(screen.getAllByTestId("reset-history-item")).toHaveLength(5);
    expect(screen.queryByText(/今天|昨天|本周/u)).not.toBeInTheDocument();
  });
});
