import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resetContext = vi.hoisted(() => ({
  value: {
    available: true,
    events: [] as any[],
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
  copy: (key: string) => ({
    "codex_reset.action.acknowledge": "知道了",
    "codex_reset.action.open_codex": "前往 Codex",
    "codex_reset.action.view_official": "查看官方说明",
    "codex_reset.action.view_quota": "查看额度",
    "codex_reset.completed.rolling_5_hour.summary": "5 小时额度窗口已恢复。",
    "codex_reset.completed.rolling_5_hour.title": "Codex 额度已重置",
  })[key] || key,
}));

import { CodexResetBanner } from "./CodexResetBanner";

function resetEvent() {
  return {
    id: "reset-1",
    type: "reset_completed",
    window: "rolling_5_hour",
    created_at: "2026-07-20T08:00:00.000Z",
    reset_at: "2026-07-20T08:00:00.000Z",
    official_url: "https://chatgpt.com/codex",
    source: "local_quota",
  };
}

function renderBanner() {
  return render(
    <MemoryRouter>
      <CodexResetBanner />
    </MemoryRouter>,
  );
}

describe("Codex reset banner", () => {
  beforeEach(() => {
    resetContext.value.events = [];
    resetContext.value.unreadCount = 0;
    resetContext.value.acknowledge.mockReset().mockResolvedValue(undefined);
  });

  it("shows local reset actions and acknowledges the event", () => {
    resetContext.value.events = [resetEvent()];
    resetContext.value.unreadCount = 1;
    renderBanner();

    expect(screen.getByText("Codex 额度已重置")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看额度" })).toHaveAttribute(
      "href",
      "/settings/cost#codex-quota",
    );
    expect(screen.getByRole("link", { name: "前往 Codex" })).toHaveAttribute(
      "href",
      "https://chatgpt.com/codex",
    );
    expect(screen.queryByRole("link", { name: "查看官方说明" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(resetContext.value.acknowledge).toHaveBeenCalledWith("reset-1");
  });

  it("shows conservative signed announcement copy and the exact source link", () => {
    resetContext.value.events = [{
      ...resetEvent(),
      id: "official:promo",
      type: "official_reset_announcement",
      title: "Codex 额外额度活动",
      summary: "可能适用于你的账户，请以官方页面为准。",
      source: "signed_feed",
      source_url: "https://x.com/thsottiaux/status/2078990367241046272",
      source_author: "thsottiaux",
      source_post_id: "2078990367241046272",
      expires_at: "2026-08-20T08:00:00.000Z",
    }];
    resetContext.value.unreadCount = 1;
    renderBanner();

    expect(screen.getByText("Codex 额外额度活动")).toBeInTheDocument();
    expect(screen.getByText("可能适用于你的账户，请以官方页面为准。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看官方说明" })).toHaveAttribute(
      "href",
      "https://x.com/thsottiaux/status/2078990367241046272",
    );
  });

  it("renders nothing without an unread event", () => {
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });
});
