import React, { useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
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

function formatFullNum(value) {
  return safeNum(value).toLocaleString();
}

function formatAverageLatency(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return copy("ticket06.metric.unavailable");
  }
  const milliseconds = Math.max(0, Number(value));
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)}ms`
    : `${(milliseconds / 1_000).toFixed(1)}s`;
}

function formatCost(value, currency, rate, pricingCoverage) {
  const n = Number(value);
  if (pricingCoverage === "unpriced") {
    return copy("ticket06.pricing.unpriced");
  }
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
  if (latencyMs === null || latencyMs === undefined) {
    return copy("ticket06.metric.unavailable");
  }
  const lat = safeNum(latencyMs);
  const ft = firstTokenMs == null ? null : safeNum(firstTokenMs);
  const hasLat = lat > 0;
  const hasFt = ft != null && ft > 0;
  if (!hasLat && !hasFt) return copy("ticket04.request.latency_none");
  const latStr = hasLat ? `${(lat / 1000).toFixed(1)}s` : "-";
  const ftStr = hasFt ? `${Math.round(ft)}ms` : "-";
  return `${latStr} / ${ftStr}`;
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
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDraft, setPageDraft] = useState("1");
  const visibleProviderKey = useMemo(
    () => (Array.isArray(visibleProviderIds) ? visibleProviderIds.join("\u0001") : "__all__"),
    [visibleProviderIds],
  );

  // Sync pageDraft when currentPage changes externally (e.g., clicking page buttons)
  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    setPageDraft(String(newPage));
  };

  // When the global source filter or visibleProviderIds changes, reset the
  // local source dropdown and page.
  useEffect(() => {
    setSourceFilter("");
    setCurrentPage(1);
    setPageDraft("1");
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
  });
  const pageLoadingLabel = copy("ticket04.request.page_loading", { page: currentPage });
  const isPageLoading = loading && records.length > 0;

  // Server-side pagination: records already come paginated and sorted by timestamp desc
  // Frontend sort is removed because backend doesn't support sort/order parameters
  const visibleRecords = records;

  // Use server-side pagination metadata
  const totalPages = serverTotalPages || 1;
  const total = serverTotal || 0;

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
          className="inline-flex h-8 items-center rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 px-3 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 transition-colors"
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
                      className={`px-3 py-2 font-medium text-oai-gray-500 dark:text-oai-gray-400 whitespace-nowrap ${align}`}
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
                    className="border-b border-oai-gray-100 dark:border-oai-gray-800 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50 transition-colors"
                  >
                    <td className="px-3 py-2 text-sm text-oai-gray-700 dark:text-oai-gray-300 whitespace-nowrap tabular-nums">
                      {formatTime(record.timestamp)}
                    </td>
                    <td className="px-3 py-2 text-sm font-medium text-oai-black dark:text-oai-white whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="inline-block h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: dotColor }}
                        />
                        <span className="truncate max-w-[160px]" title={providerLabel}>{providerLabel}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm text-oai-gray-700 dark:text-oai-gray-300 whitespace-nowrap truncate max-w-[160px]" title={record.model}>
                      {record.model}
                    </td>
                    <td className="px-3 py-2 text-sm text-oai-gray-600 dark:text-oai-gray-300 whitespace-nowrap text-right tabular-nums">
                      <div className="flex flex-col items-end leading-tight">
                        <span>{formatFullNum(record.input_tokens)}</span>
                        {safeNum(record.cached_input_tokens) > 0 && (
                          <span className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
                            {copy("ticket04.request.cache_read_prefix")}{formatFullNum(record.cached_input_tokens)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-sm text-oai-gray-600 dark:text-oai-gray-300 whitespace-nowrap text-right tabular-nums">
                      {formatFullNum(record.output_tokens)}
                    </td>
                    <td className="px-3 py-2 text-sm text-oai-brand whitespace-nowrap text-right tabular-nums">
                      {formatCost(record.cost_usd, currency, rate, record.pricing_coverage)}
                    </td>
                    <td className="px-3 py-2 text-sm text-oai-gray-600 dark:text-oai-gray-300 whitespace-nowrap text-right tabular-nums">
                      {formatLatencyFirst(record.latency_ms, record.first_token_ms)}
                    </td>
                    <td className="px-3 py-2 text-sm whitespace-nowrap text-right tabular-nums">
                      {record.status === null || record.status === undefined ? (
                        <span className="text-oai-gray-400 dark:text-oai-gray-500">{copy("ticket06.metric.unavailable")}</span>
                      ) : (
                        <span
                          className={
                            isStatusError
                              ? "text-red-600 dark:text-red-400 font-medium"
                              : "text-emerald-600 dark:text-emerald-400 font-medium"
                          }
                          aria-label={copy(isStatusError ? "ticket04.request.status_error_aria" : "ticket04.request.status_success_aria")}
                        >
                          {record.status}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-oai-gray-500 dark:text-oai-gray-400 whitespace-nowrap">
                      <div>{getCacheDiagnostic(record)}</div>
                      <div className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
                        {getPricingDiagnostic(record)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-oai-gray-400 dark:text-oai-gray-500 whitespace-nowrap">
                      {record.request_source || record.origin || "-"}
                    </td>
                  </tr>
                );
              })}
              {totals && (
                <tr className="bg-oai-gray-50 dark:bg-oai-gray-800/60">
                  <td className="px-3 py-2 text-sm font-semibold text-oai-black dark:text-oai-white" colSpan={3}>
                    {copy("usage.request_log.totals")}
                  </td>
                  <td className="px-3 py-2 text-sm font-semibold text-oai-black dark:text-oai-white whitespace-nowrap text-right tabular-nums">
                    {formatFullNum(totals.input_tokens)}
                    {safeNum(totals.cached_input_tokens) > 0 && (
                      <div className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
                        {copy("ticket04.request.cache_read_prefix")}{formatFullNum(totals.cached_input_tokens)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm font-semibold text-oai-black dark:text-oai-white whitespace-nowrap text-right tabular-nums">
                    {formatFullNum(totals.output_tokens)}
                  </td>
                  <td className="px-3 py-2 text-sm font-semibold text-oai-brand whitespace-nowrap text-right tabular-nums">
                    {formatCost(totals.cost_usd, currency, rate, totals.pricing_coverage)}
                  </td>
                  <td className="px-3 py-2 text-sm font-semibold whitespace-nowrap text-right tabular-nums">
                    {totals.avg_latency_ms === null || totals.avg_latency_ms === undefined ? (
                      <span className="text-oai-gray-400 dark:text-oai-gray-500">{copy("ticket06.metric.unavailable")}</span>
                    ) : safeNum(totals.avg_latency_ms) > 0 ? (
                      `${(safeNum(totals.avg_latency_ms) / 1000).toFixed(1)}s`
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm font-semibold whitespace-nowrap text-right tabular-nums">
                    {totals.success_rate === null || totals.success_rate === undefined ? (
                      <span className="text-oai-gray-400 dark:text-oai-gray-500">{copy("ticket06.metric.unavailable")}</span>
                    ) : safeNum(totals.success_rate) > 0 ? (
                      `${safeNum(totals.success_rate).toFixed(1)}%`
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          <span>
            {copy("ticket04.request.showing", {
              count: visibleRecords.length,
              total: total,
            })}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1 flex-wrap">
              {/* First page button */}
              <button
                type="button"
                onClick={() => handlePageChange(1)}
                disabled={currentPage === 1}
                className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 px-1.5 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 transition-colors disabled:opacity-50"
              >
                {"<<"}
              </button>
              {/* Previous page button */}
              <button
                type="button"
                onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 px-1.5 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 transition-colors disabled:opacity-50"
              >
                {"<"}
              </button>
              {/* Page number buttons */}
              {getPageNumbers(currentPage, totalPages).map((page, idx) =>
                page === "..." ? (
                  <span key={`ellipsis-${idx}`} className="px-1 text-oai-gray-400">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    type="button"
                    onClick={() => handlePageChange(page)}
                    className={`inline-flex h-7 min-w-[28px] items-center justify-center rounded-md px-1.5 text-xs font-medium transition-colors ${
                      page === currentPage
                        ? "bg-oai-brand-500 text-white border border-oai-brand-500"
                        : "border border-oai-gray-300 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800"
                    }`}
                  >
                    {page}
                  </button>
                ),
              )}
              {/* Next page button */}
              <button
                type="button"
                onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 px-1.5 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 transition-colors disabled:opacity-50"
              >
                {">"}
              </button>
              {/* Last page button */}
              <button
                type="button"
                onClick={() => handlePageChange(totalPages)}
                disabled={currentPage === totalPages}
                className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 px-1.5 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 transition-colors disabled:opacity-50"
              >
                {">>"}
              </button>
              {/* Page jump input */}
              <div className="flex items-center gap-1 ml-2">
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={pageDraft}
                  onChange={(e) => {
                    // Update draft value, clamp to valid range immediately for UX
                    const rawValue = e.target.value;
                    if (rawValue === "" || rawValue === "-") {
                      setPageDraft(rawValue);
                      return;
                    }
                    const page = parseInt(rawValue, 10);
                    if (isNaN(page)) {
                      setPageDraft(rawValue);
                      return;
                    }
                    // Clamp to valid range immediately
                    const clampedPage = Math.max(1, Math.min(totalPages, page));
                    setPageDraft(String(clampedPage));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      // Submit jump on Enter
                      const page = parseInt(pageDraft, 10);
                      if (!isNaN(page)) {
                        const clampedPage = Math.max(1, Math.min(totalPages, page));
                        setCurrentPage(clampedPage);
                        setPageDraft(String(clampedPage));
                      } else {
                        setCurrentPage(1);
                        setPageDraft("1");
                      }
                      e.target.blur();
                    }
                  }}
                  onBlur={() => {
                    // Reset draft to current page if left empty or invalid
                    const page = parseInt(pageDraft, 10);
                    if (isNaN(page) || pageDraft === "") {
                      setPageDraft(String(currentPage));
                    }
                  }}
                  className="h-7 w-12 rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 px-2 text-xs text-oai-gray-700 dark:text-oai-gray-300 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-oai-brand/50 focus:border-oai-brand"
                  aria-label={copy("ticket04.request.page_jump")}
                />
                <button
                  type="button"
                  onClick={() => {
                    // Jump to page in draft input
                    const page = parseInt(pageDraft, 10);
                    if (!isNaN(page)) {
                      const clampedPage = Math.max(1, Math.min(totalPages, page));
                      setCurrentPage(clampedPage);
                      setPageDraft(String(clampedPage));
                    } else {
                      setCurrentPage(1);
                      setPageDraft("1");
                    }
                  }}
                  className="inline-flex h-7 items-center rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 px-2 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 transition-colors"
                >
                  {copy("ticket04.request.page_jump_btn")}
                </button>
                <span className="text-oai-gray-400 whitespace-nowrap">
                  {copy("ticket04.request.page_of", { total: totalPages })}
                </span>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-oai-black dark:text-oai-white">
            {copy("ticket04.request.title")}
          </h3>
          <p className="text-xs text-oai-gray-500 dark:text-oai-gray-400 mt-0.5">
            {copy("ticket04.request.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              handlePageChange(1);
            }}
            className="h-8 px-2.5 text-xs font-medium rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-oai-white dark:bg-oai-gray-900 text-oai-black dark:text-oai-white hover:border-oai-gray-400 dark:hover:border-oai-gray-600 focus:outline-none focus:ring-2 focus:ring-oai-brand/50 focus:border-oai-brand"
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

      {totals && (
        <div className="mb-4 grid grid-cols-3 gap-2" data-testid="request-log-metrics">
          <div data-testid="request-log-metric-requests" className="rounded-xl bg-oai-gray-50 px-3 py-2.5 dark:bg-oai-gray-800/70">
            <div className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("usage.request_log.metric.requests")}</div>
            <div className="mt-1 text-sm font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">{formatFullNum(totals.request_count)}</div>
          </div>
          <div data-testid="request-log-metric-success-rate" className="rounded-xl bg-emerald-50/70 px-3 py-2.5 dark:bg-emerald-950/20">
            <div className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("usage.request_log.metric.success_rate")}</div>
            <div className="mt-1 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {totals.success_rate === null || totals.success_rate === undefined ? copy("ticket06.metric.unavailable") : `${safeNum(totals.success_rate).toFixed(1)}%`}
            </div>
          </div>
          <div data-testid="request-log-metric-avg-latency" className="rounded-xl bg-oai-gray-50 px-3 py-2.5 dark:bg-oai-gray-800/70">
            <div className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("usage.request_log.metric.avg_latency")}</div>
            <div className="mt-1 text-sm font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">{formatAverageLatency(totals.avg_latency_ms)}</div>
          </div>
        </div>
      )}

      {body}
    </Card>
  );
}
