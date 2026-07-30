import type { CodexResetEvent, CodexResetMonitorStatus } from "./api";

export interface OfficialResetCelebrationEvent {
  eventId: string;
  provider: string;
  occurredAt: string;
  sourceUrl: string;
  resetKind: "official-extra-reset";
  appliesToCurrentUsage: boolean;
}

export const CELEBRATED_EVENT_KEY =
  "token-eyes:official-reset-celebrated:v1";

const OFFICIAL_RESET_HOSTS = new Set([
  "help.openai.com",
  "openai.com",
  "chatgpt.com",
  "x.com",
]);

function diagnose(reason: string) {
  console.warn("[official-reset-celebration] skipped", { reason });
}

function isValidDate(value: string) {
  return Number.isFinite(Date.parse(value));
}

function isOfficialSource(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || url.hash
    ) {
      return false;
    }
    const host = url.hostname.toLowerCase();
    if (!OFFICIAL_RESET_HOSTS.has(host)) return false;
    if (host !== "x.com") return true;
    return (
      !url.search
      && /^\/(?:OpenAI|thsottiaux)\/status\/[0-9]+\/?$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function toOfficialResetCelebrationEvent(
  event: CodexResetEvent,
  monitorStatus: CodexResetMonitorStatus | null,
): OfficialResetCelebrationEvent | null {
  if (event.type !== "official_reset_announcement") return null;
  if (!event.id?.trim()) {
    diagnose("missing-event-id");
    return null;
  }
  if (!event.occurred_at?.trim()) {
    diagnose("missing-occurred-at");
    return null;
  }
  if (!event.source_url?.trim()) {
    diagnose("missing-source-url");
    return null;
  }

  const supportedScope = (
    event.reset_scope === "all_paid_users"
    || event.reset_scope === "all_codex_work_users"
  );
  return {
    eventId: event.id,
    provider: event.agent,
    occurredAt: event.occurred_at,
    sourceUrl: event.source_url,
    resetKind: "official-extra-reset",
    appliesToCurrentUsage:
      monitorStatus?.configured === true
      && event.alert_eligible === true
      && supportedScope,
  };
}

export function claimOfficialResetCelebration(
  event: OfficialResetCelebrationEvent,
): boolean {
  if (event.resetKind !== "official-extra-reset") {
    diagnose("unsupported-reset-kind");
    return false;
  }
  if (event.appliesToCurrentUsage !== true) {
    diagnose("not-applicable");
    return false;
  }
  if (!isValidDate(event.occurredAt)) {
    diagnose("invalid-occurred-at");
    return false;
  }
  if (!isOfficialSource(event.sourceUrl)) {
    diagnose("untrusted-source");
    return false;
  }

  let storage: Storage;
  try {
    storage = window.localStorage;
    if (storage.getItem(CELEBRATED_EVENT_KEY) === event.eventId) return false;
  } catch {
    diagnose("storage-read-failed");
    return false;
  }

  try {
    storage.setItem(CELEBRATED_EVENT_KEY, event.eventId);
  } catch {
    diagnose("storage-write-failed");
    return false;
  }
  return true;
}
