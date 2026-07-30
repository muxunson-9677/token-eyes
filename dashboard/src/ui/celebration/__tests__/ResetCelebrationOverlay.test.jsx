import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../foundation/ThemeProvider.jsx";
import {
  getCelebrationPhaseIntensity,
  LightfallCanvas,
} from "../LightfallCanvas.jsx";
import {
  RESET_CELEBRATION_DURATION_MS,
  ResetCelebrationProvider,
} from "../ResetCelebrationProvider.jsx";

const ogl = vi.hoisted(() => ({
  Renderer: vi.fn(),
  Program: vi.fn(),
  Triangle: vi.fn(),
  Mesh: vi.fn(),
  render: vi.fn(),
  programRemove: vi.fn(),
  geometryRemove: vi.fn(),
  loseContext: vi.fn(),
}));

vi.mock("ogl", () => ({
  Renderer: ogl.Renderer,
  Program: ogl.Program,
  Triangle: ogl.Triangle,
  Mesh: ogl.Mesh,
}));

const VALID_EVENT = {
  eventId: "official-reset-2026-07-31",
  provider: "codex",
  occurredAt: "2026-07-31T08:00:00.000Z",
  sourceUrl: "https://openai.com/index/official-reset",
  resetKind: "official-extra-reset",
  appliesToCurrentUsage: true,
};
const TEST_COPY = {
  navigate: "Navigate",
  pageContent: "Usage dashboard",
};

let rafCallbacks;
let resizeCallback;
let resizeDisconnect;
let rendererInstance;
let programInstance;
let geometryInstance;
let meshInstance;

function dispatchCelebration(detail = VALID_EVENT) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("token-eyes:official-reset-celebration", { detail }),
    );
  });
}

