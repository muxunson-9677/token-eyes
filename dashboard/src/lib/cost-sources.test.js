import { describe, expect, it } from "vitest";
import { OTHER_AI_SPEND_SOURCE, withOtherAiCostSource } from "./cost-sources.js";

describe("withOtherAiCostSource", () => {
  it("appends the reserved manual-cost source without mutating provider sources", () => {
    const providerSources = ["claude", "codex"];

    expect(withOtherAiCostSource(providerSources)).toEqual(["claude", "codex", "other_ai"]);
    expect(providerSources).toEqual(["claude", "codex"]);
    expect(OTHER_AI_SPEND_SOURCE).toBe("other_ai");
  });

  it("deduplicates sources and still returns other_ai when no provider is visible", () => {
    expect(withOtherAiCostSource(["claude", "other_ai", "claude", ""])).toEqual([
      "claude",
      "other_ai",
    ]);
    expect(withOtherAiCostSource([])).toEqual(["other_ai"]);
  });
});
