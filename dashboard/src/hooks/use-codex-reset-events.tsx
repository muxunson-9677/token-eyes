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
  type CodexResetEvent,
  type CodexResetEventsResponse,
  type CodexResetMonitorStatus,
} from "../lib/api";
import { syncCodexResetTrayStatus } from "../lib/codex-reset-tray";

const REFRESH_INTERVAL_MS = 60_000;

interface CodexResetEventsContextValue {
  available: boolean;
  events: CodexResetEvent[];
  unreadCount: number;
  status: CodexResetMonitorStatus | null;
  acknowledge: (eventId: string) => Promise<void>;
  checkNow: (force?: boolean) => Promise<void>;
}

const EMPTY_CONTEXT: CodexResetEventsContextValue = {
  available: false,
  events: [],
  unreadCount: 0,
  status: null,
  acknowledge: async () => {},
  checkNow: async () => {},
};

const CodexResetEventsContext =
  createContext<CodexResetEventsContextValue>(EMPTY_CONTEXT);

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
    void syncCodexResetTrayStatus(response?.events || []);
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

  const value = useMemo<CodexResetEventsContextValue>(() => ({
    available,
    events: response?.events || [],
    unreadCount: response?.events.length || 0,
    status: response?.status || null,
    acknowledge,
    checkNow,
  }), [acknowledge, available, checkNow, response]);

  return (
    <CodexResetEventsContext.Provider value={value}>
      {children}
    </CodexResetEventsContext.Provider>
  );
}

export function useCodexResetEvents(): CodexResetEventsContextValue {
  return useContext(CodexResetEventsContext);
}

export { REFRESH_INTERVAL_MS };
