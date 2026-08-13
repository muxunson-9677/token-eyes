import React, { Component, lazy, Suspense, useCallback, useContext, useEffect, useState } from "react";
import { ThemeContext } from "../foundation/ThemeProvider.jsx";
import { copy } from "../../lib/copy";
import { normalizeResetCelebrationEffect } from "./reset-celebration-preference.js";
import "./reset-celebration.css";

const LazyMeteorCanvas = lazy(() => import("./MeteorCelebrationCanvas.jsx"));
const LazyFireworksCanvas = lazy(() => import("./FireworksCelebrationCanvas.jsx"));

function getReducedMotionPreference() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useReducedMotionPreference() {
  const [reducedMotion, setReducedMotion] = useState(getReducedMotionPreference);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener?.("change", update);
    query.addListener?.(update);
    return () => {
      query.removeEventListener?.("change", update);
      query.removeListener?.(update);
    };
  }, []);

  return reducedMotion;
}

class RendererErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFallback();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function CelebrationGiftIcon() {
  return (
    <span className="tt-reset-celebration__notice-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <defs>
          <linearGradient id="tt-reset-gift-box" x1="8" y1="10" x2="54" y2="58">
            <stop offset="0" stopColor="#7de9ff" />
            <stop offset="0.48" stopColor="#4b8cff" />
            <stop offset="1" stopColor="#8b5cff" />
          </linearGradient>
          <linearGradient id="tt-reset-gift-ribbon" x1="24" y1="12" x2="42" y2="56">
            <stop offset="0" stopColor="#fff3a2" />
            <stop offset="1" stopColor="#ffae55" />
          </linearGradient>
        </defs>
        <path className="tt-reset-celebration__gift-star" d="M51 4l1.9 5.1L58 11l-5.1 1.9L51 18l-1.9-5.1L44 11l5.1-1.9L51 4z" />
        <path className="tt-reset-celebration__gift-star tt-reset-celebration__gift-star--small" d="M12 10l1.2 3.1 3.1 1.2-3.1 1.2L12 19l-1.2-3.5-3.1-1.2 3.1-1.2L12 10z" />
        <path fill="url(#tt-reset-gift-box)" d="M10 28h44v27a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V28z" />
        <path fill="url(#tt-reset-gift-box)" d="M7 20a4 4 0 0 1 4-4h42a4 4 0 0 1 4 4v10H7V20z" />
        <path fill="url(#tt-reset-gift-ribbon)" d="M27 16h10v43H27z" />
        <path fill="url(#tt-reset-gift-ribbon)" d="M7 24h50v8H7z" />
        <path fill="none" stroke="#f7fdff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M32 17c-5-8-14-8-14-2 0 5 8 6 14 6m0-4c5-8 14-8 14-2 0 5-8 6-14 6" />
      </svg>
    </span>
  );
}

export function ResetCelebrationOverlay({ event, durationMs, effectId = "meteors", showNotice = true }) {
  // Optional read: the desktop-widget window renders this overlay outside the
  // main app's ThemeProvider, so fall back to light instead of throwing.
  const resolvedTheme = useContext(ThemeContext)?.resolvedTheme ?? "light";
  const reducedMotion = useReducedMotionPreference();
  const normalizedEffect = normalizeResetCelebrationEffect(effectId);
  const [rendererFailed, setRendererFailed] = useState(false);
  const handleFallback = useCallback(() => setRendererFailed(true), []);
  const useCanvas = !reducedMotion && !rendererFailed;
  const Renderer = normalizedEffect === "fireworks"
    ? LazyFireworksCanvas
    : LazyMeteorCanvas;

  return (
    <div
      className={[
        "tt-reset-celebration",
        reducedMotion ? "tt-reset-celebration--static" : "",
      ].filter(Boolean).join(" ")}
      data-event-id={event.eventId}
      data-effect-id={normalizedEffect}
      data-renderer={useCanvas ? "canvas" : "css"}
      data-theme={resolvedTheme}
      aria-hidden="false"
      style={{
        "--tt-reset-duration": `${durationMs}ms`,
        pointerEvents: "none",
      }}
    >
      <div className="tt-reset-celebration__veil" aria-hidden="true" />
      <div className="tt-reset-celebration__edge" aria-hidden="true" />
      {useCanvas ? (
        <RendererErrorBoundary key={event.eventId} onFallback={handleFallback}>
          <Suspense fallback={null}>
            <Renderer onFallback={handleFallback} />
          </Suspense>
        </RendererErrorBoundary>
      ) : null}
      {showNotice ? (
        <div
          className="tt-reset-celebration__notice"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <CelebrationGiftIcon />
          <span className="tt-reset-celebration__notice-copy">
            <strong>{copy("official_reset_celebration.title")}</strong>
            <span>{copy("official_reset_celebration.summary")}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default ResetCelebrationOverlay;
