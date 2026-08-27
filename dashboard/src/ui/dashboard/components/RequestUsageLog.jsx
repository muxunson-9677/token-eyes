import React, { useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, Clock3, FileText } from "lucide-react";
import { Card } from "../../components";
import { useCurrency } from "../../../hooks/useCurrency";
import { copy } from "../../../lib/copy";
import { getCurrencySymbol } from "../../../lib/currency";
import { formatUsdCurrency } from "../../../lib/format";
import { limitProviderName } from "../../../lib/limits-providers.js";
import { useRequestUsageRecords } from "../../../hooks/use-request-usage-records";
import { getProviderColor } from "./UsageOverview.jsx";

/**
 * TICKET-04 A: 请求日志表格（9 列，CC Switch 风格）。
 *
 * 列序：时间 / 供应商(+圆点) / 计费模型 / 输入(+缓存读小字) / 输出 /
 * 总成本 / 用时·首字 / 状态 / 来源。
 *
 * 数据源：useRequestUsageRecords Hook（内部并行查询所有 visible providers，
 * 与统计面板/趋势图共用同一份 useUsageFilters 状态，保证口径一致）。
 *
 * 交互：列标题点击排序（默认时间降序）、底部"加载更多"分页、
 * 顶部 source 下拉（"全部" + 各 provider）。
 */

const PAGE_SIZE = 10;

/**
 * Generate page numbers with ellipsis for large page counts.
 * Shows up to 5 page buttons: first, last, and current with adjacent pages.
 * Example: 1 2 ... 5 6 [7] 8 9 ... 20
 */
function getPageNumbers(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = [];
  const leftEllipsis = currentPage > 3;
  const rightEllipsis = currentPage < totalPages - 2;

  // Always show first page
  pages.push(1);

  if (leftEllipsis) {
    pages.push("...");
  }

  // Calculate range around current page
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (rightEllipsis) {
    pages.push("...");
  }

  // Always show last page
  if (totalPages > 1) {
    pages.push(totalPages);
  }

  return pages;
}

