import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, Clock3, CloudOff, Grid2X2, HardDrive, List, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { clearLocalData, getAllAgentEnvironments, getUsageSummary, triggerLocalSync } from "../lib/api";
import { copy, getCopyLocale } from "../lib/copy";
import { safeWriteClipboard } from "../lib/safe-browser";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";

function healthState(source) {
  if (source?.trackingReady || source?.status === "ready") return "ready";
  if (source?.status === "detected") return "no-logs";
  return "unavailable";
}

function healthCopyKey(source, state) {
  if (source?.evidence === "encrypted_database") return "data_sources.health.protected";
  if (source?.evidence === "session_database") return "data_sources.health.limited";
  return `data_sources.health.${state.replaceAll("-", "_")}`;
}

function evidenceNoticeKey(source) {
  if (source?.evidence === "encrypted_database") return "data_sources.notice.encrypted_database";
  if (source?.evidence === "session_database") return "data_sources.notice.session_database";
  return null;
}

function formatTime(value) {
  if (!value) return copy("data_sources.never");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return copy("data_sources.never");
  return new Intl.DateTimeFormat(getCopyLocale(), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatActivityTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return copy("data_sources.not_detected");
  return formatTime(value);
}

function isProvidedNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function formatPercent(value, total) {
  if (!isProvidedNumber(value) || !isProvidedNumber(total)) {
    return null;
  }
  const numerator = Number(value);
  const denominator = Number(total);
  if (denominator <= 0) {
    return null;
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function formatDataSourceError(error, fallbackKey) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/local cli not reachable|failed to fetch|networkerror/i.test(message)) {
    return copy("data_sources.error.local_service_unreachable");
  }
  return message || copy(fallbackKey);
}

const DATA_SOURCE_CACHE_KEY = "token-eyes:data-source-health:v1";

function readDataSourceCache() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DATA_SOURCE_CACHE_KEY) || "null");
    if (!parsed || !Array.isArray(parsed.sources)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDataSourceCache(payload) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DATA_SOURCE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable in privacy mode; current-session data still works.
  }
}

