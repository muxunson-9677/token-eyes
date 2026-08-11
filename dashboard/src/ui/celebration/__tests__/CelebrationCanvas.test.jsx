import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FireworksCelebrationCanvas from "../FireworksCelebrationCanvas.jsx";
import MeteorCelebrationCanvas from "../MeteorCelebrationCanvas.jsx";

let context;
let rafCallbacks;

function createContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    createRadialGradient: vi.fn(() => gradient),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    lineCap: "butt",
    lineJoin: "miter",
    lineWidth: 1,
    strokeStyle: "",
  };
}

function runNextFrame(time = 1_000) {
  const callback = [...rafCallbacks.values()][0];
  expect(callback).toBeTypeOf("function");
  rafCallbacks.clear();
  act(() => callback(time));
}

beforeEach(() => {
  context = createContext();
  rafCallbacks = new Map();
  let rafId = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => {
    rafId += 1;
    rafCallbacks.set(rafId, callback);
    return rafId;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id) => rafCallbacks.delete(id)));
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
  Object.defineProperty(window.navigator, "hardwareConcurrency", { configurable: true, value: 8 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("celebration canvas renderers", () => {
  it("renders meteors on a transparent capped canvas and releases listeners", () => {
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const view = render(<MeteorCelebrationCanvas />);
    const canvas = view.container.querySelector("canvas");

    expect(canvas).toHaveAttribute("data-effect-renderer", "meteors");
    expect(Number(canvas.dataset.renderScale)).toBeLessThanOrEqual(1);
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith("2d", {
      alpha: true,
      desynchronized: true,
    });

    runNextFrame();
    expect(context.fillRect).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();

    view.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(removeWindowListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("renders the reference fireworks burst model on a transparent canvas", () => {
    const view = render(<FireworksCelebrationCanvas />);
    const canvas = view.container.querySelector("canvas");

    expect(canvas).toHaveAttribute("data-effect-renderer", "fireworks");
    runNextFrame();
    expect(context.arc).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();
  });

  it("reports an unavailable 2D context without starting animation", () => {
    HTMLCanvasElement.prototype.getContext.mockReturnValueOnce(null);
    const onFallback = vi.fn();

    render(<MeteorCelebrationCanvas onFallback={onFallback} />);

    expect(onFallback).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("waits while the document is hidden and resumes with a fresh clock", () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    render(<MeteorCelebrationCanvas />);

    expect(requestAnimationFrame).not.toHaveBeenCalled();

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });
});
