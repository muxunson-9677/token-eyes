import React from "react";
import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  acknowledgeCodexResetEvent: vi.fn(),
  checkCodexResetEvents: vi.fn(),
  getCodexResetEvents: vi.fn(),
  markCodexResetEventDelivered: vi.fn(),
}));
const notification = vi.hoisted(() => ({
  showCodexResetNotification: vi.fn(),
}));

vi.mock("../../lib/api", () => api);
vi.mock("../../lib/codex-reset-notification", () => notification);

import {
  CodexResetEventsProvider,
  useCodexResetEvents,
} from "../use-codex-reset-events";

const response: any = {
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
    backfill_error_code: null,
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
  notification_events: [{
    id: "reset-1",
    type: "reset_completed" as const,
    agent: "codex" as const,
    account_key: "default",
    window: "rolling_5_hour" as const,
    created_at: "2026-07-20T08:00:00.000Z",
    reset_at: "2026-07-20T08:00:00.000Z",
    official_url: "https://chatgpt.com/codex",
    source: "local_quota" as const,
    observed_at: "2026-07-20T08:00:00.000Z",
    previous_used_percent: 21,
    current_used_percent: 0,
    confidence: "confirmed" as const,
    alert_eligible: true,
  }],
  history: [{
    id: "reset-1",
    type: "reset_completed" as const,
    window: "rolling_5_hour" as const,
    created_at: "2026-07-20T08:01:00.000Z",
    reset_at: "2026-07-20T08:00:00.000Z",
    occurred_at: "2026-07-20T08:00:00.000Z",
    official_url: "https://chatgpt.com/codex",
    source: "local_quota" as const,
  }],
};
response.tray_events = response.events;
response.widget_events = response.events;

function officialReset({
  publishedAt = "2026-07-30T12:00:00.000Z",
  ...overrides
}: Record<string, unknown> = {}) {
  return {
    id: "official-reset-42",
    type: "official_reset_announcement" as const,
    agent: "codex" as const,
    account_key: "default",
    window: null,
    created_at: publishedAt,
    reset_at: null,
    official_url: "https://chatgpt.com/codex",
    source: "signed_feed" as const,
    observed_at: publishedAt,
    previous_used_percent: null,
    current_used_percent: null,
    confidence: "confirmed" as const,
    alert_eligible: true,
    occurred_at: publishedAt,
    source_url: "https://x.com/OpenAI/status/1950000000000000000",
    reset_kind: "hard" as const,
    reset_scope: "all_paid_users" as const,
    ...overrides,
  };
}

function createQueuedLockManager() {
  let tail: Promise<unknown> = Promise.resolve();
  const request = vi.fn(<T,>(
    name: string,
    options: LockOptions,
    callback: LockGrantedCallback<T>,
  ): Promise<T> => {
    const result = tail.then(() => callback({
      name,
      mode: options.mode || "exclusive",
    }));
    tail = result.then(() => undefined, () => undefined);
    return result;
  });
  return {
    manager: {
      request,
      query: async () => ({ held: [], pending: [] }),
    } as LockManager,
    request,
  };
}

function createControlledLockManager() {
  let tail: Promise<unknown> = Promise.resolve();
  const releases: Array<() => void> = [];
  const request = vi.fn(<T,>(
    name: string,
    options: LockOptions,
    callback: LockGrantedCallback<T>,
  ): Promise<T> => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    releases.push(release);
    const result = tail
      .then(() => gate)
      .then(() => callback({
        name,
        mode: options.mode || "exclusive",
      }));
    tail = result.then(() => undefined, () => undefined);
    return result;
  });
  return {
    manager: {
      request,
      query: async () => ({ held: [], pending: [] }),
    } as LockManager,
    request,
    grantNext() {
      releases.shift()?.();
    },
  };
}