function matchMedia(matches = false) {
  return vi.fn().mockImplementation((query) => ({
    matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function NavigationFixture() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("/settings/basic")}>
        {TEST_COPY.navigate}
      </button>
      <Routes>
        <Route
          path="*"
          element={<main data-testid="page-content">{TEST_COPY.pageContent}</main>}
        />
      </Routes>
    </>
  );
}

function renderProvider({ reducedMotion = false } = {}) {
  window.matchMedia = matchMedia(reducedMotion);
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <ThemeProvider>
        <ResetCelebrationProvider>
          <NavigationFixture />
        </ResetCelebrationProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function flushLazyRender() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  rafCallbacks = new Map();
  resizeCallback = null;
  resizeDisconnect = vi.fn();

  let nextRafId = 1;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback) => {
      const id = nextRafId;
      nextRafId += 1;
      rafCallbacks.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id) => {
      rafCallbacks.delete(id);
    }),
  );
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function ResizeObserver(callback) {
      resizeCallback = callback;
      this.observe = vi.fn();
      this.disconnect = resizeDisconnect;
    }),
  );
  vi.stubGlobal("WebGLRenderingContext", function WebGLRenderingContext() {});
  Object.defineProperty(window.navigator, "hardwareConcurrency", {
    configurable: true,
    value: 8,
  });
  Object.defineProperty(window.navigator, "deviceMemory", {
    configurable: true,
    value: 8,
  });
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 2,
  });

  ogl.render.mockReset();
  ogl.programRemove.mockReset();
  ogl.geometryRemove.mockReset();
  ogl.loseContext.mockReset();

  const canvas = document.createElement("canvas");
  const gl = {
    canvas,
    drawingBufferWidth: 960,
    drawingBufferHeight: 540,
    getExtension: vi.fn((name) => (
      name === "WEBGL_lose_context" ? { loseContext: ogl.loseContext } : null
    )),
  };
  rendererInstance = {
    dpr: 1.5,
    gl,
    render: ogl.render,
    setSize: vi.fn(),
  };
  programInstance = { uniforms: null, remove: ogl.programRemove };
  geometryInstance = { remove: ogl.geometryRemove };
  meshInstance = {};

  ogl.Renderer.mockReset().mockImplementation(function Renderer() {
    return rendererInstance;
  });
  ogl.Program.mockReset().mockImplementation(function Program(_gl, options) {
    programInstance.uniforms = options.uniforms;
    return programInstance;
  });
  ogl.Triangle.mockReset().mockImplementation(function Triangle() {
    return geometryInstance;
  });
  ogl.Mesh.mockReset().mockImplementation(function Mesh() {
    return meshInstance;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ResetCelebrationProvider", () => {
  it("keeps the current page mounted and renders nothing before an event", () => {
    renderProvider();

    expect(screen.getByTestId("page-content")).toBeVisible();
    expect(document.querySelector(".tt-reset-celebration")).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("renders a non-interactive celebration for a valid official reset", async () => {
    renderProvider();
    dispatchCelebration();
    await flushLazyRender();

    const overlay = document.querySelector(".tt-reset-celebration");
    expect(overlay).not.toBeNull();
    expect(getComputedStyle(overlay).pointerEvents).toBe("none");
    expect(overlay).toHaveAttribute("data-event-id", VALID_EVENT.eventId);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("page-content")).toBeVisible();
    expect(document.querySelector("canvas")).not.toBeNull();
  });

  it("ignores malformed and inapplicable event details", () => {
    renderProvider();

    dispatchCelebration({ ...VALID_EVENT, eventId: "" });
    dispatchCelebration({ ...VALID_EVENT, occurredAt: "not-a-date" });
    dispatchCelebration({ ...VALID_EVENT, resetKind: "quota-rollover" });
    dispatchCelebration({ ...VALID_EVENT, appliesToCurrentUsage: false });

    expect(document.querySelector(".tt-reset-celebration")).toBeNull();
  });

  it.each([
    "https://x.com/explore",
    "https://x.com/OpenAI/status/1950000000000000000?ref=reset",
    "https://x.com/OpenAI/status/1950000000000000000#reset",
  ])("rejects an untrusted X source boundary: %s", (sourceUrl) => {
    renderProvider();

    dispatchCelebration({ ...VALID_EVENT, sourceUrl });

    expect(document.querySelector(".tt-reset-celebration")).toBeNull();
  });

  it("does not replay the same event id during the provider lifetime", async () => {
    renderProvider();
    dispatchCelebration();
    await flushLazyRender();
    expect(ogl.Renderer).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(RESET_CELEBRATION_DURATION_MS);
    });
    expect(document.querySelector(".tt-reset-celebration")).toBeNull();

    dispatchCelebration();
    await flushLazyRender();
    expect(document.querySelector(".tt-reset-celebration")).toBeNull();
    expect(ogl.Renderer).toHaveBeenCalledTimes(1);
  });

  it("remounts the overlay and restarts the duration for a different event id", () => {
    renderProvider();
    dispatchCelebration();
    const firstOverlay = document.querySelector(".tt-reset-celebration");

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    dispatchCelebration({ ...VALID_EVENT, eventId: "official-reset-follow-up" });
    const secondOverlay = document.querySelector(".tt-reset-celebration");
    act(() => {
      vi.advanceTimersByTime(1_300);
    });

    expect(secondOverlay).not.toBe(firstOverlay);
    expect(secondOverlay).toHaveAttribute(
      "data-event-id",
      "official-reset-follow-up",
    );
  });

  it("unmounts the overlay and canvas after 4.2 seconds", async () => {
    renderProvider();
    dispatchCelebration();
    await flushLazyRender();
    expect(document.querySelector("canvas")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(RESET_CELEBRATION_DURATION_MS);
    });

    expect(document.querySelector(".tt-reset-celebration")).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("uses a static CSS highlight without loading WebGL for reduced motion", async () => {
    renderProvider({ reducedMotion: true });
    dispatchCelebration();
    await flushLazyRender();

    expect(document.querySelector(".tt-reset-celebration")).toHaveAttribute(
      "data-renderer",
      "css",
    );
    expect(document.querySelector(".tt-reset-celebration")).toHaveClass(
      "tt-reset-celebration--static",
    );
    expect(screen.getByRole("status")).toBeVisible();
    expect(document.querySelector("canvas")).toBeNull();
    expect(ogl.Renderer).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("uses the CSS fallback on low-performance devices", async () => {
    Object.defineProperty(window.navigator, "hardwareConcurrency", {
      configurable: true,
      value: 2,
    });
    renderProvider();
    dispatchCelebration();
    await flushLazyRender();

    expect(document.querySelector(".tt-reset-celebration")).toHaveAttribute(
      "data-renderer",
      "css",
    );
    expect(ogl.Renderer).not.toHaveBeenCalled();
  });

  it.each([
    ["fractional core capacity", "hardwareConcurrency", 0.5],
    ["fractional device memory", "deviceMemory", 0.25],
  ])("uses the CSS fallback for %s", async (_label, property, value) => {
    Object.defineProperty(window.navigator, property, {
      configurable: true,
      value,
    });
    renderProvider();
    dispatchCelebration();
    await flushLazyRender();

    expect(document.querySelector(".tt-reset-celebration")).toHaveAttribute(
      "data-renderer",
      "css",
    );
    expect(ogl.Renderer).not.toHaveBeenCalled();
  });

  it.each([
    ["hardwareConcurrency", 0],
    ["hardwareConcurrency", Number.NaN],
    ["hardwareConcurrency", undefined],
    ["deviceMemory", 0],
    ["deviceMemory", Number.NaN],
    ["deviceMemory", undefined],
  ])("does not reject an unknown %s value of %s", async (property, value) => {
    Object.defineProperty(window.navigator, property, {
      configurable: true,
      value,
    });
    renderProvider();
    dispatchCelebration();
    await flushLazyRender();

    expect(document.querySelector(".tt-reset-celebration")).toHaveAttribute(
      "data-renderer",
      "webgl",
    );
    expect(ogl.Renderer).toHaveBeenCalledOnce();
  });

  it("clears an active celebration on route changes", async () => {
    renderProvider();
    dispatchCelebration();
    await flushLazyRender();
    expect(document.querySelector(".tt-reset-celebration")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Navigate" }));

    expect(document.querySelector(".tt-reset-celebration")).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});

describe("LightfallCanvas", () => {
  it("caps DPR, resizes with its container, and updates animation uniforms", () => {
    const { container } = render(
      <LightfallCanvas theme="dark" durationMs={RESET_CELEBRATION_DURATION_MS} />,
    );
    const host = container.firstElementChild;
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      width: 640,
      height: 360,
      top: 0,
      right: 640,
      bottom: 360,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    act(() => {
      resizeCallback();
    });
    expect(ogl.Renderer).toHaveBeenCalledWith(
      expect.objectContaining({ alpha: true, antialias: true, dpr: 1.5 }),
    );
    expect(rendererInstance.setSize).toHaveBeenLastCalledWith(640, 360);
    expect(programInstance.uniforms.uStreakCount.value).toBeGreaterThanOrEqual(8);
    expect(programInstance.uniforms.uStreakCount.value).toBeLessThanOrEqual(12);
    expect(programInstance.uniforms.uStreakWidth.value).toBeGreaterThanOrEqual(1.8);
    expect(programInstance.uniforms.uStreakWidth.value).toBeLessThanOrEqual(2.4);
    expect(programInstance.uniforms.uStreakLength.value).toBeGreaterThanOrEqual(1.2);
    expect(programInstance.uniforms.uStreakLength.value).toBeLessThanOrEqual(1.7);

    const firstFrame = [...rafCallbacks.values()][0];
    act(() => {
      firstFrame(1_000);
    });
    const nextFrame = [...rafCallbacks.values()].at(-1);
    act(() => {
      nextFrame(2_000);
    });

    expect(programInstance.uniforms.iTime.value).toBe(1);
    expect(programInstance.uniforms.uProgress.value).toBeCloseTo(
      1_000 / RESET_CELEBRATION_DURATION_MS,
    );
    expect(ogl.render).toHaveBeenCalledWith({ scene: meshInstance });
  });

  it("diminishes phase intensity after 2.6 seconds before the final fade", () => {
    render(
      <LightfallCanvas theme="dark" durationMs={RESET_CELEBRATION_DURATION_MS} />,
    );
    const firstFrame = [...rafCallbacks.values()][0];
    act(() => {
      firstFrame(1_000);
    });

    const intensityAt = (elapsedMs) => {
      const frame = [...rafCallbacks.values()].at(-1);
      act(() => {
        frame(1_000 + elapsedMs);
      });
      return programInstance.uniforms.uIntensity.value;
    };
    const peakEnd = intensityAt(2_600);
    const diminishing = intensityAt(2_900);
    const fadeStart = intensityAt(3_400);
    const finished = intensityAt(4_200);

    expect(peakEnd).toBeCloseTo(1);
    expect(diminishing).toBeLessThan(peakEnd);
    expect(fadeStart).toBeLessThan(diminishing);
    expect(fadeStart).toBeLessThanOrEqual(0.3);
    expect(finished).toBe(0);
  });

  it("keeps the original phase start when the theme changes", () => {
    const view = render(
      <LightfallCanvas theme="light" durationMs={RESET_CELEBRATION_DURATION_MS} />,
    );
    const firstFrame = [...rafCallbacks.values()][0];
    act(() => {
      firstFrame(1_000);
    });
    const preThemeFrame = [...rafCallbacks.values()].at(-1);
    act(() => {
      preThemeFrame(3_900);
    });

    view.rerender(
      <LightfallCanvas theme="dark" durationMs={RESET_CELEBRATION_DURATION_MS} />,
    );
    const postThemeFrame = [...rafCallbacks.values()].at(-1);
    act(() => {
      postThemeFrame(4_000);
    });

    expect(programInstance.uniforms.uIntensity.value).toBeCloseTo(
      getCelebrationPhaseIntensity(3_000),
    );
  });

  it("releases RAF, observer, canvas, OGL resources, and WebGL context", () => {
    const { container, unmount } = render(
      <LightfallCanvas theme="light" durationMs={RESET_CELEBRATION_DURATION_MS} />,
    );
    expect(container.querySelector("canvas")).not.toBeNull();

    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(resizeDisconnect).toHaveBeenCalledOnce();
    expect(ogl.programRemove).toHaveBeenCalledOnce();
    expect(ogl.geometryRemove).toHaveBeenCalledOnce();
    expect(ogl.loseContext).toHaveBeenCalledOnce();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("reports renderer initialization failure so the CSS fallback can remain", () => {
    const onFallback = vi.fn();
    ogl.Renderer.mockImplementationOnce(function Renderer() {
      throw new Error("WebGL unavailable");
    });

    render(
      <LightfallCanvas
        theme="light"
        durationMs={RESET_CELEBRATION_DURATION_MS}
        onFallback={onFallback}
      />,
    );

    expect(onFallback).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("fails closed when rendering throws and does not schedule another frame", () => {
    const onFallback = vi.fn();
    ogl.render.mockImplementationOnce(() => {
      throw new Error("render failed");
    });
    const { container } = render(
      <LightfallCanvas
        theme="dark"
        durationMs={RESET_CELEBRATION_DURATION_MS}
        onFallback={onFallback}
      />,
    );
    const frame = [...rafCallbacks.values()][0];

    expect(() => {
      act(() => {
        frame(1_000);
      });
    }).not.toThrow();

    expect(onFallback).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(resizeDisconnect).toHaveBeenCalledOnce();
    expect(container.querySelector("canvas")).toBeNull();

    act(() => {
      frame(1_100);
    });
    expect(onFallback).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it("prevents WebGL context loss, fails closed once, and ignores stale RAF", () => {
    const onFallback = vi.fn();
    const { container } = render(
      <LightfallCanvas
        theme="light"
        durationMs={RESET_CELEBRATION_DURATION_MS}
        onFallback={onFallback}
      />,
    );
    const canvas = container.querySelector("canvas");
    const frame = [...rafCallbacks.values()][0];
    const contextLost = new Event("webglcontextlost", { cancelable: true });

    act(() => {
      canvas.dispatchEvent(contextLost);
    });

    expect(contextLost.defaultPrevented).toBe(true);
    expect(onFallback).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(resizeDisconnect).toHaveBeenCalledOnce();
    expect(ogl.programRemove).toHaveBeenCalledOnce();
    expect(ogl.geometryRemove).toHaveBeenCalledOnce();
    expect(container.querySelector("canvas")).toBeNull();

    act(() => {
      frame(1_000);
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    expect(onFallback).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });
});
