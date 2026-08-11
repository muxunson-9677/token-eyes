import { useCallback, useEffect, useRef, useState } from "react";
import {
  acknowledgeCodexResetEvent,
  getDesktopWidgetViewModel,
  type DesktopWidgetPrefs,
  type DesktopWidgetViewModel,
} from "../lib/api";

const POLL_INTERVAL_MS = 30_000;
const PREFS_CHANGED_EVENT = "token-eyes:desktop-widget-prefs-changed";

const DEFAULT_PREFS: DesktopWidgetPrefs = {
  version: 6,
  visible: true,
  x: null,
  y: null,
  width: 352,
  height: 72,
  collapsedHeight: 72,
  expandedHeight: 360,
  scaleFactor: 1,
  selectedAgent: "all",
  mode: "projects",
  expanded: false,
  material: "frost",
  opacity: 0.72,
  alwaysOnTop: true,
  activeSessionWindow: "1h",
  selectedProjectIds: [],
  selectedLimitIds: null,
  selectedProjects: [],
};

function getInvoke() {
  if (typeof window === "undefined") return null;
  const tauri = (window as any).__TAURI__;
  if (typeof tauri?.core?.invoke === "function") return tauri.core.invoke;
  if (typeof tauri?.invoke === "function") return tauri.invoke;
  return null;
}

export function useDesktopWidget() {
  const [prefs, setPrefs] = useState<DesktopWidgetPrefs>(DEFAULT_PREFS);
  const [viewModel, setViewModel] = useState<DesktopWidgetViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const prefsRef = useRef(prefs);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const refresh = useCallback(async (
    agent = prefsRef.current.selectedAgent,
    activeSessionWindow = prefsRef.current.activeSessionWindow,
  ) => {
    try {
      const next = await getDesktopWidgetViewModel(agent, activeSessionWindow);
      setViewModel(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadPrefs = useCallback(async () => {
    const invoke = getInvoke();
    let restored = DEFAULT_PREFS;
    if (invoke) {
      try {
        restored = {
          ...DEFAULT_PREFS,
          ...(await invoke("get_desktop_widget_prefs")),
        };
      } catch {
        restored = prefsRef.current;
      }
    }
    prefsRef.current = restored;
    setPrefs(restored);
    await refresh(restored.selectedAgent, restored.activeSessionWindow);
    return restored;
  }, [refresh]);

  useEffect(() => {
    const handlePrefsChanged = () => {
      void reloadPrefs();
    };
    void reloadPrefs();
    window.addEventListener(PREFS_CHANGED_EVENT, handlePrefsChanged);
    const interval = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      window.removeEventListener(PREFS_CHANGED_EVENT, handlePrefsChanged);
      window.clearInterval(interval);
    };
  }, [refresh, reloadPrefs]);

  const updatePrefs = useCallback(async (patch: Partial<DesktopWidgetPrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    const invoke = getInvoke();
    if (invoke) await invoke("set_desktop_widget_prefs", { prefs: next });
    if (patch.selectedAgent || patch.activeSessionWindow) {
      await refresh(next.selectedAgent, next.activeSessionWindow);
    }
    return next;
  }, [refresh]);

  const setPopoverOpen = useCallback(async (open: boolean) => {
    const invoke = getInvoke();
    if (invoke) await invoke("set_desktop_widget_popover", { open });
  }, []);

  const setCelebrationOpen = useCallback(async (open: boolean) => {
    const invoke = getInvoke();
    if (invoke) await invoke("set_desktop_widget_celebration", { open });
  }, []);

  const acknowledgePendingReset = useCallback(async () => {
    const eventId = viewModel?.pendingReset?.id;
    if (!eventId) return;
    await acknowledgeCodexResetEvent(eventId);
    await refresh();
  }, [refresh, viewModel?.pendingReset?.id]);

  return {
    prefs,
    viewModel,
    loading,
    error,
    refresh,
    updatePrefs,
    setPopoverOpen,
    setCelebrationOpen,
    acknowledgePendingReset,
  };
}
