export function calculateCacheHitSummary(totals: any = {}) {
  const cachedTokens = Number(totals?.cached_input_tokens || 0);
  const inputTokens = Number(totals?.input_tokens || 0);
  const cacheCreationTokens = Number(totals?.cache_creation_input_tokens || 0);
  const safeCachedTokens = Number.isFinite(cachedTokens) && cachedTokens > 0 ? cachedTokens : 0;
  const inputLikeTokens =
    (Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0) +
    safeCachedTokens +
    (Number.isFinite(cacheCreationTokens) && cacheCreationTokens > 0 ? cacheCreationTokens : 0);
  const cacheHitRate = inputLikeTokens > 0 ? safeCachedTokens / inputLikeTokens : 0;

  return {
    cachedTokens: safeCachedTokens,
    inputLikeTokens,
    cacheHitRate,
  };
}

export function formatCacheHitRate(rate: any) {
  const numberValue = Number(rate);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "0%";
  return `${(numberValue * 100).toFixed(1)}%`;
}
