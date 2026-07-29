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
  } as unknown as CodexResetHistoryEvent;
}

function officialReset(id: string, occurredAt: Date): CodexResetHistoryEvent {
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
    source_url: "https://x.com/thsottiaux/status/2082317452755751098",
    source: "signed_feed",
    title: "Codex 额外额度已重置",
    summary: "官方已为 ChatGPT Work 与 Codex 用户重置使用限制。",
  } as unknown as CodexResetHistoryEvent;
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

  it("shows only official extra resets with their exact source and time", () => {
    resetContext.value.history = [
      officialReset("today", new Date(2026, 6, 26, 14, 32)),
      resetEvent("past", "manual_reset", new Date(2026, 6, 25, 9, 8), 64, 3),
    ];

    render(<ResetHistoryPage />);

    const historyRegion = screen.getByTestId("reset-history-list");
    expect(screen.getAllByTestId("reset-history-group")).toHaveLength(1);
    expect(within(historyRegion).getAllByTestId("reset-history-item")).toHaveLength(1);
    expect(historyRegion).toHaveTextContent("Codex");
    expect(historyRegion).toHaveTextContent("Codex 额外额度已重置");
    expect(historyRegion).not.toHaveTextContent("account-a");
    expect(historyRegion).not.toHaveTextContent("5h");
    expect(historyRegion).toHaveTextContent("2026年7月26日 14:32");
    expect(within(historyRegion).getByRole("link")).toHaveAttribute(
      "href",
      "https://x.com/thsottiaux/status/2082317452755751098",
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
    expect(items[0]).toHaveTextContent("2026年7月25日 08:00");
    expect(items[4]).toHaveTextContent("2026年7月21日 08:04");
  });
});
