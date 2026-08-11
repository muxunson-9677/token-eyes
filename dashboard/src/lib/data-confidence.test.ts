import { describe, expect, it } from "vitest";
import { DATA_CONFIDENCE_STATES, deriveDataConfidence } from "./data-confidence";

describe("deriveDataConfidence", () => {
  it("exposes the canonical six-state vocabulary", () => {
    expect(DATA_CONFIDENCE_STATES).toEqual([
      "exact",
      "estimated",
      "partial",
      "stale",
      "unavailable",
      "unattributed",
    ]);
  });

  it("returns exact for a complete current source value", () => {
    expect(deriveDataConfidence({
      hasValue: true,
      accuracy: "exact",
      coverage: "complete",
      sourceKind: "session_log",
      observedAt: "2026-08-01T01:00:00.000Z",
    })).toMatchObject({ state: "exact", states: ["exact"] });
  });

  it("returns estimated with its method", () => {
    expect(deriveDataConfidence({
      hasValue: true,
      accuracy: "estimated",
      coverage: "complete",
      estimationMethod: "curated API pricing",
    })).toMatchObject({ state: "estimated", estimationMethod: "curated API pricing" });
  });

  it("returns partial with pricing coverage impact", () => {
    expect(deriveDataConfidence({
      metric: "cost",
      hasValue: true,
      accuracy: "estimated",
      coverage: "partial",
      totalTokens: 1000,
      unpricedTokens: 250,
    })).toMatchObject({
      state: "partial",
      states: ["partial", "estimated"],
      unpricedTokens: 250,
      unpricedPercent: 25,
      coveragePercent: 75,
    });
  });

  it("returns unavailable when an entire cost total is unpriced", () => {
    expect(deriveDataConfidence({
      metric: "cost",
      hasValue: false,
      coverage: "unpriced",
      totalTokens: 1000,
      unpricedTokens: 1000,
      reason: "No matching price",
    })).toMatchObject({
      state: "unavailable",
      unpricedPercent: 100,
      reason: "No matching price",
    });
  });

  it("returns stale and preserves secondary attribution risk", () => {
    expect(deriveDataConfidence({
      hasValue: true,
      isStale: true,
      lastSuccessAt: "2026-08-01T00:00:00.000Z",
      totalTokens: 1000,
      unattributedTokens: 100,
    })).toMatchObject({
      state: "stale",
      states: ["stale", "unattributed"],
      lastSuccessAt: "2026-08-01T00:00:00.000Z",
      unattributedPercent: 10,
    });
  });

  it("warns only when unattributed usage exceeds five percent", () => {
    expect(deriveDataConfidence({ hasValue: true, totalTokens: 1000, unattributedTokens: 50 }).state)
      .toBe("exact");
    expect(deriveDataConfidence({ hasValue: true, totalTokens: 1000, unattributedTokens: 51 }))
      .toMatchObject({ state: "unattributed", unattributedPercent: 5.1 });
  });
});
