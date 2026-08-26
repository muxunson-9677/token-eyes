import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronRight, Info, RefreshCw, SquareArrowOutUpRight, Loader2 } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "../../components";
import { useCurrency } from "../../../hooks/useCurrency.js";
import { copy, getCopyLocale } from "../../../lib/copy";
import { CURRENCY_USD, getCurrencySymbol } from "../../../lib/currency";
import { DateRangePopover, formatDateShort, getDateFnsLocale } from "./DateRangePopover.jsx";
import { ProviderIcon } from "./ProviderIcon.jsx";
import { formatChineseTokenCount, formatCompactNumber, formatUsdCurrency } from "../../../lib/format";
import { ContextBreakdownPanel } from "./ContextBreakdownPanel.jsx";
import { getWorkbuddyQuota } from "../../../lib/api";
import {
  BILLING_FILTERS,
  filterFleetByBillingMode,
  normalizeBillingFilterValue,
} from "../../../lib/model-breakdown";

const BILLING_BADGE_STYLES = {
  api_key: "bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300",
  token_plan: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  unknown: "bg-oai-gray-100 text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400",
  mixed: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
};

function BillingBadge({ mode, copyKey, label, className = "" }) {
  const style = BILLING_BADGE_STYLES[mode] || BILLING_BADGE_STYLES.unknown;
  return (
    <span
      className={`inline-flex items-center shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${style} ${className}`}
    >
      {label || copy(copyKey)}
    </span>
  );
}

function formatTokens(value) {
  if (!Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (n <= 0) return null;
  return formatChineseTokenCount(n);
}

function formatCost(value, currency, rate) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const symbol = getCurrencySymbol(currency);
  const converted = currency === CURRENCY_USD ? n : n * rate;
  if (converted < 0.01) return `<${symbol}0.01`;
  return formatUsdCurrency(n, { decimals: 2, currency, rate });
}

function normalizePeriods(periods) {
  if (!Array.isArray(periods)) return [];
  return periods.map((p) => {
    if (typeof p === "string") {
      return { key: p, label: getPeriodLabel(p) };
    }
    return { key: p.key, label: p.label || getPeriodLabel(p.key) };
  });
}

// Provider color mapping for visual distinction.
// TICKET-04: exported for reuse by RequestUsageLog / ProviderUsageTable /
// ModelUsageTable so the colored provider dot stays consistent across views.
export const PROVIDER_COLORS = {
  CODEX: "#3b82f6",     // blue-500
  CLAUDE: "#f97316",    // orange-500
  CURSOR: "#8b5cf6",    // violet-500
  TRAE: "#2563eb",      // blue-600
  HERMES: "#10b981",    // emerald-500
  OPENCODE: "#f59e0b",  // amber-500
  GEMINI: "#2196f3",    // Google Gemini bright blue
  KIMI: "#a78bfa",      // violet-400
  "KILO-CLI": "#facc15",   // yellow-400 (Kilo brand yellow)
  "KILO-CODE": "#facc15",
  DROID: "#ef4444",        // red-500 (Factory brand)
  KILOCODE: "#facc15",
  ROOCODE: "#f97316",   // orange-500
  GROK: "#111827",
  COPILOT: "#24292f",
};

export function getProviderColor(label, index) {
  const normalized = label?.toUpperCase?.() || "";
  return PROVIDER_COLORS[normalized] || `hsl(${150 + index * 40}, 60%, 45%)`;
}

function resolveContextBreakdownSource(provider) {
  const source = String(provider?.source || "").trim().toLowerCase();
  const label = String(provider?.label || "").trim().toLowerCase();
  if (source === "claude" || label === "claude") return "claude";
  if (source === "codex" || label === "codex") return "codex";
  return null;
}

const PERIOD_COPY_KEYS = {
  day: "usage.period.day",
  week: "usage.period.week",
  "30d": "usage.period.30d",
  month: "usage.period.month",
  total: "usage.period.total",
  custom: "usage.period.custom",
};

function getPeriodLabel(key) {
  const copyKey = PERIOD_COPY_KEYS[key];
  return copyKey ? copy(copyKey) : String(key).toUpperCase();
}

// Refresh button with rotation animation
function RefreshButton({ loading, onClick }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <Button
      variant="secondary"
      size="md"
      disabled={loading}
      onClick={onClick}
      aria-label={copy("usage.button.refresh")}
      className="w-10 p-0"
    >
      <motion.span
        aria-hidden="true"
        animate={loading ? { rotate: 360 } : { rotate: 0 }}
        transition={
          loading && !shouldReduceMotion
            ? { duration: 1, repeat: Infinity, ease: "linear" }
            : { duration: 0.3 }
        }
        style={{ display: "inline-flex" }}
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
      </motion.span>
    </Button>
  );
}

