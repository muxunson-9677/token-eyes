import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "../../../hooks/useTheme.js";
import { ThemeProvider } from "../../foundation/ThemeProvider.jsx";
import {
  readResetCelebrationEffect,
  saveResetCelebrationEffect,
} from "../reset-celebration-preference.js";
import {
  RESET_CELEBRATION_DURATION_MS,
  RESET_CELEBRATION_PREVIEW_EVENT,
  ResetCelebrationProvider,
  triggerResetCelebrationPreview,
} from "../ResetCelebrationProvider.jsx";

const VALID_EVENT = {
  eventId: "official-reset-2026-07-31",
  provider: "codex",
  occurredAt: "2026-07-31T08:00:00.000Z",
  sourceUrl: "https://openai.com/index/official-reset",
  resetKind: "official-extra-reset",
  appliesToCurrentUsage: true,
};

let canvasContext;
let rafCallbacks;

function createCanvasContext() {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    lineCap: "butt",
    lineJoin: "miter",
    lineWidth: 1,
    strokeStyle: "",
  };
}

function dispatchCelebration(detail = VALID_EVENT) {
  act(() => {
    window.dispatchEvent(new CustomEvent(
      "token-eyes:official-reset-celebration",
      { detail },
    ));
  });
}

function createMatchMedia({ reducedMotion = false, dark = false } = {}) {
  return vi.fn((query) => ({
    matches: query === "(prefers-reduced-motion: reduce)" ? reducedMotion : dark,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

function NavigationFixture() {
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  return (
    <>
      <button type="button" onClick={() => navigate("/settings/basic")}>Navigate</button>
      <button type="button" onClick={() => setTheme("dark")}>Use dark theme</button>
      <Routes>
        <Route path="*" element={<main data-testid="page-content">Usage dashboard</main>} />
      </Routes>
    </>
  );
}

function renderProvider({ reducedMotion = false, theme = "light" } = {}) {
  window.localStorage.setItem("tokentracker-theme", theme);
  window.matchMedia = createMatchMedia({ reducedMotion, dark: theme === "dark" });
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
    await vi.dynamicImportSettled();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  canvasContext = createCanvasContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext);
  rafCallbacks = new Map();
  let rafId = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => {
    rafId += 1;
    rafCallbacks.set(rafId, callback);
    return rafId;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id) => rafCallbacks.delete(id)));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
});

