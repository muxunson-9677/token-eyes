import { useCallback, useEffect, useRef, useState } from "react";
import {
  getProviderApiConfigs,
  getProviderApiBalances,
  refreshProviderApiBalance,
  refreshOfficialConsoleProviderBalance,
} from "../lib/api";

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

export function useProviderApiBalances() {
  const [configs, setConfigs] = useState([]);
  const [balances, setBalances] = useState([]);
  const [refreshingIds, setRefreshingIds] = useState(() => new Set());
  const [stale, setStale] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const cancelledRef = useRef(false);
  const inFlightRef = useRef(new Set());
  const configsRef = useRef([]);

  const setRefreshing = useCallback((id, on) => {
    setRefreshingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const loadCached = useCallback(async () => {
    try {
      const [cfgResult, balResult] = await Promise.all([
        getProviderApiConfigs(),
        getProviderApiBalances(),
      ]);
      if (cancelledRef.current) return;
      const nextConfigs = Array.isArray(cfgResult?.data?.configs) ? cfgResult.data.configs : [];
      const nextBalances = Array.isArray(balResult?.data?.balances) ? balResult.data.balances : [];
      configsRef.current = nextConfigs;
      setConfigs(nextConfigs);
      setBalances(nextBalances);
      setLastUpdatedAt(new Date().toISOString());
      setStale(false);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err?.message || "Unable to load provider balances");
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  const refreshOne = useCallback(async (configId) => {
    if (!configId) return;
    if (inFlightRef.current.has(configId)) return; // dedup
    inFlightRef.current.add(configId);
    setRefreshing(configId, true);
    try {
      const config = configsRef.current.find((item) => item.id === configId);
      if (String(config?.authType || "").toLowerCase() === "official_console") {
        await refreshOfficialConsoleProviderBalance(config.providerId);
      }
      const result = await refreshProviderApiBalance(configId);
      if (cancelledRef.current) return;
      const balance = result?.data?.balance;
      if (balance) {
        setBalances((prev) => prev.some((b) => b.configId === configId)
          ? prev.map((b) => (b.configId === configId ? balance : b))
          : [...prev, balance]);
        const synced = balance.status === "synced";
        setStale(!synced);
        if (synced) setLastUpdatedAt(new Date().toISOString());
      } else if (!result?.ok) {
        // HTTP-level failure: keep last balance, mark stale.
        setBalances((prev) => prev.map((item) => (
          item.configId === configId ? { ...item, status: "stale" } : item
        )));
        setStale(true);
      }
    } catch {
      if (cancelledRef.current) return;
      // Network error — keep last successful balance, mark stale (never 0).
      setBalances((prev) => prev.map((item) => (
        item.configId === configId ? { ...item, status: "stale" } : item
      )));
      setStale(true);
    } finally {
      inFlightRef.current.delete(configId);
      if (!cancelledRef.current) setRefreshing(configId, false);
    }
  }, [setRefreshing]);

  const refreshAll = useCallback(async () => {
    const enabled = configsRef.current.filter(isRefreshableConfig);
    if (enabled.length === 0) return;
    await Promise.all(enabled.map((c) => refreshOne(c.id)));
  }, [refreshOne]);

  // F4: reload() re-reads cached configs + balances then refreshes all
  // enabled+keyed configs. Used by the settings section after CRUD so the
  // card list and financial data stay in sync without a parallel data flow.
  const reload = useCallback(async () => {
    await loadCached();
    if (cancelledRef.current) return;
    await refreshAll();
  }, [loadCached, refreshAll]);

  // On mount: load cached, then refresh all enabled+keyed configs once.
  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      await loadCached();
      if (cancelledRef.current) return;
      const enabled = configsRef.current.filter(isRefreshableConfig);
      await Promise.all(enabled.map((c) => refreshOne(c.id)));
    })();
    return () => {
      cancelledRef.current = true;
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
