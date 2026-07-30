import React, { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";

const MAX_DPR = 1.5;
const MAX_COLORS = 4;

const VERTEX_SHADER = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec3 iResolution;
uniform float iTime;
uniform float uProgress;
uniform float uIntensity;
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform int uStreakCount;
uniform float uStreakWidth;
uniform float uStreakLength;
uniform float uGlow;
uniform float uBackgroundGlow;

varying vec2 vUv;

float hash(float value) {
  return fract(sin(value * 127.1) * 43758.5453);
}

vec3 palette(float value) {
  if (value < 0.25) return uColor0;
  if (value < 0.5) return uColor1;
  if (value < 0.75) return uColor2;
  return uColor3;
}

void main() {
  vec2 uv = vUv;
  float aspect = iResolution.x / max(iResolution.y, 1.0);
  vec2 centered = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
  float envelope = uIntensity;
  float edgeFlash = smoothstep(0.0, 0.025, uProgress)
    * (1.0 - smoothstep(0.083, 0.14, uProgress));

  vec3 light = vec3(0.0);
  float alpha = 0.0;

  for (int index = 0; index < 12; index++) {
    if (index >= uStreakCount) break;

    float seed = float(index) + 1.0;
    float angle = mix(-0.48, 0.34, hash(seed * 2.3));
    vec2 direction = normalize(vec2(sin(angle), -cos(angle)));
    vec2 normal = vec2(-direction.y, direction.x);
    float lane = mix(-0.7 * aspect, 0.7 * aspect, hash(seed * 5.7));
    float delay = hash(seed * 8.1) * 0.28;
    float travel = clamp((uProgress - 0.06 - delay) / 0.56, 0.0, 1.0);
    vec2 origin = vec2(lane, 0.92) + direction * travel * 1.85;
    vec2 local = centered - origin;

    float across = dot(local, normal);
    float along = dot(local, direction);
    float width = 0.022 * uStreakWidth;
    float length = 0.34 * uStreakLength;
    float core = exp(-pow(abs(across) / max(width, 0.001), 2.0));
    float body = smoothstep(-length, -length * 0.72, along)
      * (1.0 - smoothstep(length * 0.1, length, along));
    float halo = exp(-pow(abs(across) / max(width * 4.4, 0.001), 1.35))
      * smoothstep(-length * 1.2, -length * 0.7, along)
      * (1.0 - smoothstep(length * 0.25, length * 1.35, along));
    float twinkle = 0.78 + 0.22 * sin(iTime * 5.2 + seed * 2.7);
    vec3 color = palette(hash(seed * 11.9));

    light += color * (core * body * 1.5 + halo * 0.52) * twinkle;
    alpha += (core * body * 0.52 + halo * 0.17) * twinkle;
  }

  float topGlow = exp(-pow((uv.y - 0.94) / 0.24, 2.0));
  float edge = smoothstep(0.19, 0.0, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  light += mix(uColor0, uColor3, uv.x) * topGlow * uBackgroundGlow * envelope;
  light += mix(uColor1, uColor2, uv.y) * edge * edgeFlash * 0.42;
  alpha += topGlow * uBackgroundGlow * envelope * 0.16 + edge * edgeFlash * 0.24;

  light = 1.0 - exp(-light * uGlow * envelope);
  gl_FragColor = vec4(light, clamp(alpha * envelope + edge * edgeFlash, 0.0, 0.78));
}
`;

function smoothstep01(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export function getCelebrationPhaseIntensity(elapsedMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (elapsed < 350) return smoothstep01(elapsed / 350);
  if (elapsed <= 2_600) return 1;
  if (elapsed <= 3_400) {
    return 1 - 0.72 * smoothstep01((elapsed - 2_600) / 800);
  }
  if (elapsed <= 4_200) {
    return 0.28 * (1 - smoothstep01((elapsed - 3_400) / 800));
  }
  return 0;
}

function readCssColor(styles, name, fallback) {
  const channels = styles
    .getPropertyValue(name)
    .trim()
    .split(/\s+/u)
    .map(Number);
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    return fallback;
  }
  return channels.map((channel) => channel / 255);
}

function callIfFunction(target, key) {
  if (target && typeof target[key] === "function") {
    target[key]();
  }
}

export function LightfallCanvas({
  theme = "light",
  durationMs = 4_200,
  onFallback,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let renderer = null;
    let program = null;
    let geometry = null;
    let mesh = null;
    let resizeObserver = null;
    let rafId = null;
    let canvas = null;
    let disposed = false;
    let fallbackNotified = false;
    let startTime = null;
    let handleContextLost = null;

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      if (canvas && handleContextLost) {
        canvas.removeEventListener("webglcontextlost", handleContextLost);
      }
      if (canvas?.parentElement === container) {
        container.removeChild(canvas);
      }
      callIfFunction(mesh, "remove");
      callIfFunction(program, "remove");
      callIfFunction(geometry, "remove");
      try {
        renderer?.gl?.getExtension?.("WEBGL_lose_context")?.loseContext?.();
      } catch {
        // Context loss is best-effort; the remaining OGL cleanup still runs.
      }
      callIfFunction(renderer, "destroy");
    };

    const failClosed = () => {
      if (fallbackNotified || disposed) return;
      fallbackNotified = true;
      dispose();
      onFallback?.();
    };

    try {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      renderer = new Renderer({ dpr, alpha: true, antialias: true });
      const gl = renderer.gl;
      canvas = gl.canvas;
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      container.appendChild(canvas);
      handleContextLost = (event) => {
        event.preventDefault();
        failClosed();
      };
      canvas.addEventListener("webglcontextlost", handleContextLost);

      const styles = getComputedStyle(container);
      const fallbackColors = theme === "dark"
        ? [[0.55, 0.85, 1], [0.49, 0.42, 1], [0.82, 0.64, 1], [1, 0.82, 0.46]]
        : [[0.1, 0.55, 1], [0.07, 0.78, 0.85], [0.47, 0.41, 0.97], [0.96, 0.66, 0.21]];
      const rgb = Array.from({ length: MAX_COLORS }, (_, index) => (
        readCssColor(styles, `--tt-reset-lightfall-color-${index}`, fallbackColors[index])
      ));
      const uniforms = {
        iResolution: { value: [gl.drawingBufferWidth, gl.drawingBufferHeight, 1] },
        iTime: { value: 0 },
        uProgress: { value: 0 },
        uIntensity: { value: 0 },
        uColor0: { value: rgb[0] },
        uColor1: { value: rgb[1] },
        uColor2: { value: rgb[2] },
        uColor3: { value: rgb[3] },
        uStreakCount: { value: 10 },
        uStreakWidth: { value: 2.2 },
        uStreakLength: { value: 1.45 },
        uGlow: { value: theme === "dark" ? 1.7 : 1.25 },
        uBackgroundGlow: { value: theme === "dark" ? 0.52 : 0.26 },
      };

      program = new Program(gl, {
        vertex: VERTEX_SHADER,
        fragment: FRAGMENT_SHADER,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms,
      });
      geometry = new Triangle(gl);
      mesh = new Mesh(gl, { geometry, program });

      const resize = () => {
        if (disposed) return;
        const rect = container.getBoundingClientRect();
        renderer.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1));
        uniforms.iResolution.value = [
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
          1,
        ];
      };
      resize();
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);

      const renderFrame = (timestamp) => {
        if (disposed) return;
        if (startTime === null) startTime = timestamp;
        const elapsed = Math.max(0, timestamp - startTime);
        uniforms.iTime.value = elapsed / 1_000;
        uniforms.uProgress.value = Math.min(elapsed / durationMs, 1);
        uniforms.uIntensity.value = getCelebrationPhaseIntensity(elapsed);
        try {
          renderer.render({ scene: mesh });
        } catch {
          failClosed();
          return;
        }
        if (!disposed) rafId = requestAnimationFrame(renderFrame);
      };
      rafId = requestAnimationFrame(renderFrame);
    } catch {
      failClosed();
    }

    return dispose;
  }, [durationMs, onFallback, theme]);

  return <div ref={containerRef} className="tt-reset-celebration__canvas" aria-hidden="true" />;
}

export default LightfallCanvas;
