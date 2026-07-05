import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { copy } from "../lib/copy";
import { Button } from "../ui/components/Button.jsx";
import { isTauriApp } from "../lib/native-bridge.js";
import {
  getLastLocalApiRuntimeError,
  retryLocalApiOrigin,
} from "../lib/local-api-url";

/**
 * RuntimeErrorBanner — surfaces a structured `[E_RUNTIME_*]` error raised
 * by the Tauri backend when the bundled Node.js server fails to start.
 *
 * Security contract:
 * - Renders ONLY the structured error code (e.g. `E_RUNTIME_MISSING_NODE`).
 * - Never renders the raw backend message, which may contain absolute
 *   paths, usernames, or environment-variable values — those are written
 *   to the runtime log on the Rust side after `sanitize_message()`.
 * - The user-facing hint references the code as "safe to share".
 *
 * The banner is rendered above the page tree (not a full-screen
 * replacement) so the user can dismiss/retry without losing context.
 * Retry clears the cached origin promise via `retryLocalApiOrigin()`
 * so the next `getLocalApiOrigin()` call re-resolves from scratch.
 */
export function RuntimeErrorBanner() {
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);

  // Poll for the latest runtime error. The error is set by
  // `resolveTauriLocalApiOrigin()` when the invoke rejects with a
  // structured code, but the banner can mount before the rejection
  // lands (e.g. during the initial 5-retry backoff). A short interval
  // poll picks it up as soon as it's available.
  useEffect(() => {
    if (!isTauriApp()) return;
    setError(getLastLocalApiRuntimeError());
    const interval = setInterval(() => {
      const latest = getLastLocalApiRuntimeError();
      setError((prev) => (prev?.code === latest?.code ? prev : latest));
      if (latest) setRetrying(false);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const handleRetry = useCallback(() => {
    setRetrying(true);
    retryLocalApiOrigin();
    // The interval poll above will flip `retrying` off once the next
    // resolution completes (either success → error=null, or another
    // structured error). A 6s safety net prevents a stuck spinner.
    setTimeout(() => setRetrying(false), 6000);
  }, []);

  if (!error) return null;

  // Render only the structured code, never the raw message.
  const codeText = error?.code || "E_RUNTIME_UNKNOWN";

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="pointer-events-auto fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pt-4 font-oai"
    >
      <div className="w-full max-w-lg rounded-xl border border-amber-200 bg-white p-4 shadow-lg dark:border-amber-900/50 dark:bg-oai-gray-900">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium uppercase text-oai-gray-500 dark:text-oai-gray-400">
              {copy("runtime.error.title")}
            </div>
            <h2 className="mt-1 text-sm font-semibold text-oai-black dark:text-white">
              {copy("runtime.error.subtitle")}
            </h2>
            <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {copy("runtime.error.hint")}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase text-oai-gray-400 dark:text-oai-gray-500">
                {copy("runtime.error.code_label")}
              </span>
              <code className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                {codeText}
              </code>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleRetry}
            disabled={retrying}
            className="shrink-0"
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`}
              aria-hidden
            />
            {copy("runtime.error.retry_action")}
          </Button>
        </div>
      </div>
    </div>
  );
}
