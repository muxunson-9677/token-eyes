import { toFiniteNumber } from "./format";

type AnyRecord = Record<string, any>;

export type BillingMode = "api_key" | "token_plan" | "unknown";
export type SourceBillingMode = BillingMode | "mixed";
export type BillingModeConfidence =
  | "explicit_row"
  | "token_plan_label_match"
  | "source_token_plan_match"
  | "heuristic_model_keyword"
  | "fallback_unknown";

export type BillingFilter = "all" | BillingMode;

export const BILLING_FILTERS: BillingFilter[] = [
  "all",
  "api_key",
  "token_plan",
  "unknown",
];

const VALID_BILLING_MODES: BillingMode[] = ["api_key", "token_plan", "unknown"];
const VALID_BILLING_FILTERS: BillingFilter[] = BILLING_FILTERS;

function normalizeBillingModeValue(value: any): BillingMode | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  if (VALID_BILLING_MODES.includes(lower as BillingMode)) {
    return lower as BillingMode;
  }
  return null;
}

function normalizeBillingFilterValue(value: any): BillingFilter {
  if (value === "api_key" || value === "token_plan" || value === "unknown") {
    return value;
  }
  return "all";
}

function normalizeBillingModeTokenTotals(value: any) {
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(VALID_BILLING_MODES.map((mode) => [
    mode,
    Math.max(0, toFiniteNumber(value[mode]) ?? 0),
  ])) as Record<BillingMode, number>;
}

function normalizeModelId(value: any) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function resolveModelId(model: any) {
  const id = normalizeModelId(model?.model_id);
  if (id) return id;
  return null;
}

function resolveModelName(model: any, fallback: any) {
  if (model?.model) return String(model.model);
  return fallback;
}

export function resolveDisplayTokens(totals: any, fallback = 0) {
  const billableTokens = toFiniteNumber(totals?.billable_total_tokens);
  const totalTokens = toFiniteNumber(totals?.total_tokens);
  if (billableTokens != null && billableTokens > 0) return billableTokens;
  if (totalTokens != null && totalTokens > 0) return totalTokens;
  return billableTokens ?? totalTokens ?? fallback;
}

export function buildFleetData(modelBreakdown: any, { copyFn }: AnyRecord = {}) {
  const safeCopy = typeof copyFn === "function" ? copyFn : (key: string) => key;
  const sources: any[] = Array.isArray(modelBreakdown?.sources) ? modelBreakdown.sources : [];
  const normalizedSources = sources
    .map((entry: any) => {
      const totalTokens = resolveDisplayTokens(entry?.totals);
      const totalCost = toFiniteNumber(entry?.totals?.total_cost_usd);
      // Q02: surface billing_mode metadata so UsageOverview can render
      // badges and filter rows without re-deriving on the client.
      const sourceBillingMode: SourceBillingMode =
        entry?.billing_mode === "api_key" ||
        entry?.billing_mode === "token_plan" ||
        entry?.billing_mode === "unknown" ||
        entry?.billing_mode === "mixed"
          ? entry.billing_mode
          : "unknown";
      const sourceBillingModes: BillingMode[] = Array.isArray(entry?.billing_modes)
        ? entry.billing_modes
            .map((m: any) => normalizeBillingModeValue(m))
            .filter((m: BillingMode | null): m is BillingMode => Boolean(m))
        : [];
      return {
        source: entry?.source,
        totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
        totalCost,
        models: Array.isArray(entry?.models) ? entry.models : [],
        billingMode: sourceBillingMode,
        billingModes: sourceBillingModes,
      };
    })
    .filter((entry) => entry.totalTokens > 0);

  if (!normalizedSources.length) return [];

  const grandTotal = normalizedSources.reduce((acc, entry) => acc + entry.totalTokens, 0);
  const pricingMode =
    typeof modelBreakdown?.pricing?.pricing_mode === "string"
      ? modelBreakdown.pricing.pricing_mode.toUpperCase()
      : null;

  return normalizedSources
    .slice()
    .sort((a: any, b: any) => b.totalTokens - a.totalTokens)
    .map((entry: any) => {
      const label = entry.source
        ? String(entry.source).toUpperCase()
        : safeCopy("data.confidence.unattributed");
      const totalPercentRaw = grandTotal > 0 ? (entry.totalTokens / grandTotal) * 100 : 0;
      const totalPercent = Number.isFinite(totalPercentRaw) ? totalPercentRaw.toFixed(1) : "0.0";
      const models = entry.models
        .map((model: any) => {
          const modelTokens = resolveDisplayTokens(model?.totals);
          if (!Number.isFinite(modelTokens) || modelTokens <= 0) return null;
          const share =
            entry.totalTokens > 0 ? Math.round((modelTokens / entry.totalTokens) * 1000) / 10 : 0;
          const name = resolveModelName(model, safeCopy("data.confidence.unattributed"));
          const id = resolveModelId(model);
          const explicitModelCost = toFiniteNumber(model?.totals?.total_cost_usd);
          const modelCost =
            explicitModelCost != null
              ? explicitModelCost
              : entry.totalCost > 0 && entry.totalTokens > 0
                ? (modelTokens / entry.totalTokens) * entry.totalCost
                : null;
          const modelBillingMode: SourceBillingMode =
            model?.billing_mode === "mixed"
              ? "mixed"
              : normalizeBillingModeValue(model?.billing_mode) || "unknown";
          const billingModeTokenTotals = normalizeBillingModeTokenTotals(
            model?.billing_mode_token_totals,
          );
          const billingModeCostTotals = normalizeBillingModeTokenTotals(
            model?.billing_mode_cost_totals,
          );
          return {
            id,
            name,
            share,
            usage: modelTokens,
            cost: modelCost,
            billingMode: modelBillingMode,
            billingModeTokenTotals,
            billingModeCostTotals,
            billingModeConfidence:
              typeof model?.billing_mode_confidence === "string"
                ? model.billing_mode_confidence
                : "fallback_unknown",
          };
        })
        .filter(Boolean);
      return {
        source: entry.source,
        label,
        totalPercent: String(totalPercent),
        usd: entry.totalCost,
        usage: entry.totalTokens,
        models,
        billingMode: entry.billingMode,
        billingModes: entry.billingModes,
      };
    });
}

