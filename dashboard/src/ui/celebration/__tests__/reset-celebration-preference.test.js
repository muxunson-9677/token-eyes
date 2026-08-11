import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RESET_CELEBRATION_EFFECT,
  RESET_CELEBRATION_EFFECT_CHANGE_EVENT,
  RESET_CELEBRATION_EFFECT_STORAGE_KEY,
  normalizeResetCelebrationEffect,
  readResetCelebrationEffect,
  saveResetCelebrationEffect,
} from "../reset-celebration-preference.js";

describe("reset celebration preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults missing, legacy, and unknown values to meteors", () => {
    expect(readResetCelebrationEffect()).toBe(DEFAULT_RESET_CELEBRATION_EFFECT);
    expect(normalizeResetCelebrationEffect("lightfall")).toBe("meteors");
    expect(normalizeResetCelebrationEffect("unknown")).toBe("meteors");
  });

  it("persists a valid value and notifies the current document", () => {
    const listener = vi.fn();
    window.addEventListener(RESET_CELEBRATION_EFFECT_CHANGE_EVENT, listener);

    expect(saveResetCelebrationEffect("fireworks")).toBe("fireworks");

    expect(window.localStorage.getItem(RESET_CELEBRATION_EFFECT_STORAGE_KEY)).toBe("fireworks");
    expect(readResetCelebrationEffect()).toBe("fireworks");
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({ effectId: "fireworks" });
    window.removeEventListener(RESET_CELEBRATION_EFFECT_CHANGE_EVENT, listener);
  });

  it("uses the in-memory selection when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(() => saveResetCelebrationEffect("fireworks")).not.toThrow();
    expect(readResetCelebrationEffect()).toBe("fireworks");
  });
});
