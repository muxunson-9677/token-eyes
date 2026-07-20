import type { CodexResetEvent, CodexResetEventType } from "./api";
import { isTauriRuntime } from "./local-api-url";

type TauriInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const EVENT_TYPES = new Set<CodexResetEventType>([
  "reset_upcoming",
  "reset_completed",
  "unexpected_quota_restore",
  "banked_reset_available",
  "official_reset_announcement",
]);

let lastTrayLabelKey: string | null = null;

function getTauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const tauri = (window as any).__TAURI__;
  if (typeof tauri?.core?.invoke === "function") return tauri.core.invoke;
  if (typeof tauri?.invoke === "function") return tauri.invoke;
  const internals = (window as any).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function" ? internals.invoke : null;
}

function normalizeLatestType(
  events: ReadonlyArray<Pick<CodexResetEvent, "type">>,
): CodexResetEventType | null {
  const value = events[0]?.type;
  return EVENT_TYPES.has(value) ? value : null;
}

function deriveTrayLabelKey(
  unreadCount: number,
  latestType: CodexResetEventType | null,
): string {
  const boundedCount = Math.min(999, Math.max(0, unreadCount));
  if (boundedCount === 0) return "empty";
  if (boundedCount === 1 && latestType === "reset_completed") {
    return "completed";
  }
  return `unread:${boundedCount}`;
}

export async function syncCodexResetTrayStatus<
  Event extends Pick<CodexResetEvent, "type">,
>(
  events: Event[],
): Promise<void> {
  if (!isTauriRuntime()) return;
  const invoke = getTauriInvoke();
  if (!invoke) return;

  const unreadCount = Math.min(999, Math.max(0, events.length));
  const latestType = normalizeLatestType(events);
  const labelKey = deriveTrayLabelKey(unreadCount, latestType);
  if (labelKey === lastTrayLabelKey) return;

  try {
    await invoke("set_codex_reset_tray_status", {
      unreadCount,
      latestType,
    });
    lastTrayLabelKey = labelKey;
  } catch {
    // The in-app alert remains authoritative if the optional tray bridge fails.
  }
}

export function resetCodexResetTraySyncForTests(): void {
  lastTrayLabelKey = null;
}