const REFRESH_INTERVALS = [
  { value: "manual", label: "dashboard.refresh.interval.manual" },
  { value: "30s", label: "dashboard.refresh.interval.30s" },
  { value: "1m", label: "dashboard.refresh.interval.1m" },
  { value: "5m", label: "dashboard.refresh.interval.5m" },
];

function formatLastUpdated(date) {
  if (!date) return null;
  const d = new Date(date);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const CONFIDENCE_BADGE_STYLES = {
  exact: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  estimated: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  stale: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  unavailable: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
  unattributed: "bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200",
};

function buildCompactEvidenceDetail(confidence, fallbackUpdatedAt) {
  if (!confidence) return "";
  const updatedAt = confidence.observedAt || confidence.lastSuccessAt || fallbackUpdatedAt;
  const parts = [confidence.sourceLabel];
  const updatedTime = formatLastUpdated(updatedAt);
  if (updatedTime) {
    parts.push(copy("dashboard.refresh.last_updated", { time: updatedTime }));
  }
  if (confidence.estimationMethod) parts.push(confidence.estimationMethod);
  if (confidence.states?.includes("partial") && confidence.coveragePercent != null) {
    parts.push(copy("data.confidence.partial_detail", {
      coverage: confidence.coveragePercent,
    }));
  }
  return parts.filter(Boolean).join(" · ");
}

function CompactEvidenceCell({
  label,
  value,
  confidence,
  fallbackUpdatedAt,
  onInfo,
  onOpenDiagnostics,
  testId,
  className = "",
}) {
  const states = Array.isArray(confidence?.states) && confidence.states.length
    ? confidence.states
    : confidence?.state
      ? [confidence.state]
      : [];
  const detail = buildCompactEvidenceDetail(confidence, fallbackUpdatedAt);

  return (
    <div
      className={`grid min-w-0 grid-rows-[1.25rem_1.5rem] gap-0.5 py-1.5 ${className}`}
      data-testid={testId}
    >
      <div
        className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] leading-5"
        data-testid={`${testId}-heading`}
      >
        <span className="shrink-0 text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
        {value ? (
          onInfo ? (
            <button
              type="button"
              onClick={onInfo}
              className="inline-flex min-w-0 items-center gap-1 rounded font-semibold text-oai-gray-800 transition-colors hover:text-oai-brand dark:text-oai-gray-100 dark:hover:text-oai-brand-light"
              aria-label={copy("usage.overview.cost_breakdown_aria")}
              title={value}
            >
              <span className="truncate">{value}</span>
              <Info size={12} strokeWidth={2} className="shrink-0 text-oai-brand" />
            </button>
          ) : (
            <span className="min-w-0 truncate font-semibold text-oai-gray-800 dark:text-oai-gray-100" title={value}>
              {value}
            </span>
          )
        ) : null}
      </div>
      <div
        className="flex min-w-0 items-center gap-1 overflow-hidden text-[10px] leading-4 text-oai-gray-500 dark:text-oai-gray-400"
        data-confidence-state={confidence?.state}
        data-testid={`${testId === "usage-token-summary" ? "usage-token" : "usage-cost"}-confidence`}
      >
        {states.map((state) => (
          <span
            key={state}
            className={`inline-flex shrink-0 rounded-full px-1.5 py-0.5 font-semibold ${CONFIDENCE_BADGE_STYLES[state] || CONFIDENCE_BADGE_STYLES.exact}`}
          >
            {copy(`data.confidence.${state}`)}
          </span>
        ))}
        {detail ? (
          <span className="min-w-0 flex-1 truncate" title={detail}>{detail}</span>
        ) : null}
        {onOpenDiagnostics ? (
          <button
            type="button"
            onClick={onOpenDiagnostics}
            className="inline-flex min-h-6 shrink-0 items-center rounded px-1 font-semibold text-oai-brand hover:bg-oai-brand-50 dark:hover:bg-oai-brand-500/10"
          >
            {copy("data.confidence.open_diagnostics")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function splitSummaryValue(value) {
  const text = String(value ?? "");
  const match = text.match(/^(.+?)([^\d\s.,+-]+)$/u);
  if (!match) return { number: text, unit: "" };
  return { number: match[1].trimEnd(), unit: match[2] };
}

export function UsageOverview({
  period,
  periods,
  onPeriodChange,
  summaryValue,
  summaryLabel,
  summaryCostValue,
  summaryConversationsValue,
  averageUsageValue,
  trendRows = [],
  dayOverDayPercent: dayOverDayPercentOverride,
  cacheHitSummary,
  onCostInfo,
  fleetData = [],
  onRefresh,
  loading,
  className = "",
  customFrom,
  customTo,
  onCustomRangeApply,
  customRangeOpen,
  onCustomRangeOpenChange,
  onOpenShare,
  from,
  to,
  refreshInterval,
  onRefreshIntervalChange,
  lastUpdatedAt,
  tokenConfidence,
  costConfidence,
  onOpenDiagnostics,
}) {
  const tabs = normalizePeriods(periods);
  const dateLocale = getDateFnsLocale(getCopyLocale());
  // Keep the selected period chip in view when the tab strip scrolls
  // horizontally on narrow screens.
  const tablistRef = useRef(null);
  useEffect(() => {
    const el = tablistRef.current?.querySelector('[aria-selected="true"]');
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [period]);
  const [expandedProvider, setExpandedProvider] = useState(null);
  // Q02: 计费方式筛选器状态。Q02 不会改变父组件 prop 协议；只看 fleetData
  // 自带的 billingMode 元数据并基于本组件 state 重新计算。
  const [billingFilter, setBillingFilter] = useState("all");
  const { currency, rate } = useCurrency();
  const summaryValueParts = splitSummaryValue(summaryValue);

  // FleetData is already grouped by provider. The filter recomputes per-source
  // usage/cost/share against the filtered grand total so the rendered numbers
  // stay self-consistent under whichever billing mode the user picked.
  const providers = useMemo(
    () => filterFleetByBillingMode(fleetData, billingFilter),
    [fleetData, billingFilter],
  );
  const hasAnyFleetModel = useMemo(
    () =>
      (Array.isArray(fleetData) ? fleetData : []).some((entry) =>
        Array.isArray(entry?.models) ? entry.models.length > 0 : false,
      ),
    [fleetData],
  );
  const safeBillingFilter = normalizeBillingFilterValue(billingFilter);
  const dailyTrendValues = useMemo(
    () => (Array.isArray(trendRows) ? trendRows : [])
      .map((row) => Number(row?.billable_total_tokens ?? row?.total_tokens))
      .filter((value) => Number.isFinite(value)),
    [trendRows],
  );
  const previousDailyValue = dailyTrendValues.at(-2);
  const latestDailyValue = dailyTrendValues.at(-1);
  const dayOverDayPercent = Number.isFinite(Number(dayOverDayPercentOverride))
    ? Number(dayOverDayPercentOverride)
    : Number.isFinite(previousDailyValue) && previousDailyValue !== 0 && Number.isFinite(latestDailyValue)
      ? ((latestDailyValue - previousDailyValue) / Math.abs(previousDailyValue)) * 100
      : null;
  const overviewMetrics = [
    dayOverDayPercent == null ? null : {
      key: "day-over-day",
      label: "环比昨日",
      value: `${dayOverDayPercent >= 0 ? "↑" : "↓"} ${Math.abs(dayOverDayPercent).toFixed(1)}%`,
      positive: dayOverDayPercent >= 0,
    },
    Number.isFinite(Number(averageUsageValue)) ? {
      key: "daily-average",
      label: "日均用量",
      value: formatCompactNumber(averageUsageValue, {
        thousandSuffix: "K",
        millionSuffix: "M",
        billionSuffix: "B",
      }),
    } : null,
    summaryConversationsValue != null ? {
      key: "conversations",
      label: "总对话数",
      value: formatCompactNumber(summaryConversationsValue, {
        thousandSuffix: "K",
        millionSuffix: "M",
        billionSuffix: "B",
      }),
    } : null,
  ].filter(Boolean);

  const billingFilterCopyKeys = {
    all: "usage.billing_filter.all",
    api_key: "usage.billing_filter.api_key",
    token_plan: "usage.billing_filter.token_plan",
    unknown: "usage.billing_filter.unknown",
  };
  const billingModeCopyKeys = {
    api_key: "usage.billing_mode.api_key",
    token_plan: "usage.billing_mode.token_plan",
    unknown: "usage.billing_mode.unknown",
    mixed: "usage.billing_mode.mixed",
  };

  return (
    <div className={`tt-overview-usage tt-overview-aligned-stack flex h-full flex-col gap-4 ${className}`}>
      <section
        data-testid="usage-overview-hero"
        className="tt-overview-usage-hero tt-surface tt-pressable-group rounded-[var(--tt-card-radius)]"
      >
        <div className="flex h-full flex-col p-5">
        {/* Header: Period Tabs + Refresh. Tabs are a single horizontal-scroll
            strip (never wrap into stacked rows); actions stay pinned right. */}
        <div className="mb-6 flex flex-wrap items-center gap-2 lg:flex-nowrap">
          <div ref={tablistRef} role="tablist" aria-label={copy("usage.overview.tablist_aria")} className="order-2 flex w-full min-w-0 flex-none gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:order-none lg:w-auto lg:flex-1">
            {tabs.map((p) => {
              const isActive = period === p.key;
              const tabClass = `min-h-10 shrink-0 whitespace-nowrap text-xs font-medium px-3 py-2 rounded-md transition-colors ${
                isActive
                  ? "bg-oai-brand-50 text-oai-brand-700 ring-1 ring-inset ring-oai-brand-200 dark:bg-oai-brand-500/15 dark:text-oai-brand-200 dark:ring-oai-brand-500/30"
                  : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800"
              }`;

              if (p.key === "custom") {
                const customLabel = isActive && customFrom && customTo
                  ? `${formatDateShort(customFrom, dateLocale)} - ${formatDateShort(customTo, dateLocale)}`
                  : p.label;

                return (
                  <Popover.Root
                    key="custom"
                    open={customRangeOpen}
                    onOpenChange={(open) => {
                      if (open) onPeriodChange?.("custom");
                      else onCustomRangeOpenChange?.(open);
                    }}
                  >
                    <Popover.Trigger
                      render={
                        <button
                          role="tab"
                          aria-selected={isActive}
                          type="button"
                          className={tabClass}
                        />
                      }
                    >
                      {customLabel}
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Positioner sideOffset={8} side="bottom" align="start" className="!z-[9999]">
                        <Popover.Popup className="bg-white dark:bg-oai-gray-900 border border-oai-gray-200 dark:border-oai-gray-700 rounded-xl shadow-lg">
                          <DateRangePopover
                            from={customFrom}
                            to={customTo}
                            onApply={onCustomRangeApply}
                            onCancel={() => onCustomRangeOpenChange?.(false)}
                          />
                        </Popover.Popup>
                      </Popover.Positioner>
                    </Popover.Portal>
                  </Popover.Root>
                );
              }

              return (
                <button
                  key={p.key}
                  role="tab"
                  aria-selected={isActive}
                  type="button"
                  className={tabClass}
                  onClick={() => onPeriodChange?.(p.key)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:ml-0">
            {onOpenShare ? (
              <button
                type="button"
                onClick={onOpenShare}
                aria-label={copy("share.button.aria")}
                className="tt-product-focusable inline-flex h-10 items-center justify-center gap-1.5 px-3 text-xs font-medium rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-oai-white dark:bg-oai-gray-900 text-oai-black dark:text-oai-white hover:border-oai-brand hover:text-oai-brand transition-colors duration-200"
              >
                <SquareArrowOutUpRight className="h-3.5 w-3.5" strokeWidth={2} />
                {copy("share.button.label")}
              </button>
            ) : null}
            {onRefreshIntervalChange && (
              <select
                value={refreshInterval || "1m"}
                onChange={(e) => onRefreshIntervalChange(e.target.value)}
                className="tt-product-focusable h-10 px-2.5 text-xs font-medium rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-oai-white dark:bg-oai-gray-900 text-oai-black dark:text-oai-white hover:border-oai-gray-400 dark:hover:border-oai-gray-600 focus:outline-none focus:ring-2 focus:ring-oai-brand/50 focus:border-oai-brand"
                aria-label={copy("dashboard.refresh.interval.label")}
              >
                {REFRESH_INTERVALS.map((interval) => (
                  <option key={interval.value} value={interval.value}>
                    {copy(interval.label)}
                  </option>
                ))}
              </select>
            )}
            {onRefresh && (
              <RefreshButton loading={loading} onClick={onRefresh} />
            )}
            {lastUpdatedAt != null && (
              <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                {copy("dashboard.refresh.last_updated", { time: formatLastUpdated(lastUpdatedAt) })}
              </span>
            )}
          </div>
        </div>

        {/* One summary surface: the Token total is the only visual anchor.
            Confidence and cost evidence share the compact footer below it. */}
        {(summaryValue != null || summaryCostValue || tokenConfidence || costConfidence) ? (
          <section
            className="tt-surface-nested tt-pressable mb-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl"
            data-testid="usage-overview-summary-card"
          >
            {summaryValue != null ? (
              <div
                className="tt-overview-primary-total relative flex min-h-64 flex-1 flex-col items-center justify-start overflow-hidden px-4 py-2 text-center sm:min-h-72"
                data-testid="usage-primary-total"
              >
                <div className="relative z-10 mb-4 text-[11px] font-medium uppercase tracking-[0.16em] text-oai-gray-500 dark:text-oai-gray-300">
                  {summaryLabel}
                </div>
                <div
                  aria-label={String(summaryValue)}
                  data-testid="usage-summary-value"
                  className="relative z-10 inline-flex items-baseline justify-center max-sm:text-6xl text-7xl font-bold leading-none tabular-nums text-oai-black dark:text-oai-white xl:text-[100px]"
                >
                  <span className="tt-overview-total-number" data-testid="usage-summary-number">{summaryValueParts.number}</span>
                  {summaryValueParts.unit ? (
                    <span className="tt-overview-total-unit" data-testid="usage-summary-unit">{summaryValueParts.unit}</span>
                  ) : null}
                </div>
                <div className="tt-overview-token-wave-stage" data-testid="usage-token-wave-stage" aria-hidden="true">
                  <svg
                    data-testid="usage-token-wave"
                    className="tt-overview-token-wave"
                    viewBox="0 0 728 260"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <linearGradient id="token-wave-mint" x1="0" x2="1">
                        <stop offset="0" stopColor="var(--tt-token-wave-mint)" stopOpacity="0" />
                        <stop offset="0.48" stopColor="var(--tt-token-wave-mint)" stopOpacity="0.22" />
                        <stop offset="1" stopColor="var(--tt-token-wave-mint)" stopOpacity="0" />
                      </linearGradient>
                      <linearGradient id="token-wave-blue" x1="0" x2="1">
                        <stop offset="0" stopColor="var(--tt-token-wave-blue)" stopOpacity="0" />
                        <stop offset="0.58" stopColor="var(--tt-token-wave-blue)" stopOpacity="0.18" />
                        <stop offset="1" stopColor="var(--tt-token-wave-blue)" stopOpacity="0" />
                      </linearGradient>
                      <filter id="token-wave-blur"><feGaussianBlur stdDeviation="4" /></filter>
                    </defs>
                    <g fill="none" filter="url(#token-wave-blur)" transform="translate(0 -27)">
                      <path d="M-35 104 C118 86 190 196 348 202 C514 208 600 84 770 94" stroke="url(#token-wave-mint)" strokeWidth="12" />
                      <path d="M-35 126 C126 106 194 224 356 225 C526 226 612 104 770 112" stroke="url(#token-wave-mint)" strokeWidth="6" />
                      <path d="M-40 82 C126 72 202 177 362 187 C528 197 612 73 768 69" stroke="url(#token-wave-blue)" strokeWidth="12" />
                      <path d="M-40 147 C132 130 214 246 372 238 C538 230 618 121 770 132" stroke="url(#token-wave-blue)" strokeWidth="6" />
                    </g>
                    <g fill="none" filter="url(#token-wave-blur)" transform="translate(0 -44)">
                      <ellipse cx="364" cy="214" rx="139" ry="28" stroke="url(#token-wave-blue)" strokeWidth="6" />
                      <ellipse cx="364" cy="215" rx="91" ry="17" stroke="url(#token-wave-mint)" strokeWidth="6" />
                    </g>
                    <ellipse cx="364" cy="171" rx="56" ry="9" fill="var(--tt-token-wave-highlight)" fillOpacity="0.72" />
                  </svg>
                </div>
                {overviewMetrics.length > 0 ? (
                  <div className="relative z-10 grid grid-cols-3 gap-8" data-testid="usage-overview-metrics">
                    {overviewMetrics.map((metric) => (
                      <div key={metric.key} className="tt-overview-mini-metric tt-pressable min-w-[106px] rounded-xl px-4 py-2.5">
                        <div className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{metric.label}</div>
                        <div className={`mt-1 text-base font-semibold tabular-nums ${metric.positive === true ? "text-emerald-500" : metric.positive === false ? "text-red-500" : "text-oai-black dark:text-white"}`}>
                          {metric.value}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div
              className={`grid min-w-0 grid-cols-1 border-oai-gray-200 px-3 dark:border-oai-gray-700 sm:grid-cols-2 ${summaryValue != null ? "border-t" : ""}`}
              data-testid="usage-summary-details"
            >
              <CompactEvidenceCell
                label={copy("usage.overview.usage_evidence_label")}
                confidence={tokenConfidence}
                fallbackUpdatedAt={lastUpdatedAt}
                onOpenDiagnostics={onOpenDiagnostics}
                testId="usage-token-summary"
              />
              <CompactEvidenceCell
                label={copy("dashboard.cost_breakdown.total_label")}
                value={summaryCostValue}
                confidence={costConfidence}
                fallbackUpdatedAt={lastUpdatedAt}
                onInfo={onCostInfo}
                onOpenDiagnostics={onOpenDiagnostics}
                testId="usage-cost-summary"
                className="sm:border-l sm:border-oai-gray-200 sm:pl-3 dark:sm:border-oai-gray-700"
              />
            </div>
          </section>
        ) : null}

        </div>
      </section>

      {hasAnyFleetModel ? (
      <section
        data-testid="usage-overview-providers"
        className={`tt-overview-provider-panel tt-surface tt-pressable-group rounded-[var(--tt-card-radius)] ${
          expandedProvider ? "tt-overview-provider-panel--expanded" : ""
        }`}
      >
        <div className="flex h-full flex-col p-5">

        {/* Provider Distribution */}
        {hasAnyFleetModel && (
          <div className="mb-2 flex items-center justify-between gap-4">
            {/* Q02: 计费方式 segmented control. Compact single-row strip with
                copy-registry labels. We only render this when there's at
                least one model to filter; the strip stays out of the way
                when fleetData is empty. */}
            <div
              role="tablist"
              aria-label={copy("usage.billing_filter.label")}
              className="tt-overview-data-tabs inline-flex items-center"
            >
              {BILLING_FILTERS.map((value) => {
                const isActive = safeBillingFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setBillingFilter(value)}
                    className={`tt-overview-data-tab tt-pressable inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-[var(--tt-control-radius)] px-3 py-1.5 text-xs font-medium transition-colors ${
                      isActive
                        ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                        : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50"
                    }`}
                  >
                    {copy(billingFilterCopyKeys[value])}
                  </button>
                );
              })}
            </div>
            <a href="/settings/cost" className="mr-2 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-oai-gray-500 hover:text-oai-brand dark:text-oai-gray-300">
              {copy("usage.overview.configure_management")} <ChevronRight size={14} aria-hidden="true" />
            </a>
          </div>
        )}
        {providers.length > 0 && (
          <div className="space-y-6">
            {/* Distribution Bar */}
            <div
              role="img"
              aria-label={copy("usage.overview.distribution_aria", {
                items: providers
                  .map((provider) =>
                    copy("usage.overview.distribution_item", {
                      label: provider.label,
                      percent: provider.totalPercent,
                    }),
                  )
                  .join(", "),
              })}
              className="h-1.5 w-full bg-oai-gray-100 dark:bg-oai-gray-800 rounded-full overflow-hidden flex"
            >
              {providers.map((provider, idx) => {
                const color = getProviderColor(provider.label, idx);
                return (
                  <motion.div
                    key={provider.label}
                    initial={{ width: 0 }}
                    animate={{ width: `${provider.totalPercent}%` }}
                    transition={{ duration: 0.5, delay: 0.45 + idx * 0.04, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full"
                    style={{ backgroundColor: color }}
                    title={`${provider.label}: ${provider.totalPercent}%`}
                  />
                );
              })}
            </div>

            {/* Provider Cards 鈥?responsive grid keeps cells equal-width so the
                last row never stretches when the count doesn't divide evenly. */}
            <div className="tt-provider-card-stage">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
              {providers.map((provider, idx) => {
                const color = getProviderColor(provider.label, idx);
                const isExpanded = expandedProvider === provider.label;
                const sourceBillingMode = provider.billingMode;
                const sourceBillingKey = billingModeCopyKeys[sourceBillingMode] || billingModeCopyKeys.unknown;

                return (
                  <button
                    key={provider.label}
                    aria-expanded={isExpanded}
                    aria-controls={`provider-details-${provider.label}`}
                    aria-label={copy("usage.overview.provider_card_aria", {
                      provider: provider.label,
                      percent: provider.totalPercent,
                      tokens: formatTokens(provider.usage) || "0",
                      cost: formatCost(provider.usd, currency, rate) || `${getCurrencySymbol(currency)}0`,
                      action: copy(isExpanded ? "usage.overview.collapse" : "usage.overview.expand"),
                    })}
                    onClick={() => setExpandedProvider(isExpanded ? null : provider.label)}
                    className={`tt-provider-card tt-pressable min-w-0 text-left p-3 rounded-xl border transition-[background-color,border-color,box-shadow,transform] duration-200 ${
                      isExpanded
                        ? "ring-2 ring-oai-brand-200 dark:ring-oai-brand-700/50"
                        : ""
                    }`}
                  >
                    <div className="tt-provider-card-identity flex items-start gap-1.5 mb-1 min-w-0">
                      <ProviderIcon provider={provider.label} size={32} color={color} className="text-oai-gray-700 dark:text-oai-gray-300 shrink-0" />
                      <div className="tt-provider-card-nameplate min-w-0 flex-1">
                        <span className="tt-provider-card-name block text-sm font-medium leading-tight text-oai-black dark:text-oai-white truncate">{provider.label}</span>
                        <BillingBadge
                          className="tt-provider-card-badge mt-1"
                          mode={sourceBillingMode}
                          copyKey={sourceBillingKey}
                        />
                      </div>
                    </div>
                    {provider.collectionStatus === "connected_no_precise_tokens" ? (
                      <>
                        <div className="mt-1 text-[11px] leading-4 text-emerald-600 dark:text-emerald-400">
                          {/* V4 item-3b: say WHY there's no data — TRAE keeps usage in an
                              encrypted DB; CodeBuddy IDE logs carry no token fields (its
                              CLI is tracked as WorkBuddy). */}
                          {copy(
                            String(provider.source).toLowerCase() === "trae"
                              ? "usage.provider.trae_encrypted_db"
                              : String(provider.source).toLowerCase() === "codebuddy"
                                ? "usage.provider.codebuddy_no_local_logs"
                                : "settings.data_dirs.installed_no_data",
                          )}
                        </div>
                        <div className="tt-provider-no-data-dash text-sm font-semibold text-oai-gray-500" aria-hidden="true">–</div>
                      </>
                    ) : (
                      <>
                        <div className="text-lg font-semibold text-oai-black dark:text-oai-white tabular-nums">
                          {provider.totalPercent}%
                        </div>
                        <div className="mt-0.5 text-[11px] text-oai-gray-400 dark:text-oai-gray-400 tabular-nums">
                          {copy("usage.overview.model_count", { count: provider.models.length })}
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Expanded Provider Details */}
            {expandedProvider && (
              <div
                id={`provider-details-${expandedProvider}`}
                role="region"
                data-layout="overlay"
                aria-label={copy("usage.overview.model_details_aria", {
                  provider: expandedProvider,
                })}
                className="tt-provider-expanded-region min-w-0"
              >
                {providers
                  .filter((p) => p.label === expandedProvider)
                  .map((provider) => {
                    const color = getProviderColor(provider.label, 0);
                    const contextSource = resolveContextBreakdownSource(provider);
                    const sortedModels = [...provider.models].sort(
                      (a, b) => (b.share || 0) - (a.share || 0)
                    );

                    const providerHeading = contextSource
                      ? copy(`dashboard.context_breakdown.title_${contextSource}`)
                      : provider.label;
                    return (
                      <ProviderExpandedSection
                        key={provider.label}
                        provider={provider}
                        color={color}
                        providerHeading={providerHeading}
                        contextSource={contextSource}
                        from={from}
                        to={to}
                        sortedModels={sortedModels}
                        billingModeCopyKeys={billingModeCopyKeys}
                      />
                    );
                  })}
              </div>
            )}
            </div>

          </div>
        )}
        {/* Q02: empty state when the active filter has no matches. Distinct
            from the "no usage yet" case — we still have data, just not for
            this billing mode. */}
        {hasAnyFleetModel && providers.length === 0 && (
          <div className="mt-2 text-center text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("usage.billing_filter.empty")}
          </div>
        )}
        </div>
      </section>
      ) : null}
    </div>
  );
}

const WORKBUDDY_GROUP_NAME_KEYS = {
  base: "limits.workbuddy.group_base",
  activity: "limits.workbuddy.group_activity",
  extra: "limits.workbuddy.group_extra",
  other: "limits.workbuddy.group_other",
};

function formatWorkbuddyCredits(value) {
  if (value === null || value === undefined) return copy("data_sources.unknown");
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : copy("data_sources.unknown");
}

/**
 * V4 item-3c: WorkBuddy plan + credit packages (基础体验包 / 活动赠送包 /
 * 加量包) inside the expanded overview card — the same numbers the official
 * client's 账号管理 screen shows, read via the local codebuddy.cn relay.
 */
function WorkbuddyQuotaSection({ color }) {
  const [quota, setQuota] = useState(null);
  useEffect(() => {
    let alive = true;
    getWorkbuddyQuota()
      .then((data) => {
        if (alive) setQuota(data && typeof data === "object" ? data : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!quota) return null;
  const groups = Array.isArray(quota.groups) ? quota.groups : [];
  const planText = typeof quota.plan === "string" ? quota.plan.trim() : "";
  const statusCopyKey = quota.signed_in === false
    ? "limits.status.not_connected"
    : quota.error === "unauthorized"
      ? "limits.workbuddy.error_unauthorized"
      : quota.error
        ? "limits.workbuddy.error_fetch"
        : groups.length === 0
          ? "limits.status.no_data"
          : null;
  return (
    <div
      className="mb-4 pb-4 border-b border-oai-gray-200 dark:border-oai-gray-700"
      data-testid="workbuddy-quota-section"
    >
      {planText ? (
        <p className="mb-2 text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400" data-testid="workbuddy-plan-line">
          {planText}
        </p>
      ) : null}
      <div className="space-y-2">
        {statusCopyKey ? (
          <p className="text-xs text-oai-gray-500 dark:text-oai-gray-400" data-testid="workbuddy-quota-status">
            {copy(statusCopyKey)}
          </p>
        ) : null}
        {groups.map((group) => {
          const parsedUsedPct = group.used_percent === null || group.used_percent === undefined
            ? null
            : Number(group.used_percent);
          const usedPct = Number.isFinite(parsedUsedPct)
            ? Math.max(0, Math.min(100, parsedUsedPct))
            : null;
          return (
            <div key={group.id} data-testid="workbuddy-credit-row" data-group={group.id}>
              <div className="flex items-baseline gap-3 mb-1">
                <span className="flex-1 min-w-0 truncate text-sm text-oai-gray-700 dark:text-oai-gray-300">
                  {copy(WORKBUDDY_GROUP_NAME_KEYS[group.id] || WORKBUDDY_GROUP_NAME_KEYS.other)}
                  {group.items > 1 ? ` ×${group.items}` : ""}
                </span>
                <span className="shrink-0 text-right text-sm text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">
                  {copy("limits.workbuddy.credits_remaining", {
                    remain: formatWorkbuddyCredits(group.remain),
                    total: formatWorkbuddyCredits(group.total),
                  })}
                </span>
              </div>
              <div
                className="h-[3px] bg-oai-gray-100 dark:bg-oai-gray-800 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={usedPct ?? undefined}
                aria-valuetext={usedPct === null ? copy("data_sources.unknown") : undefined}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full transition-[width] duration-500 ease-out"
                  style={{ width: `${usedPct ?? 0}%`, backgroundColor: color, opacity: 0.45 }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {quota.error === "unauthorized" ? (
        <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">
          {copy("limits.workbuddy.error_unauthorized")}
        </p>
      ) : null}
      {quota.error && quota.error !== "unauthorized" ? (
        <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">
          {copy("limits.workbuddy.error_fetch")}
        </p>
      ) : null}
    </div>
  );
}

// Renders a single expanded provider section. Hosts loading state for the
// inline Context Breakdown so the spinner can sit next to the heading instead
// of taking its own row.
function ProviderExpandedSection({ provider, color, providerHeading, contextSource, from, to, sortedModels, billingModeCopyKeys }) {
  const { currency, rate } = useCurrency();
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const providerKey = String(provider?.source || provider?.label || "").trim().toLowerCase();
  const isAntigravity = providerKey === "antigravity";
  const isWorkbuddy = providerKey === "workbuddy";
  const modeKeys = billingModeCopyKeys || {
    api_key: "usage.billing_mode.api_key",
    token_plan: "usage.billing_mode.token_plan",
    unknown: "usage.billing_mode.unknown",
    mixed: "usage.billing_mode.mixed",
  };

  return (
                      <div>
                        {/* Section header 鈥?provider identity. When the provider supports
                            Context Breakdown we replace the bare label with the panel title
                            so we don't render a redundant double heading. The panel's
                            loading spinner sits inline at the right of the heading. */}
                        <div className="flex items-center gap-1.5 mb-3">
                          <ProviderIcon provider={provider.label} size={14} color={color} className="shrink-0" />
                          <span className="text-sm font-medium text-oai-black dark:text-oai-white">{providerHeading}</span>
                          {contextSource && breakdownLoading && (
                            <Loader2
                              size={12}
                              className="text-oai-gray-400 dark:text-oai-gray-500 animate-spin shrink-0"
                              aria-label={copy("dashboard.context_breakdown.loading_aria")}
                            />
                          )}
                        </div>

                        {/* Antigravity transcripts carry no usage field 鈥?every token
                            here is a 4-char/token estimate that ignores Gemini prompt
                            caching. Inline footnote, same muted style as the Context
                            Breakdown footnote. */}
                        {isAntigravity && (
                          <p className="mb-3 text-[10px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
                            <span className="font-medium text-oai-gray-500 dark:text-oai-gray-400">
                              {copy("usage.overview.antigravity_notice_title")}.
                            </span>{" "}
                            {copy("usage.overview.antigravity_notice_body")}
                          </p>
                        )}

                        {/* WorkBuddy account + credit packages (item 3c). */}
                        {isWorkbuddy ? <WorkbuddyQuotaSection color={color} /> : null}

                        {/* Context Breakdown drill-down.
                            Claude: category-based (approx /context).
                            Codex: tool-oriented breakdown. */}
                        {contextSource ? (
                          <div className="mb-4 pb-4 border-b border-oai-gray-200 dark:border-oai-gray-700">
                            <ContextBreakdownPanel
                              from={from}
                              to={to}
                              source={contextSource}
                              referenceTotalTokens={provider.usage}
                              onLoadingChange={setBreakdownLoading}
                            />
                          </div>
                        ) : null}

                        {/* Model rows 鈥?text line + thin muted bar as visual rhythm */}
                        <div className="space-y-3">
                          {sortedModels.map((model) => {
                            const tokensLabel = formatTokens(model.usage);
                            const costLabel = formatCost(model.cost, currency, rate);
                            const clampedShare = Math.max(0, Math.min(100, Number(model.share) || 0));
                            return (
                              <div key={model.id || model.name}>
                                <div className="flex items-baseline gap-4 mb-1.5">
                                  <span
                                    className="flex-1 min-w-0 text-sm text-oai-gray-700 dark:text-oai-gray-300 truncate"
                                    title={model.name}
                                  >
                                    {model.name}
                                  </span>
                                  {/* Q02: model-level billing badge. `mixed` is reserved
                                      for the source-level summary; per-model badge keys
                                      never include `mixed`, so unknown here is fine. */}
                                  <BillingBadge
                                    mode={model.billingMode}
                                    copyKey={modeKeys[model.billingMode] || modeKeys.unknown}
                                    className="ml-1.5"
                                  />
                                  <span className="shrink-0 w-16 text-right text-sm text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">
                                    {tokensLabel}
                                  </span>
                                  <span className="shrink-0 w-16 text-right text-sm text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">
                                    {costLabel}
                                  </span>
                                  <span className="shrink-0 w-12 text-right text-sm text-oai-black dark:text-oai-white tabular-nums">
                                    {model.share}%
                                  </span>
                                </div>
                                <div
                                  className="h-[3px] bg-oai-gray-100 dark:bg-oai-gray-800 rounded-full overflow-hidden"
                                  role="progressbar"
                                  aria-valuenow={clampedShare}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                >
                                  <div
                                    className="h-full transition-[width] duration-500 ease-out"
                                    style={{
                                      width: `${clampedShare}%`,
                                      backgroundColor: color,
                                      opacity: 0.45,
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
  );
}
