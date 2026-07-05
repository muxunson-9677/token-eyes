export const DEFAULT_TAURI_LOCAL_API_ORIGIN = "http://127.0.0.1:7680";
const REQUIRED_LOCAL_API_CAPABILITIES = [
  "spend_usage_v2",
  "provider_model_stats",
  "request_usage_records",
  "provider_api_balance",
];

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type LocalServerStatus = { running?: boolean; url?: string };

/**
 * Structured runtime error raised when the bundled backend fails to
 * start. The Rust side prefixes every startup-path error with a
 * bracketed code like `[E_RUNTIME_MISSING_NODE]` so the frontend can
 * parse it and render a targeted retry/diagnostic UI instead of
 * silently falling back to a broken default port.
 */
export type LocalApiRuntimeErrorCode =
  | "E_RUNTIME_RESOURCE_DIR"
  | "E_RUNTIME_MISSING_NODE"
  | "E_RUNTIME_MISSING_TRACKER"
  | "E_RUNTIME_MISSING_DASHBOARD"
  | "E_RUNTIME_MISSING_MANIFEST"
  | "E_RUNTIME_PORT_EXHAUSTED"
  | "E_RUNTIME_STARTUP_TIMEOUT"
  | "E_RUNTIME_BACKEND_CRASHED"
  | "E_RUNTIME_UNKNOWN";

const RUNTIME_ERROR_CODE_PATTERN = /\[E_RUNTIME_[A-Z_]+\]/;

export class LocalApiRuntimeError extends Error {
  readonly code: LocalApiRuntimeErrorCode;
  readonly rawMessage: string;

  constructor(code: LocalApiRuntimeErrorCode, message: string) {
    super(message);
    this.name = "LocalApiRuntimeError";
    this.code = code;
    this.rawMessage = message;
  }
}

function parseRuntimeErrorCode(err: unknown): LocalApiRuntimeError | null {
  if (err === null || err === undefined) return null;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  const match = message.match(RUNTIME_ERROR_CODE_PATTERN);
  if (!match) return null;
  const code = match[0].slice(1, -1) as LocalApiRuntimeErrorCode;
  return new LocalApiRuntimeError(code, message);
}

let tauriLocalApiOriginPromise: Promise<string> | null = null;
let lastRuntimeError: LocalApiRuntimeError | null = null;

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
}

export function isLocalDashboardRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return (
    isTauriRuntime() ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function getTauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const tauri = (window as any).__TAURI__;
  if (typeof tauri?.core?.invoke === "function") return tauri.core.invoke;
  if (typeof tauri?.invoke === "function") return tauri.invoke;
  const internals = (window as any).__TAURI_INTERNALS__;
  if (typeof internals?.invoke === "function") return internals.invoke;
  return null;
}

function hasRequiredLocalApiCapabilities(json: any): boolean {
  if (!json || Number(json.protocol_version) < 2) return false;
  const capabilities = Array.isArray(json.capabilities) ? json.capabilities : [];
  return REQUIRED_LOCAL_API_CAPABILITIES.every((cap) => capabilities.includes(cap));
}

/**
 * Resolve the local API origin when running inside the Tauri WebView.
 *
 * Behavior:
 * - If `local_server_status` returns a running URL, cache and return it.
 * - If the invoke rejects with a structured `[E_RUNTIME_*]` error, throw
 *   a `LocalApiRuntimeError` so the UI can render a targeted retry.
 *   We DO NOT fall back to `DEFAULT_TAURI_LOCAL_API_ORIGIN` — silently
 *   using port 7680 when the backend is broken hides the failure from
 *   the user and produces a non-functional dashboard.
 * - If the invoke fails without a structured code (transient network /
 *   IPC issue), retry up to 5 times with backoff, then probe common
 *   ports as a last resort. If no server is found, throw
 *   `E_RUNTIME_STARTUP_TIMEOUT` instead of caching the default port.
 */
async function resolveTauriLocalApiOrigin(): Promise<string> {
  const invoke = getTauriInvoke();
  if (!invoke) return DEFAULT_TAURI_LOCAL_API_ORIGIN;

  // Retry up to 5 times with backoff — the local API server may still be
  // starting up when the Tauri window first opens.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const status = (await invoke("local_server_status")) as LocalServerStatus | null;
      const url = typeof status?.url === "string" ? status.url.trim() : "";
      if (url && status?.running) {
        lastRuntimeError = null;
        return url;
      }
    } catch (err) {
      const runtimeErr = parseRuntimeErrorCode(err);
      if (runtimeErr) {
        // Structured error from the Rust side — backend is genuinely
        // broken (missing node.exe, port exhausted, crashed, etc.).
        // Don't fall back to a default port; surface the error.
        lastRuntimeError = runtimeErr;
        throw runtimeErr;
      }
      // Non-structured error (transient IPC failure) — retry.
    }
    // Wait before retrying (250ms, 500ms, 750ms, 1000ms, 1250ms)
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }

  // Final fallback: probe common ports directly from the frontend.
  // This handles the case where `local_server_status` returns
  // running=false but the server is actually up on a fallback port
  // (e.g. started by a separate `node serve` invocation).
  const probePorts = [7680, 7681, 7682, 7683, 17680, 17681];
  for (const port of probePorts) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/local-auth`, {
        method: "GET",
        signal: AbortSignal.timeout(800),
      });
      if (resp.ok) {
        const json = await resp.json();
        if (json && typeof json.token === "string" && hasRequiredLocalApiCapabilities(json)) {
          lastRuntimeError = null;
          return `http://127.0.0.1:${port}`;
        }
      }
    } catch {
      // port not serving — try next
    }
  }

  // No structured error, but no server found either. Don't cache the
  // broken default port — surface a timeout error so the UI can retry.
  const err = new LocalApiRuntimeError(
    "E_RUNTIME_STARTUP_TIMEOUT",
    "[E_RUNTIME_STARTUP_TIMEOUT] Local API server did not become ready after retries",
  );
  lastRuntimeError = err;
  throw err;
}

export async function getLocalApiOrigin(): Promise<string> {
  if (typeof window === "undefined") return DEFAULT_TAURI_LOCAL_API_ORIGIN;
  if (!isTauriRuntime()) return window.location.origin;
  if (!tauriLocalApiOriginPromise) {
    tauriLocalApiOriginPromise = resolveTauriLocalApiOrigin();
  }
  return tauriLocalApiOriginPromise;
}

export async function buildLocalApiUrl(path: string): Promise<string> {
  return new URL(path, await getLocalApiOrigin()).toString();
}

/**
 * Returns the last structured runtime error captured during
 * `getLocalApiOrigin()`, or null if the backend is healthy. The UI
 * uses this to render a retry banner with the error code.
 */
export function getLastLocalApiRuntimeError(): LocalApiRuntimeError | null {
  return lastRuntimeError;
}

/**
 * Clear the cached origin promise and last error so the next
 * `getLocalApiOrigin()` call re-resolves from scratch. Wired to the
 * "Retry" button in the runtime error banner.
 */
export function retryLocalApiOrigin(): void {
  tauriLocalApiOriginPromise = null;
  lastRuntimeError = null;
}

/**
 * Test-only: clear the cached promise so subsequent tests re-resolve.
 * Kept for backward compat with existing test suites.
 */
export function resetLocalApiOriginForTests(): void {
  tauriLocalApiOriginPromise = null;
  lastRuntimeError = null;
}
