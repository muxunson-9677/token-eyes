import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { isOfficialResetCelebrationEvent } from "../../lib/official-reset-celebration";
import { ResetCelebrationOverlay } from "./ResetCelebrationOverlay.jsx";
import {
  readResetCelebrationEffect,
  RESET_CELEBRATION_EFFECT_IDS,
} from "./reset-celebration-preference.js";

export const RESET_CELEBRATION_DURATION_MS = 6_000;
const RESET_CELEBRATION_EVENT = "token-eyes:official-reset-celebration";
export const RESET_CELEBRATION_PREVIEW_EVENT = "token-eyes:reset-celebration-preview";
export { RESET_CELEBRATION_EFFECT_IDS };

let previewSequence = 0;

export function triggerResetCelebrationPreview(effectId) {
  if (
    typeof window === "undefined"
    || !RESET_CELEBRATION_EFFECT_IDS.includes(effectId)
  ) {
    return false;
  }
  window.dispatchEvent(
    new CustomEvent(RESET_CELEBRATION_PREVIEW_EVENT, { detail: { effectId } }),
  );
  return true;
}

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
      setActiveEvent({
        ...detail,
        eventId,
        effectId: readResetCelebrationEffect(),
      });
    };

    const handlePreview = (event) => {
      const effectId = event.detail?.effectId;
      if (!RESET_CELEBRATION_EFFECT_IDS.includes(effectId)) return;
      previewSequence += 1;
      setActiveEvent({
        eventId: `preview:${effectId}:${previewSequence}`,
        effectId,
      });
    };

    window.addEventListener(RESET_CELEBRATION_EVENT, handleCelebration);
    window.addEventListener(RESET_CELEBRATION_PREVIEW_EVENT, handlePreview);
    return () => {
      window.removeEventListener(RESET_CELEBRATION_EVENT, handleCelebration);
      window.removeEventListener(RESET_CELEBRATION_PREVIEW_EVENT, handlePreview);
    };
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
          effectId={activeEvent.effectId}
          durationMs={RESET_CELEBRATION_DURATION_MS}
        />
      ) : null}
    </>
  );
}

export default ResetCelebrationProvider;
