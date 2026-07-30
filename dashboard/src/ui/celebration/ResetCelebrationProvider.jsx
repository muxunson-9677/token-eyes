import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ResetCelebrationOverlay } from "./ResetCelebrationOverlay.jsx";

export const RESET_CELEBRATION_DURATION_MS = 4_200;
const RESET_CELEBRATION_EVENT = "token-eyes:official-reset-celebration";
const OFFICIAL_SOURCE_HOSTS = new Set([
  "help.openai.com",
  "openai.com",
  "chatgpt.com",
  "x.com",
]);

function isTrustedSourceUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && OFFICIAL_SOURCE_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function isValidCelebrationEvent(detail) {
  return Boolean(
    detail
    && typeof detail === "object"
    && typeof detail.eventId === "string"
    && detail.eventId.trim()
    && typeof detail.provider === "string"
    && detail.provider.trim()
    && typeof detail.occurredAt === "string"
    && Number.isFinite(Date.parse(detail.occurredAt))
    && typeof detail.sourceUrl === "string"
    && isTrustedSourceUrl(detail.sourceUrl)
    && detail.resetKind === "official-extra-reset"
    && detail.appliesToCurrentUsage === true,
  );
}

export function ResetCelebrationProvider({ children }) {
  const location = useLocation();
  const seenEventIds = useRef(new Set());
  const [activeEvent, setActiveEvent] = useState(null);

  useEffect(() => {
    const handleCelebration = (event) => {
      const detail = event.detail;
      if (!isValidCelebrationEvent(detail)) return;
      const eventId = detail.eventId.trim();
      if (seenEventIds.current.has(eventId)) return;
      seenEventIds.current.add(eventId);
      setActiveEvent({ ...detail, eventId });
    };

    window.addEventListener(RESET_CELEBRATION_EVENT, handleCelebration);
    return () => window.removeEventListener(RESET_CELEBRATION_EVENT, handleCelebration);
  }, []);

  useEffect(() => {
    setActiveEvent(null);
  }, [location.key, location.pathname, location.search]);

  useEffect(() => {
    if (!activeEvent) return undefined;
    const timer = window.setTimeout(
      () => setActiveEvent(null),
      RESET_CELEBRATION_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activeEvent]);

  return (
    <>
      {children}
      {activeEvent ? (
        <ResetCelebrationOverlay
          event={activeEvent}
          durationMs={RESET_CELEBRATION_DURATION_MS}
        />
      ) : null}
    </>
  );
}

export default ResetCelebrationProvider;
