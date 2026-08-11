import type { PropsWithChildren, ReactElement } from "react";

export const RESET_CELEBRATION_DURATION_MS: number;
export const RESET_CELEBRATION_PREVIEW_EVENT: string;
export const RESET_CELEBRATION_EFFECT_IDS: readonly ["meteors", "fireworks"];

export type ResetCelebrationEffectId = (typeof RESET_CELEBRATION_EFFECT_IDS)[number];

export function triggerResetCelebrationPreview(effectId: ResetCelebrationEffectId): boolean;
export function ResetCelebrationProvider(props: PropsWithChildren): ReactElement;

export default ResetCelebrationProvider;
