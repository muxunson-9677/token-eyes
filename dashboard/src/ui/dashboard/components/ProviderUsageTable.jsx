import React, { useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { Card } from "../../components";
import { useCurrency } from "../../../hooks/useCurrency";
import { copy } from "../../../lib/copy";
import { getCurrencySymbol } from "../../../lib/currency";
import { formatChineseTokenCount, formatUsdCurrency } from "../../../lib/format";
import { useProviderStats } from "../../../hooks/use-provider-stats";
import { ProviderIcon } from "./ProviderIcon.jsx";

/**
 * TICKET-04 B: Provider 统计表格（6 列）。
 *
 * 列序：供应商(+圆点) / 请求数 / Tokens / 成本 / 成功率 / 平均延迟。
 *
 * 数据源：useProviderStats Hook（工单1），与统计面板/趋势图共用
 * useUsageFilters 状态，保证三位一体口径一致。
 *
 * 交互：默认按 Tokens 降序，点击任意列标题切换升/降序。
 */

function safeNum(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function formatTokensCompact(value) {
  const n = safeNum(value);
  return formatChineseTokenCount(n);
}

function formatFullNum(value) {
  return safeNum(value).toLocaleString();
}

function resolveRequestCount(row) {
  if (row?.request_count_basis !== "request_event") return null;
  return row?.request_count ?? null;
}

function formatCost(value, currency, rate, pricingCoverage) {
  if (pricingCoverage === "unpriced") return copy("ticket06.metric.unavailable");
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return copy("ticket06.metric.unavailable");
  const formatted = n === 0
    ? `${getCurrencySymbol(currency)}0`
    : formatUsdCurrency(n, { decimals: n < 1 ? 4 : 2, currency, rate });
  return pricingCoverage === "partial" ? `${formatted}+` : formatted;
}

function formatLatency(ms) {
  if (ms === null || ms === undefined) {
    return copy("ticket06.metric.unavailable");
  }
  const n = safeNum(ms);
  if (n <= 0) return "-";
  return `${Math.round(n)}ms`;
}

function formatSuccessRate(rate) {
  if (rate === null || rate === undefined) {
    return copy("ticket06.metric.unavailable");
  }
  const n = safeNum(rate);
  return `${n.toFixed(1)}%`;
}

// All 6 columns are sortable. `field` is the ProviderStat key used for compare.
const COLUMNS = [
  { id: "provider", labelKey: "ticket04.provider.column.provider", field: "display_name", align: "left" },
  { id: "requests", labelKey: "ticket04.provider.column.requests", field: "request_count", align: "right" },
  { id: "tokens", labelKey: "ticket04.provider.column.tokens", field: "tokens", align: "right" },
  { id: "cost", labelKey: "ticket04.provider.column.cost", field: "cost_usd", align: "right" },
  { id: "success_rate", labelKey: "ticket04.provider.column.success_rate", field: "success_rate", align: "right" },
  { id: "avg_latency", labelKey: "ticket04.provider.column.avg_latency", field: "avg_latency_ms", align: "right" },
];

export function ProviderUsageTable({
  from,
  to,
  timeZone,
  tzOffsetMinutes,
  baseUrl,
  accessToken = null,
  guestAllowed = true,
  cacheKey,
  visibleProviderIds,
}) {
  const { currency, rate } = useCurrency();
  // Default sort: tokens descending.
  const [sortKey, setSortKey] = useState("tokens");
  const [sortDir, setSortDir] = useState("desc");

  const { providers, source, loading, error, refresh } = useProviderStats({
    baseUrl,
    accessToken,
    guestAllowed,
    from,
    to,
    cacheKey,
    timeZone,
    tzOffsetMinutes,
    allowedSources: visibleProviderIds,
  });

  const rows = useMemo(() => {
    const list = Array.isArray(providers?.providers) ? providers.providers : [];
    const meta = COLUMNS.find((c) => c.id === sortKey);
    if (!meta) return list;
    const dir = sortDir === "asc" ? 1 : -1;
    const field = meta.field;
    return [...list].sort((a, b) => {
      let av = field === "request_count" ? resolveRequestCount(a) : a[field];
      let bv = field === "request_count" ? resolveRequestCount(b) : b[field];
      if (field === "display_name") {
        av = a.display_name || a.provider_id;
        bv = b.display_name || b.provider_id;
        av = String(av || "").toLowerCase();
        bv = String(bv || "").toLowerCase();
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      }
      av = safeNum(av);
      bv = safeNum(bv);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [providers, sortKey, sortDir]);

  const handleSort = (colId) => {
    if (colId === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(colId);
      setSortDir("desc");
    }
  };

  const renderSortIcon = (colId) => {
    if (colId !== sortKey) {
      return <ChevronsUpDown className="h-3 w-3 text-oai-gray-400 dark:text-oai-gray-600" aria-hidden="true" />;
    }
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 text-oai-brand-500" aria-hidden="true" />
      : <ChevronDown className="h-3 w-3 text-oai-brand-500" aria-hidden="true" />;
  };

  let body;
  if (loading && (!providers || !providers.providers || providers.providers.length === 0)) {
    body = (
      <div className="flex items-center justify-center py-8" role="status" aria-label={copy("ticket04.provider.loading")}>
        <Loader2 size={20} className="text-oai-gray-400 dark:text-oai-gray-500 animate-spin" />
      </div>
    );
  } else if (error && (!providers || !providers.providers || providers.providers.length === 0)) {
    body = (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <AlertCircle size={20} className="text-red-500 dark:text-red-400" aria-hidden="true" />
        <span className="text-sm text-red-500 dark:text-red-400">{copy("ticket04.provider.error")}</span>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-10 items-center rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 px-3 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 transition-colors"
        >
          {copy("ticket04.provider.retry")}
        </button>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="text-center py-8 text-sm text-oai-gray-500 dark:text-oai-gray-400">
        {copy("ticket04.provider.empty")}
      </div>
    );
  } else {
    body = (
      <>
        {error || source === "cache" ? (
          <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" role="alert">
            <span>{error ? copy("ticket04.provider.error") : copy("observability.evidence.cached")}</span>
            {error ? (
              <button type="button" onClick={refresh} className="shrink-0 rounded-md border border-amber-300 px-2 py-1 font-medium dark:border-amber-800">
                {copy("ticket04.provider.retry")}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-oai-gray-200 dark:border-oai-gray-700">
              {COLUMNS.map((col) => {
                const align = col.align === "right" ? "text-right" : "text-left";
                return (
                  <th
                    key={col.id}
                    className={`px-3 py-2 font-medium text-oai-gray-500 dark:text-oai-gray-400 whitespace-nowrap ${align}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(col.id)}
                      aria-label={copy("ticket04.provider.sort_aria", { column: copy(col.labelKey) })}
                      className="inline-flex items-center gap-1 hover:text-oai-gray-700 dark:hover:text-oai-gray-200 transition-colors"
                    >
                      {copy(col.labelKey)}
                      {renderSortIcon(col.id)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const providerId = row.provider_id;
              const providerLabel = row.display_name || providerId;
              const requestCount = resolveRequestCount(row);
              return (
                <tr
                  key={`${providerId}-${idx}`}
                  className="border-b border-oai-gray-100 dark:border-oai-gray-800 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50 transition-colors"
                >
                  <td className="px-3 py-2 text-sm font-medium text-oai-black dark:text-oai-white whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-oai-gray-200 bg-white dark:border-oai-gray-700 dark:bg-oai-gray-900">
                        <ProviderIcon provider={providerId} size={17} />
                      </span>
                      <span className="break-words" title={providerLabel}>{providerLabel}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-oai-gray-600 dark:text-oai-gray-300 whitespace-nowrap text-right tabular-nums">
                    {requestCount === null
                      ? copy("spend.usage.metric.request_total_unavailable")
                      : formatFullNum(requestCount)}
                  </td>
                  <td className="px-3 py-2 text-sm text-oai-gray-600 dark:text-oai-gray-300 whitespace-nowrap text-right tabular-nums">
                    {formatTokensCompact(row.tokens)}
                  </td>
                  <td className="px-3 py-2 text-sm text-oai-brand whitespace-nowrap text-right tabular-nums">
                    <span title={row.pricing_coverage === "partial" ? copy("ticket06.pricing.partial_hint") : undefined}>
                      {formatCost(row.cost_usd, currency, rate, row.pricing_coverage)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm whitespace-nowrap text-right tabular-nums">
                    {row.success_rate === null || row.success_rate === undefined ? (
                      <span className="text-oai-gray-400 dark:text-oai-gray-500">
                        {copy(
                          safeNum(row.status_sample_count) > 0 && safeNum(row.success_rate_sample_count) === 0
                            ? "spend.usage.metric.no_completed_status_samples"
                            : "spend.usage.metric.no_status_samples",
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex flex-col items-end">
                        <span
                          className={
                            safeNum(row.success_rate) >= 100
                              ? "text-emerald-600 dark:text-emerald-400 font-medium"
                              : "text-orange-600 dark:text-orange-400 font-medium"
                          }
                        >
                          {formatSuccessRate(row.success_rate)}
                        </span>
                        <span className="text-[10px] font-normal text-oai-gray-400 dark:text-oai-gray-500">
                          {copy("spend.usage.metric.sample_count", { count: safeNum(row.success_rate_sample_count) })}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-oai-gray-600 dark:text-oai-gray-300 whitespace-nowrap text-right tabular-nums">
                    {row.avg_latency_ms === null || row.avg_latency_ms === undefined
                      ? copy("spend.usage.metric.no_latency_samples")
                      : <span className="inline-flex flex-col items-end">
                        <span>{formatLatency(row.avg_latency_ms)}</span>
                        <span className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
                          {copy("spend.usage.metric.sample_count", { count: safeNum(row.latency_sample_count) })}
                        </span>
                      </span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </>
    );
  }

  return (
    <Card className="mt-4">
      {body}
    </Card>
  );
}
