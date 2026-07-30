import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { isOfficialResetCelebrationEvent } from "../../lib/official-reset-celebration";
import { ResetCelebrationOverlay } from "./ResetCelebrationOverlay.jsx";

export const RESET_CELEBRATION_DURATION_MS = 4_200;
const RESET_CELEBRATION_EVENT = "token-eyes:official-reset-celebration";

export function ResetCelebrationProvider({ children }) {
  const location = useLocation();
  const seenEventIds = useRef(new Set());
  const [activeEvent, setActiveEvent] = useState(null);

  useEffect(() => {
    const handleCelebration = (event) => {
      const detail = event.detail;
      if (!isOfficialResetCelebrationEvent(detail)) return;
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
          key={activeEvent.eventId}
          event={activeEvent}
          durationMs={RESET_CELEBRATION_DURATION_MS}
        />
      ) : null}
    </>
  );
}

export default ResetCelebrationProvider;
