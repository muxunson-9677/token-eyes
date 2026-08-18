import React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oglMocks = vi.hoisted(() => ({
  Mesh: vi.fn(),
  Program: vi.fn(),
  Renderer: vi.fn(),
  Triangle: vi.fn(),
}));

const renderer = {
  dpr: 1,
  gl: {
    canvas: document.createElement("canvas"),
    getExtension: vi.fn(() => null),
  },
  render: vi.fn(),
  setSize: vi.fn(),
};

vi.mock("ogl", () => ({
  Mesh: oglMocks.Mesh,
  Program: oglMocks.Program,
  Renderer: oglMocks.Renderer,
  Triangle: oglMocks.Triangle,
}));

import LightRays from "./LightRays.jsx";

describe("LightRays reduced-motion behavior", () => {
  beforeEach(() => {
    oglMocks.Renderer.mockReset();
    oglMocks.Renderer.mockImplementation(() => renderer);
    renderer.render.mockClear();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback) {
        this.callback = callback;
      }

      observe(target) {
        this.callback([{ isIntersecting: true, target }]);
      }

      disconnect() {}
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not initialize WebGL or schedule animation frames when reduced motion is requested", async () => {
    render(<LightRays reducedMotion />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(oglMocks.Renderer).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("cancels pending initialization when reduced motion is enabled", async () => {
    const { rerender } = render(React.createElement(LightRays));

    rerender(React.createElement(LightRays, { reducedMotion: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(oglMocks.Renderer).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
