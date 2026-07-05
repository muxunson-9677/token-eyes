import { LIMIT_PROVIDER_IDS } from "./limits-providers.js";

const ZERO_COST_ROW = Object.freeze({
  api_usd: 0,
  subscription_usd: 0,
  combined_usd: 0,
});

function normalizeSource(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Normalize a list of provider IDs: lowercase, dedupe, drop unknown IDs,
 * and preserve the input order for known ones.
 *
 * @param {string[]|null|undefined} ids - Raw provider IDs from settings or filters.
 * @returns {string[]} Normalized list of known provider IDs (empty if input is empty/invalid).
 */
export function normalizeVisibleProviderIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const known = new Set(LIMIT_PROVIDER_IDS);
  const result = [];
  for (const id of ids) {
    const normalized = normalizeSource(id);
    if (known.has(normalized) && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

/**
 * Compute the intersection of user-selected sources with the visible allowlist.
 * When selectedSources is null/undefined, returns the full allowlist (no user filter).
 *
 * @param {string[]|null} selectedSources - User-selected source filter (from UsageFiltersContext).
 * @param {string[]|null|undefined} visibleProviderIds - Allowlist from display settings.
 * @returns {string[]} Intersection of selected + visible, in visible order.
 */
export function intersectVisibleSources(selectedSources, visibleProviderIds) {
  const visible = normalizeVisibleProviderIds(visibleProviderIds);
  if (!Array.isArray(selectedSources)) return visible;
  const selected = new Set(selectedSources.map(normalizeSource));
  return visible.filter((source) => selected.has(source));
}

/**
 * Filter a list of source options (e.g. for SourceFilter dropdown) to only
 * include those in the visible allowlist, preserving allowlist order.
 *
 * @param {Array<{source: string}>} options - Raw options from provider stats API.
 * @param {string[]|null|undefined} visibleProviderIds - Allowlist from display settings.
 * @returns {Array<{source: string}>} Filtered options in allowlist order.
 */
export function filterVisibleSourceOptions(options, visibleProviderIds) {
  const visible = normalizeVisibleProviderIds(visibleProviderIds);
  if (visible.length === 0) return [];
  if (!Array.isArray(options)) return [];
  const bySource = new Map(
    options.map((row) => [normalizeSource(row.source), row]),
  );
  return visible
    .map((source) => bySource.get(source))
    .filter(Boolean);
}

/**
 * Reconcile the current filter selections when the visible allowlist changes.
 * If any agent/source selection becomes entirely hidden, clear all filters.
 * Otherwise, keep the intersection; when sources change, also clear models.
 *
 * @param {{agentIds?: string[]|null, sources?: string[]|null, models?: string[]|null}} filters - Current filter state.
 * @param {string[]|null|undefined} visibleProviderIds - New allowlist from display settings.
 * @returns {{agentIds: string[]|null, sources: string[]|null, models: string[]|null}} Reconciled filter state.
 */
export function reconcileVisibleUsageFilters(filters, visibleProviderIds) {
  const visible = normalizeVisibleProviderIds(visibleProviderIds);
  if (visible.length === 0) {
    return { agentIds: null, sources: null, models: null };
  }

  const agentIds = Array.isArray(filters?.agentIds) && filters.agentIds.length > 0
    ? intersectVisibleSources(filters.agentIds, visible)
    : null;
  const sources = Array.isArray(filters?.sources) && filters.sources.length > 0
    ? intersectVisibleSources(filters.sources, visible)
    : null;

  // If agent selection becomes empty after intersection, clear everything.
  if (Array.isArray(filters?.agentIds) && filters.agentIds.length > 0 && (agentIds === null || agentIds.length === 0)) {
    return { agentIds: null, sources: null, models: null };
  }

  // If source selection becomes empty after intersection, clear everything.
  if (Array.isArray(filters?.sources) && filters.sources.length > 0 && (sources === null || sources.length === 0)) {
    return { agentIds: null, sources: null, models: null };
  }

  // When sources changed (intersection differs from original), clear models.
  const sourcesChanged = Array.isArray(filters?.sources) && filters.sources.length > 0 &&
    (sources === null || sources.length !== filters.sources.length || !sources.every((s, i) => s === filters.sources[i]));

  const models = sourcesChanged ? null : filters?.models;

  return { agentIds, sources, models };
}

export function filterProviderRows(rows, visibleProviderIds) {
  const bySource = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [normalizeSource(row.source), row]),
  );

  return visibleProviderIds.map((source) => {
    const row = bySource.get(source);
    return row
      ? { ...ZERO_COST_ROW, ...row, source }
      : { source, ...ZERO_COST_ROW };
  });
}

export function filterSpendTimeseries(timeseries, visibleProviderIds) {
  const visible = new Set(visibleProviderIds);
  const source = timeseries && typeof timeseries === "object" ? timeseries : {};
  return {
    ...source,
    sources: visibleProviderIds,
    series: (Array.isArray(source.series) ? source.series : []).filter(
      (row) => visible.has(normalizeSource(row.source)),
    ),
    by_source: filterProviderRows(source.by_source, visibleProviderIds),
  };
}
