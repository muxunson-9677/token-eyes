import { beforeEach, describe, expect, it } from "vitest";

import { clearDashboardMockUsageCaches } from "./usage-cache";

describe("clearDashboardMockUsageCaches", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("removes only explicitly tagged mock payloads and preserves real usage caches", () => {
    const realKey = "tokentracker.usage.default.local.2026-07-01.2026-07-30";
    const mockKey = "tokentracker.usageSummary.default.local.mock";
    window.localStorage.setItem(realKey, JSON.stringify({
      cacheSource: "edge",
      summary: { total_tokens: 42 },
    }));
    window.localStorage.setItem(mockKey, JSON.stringify({
      cacheSource: "mock",
      summary: { total_tokens: 999 },
    }));
    window.localStorage.setItem("unrelated", "keep");

    expect(clearDashboardMockUsageCaches()).toBe(1);
    expect(window.localStorage.getItem(realKey)).not.toBeNull();
    expect(window.localStorage.getItem(mockKey)).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });
});
