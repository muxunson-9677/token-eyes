import React, { useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimeRange = "today" | "1d" | "7d" | "14d" | "30d" | "custom";
export type RefreshInterval = "30s" | "1m" | "5m" | "manual";

export interface UsageFilters {
  /** null = "all agents" (no filter). */
  agentIds: string[] | null;
  /** null = "all sources" (no filter). */
  sources: string[] | null;
  /** null = "all models" (no filter). */
  models: string[] | null;
  timeRange: TimeRange;
  /** ISO date string when timeRange === "custom"; null otherwise. */
  from: string | null;
  /** ISO date string when timeRange === "custom"; null otherwise. */
  to: string | null;
  refreshInterval: RefreshInterval;
}

type FilterAction =
  | { type: "SET_AGENT_IDS"; agentIds: string[] | null }
  | { type: "SET_SOURCES"; sources: string[] | null }
  | { type: "SET_MODELS"; models: string[] | null }
  | { type: "SET_TIME_RANGE"; timeRange: TimeRange; from?: string; to?: string }
  | { type: "SET_REFRESH_INTERVAL"; refreshInterval: RefreshInterval }
  | { type: "RESET" };

interface UsageFiltersContextValue {
  state: UsageFilters;
  dispatch: React.Dispatch<FilterAction>;
  /** Count of active (non-default) filter dimensions, for badge display. */
  activeFilterCount: number;
  /** Incrementing revision to trigger data refresh across all usage hooks. */
  refreshRevision: number;
  /** Request a refresh of all usage data. */
  requestRefresh: () => void;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const DEFAULT_STATE: UsageFilters = {
  agentIds: null,
  sources: null,
  models: null,
  timeRange: "30d",
  from: null,
  to: null,
  refreshInterval: "1m",
};

function reducer(state: UsageFilters, action: FilterAction): UsageFilters {
  switch (action.type) {
    case "SET_AGENT_IDS":
      // Cascade: changing agents invalidates the source + model selections
      // (they belonged to the previous agent's universe).
      return { ...state, agentIds: action.agentIds, sources: null, models: null };
    case "SET_SOURCES":
      // Cascade: changing sources invalidates the model selection.
      return { ...state, sources: action.sources, models: null };
    case "SET_MODELS":
      return { ...state, models: action.models };
    case "SET_TIME_RANGE":
      return {
        ...state,
        timeRange: action.timeRange,
        from: action.from ?? null,
        to: action.to ?? null,
      };
    case "SET_REFRESH_INTERVAL":
      return { ...state, refreshInterval: action.refreshInterval };
    case "RESET":
      return DEFAULT_STATE;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const UsageFiltersContext = React.createContext<UsageFiltersContextValue | null>(null);

export function UsageFiltersProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, DEFAULT_STATE);
  const [refreshRevision, requestRefresh] = React.useReducer(
    (current: number) => current + 1,
    0,
  );
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (state.agentIds && state.agentIds.length > 0) n += 1;
    if (state.sources && state.sources.length > 0) n += 1;
    if (state.models && state.models.length > 0) n += 1;
    if (state.timeRange !== "30d") n += 1;
    return n;
  }, [state]);
  const value = useMemo(
    () => ({ state, dispatch, activeFilterCount, refreshRevision, requestRefresh }),
    [state, activeFilterCount, refreshRevision],
  );
  return (
    <UsageFiltersContext.Provider value={value}>
      {children}
    </UsageFiltersContext.Provider>
  );
}

export function useUsageFilters(): UsageFiltersContextValue {
  const ctx = React.useContext(UsageFiltersContext);
  if (!ctx) {
    throw new Error("useUsageFilters must be used within a UsageFiltersProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Convenience selectors
// ---------------------------------------------------------------------------

/** Returns filter params shaped for the api.ts fetch functions (undefined
 *  when the filter is null, so the backend treats it as "no filter"). */
export function useUsageFilterParams() {
  const { state } = useUsageFilters();
  return useMemo(
    () => ({
      sources: state.sources ?? undefined,
      models: state.models ?? undefined,
      agentIds: state.agentIds ?? undefined,
      from: state.from ?? undefined,
      to: state.to ?? undefined,
    }),
    [state.sources, state.models, state.agentIds, state.from, state.to],
  );
}

/** Build a stable cache-key suffix from the active filters so data hooks
 *  invalidate their cache when filters change. */
export function useUsageFilterCacheKey() {
  const { state } = useUsageFilters();
  return useMemo(() => {
    const join = (v: string[] | null) => (v && v.length > 0 ? v.join(",") : "all");
    return `${join(state.sources)}|${join(state.models)}|${join(state.agentIds)}`;
  }, [state.sources, state.models, state.agentIds]);
}

/** Action creators bound to dispatch — convenience for components that
 *  don't want to destructure { state, dispatch }. */
export function useUsageFilterActions() {
  const { dispatch } = useUsageFilters();
  return useMemo(
    () => ({
      setAgentIds: (agentIds: string[] | null) => dispatch({ type: "SET_AGENT_IDS", agentIds }),
      setSources: (sources: string[] | null) => dispatch({ type: "SET_SOURCES", sources }),
      setModels: (models: string[] | null) => dispatch({ type: "SET_MODELS", models }),
      setTimeRange: (timeRange: TimeRange, from?: string, to?: string) =>
        dispatch({ type: "SET_TIME_RANGE", timeRange, from, to }),
      setRefreshInterval: (refreshInterval: RefreshInterval) =>
        dispatch({ type: "SET_REFRESH_INTERVAL", refreshInterval }),
      resetFilters: () => dispatch({ type: "RESET" }),
    }),
    [dispatch],
  );
}