describe("ResetCelebrationProvider", () => {
  it("keeps the current page mounted and renders nothing before an event", () => {
    renderProvider();
    expect(screen.getByTestId("page-content")).toBeVisible();
    expect(document.querySelector(".tt-reset-celebration")).toBeNull();
  });

  it("uses meteors by default and keeps the app visible and interactive", async () => {
    renderProvider();
    dispatchCelebration();
    await flushLazyRender();

    const overlay = document.querySelector(".tt-reset-celebration");
    expect(readResetCelebrationEffect()).toBe("meteors");
    expect(overlay).toHaveAttribute("data-effect-id", "meteors");
    expect(overlay).toHaveAttribute("data-renderer", "canvas");
    expect(overlay).toHaveAttribute("data-theme", "light");
    expect(overlay).toHaveStyle({ pointerEvents: "none" });
    expect(document.querySelector("[data-effect-renderer='meteors']")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("page-content")).toBeVisible();
  });

  it("uses the saved fireworks effect for a real reset", async () => {
    saveResetCelebrationEffect("fireworks");
    renderProvider();
    dispatchCelebration();
    await flushLazyRender();

    expect(document.querySelector(".tt-reset-celebration")).toHaveAttribute(
      "data-effect-id",
      "fireworks",
    );
    expect(document.querySelector("[data-effect-renderer='fireworks']")).not.toBeNull();
  });

  it("previews an explicit effect without mutating reset acknowledgement state", async () => {
    renderProvider();
    window.localStorage.removeItem("token-eyes:official-reset-celebrated:v1");
    const listener = vi.fn();
    window.addEventListener(RESET_CELEBRATION_PREVIEW_EVENT, listener);

    act(() => expect(triggerResetCelebrationPreview("fireworks")).toBe(true));
    await flushLazyRender();

    expect(listener.mock.calls[0][0].detail).toEqual({ effectId: "fireworks" });
    expect(document.querySelector(".tt-reset-celebration")).toHaveAttribute(
      "data-effect-id",
      "fireworks",
    );
    expect(window.localStorage.getItem("token-eyes:official-reset-celebrated:v1")).toBeNull();
    window.removeEventListener(RESET_CELEBRATION_PREVIEW_EVENT, listener);
  });

  it("broadcasts the selected preview effect to the other app WebView", async () => {
    const channels = [];
    const postMessage = vi.fn();
    vi.stubGlobal("BroadcastChannel", vi.fn(function MockBroadcastChannel(name) {
      this.name = name;
      this.postMessage = postMessage;
      this.close = vi.fn();
      this.onmessage = null;
      channels.push(this);
    }));
    renderProvider();

    act(() => expect(triggerResetCelebrationPreview("fireworks")).toBe(true));
    await flushLazyRender();

    expect(channels).toHaveLength(1);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "reset-celebration",
      effectId: "fireworks",
      detail: expect.objectContaining({ eventId: expect.stringMatching(/^preview:fireworks:/) }),
    }));
  });

  it("shows a remote celebration once without broadcasting it back", async () => {
    const channels = [];
    const postMessage = vi.fn();
    vi.stubGlobal("BroadcastChannel", vi.fn(function MockBroadcastChannel(name) {
      this.name = name;
      this.postMessage = postMessage;
      this.close = vi.fn();
      this.onmessage = null;
      channels.push(this);
    }));
    renderProvider();

    act(() => channels[0].onmessage({ data: {
      type: "reset-celebration",
      detail: VALID_EVENT,
      effectId: "fireworks",
    } }));
    await flushLazyRender();

    expect(document.querySelector(".tt-reset-celebration")).toHaveAttribute(
      "data-effect-id",
      "fireworks",
    );
    expect(postMessage).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(RESET_CELEBRATION_DURATION_MS));
    act(() => channels[0].onmessage({ data: {
      type: "reset-celebration",
      detail: VALID_EVENT,
      effectId: "fireworks",
    } }));
    await flushLazyRender();
    expect(document.querySelector(".tt-reset-celebration")).toBeNull();
  });

  it("rejects unknown preview effect ids", () => {
    renderProvider();
    expect(triggerResetCelebrationPreview("unknown-effect")).toBe(false);
    expect(document.querySelector(".tt-reset-celebration")).toBeNull();
  });

  it("ignores malformed events and does not replay the same event id", async () => {
    renderProvider();
    dispatchCelebration({ ...VALID_EVENT, eventId: "" });
    expect(document.querySelector(".tt-reset-celebration")).toBeNull();

    dispatchCelebration();
    await flushLazyRender();
    act(() => vi.advanceTimersByTime(RESET_CELEBRATION_DURATION_MS));
    dispatchCelebration();
    await flushLazyRender();
    expect(document.querySelector(".tt-reset-celebration")).toBeNull();
  });

  it("keeps the celebration for six seconds and then cleans it up", async () => {
    renderProvider();
    dispatchCelebration();
    await flushLazyRender();
    expect(RESET_CELEBRATION_DURATION_MS).toBe(6_000);

    act(() => vi.advanceTimersByTime(5_999));
    expect(document.querySelector(".tt-reset-celebration")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(document.querySelector(".tt-reset-celebration")).toBeNull();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("uses a static themed card without particles for reduced motion", async () => {
    renderProvider({ reducedMotion: true, theme: "dark" });
    dispatchCelebration();
    await flushLazyRender();

    const overlay = document.querySelector(".tt-reset-celebration");
    expect(overlay).toHaveClass("tt-reset-celebration--static");
    expect(overlay).toHaveAttribute("data-renderer", "css");
    expect(overlay).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("status")).toBeVisible();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("updates the glass material immediately when the resolved theme changes", () => {
    renderProvider({ theme: "light" });
    dispatchCelebration();
    expect(document.querySelector(".tt-reset-celebration")).toHaveAttribute("data-theme", "light");

    fireEvent.click(screen.getByRole("button", { name: "Use dark theme" }));
    expect(document.querySelector(".tt-reset-celebration")).toHaveAttribute("data-theme", "dark");
  });

  it("keeps the card visible when a renderer cannot start", async () => {
    HTMLCanvasElement.prototype.getContext.mockReturnValue(null);
    renderProvider();
    dispatchCelebration();
    await flushLazyRender();

    expect(screen.getByRole("status")).toBeVisible();
    expect(document.querySelector(".tt-reset-celebration")).toHaveAttribute("data-renderer", "css");
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("clears an active celebration on route changes", async () => {
    renderProvider();
    dispatchCelebration();
    await flushLazyRender();
    fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
    expect(document.querySelector(".tt-reset-celebration")).toBeNull();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
