/**
 * Token Eyes window / startup prefs via Tauri invoke.
 */

function getTauriInvoke() {
  if (typeof window === "undefined") return null;
  if (typeof window.__TAURI__?.core?.invoke === "function") {
    return window.__TAURI__.core.invoke;
  }
  if (typeof window.__TAURI__?.invoke === "function") {
    return window.__TAURI__.invoke;
  }
  if (typeof window.__TAURI_INTERNALS__?.invoke === "function") {
    return window.__TAURI_INTERNALS__.invoke;
  }
  return null;
}

/**
 * @typedef {{ minimizeToTrayOnClose: boolean, launchOnStartup: boolean, silentStartup: boolean }} WindowPrefs
 */

/** @returns {Promise<WindowPrefs>} */
export async function getWindowPrefs() {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("get_window_prefs");
}

/** @param {boolean} enabled */
export async function setMinimizeToTrayOnClose(enabled) {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("set_minimize_to_tray_on_close", { enabled });
}

/** @param {boolean} enabled */
export async function setLaunchOnStartup(enabled) {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("set_launch_on_startup", { enabled });
}

/** @param {boolean} enabled */
export async function setSilentStartup(enabled) {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke("set_silent_startup", { enabled });
}
