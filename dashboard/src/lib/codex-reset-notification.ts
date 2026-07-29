import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import type { CodexResetEvent } from "./api";
import { isTauriRuntime } from "./local-api-url";

function resetWindowLabel(event: CodexResetEvent): string {
  return event.window === "rolling_weekly" ? "weekly" : "5-hour";
}

export async function showCodexResetNotification(
  event: CodexResetEvent,
): Promise<void> {
  if (!isTauriRuntime()) return;

  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) {
    throw new Error("notification_permission_denied");
  }

  const change = (
    event.previous_used_percent != null
    && event.current_used_percent != null
  )
    ? ` ${event.previous_used_percent}% → ${event.current_used_percent}%.`
    : "";
  sendNotification({
    title: "Codex quota reset",
    body: `Your ${resetWindowLabel(event)} quota has reset.${change}`,
  });
}