export function appendConnectedTokenOnlySources(fleetData: any[], usageLimits: any) {
  const result = Array.isArray(fleetData) ? fleetData.slice() : [];
  const existing = new Set(result.map((entry) => String(entry?.source || "").toLowerCase()));
  for (const source of ["trae", "codebuddy", "opencode"]) {
    if (existing.has(source)) continue;
    const state = usageLimits?.[source];
    if (!state?.configured || state.collection_status !== "connected_no_precise_tokens") continue;
    result.push({
      source,
      label: source === "codebuddy" ? "CODEBUDDY" : source.toUpperCase(),
      totalPercent: "0.0",
      usd: null,
      usage: 0,
      models: [],
      billingMode: "unknown",
      billingModes: [],
      collectionStatus: state.collection_status,
      dataPath: state.data_path || null,
    });
  }
  return result;
}

/**
 * Filter a fleet dataset by billing_mode, recomputing per-source and overall
 * totals/percentages so the displayed numbers stay self-consistent under the
 * active filter. Pass `filter="all"` (or omit) for the unfiltered view.
 */
export function filterFleetByBillingMode(fleetData: any[], filter: any = "all") {
  const safeFilter: BillingFilter = VALID_BILLING_FILTERS.includes(filter)
    ? (filter as BillingFilter)
    : "all";
  const list = Array.isArray(fleetData) ? fleetData : [];
  if (safeFilter === "all") return list;

  const projectModel = (model: any) => {
    const slicedUsage = Number(model?.billingModeTokenTotals?.[safeFilter] || 0);
    if (model?.billingMode !== safeFilter && slicedUsage <= 0) return null;
    const originalUsage = Math.max(0, Number(model?.usage) || 0);
    const usage = slicedUsage > 0 ? slicedUsage : originalUsage;
    const slicedCost = toFiniteNumber(model?.billingModeCostTotals?.[safeFilter]);
    const cost = slicedUsage > 0 ? slicedCost : model?.cost;
    return { ...model, usage, cost, billingMode: safeFilter };
  };

  return list
    .map((entry: any) => {
      const filteredModels = (Array.isArray(entry?.models) ? entry.models : [])
        .map(projectModel)
        .filter(Boolean);
      if (!filteredModels.length) return null;
      const filteredUsage = filteredModels.reduce(
        (acc: number, model: any) => acc + (Number(model?.usage) || 0),
        0,
      );
      const hasCompleteCost = filteredModels.every((model: any) => (
        model?.cost !== null
        && model?.cost !== undefined
        && Number.isFinite(Number(model.cost))
      ));
      const filteredCost = hasCompleteCost
        ? filteredModels.reduce((acc: number, model: any) => acc + Number(model.cost), 0)
        : null;
      // Recompute per-model share against the filtered source usage so a
      // provider card still shows relative weights for what survived the
      // filter. The caller will scale totalPercent against the filtered
      // grand total below.
      const recomputedModels = filteredModels.map((model: any) => ({
        ...model,
        share:
          filteredUsage > 0
            ? Math.round(((Number(model?.usage) || 0) / filteredUsage) * 1000) / 10
            : 0,
      }));
      return {
        ...entry,
        usage: filteredUsage,
        usd: filteredCost,
        models: recomputedModels,
      };
    })
    .filter(Boolean)
    .map((entry: any) => {
      // totalPercent against the filtered grand total (across ALL sources,
      // not just this one) so the rendered numbers stay internally
      // consistent with whatever the user actually sees.
      const filteredGrand = list.reduce((acc: number, source: any) => {
        const sourceFiltered = (Array.isArray(source?.models) ? source.models : [])
          .map(projectModel)
          .filter(Boolean);
        return acc + sourceFiltered.reduce((s: number, m: any) => s + (Number(m?.usage) || 0), 0);
      }, 0);
      const totalPercentRaw = filteredGrand > 0 ? (entry.usage / filteredGrand) * 100 : 0;
      return {
        ...entry,
        totalPercent: Number.isFinite(totalPercentRaw) ? totalPercentRaw.toFixed(1) : "0.0",
      };
    });
}

