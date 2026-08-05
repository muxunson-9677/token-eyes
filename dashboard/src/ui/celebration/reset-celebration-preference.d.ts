export const RESET_CELEBRATION_EFFECT_IDS: readonly ["meteors", "fireworks"];
export type ResetCelebrationEffectId = (typeof RESET_CELEBRATION_EFFECT_IDS)[number];

export const DEFAULT_RESET_CELEBRATION_EFFECT: "meteors";
export const RESET_CELEBRATION_EFFECT_STORAGE_KEY: string;
export const RESET_CELEBRATION_EFFECT_CHANGE_EVENT: string;

export function normalizeResetCelebrationEffect(value: unknown): ResetCelebrationEffectId;
export function readResetCelebrationEffect(): ResetCelebrationEffectId;
export function saveResetCelebrationEffect(value: unknown): ResetCelebrationEffectId;
