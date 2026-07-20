import React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  acknowledgeCodexResetEvent: vi.fn(),
  checkCodexResetEvents: vi.fn(),
  getCodexResetEvents: vi.fn(),
}));

vi.mock("../../lib/api", () => api);

import {
  CodexResetEventsProvider,
  useCodexResetEvents,
} from "../use-codex-reset-events";

const response = {
  ok: true,
  status: {
    enabled: true,
    configured: true,
    running: false,
    last_checked_at: "2026-07-20T08:00:00.000Z",
    last_successful_at: "2026-07-20T08:00:00.000Z",
    next_check_at: "2026-07-20T08:10:00.000Z",
    last_error_code: null,
    failure_count: 0,
    unread_count: 1,
    feed_enabled: true,
    feed_last_checked_at: null,
    feed_error_code: null,
  },
  events: [{
    id: "reset-1",
    type: "reset_completed" as const,
    window: "rolling_5_hour" as const,
    created_at: "2026-07-20T08:00:00.000Z",
    reset_at: "2026-07-20T08:00:00.000Z",
    official_url: "https://chatgpt.com/codex",
    source: "local_quota" as const,
  }],
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <CodexResetEventsProvider enabled>{children}</CodexResetEventsProvider>;
}

describe("Codex reset events provider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.getCodexResetEvents.mockReset().mockResolvedValue(response);
    api.checkCodexResetEvents.mockReset().mockResolvedValue(response);
    api.acknowledgeCodexResetEvent.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches immediately, refreshes every 60 seconds, and checks through the local API on focus", async () => {
    const { result } = renderHook(() => useCodexResetEvents(), { wrapper });
    await act(async () => Promise.resolve());
    expect(api.getCodexResetEvents).toHaveBeenCalledTimes(1);
    expect(result.current.unreadCount).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(api.getCodexResetEvents).toHaveBeenCalledTimes(2);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(api.checkCodexResetEvents).toHaveBeenCalledWith(false);
  });

  it("acknowledges once and removes the event immediately", async () => {
    const { result } = renderHook(() => useCodexResetEvents(), { wrapper });
    await act(async () => Promise.resolve());
    await act(async () => {
      await result.current.acknowledge("reset-1");
    });
    expect(api.acknowledgeCodexResetEvent).toHaveBeenCalledWith("reset-1");
    expect(result.current.events).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it("does not contact the local API when disabled for the public website", async () => {
    const disabledWrapper = ({ children }: { children: React.ReactNode }) => (
      <CodexResetEventsProvider enabled={false}>{children}</CodexResetEventsProvider>
    );
    const { result } = renderHook(() => useCodexResetEvents(), {
      wrapper: disabledWrapper,
    });
    await act(async () => Promise.resolve());
    expect(result.current.events).toEqual([]);
    expect(api.getCodexResetEvents).not.toHaveBeenCalled();
    expect(api.checkCodexResetEvents).not.toHaveBeenCalled();
  });
});