export function DataSourcesPage() {
  const [initialCache] = useState(readDataSourceCache);
  const [sources, setSources] = useState(() => initialCache?.sources || []);
  const [loading, setLoading] = useState(() => !initialCache);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [ledgerSummary, setLedgerSummary] = useState(() => initialCache?.ledgerSummary || null);
  const [lastCheckedAt, setLastCheckedAt] = useState(() => initialCache?.updatedAt || "");
  const [ledgerError, setLedgerError] = useState("");
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearCompleted, setClearCompleted] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceEnvironment, setSourceEnvironment] = useState("all");
  const [sourceSort, setSourceSort] = useState("activity");
  const [sourceView, setSourceView] = useState("grid");

  const loadHealth = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    setError("");
    setLedgerError("");
    const today = new Date().toISOString().slice(0, 10);
    const [healthResult, ledgerResult] = await Promise.allSettled([
      getAllAgentEnvironments(),
      getUsageSummary({ from: "1970-01-01", to: today }),
    ]);
    if (healthResult.status === "fulfilled") {
      setSources(Array.isArray(healthResult.value?.results) ? healthResult.value.results : []);
    } else {
      setError(formatDataSourceError(healthResult.reason, "data_sources.load_error"));
    }
    if (ledgerResult.status === "fulfilled") {
      setLedgerSummary(ledgerResult.value || null);
    } else {
      setLedgerError(ledgerResult.reason?.message || copy("data_sources.ledger.load_error"));
    }
    if (healthResult.status === "fulfilled" && ledgerResult.status === "fulfilled") {
      const updatedAt = new Date().toISOString();
      setLastCheckedAt(updatedAt);
      writeDataSourceCache({
        sources: Array.isArray(healthResult.value?.results) ? healthResult.value.results : [],
        ledgerSummary: ledgerResult.value || null,
        updatedAt,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadHealth({ showLoading: !initialCache });
  }, [initialCache, loadHealth]);

  const counts = useMemo(() => sources.reduce((result, source) => {
    result[healthState(source)] += 1;
    return result;
  }, { ready: 0, "no-logs": 0, unavailable: 0 }), [sources]);
  const sourceTotal = sources.length;
  const sourceEnvironments = useMemo(() => [...new Set(sources
    .map((source) => source.environment)
    .filter(Boolean))].sort(), [sources]);
  const displayedSources = useMemo(() => {
    const query = sourceQuery.trim().toLocaleLowerCase(getCopyLocale());
    return sources
      .filter((source) => sourceFilter === "all" || healthState(source) === sourceFilter)
      .filter((source) => sourceEnvironment === "all" || source.environment === sourceEnvironment)
      .filter((source) => !query || [source.agent_name, source.agent, source.environment]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase(getCopyLocale()).includes(query)))
      .sort((left, right) => {
        if (sourceSort === "name") {
          return String(left.agent_name || left.agent).localeCompare(String(right.agent_name || right.agent), getCopyLocale());
        }
        return new Date(right.latestActivityAt || 0).getTime() - new Date(left.latestActivityAt || 0).getTime();
      });
  }, [sourceEnvironment, sourceFilter, sourceQuery, sourceSort, sources]);
  const ledgerMetrics = [
    ["raw", ledgerSummary?.data_integrity?.raw_records],
    ["visible", ledgerSummary?.data_integrity?.visible_records],
    ["duplicates", ledgerSummary?.data_integrity?.duplicate_records],
    ["malformed", ledgerSummary?.data_integrity?.malformed_records],
  ].filter(([, value]) => isProvidedNumber(value));
  const totalTokens = ledgerSummary?.totals?.total_tokens;
  const unpricedTokens = ledgerSummary?.totals?.unpriced_tokens;
  const unattributedTokens = ledgerSummary?.totals?.unattributed_tokens;
  const unpricedPercent = formatPercent(unpricedTokens, totalTokens);
  const unattributedPercent = formatPercent(unattributedTokens, totalTokens);
  const visibleRecords = Number(ledgerSummary?.data_integrity?.visible_records) || 0;
  const importedRecords = Number(ledgerSummary?.data_integrity?.raw_records) || 0;
  const duplicateRecords = Number(ledgerSummary?.data_integrity?.duplicate_records) || 0;
  const malformedRecords = Number(ledgerSummary?.data_integrity?.malformed_records) || 0;
  const hasIntegrityBreakdown = !ledgerError
    && ["raw_records", "visible_records", "duplicate_records", "malformed_records"]
      .every((key) => isProvidedNumber(ledgerSummary?.data_integrity?.[key]))
    && importedRecords > 0;
  const integrityPercent = hasIntegrityBreakdown ? Math.round((visibleRecords / importedRecords) * 100) : 0;

  const syncAll = async () => {
    setSyncing(true);
    setError("");
    try {
      await triggerLocalSync();
      await loadHealth();
    } catch (syncError) {
      setError(formatDataSourceError(syncError, "data_sources.sync_error"));
    } finally {
      setSyncing(false);
    }
  };

  const copyDiagnostics = async () => {
    const payload = {
      schema: "token-eyes-data-source-diagnostics-v1",
      generated_at: new Date().toISOString(),
      sources: sources.map((source) => ({
        agent: source.agent,
        status: healthState(source),
        environment: source.environment || null,
        evidence_count: Number(source.evidenceCount) || 0,
        latest_activity_at: source.latestActivityAt || null,
      })),
      ledger: ledgerSummary ? {
        data_integrity: ledgerSummary.data_integrity || null,
        total_tokens: isProvidedNumber(ledgerSummary.totals?.total_tokens)
          ? Number(ledgerSummary.totals.total_tokens)
          : null,
        unpriced_tokens: isProvidedNumber(ledgerSummary.totals?.unpriced_tokens)
          ? Number(ledgerSummary.totals.unpriced_tokens)
          : null,
        unattributed_tokens: isProvidedNumber(ledgerSummary.totals?.unattributed_tokens)
          ? Number(ledgerSummary.totals.unattributed_tokens)
          : null,
      } : null,
    };
    if (!await safeWriteClipboard(JSON.stringify(payload, null, 2))) return;
    setDiagnosticsCopied(true);
    window.setTimeout(() => setDiagnosticsCopied(false), 2000);
  };

  const clearImportedData = async () => {
    if (!window.confirm(copy("data_sources.clear.confirm"))) return;
    setClearing(true);
    setClearCompleted(false);
    setError("");
    try {
      const result = await clearLocalData();
      if (!result?.ok) throw new Error(result?.error || copy("data_sources.clear.error"));
      setClearCompleted(true);
      await loadHealth();
    } catch (clearError) {
      setError(clearError?.message || copy("data_sources.clear.error"));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-3 sm:pb-16 sm:pt-3">
        <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6">
          <header className="mb-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{copy("data_sources.title")}</h1>
              <p className="mt-1 max-w-2xl text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("data_sources.subtitle")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copyDiagnostics} className="inline-flex min-h-10 items-center rounded-lg border border-oai-gray-300 px-3 text-sm font-semibold hover:bg-oai-gray-100 dark:border-oai-gray-700 dark:hover:bg-oai-gray-800">
                {diagnosticsCopied ? copy("data_sources.diagnostics_copied") : copy("data_sources.copy_diagnostics")}
              </button>
              <button type="button" onClick={syncAll} disabled={syncing} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-oai-brand px-4 text-sm font-semibold text-white hover:bg-oai-brand-dark disabled:opacity-50">
                <RefreshCw className={syncing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
                {syncing ? copy("data_sources.scanning") : copy("data_sources.scan_all")}
              </button>
            </div>
          </header>

          {error ? (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <section data-testid="data-health-summary" className="col-span-full mb-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { key: "ready", icon: ShieldCheck, label: copy("data_sources.summary.ready_label"), count: counts.ready, share: sourceTotal ? Math.round((counts.ready / sourceTotal) * 100) : 0, tone: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300" },
              { key: "no-logs", icon: HardDrive, label: copy("data_sources.summary.no_logs_label"), count: counts["no-logs"], share: sourceTotal ? Math.round((counts["no-logs"] / sourceTotal) * 100) : 0, tone: "text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300" },
              { key: "unavailable", icon: CircleAlert, label: copy("data_sources.summary.unavailable_label"), count: counts.unavailable, share: sourceTotal ? Math.round((counts.unavailable / sourceTotal) * 100) : 0, tone: "text-oai-gray-700 bg-oai-gray-100 dark:bg-oai-gray-800 dark:text-oai-gray-300" },
              { key: "recent", icon: Clock3, label: copy("data_sources.summary.recent_scan"), count: lastCheckedAt ? formatTime(lastCheckedAt) : copy("data_sources.never"), tone: "text-blue-700 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300" },
            ].map(({ key, icon: Icon, label, count, share, tone }) => (
              <div key={key} data-testid={`data-health-summary-${key}`} className="tt-surface-nested tt-pressable flex min-h-[68px] items-center gap-3 rounded-xl border border-oai-gray-200/80 bg-white/70 px-4 py-2 shadow-sm dark:border-oai-gray-700/80 dark:bg-oai-gray-900/50">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400">{label}</p>
                  <strong className={key === "recent" ? "mt-1 block truncate text-sm font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100 sm:text-base" : "mt-1 block truncate text-xl font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100"}>{count}</strong>
                </div>
                {share !== undefined ? <span className="shrink-0 text-xs text-oai-gray-500 dark:text-oai-gray-400">{copy("data_sources.summary.percentage", { percent: share })}</span> : null}
              </div>
            ))}
          </section>

          <section data-testid="data-source-summary" style={sourceView === "list" ? { height: "auto" } : undefined} className="tt-surface tt-pressable-group mb-4 rounded-[var(--tt-card-radius)] p-2">
            <div data-testid="data-health-toolbar" className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-oai-gray-100 pb-2 dark:border-oai-gray-800">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={copy("data_sources.title")}>
                {[
                  ["all", copy("data_sources.filters.all"), sources.length],
                  ["ready", copy("data_sources.health.ready"), counts.ready],
                  ["no-logs", copy("data_sources.health.no_logs"), counts["no-logs"]],
                  ["unavailable", copy("data_sources.health.unavailable"), counts.unavailable],
                ].map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    data-testid={`data-health-filter-${key}`}
                    onClick={() => setSourceFilter(key)}
                    aria-pressed={sourceFilter === key}
                    className={sourceFilter === key ? "rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "rounded-lg border border-oai-gray-200 px-3 py-1.5 text-xs font-medium text-oai-gray-600 hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"}
                  >
                    {label}<span className="ml-1.5 tabular-nums">{count}</span>
                  </button>
                ))}
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                <label className="relative min-w-[190px] flex-1 max-w-sm">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-oai-gray-400" aria-hidden />
                  <input data-testid="data-health-search" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder={copy("data_sources.filters.search_placeholder")} className="h-9 w-full rounded-lg border border-oai-gray-200 bg-white pl-8 pr-3 text-xs outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:focus:ring-emerald-950" />
                </label>
                <select data-testid="data-health-environment" aria-label={copy("data_sources.filters.all_environments")} value={sourceEnvironment} onChange={(event) => setSourceEnvironment(event.target.value)} className="h-9 rounded-lg border border-oai-gray-200 bg-white px-2 text-xs text-oai-gray-700 outline-none dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-200">
                  <option value="all">{copy("data_sources.filters.all_environments")}</option>
                  {sourceEnvironments.map((environment) => <option key={environment} value={environment}>{environment}</option>)}
                </select>
                <select data-testid="data-health-sort" aria-label={copy("data_sources.filters.latest_activity")} value={sourceSort} onChange={(event) => setSourceSort(event.target.value)} className="h-9 rounded-lg border border-oai-gray-200 bg-white px-2 text-xs text-oai-gray-700 outline-none dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-200">
                  <option value="activity">{copy("data_sources.filters.latest_activity")}</option>
                  <option value="name">{copy("data_sources.filters.name")}</option>
                </select>
                <div className="flex overflow-hidden rounded-lg border border-oai-gray-200 dark:border-oai-gray-700" role="group" aria-label={copy("data_sources.title")}>
                  <button type="button" data-testid="data-health-view-grid" onClick={() => setSourceView("grid")} aria-pressed={sourceView === "grid"} title={copy("data_sources.filters.grid_view")} className={sourceView === "grid" ? "flex h-9 w-9 items-center justify-center bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "flex h-9 w-9 items-center justify-center text-oai-gray-500 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800"}><Grid2X2 className="h-4 w-4" aria-hidden /></button>
                  <button type="button" data-testid="data-health-view-list" onClick={() => setSourceView("list")} aria-pressed={sourceView === "list"} title={copy("data_sources.filters.list_view")} className={sourceView === "list" ? "flex h-9 w-9 items-center justify-center bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "flex h-9 w-9 items-center justify-center text-oai-gray-500 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800"}><List className="h-4 w-4" aria-hidden /></button>
                </div>
              </div>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-oai-gray-500">
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                {copy("data_sources.loading")}
              </div>
            ) : (
              <div data-testid="data-health-grid" data-layout={sourceView} style={sourceView === "list" ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined} className={sourceView === "grid" ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid grid-cols-1 gap-2"}>
                {displayedSources.map((source) => {
                  const state = healthState(source);
                  const noticeKey = evidenceNoticeKey(source);
                  const noticeId = noticeKey ? `data-health-${source.agent}-notice` : undefined;
                  return (
                    <article key={source.agent} data-testid={`data-source-${source.agent}`} data-health={state} style={sourceView === "list" ? { height: "auto", padding: "8px 12px" } : undefined} className={sourceView === "grid" ? "tt-surface-nested tt-pressable min-h-[88px] min-w-0 rounded-xl border border-oai-gray-200/90 bg-white/70 p-2.5 shadow-sm hover:shadow-md dark:border-oai-gray-700/90 dark:bg-oai-gray-900/50" : "tt-surface-nested tt-pressable grid min-h-[76px] grid-cols-[minmax(170px,1.3fr)_repeat(3,minmax(0,1fr))] items-center gap-4 rounded-xl border border-oai-gray-200/90 bg-white/70 px-3 py-2 shadow-sm dark:border-oai-gray-700/90 dark:bg-oai-gray-900/50"}>
                      <div className="flex h-6 items-center justify-between gap-2">
                        <h3 className="tt-data-source-name flex min-w-0 items-center gap-2 text-[13px] font-semibold leading-5"><ProviderIcon provider={source.agent} size={20} />{source.agent_name || source.agent}</h3>
                        <span title={noticeKey ? copy(noticeKey) : undefined} tabIndex={noticeKey ? 0 : undefined} aria-describedby={noticeId} className={state === "ready" ? "shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300" : state === "no-logs" ? "shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/70 dark:text-amber-300" : "shrink-0 rounded-full bg-oai-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-300"}>
                          {copy(healthCopyKey(source, state))}
                        </span>
                        {noticeKey ? <span id={noticeId} className="sr-only">{copy(noticeKey)}</span> : null}
                      </div>
                      <dl className={sourceView === "grid" ? "mt-2 grid grid-cols-1 gap-1.5 border-t border-oai-gray-100 pt-2 text-[10px] leading-3 dark:border-oai-gray-800" : "contents text-xs dark:border-oai-gray-800"}>
                        <div className={sourceView === "grid" ? "grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-2" : undefined}>
                          <dt className="text-oai-gray-500 dark:text-oai-gray-400">{copy("data_sources.evidence")}</dt>
                          <dd className="mt-0.5 font-semibold tabular-nums text-oai-gray-800 dark:text-oai-gray-100">{Number(source.evidenceCount) || 0}</dd>
                        </div>
                        <div className={sourceView === "grid" ? "grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-2" : undefined}>
                          <dt className="text-oai-gray-500 dark:text-oai-gray-400">{copy("data_sources.last_activity")}</dt>
                          <dd className="mt-0.5 min-w-0 break-words font-medium text-oai-gray-700 dark:text-oai-gray-200" title={formatActivityTime(source.latestActivityAt)}>{formatActivityTime(source.latestActivityAt)}</dd>
                        </div>
                        <div className={sourceView === "grid" ? "grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-2" : undefined}>
                          <dt className="text-oai-gray-500 dark:text-oai-gray-400">{copy("data_sources.environment")}</dt>
                          <dd className="mt-0.5 min-w-0 break-words font-medium text-oai-gray-700 dark:text-oai-gray-200" title={source.environment || copy("data_sources.unknown")}>{source.environment || copy("data_sources.unknown")}</dd>
                        </div>
                      </dl>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <div className="tt-data-bottom-grid col-span-full mb-5 grid items-stretch gap-5 lg:grid-cols-[430px_minmax(0,1fr)] xl:grid-cols-[500px_minmax(0,1fr)]">
          <section data-testid="data-ledger-diagnostics" className="tt-surface tt-pressable-group h-full rounded-[var(--tt-card-radius)] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                  <h2 className="font-semibold">{copy("data_sources.ledger.title")}</h2>
                </div>
                {ledgerError ? (
                  <p role="status" className="mt-3 text-sm text-red-700 dark:text-red-300">{ledgerError}</p>
                ) : null}
                {!ledgerError && ledgerMetrics.length ? (
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    {ledgerMetrics.map(([key, value]) => (
                      <div key={key} data-testid={`data-ledger-metric-${key}`} className="tt-surface-nested rounded-lg border border-oai-gray-100 px-3 py-2 dark:border-oai-gray-800">
                        <dt className="text-xs text-oai-gray-500">{copy(`data_sources.ledger.${key}`)}</dt>
                        <dd className="mt-1 font-semibold tabular-nums">{Number(value).toLocaleString(getCopyLocale())}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
              {hasIntegrityBreakdown ? <div className="flex shrink-0 flex-col items-center pt-1" data-testid="data-ledger-integrity-rate">
                <div className="flex h-24 w-24 items-center justify-center rounded-full" style={{ background: `conic-gradient(var(--oai-success) ${integrityPercent}%, var(--oai-gray-200) ${integrityPercent}% 100%)` }}>
                  <div className="flex h-[74px] w-[74px] flex-col items-center justify-center rounded-full bg-white dark:bg-oai-gray-900">
                    <strong className="text-lg tabular-nums">{integrityPercent}%</strong>
                    <span className="text-[10px] text-oai-gray-500">{copy("data_sources.ledger.integrity_rate")}</span>
                  </div>
                </div>
              </div> : null}
            </div>
            {hasIntegrityBreakdown ? (
              <div className="mt-4 border-t border-oai-gray-100 pt-3 dark:border-oai-gray-800">
                <div className="flex h-1.5 overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800">
                  <span className="bg-emerald-500" style={{ width: `${Math.min(100, (visibleRecords / importedRecords) * 100)}%` }} />
                  <span className="bg-amber-400" style={{ width: `${Math.min(100, (duplicateRecords / importedRecords) * 100)}%` }} />
                  <span className="bg-red-400" style={{ width: `${Math.min(100, (malformedRecords / importedRecords) * 100)}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-oai-gray-600 dark:text-oai-gray-300">
                  <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />{copy("data_sources.ledger.visible_rate")} {visibleRecords.toLocaleString(getCopyLocale())}</span>
                  <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />{copy("data_sources.ledger.duplicates")} {duplicateRecords.toLocaleString(getCopyLocale())}</span>
                  <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-red-400" />{copy("data_sources.ledger.malformed")} {malformedRecords.toLocaleString(getCopyLocale())}</span>
                </div>
              </div>
            ) : null}
            {unpricedPercent || unattributedPercent ? (
              <div className="tt-data-ledger-overflow-copy mt-3 border-t border-oai-gray-100 pt-3 text-xs leading-5 text-oai-gray-600 dark:border-oai-gray-800 dark:text-oai-gray-300">
                {unpricedPercent ? <p>{copy("data_sources.ledger.unpriced", {
                  count: Number(unpricedTokens).toLocaleString(getCopyLocale()),
                  percent: unpricedPercent,
                })}</p> : null}
                {unattributedPercent ? <p className="mt-1">{copy("data_sources.ledger.unattributed", {
                  count: Number(unattributedTokens).toLocaleString(getCopyLocale()),
                  percent: unattributedPercent,
                })}</p> : null}
              </div>
            ) : null}
          </section>

          <section id="privacy-data" data-testid="data-privacy-boundary" className="tt-surface tt-pressable-group h-full rounded-[var(--tt-card-radius)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{copy("data_sources.privacy_title")}</h2>
                <p className="mt-1 text-[13px] leading-5 text-oai-gray-600 dark:text-oai-gray-300">{copy("data_sources.privacy_detail")}</p>
                <div className="tt-surface-nested mt-2 rounded-lg px-3 py-2 text-xs" data-testid="data-storage-location">
                  <span className="font-semibold">{copy("data_sources.storage_label")}</span>
                  <span className="ml-2">{copy("data_sources.storage_path")}</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-4 text-oai-gray-500 dark:text-oai-gray-400">{copy("data_sources.delete_instructions")}</p>
                <div className="mt-2 flex flex-col items-start gap-3 min-[1440px]:flex-row min-[1440px]:items-center">
                  <button
                    type="button"
                    onClick={clearImportedData}
                    disabled={clearing}
                    className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-red-300 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-950/50"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    {clearing ? copy("data_sources.clear.clearing") : copy("data_sources.clear.action")}
                  </button>
                  <div
                    data-testid="data-privacy-principles"
                    className="tt-data-privacy-badges ml-auto grid w-full max-w-[25rem] min-w-0 gap-3 text-xs sm:grid-cols-3"
                  >
                  <span className="flex min-w-0 gap-2"><HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /><span><strong className="block text-oai-gray-800 dark:text-oai-gray-100">{copy("data_sources.reference.local_only")}</strong><small className="mt-0.5 block leading-4 text-oai-gray-500 dark:text-oai-gray-400">{copy("data_sources.reference.local_only_detail")}</small></span></span>
                  <span className="flex min-w-0 gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /><span><strong className="block text-oai-gray-800 dark:text-oai-gray-100">{copy("data_sources.reference.privacy_first")}</strong><small className="mt-0.5 block leading-4 text-oai-gray-500 dark:text-oai-gray-400">{copy("data_sources.reference.privacy_first_detail")}</small></span></span>
                  <span className="flex min-w-0 gap-2"><CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /><span><strong className="block text-oai-gray-800 dark:text-oai-gray-100">{copy("data_sources.reference.optional_cloud")}</strong><small className="mt-0.5 block leading-4 text-oai-gray-500 dark:text-oai-gray-400">{copy("data_sources.reference.optional_cloud_detail")}</small></span></span>
                  </div>
                </div>
                {clearCompleted ? (
                  <p role="status" className="mt-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    {copy("data_sources.clear.success")}
                  </p>
                ) : null}
              </div>
            </div>
          </section>
          </div>

        </div>
      </main>
    </div>
  );
}
