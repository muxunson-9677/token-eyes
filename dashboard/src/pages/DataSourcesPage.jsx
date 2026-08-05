import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, CloudOff, HardDrive, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
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
  const [ledgerError, setLedgerError] = useState("");
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearCompleted, setClearCompleted] = useState(false);

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
      writeDataSourceCache({
        sources: Array.isArray(healthResult.value?.results) ? healthResult.value.results : [],
        ledgerSummary: ledgerResult.value || null,
        updatedAt: new Date().toISOString(),
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
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy("data_sources.title")}</h1>
              <p className="mt-2 max-w-2xl text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("data_sources.subtitle")}</p>
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

          <section data-testid="data-source-summary" className="tt-surface mb-4 rounded-[var(--tt-card-radius)] p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-oai-gray-600 dark:text-oai-gray-300">
              <span>{copy("data_sources.summary.ready", { count: counts.ready })}</span>
              <span>{copy("data_sources.summary.no_logs", { count: counts["no-logs"] })}</span>
              <span>{copy("data_sources.summary.unavailable", { count: counts.unavailable })}</span>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-oai-gray-500">
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                {copy("data_sources.loading")}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {sources.map((source) => {
                  const state = healthState(source);
                  const noticeKey = evidenceNoticeKey(source);
                  return (
                    <article key={source.agent} data-testid={`data-source-${source.agent}`} data-health={state} className="tt-surface-nested rounded-xl p-3">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="tt-data-source-name font-semibold"><ProviderIcon provider={source.agent} size={28} />{source.agent_name || source.agent}</h2>
                        <span className={state === "ready" ? "text-xs font-semibold text-emerald-700 dark:text-emerald-300" : state === "no-logs" ? "text-xs font-semibold text-amber-700 dark:text-amber-300" : "text-xs font-semibold text-oai-gray-500"}>
                          {copy(healthCopyKey(source, state))}
                        </span>
                      </div>
                      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                        {noticeKey ? (
                          <>
                            <dt>{copy("data_sources.status_detail")}</dt>
                            <dd>{copy(noticeKey)}</dd>
                          </>
                        ) : (
                          <>
                            <dt>{copy("data_sources.evidence")}</dt>
                            <dd>{Number(source.evidenceCount) || 0}</dd>
                          </>
                        )}
                        <dt>{copy("data_sources.last_activity")}</dt><dd>{formatTime(source.latestActivityAt)}</dd>
                        <dt>{copy("data_sources.environment")}</dt><dd>{source.environment || copy("data_sources.unknown")}</dd>
                      </dl>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section data-testid="data-ledger-diagnostics" className="tt-surface mb-4 rounded-[var(--tt-card-radius)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{copy("data_sources.ledger.title")}</h2>
                <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("data_sources.ledger.subtitle")}</p>
                {ledgerError ? (
                  <p role="status" className="mt-3 text-sm text-red-700 dark:text-red-300">{ledgerError}</p>
                ) : null}
                {!ledgerError && ledgerMetrics.length ? (
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                    {ledgerMetrics.map(([key, value]) => (
                      <div key={key} data-testid={`data-ledger-metric-${key}`} className="tt-surface-nested rounded-lg p-2">
                        <dt className="text-xs text-oai-gray-500">{copy(`data_sources.ledger.${key}`)}</dt>
                        <dd className="mt-1 font-semibold tabular-nums">{Number(value).toLocaleString(getCopyLocale())}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {unpricedPercent || unattributedPercent ? (
                  <div className="mt-3 grid gap-2 text-xs text-oai-gray-600 dark:text-oai-gray-300 sm:grid-cols-2">
                    {unpricedPercent ? <p>{copy("data_sources.ledger.unpriced", {
                      count: Number(unpricedTokens).toLocaleString(getCopyLocale()),
                      percent: unpricedPercent,
                    })}</p> : null}
                    {unattributedPercent ? <p>{copy("data_sources.ledger.unattributed", {
                      count: Number(unattributedTokens).toLocaleString(getCopyLocale()),
                      percent: unattributedPercent,
                    })}</p> : null}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section id="privacy-data" data-testid="data-privacy-boundary" className="tt-surface mb-4 rounded-[var(--tt-card-radius)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
              <div>
                <h2 className="font-semibold">{copy("data_sources.privacy_title")}</h2>
                <p className="mt-1 text-sm leading-6 text-oai-gray-600 dark:text-oai-gray-300">{copy("data_sources.privacy_detail")}</p>
                <div className="tt-surface-nested mt-3 rounded-lg px-3 py-2 text-xs" data-testid="data-storage-location">
                  <span className="font-semibold">{copy("data_sources.storage_label")}</span>
                  <span className="ml-2">{copy("data_sources.storage_path")}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-oai-gray-500 dark:text-oai-gray-400">{copy("data_sources.delete_instructions")}</p>
                <div className="tt-data-privacy-actions mt-3 flex flex-wrap items-center gap-6">
                  <button
                    type="button"
                    onClick={clearImportedData}
                    disabled={clearing}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    {clearing ? copy("data_sources.clear.clearing") : copy("data_sources.clear.action")}
                  </button>
                  <div className="tt-data-privacy-badges flex flex-1 items-center justify-around gap-4">
                    <span><HardDrive aria-hidden /><strong>{copy("data_sources.reference.local_only")}</strong><small>{copy("data_sources.reference.local_only_detail")}</small></span>
                    <span><ShieldCheck aria-hidden /><strong>{copy("data_sources.reference.privacy_first")}</strong><small>{copy("data_sources.reference.privacy_first_detail")}</small></span>
                    <span><CloudOff aria-hidden /><strong>{copy("data_sources.reference.optional_cloud")}</strong><small>{copy("data_sources.reference.optional_cloud_detail")}</small></span>
                  </div>
                </div>
                {clearCompleted ? (
                  <p role="status" className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    {copy("data_sources.clear.success")}
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
