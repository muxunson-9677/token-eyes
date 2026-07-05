import { describe, expect, it } from "vitest";
import {
  normalizeVisibleProviderIds,
  intersectVisibleSources,
  filterVisibleSourceOptions,
  reconcileVisibleUsageFilters,
  filterProviderRows,
  filterSpendTimeseries,
} from "./spend-provider-visibility.js";

describe("spend provider visibility", () => {
  const visible = ["claude", "codex", "hermes"];

  describe("normalizeVisibleProviderIds", () => {
    it("lowercases, dedupes, and drops unknown IDs while preserving order", () => {
      expect(normalizeVisibleProviderIds(["Codex", "claude", "codex", "unknown"]))
        .toEqual(["codex", "claude"]);
    });

    it("returns empty array for empty input", () => {
      expect(normalizeVisibleProviderIds([])).toEqual([]);
      expect(normalizeVisibleProviderIds(null)).toEqual([]);
      expect(normalizeVisibleProviderIds(undefined)).toEqual([]);
    });
  });

  describe("intersectVisibleSources", () => {
    it("returns visible list when no selection is applied", () => {
      expect(intersectVisibleSources(null, ["claude", "codex"]))
        .toEqual(["claude", "codex"]);
    });

    it("returns intersection when selection is narrower than visible", () => {
      expect(intersectVisibleSources(["cursor", "codex"], ["claude", "codex"]))
        .toEqual(["codex"]);
    });

    it("returns empty array when visible is empty", () => {
      expect(intersectVisibleSources(["codex", "claude"], []))
        .toEqual([]);
    });

    it("preserves visible order in intersection", () => {
      expect(intersectVisibleSources(["hermes", "claude"], ["claude", "codex", "hermes"]))
        .toEqual(["claude", "hermes"]);
    });
  });

  describe("filterVisibleSourceOptions", () => {
    it("filters options to visible list in allowlist order", () => {
      expect(filterVisibleSourceOptions([
        { source: "cursor" },
        { source: "codex" },
        { source: "claude" },
      ], ["claude", "codex"]).map((row) => row.source))
        .toEqual(["claude", "codex"]);
    });

    it("returns empty array when visible is empty", () => {
      expect(filterVisibleSourceOptions([{ source: "codex" }], []))
        .toEqual([]);
    });

    it("returns empty array when options is not an array", () => {
      expect(filterVisibleSourceOptions(null, ["claude"])).toEqual([]);
    });
  });

  describe("reconcileVisibleUsageFilters", () => {
    it("clears all filters when selection becomes entirely hidden", () => {
      expect(reconcileVisibleUsageFilters({
        agentIds: ["cursor"],
        sources: ["cursor"],
        models: ["cursor-model"],
      }, ["claude", "codex"]))
        .toEqual({ agentIds: null, sources: null, models: null });
    });

    it("keeps intersection when selection is partially visible", () => {
      expect(reconcileVisibleUsageFilters({
        agentIds: ["codex", "cursor"],
        sources: ["codex", "cursor"],
        models: ["codex-model"],
      }, ["claude", "codex"]))
        .toEqual({ agentIds: ["codex"], sources: ["codex"], models: null });
    });

    it("returns null for all when visible is empty", () => {
      expect(reconcileVisibleUsageFilters({
        agentIds: ["claude"],
        sources: ["claude"],
        models: ["claude-model"],
      }, []))
        .toEqual({ agentIds: null, sources: null, models: null });
    });

    it("preserves null selections when visible is non-empty", () => {
      expect(reconcileVisibleUsageFilters({
        agentIds: null,
        sources: null,
        models: null,
      }, ["claude", "codex"]))
        .toEqual({ agentIds: null, sources: null, models: null });
    });
  });

  it("按限制显示顺序过滤趋势来源并保留无数据 Provider", () => {
    const result = filterSpendTimeseries({
      sources: ["codex", "cursor", "claude"],
      series: [
        { source: "codex", bucket_start: "2026-06-01", combined_usd: 2 },
        { source: "cursor", bucket_start: "2026-06-01", combined_usd: 9 },
        { source: "claude", bucket_start: "2026-06-01", combined_usd: 1 },
      ],
    }, visible);

    expect(result.sources).toEqual(["claude", "codex", "hermes"]);
    expect(result.series.map((row) => row.source)).toEqual(["codex", "claude"]);
  });

  it("为可见但无花销数据的 Provider 补零，并排除已关闭 Provider", () => {
    expect(filterProviderRows([
      { source: "codex", api_usd: 1, subscription_usd: 2, combined_usd: 3 },
      { source: "cursor", api_usd: 9, subscription_usd: 0, combined_usd: 9 },
    ], visible)).toEqual([
      { source: "claude", api_usd: 0, subscription_usd: 0, combined_usd: 0 },
      { source: "codex", api_usd: 1, subscription_usd: 2, combined_usd: 3 },
      { source: "hermes", api_usd: 0, subscription_usd: 0, combined_usd: 0 },
    ]);
  });

  it("保留原始行中的额外字段", () => {
    expect(filterProviderRows([
      { source: "codex", api_usd: 1, subscription_usd: 2, combined_usd: 3, api_cost_usd: 0.5 },
    ], ["codex", "hermes"])).toEqual([
      { source: "codex", api_usd: 1, subscription_usd: 2, combined_usd: 3, api_cost_usd: 0.5 },
      { source: "hermes", api_usd: 0, subscription_usd: 0, combined_usd: 0 },
    ]);
  });

  it("filterSpendTimeseries 过滤 by_source", () => {
    const result = filterSpendTimeseries({
      sources: ["codex", "cursor"],
      series: [{ source: "codex", bucket_start: "2026-06-01", combined_usd: 2 }],
      by_source: [
        { source: "codex", api_usd: 1, subscription_usd: 0, combined_usd: 1 },
        { source: "cursor", api_usd: 5, subscription_usd: 0, combined_usd: 5 },
      ],
    }, ["claude", "codex"]);

    expect(result.by_source).toEqual([
      { source: "claude", api_usd: 0, subscription_usd: 0, combined_usd: 0 },
      { source: "codex", api_usd: 1, subscription_usd: 0, combined_usd: 1 },
    ]);
  });
});
