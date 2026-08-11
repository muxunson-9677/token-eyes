export const DATA_CONFIDENCE_STATES = [
  "exact",
  "estimated",
  "partial",
  "stale",
  "unavailable",
  "unattributed",
] as const;

export type DataConfidenceState = (typeof DATA_CONFIDENCE_STATES)[number];

export interface DataConfidenceInput {
  metric?: "tokens" | "cost" | "spend" | "quota";
  hasValue?: boolean;
  availability?: "available" | "unavailable";
  accuracy?: "exact" | "normalized" | "estimated" | "unknown";
  coverage?: "complete" | "partial" | "unavailable" | "unpriced";
  sourceKind?: string | null;
  sourceLabel?: string | null;
  observedAt?: string | null;
  lastSuccessAt?: string | null;
  isStale?: boolean;
  totalTokens?: number | null;
  unattributedTokens?: number | null;
  unpricedTokens?: number | null;
  estimationMethod?: string | null;
  reason?: string | null;
}

export interface DataConfidence extends DataConfidenceInput {
  state: DataConfidenceState;
  states: DataConfidenceState[];
  unattributedPercent: number;
  unpricedPercent: number;
  coveragePercent: number;
}

function nonNegative(value: number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function percent(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function deriveDataConfidence(input: DataConfidenceInput = {}): DataConfidence {
  const totalTokens = nonNegative(input.totalTokens);
  const unattributedTokens = nonNegative(input.unattributedTokens);
  const unpricedTokens = nonNegative(input.unpricedTokens);
  const unattributedPercent = percent(unattributedTokens, totalTokens);
  const unpricedPercent = percent(unpricedTokens, totalTokens);
  const coveragePercent = totalTokens > 0
    ? Math.max(0, Math.round((100 - unpricedPercent) * 10) / 10)
    : input.coverage === "complete" ? 100 : 0;
  const unavailable = input.hasValue === false
    || input.availability === "unavailable"
    || input.coverage === "unavailable"
    || (input.metric === "cost" && input.coverage === "unpriced" && unpricedPercent >= 100);
  const stale = !unavailable && (input.isStale === true || input.sourceKind === "cache");
  const unattributed = !unavailable && unattributedPercent > 5;
  const partial = !unavailable && (
    input.coverage === "partial"
    || input.coverage === "unpriced"
    || (unpricedTokens > 0 && unpricedPercent < 100)
  );
  const estimated = !unavailable && input.accuracy === "estimated";
  const states: DataConfidenceState[] = [];

  if (unavailable) states.push("unavailable");
  if (stale) states.push("stale");
  if (unattributed) states.push("unattributed");
  if (partial) states.push("partial");
  if (estimated) states.push("estimated");
  if (states.length === 0) states.push("exact");

  return {
    ...input,
    totalTokens,
    unattributedTokens,
    unpricedTokens,
    unattributedPercent,
    unpricedPercent,
    coveragePercent,
    state: states[0],
    states,
  };
}
