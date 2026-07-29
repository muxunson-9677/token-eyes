import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import type { CodexResetEvent } from "./api";
import { isTauriRuntime } from "./local-api-url";

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

  sendNotification({
    title: event.title || "Codex 官方额外重置",
    body: event.summary || "检测到官方为 Codex 用户额外重置了使用限制。",
  });
}
