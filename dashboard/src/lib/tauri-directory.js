/**
 * Tauri directory picker helper for Token Eyes.
 *
 * When running inside a Tauri WebView2 host (window.__TAURI_INTERNALS__ is
 * present), this invokes the Rust `pick_directory` command via Tauri IPC.
 * Falls back to null in browser / non-Tauri environments so callers can
 * proceed to other fallback paths (local API, PowerShell dialog, etc.).
 */

/**
 * Returns true if we are running inside a Tauri WebView2 host.
 */
export function isTauri() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

/**
 * Open a native folder picker via the Tauri Rust backend.
 * Returns the selected folder path string, or null if the user cancelled.
 * Throws only on IPC-level errors (e.g. Tauri internals present but invoke
 * unavailable - should not happen in practice).
 */
export async function selectDirectoryViaTauri() {
  if (!isTauri()) return null;

  try {
    // Tauri injects window.__TAURI_INTERNALS__ which exposes invoke().
    const { invoke } = window.__TAURI_INTERNALS__;
    const path = await invoke("pick_directory");
    // Rust command returns Option<String>: Some("path") or null.
    return typeof path === "string" && path.trim() ? path.trim() : null;
  } catch {
    // If the IPC call fails for any reason, return null so callers fall back.
    return null;
  }
}
