import React, { Component, lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useTheme } from "../../hooks/useTheme.js";
import { copy } from "../../lib/copy";
import "./reset-celebration.css";

const LazyLightfallCanvas = lazy(() => import("./LightfallCanvas.jsx"));

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

const isConstrained = (value) => (
  Number.isFinite(value)
  && Math.sign(value) === 1
  && Math.min(value, 2) === value
);

function supportsLightfall() {
  if (typeof window === "undefined" || !window.WebGLRenderingContext) return false;
  const cores = Number(navigator.hardwareConcurrency);
  const memory = Number(navigator.deviceMemory);
  if (isConstrained(cores) || isConstrained(memory)) return false;
  return true;
}

class LightfallErrorBoundary extends Component {
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

export function ResetCelebrationOverlay({ event, durationMs }) {
  const { resolvedTheme } = useTheme();
  const reducedMotion = useReducedMotionPreference();
  const [rendererFailed, setRendererFailed] = useState(false);
  const handleFallback = useCallback(() => setRendererFailed(true), []);
  const useCssFallback = reducedMotion || rendererFailed || !supportsLightfall();

  useEffect(() => {
    setRendererFailed(false);
  }, [event.eventId]);

  return (
    <div
      className={[
        "tt-reset-celebration",
        reducedMotion ? "tt-reset-celebration--static" : "",
      ].filter(Boolean).join(" ")}
      data-event-id={event.eventId}
      data-renderer={useCssFallback ? "css" : "webgl"}
      data-theme={resolvedTheme}
      aria-hidden="false"
      style={{ pointerEvents: "none" }}
    >
      <div className="tt-reset-celebration__edge" aria-hidden="true" />
      <div className="tt-reset-celebration__ribbons" aria-hidden="true" />
      {!useCssFallback ? (
        <LightfallErrorBoundary key={event.eventId} onFallback={handleFallback}>
          <Suspense fallback={null}>
            <LazyLightfallCanvas
              theme={resolvedTheme}
              durationMs={durationMs}
              onFallback={handleFallback}
            />
          </Suspense>
        </LightfallErrorBoundary>
      ) : null}
      <div
        className="tt-reset-celebration__notice"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="tt-reset-celebration__notice-mark" aria-hidden="true" />
        <span>
          <strong>{copy("official_reset_celebration.title")}</strong>
          <span>{copy("official_reset_celebration.summary")}</span>
        </span>
      </div>
    </div>
  );
}

export default ResetCelebrationOverlay;
