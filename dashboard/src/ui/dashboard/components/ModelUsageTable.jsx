import React, { useMemo, useState } from "react";
import { Loader2, AlertCircle, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { Card } from "../../components";
import { useCurrency } from "../../../hooks/useCurrency";
import { copy } from "../../../lib/copy";
import { getCurrencySymbol } from "../../../lib/currency";
import { formatChineseTokenCount, formatUsdCurrency } from "../../../lib/format";
import { useModelStats } from "../../../hooks/use-model-stats";

/**
 * TICKET-04 C: 模型统计表格（6 列）。
 *
 * 列序：模型(+下方小字供应商名) / 请求数 / Tokens / 成本 / 成功率 / 平均延迟。
 *
 * 数据源：useModelStats Hook（工单1），与统计面板/趋势图共用
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

function formatCost(value, currency, rate) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return `${getCurrencySymbol(currency)}0`;
  return formatUsdCurrency(n, { decimals: n < 1 ? 4 : 2, currency, rate });
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

const COLUMNS = [
  { id: "model", labelKey: "ticket04.model.column.model", field: "model", align: "left" },
  { id: "requests", labelKey: "ticket04.model.column.requests", field: "request_count", align: "right" },
  { id: "tokens", labelKey: "ticket04.model.column.tokens", field: "tokens", align: "right" },
  { id: "cost", labelKey: "ticket04.model.column.cost", field: "cost_usd", align: "right" },
  { id: "success_rate", labelKey: "ticket04.model.column.success_rate", field: "success_rate", align: "right" },
  { id: "avg_latency", labelKey: "ticket04.model.column.avg_latency", field: "avg_latency_ms", align: "right" },
];

export function ModelUsageTable({
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
  const [sortKey, setSortKey] = useState("tokens");
  const [sortDir, setSortDir] = useState("desc");

  const { models, loading, error, refresh } = useModelStats({
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
    const list = Array.isArray(models?.models) ? models.models : [];
    const meta = COLUMNS.find((c) => c.id === sortKey);
    if (!meta) return list;
    const dir = sortDir === "asc" ? 1 : -1;
    const field = meta.field;
    return [...list].sort((a, b) => {
      let av = a[field];
      let bv = b[field];
      if (field === "model") {
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
  }, [models, sortKey, sortDir]);

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
  if (loading && (!models || !models.models || models.models.length === 0)) {
    body = (
      <div className="flex items-center justify-center py-8" role="status" aria-label={copy("ticket04.model.loading")}>
        <Loader2 size={20} className="text-oai-gray-400 dark:text-oai-gray-500 animate-spin" />
      </div>
    );
  } else if (error && (!models || !models.models || models.models.length === 0)) {
    body = (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <AlertCircle size={20} className="text-red-500 dark:text-red-400" aria-hidden="true" />
        <span className="text-sm text-red-500 dark:text-red-400">{copy("ticket04.model.error")}</span>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-10 items-center rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 px-3 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 transition-colors"
        >
          {copy("ticket04.model.retry")}
        </button>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="text-center py-8 text-sm text-oai-gray-500 dark:text-oai-gray-400">
        {copy("ticket04.model.empty")}
      </div>
    );
  } else {
    body = (
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
                      aria-label={copy("ticket04.model.sort_aria", { column: copy(col.labelKey) })}
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
              const providerLabel = row.source_display_name || row.source;
              return (
                <tr
                  key={`${row.source}-${row.model}-${idx}`}
                  className="border-b border-oai-gray-100 dark:border-oai-gray-800 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50 transition-colors"
                >
                  <td className="px-3 py-2 text-sm font-medium text-oai-black dark:text-oai-white whitespace-nowrap">
                    <div className="flex flex-col leading-tight">
                      <span className="truncate max-w-[200px]" title={row.model}>{row.model}</span>
                      {providerLabel && (
                        <span className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500 truncate max-w-[200px]" title={providerLabel}>
                          {providerLabel}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-oai-gray-600 dark:text-oai-gray-300 whitespace-nowrap text-right tabular-nums">
                    {row.request_count === null || row.request_count === undefined ? copy("ticket06.metric.unavailable") : formatFullNum(row.request_count)}
                  </td>
                  <td className="px-3 py-2 text-sm text-oai-gray-600 dark:text-oai-gray-300 whitespace-nowrap text-right tabular-nums">
                    {formatTokensCompact(row.tokens)}
                  </td>
                  <td className="px-3 py-2 text-sm text-oai-brand whitespace-nowrap text-right tabular-nums">
                    {formatCost(row.cost_usd, currency, rate)}
                  </td>
                  <td className="px-3 py-2 text-sm whitespace-nowrap text-right tabular-nums">
                    {row.success_rate === null || row.success_rate === undefined ? (
                      <span className="text-oai-gray-400 dark:text-oai-gray-500">{copy("ticket06.metric.unavailable")}</span>
                    ) : (
                      <span
                        className={
                          safeNum(row.success_rate) >= 100
                            ? "text-emerald-600 dark:text-emerald-400 font-medium"
                            : "text-orange-600 dark:text-orange-400 font-medium"
                        }
                      >
                        {formatSuccessRate(row.success_rate)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-oai-gray-600 dark:text-oai-gray-300 whitespace-nowrap text-right tabular-nums">
                    {formatLatency(row.avg_latency_ms)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Card className="mt-4">
      {body}
    </Card>
  );
}
