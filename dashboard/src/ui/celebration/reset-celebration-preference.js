export const RESET_CELEBRATION_EFFECT_IDS = ["meteors", "fireworks"];
export const DEFAULT_RESET_CELEBRATION_EFFECT = "meteors";
export const RESET_CELEBRATION_EFFECT_STORAGE_KEY = "token-eyes:reset-celebration-effect:v1";
export const RESET_CELEBRATION_EFFECT_CHANGE_EVENT = "token-eyes:reset-celebration-effect-change";

let currentEffect = DEFAULT_RESET_CELEBRATION_EFFECT;
let hasVolatileOverride = false;

export function normalizeResetCelebrationEffect(value) {
  return RESET_CELEBRATION_EFFECT_IDS.includes(value)
    ? value
    : DEFAULT_RESET_CELEBRATION_EFFECT;
}

export function readResetCelebrationEffect() {
  if (typeof window === "undefined") return currentEffect;

  try {
    const storedEffect = window.localStorage.getItem(RESET_CELEBRATION_EFFECT_STORAGE_KEY);
    if (RESET_CELEBRATION_EFFECT_IDS.includes(storedEffect)) {
      currentEffect = storedEffect;
      hasVolatileOverride = false;
      return currentEffect;
    }
    if (!hasVolatileOverride) currentEffect = DEFAULT_RESET_CELEBRATION_EFFECT;
  } catch {
    // Use the last in-memory selection when storage is unavailable.
  }

  return currentEffect;
}

export function saveResetCelebrationEffect(value) {
  currentEffect = normalizeResetCelebrationEffect(value);
  hasVolatileOverride = false;

  if (typeof window === "undefined") return currentEffect;

  try {
    window.localStorage.setItem(RESET_CELEBRATION_EFFECT_STORAGE_KEY, currentEffect);
  } catch {
    hasVolatileOverride = true;
  }

  window.dispatchEvent(new CustomEvent(
    RESET_CELEBRATION_EFFECT_CHANGE_EVENT,
    { detail: { effectId: currentEffect } },
  ));
  return currentEffect;
}
