import React, { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { copy } from "../../lib/copy";

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
        <img src="/app-icon.png" alt={copy("shared.app_name")} draggable="false" />
        <span>{copy("shared.app_name")}</span>
      </div>

      <div className="tt-native-window-tools">
        <WindowButton
          label={copy("native.window.minimize")}
          onClick={() => runWindowAction("minimize")}
        >
          <Minus className="tt-native-window-icon" aria-hidden />
        </WindowButton>
        <WindowButton
          label={copy("native.window.maximize")}
          onClick={() => runWindowAction("toggleMaximize")}
        >
          <Square className="tt-native-window-icon" aria-hidden />
        </WindowButton>
        <WindowButton
          label={copy("native.window.close")}
          onClick={() => runWindowAction("close")}
          danger
        >
          <X className="tt-native-window-icon" aria-hidden />
        </WindowButton>
      </div>
    </header>
  );
}
