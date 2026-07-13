export const OTHER_AI_SPEND_SOURCE = "other_ai";

export function withOtherAiCostSource(sources = []) {
  const normalizedSources = Array.isArray(sources)
    ? sources.filter((source) => typeof source === "string" && source.length > 0)
    : [];
  return [...new Set([...normalizedSources, OTHER_AI_SPEND_SOURCE])];
}