function responseWithEvents(events: any[]) {
  return {
    ...response,
    status: { ...response.status },
    events,
    tray_events: events,
    widget_events: events,
    notification_events: [],
    history: events.filter(
      (event) => event.type === "official_reset_announcement",
    ),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <CodexResetEventsProvider enabled>{children}</CodexResetEventsProvider>;
}

describe("Codex reset events provider", () => {
  let lockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    const locks = createQueuedLockManager();
    lockRequest = locks.request;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: locks.manager,
    });
    api.getCodexResetEvents.mockReset().mockResolvedValue(response);
    api.checkCodexResetEvents.mockReset().mockResolvedValue(response);
    api.acknowledgeCodexResetEvent.mockReset().mockResolvedValue(undefined);
    api.markCodexResetEventDelivered.mockReset().mockResolvedValue(undefined);
    notification.showCodexResetNotification.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "locks");
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("fetches immediately, refreshes every 60 seconds, and checks through the local API on focus", async () => {
    const { result } = renderHook(() => useCodexResetEvents(), { wrapper });
    await act(async () => Promise.resolve());
    expect(api.getCodexResetEvents).toHaveBeenCalledTimes(1);
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.history).toEqual(response.history);

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

  it("retains last-known-good history but marks transport failure as cached", async () => {
    const { result } = renderHook(() => useCodexResetEvents(), { wrapper });
    await act(async () => Promise.resolve());
    expect(result.current.dataState).toBe("current");

    api.checkCodexResetEvents.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await result.current.checkNow(false);
    });

    expect(result.current.history).toEqual(response.history);
    expect(result.current.dataState).toBe("cached");
    expect(result.current.available).toBe(false);
  });

  it("leaves initial loading and reports unavailable when the first request fails", async () => {
    api.getCodexResetEvents.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useCodexResetEvents(), { wrapper });
    expect(result.current.dataState).toBe("loading");

    await act(async () => Promise.resolve());

    expect(result.current.dataState).toBe("unavailable");
    expect(result.current.history).toEqual([]);
    expect(result.current.available).toBe(false);
  });

  it("starts a forced POST without waiting for an ordinary GET and ignores the late GET", async () => {
    const initial = deferred<any>();
    const forcedResponse = responseWithEvents([officialReset({ id: "forced-result" })]);
    api.getCodexResetEvents.mockReturnValueOnce(initial.promise);
    api.checkCodexResetEvents.mockResolvedValueOnce(forcedResponse);
    const { result } = renderHook(() => useCodexResetEvents(), { wrapper });
    expect(api.getCodexResetEvents).toHaveBeenCalledOnce();

    let forced!: Promise<void>;
    act(() => {
      forced = result.current.checkNow(true);
    });
    try {
      await act(async () => Promise.resolve());
      expect(api.checkCodexResetEvents).toHaveBeenCalledOnce();
      expect(api.checkCodexResetEvents).toHaveBeenCalledWith(true);
    } finally {
      initial.resolve(response);
      await act(async () => {
        await initial.promise;
        await forced;
      });
    }
    expect(result.current.history).toEqual(forcedResponse.history);

    await act(async () => Promise.resolve());
    expect(result.current.history).toEqual(forcedResponse.history);
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

  it("acknowledges the reset globally and restores every surface", async () => {
    const { result } = renderHook(() => useCodexResetEvents(), { wrapper });
    await act(async () => Promise.resolve());
    await act(async () => {
      await result.current.acknowledgeWidget("reset-1");
    });

    expect(api.acknowledgeCodexResetEvent).toHaveBeenCalledWith("reset-1");
    expect(result.current.widgetEvents).toEqual([]);
    expect(result.current.events).toEqual([]);
  });

  it("claims each native notification before showing it and does not repeat it", async () => {
    renderHook(() => useCodexResetEvents(), { wrapper });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.markCodexResetEventDelivered).toHaveBeenCalledWith(
      "reset-1",
      "windows_notification",
    );
    expect(notification.showCodexResetNotification).toHaveBeenCalledWith(
      response.notification_events[0],
    );
    expect(api.markCodexResetEventDelivered.mock.invocationCallOrder[0]).toBeLessThan(
      notification.showCodexResetNotification.mock.invocationCallOrder[0],
    );

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(notification.showCodexResetNotification).toHaveBeenCalledTimes(1);
  });

  it("dispatches the exact latest applicable official reset celebration once", async () => {
    const older = officialReset({
      id: "official-reset-old",
      publishedAt: "2026-07-29T12:00:00.000Z",
    });
    const latest = officialReset();
    const nextResponse = responseWithEvents([older, latest]);
    api.getCodexResetEvents.mockResolvedValue(nextResponse);
    const celebrations: CustomEvent[] = [];
    const onCelebration = (event: Event) => {
      celebrations.push(event as CustomEvent);
    };
    window.addEventListener(
      "token-eyes:official-reset-celebration",
      onCelebration,
    );

    try {
      const { result } = renderHook(() => useCodexResetEvents(), { wrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(celebrations).toHaveLength(1);
      expect(celebrations[0].detail).toEqual({
        eventId: "official-reset-42",
        provider: "codex",
        occurredAt: "2026-07-30T12:00:00.000Z",
        sourceUrl: "https://x.com/OpenAI/status/1950000000000000000",
        resetKind: "official-extra-reset",
        appliesToCurrentUsage: true,
      });
      expect(result.current.events).toEqual(nextResponse.events);
      expect(result.current.history).toEqual(nextResponse.history);

      await act(async () => {
        vi.advanceTimersByTime(60_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(celebrations).toHaveLength(1);
    } finally {
      window.removeEventListener(
        "token-eyes:official-reset-celebration",
        onCelebration,
      );
    }
  });

  it("does not repeat a celebration across StrictMode effects or remounts", async () => {
    api.getCodexResetEvents.mockResolvedValue(
      responseWithEvents([officialReset()]),
    );
    const celebrations: CustomEvent[] = [];
    const onCelebration = (event: Event) => {
      celebrations.push(event as CustomEvent);
    };
    window.addEventListener(
      "token-eyes:official-reset-celebration",
      onCelebration,
    );
    const strictWrapper = ({ children }: { children: React.ReactNode }) => (
      <React.StrictMode>
        <CodexResetEventsProvider enabled>{children}</CodexResetEventsProvider>
      </React.StrictMode>
    );

    try {
      const first = renderHook(() => useCodexResetEvents(), {
        wrapper: strictWrapper,
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      first.unmount();
      renderHook(() => useCodexResetEvents(), { wrapper: strictWrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(celebrations).toHaveLength(1);
    } finally {
      window.removeEventListener(
        "token-eyes:official-reset-celebration",
        onCelebration,
      );
    }
  });

  it("selects the newest official announcement by occurrence time even when unordered", async () => {
    const events = [
      officialReset({
        id: "middle",
        publishedAt: "2026-07-29T12:00:00.000Z",
      }),
      officialReset({
        id: "newest",
        publishedAt: "2026-07-30T12:00:00.000Z",
      }),
      officialReset({
        id: "oldest",
        publishedAt: "2026-07-28T12:00:00.000Z",
      }),
    ];
    api.getCodexResetEvents.mockResolvedValue(responseWithEvents(events));
    const details: any[] = [];
    const onCelebration = (event: Event) => {
      details.push((event as CustomEvent).detail);
    };
    window.addEventListener(
      "token-eyes:official-reset-celebration",
      onCelebration,
    );

    try {
      renderHook(() => useCodexResetEvents(), { wrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(details).toHaveLength(1);
      expect(details[0].eventId).toBe("newest");
    } finally {
      window.removeEventListener(
        "token-eyes:official-reset-celebration",
        onCelebration,
      );
    }
  });

  it("does not fall back to an older celebration when the latest record is untraceable", async () => {
    const events = [
      officialReset({
        id: "older-valid",
        publishedAt: "2026-07-29T12:00:00.000Z",
      }),
      officialReset({
        id: "latest-untraceable",
        occurred_at: undefined,
        created_at: "2026-07-30T12:00:01.000Z",
      }),
    ];
    api.getCodexResetEvents.mockResolvedValue(responseWithEvents(events));
    const onCelebration = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.addEventListener(
      "token-eyes:official-reset-celebration",
      onCelebration,
    );

    try {
      renderHook(() => useCodexResetEvents(), { wrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onCelebration).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(
        "token-eyes:official-reset-celebrated:v1",
      )).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        "[official-reset-celebration] skipped",
        { reason: "missing-occurred-at" },
      );
    } finally {
      warn.mockRestore();
      window.removeEventListener(
        "token-eyes:official-reset-celebration",
        onCelebration,
      );
    }
  });

  it("keeps notification delivery independent from celebration delivery", async () => {
    const official = officialReset();
    const nextResponse = {
      ...responseWithEvents([official]),
      notification_events: [official],
    };
    api.getCodexResetEvents.mockResolvedValue(nextResponse);

    renderHook(() => useCodexResetEvents(), { wrapper });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.markCodexResetEventDelivered).toHaveBeenCalledWith(
      "official-reset-42",
      "windows_notification",
    );
    expect(notification.showCodexResetNotification).toHaveBeenCalledWith(
      official,
    );
  });

  it("uses one shared exclusive lock across concurrent provider instances", async () => {
    api.getCodexResetEvents.mockResolvedValue(
      responseWithEvents([officialReset()]),
    );
    const onCelebration = vi.fn();
    window.addEventListener(
      "token-eyes:official-reset-celebration",
      onCelebration,
    );

    try {
      renderHook(() => useCodexResetEvents(), { wrapper });
      renderHook(() => useCodexResetEvents(), { wrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(lockRequest).toHaveBeenCalledTimes(2);
      expect(onCelebration).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(
        "token-eyes:official-reset-celebration",
        onCelebration,
      );
    }
  });

  it("cancels a stale queued claim and lets the current response dispatch", async () => {
    const firstEvent = officialReset({
      id: "official-reset-first",
      publishedAt: "2026-07-29T12:00:00.000Z",
    });
    const currentEvent = officialReset({
      id: "official-reset-current",
      publishedAt: "2026-07-30T12:00:00.000Z",
    });
    api.getCodexResetEvents
      .mockResolvedValueOnce(responseWithEvents([firstEvent]))
      .mockResolvedValue(responseWithEvents([currentEvent]));
    const locks = createControlledLockManager();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: locks.manager,
    });
    const details: any[] = [];
    const onCelebration = (event: Event) => {
      details.push((event as CustomEvent).detail);
    };
    window.addEventListener(
      "token-eyes:official-reset-celebration",
      onCelebration,
    );

    try {
      renderHook(() => useCodexResetEvents(), { wrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(locks.request).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(60_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(locks.request).toHaveBeenCalledTimes(2);

      await act(async () => {
        locks.grantNext();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(details).toEqual([]);
      expect(window.localStorage.getItem(
        "token-eyes:official-reset-celebrated:v1",
      )).toBeNull();

      await act(async () => {
        locks.grantNext();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(details).toHaveLength(1);
      expect(details[0].eventId).toBe("official-reset-current");
      expect(window.localStorage.getItem(
        "token-eyes:official-reset-celebrated:v1",
      )).toBe("official-reset-current");
    } finally {
      window.removeEventListener(
        "token-eyes:official-reset-celebration",
        onCelebration,
      );
    }
  });

  it("fails closed without Web Locks and leaves the event unclaimed", async () => {
    Reflect.deleteProperty(navigator, "locks");
    api.getCodexResetEvents.mockResolvedValue(
      responseWithEvents([officialReset()]),
    );
    const onCelebration = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.addEventListener(
      "token-eyes:official-reset-celebration",
      onCelebration,
    );

    try {
      renderHook(() => useCodexResetEvents(), { wrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onCelebration).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(
        "token-eyes:official-reset-celebrated:v1",
      )).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        "[official-reset-celebration] skipped",
        { reason: "lock-unavailable" },
      );
    } finally {
      window.removeEventListener(
        "token-eyes:official-reset-celebration",
        onCelebration,
      );
    }
  });

  it("keeps a claimed event deduplicated when dispatch throws", async () => {
    api.getCodexResetEvents.mockResolvedValue(
      responseWithEvents([officialReset()]),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dispatch = vi.spyOn(window, "dispatchEvent")
      .mockImplementation((event: Event) => {
        if (event.type === "token-eyes:official-reset-celebration") {
          throw new DOMException("dispatch failed");
        }
        return true;
      });

    renderHook(() => useCodexResetEvents(), { wrapper });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.localStorage.getItem(
      "token-eyes:official-reset-celebrated:v1",
    )).toBe("official-reset-42");
    expect(warn).toHaveBeenCalledWith(
      "[official-reset-celebration] skipped",
      { reason: "dispatch-failed" },
    );

    dispatch.mockClear();
    renderHook(() => useCodexResetEvents(), { wrapper });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "token-eyes:official-reset-celebration",
      }),
    );
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

  it("does not claim or dispatch a request that resolves after the provider is disabled", async () => {
    const pending = deferred<any>();
    api.getCodexResetEvents.mockReturnValueOnce(pending.promise);
    const onCelebration = vi.fn();
    window.addEventListener(
      "token-eyes:official-reset-celebration",
      onCelebration,
    );

    try {
      const view = render(
        <CodexResetEventsProvider enabled>
          <div />
        </CodexResetEventsProvider>,
      );
      expect(api.getCodexResetEvents).toHaveBeenCalledOnce();

      view.rerender(
        <CodexResetEventsProvider enabled={false}>
          <div />
        </CodexResetEventsProvider>,
      );
      await act(async () => {
        pending.resolve(responseWithEvents([officialReset()]));
        await pending.promise;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(lockRequest).not.toHaveBeenCalled();
      expect(onCelebration).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(
        "token-eyes:official-reset-celebrated:v1",
      )).toBeNull();
    } finally {
      window.removeEventListener(
        "token-eyes:official-reset-celebration",
        onCelebration,
      );
    }
  });
});