export { normalizeBillingFilterValue };

export function buildTopModels(modelBreakdown: any, { limit = 3, copyFn }: AnyRecord = {}) {
  const safeCopy = typeof copyFn === "function" ? copyFn : (key: string) => key;
  const sources: any[] = Array.isArray(modelBreakdown?.sources) ? modelBreakdown.sources : [];
  if (!sources.length) return [];

  const totalsByKey = new Map();
  const nameByKey = new Map();
  const nameWeight = new Map();
  let totalTokensAll = 0;

  for (const source of sources) {
    const models: any[] = Array.isArray(source?.models) ? source.models : [];
    for (const model of models) {
      const tokens = resolveDisplayTokens(model?.totals);
      if (!Number.isFinite(tokens) || tokens <= 0) continue;
      totalTokensAll += tokens;
      const name = resolveModelName(model, safeCopy("data.confidence.unattributed"));
      const key = normalizeModelId(name);
      if (!key) continue;
      totalsByKey.set(key, (totalsByKey.get(key) || 0) + tokens);
      const currentWeight = nameWeight.get(key) || 0;
      if (tokens >= currentWeight) {
        nameWeight.set(key, tokens);
        nameByKey.set(key, name);
      }
    }
  }

  if (!totalsByKey.size) return [];

  const knownTotal = Array.from(totalsByKey.values()).reduce((acc, value) => acc + value, 0);
  const totalTokens = totalTokensAll > 0 ? totalTokensAll : knownTotal;

  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3;
  return Array.from(totalsByKey.entries())
    .map(([key, tokens]) => {
      const percent = totalTokens > 0 ? ((tokens / totalTokens) * 100).toFixed(1) : "0.0";
      return {
        id: key,
        name: nameByKey.get(key) || safeCopy("data.confidence.unattributed"),
        tokens,
        percent: String(percent),
      };
    })
    .sort((a, b) => {
      if (b.tokens !== a.tokens) return b.tokens - a.tokens;
      return String(a.name).localeCompare(String(b.name));
    })
    .slice(0, normalizedLimit);
}

export function buildModelUsageDistribution(
  modelBreakdown: any,
  { limit = 5, otherLabel = "Other", copyFn }: AnyRecord = {},
) {
  const allModels = buildTopModels(modelBreakdown, {
    limit: Number.MAX_SAFE_INTEGER,
    copyFn,
  });
  const totalTokens = allModels.reduce((sum: number, model: AnyRecord) => sum + (Number(model.tokens) || 0), 0);
  if (totalTokens <= 0) return { totalTokens: 0, rows: [] };

  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 5;
  const visible = allModels.slice(0, normalizedLimit);
  const overflowTokens = allModels
    .slice(normalizedLimit)
    .reduce((sum: number, model: AnyRecord) => sum + (Number(model.tokens) || 0), 0);
  const rows: AnyRecord[] = visible.map((model: AnyRecord) => ({
    ...model,
    percent: Number(((Number(model.tokens) / totalTokens) * 100).toFixed(1)),
  }));

  if (overflowTokens > 0) {
    rows.push({
      id: "other-models",
      name: otherLabel,
      tokens: overflowTokens,
      percent: Number(((overflowTokens / totalTokens) * 100).toFixed(1)),
    });
  }

  return { totalTokens, rows };
}
