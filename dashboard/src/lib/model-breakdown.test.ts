import { describe, expect, it } from "vitest";
import {
  BILLING_FILTERS,
  appendConnectedTokenOnlySources,
  buildFleetData,
  buildModelUsageDistribution,
  filterFleetByBillingMode,
  normalizeBillingFilterValue,
} from "./model-breakdown";

describe("appendConnectedTokenOnlySources", () => {
  it("shows detected Trae and CodeBuddy without inventing token usage", () => {
    const fleet = appendConnectedTokenOnlySources([], {
      trae: { configured: true, total_tokens: 0, collection_status: "connected_no_precise_tokens" },
      codebuddy: { configured: true, total_tokens: 0, collection_status: "connected_no_precise_tokens" },
    });

    expect(fleet.map((entry) => entry.source)).toEqual(["trae", "codebuddy"]);
    expect(fleet.every((entry) => entry.usage === 0)).toBe(true);
    expect(fleet.every((entry) => entry.collectionStatus === "connected_no_precise_tokens")).toBe(true);
  });

  it("does not duplicate a source that already has measured usage", () => {
    const measured = [{ source: "trae", label: "TRAE", usage: 42, models: [] }];
    expect(appendConnectedTokenOnlySources(measured, {
      trae: { configured: true, total_tokens: 0, collection_status: "connected_no_precise_tokens" },
    })).toEqual(measured);
  });
});

describe("buildModelUsageDistribution", () => {
  it("merges the same model across providers and groups overflow into other", () => {
    const breakdown = {
      sources: [
        {
          source: "codex",
          models: [
            { model: "gpt-5.5", totals: { total_tokens: 600 } },
            { model: "model-b", totals: { total_tokens: 300 } },
            { model: "model-c", totals: { total_tokens: 200 } },
            { model: "model-d", totals: { total_tokens: 100 } },
          ],
        },
        {
          source: "hermes",
          models: [
            { model: "GPT-5.5", totals: { total_tokens: 400 } },
            { model: "model-e", totals: { total_tokens: 80 } },
            { model: "model-f", totals: { total_tokens: 60 } },
            { model: "model-g", totals: { total_tokens: 40 } },
          ],
        },
      ],
    };

    const result = buildModelUsageDistribution(breakdown, {
      limit: 5,
      otherLabel: "其他",
    });

    expect(result.totalTokens).toBe(1780);
    expect(result.rows[0]).toMatchObject({ name: "gpt-5.5", tokens: 1000 });
    expect(result.rows).toHaveLength(6);
    expect(result.rows[5]).toMatchObject({ name: "其他", tokens: 100 });
    expect(result.rows.reduce((sum: number, row: any) => sum + row.tokens, 0)).toBe(1780);
  });

  it("groups measured tokens with missing source or model names as unattributed", () => {
    const copyFn = (key: string) => key === "data.confidence.unattributed" ? "Unattributed" : key;
    const breakdown = {
      sources: [{
        source: null,
        totals: { total_tokens: 100 },
        models: [{ model: null, totals: { total_tokens: 100 } }],
      }],
    };

    const fleet = buildFleetData(breakdown, { copyFn });
    const distribution = buildModelUsageDistribution(breakdown, { copyFn });

    expect(fleet[0]).toMatchObject({ label: "Unattributed", usage: 100 });
    expect(fleet[0].models[0]).toMatchObject({ name: "Unattributed", usage: 100 });
    expect(distribution.rows[0]).toMatchObject({ name: "Unattributed", tokens: 100 });
  });

  it("keeps every measured model separate when the overview asks for the full distribution", () => {
    const breakdown = {
      sources: [{
        source: "codex",
        models: [
          { model: "gpt-5.6-sol", totals: { total_tokens: 600 } },
          { model: "gpt-5.5", totals: { total_tokens: 300 } },
          { model: "deepseek-v4-pro", totals: { total_tokens: 200 } },
          { model: "model-d", totals: { total_tokens: 100 } },
          { model: "model-e", totals: { total_tokens: 80 } },
          { model: "model-f", totals: { total_tokens: 60 } },
        ],
      }],
    };

    const result = buildModelUsageDistribution(breakdown, {
      limit: Number.MAX_SAFE_INTEGER,
      otherLabel: "Other",
    });

    expect(result.rows.map((row) => row.name)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.5",
      "deepseek-v4-pro",
      "model-d",
      "model-e",
      "model-f",
    ]);
    expect(result.rows.some((row) => row.id === "other-models")).toBe(false);
  });
});

