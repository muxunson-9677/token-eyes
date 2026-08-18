import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getProviderApiConfigs,
  getProviderApiBalances,
  refreshProviderApiBalance,
  refreshOfficialConsoleProviderBalance,
} from "../lib/api";
import { readCostSettingsSessionCache, writeCostSettingsSessionCache } from "../lib/cost-settings-session-cache";

/**
 * useProviderApiBalances — 03-ia-api-balance cost-accumulation data hook.
 *
 * Backed by the 02 endpoints. Display contract:
 * - On mount: read cached balances (instant paint) then refresh every enabled
 *   config that has an apiKeyRef once.
 * - Polling: a single timer at MIN(refreshIntervalSeconds) across enabled+
 *   keyed configs, clamped to >= 60s. Default 300s when there are none.
 * - Manual refresh: refreshAll() + refreshOne(configId), dedup'd per config so
 *   repeat clicks during an in-flight request are no-ops.
 * - On unmount: timer cleared + a cancelled flag prevents stale state updates.
 * - Network failure: the last successful balance for a config is kept and the
 *   whole set is marked `stale` so the UI can show a "data may be stale"
 *   notice. A config with no prior balance renders "—" (never 0).
 *
 * This hook NEVER touches API Keys — it only reads financial results.
 */

const MIN_INTERVAL_MS = 60_000;
const DEFAULT_INTERVAL_MS = 300_000;

function isRefreshableConfig(config) {
  return Boolean(
    config
    && config.enabled
    && (config.apiKeyRef || config.authType === "official_console")
  );
}

function clampInterval(ms) {
  // Invalid/zero → use the default. Below the 60s floor → clamp UP to the
  // minimum (NOT the default): the contract is "minimum 60s, default 300s",
  // so a config asking for 30s polls at 60s, not 300s.
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_INTERVAL_MS;
  if (ms < MIN_INTERVAL_MS) return MIN_INTERVAL_MS;
  return Math.min(ms, 86_400_000);
}

function pickPollInterval(configs) {
  if (!Array.isArray(configs) || configs.length === 0) return DEFAULT_INTERVAL_MS;
  const enabled = configs.filter(isRefreshableConfig);
  if (enabled.length === 0) return DEFAULT_INTERVAL_MS;
  let min = Infinity;
  for (const c of enabled) {
    const s = Number(c.refreshIntervalSeconds);
    if (Number.isFinite(s) && s > 0) min = Math.min(min, s * 1000);
  }
  if (!Number.isFinite(min)) return DEFAULT_INTERVAL_MS;
  return clampInterval(min);
}

function deriveAggregateStale(configs, balances, accountRefreshStates) {
  const enabled = configs.filter(isRefreshableConfig);
  if (enabled.length === 0) return false;
  const balancesByConfig = new Map(balances.map((balance) => [balance.configId, balance]));
  return enabled.some((config) => {
    const refreshStatus = accountRefreshStates[config.id];
    if (refreshStatus && refreshStatus !== "pending") return refreshStatus !== "synced";
    return balancesByConfig.get(config.id)?.status !== "synced";
  });
}

function markBalanceStale(balances, configId, failureBalance = null) {
  const failure = failureBalance && typeof failureBalance === "object" ? failureBalance : {};
  const diagnostic = Object.fromEntries(Object.entries(failure).filter(([key]) => ![
    "accountLabel",
    "balance",
    "configId",
    "currency",
    "lastSyncedAt",
    "lifetimeSpend",
    "monthSpend",
    "providerId",
    "status",
  ].includes(key)));
  const index = balances.findIndex((item) => item.configId === configId);
  if (index < 0) {
    if (Object.keys(failure).length === 0) return balances;
    return [...balances, {
      ...(failure.configId ? { configId: failure.configId } : { configId }),
      ...(failure.providerId ? { providerId: failure.providerId } : {}),
      ...(failure.accountLabel ? { accountLabel: failure.accountLabel } : {}),
      ...diagnostic,
      status: "stale",
    }];
  }
  const current = balances[index];
  const hasConfirmedSnapshot = current.status === "synced"
    || current.balance != null
    || current.monthSpend != null
    || current.lifetimeSpend != null
    || Boolean(current.lastSyncedAt);
  if (!hasConfirmedSnapshot && Object.keys(failure).length === 0) return balances;
  return balances.map((item, itemIndex) => (
    itemIndex === index ? { ...item, ...diagnostic, status: "stale" } : item
  ));
}

function loadFailureMessage(scope, settled) {
  if (settled.status === "rejected") {
    return settled.reason?.message || `Unable to load provider ${scope}`;
  }
  return settled.value?.error || settled.value?.message || `Unable to load provider ${scope}`;
}

function combineLoadErrors(loadErrors) {
  const messages = [loadErrors.configs, loadErrors.balances].filter(Boolean);
  return messages.length > 0 ? messages.join("; ") : null;
}

