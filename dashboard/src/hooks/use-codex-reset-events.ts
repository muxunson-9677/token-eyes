import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  acknowledgeCodexResetEvent,
  checkCodexResetEvents,
  getCodexResetEvents,
  markCodexResetEventDelivered,
  type CodexResetEvent,
  type CodexResetEventsResponse,
  type CodexResetHistoryEvent,
  type CodexResetMonitorStatus,
} from "../lib/api";
import { showCodexResetNotification } from "../lib/codex-reset-notification";
import { syncCodexResetTrayStatus } from "../lib/codex-reset-tray";
import {
  claimOfficialResetCelebration,
  reportOfficialResetCelebrationFailure,
  toOfficialResetCelebrationEvent,
} from "../lib/official-reset-celebration";

const REFRESH_INTERVAL_MS = 60_000;

interface CodexResetEventsContextValue {
  available: boolean;
  events: CodexResetEvent[];
  widgetEvents: CodexResetEvent[];
  history: CodexResetHistoryEvent[];
  unreadCount: number;
  status: CodexResetMonitorStatus | null;
  acknowledge: (eventId: string) => Promise<void>;
  acknowledgeWidget: (eventId: string) => Promise<void>;
  checkNow: (force?: boolean) => Promise<void>;
}

const EMPTY_CONTEXT: CodexResetEventsContextValue = {
  available: false,
  events: [],
  widgetEvents: [],
  history: [],
  unreadCount: 0,
  status: null,
  acknowledge: async () => {},
  acknowledgeWidget: async () => {},
  checkNow: async () => {},
};

const CodexResetEventsContext =
  createContext<CodexResetEventsContextValue>(EMPTY_CONTEXT);

function latestOfficialResetAnnouncement(
  events: CodexResetEvent[],
): CodexResetEvent | null {
  const announcements = events.filter(
    (event) => event.type === "official_reset_announcement",
  );
  const untraceable = announcements.find(
    (event) => !Number.isFinite(Date.parse(event.occurred_at || "")),
  );
  if (untraceable) return untraceable;

  let latest: CodexResetEvent | null = null;
  let latestRecency = Number.NEGATIVE_INFINITY;
  for (const event of announcements) {
    const recency = Date.parse(event.occurred_at!);
    if (!latest || recency > latestRecency) {
      latest = event;
      latestRecency = recency;
    }
  }
  return latest;
}

export function CodexResetEventsProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const [response, setResponse] = useState<CodexResetEventsResponse | null>(null);
  const [available, setAvailable] = useState(false);
  const requestRef = useRef<Promise<void> | null>(null);
  const claimedNotificationsRef = useRef(new Set<string>());

  const run = useCallback((request: () => Promise<CodexResetEventsResponse>) => {
    if (!enabled) return Promise.resolve();
    if (requestRef.current) return requestRef.current;
    const pending = request()
      .then((next) => {
        setResponse(next);
        setAvailable(true);
      })
      .catch(() => {
        setAvailable(false);
      })
      .finally(() => {
        requestRef.current = null;
      });
    requestRef.current = pending;
    return pending;
  }, [enabled]);

  const refresh = useCallback(() => run(getCodexResetEvents), [run]);
  const checkNow = useCallback(
    (force = false) => run(() => checkCodexResetEvents(force === true)),
    [run],
  );

  useEffect(() => {
    if (!enabled) {
      setResponse(null);
      setAvailable(false);
      return undefined;
    }
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    const onFocus = () => {
      void checkNow(false);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkNow, enabled, refresh]);

  useEffect(() => {
    void syncCodexResetTrayStatus(response?.tray_events || response?.events || []);
  }, [response]);

  useEffect(() => {
    if (!response) return;
    let current = true;
    const latest = latestOfficialResetAnnouncement(response.events);
    if (!latest) return;
    const celebration = toOfficialResetCelebrationEvent(latest, response.status);
    if (!celebration) return;
    void claimOfficialResetCelebration(celebration, {
      isCurrent: () => current,
      onClaim: () => {
        if (!current) return;
        try {
          window.dispatchEvent(new CustomEvent(
            "token-eyes:official-reset-celebration",
            { detail: celebration },
          ));
        } catch {
          reportOfficialResetCelebrationFailure("dispatch-failed");
        }
      },
    });
    return () => {
      current = false;
    };
  }, [response]);

  useEffect(() => {
    for (const event of response?.notification_events || []) {
      if (claimedNotificationsRef.current.has(event.id)) continue;
      claimedNotificationsRef.current.add(event.id);
      void markCodexResetEventDelivered(event.id, "windows_notification")
        .then(() => showCodexResetNotification(event))
        .catch(() => {
          claimedNotificationsRef.current.delete(event.id);
        });
    }
  }, [response]);

  const acknowledge = useCallback(async (eventId: string) => {
    if (!enabled) return;
    await acknowledgeCodexResetEvent(eventId);
    setResponse((current) => {
      if (!current) return current;
      const events = current.events.filter((event) => event.id !== eventId);
      return {
        ...current,
        events,
        status: {
          ...current.status,
          unread_count: events.length,
        },
      };
    });
  }, [enabled]);

  const acknowledgeWidget = useCallback(async (eventId: string) => {
    if (!enabled) return;
    await acknowledgeCodexResetEvent(eventId);
    setResponse((current) => {
      if (!current) return current;
      return {
        ...current,
        events: current.events.filter((event) => event.id !== eventId),
        widget_events: (current.widget_events || [])
          .filter((event) => event.id !== eventId),
        tray_events: (current.tray_events || [])
          .filter((event) => event.id !== eventId),
        status: {
          ...current.status,
          unread_count: Math.max(0, current.status.unread_count - 1),
        },
      };
    });
  }, [enabled]);

  const value = useMemo<CodexResetEventsContextValue>(() => ({
    available,
    events: response?.events || [],
    widgetEvents: response?.widget_events || response?.events || [],
    history: response?.history || [],
    unreadCount: response?.events.length || 0,
    status: response?.status || null,
    acknowledge,
    acknowledgeWidget,
    checkNow,
  }), [acknowledge, acknowledgeWidget, available, checkNow, response]);

  return React.createElement(
    CodexResetEventsContext.Provider,
    { value },
    children,
  );
}

export function useCodexResetEvents(): CodexResetEventsContextValue {
  return useContext(CodexResetEventsContext);
}

export { REFRESH_INTERVAL_MS };
