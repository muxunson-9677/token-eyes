import React, { useCallback, useMemo, useState } from "react";
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
  const { unreadCount, events = [], acknowledge } = useCodexResetEvents();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const currentSyncLabel = useMemo(syncLabel, []);
  const ThemeIcon = resolvedTheme === "dark" ? Moon : Sun;

  const runWindowAction = useCallback((action) => {
    try {
      const appWindow = getCurrentWindow();
      const actionMethod = appWindow?.[action];
      if (typeof actionMethod !== "function") return;
      const result = actionMethod.call(appWindow);
      if (result && typeof result.catch === "function") {
        void result.catch((error) => {
          console.error(`[Token Eyes] native window action failed: ${action}`, error);
        });
      }
    } catch (error) {
      // Window actions are unavailable only outside the Tauri host. The bar is
      // mounted exclusively in the native Windows shell.
      console.error(`[Token Eyes] native window action failed: ${action}`, error);
    }
  }, []);

  return (
    <header className="tt-native-window-bar" data-tauri-drag-region>
      <div className="tt-native-window-brand" data-tauri-drag-region>
        <img src="/app-icon.png" alt="" aria-hidden />
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
        <button
          type="button"
          className="tt-native-notification-status"
          aria-label={copy("native.window.notifications")}
          aria-expanded={notificationsOpen}
          aria-controls="native-reset-notifications"
          data-unread-count={String(unreadCount || 0)}
          onClick={() => setNotificationsOpen((open) => !open)}
        >
          <Bell aria-hidden />
          {unreadCount ? <span className="tt-native-notification-dot" aria-hidden /> : null}
        </button>
        {notificationsOpen ? (
          <section id="native-reset-notifications" className="tt-native-notification-panel" aria-label={copy("native.window.notifications")}>
            {events.length > 0 ? events.slice(0, 3).map((event) => (
              <article key={event.id} className="tt-native-notification-item">
                <div className="min-w-0">
                  <strong>{event.title}</strong>
                  {event.summary ? <p>{event.summary}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void acknowledge?.(event.id);
                    setNotificationsOpen(false);
                  }}
                >
                  {copy("codex_reset.action.acknowledge")}
                </button>
              </article>
            )) : (
              <p className="tt-native-notification-empty">{copy("native.window.notifications.empty")}</p>
            )}
          </section>
        ) : null}
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
