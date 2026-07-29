import { useCallback, useEffect, useRef, useState } from "react";
import {
  acknowledgeCodexResetEvent,
  getDesktopWidgetViewModel,
  type DesktopWidgetPrefs,
  type DesktopWidgetViewModel,
} from "../lib/api";

const POLL_INTERVAL_MS = 30_000;

const DEFAULT_PREFS: DesktopWidgetPrefs = {
  version: 3,
  visible: true,
  x: null,
  y: null,
  width: 322,
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
  selectedProjectIds: [],
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

  const refresh = useCallback(async (agent = prefsRef.current.selectedAgent) => {
    try {
      const next = await getDesktopWidgetViewModel(agent);
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

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      const invoke = getInvoke();
      let restored = DEFAULT_PREFS;
      if (invoke) {
        try {
          restored = {
            ...DEFAULT_PREFS,
            ...(await invoke("get_desktop_widget_prefs")),
          };
        } catch {
          // Defaults keep the widget usable if preference restoration fails.
        }
      }
      if (cancelled) return;
      prefsRef.current = restored;
      setPrefs(restored);
      await refresh(restored.selectedAgent);
    };
    void initialize();
    const interval = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refresh]);

  const updatePrefs = useCallback(async (patch: Partial<DesktopWidgetPrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    const invoke = getInvoke();
    if (invoke) await invoke("set_desktop_widget_prefs", { prefs: next });
    if (patch.selectedAgent) await refresh(next.selectedAgent);
    return next;
  }, [refresh]);

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
    acknowledgePendingReset,
  };
}
