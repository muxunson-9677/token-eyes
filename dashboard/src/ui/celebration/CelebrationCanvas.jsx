import React, { useEffect, useRef } from "react";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function chooseRenderScale() {
  const pixels = window.innerWidth * window.innerHeight;
  let scale = 1;
  if (pixels > 7_000_000) scale = 0.58;
  else if (pixels > 3_600_000) scale = 0.68;
  else if (pixels > 2_350_000) scale = 0.82;
  else if ((window.devicePixelRatio || 1) > 1.5) scale = 0.92;
  if ((window.navigator.hardwareConcurrency || 8) <= 4) scale *= 0.84;
  return clamp(scale, 0.56, 1);
}

export function CelebrationCanvas({ createScene, effectId, onFallback }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true, desynchronized: true });
    if (!canvas || !context) {
      onFallback?.();
      return undefined;
    }

    const surface = {
      canvas,
      context,
      width: 1,
      height: 1,
      scale: 1,
      density: (window.navigator.hardwareConcurrency || 8) <= 4 ? 0.76 : 1,
    };
    let scene;
    let frameId = 0;
    let lastTime = performance.now();
    let failed = false;
    let performanceTotal = 0;
    let performanceFrames = 0;
    let performanceStamp = lastTime;

    const fail = () => {
      if (failed) return;
      failed = true;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      onFallback?.();
    };

    const resize = () => {
      const renderScale = chooseRenderScale();
      surface.width = Math.max(1, window.innerWidth);
      surface.height = Math.max(1, window.innerHeight);
      surface.scale = clamp(
        Math.sqrt((surface.width * surface.height) / (1920 * 1080)),
        0.55,
        1.12,
      );
      canvas.width = Math.max(1, Math.round(surface.width * renderScale));
      canvas.height = Math.max(1, Math.round(surface.height * renderScale));
      canvas.style.width = `${surface.width}px`;
      canvas.style.height = `${surface.height}px`;
      canvas.dataset.renderScale = String(renderScale);
      context.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      context.lineCap = "round";
      context.lineJoin = "round";
      scene?.resize?.();
    };

    const drawFrame = (now) => {
      if (failed) return;
      const startedAt = performance.now();
      const delta = Math.min(0.04, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      try {
        scene.render(now / 1000, delta);
      } catch {
        fail();
        return;
      }

      performanceTotal += performance.now() - startedAt;
      performanceFrames += 1;
      if (now - performanceStamp > 1_500) {
        const averageCost = performanceTotal / Math.max(1, performanceFrames);
        if (averageCost > 20) surface.density = Math.max(0.52, surface.density - 0.1);
        else if (averageCost < 12) surface.density = Math.min(1, surface.density + 0.05);
        performanceTotal = 0;
        performanceFrames = 0;
        performanceStamp = now;
      }
      frameId = requestAnimationFrame(drawFrame);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (frameId) cancelAnimationFrame(frameId);
        frameId = 0;
        return;
      }
      lastTime = performance.now();
      if (!frameId && !failed) frameId = requestAnimationFrame(drawFrame);
    };

    try {
      scene = createScene(surface);
      resize();
      window.addEventListener("resize", resize, { passive: true });
      document.addEventListener("visibilitychange", handleVisibility);
      if (!document.hidden) frameId = requestAnimationFrame(drawFrame);
    } catch {
      fail();
    }

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      scene?.destroy?.();
      context.clearRect(0, 0, surface.width, surface.height);
    };
  }, [createScene, onFallback]);

  return (
    <canvas
      ref={canvasRef}
      className="tt-reset-celebration__canvas"
      data-effect-renderer={effectId}
      aria-hidden="true"
    />
  );
}

export default CelebrationCanvas;