// Q02: filter + recompute contract for the model-breakdown helper used by
// UsageOverview. These tests pin the rules documented in
// docs/dev-notes/billing-mode-display-spec.md so the renderer and the
// backend stay in agreement.

function makeFleet() {
  return [
    {
      source: "codex",
      label: "CODEX",
      totalPercent: "60.0",
      usage: 600,
      usd: 6,
      billingMode: "mixed",
      billingModes: ["api_key", "token_plan"],
      models: [
        { id: "gpt-4o", name: "GPT-4o", share: 50, usage: 300, cost: 3, billingMode: "api_key" },
        { id: "gpt-5-pro", name: "GPT-5 Pro", share: 50, usage: 300, cost: 3, billingMode: "token_plan" },
      ],
    },
    {
      source: "hermes",
      label: "HERMES",
      totalPercent: "40.0",
      usage: 400,
      usd: 4,
      billingMode: "mixed",
      billingModes: ["api_key", "token_plan", "unknown"],
      models: [
        { id: "mimo-v2.5-pro", name: "MiMo v2.5 Pro", share: 25, usage: 100, cost: 1, billingMode: "token_plan" },
        { id: "deepseek-v4-pro", name: "DeepSeek v4 Pro", share: 25, usage: 100, cost: 1, billingMode: "api_key" },
        { id: "totally-unrecognized", name: "Mystery Model", share: 50, usage: 200, cost: 2, billingMode: "unknown" },
      ],
    },
  ];
}

describe("filterFleetByBillingMode", () => {
  it("returns the input untouched for filter='all'", () => {
    const fleet = makeFleet();
    const result = filterFleetByBillingMode(fleet, "all");
    expect(result).toBe(fleet);
  });

  it("keeps only api_key models and recomputes per-source usage / cost / share", () => {
    const fleet = makeFleet();
    const result = filterFleetByBillingMode(fleet, "api_key");

    expect(result).toHaveLength(2);

    const codex = result.find((r: any) => r.source === "codex");
    expect(codex!.models.map((m: any) => m.id)).toEqual(["gpt-4o"]);
    // Only the api_key model survives, so usage / cost come from it and
    // share is recomputed against the filtered source total (100%).
    expect(codex!.usage).toBe(300);
    expect(codex!.usd).toBe(3);
    expect(codex!.models[0].share).toBe(100);
    // Filtered grand total across both sources = 300 (codex) + 100 (hermes) = 400.
    // codex share of the grand total = 300 / 400 = 75.0%.
    expect(codex!.totalPercent).toBe("75.0");

    const hermes = result.find((r: any) => r.source === "hermes");
    expect(hermes!.models.map((m: any) => m.id)).toEqual(["deepseek-v4-pro"]);
    expect(hermes!.usage).toBe(100);
    expect(hermes!.usd).toBe(1);
    expect(hermes!.totalPercent).toBe("25.0");
  });

  it("keeps only token_plan models and recomputes totals", () => {
    const fleet = makeFleet();
    const result = filterFleetByBillingMode(fleet, "token_plan");

    const codex = result.find((r: any) => r.source === "codex");
    expect(codex!.models.map((m: any) => m.id)).toEqual(["gpt-5-pro"]);
    expect(codex!.usage).toBe(300);

    const hermes = result.find((r: any) => r.source === "hermes");
    expect(hermes!.models.map((m: any) => m.id)).toEqual(["mimo-v2.5-pro"]);
    expect(hermes!.usage).toBe(100);
    // Grand total = 300 + 100 = 400; codex share = 75.0%, hermes = 25.0%.
    expect(codex!.totalPercent).toBe("75.0");
    expect(hermes!.totalPercent).toBe("25.0");
  });

  it("keeps only unknown models and recomputes totals", () => {
    const fleet = makeFleet();
    const result = filterFleetByBillingMode(fleet, "unknown");

    // codex has no unknown models → that source is dropped from the result.
    expect(result.map((r: any) => r.source)).toEqual(["hermes"]);
    const hermes = result[0];
    expect(hermes.models.map((m: any) => m.id)).toEqual(["totally-unrecognized"]);
    expect(hermes.usage).toBe(200);
    expect(hermes.totalPercent).toBe("100.0");
  });

  it("recomputes model share within the filtered source so survivors stay proportional", () => {
    const fleet = [
      {
        source: "codex",
        label: "CODEX",
        totalPercent: "100.0",
        usage: 1000,
        usd: 10,
        billingMode: "mixed",
        billingModes: ["api_key", "token_plan"],
        models: [
          { id: "a", name: "A", share: 80, usage: 800, cost: 8, billingMode: "api_key" },
          { id: "b", name: "B", share: 20, usage: 200, cost: 2, billingMode: "token_plan" },
        ],
      },
    ];
    const result = filterFleetByBillingMode(fleet, "api_key");
    expect(result[0].models).toHaveLength(1);
    expect(result[0].models[0].id).toBe("a");
    expect(result[0].models[0].share).toBe(100);
    expect(result[0].usage).toBe(800);
    expect(result[0].totalPercent).toBe("100.0");
  });

  it("returns an empty list when no model matches the filter", () => {
    const fleet = [
      {
        source: "codex",
        label: "CODEX",
        totalPercent: "100.0",
        usage: 100,
        usd: 1,
        billingMode: "api_key",
        billingModes: ["api_key"],
        models: [{ id: "gpt-4o", name: "GPT-4o", share: 100, usage: 100, cost: 1, billingMode: "api_key" }],
      },
    ];
    expect(filterFleetByBillingMode(fleet, "unknown")).toEqual([]);
    expect(filterFleetByBillingMode(fleet, "token_plan")).toEqual([]);
  });

  it("treats unrecognized filter values as 'all'", () => {
    const fleet = makeFleet();
    const result = filterFleetByBillingMode(fleet, "garbage");
    expect(result).toBe(fleet);
  });

  it("handles a non-array fleet defensively", () => {
    // Pass-through should be the same shape we were given (defensive).
    expect(filterFleetByBillingMode(null as any, "api_key")).toEqual([]);
  });
});