export function useProviderApiBalances() {
  const cachedSnapshot = useRef(readCostSettingsSessionCache("provider-api-balances")).current;
  const cachedLoadErrors = cachedSnapshot?.loadErrors || {};
  const [configs, setConfigs] = useState(cachedSnapshot?.configs || []);
  const [balances, setBalances] = useState(cachedSnapshot?.balances || []);
  const [accountRefreshStates, setAccountRefreshStates] = useState({});
  const [refreshingIds, setRefreshingIds] = useState(() => new Set());
  const [lastUpdatedAt, setLastUpdatedAt] = useState(cachedSnapshot?.lastUpdatedAt || null);
  const [loadErrors, setLoadErrors] = useState(cachedLoadErrors);
  const [cachedStale, setCachedStale] = useState(Boolean(cachedSnapshot?.stale));
  const [loading, setLoading] = useState(!cachedSnapshot);

  const cancelledRef = useRef(false);
  const generationRef = useRef(0);
  const inFlightRef = useRef(new Map());
  const loadRequestRef = useRef(0);
  const configsRef = useRef(cachedSnapshot?.configs || []);
  const accountRefreshStatesRef = useRef({});
  const loadErrorsRef = useRef(cachedLoadErrors);
  const hasAuthoritativeConfigsRef = useRef(false);
  const error = useMemo(() => combineLoadErrors(loadErrors), [loadErrors]);
  const stale = useMemo(
    () => cachedStale || Boolean(error) || deriveAggregateStale(configs, balances, accountRefreshStates),
    [accountRefreshStates, balances, cachedStale, configs, error],
  );

  const updateLoadErrors = useCallback((next) => {
    loadErrorsRef.current = next;
    setLoadErrors(next);
  }, []);

  const updateAccountRefreshState = useCallback((configId, status) => {
    const next = { ...accountRefreshStatesRef.current, [configId]: status };
    accountRefreshStatesRef.current = next;
    setAccountRefreshStates(next);
    return next;
  }, []);

  const clearRecoveredStaleWhenCovered = useCallback((refreshStates) => {
    const required = configsRef.current.filter(isRefreshableConfig);
    if (required.length === 0 || required.some((config) => refreshStates[config.id] !== "synced")) return;
    setCachedStale(false);
    if (
      !loadErrorsRef.current.balances
      || loadErrorsRef.current.configs
      || !hasAuthoritativeConfigsRef.current
    ) return;
    updateLoadErrors({ ...loadErrorsRef.current, balances: null });
  }, [updateLoadErrors]);

  const setRefreshing = useCallback((id, on) => {
    setRefreshingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const loadCached = useCallback(async () => {
    const loadRequest = loadRequestRef.current + 1;
    loadRequestRef.current = loadRequest;
    try {
      const [cfgSettled, balSettled] = await Promise.allSettled([
        getProviderApiConfigs(),
        getProviderApiBalances(),
      ]);
      if (cancelledRef.current || loadRequest !== loadRequestRef.current) return false;
      const cfgResult = cfgSettled.status === "fulfilled" ? cfgSettled.value : null;
      const balResult = balSettled.status === "fulfilled" ? balSettled.value : null;
      const configsLoaded = cfgResult?.ok === true && Array.isArray(cfgResult?.data?.configs);
      const balancesLoaded = balResult?.ok === true && Array.isArray(balResult?.data?.balances);
      generationRef.current += 1;
      if (configsLoaded) {
        const nextConfigs = cfgResult.data.configs;
        const configIds = new Set(nextConfigs.map((config) => config.id));
        hasAuthoritativeConfigsRef.current = true;
        configsRef.current = nextConfigs;
        setConfigs(nextConfigs);
        if (!balancesLoaded) setBalances((previous) => previous.filter((balance) => configIds.has(balance.configId)));
      } else {
        hasAuthoritativeConfigsRef.current = false;
      }
      if (balancesLoaded) {
        const configIds = configsLoaded
          ? new Set(cfgResult.data.configs.map((config) => config.id))
          : null;
        setBalances(configIds
          ? balResult.data.balances.filter((balance) => configIds.has(balance.configId))
          : balResult.data.balances);
      }
      accountRefreshStatesRef.current = {};
      setAccountRefreshStates({});
      setRefreshingIds(new Set());
      setCachedStale(false);
      const nextLoadErrors = {
        configs: configsLoaded ? null : loadFailureMessage("configs", cfgSettled),
        balances: balancesLoaded ? null : loadFailureMessage("balances", balSettled),
      };
      updateLoadErrors(nextLoadErrors);
      if (configsLoaded && balancesLoaded) {
        setLastUpdatedAt(new Date().toISOString());
      }
      return true;
    } catch (err) {
      if (cancelledRef.current || loadRequest !== loadRequestRef.current) return false;
      const message = err?.message || "Unable to load provider balances";
      updateLoadErrors({ configs: message, balances: message });
      return true;
    } finally {
      if (!cancelledRef.current && loadRequest === loadRequestRef.current) setLoading(false);
    }
  }, [updateLoadErrors]);

  const refreshOne = useCallback(async (configId, expectedGeneration = generationRef.current) => {
    if (!configId) return;
    if (expectedGeneration !== generationRef.current) return;
    const config = configsRef.current.find((item) => item.id === configId);
    if (!config?.enabled) return;
    if (inFlightRef.current.get(configId) === expectedGeneration) return; // dedup
    inFlightRef.current.set(configId, expectedGeneration);
    updateAccountRefreshState(configId, "pending");
    setRefreshing(configId, true);
    try {
      if (String(config?.authType || "").toLowerCase() === "official_console") {
        await refreshOfficialConsoleProviderBalance(config.providerId);
      }
      const result = await refreshProviderApiBalance(configId);
      if (
        cancelledRef.current
        || expectedGeneration !== generationRef.current
        || !configsRef.current.find((item) => item.id === configId)?.enabled
      ) return;
      const balance = result?.data?.balance;
      const synced = result?.ok === true && balance?.status === "synced";
      if (synced) {
        setBalances((prev) => prev.some((b) => b.configId === configId)
          ? prev.map((b) => (b.configId === configId ? balance : b))
          : [...prev, balance]);
        const nextRefreshStates = updateAccountRefreshState(configId, "synced");
        clearRecoveredStaleWhenCovered(nextRefreshStates);
        setLastUpdatedAt(new Date().toISOString());
      } else {
        setBalances((prev) => markBalanceStale(prev, configId, balance));
        updateAccountRefreshState(configId, balance ? "stale" : result?.ok ? "missing" : "error");
      }
    } catch {
      if (
        cancelledRef.current
        || expectedGeneration !== generationRef.current
        || !configsRef.current.find((item) => item.id === configId)?.enabled
      ) return;
      // Network error — keep last successful balance, mark stale (never 0).
      setBalances((prev) => markBalanceStale(prev, configId));
      updateAccountRefreshState(configId, "error");
    } finally {
      if (inFlightRef.current.get(configId) === expectedGeneration) {
        inFlightRef.current.delete(configId);
        if (!cancelledRef.current && expectedGeneration === generationRef.current) {
          setRefreshing(configId, false);
        }
      }
    }
  }, [clearRecoveredStaleWhenCovered, setRefreshing, updateAccountRefreshState]);

  const refreshAll = useCallback(async () => {
    const generation = generationRef.current;
    const enabled = configsRef.current.filter(isRefreshableConfig);
    if (enabled.length === 0) return;
    await Promise.all(enabled.map((c) => refreshOne(c.id, generation)));
  }, [refreshOne]);

  // F4: reload() re-reads cached configs + balances then refreshes all
  // enabled+keyed configs. Used by the settings section after CRUD so the
  // card list and financial data stay in sync without a parallel data flow.
  const reload = useCallback(async () => {
    const loadedCurrent = await loadCached();
    if (cancelledRef.current || !loadedCurrent) return;
    await refreshAll();
  }, [loadCached, refreshAll]);

  // On mount: load cached, then refresh all enabled+keyed configs once.
  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      const loadedCurrent = await loadCached();
      if (cancelledRef.current || !loadedCurrent) return;
      const generation = generationRef.current;
      const enabled = configsRef.current.filter(isRefreshableConfig);
      await Promise.all(enabled.map((c) => refreshOne(c.id, generation)));
    })();
    return () => {
      cancelledRef.current = true;
      generationRef.current += 1;
      loadRequestRef.current += 1;
      inFlightRef.current.clear();
    };
  }, [loadCached, refreshOne]);

  // Polling timer at the clamped min interval. Re-arms when configs change.
  useEffect(() => {
    const intervalMs = pickPollInterval(configs);
    if (intervalMs === DEFAULT_INTERVAL_MS && configs.length === 0) {
      // No configs yet — don't spin a timer until we know the real interval.
      return;
    }
    const timer = window.setInterval(() => {
      if (cancelledRef.current) return;
      refreshAll();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [configs, refreshAll]);

  useEffect(() => {
    if (!loading) {
      writeCostSettingsSessionCache("provider-api-balances", {
        configs,
        balances,
        stale,
        loadErrors,
        lastUpdatedAt,
      });
    }
  }, [balances, configs, lastUpdatedAt, loadErrors, loading, stale]);

  return {
    configs,
    balances,
    refreshingIds,
    refreshing: refreshingIds.size > 0,
    stale,
    lastUpdatedAt,
    error,
    loading,
    refreshAll,
    refreshOne,
    reload,
  };
}