function safeNum(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function isProvidedNumber(value) {
  return value !== null
    && value !== undefined
    && value !== ""
    && Number.isFinite(Number(value));
}

function formatFullNum(value) {
  return safeNum(value).toLocaleString();
}

function formatAverageLatency(value) {
  if (!isProvidedNumber(value)) return null;
  const milliseconds = Math.max(0, Number(value));
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)}ms`
    : `${(milliseconds / 1_000).toFixed(1)}s`;
}

function formatCost(value, currency, rate, pricingCoverage) {
  if (pricingCoverage === "unpriced") {
    return copy("ticket06.pricing.unpriced");
  }
  if (!isProvidedNumber(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return `${getCurrencySymbol(currency)}0`;
  return formatUsdCurrency(n, { decimals: n < 1 ? 4 : 2, currency, rate });
}

/** `MM/DD HH:mm` — locale-aware, matches CC Switch format. */
function formatTime(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  if (!Number.isFinite(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

/** `0.0s / 830ms` — total latency + first-token latency. */
function formatLatencyFirst(latencyMs, firstTokenMs) {
  const hasLatency = isProvidedNumber(latencyMs);
  const hasFirstToken = isProvidedNumber(firstTokenMs);
  if (!hasLatency && !hasFirstToken) return null;

  const values = [];
  if (hasLatency) {
    const latency = Math.max(0, Number(latencyMs));
    values.push(latency === 0 ? "0ms" : `${(latency / 1000).toFixed(1)}s`);
  }
  if (hasFirstToken) {
    values.push(`${Math.round(Math.max(0, Number(firstTokenMs)))}ms`);
  }
  return values.join(" / ");
}

function statusIsError(status) {
  const s = safeNum(status);
  return s === 0 || s >= 400;
}

function getCacheDiagnostic(record) {
  if (record?.record_kind === "aggregate_bucket") {
    return copy("observability.request.cache.unavailable");
  }
  return safeNum(record?.cached_input_tokens) > 0
    ? copy("observability.request.cache.hit")
    : copy("observability.request.cache.miss");
}

function getPricingDiagnostic(record) {
  const coverage = record?.pricing_coverage || "complete";
  return copy(`observability.request.pricing.${coverage}`);
}

const COLUMNS = [
  { id: "time", labelKey: "ticket04.request.column.time" },
  { id: "provider", labelKey: "ticket04.request.column.provider" },
  { id: "model", labelKey: "ticket04.request.column.model" },
  { id: "input", labelKey: "ticket04.request.column.input" },
  { id: "output", labelKey: "ticket04.request.column.output" },
  { id: "cost", labelKey: "ticket04.request.column.cost" },
  { id: "latency", labelKey: "ticket04.request.column.latency_first" },
  { id: "status", labelKey: "ticket04.request.column.status" },
  { id: "cache_pricing", labelKey: "observability.request.column.cache_pricing" },
  { id: "source", labelKey: "ticket04.request.column.source" },
];

const COLUMN_ORDER = ["time", "provider", "model", "input", "output", "cost", "latency", "status", "cache_pricing", "source"];

function getColumnMeta(colId) {
  return COLUMNS.find((c) => c.id === colId);
}

export function RequestUsageLog({
  from,
  to,
  timeZone,
  tzOffsetMinutes,
  baseUrl,
  accessToken = null,
  guestAllowed = true,
  cacheKey,
  visibleProviderIds,
  fetchEnabled = true,
}) {
  const { currency, rate } = useCurrency();
  const [sourceFilter, setSourceFilter] = useState(""); // "" = all
  // V2-W3: "" = all records, "request_event" = per-message records only.
  const [kindFilter, setKindFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const visibleProviderKey = useMemo(
    () => (Array.isArray(visibleProviderIds) ? visibleProviderIds.join("\u0001") : "__all__"),
    [visibleProviderIds],
  );

  // When the global source filter or visibleProviderIds changes, reset the
  // local source dropdown and page.
  useEffect(() => {
    setSourceFilter("");
    setCurrentPage(1);
  }, [visibleProviderKey, from, to, timeZone, tzOffsetMinutes]);

  const queriedProviderIds = useMemo(
    () => (sourceFilter ? [sourceFilter] : visibleProviderIds),
    [sourceFilter, visibleProviderIds],
  );

  const { records, totals, loading, error, refresh, totalPages: serverTotalPages, total: serverTotal } = useRequestUsageRecords({
    baseUrl,
    accessToken,
    guestAllowed,
    from,
    to,
    cacheKey,
    timeZone,
    tzOffsetMinutes,
    visibleProviderIds: queriedProviderIds,
    fetchEnabled,
    limit: 1000,
    page: currentPage,
    pageSize: PAGE_SIZE,
    recordKind: kindFilter,
  });
  const pageLoadingLabel = copy("ticket04.request.page_loading", { page: currentPage });
  const isPageLoading = loading && records.length > 0;

  // Server-side pagination: records already come paginated and sorted by timestamp desc
  // Frontend sort is removed because backend doesn't support sort/order parameters
  const visibleRecords = records;

  // Use server-side pagination metadata
  const summaryTotal = isProvidedNumber(totals?.request_count) ? Number(totals.request_count) : 0;
  const total = Math.max(serverTotal || 0, summaryTotal, visibleRecords.length);
  const totalPages = Math.max(serverTotalPages || 1, Math.ceil(total / PAGE_SIZE));
  const successRate = isProvidedNumber(totals?.success_rate)
    ? Math.max(0, Math.min(100, Number(totals.success_rate)))
    : null;
  const reportedSuccessfulRequests = isProvidedNumber(totals?.success_count)
    ? Math.max(0, Number(totals.success_count))
    : null;
  const statusSampleCount = isProvidedNumber(totals?.status_sample_count)
    ? Math.max(0, Number(totals.status_sample_count))
    : isProvidedNumber(totals?.request_count)
      ? Math.max(0, Number(totals.request_count))
      : null;
  const derivedSuccessfulRequests = successRate !== null && statusSampleCount !== null
    ? Math.round(statusSampleCount * successRate / 100)
    : null;
  const successfulRequests = reportedSuccessfulRequests !== null
    ? reportedSuccessfulRequests
    : derivedSuccessfulRequests;
  const interruptedRequests = isProvidedNumber(totals?.interrupted_count)
    ? Math.max(0, Number(totals.interrupted_count))
    : 0;
  const failedRequests = isProvidedNumber(totals?.failure_count)
    ? Math.max(0, Number(totals.failure_count))
    : successfulRequests !== null && statusSampleCount !== null
      ? Math.max(0, statusSampleCount - successfulRequests - interruptedRequests)
    : null;

  const sources = useMemo(() => {
    if (!Array.isArray(visibleProviderIds)) return [];
    return visibleProviderIds.map((id) => ({
      value: id,
      label: limitProviderName(id),
    }));
  }, [visibleProviderIds]);

  let body;
  if (loading && records.length === 0) {
    body = (
      <div className="flex items-center justify-center py-8" role="status" aria-label={copy("ticket04.request.loading")}>
        <Loader2 size={20} className="text-oai-gray-400 dark:text-oai-gray-500 animate-spin" />
      </div>
    );
  } else if (error && records.length === 0) {
    body = (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <AlertCircle size={20} className="text-red-500 dark:text-red-400" aria-hidden="true" />
        <span className="text-sm text-red-500 dark:text-red-400">{copy("ticket04.request.error")}</span>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-10 items-center rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 px-3 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 transition-colors"
        >
          {copy("ticket04.request.retry")}
        </button>
      </div>
    );
  } else if (records.length === 0) {
    body = (
      <div className="text-center py-8 text-sm text-oai-gray-500 dark:text-oai-gray-400">
        {copy("ticket04.request.empty")}
      </div>
    );
  } else {
    body = (
      <>
        {isPageLoading && (
          <div
            className="mb-2 inline-flex items-center gap-1.5 text-xs text-oai-gray-500 dark:text-oai-gray-400"
            role="status"
            aria-label={pageLoadingLabel}
            aria-live="polite"
          >
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            <span>{pageLoadingLabel}</span>
          </div>
        )}
        <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-oai-gray-200 dark:border-oai-gray-700">
                {COLUMN_ORDER.map((colId) => {
                  // First three columns left-aligned, rest right-aligned.
                  const meta = getColumnMeta(colId);
                  const align = ["time", "provider", "model", "cache_pricing", "source"].includes(colId) ? "text-left" : "text-right";
                  return (
                    <th
                      key={colId}
                      className={`px-3 py-1.5 font-medium text-oai-gray-500 dark:text-oai-gray-400 whitespace-nowrap ${align}`}
                    >
                      {copy(meta.labelKey)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((record, idx) => {
                const providerLabel = record.source_display_name || limitProviderName(record.source);
                const dotColor = getProviderColor(record.source, idx);
                const isStatusError = statusIsError(record.status);
                return (
                  <tr
                    key={record.id || `${record.timestamp}-${idx}`}
                    className={`tt-request-log-row border-b border-oai-gray-100 dark:border-oai-gray-800 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50 transition-colors ${idx === 0 ? "tt-request-log-row--featured" : ""}`}
                    data-testid={`request-log-row-${idx}`}
                  >
                    <td className="px-3 py-1.5 text-xs text-oai-gray-700 dark:text-oai-gray-300 whitespace-nowrap tabular-nums">
                      {formatTime(record.timestamp)}
                    </td>
                    <td className="px-3 py-1.5 text-xs font-medium text-oai-black dark:text-oai-white whitespace-nowrap">
                      <span className="tt-request-provider-chip inline-flex items-center gap-2" data-testid="request-provider-chip">
                        <span
                          aria-hidden="true"
                          className="inline-block h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: dotColor }}
                        />
                        <span title={providerLabel}>{providerLabel}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-oai-gray-700 dark:text-oai-gray-300 whitespace-nowrap" title={record.model}>
                      {record.model}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-oai-gray-600 dark:text-oai-gray-300 whitespace-nowrap text-right tabular-nums">
                      <div className="flex flex-col items-end leading-tight">
                        {isProvidedNumber(record.input_tokens) && <span>{formatFullNum(record.input_tokens)}</span>}
                        {safeNum(record.cached_input_tokens) > 0 && (
                          <span className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
                            {copy("ticket04.request.cache_read_prefix")}{formatFullNum(record.cached_input_tokens)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-oai-gray-600 dark:text-oai-gray-300 whitespace-nowrap text-right tabular-nums">
                      {isProvidedNumber(record.output_tokens) ? formatFullNum(record.output_tokens) : null}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-oai-brand whitespace-nowrap text-right tabular-nums">
                      {formatCost(record.cost_usd, currency, rate, record.pricing_coverage)}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-oai-gray-600 dark:text-oai-gray-300 whitespace-nowrap text-right tabular-nums">
                      {formatLatencyFirst(record.latency_ms, record.first_token_ms)}
                    </td>
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap text-right tabular-nums">
                      {record.status !== null && record.status !== undefined ? (
                        <span
                          className={
                            isStatusError
                              ? "tt-request-status-chip text-red-600 dark:text-red-400 font-medium"
                              : "tt-request-status-chip text-emerald-600 dark:text-emerald-400 font-medium"
                          }
                          data-testid="request-status-chip"
                          aria-label={copy(isStatusError ? "ticket04.request.status_error_aria" : "ticket04.request.status_success_aria")}
                        >
                          {record.status}
                        </span>
                      ) : (
                        <span className="text-oai-gray-400 dark:text-oai-gray-500">
                          {copy("ticket04.request.status_unsampled")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-oai-gray-500 dark:text-oai-gray-400 whitespace-nowrap">
                      <div>{getCacheDiagnostic(record)}</div>
                      <div className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
                        {getPricingDiagnostic(record)}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-oai-gray-400 dark:text-oai-gray-500 whitespace-nowrap">
                      {/* V2-W3 granularity badge: honest about whether this row is
                          a real per-message event or a half-hour aggregate. The raw
                          request_source stays inspectable via the title tooltip. */}
                      {record.record_kind === "aggregate_bucket" ? (
                        <span
                          className="inline-flex items-center rounded-full bg-oai-gray-100 dark:bg-oai-gray-800 px-2 py-0.5 text-[10px] text-oai-gray-500 dark:text-oai-gray-400"
                          title={`${copy("ticket04.request.kind.aggregate_title")}${record.request_source ? ` (${record.request_source})` : ""}`}
                        >
                          {copy("ticket04.request.kind.aggregate")}
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400"
                          title={`${copy("ticket04.request.kind.request_event_title")}${record.request_source ? ` (${record.request_source})` : ""}`}
                        >
                          {copy("ticket04.request.kind.request_event")}
                        </span>
                      )}
                      {(record.request_source || record.origin) ? (
                        <span className="tt-request-source-chip ml-1.5" data-testid="request-source-chip">
                          {record.request_source || record.origin}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {totals && (
                <tr className="tt-request-log-total-row bg-oai-gray-50 dark:bg-oai-gray-800/60" data-testid="request-log-total-row">
                  <td className="px-3 py-1.5 text-sm font-semibold text-oai-black dark:text-oai-white" colSpan={3}>
                    {copy("usage.request_log.totals")}
                  </td>
                  <td className="px-3 py-1.5 text-sm font-semibold text-oai-black dark:text-oai-white whitespace-nowrap text-right tabular-nums">
                    {isProvidedNumber(totals.input_tokens) ? formatFullNum(totals.input_tokens) : null}
                    {safeNum(totals.cached_input_tokens) > 0 && (
                      <div className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
                        {copy("ticket04.request.cache_read_prefix")}{formatFullNum(totals.cached_input_tokens)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-sm font-semibold text-oai-black dark:text-oai-white whitespace-nowrap text-right tabular-nums">
                    {isProvidedNumber(totals.output_tokens) ? formatFullNum(totals.output_tokens) : null}
                  </td>
                  <td className="px-3 py-1.5 text-sm font-semibold text-oai-brand whitespace-nowrap text-right tabular-nums">
                    {formatCost(totals.cost_usd, currency, rate, totals.pricing_coverage)}
                  </td>
                  <td className="px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-right tabular-nums">
                    {formatAverageLatency(totals.avg_latency_ms)}
                  </td>
                  <td className="px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-right tabular-nums">
                    {isProvidedNumber(totals.success_rate) ? `${Number(totals.success_rate).toFixed(1)}%` : null}
                  </td>
                  <td className="px-3 py-1.5" />
                  <td className="px-3 py-1.5" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="tt-usage-table-pagination mt-3 flex items-center justify-between gap-3 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          <span>{copy("spend.usage.pagination.records", { total })}</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                className="inline-flex h-8 items-center rounded-lg border border-oai-gray-200 bg-white px-3 disabled:opacity-40 dark:border-oai-gray-700 dark:bg-oai-gray-900"
              >
                {copy("spend.usage.pagination.previous")}
              </button>
              {getPageNumbers(currentPage, totalPages).map((page, idx) =>
                page === "..." ? (
                  <span key={`ellipsis-${idx}`} className="px-1 text-oai-gray-400">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    aria-current={page === currentPage ? "page" : undefined}
                    className={page === currentPage
                      ? "inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-oai-brand text-white"
                      : "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-oai-gray-200 bg-white dark:border-oai-gray-700 dark:bg-oai-gray-900"}
                  >
                    {page}
                  </button>
                ),
              )}
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
                className="inline-flex h-8 items-center rounded-lg border border-oai-gray-200 bg-white px-3 disabled:opacity-40 dark:border-oai-gray-700 dark:bg-oai-gray-900"
              >
                {copy("spend.usage.pagination.next")}
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <Card className="tt-usage-table-card tt-request-log-card tt-pressable-group mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-oai-black dark:text-oai-white">
            {copy("ticket04.request.title")}
          </h3>
          <p className="text-xs text-oai-gray-500 dark:text-oai-gray-400 mt-0.5">
            {copy("ticket04.request.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs text-oai-gray-600 dark:text-oai-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={kindFilter === "request_event"}
              onChange={(e) => {
                setKindFilter(e.target.checked ? "request_event" : "");
                setCurrentPage(1);
              }}
              aria-label={copy("ticket04.request.kind_filter")}
              className="h-3.5 w-3.5 rounded border-oai-gray-300 dark:border-oai-gray-700 accent-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
            />
            {copy("ticket04.request.kind_filter")}
          </label>
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="h-10 px-2.5 text-xs font-medium rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-oai-white dark:bg-oai-gray-900 text-oai-black dark:text-oai-white hover:border-oai-gray-400 dark:hover:border-oai-gray-600 focus:outline-none focus:ring-2 focus:ring-oai-brand/50 focus:border-oai-brand"
            aria-label={copy("usage.request_log.source_filter_aria")}
          >
            <option value="">{copy("ticket04.request.all_sources")}</option>
            {sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {totals && [totals.request_count, totals.success_rate, totals.avg_latency_ms].some(isProvidedNumber) && (
        <div className="mb-4 grid grid-cols-3 gap-2" data-testid="request-log-metrics">
          {isProvidedNumber(totals.request_count) && (
            <div data-testid="request-log-metric-requests" className="tt-surface-nested tt-request-log-metric tt-request-log-metric--raised tt-pressable min-w-0 rounded-xl px-3 py-2.5" data-tone="blue">
              <span className="tt-request-log-metric-icon-well" aria-hidden="true">
                <FileText data-testid="request-log-metric-icon" className="h-6 w-6 text-blue-500" />
              </span>
              <div className="min-w-0"><div className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("usage.request_log.metric.requests")}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">{formatFullNum(totals.request_count)}</div>
              <div className="tt-request-log-metric-detail">{copy("usage.request_log.metric.requests_detail", { count: formatFullNum(totals.request_count) })}</div></div>
            </div>
          )}
          {isProvidedNumber(totals.success_rate) && (
            <div data-testid="request-log-metric-success-rate" className="tt-surface-nested tt-request-log-metric tt-request-log-metric--raised tt-pressable min-w-0 rounded-xl px-3 py-2.5" data-tone="green">
              <span className="tt-request-log-metric-icon-well" aria-hidden="true">
                <CheckCircle2 data-testid="request-log-metric-icon" className="h-6 w-6 text-emerald-500" />
              </span>
              <div className="min-w-0"><div className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("usage.request_log.metric.success_rate")}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {`${Number(totals.success_rate).toFixed(1)}%`}
              </div>
              {successfulRequests !== null && failedRequests !== null ? (
                <div className="tt-request-log-metric-detail">{copy(
                  interruptedRequests > 0
                    ? "usage.request_log.metric.success_detail_with_interrupted"
                    : "usage.request_log.metric.success_detail",
                  {
                   success: formatFullNum(successfulRequests),
                   interrupted: formatFullNum(interruptedRequests),
                   failed: formatFullNum(failedRequests),
                  },
                )}</div>
              ) : null}</div>
            </div>
          )}
          {isProvidedNumber(totals.avg_latency_ms) && (
            <div data-testid="request-log-metric-avg-latency" className="tt-surface-nested tt-request-log-metric tt-request-log-metric--raised tt-pressable min-w-0 rounded-xl px-3 py-2.5" data-tone="purple">
              <span className="tt-request-log-metric-icon-well" aria-hidden="true">
                <Clock3 data-testid="request-log-metric-icon" className="h-6 w-6 text-violet-500" />
              </span>
              <div className="min-w-0"><div className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("usage.request_log.metric.avg_latency")}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">{formatAverageLatency(totals.avg_latency_ms)}</div>
              <div className="tt-request-log-metric-detail">{copy("usage.request_log.metric.latency_detail")}</div></div>
            </div>
          )}
        </div>
      )}

      {body}
    </Card>
  );
}