describe("normalizeBillingFilterValue", () => {
  it("accepts the four known billing filters", () => {
    expect(normalizeBillingFilterValue("all")).toBe("all");
    expect(normalizeBillingFilterValue("api_key")).toBe("api_key");
    expect(normalizeBillingFilterValue("token_plan")).toBe("token_plan");
    expect(normalizeBillingFilterValue("unknown")).toBe("unknown");
  });

  it("falls back to 'all' for anything else", () => {
    expect(normalizeBillingFilterValue(undefined)).toBe("all");
    expect(normalizeBillingFilterValue(null)).toBe("all");
    expect(normalizeBillingFilterValue("mixed")).toBe("all");
    expect(normalizeBillingFilterValue("garbage")).toBe("all");
  });
});

describe("BILLING_FILTERS", () => {
  it("is the canonical order: all, api_key, token_plan, unknown", () => {
    expect(BILLING_FILTERS).toEqual(["all", "api_key", "token_plan", "unknown"]);
  });
});

describe("buildFleetData preserves billing metadata", () => {
  it("includes Trae and CodeBuddy token-only sources with zero cost", () => {
    const breakdown = {
      pricing: { pricing_mode: "list" },
      sources: [
        {
          source: "trae",
          totals: { total_tokens: 1000, total_cost_usd: 0 },
          models: [
            { model: "trae", model_id: "trae", totals: { total_tokens: 1000, total_cost_usd: 0 } },
          ],
        },
        {
          source: "codebuddy",
          totals: { total_tokens: 500, total_cost_usd: 0 },
          models: [
            {
              model: "codebuddy",
              model_id: "codebuddy",
              totals: { total_tokens: 500, total_cost_usd: 0 },
            },
          ],
        },
      ],
    };

    const fleet = buildFleetData(breakdown);
    expect(fleet.map((entry) => entry.source)).toEqual(["trae", "codebuddy"]);
    expect(fleet.map((entry) => entry.usage)).toEqual([1000, 500]);
    expect(fleet.map((entry) => entry.usd)).toEqual([0, 0]);
  });

  it("surfaces source-level and model-level billing metadata to consumers", () => {
    const breakdown = {
      pricing: { pricing_mode: "list" },
      sources: [
        {
          source: "codex",
          billing_mode: "mixed",
          billing_modes: ["api_key", "token_plan"],
          totals: { total_tokens: 1000, total_cost_usd: "5.5" },
          models: [
            {
              model: "gpt-4o",
              model_id: "gpt-4o",
              billing_mode: "api_key",
              billing_mode_confidence: "explicit_row",
              totals: { total_tokens: 600, total_cost_usd: "3" },
            },
            {
              model: "gpt-5-pro",
              model_id: "gpt-5-pro",
              billing_mode: "token_plan",
              billing_mode_confidence: "source_token_plan_match",
              totals: { total_tokens: 400, total_cost_usd: "2.5" },
            },
          ],
        },
      ],
    };

    const fleet = buildFleetData(breakdown);
    expect(fleet).toHaveLength(1);
    expect(fleet[0].billingMode).toBe("mixed");
    expect(fleet[0].billingModes).toEqual(["api_key", "token_plan"]);
    expect(fleet[0].models[0].billingMode).toBe("api_key");
    expect(fleet[0].models[1].billingMode).toBe("token_plan");
  });

  it("preserves and filters mixed-model token slices without dropping either billing mode", () => {
    const fleet = buildFleetData({
      sources: [{
        source: "codex",
        billing_mode: "mixed",
        billing_modes: ["api_key", "token_plan"],
        totals: { total_tokens: 100, total_cost_usd: 10 },
        models: [{
          model: "gpt-5",
          billing_mode: "mixed",
          billing_mode_token_totals: { api_key: 30, token_plan: 70, unknown: 0 },
          billing_mode_cost_totals: { api_key: 4, token_plan: 6, unknown: 0 },
          totals: { total_tokens: 100, total_cost_usd: 10 },
        }],
      }],
    });

    expect(fleet[0].models[0].billingModeTokenTotals).toEqual({
      api_key: 30,
      token_plan: 70,
      unknown: 0,
    });
    const apiFleet = filterFleetByBillingMode(fleet, "api_key");
    const planFleet = filterFleetByBillingMode(fleet, "token_plan");
    expect(apiFleet[0]).toEqual(expect.objectContaining({ usage: 30, usd: 4 }));
    expect(apiFleet[0].models[0]).toEqual(expect.objectContaining({ usage: 30, cost: 4 }));
    expect(planFleet[0]).toEqual(expect.objectContaining({ usage: 70, usd: 6 }));
    expect(planFleet[0].models[0]).toEqual(expect.objectContaining({ usage: 70, cost: 6 }));

    const cloudFleet = buildFleetData({
      sources: [{
        source: "codex",
        totals: { total_tokens: 100, total_cost_usd: 10 },
        models: [{
          model: "gpt-5",
          billing_mode: "mixed",
          billing_mode_token_totals: { api_key: 30, token_plan: 70, unknown: 0 },
          totals: { total_tokens: 100, total_cost_usd: 10 },
        }],
      }],
    });
    const cloudApiFleet = filterFleetByBillingMode(cloudFleet, "api_key");
    expect(cloudApiFleet[0].usd).toBeNull();
    expect(cloudApiFleet[0].models[0].cost).toBeNull();
  });

  it("defaults missing billing metadata to 'unknown' / 'fallback_unknown'", () => {
    const breakdown = {
      pricing: { pricing_mode: "list" },
      sources: [
        {
          source: "codex",
          totals: { total_tokens: 1000, total_cost_usd: "5.5" },
          models: [
            { model: "gpt-4o", model_id: "gpt-4o", totals: { total_tokens: 1000, total_cost_usd: "5.5" } },
          ],
        },
      ],
    };

    const fleet = buildFleetData(breakdown);
    expect(fleet[0].billingMode).toBe("unknown");
    expect(fleet[0].billingModes).toEqual([]);
    expect(fleet[0].models[0].billingMode).toBe("unknown");
    expect(fleet[0].models[0].billingModeConfidence).toBe("fallback_unknown");
  });
});
