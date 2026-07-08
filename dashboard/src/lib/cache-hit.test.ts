import { describe, expect, it } from "vitest";
import { calculateCacheHitSummary, formatCacheHitRate } from "./cache-hit";

describe("calculateCacheHitSummary", () => {
  it("uses cached tokens over input-like tokens", () => {
    const result = calculateCacheHitSummary({
      input_tokens: 300,
      cached_input_tokens: 600,
      cache_creation_input_tokens: 100,
    });
    expect(result.cachedTokens).toBe(600);
    expect(result.inputLikeTokens).toBe(1000);
    expect(result.cacheHitRate).toBe(0.6);
    expect(formatCacheHitRate(result.cacheHitRate)).toBe("60.0%");
  });

  it("returns zero rate when denominator is zero", () => {
    const result = calculateCacheHitSummary({});
    expect(result.cachedTokens).toBe(0);
    expect(result.inputLikeTokens).toBe(0);
    expect(result.cacheHitRate).toBe(0);
    expect(formatCacheHitRate(result.cacheHitRate)).toBe("0%");
  });
});
