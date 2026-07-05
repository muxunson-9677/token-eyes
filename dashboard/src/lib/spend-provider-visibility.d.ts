/**
 * Type declarations for spend-provider-visibility.js
 */

/**
 * Normalize a list of provider IDs: lowercase, dedupe, drop unknown IDs,
 * and preserve the input order for known ones.
 */
export function normalizeVisibleProviderIds(ids: string[] | null | undefined): string[];

/**
 * Compute the intersection of user-selected sources with the visible allowlist.
 * When selectedSources is null/undefined, returns the full allowlist (no user filter).
 */
export function intersectVisibleSources(
  selectedSources: string[] | null | undefined,
  visibleProviderIds: string[] | null | undefined
): string[];

/**
 * Filter a list of source options (e.g. for SourceFilter dropdown) to only
 * include those in the visible allowlist, preserving allowlist order.
 */
export function filterVisibleSourceOptions<T extends { source: string; source_display_name?: string }>(
  options: T[],
  visibleProviderIds: string[] | null | undefined
): T[];

/**
 * Reconcile the current filter selections when the visible allowlist changes.
 */
export function reconcileVisibleUsageFilters(
  filters: {
    agentIds?: string[] | null;
    sources?: string[] | null;
    models?: string[] | null;
  },
  visibleProviderIds: string[] | null | undefined
): {
  agentIds: string[] | null;
  sources: string[] | null;
  models: string[] | null;
};

export interface ProviderRow {
  source: string;
  api_usd?: number;
  subscription_usd?: number;
  combined_usd?: number;
}

export function filterProviderRows(
  rows: ProviderRow[],
  visibleProviderIds: string[]
): ProviderRow[];

export interface SpendTimeseries {
  sources?: string[];
  series?: Array<{ source: string; [key: string]: unknown }>;
  by_source?: ProviderRow[];
}

export function filterSpendTimeseries(
  timeseries: SpendTimeseries,
  visibleProviderIds: string[]
): SpendTimeseries;