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
export const DESKTOP_WIDGET_CELEBRATION_EVENT = "token-eyes:desktop-widget-celebration";
const RESET_CELEBRATION_CHANNEL = "token-eyes:reset-celebration:v1";
const RESET_CELEBRATION_CHANNEL_MESSAGE = "reset-celebration";
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
    let channel = null;

    const activateCelebration = ({ detail, effectId, broadcast = false }) => {
      const eventId = typeof detail?.eventId === "string" ? detail.eventId.trim() : "";
      if (!eventId || !RESET_CELEBRATION_EFFECT_IDS.includes(effectId)) return;
      if (seenEventIds.current.has(eventId)) return;
      seenEventIds.current.add(eventId);
      setActiveEvent({ ...detail, eventId, effectId });
      if (!broadcast || !channel) return;
      try {
        channel.postMessage({
          type: RESET_CELEBRATION_CHANNEL_MESSAGE,
          detail: { ...detail, eventId },
          effectId,
        });
      } catch {
        // Cross-WebView sync is optional; the current window celebration remains active.
      }
    };

    const handleCelebration = (event) => {
      const detail = event.detail;
      if (!isOfficialResetCelebrationEvent(detail)) return;
      activateCelebration({
        detail,
        effectId: readResetCelebrationEffect(),
        broadcast: true,
      });
    };

    const handlePreview = (event) => {
      const effectId = event.detail?.effectId;
      if (!RESET_CELEBRATION_EFFECT_IDS.includes(effectId)) return;
      previewSequence += 1;
      activateCelebration({
        detail: { eventId: `preview:${effectId}:${previewSequence}` },
        effectId,
        broadcast: true,
      });
    };

    const handleChannelMessage = (event) => {
      const message = event?.data;
      if (message?.type !== RESET_CELEBRATION_CHANNEL_MESSAGE) return;
      const detail = message.detail;
      const eventId = typeof detail?.eventId === "string" ? detail.eventId.trim() : "";
      if (!eventId.startsWith("preview:") && !isOfficialResetCelebrationEvent(detail)) return;
      activateCelebration({ detail, effectId: message.effectId });
    };

    try {
      if (typeof BroadcastChannel === "function") {
        channel = new BroadcastChannel(RESET_CELEBRATION_CHANNEL);
        channel.onmessage = handleChannelMessage;
      }
    } catch {
      channel = null;
    }

    window.addEventListener(RESET_CELEBRATION_EVENT, handleCelebration);
    window.addEventListener(RESET_CELEBRATION_PREVIEW_EVENT, handlePreview);
    return () => {
      window.removeEventListener(RESET_CELEBRATION_EVENT, handleCelebration);
      window.removeEventListener(RESET_CELEBRATION_PREVIEW_EVENT, handlePreview);
      try {
        channel?.close();
      } catch {
        // Ignore cleanup errors from partially initialized WebView channels.
      }
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

  useEffect(() => {
    if (!activeEvent || location.pathname !== "/desktop-widget") return;
    window.dispatchEvent(new CustomEvent(DESKTOP_WIDGET_CELEBRATION_EVENT, {
      detail: activeEvent,
    }));
  }, [activeEvent, location.pathname]);

  return (
    <>
      {children}
      {activeEvent && location.pathname !== "/desktop-widget" ? (
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
