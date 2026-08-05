import React, { useCallback, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Bell,
  Minus,
  Moon,
  RotateCw,
  Square,
  Sun,
  X,
} from "lucide-react";
import { useTheme } from "../../hooks/useTheme.js";
import { useCodexResetEvents } from "../../hooks/use-codex-reset-events";
import { getLastCloudSyncTs } from "../../lib/cloud-sync-prefs.ts";
import { copy } from "../../lib/copy";

function syncLabel() {
  const lastSync = getLastCloudSyncTs();
  if (!lastSync) return copy("native.window.sync.local");
  const ageMs = Math.max(0, Date.now() - lastSync);
  if (ageMs < 5 * 60_000) return copy("native.window.sync.recent");
  return copy("native.window.sync.earlier");
}

function WindowButton({ label, onClick, children, danger = false }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`tt-native-window-button${danger ? " tt-native-window-button--danger" : ""}`}
    >
      {children}
    </button>
  );
}

export function NativeWindowBar() {
  const { resolvedTheme, setTheme } = useTheme();
  const { unreadCount } = useCodexResetEvents();
  const currentSyncLabel = useMemo(syncLabel, []);
  const ThemeIcon = resolvedTheme === "dark" ? Moon : Sun;

  const runWindowAction = useCallback((action) => {
    try {
      const appWindow = getCurrentWindow();
      void appWindow?.[action]?.();
    } catch {
      // Window actions are unavailable only outside the Tauri host. The bar is
      // mounted exclusively in the native Windows shell.
    }
  }, []);

  return (
    <header className="tt-native-window-bar" data-tauri-drag-region>
      <div className="tt-native-window-brand" data-tauri-drag-region>
        <span className="tt-native-brand-mark" aria-hidden>{copy("shared.app_initial")}</span>
        <span>{copy("shared.app_name")}</span>
      </div>

      <div className="tt-native-window-tools">
        <div className="tt-native-status-pill" aria-label={copy("native.window.status.label")}>
          <span className="tt-native-status-dot" aria-hidden />
          <span>{copy("native.window.status.label")}</span>
          <strong className="tt-native-status-value">{copy("native.window.status.normal")}</strong>
        </div>
        <div className="tt-native-status-pill">
          <RotateCw aria-hidden />
          <span>{currentSyncLabel}</span>
        </div>
        <span
          className="tt-native-notification-status"
          role="status"
          aria-label={copy("native.window.notifications")}
          data-unread-count={String(unreadCount || 0)}
        >
          <Bell aria-hidden />
          {Boolean(unreadCount) ? <span className="tt-native-notification-dot" aria-hidden /> : null}
        </span>
        <button
          type="button"
          aria-label={copy("settings.appearance.theme.label")}
          title={copy("settings.appearance.theme.label")}
          className="tt-native-theme-button"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <ThemeIcon aria-hidden />
        </button>
        <span className="tt-native-window-divider" aria-hidden />
        <WindowButton
          label={copy("native.window.minimize")}
          onClick={() => runWindowAction("minimize")}
        >
          <Minus aria-hidden />
        </WindowButton>
        <WindowButton
          label={copy("native.window.maximize")}
          onClick={() => runWindowAction("toggleMaximize")}
        >
          <Square aria-hidden />
        </WindowButton>
        <WindowButton
          label={copy("native.window.close")}
          onClick={() => runWindowAction("close")}
          danger
        >
          <X aria-hidden />
        </WindowButton>
      </div>
    </header>
  );
}
