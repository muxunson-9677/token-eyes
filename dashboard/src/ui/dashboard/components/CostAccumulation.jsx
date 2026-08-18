import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Code2, CreditCard, Package, Globe, Info, RefreshCw, AlertCircle, CheckCircle, Plus, Pencil, Trash2, Settings, TrendingUp } from "lucide-react";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { formatChineseTokenCount } from "../../../lib/format";
import { deriveDataConfidence } from "../../../lib/data-confidence";
import { DataConfidenceBadge } from "./DataConfidenceBadge.jsx";
import { TokenServiceList } from "./TokenServiceList.jsx";
import { computeSubscriptionRoi } from "../../../lib/subscription-roi";

const COST_ICON_TONES = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/45 dark:text-blue-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-950/45 dark:text-violet-300",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/45 dark:text-emerald-300",
  orange: "bg-orange-50 text-orange-600 dark:bg-orange-950/45 dark:text-orange-300",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-950/45 dark:text-rose-300",
};

export function calculateCollapseScrollReserve({ scrollTop, scrollHeight, clientHeight, removedHeight }) {
  const futureMaxScroll = Math.max(0, Number(scrollHeight) - Number(removedHeight) - Number(clientHeight));
  return Math.max(0, Number(scrollTop) - futureMaxScroll);
}

function findVerticalScrollContainer(node) {
  let current = node?.parentElement;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (["auto", "scroll"].includes(overflowY)) return current;
    current = current.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

/**
 * CostAccumulation component (03-cost-billing).
 *
 * Displays five sections (+ optional Other AI group costs under the summary):
 * 1. Cost Summary (top cards)
 * 2. Token 套餐 (Token Packages)
 * 3. 供应商账户 (Provider API Account balances — from 02 financial endpoints)
 * 4. API 计费 (API Billing — local usage cost aggregation)
 * 5. 订阅记录 (Subscription Records — with CRUD)
 *
 * Hard boundaries (03 work order):
 * - Provider API balances come ONLY from 02's financial endpoints
 *   (useProviderApiBalances). Local token costs are NEVER substituted for
 *   balances, and the two are NEVER summed (different semantics).
 * - This component NEVER renders an API Key input — keys live only in
 *   /settings/cost. The "前往成本设置配置" link navigates there.
 * - Unknown / failed / not-connected values are omitted; only real values, including 0, render.
 */

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatAmount(value, currency = "USD") {
  if (value === null || value === undefined) return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return null;
  return `${currency} ${numberValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Pure MoM copy helper — exported for contract/unit tests. */
export function getMonthComparison(currentUsd, previousUsd, usdToCny) {
  if (!Number.isFinite(Number(currentUsd)) || !Number.isFinite(Number(previousUsd))) return null;
  const current = Number(currentUsd);
  const previous = Number(previousUsd);
  if (previous === 0) {
    if (current === 0) {
      return {
        label: copy("spend.monthly_change.flat_percent", { value: "0.0" }),
        className: "text-oai-gray-400 dark:text-oai-gray-500",
        kind: "flat",
        percent: "0.0",
      };
    }
    return {
      label: copy("spend.monthly_change.new_amount"),
      className: "text-orange-600 dark:text-orange-300",
      kind: "new",
      percent: null,
      absoluteUsd: current,
    };
  }
  const percentage = Math.abs(((current - previous) / previous) * 100).toFixed(1);
  if (current > previous) {
    return { label: copy("spend.monthly_change.increase", { value: percentage }), className: "text-orange-600 dark:text-orange-300", kind: "increase", percent: percentage, absoluteUsd: Math.abs(current - previous) };
  }
  if (current < previous) {
    return { label: copy("spend.monthly_change.decrease", { value: percentage }), className: "text-emerald-600 dark:text-emerald-400", kind: "decrease", percent: percentage, absoluteUsd: Math.abs(current - previous) };
  }
  return { label: copy("spend.monthly_change.flat_percent", { value: "0.0" }), className: "text-oai-gray-400 dark:text-oai-gray-500", kind: "flat", percent: "0.0" };
}

function formatDualAmount(usd, cny, comparison = null, { compactCny = false } = {}) {
  const usdValue = formatAmount(usd, "USD");
  if (!usdValue) return null;
  const cnyValue = compactCny && Number.isFinite(Number(cny)) && cny !== null && cny !== undefined
    ? `CNY ${formatChineseTokenCount(Number(cny))}`
    : formatAmount(cny, "CNY");
  const comparisonLabel = comparison?.kind === "new" || comparison?.kind === "increase"
    ? copy("spend.monthly_change.new_amount")
    : comparison?.kind === "decrease"
      ? copy("spend.monthly_change.decrease", { value: "" }).trim()
      : comparison?.label;
  const comparisonAmount = comparison
    ? formatAmount(Number.isFinite(Number(comparison.absoluteUsd)) ? comparison.absoluteUsd : 0, "USD")
    : null;
  const comparisonDetail = comparison?.kind === "increase" || comparison?.kind === "new"
    ? `+ ${comparisonAmount}${comparison?.percent ? ` ▲ ${comparison.percent}%` : ""}`
    : comparison?.kind === "decrease"
      ? `- ${comparisonAmount}${comparison?.percent ? ` ▼ ${comparison.percent}%` : ""}`
      : `${copy("spend.monthly_change.with_amount", { change: "", amount: comparisonAmount })}`.trim();
  return (
    <div className="flex flex-col">
      <span className="tabular-nums">{usdValue}</span>
      {cnyValue || comparison ? (
      <span className="flex min-w-0 items-center justify-between gap-1 text-[10px] text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">
        {cnyValue ? <span className="shrink-0">{cnyValue}</span> : null}
        {comparison ? (
          <span
            data-testid={`monthly-cost-comparison-${comparison.id}`}
            data-direction={comparison.kind}
            aria-label={comparison.label}
            title={copy("spend.monthly_change.explanation")}
            className={cn("tt-summary-comparison", comparison.className)}
          >
            <span className="tt-summary-comparison-label">{comparisonLabel}</span>
            <span className="tt-summary-comparison-detail">{comparisonDetail}</span>
            <span className="sr-only">{comparison.label}</span>
          </span>
        ) : null}
      </span>
      ) : null}
    </div>
  );
}

function formatFinancialValue(value, currency, formatter = formatAmount) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(Number(value))) return null;
  return formatter(value, currency);
}

function formatSelectedMonth(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return "";
  return copy("spend.cost.month_picker.value", { year, month });
}

function formatSelectedYearToMonth(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return "";
  return copy("spend.cost.month_picker.year_to_month", { year, month });
}

function shiftMonth(monthKey, delta) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return "";
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatCostError(error) {
  const message = typeof error === "string" ? error : "";
  if (/local cli not reachable|failed to fetch|networkerror/i.test(message)) {
    return copy("spend.cost.error.local_service_unreachable");
  }
  return message;
}

export function CostMonthPicker({ selectedMonth, currentMonth, onChange }) {
  if (!selectedMonth || !currentMonth || typeof onChange !== "function") return null;
  const nextDisabled = selectedMonth >= currentMonth;
  const changeMonth = (value) => {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= currentMonth) onChange(value);
  };
  return (
    <div className="mb-3 flex items-center justify-end gap-1.5" data-testid="cost-month-picker">
      <button
        type="button"
        aria-label={copy("spend.cost.month_picker.previous")}
        onClick={() => changeMonth(shiftMonth(selectedMonth, -1))}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-oai-gray-200 text-oai-gray-600 hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <label className="sr-only" htmlFor="cost-month-input">{copy("spend.cost.month_picker.label")}</label>
      <div className="relative flex h-10 min-w-28 items-center justify-center rounded-md border border-oai-gray-200 bg-white px-2 text-sm font-medium tabular-nums text-oai-gray-800 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-oai-brand dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-200">
        <CalendarDays className="mr-2 h-4 w-4 text-oai-gray-600 dark:text-oai-gray-300" aria-hidden="true" />
        <span data-testid="cost-month-display" aria-hidden="true">{formatSelectedMonth(selectedMonth)}</span>
        <input
          id="cost-month-input"
          type="month"
          value={selectedMonth}
          max={currentMonth}
          aria-label={copy("spend.cost.month_picker.label")}
          onChange={(event) => changeMonth(event.target.value)}
          className="absolute inset-0 h-10 w-full cursor-pointer opacity-0"
        />
      </div>
      <button
        type="button"
        aria-label={copy("spend.cost.month_picker.next")}
        disabled={nextDisabled}
        onClick={() => changeMonth(shiftMonth(selectedMonth, 1))}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-oai-gray-200 text-oai-gray-600 hover:bg-oai-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost Summary Cards
// ---------------------------------------------------------------------------

function CostSummaryCards({
  summary,
  loading,
  selectedMonth,
  stale = false,
  lastSuccessfulAt = null,
}) {
  if (loading) {
    return (
      <div className="mb-6 grid gap-2 sm:grid-cols-2">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-oai-gray-200 p-3 dark:border-oai-gray-800 animate-pulse">
            <div className="h-3 w-20 bg-oai-gray-200 dark:bg-oai-gray-700 rounded" />
            <div className="mt-2 h-5 w-16 bg-oai-gray-200 dark:bg-oai-gray-700 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const comparison = (id, current, previous) => {
    const value = getMonthComparison(current, previous, summary.usdToCny);
    return value ? { id, ...value } : null;
  };
  const monthLabel = formatSelectedMonth(selectedMonth);
  const label = (suffixKey, fallbackKey) => monthLabel
    ? `${monthLabel} ${copy(suffixKey)}`
    : copy(fallbackKey);
  const confidence = (metric, value, accuracy, sourceLabel, method = null, options = {}) => deriveDataConfidence({
    metric,
    hasValue: value !== null && value !== undefined,
    availability: value !== null && value !== undefined ? "available" : "unavailable",
    accuracy,
    coverage: options.coverage ?? (value !== null && value !== undefined ? "complete" : "unavailable"),
    sourceKind: "local",
    sourceLabel,
    observedAt: lastSuccessfulAt,
    lastSuccessAt: lastSuccessfulAt,
    isStale: stale,
    estimationMethod: method,
    reason: options.reason ?? null,
  });
  const apiEquivalentUsd = summary.monthApiEquivalentUsd ?? summary.monthApiCostUsd;
  const actualCashSpendUsd = summary.monthActualCashSpendUsd ?? summary.monthSubscriptionCostUsd;
  const hasApiEquivalent = Number.isFinite(Number(apiEquivalentUsd))
    && apiEquivalentUsd !== null
    && apiEquivalentUsd !== undefined;
  const hasActualCash = Number.isFinite(Number(actualCashSpendUsd))
    && actualCashSpendUsd !== null
    && actualCashSpendUsd !== undefined;
  const hasSubscriptionCost = Number.isFinite(Number(summary.monthSubscriptionCostUsd))
    && summary.monthSubscriptionCostUsd !== null
    && summary.monthSubscriptionCostUsd !== undefined;
  const selectedDate = /^\d{4}-\d{2}$/.test(selectedMonth) ? new Date(`${selectedMonth}-01T00:00:00`) : null;
  const now = new Date();
  const elapsedDays = selectedDate
    ? (selectedDate.getFullYear() === now.getFullYear() && selectedDate.getMonth() === now.getMonth()
      ? now.getDate()
      : new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate())
    : null;
  const dailyAverage = hasApiEquivalent && elapsedDays ? Number(apiEquivalentUsd) / elapsedDays : null;
  const unavailable = copy("spend.cost.row.unavailable");
  const roi = computeSubscriptionRoi({
    monthApiEquivalentUsd: apiEquivalentUsd,
    monthSubscriptionCostUsd: summary.monthSubscriptionCostUsd,
  });
  const actualCoverageKey = summary.actualCashCoverage === "exact"
    ? "spend.cost.accuracy.exact"
    : summary.actualCashCoverage === "partial"
      ? "spend.cost.accuracy.partial"
      : "spend.cost.accuracy.unknown";

  return (
    <div>
      <p
        data-testid="cost-summary-scope-note"
        className="mb-3 text-xs leading-5 text-oai-gray-500 dark:text-oai-gray-400"
      >
        <Info className="mr-3 h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
        {copy("spend.cost.summary.scope_note")}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
      {hasActualCash ? <SummaryCard
        id="actual-cash"
        icon={Package}
        iconTone="violet"
        label={label("spend.cost.summary.actual_cash_suffix", "spend.cost.summary.actual_cash")}
        value={formatDualAmount(
          actualCashSpendUsd,
          Number.isFinite(Number(summary.usdToCny)) ? actualCashSpendUsd * summary.usdToCny : null,
          null,
          { compactCny: true },
        )}
        confidence={confidence(
          "actual-spend",
          actualCashSpendUsd,
          "exact",
          copy("spend.cost.summary.actual_cash_source"),
          null,
          {
            coverage: summary.actualCashCoverage === "exact" ? "complete" : "partial",
            reason: summary.actualCashCoverage === "exact"
              ? null
              : copy("spend.cost.summary.actual_cash_partial_detail"),
          },
        )}
        confidenceTestId="cost-confidence-actual-cash"
        metrics={[
          { label: copy("spend.cost.summary.subscription_cash"), value: hasSubscriptionCost ? formatAmount(summary.monthSubscriptionCostUsd) : unavailable },
          { label: copy("spend.cost.summary.official_api_cash"), value: summary.monthOfficialApiSpendUsd == null ? unavailable : formatAmount(summary.monthOfficialApiSpendUsd) },
          { label: copy("spend.cost.summary.custom_cash"), value: summary.monthOtherAiCostUsd == null ? unavailable : formatAmount(summary.monthOtherAiCostUsd) },
          { label: copy("spend.cost.summary.coverage"), value: copy(actualCoverageKey) },
        ]}
      /> : null}
      {hasApiEquivalent ? <SummaryCard
        id="api-equivalent"
        icon={BarChart3}
        iconTone="blue"
        label={label("spend.cost.summary.api_equivalent_suffix", "spend.cost.summary.api_equivalent")}
        value={formatDualAmount(
          apiEquivalentUsd,
          Number.isFinite(Number(summary.usdToCny)) ? apiEquivalentUsd * summary.usdToCny : null,
          comparison("api-equivalent", apiEquivalentUsd, summary.previousMonthApiCostUsd),
          { compactCny: true },
        )}
        confidence={confidence(
          "cost",
          apiEquivalentUsd,
          "estimated",
          copy("data.confidence.source.pricing"),
          copy("data.confidence.method.api_pricing"),
        )}
        confidenceTestId="cost-confidence-api-equivalent"
        comparison={comparison("api-equivalent", apiEquivalentUsd, summary.previousMonthApiCostUsd)}
        metrics={[
          { label: copy("spend.cost.design.daily_average"), value: dailyAverage === null ? unavailable : formatAmount(dailyAverage) },
          { label: copy("spend.cost.design.month_usage"), value: summary.monthTotalTokens == null ? unavailable : formatChineseTokenCount(summary.monthTotalTokens) },
          { label: copy("spend.cost.design.highest_daily"), value: summary.highestDailyCostUsd == null ? unavailable : formatAmount(summary.highestDailyCostUsd) },
          { label: copy("spend.cost.design.month_daily_average"), value: dailyAverage === null ? unavailable : formatAmount(dailyAverage) },
        ]}
      /> : null}
      </div>
      {!roi ? (
        <p
          data-testid="subscription-roi-empty-note"
          className="mt-2 text-xs leading-5 text-oai-gray-400 dark:text-oai-gray-500"
        >
          {copy("spend.cost.roi.empty")}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscription ROI card (V2-W2 回本倍数)
// ---------------------------------------------------------------------------

// multiplier = month API-equivalent usage value / month subscription spend.
// No subscription recorded → guidance state; multiplier < 1 → neutral framing
// (percentage of the subscription fee), never a shaming tone.
function SubscriptionRoiCard({ summary, loading }) {
  if (loading) return null;
  const roi = computeSubscriptionRoi({
    monthApiEquivalentUsd: summary.monthApiEquivalentUsd ?? summary.monthApiCostUsd,
    monthSubscriptionCostUsd: summary.monthSubscriptionCostUsd,
  });
  if (!roi) {
    return null;
  }
  const belowOne = roi.multiplier < 1;
  const multiplierLabel = `${roi.multiplier.toFixed(1)}×`;
  const detailText = belowOne
    ? copy("spend.cost.roi.below_one", {
        percent: (roi.multiplier * 100).toFixed(0),
      })
    : copy("spend.cost.roi.subtitle", { value: roi.multiplier.toFixed(1) });
  return (
    <div className="rounded-lg border border-oai-gray-200 dark:border-oai-gray-800 p-4 flex flex-wrap items-center gap-x-8 gap-y-2">
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          <TrendingUp className="h-3.5 w-3.5" aria-hidden />
          {copy("spend.cost.roi.title")}
        </span>
        <span className="text-3xl font-semibold tracking-tight tabular-nums text-oai-black dark:text-white">
          {multiplierLabel}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-oai-gray-700 dark:text-oai-gray-300">{detailText}</span>
        <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("spend.cost.roi.formula")}
        </span>
      </div>
    </div>
  );
}

function SummaryCard({
  id,
  label,
  value,
  confidence = null,
  confidenceTestId = null,
  comparison = null,
  metrics = [],
  highlight = false,
  icon: Icon,
  iconTone = "blue",
}) {
  return (
    <div
      data-testid="cost-summary-card"
      data-cost-summary-card={id}
      className={cn(
        "tt-surface-nested tt-cost-summary-card tt-pressable flex h-full flex-col items-start rounded-lg p-3 text-left",
        highlight ? "tt-cost-summary-total" : "",
      )}
    >
      <div className="tt-cost-summary-heading flex w-full items-start gap-3 text-xs text-oai-gray-500 dark:text-oai-gray-400">
        <span data-testid="cost-summary-icon">
          <span
            data-testid={`cost-summary-icon-${id}`}
            data-tone={iconTone}
            className={cn("tt-cost-summary-mark flex items-center justify-center rounded-xl", COST_ICON_TONES[iconTone])}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </span>
        <span className="tt-cost-summary-label">{label}</span>
        <Info className="mt-0.5 h-3.5 w-3.5 text-oai-gray-400" aria-hidden="true" />
        {comparison ? <span className={cn("tt-cost-summary-change ml-auto", comparison.className)}>{comparison.label}</span> : null}
      </div>
      <div className={cn(
        "tt-cost-summary-primary mt-1 w-full text-left text-lg font-semibold",
        highlight ? "text-oai-brand-600 dark:text-oai-brand-400" : "text-oai-gray-900 dark:text-oai-gray-100"
      )}>
        {value}
      </div>
      <div className="tt-cost-summary-details">
        {metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
      </div>
      {confidence ? (
        <DataConfidenceBadge
          confidence={confidence}
          className="tt-cost-summary-footer mt-2 w-full justify-start text-left"
          data-testid={confidenceTestId}
        />
      ) : null}
    </div>
  );
}

function FoldableSection({ id, icon, iconTone = "blue", title, description, count, summaryMetrics = [], children, className = "mb-6", testId, initiallyOpen = true }) {
  const storageKey = `token-eyes:cost-section:${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === "open") return true;
      if (saved === "closed") return false;
      return initiallyOpen;
    } catch {
      return initiallyOpen;
    }
  });
  const [scrollReserve, setScrollReserve] = useState(0);
  const sectionRef = useRef(null);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || scrollReserve <= 0) return undefined;
    const releaseReserve = () => {
      const naturalMaxScroll = Math.max(0, scrollContainer.scrollHeight - scrollReserve - scrollContainer.clientHeight);
      if (scrollContainer.scrollTop <= naturalMaxScroll + 1) setScrollReserve(0);
    };
    scrollContainer.addEventListener("scroll", releaseReserve, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", releaseReserve);
  }, [scrollReserve]);

  const toggle = () => {
    const next = !open;
    if (open && sectionRef.current) {
      const scrollContainer = findVerticalScrollContainer(sectionRef.current);
      const removedHeight = Math.max(0, sectionRef.current.offsetHeight - 72);
      scrollContainerRef.current = scrollContainer;
      setScrollReserve(calculateCollapseScrollReserve({
        scrollTop: scrollContainer.scrollTop,
        scrollHeight: scrollContainer.scrollHeight,
        clientHeight: scrollContainer.clientHeight,
        removedHeight,
      }));
    } else {
      setScrollReserve(0);
    }
    try { window.localStorage.setItem(storageKey, next ? "open" : "closed"); } catch { /* local preference only */ }
    setOpen(next);
  };
  return (
    <>
    <section
      ref={sectionRef}
      className={cn(
        "tt-surface-nested tt-pressable-parent rounded-[var(--tt-card-radius)] p-4",
        className,
      )}
      data-cost-section={id}
      data-open={open ? "true" : "false"}
      data-testid={testId}
    >
      <div className="tt-cost-row-layout mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="tt-analytics-focusable tt-pressable -m-1.5 flex min-w-0 items-center gap-2 rounded-[var(--tt-control-radius)] p-1.5 text-left"
        >
          <SectionHeader icon={icon} iconTone={iconTone} title={title} description={description} count={count} />
          {open ? <ChevronUp className="h-4 w-4 text-oai-gray-400" /> : <ChevronDown className="h-4 w-4 text-oai-gray-400" />}
        </button>
        {summaryMetrics.length > 0 ? (
          <div className="tt-cost-row-metrics tt-cost-row-metrics--right" data-testid="cost-row-metrics" data-align="right">
            {summaryMetrics.map((metric) => (
              <div key={metric.label} className="tt-cost-row-metric" data-tone={metric.tone || "neutral"}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {open ? children : null}
    </section>
    {scrollReserve > 0 ? (
      <div
        aria-hidden="true"
        data-testid={`cost-scroll-reserve-${id}`}
        style={{ height: `${scrollReserve}px` }}
      />
    ) : null}
    </>
  );
}

function getOtherAiGroupVisual(group, index) {
  const key = `${group?.group_id || ""} ${group?.group_name || ""}`.toLowerCase();
  if (key.includes("api")) return { icon: Code2, tone: "green" };
  if (key.includes("token")) return { icon: Package, tone: "violet" };
  if (key.includes("订阅") || key.includes("subscription")) return { icon: CreditCard, tone: "orange" };
  return [
    { icon: Globe, tone: "blue" },
    { icon: Code2, tone: "green" },
    { icon: CreditCard, tone: "orange" },
    { icon: Package, tone: "violet" },
  ][index % 4];
}

function OtherAiGroupCostSection({ groups = [], selectedMonth, estimatedTotalUsd = 0, subscriptionUsd = 0, sectionsInitiallyOpen }) {
  const navigate = useNavigate();
  if (!groups.length) return null;
  const monthUsd = groups.reduce((sum, group) => sum + Number(group.month_usd || 0), 0);
  const share = estimatedTotalUsd > 0 ? (monthUsd / estimatedTotalUsd) * 100 : 0;
  return (
    <FoldableSection
      id="other-ai"
      icon={BarChart3}
      iconTone="rose"
      title={copy("spend.cost.other_ai_groups.section")}
      description={copy("spend.cost.design.groups_description")}
      count={groups.length}
      className="mb-4"
      initiallyOpen={sectionsInitiallyOpen}
      summaryMetrics={[
        { label: copy("spend.cost.design.month_total"), value: monthUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), tone: "orange" },
        { label: copy("spend.cost.row.estimate_share"), value: `${share.toFixed(1)}%`, tone: "orange" },
        { label: copy("spend.cost.design.group_count"), value: groups.length.toLocaleString() },
        { label: copy("spend.cost.design.highest_group"), value: Math.max(...groups.map((group) => Number(group.month_usd || 0))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
      ]}
    >
      <div data-testid="compact-cost-group-grid" data-layout="reference-cost-group-grid" className="tt-cost-group-grid">
        {groups.map((group, index) => {
          const visual = getOtherAiGroupVisual(group, index);
          const GroupIcon = visual.icon;
          return (
            <article key={group.group_id || "ungrouped"} data-testid={`compact-cost-group-${group.group_id || "ungrouped"}`} data-layout="reference-cost-group" data-density="reference" className="tt-cost-group-card">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("tt-cost-group-icon", COST_ICON_TONES[visual.tone])}>
                    <GroupIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h4 className="break-words text-sm font-semibold text-oai-gray-900 dark:text-oai-gray-100">{group.group_name}</h4>
                    <span className="mt-0.5 block text-xs text-oai-gray-500 dark:text-oai-gray-400">
                      {copy("settings.cost.other_ai.summary_counts", { groups: 1, records: group.record_count })}
                    </span>
                  </div>
                </div>
                <button type="button" onClick={() => navigate("/settings/cost")} className="tt-cost-group-open" aria-label={copy("settings.cost.other_ai.edit_group")}>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-4">
                <span className="sr-only">{formatSelectedMonth(selectedMonth) || copy("spend.cost.other_ai_groups.month")}</span>
                <div data-testid="compact-cost-group-amount" className="text-base font-semibold leading-none text-oai-gray-900 dark:text-oai-gray-100">{formatAmount(group.month_usd)}</div>
                <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">{formatAmount(group.month_cny, "CNY")}</div>
              </div>
              <div className="sr-only">
                <span><span className="sr-only">{formatSelectedYearToMonth(selectedMonth) || copy("spend.cost.other_ai_groups.year")}</span><span aria-hidden="true">{formatSelectedYearToMonth(selectedMonth) || copy("spend.cost.other_ai_groups.year")}: </span>{formatDualAmount(group.year_usd, group.year_cny)}</span>
                <span><span className="sr-only">{copy("spend.cost.other_ai_groups.lifetime")}</span><span aria-hidden="true">{copy("spend.cost.other_ai_groups.lifetime")}: </span>{formatDualAmount(group.lifetime_usd, group.lifetime_cny)}</span>
              </div>
            </article>
          );
        })}
      </div>
    </FoldableSection>
  );
}

// ---------------------------------------------------------------------------
// Token Package Section
// ---------------------------------------------------------------------------

function TokenPackageSection({ packages, loading, estimatedTotalUsd = 0, sectionsInitiallyOpen, onRefresh, now }) {
  const monthUsd = packages.reduce((sum, item) => sum + Number(item.monthCostUsd || 0), 0);
  const share = estimatedTotalUsd > 0 ? (monthUsd / estimatedTotalUsd) * 100 : 0;
  const quota = packages.find((item) => item.availableQuotaDisplay)?.availableQuotaDisplay || copy("spend.cost.row.unavailable");
  return (
    <FoldableSection
      id="token-packages"
      icon={Package}
      iconTone="violet"
      title={copy("spend.cost.token_package.section")}
      description={copy("spend.cost.design.packages_description")}
      count={packages.length}
      initiallyOpen={sectionsInitiallyOpen}
      summaryMetrics={[
        { label: copy("spend.cost.row.month_estimate"), value: monthUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
        { label: copy("spend.cost.row.estimate_share"), value: `${share.toFixed(1)}%` },
        { label: copy("spend.cost.design.package_count"), value: packages.length.toLocaleString() },
        { label: copy("spend.cost.row.available_quota"), value: quota },
      ]}
    >
      {loading ? (
        <LoadingSkeleton />
      ) : packages.length === 0 ? (
        <EmptyState message={copy("spend.cost.token_package.empty")} />
      ) : (
        <div data-testid="token-package-table" className="tt-token-package-table">
          <TokenServiceList
            plans={packages.map((pkg) => ({
              ...pkg,
              plan_label: pkg.plan_label || pkg.name,
              provider_id: pkg.provider_id || pkg.provider,
              sync_status: pkg.sync_status || pkg.syncStatus,
              expires_at: pkg.expires_at || pkg.expiresAt,
            }))}
            loading={loading}
            now={now}
            embedded
            hideHeader
            pageSize={10}
          />
        </div>
      )}
    </FoldableSection>
  );
}

// ---------------------------------------------------------------------------
// Provider API Account Section (NEW — 03 work order, data from 02 endpoints)
// ---------------------------------------------------------------------------

function statusBadgeKey(status) {
  if (status === "synced") return "spend.cost.provider_account.status.synced";
  if (status === "stale") return "spend.cost.provider_account.status.stale";
  if (status === "not-connected") return "spend.cost.provider_account.status.not_connected";
  if (status === "unsupported") return "spend.cost.provider_account.status.unsupported";
  return "spend.cost.provider_account.status.error";
}

function statusBadgeClass(status) {
  if (status === "synced") {
    return "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400";
  }
  if (status === "unsupported") {
    return "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400";
  }
  if (status === "stale") {
    return "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300";
  }
  if (status === "not-connected") {
    return "bg-oai-gray-50 text-oai-gray-500 dark:bg-oai-gray-900/20 dark:text-oai-gray-400";
  }
  return "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400";
}

function ProviderAccountMark({ providerId, label }) {
  const id = String(providerId || "").toLowerCase();
  let mark = String(label || providerId || "P").slice(0, 1);
  if (id === "deepseek") {
    mark = <svg viewBox="0 0 32 32"><path d="M4 18c3-1 5-3 7-6 3 3 7 4 13 3-1 6-5 10-11 10-5 0-8-2-9-7Z" fill="currentColor" /><path d="M20 11c2-3 5-4 8-2-1 3-3 5-7 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="10" cy="18" r="1" fill="white" /></svg>;
  } else if (id === "glm") {
    mark = <svg viewBox="0 0 32 32">{[[16, 5], [10, 8], [22, 8], [7, 14], [16, 14], [25, 14], [10, 21], [22, 21], [16, 27]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.3" fill="currentColor" />)}</svg>;
  } else if (id.includes("volcengine")) {
    mark = <svg viewBox="0 0 32 32"><path className="tt-provider-api-volc-blue" d="M4 27 12 7l5 20H4Z" /><path className="tt-provider-api-volc-teal" d="m14 27 6-16 8 16H14Z" /><path className="tt-provider-api-volc-violet" d="m11 27 5-13 4 13h-9Z" /></svg>;
  } else if (id.includes("aliyun")) {
    mark = <svg viewBox="0 0 32 32"><path d="M4 20c4-8 12-12 24-9-7 1-12 4-15 8 5-2 9-2 13-1-6 5-14 6-22 2Z" fill="currentColor" /><path d="M21 19c3 0 5 1 7 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
  }
  return <span className={cn("tt-provider-account-mark", `tt-provider-account-mark--${id}`)} aria-hidden="true">{mark}</span>;
}

function formatProviderCurrencyTotals(balances, field) {
  const totals = new Map();
  for (const item of balances || []) {
    if (!item || !["synced", "stale"].includes(item.status)) continue;
    const value = Number(item[field]);
    if (!Number.isFinite(value)) continue;
    const currency = String(item.currency || "USD").toUpperCase();
    totals.set(currency, (totals.get(currency) || 0) + value);
  }
  if (totals.size === 0) return copy("spend.cost.row.unavailable");
  return [...totals.entries()]
    .map(([currency, value]) => formatAmount(value, currency))
    .join(copy("limits.panel.mode_separator"));
}

function ProviderApiAccountSection({
  balances,
  refreshing,
  refreshingIds,
  stale,
  lastUpdatedAt,
  onRefreshAll,
  onRefreshOne,
  sectionsInitiallyOpen,
}) {
  const navigate = useNavigate();
  const hasBalances = Boolean(balances?.length);

  return (
    <FoldableSection
      id="provider-api"
      icon={Globe}
      iconTone="blue"
      title={copy("spend.cost.provider_account.section")}
      description={stale
        ? <span className="shrink-0 whitespace-nowrap">{copy("spend.cost.provider_account.stale")}</span>
        : copy("spend.cost.design.providers_description")}
      count={hasBalances ? balances.length : 0}
      testId="provider-api-account-section"
      initiallyOpen={sectionsInitiallyOpen}
      summaryMetrics={hasBalances ? [
        { label: copy("spend.cost.provider_account.month_spend"), value: formatProviderCurrencyTotals(balances, "monthSpend"), tone: "blue" },
        { label: copy("spend.cost.provider_account.balance"), value: formatProviderCurrencyTotals(balances, "balance"), tone: "blue" },
        { label: copy("spend.cost.design.account_count"), value: balances.length.toLocaleString() },
        { label: copy("spend.cost.design.balance_health"), value: balances.every((item) => item.status === "synced") ? copy("spend.cost.design.health_good") : copy("spend.cost.row.unavailable"), tone: "green" },
      ] : []}
    >

      {!hasBalances ? (
        <EmptyState message={copy("spend.cost.provider_account.empty")} />
      ) : (
        <div data-testid="provider-api-expanded-list" className="tt-provider-api-expanded-list">
          {balances.map((balance) => (
            <ProviderApiAccountCard
              key={balance.configId || balance.providerId}
              balance={balance}
              refreshing={Boolean(refreshingIds && refreshingIds.has(balance.configId))}
              onRefresh={() => onRefreshOne(balance.configId)}
            />
          ))}
        </div>
      )}

      {/* Config entry — navigates to /settings/cost. NO key editing here. */}
      <div className="mt-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() => navigate("/settings/cost")}
          className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-xs text-oai-brand-600 hover:underline dark:text-oai-brand-400"
        >
          <Settings className="h-3 w-3" aria-hidden="true" />
          {copy("spend.cost.provider_account.config_link")}
        </button>
      </div>
    </FoldableSection>
  );
}

function ProviderApiAccountCard({ balance, refreshing, onRefresh }) {
  const status = balance?.status || "not-connected";
  const isSynced = status === "synced" || status === "stale";
  const balanceValue = isSynced ? formatFinancialValue(balance?.balance, balance?.currency) : null;
  const monthSpendValue = isSynced ? formatFinancialValue(balance?.monthSpend, balance?.currency) : null;
  const lifetimeSpendValue = isSynced ? formatFinancialValue(balance?.lifetimeSpend, balance?.currency) : null;
  const currencyValue = isSynced && balance?.currency ? balance.currency : null;

  return (
    <div className="tt-provider-api-expanded-card rounded-lg border border-oai-gray-200 p-3 dark:border-oai-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <ProviderAccountMark providerId={balance?.providerId} label={balance?.accountLabel} />
          <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
              {balance?.accountLabel || balance?.providerId}
            </span>
            {balance?.providerId && (
              <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
                {balance.providerId}
              </span>
            )}
            <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs", statusBadgeClass(status))}>
              {copy(statusBadgeKey(status))}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {balanceValue ? <span>
              {copy("spend.cost.provider_account.balance")}: {balanceValue}
            </span> : null}
            {monthSpendValue ? <span>
              {copy("spend.cost.provider_account.month_spend")}: {monthSpendValue}
            </span> : null}
            {lifetimeSpendValue ? <span>
              {copy("spend.cost.provider_account.lifetime_spend")}: {lifetimeSpendValue}
            </span> : null}
            {currencyValue ? <span>
              {copy("spend.cost.provider_account.currency")}: {currencyValue}
            </span> : null}
            {balance?.lastSyncedAt && (
              <span>
                {copy("spend.cost.provider_account.last_synced")}: {balance.lastSyncedAt}
              </span>
            )}
          </div>
          {/* Error message line — shows actionable reason for error status. */}
          {(status === "error" || status === "stale") && (
            <div className="mt-1 text-xs text-red-600 dark:text-red-400">
              {balance?.errorMessage || copy("spend.cost.provider_account.refresh_failed")}
            </div>
          )}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing || !balance?.configId}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-oai-gray-200 text-xs text-oai-gray-700 hover:bg-oai-gray-50 disabled:opacity-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
          aria-label={copy("spend.cost.provider_account.refresh_one")}
        >
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Billing Section (existing — local usage cost aggregation)
// ---------------------------------------------------------------------------

function ApiBillingSection({ accounts, loading, sectionsInitiallyOpen }) {
  const officialMonthValues = accounts
    .filter((account) => account.spendAuthority === "official_invoice")
    .map((account) => account.monthCostUsd)
    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0)
    .map(Number);
  const estimatedMonthValues = accounts
    .filter((account) => account.spendAuthority === "local_list_price_estimate")
    .map((account) => account.monthCostUsd)
    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0)
    .map(Number);
  const officialMonthUsd = officialMonthValues.reduce((sum, value) => sum + value, 0);
  const estimatedMonthUsd = estimatedMonthValues.reduce((sum, value) => sum + value, 0);
  const unavailableAccounts = accounts.filter((account) => account.spendAuthority === "unavailable").length;
  const unavailable = copy("spend.cost.row.unavailable");
  return (
    <FoldableSection
      id="api-billing"
      icon={Code2}
      iconTone="green"
      title={copy("spend.cost.api_billing.section")}
      description={copy("spend.cost.design.api_description")}
      count={accounts.length}
      initiallyOpen={sectionsInitiallyOpen}
      summaryMetrics={[
        { label: copy("spend.cost.summary.official_api_cash"), value: officialMonthValues.length > 0 ? officialMonthUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : unavailable, tone: "green" },
        { label: copy("spend.cost.row.month_estimate"), value: estimatedMonthValues.length > 0 ? estimatedMonthUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : unavailable, tone: "orange" },
        { label: copy("spend.cost.api_billing.summary.unavailable_accounts"), value: unavailableAccounts.toLocaleString() },
        { label: copy("spend.cost.design.error_rate"), value: unavailable, tone: "green" },
      ]}
    >
      {loading ? (
        <LoadingSkeleton />
      ) : accounts.length === 0 ? (
        <EmptyState message={copy("spend.cost.api_billing.empty")} />
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => (
            <ApiBillingCard key={account.id} account={account} />
          ))}
        </div>
      )}
    </FoldableSection>
  );
}

function ApiBillingCard({ account }) {
  const statusConfig = {
    synced: { icon: CheckCircle, color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-900/20" },
    "not-connected": { icon: AlertCircle, color: "text-oai-gray-400", bg: "bg-oai-gray-50 dark:bg-oai-gray-900/20" },
    error: { icon: AlertCircle, color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/20" },
  };

  const status = statusConfig[account.status] || statusConfig["not-connected"];
  const StatusIcon = status.icon;
  const hasCostData = account.status === "synced" && account.spendAuthority !== "unavailable";
  const monthCost = hasCostData ? formatAmount(account.monthCostUsd) : null;
  const lifetimeCost = hasCostData ? formatAmount(account.lifetimeCostUsd) : null;

  return (
    <div className="rounded-lg border border-oai-gray-200 p-3 dark:border-oai-gray-800">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
              {account.accountName}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
              {account.provider}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
              {getSpendAuthorityLabel(account.spendAuthority)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {monthCost ? <span>{copy("spend.cost.api_billing.month_cost")}: {monthCost}</span> : null}
            {lifetimeCost ? <span>{copy("spend.cost.api_billing.lifetime_cost")}: {lifetimeCost}</span> : null}
            {account.lastSyncedAt && (
              <span>{copy("spend.cost.api_billing.last_synced")}: {account.lastSyncedAt}</span>
            )}
          </div>
        </div>
        <div className={cn("shrink-0 rounded-full p-1", status.bg)}>
          <StatusIcon className={cn("h-4 w-4", status.color)} />
        </div>
      </div>
    </div>
  );
}

function getSpendAuthorityLabel(authority) {
  const normalized = ["official_invoice", "local_list_price_estimate", "unavailable"].includes(authority)
    ? authority
    : "unavailable";
  return copy(`spend.cost.api_billing.authority.${normalized}`);
}

// ---------------------------------------------------------------------------
// Subscription Records Section (with CRUD — 03 work order task 4)
// ---------------------------------------------------------------------------

const SUBSCRIPTION_DEFAULT_FORM = {
  name: "",
  provider: "",
  amount: "",
  currency: "USD",
  cycle: "monthly",
  start_date: "",
  end_date: "",
  note: "",
};

function SubscriptionSection({ records, loading, onAdd, onEdit, onDelete, sectionsInitiallyOpen }) {
  const monthUsd = records.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const lifetimeUsd = records.reduce((sum, record) => sum + Number(record.lifetimeAmount || record.amount || 0), 0);
  return (
    <FoldableSection
      id="subscriptions"
      icon={CreditCard}
      iconTone="orange"
      title={copy("spend.cost.subscription.section")}
      description={copy("spend.cost.design.subscriptions_description")}
      count={records.length}
      initiallyOpen={sectionsInitiallyOpen}
      summaryMetrics={[
        { label: copy("spend.cost.row.month_subscription"), value: monthUsd.toFixed(2) },
        { label: copy("spend.cost.row.lifetime_subscription"), value: lifetimeUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
        { label: copy("spend.cost.design.subscription_renewing"), value: records.filter((record) => record.status === "active" && record.renewsAt).length.toLocaleString() },
        { label: copy("spend.cost.design.refunds_credit"), value: copy("spend.cost.row.unavailable") },
      ]}
    >

      {/* Separate-columns note — subscription fees vs provider API spend. */}
      <p className="mb-3 text-xs text-oai-gray-500 dark:text-oai-gray-400">
        {copy("spend.cost.subscription.note_separate")}
      </p>

      {loading ? (
        <LoadingSkeleton />
      ) : records.length === 0 ? (
        <EmptyState message={copy("spend.cost.subscription.empty")} />
      ) : (
        <div className="space-y-2">
          {records.map((record) => (
            <SubscriptionCard
              key={record.id}
              record={record}
              onEdit={() => onEdit(record)}
              onDelete={() => onDelete(record)}
            />
          ))}
        </div>
      )}
    </FoldableSection>
  );
}

function SubscriptionCard({ record, onEdit, onDelete }) {
  const statusConfig = {
    active: { label: copy("spend.cost.subscription.status.active"), color: "text-green-600 dark:text-green-400" },
    expired: { label: copy("spend.cost.subscription.status.expired"), color: "text-oai-gray-400" },
    cancelled: { label: copy("spend.cost.subscription.status.cancelled"), color: "text-red-600 dark:text-red-400" },
  };

  const cycleLabels = {
    monthly: copy("spend.cycle_monthly"),
    yearly: copy("spend.cycle_yearly"),
    one_time: copy("spend.cycle_one_time"),
  };

  const status = statusConfig[record.status] || statusConfig.active;

  return (
    <div className="rounded-lg border border-oai-gray-200 p-3 dark:border-oai-gray-800">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
              {record.name}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
              {record.provider}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
              {cycleLabels[record.cycle] || record.cycle}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            <span>{formatAmount(record.amount, record.currency)}</span>
            {record.startedAt && <span>{copy("spend.cost.subscription.started_at")}: {record.startedAt}</span>}
            {record.renewsAt && <span>{copy("spend.cost.subscription.renews_at")}: {record.renewsAt}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className={cn("text-xs font-medium", status.color)}>
            {status.label}
          </div>
          {!record.readOnly ? (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex min-h-10 items-center gap-1 rounded-md border border-oai-gray-200 px-2.5 text-xs text-oai-gray-700 hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                aria-label={copy("spend.cost.subscription.edit")}
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
                {copy("spend.cost.subscription.edit")}
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex min-h-10 items-center gap-1 rounded-md border border-red-200 px-2.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
                aria-label={copy("spend.cost.subscription.delete")}
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                {copy("spend.cost.subscription.delete")}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Subscription add/edit form (inline modal-style block).
// Fields map to the spend record API: source, plan_label, amount, currency,
// billing_cycle, start_date, end_date, note.
function SubscriptionForm({ initial, onSave, onCancel, saving, formError }) {
  const [form, setForm] = useState(() => ({
    ...SUBSCRIPTION_DEFAULT_FORM,
    name: initial?.name || "",
    provider: initial?.provider || "",
    amount: initial?.amount !== undefined ? String(initial.amount) : "",
    currency: initial?.currency || "USD",
    cycle: initial?.cycle || "monthly",
    start_date: initial?.startedAt || "",
    end_date: initial?.renewsAt || "",
    note: initial?.note || "",
  }));

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const isEdit = Boolean(initial?.id);

  const handleSave = () => {
    onSave({
      id: initial?.id,
      source: form.provider.trim(),
      plan_label: form.name.trim(),
      amount: Number(form.amount) || 0,
      currency: form.currency.trim().toUpperCase() || "USD",
      billing_cycle: form.cycle,
      start_date: form.start_date,
      end_date: form.end_date,
      note: form.note.trim(),
    });
  };

  return (
    <div className="space-y-3 rounded-md border border-oai-gray-200 p-3 dark:border-oai-gray-800" data-testid="subscription-form">
      <h4 className="text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
        {isEdit ? copy("spend.cost.subscription.form.title_edit") : copy("spend.cost.subscription.form.title_add")}
      </h4>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={copy("spend.cost.subscription.form.name")}>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
        <FormField label={copy("spend.cost.subscription.form.provider")}>
          <input
            type="text"
            value={form.provider}
            onChange={(e) => setField("provider", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={copy("spend.cost.subscription.form.amount")}>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.amount}
            onChange={(e) => setField("amount", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
        <FormField label={copy("spend.cost.subscription.form.currency")}>
          <select
            value={form.currency}
            onChange={(e) => setField("currency", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          >
            <option value="USD">{copy("spend.cost.subscription.form.currency")} USD</option>
            <option value="CNY">{copy("spend.cost.subscription.form.currency")} CNY</option>
          </select>
        </FormField>
        <FormField label={copy("spend.cost.subscription.form.cycle")}>
          <select
            value={form.cycle}
            onChange={(e) => setField("cycle", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          >
            <option value="monthly">{copy("spend.cycle_monthly")}</option>
            <option value="yearly">{copy("spend.cycle_yearly")}</option>
            <option value="one_time">{copy("spend.cycle_one_time")}</option>
          </select>
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={copy("spend.cost.subscription.form.start_date")}>
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => setField("start_date", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
        <FormField label={copy("spend.cost.subscription.form.end_date")}>
          <input
            type="date"
            value={form.end_date}
            onChange={(e) => setField("end_date", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
      </div>

      {formError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {formError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="min-h-10 rounded-md border border-oai-gray-200 px-3 text-sm text-oai-gray-700 hover:bg-oai-gray-50 disabled:opacity-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
        >
          {copy("spend.cost.subscription.form.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex min-h-10 items-center gap-1 rounded-md bg-oai-brand-600 px-3 text-sm font-medium text-white hover:bg-oai-brand-700 disabled:opacity-50"
        >
          {copy("spend.cost.subscription.form.save")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helper components
// ---------------------------------------------------------------------------

function SectionHeader({ icon: Icon, iconTone = "blue", title, description, count }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        data-testid="cost-section-icon"
        data-tone={iconTone}
        className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", COST_ICON_TONES[iconTone])}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-oai-gray-800 dark:text-oai-gray-200">{title}</span>
        {description ? <span className="tt-cost-section-description block truncate whitespace-nowrap text-xs font-normal text-oai-gray-500 dark:text-oai-gray-400">{description}</span> : null}
      </span>
      {count > 0 && (
        <span className="rounded-full bg-oai-gray-100 px-2 py-0.5 text-xs text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400">
          {count}
        </span>
      )}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-lg border border-oai-gray-200 p-4 text-center text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
      {message}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="rounded-lg border border-oai-gray-200 p-4 dark:border-oai-gray-800">
      <div className="animate-pulse space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-12 bg-oai-gray-200 dark:bg-oai-gray-700 rounded" />
        ))}
      </div>
    </div>
  );
}

function FormField({ label, hint, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-400">
        <span className="block">{label}</span>
        {children}
      </label>
      {hint && <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main CostAccumulation component
// ---------------------------------------------------------------------------

export function CostAccumulation({
  tokenPackages = [],
  apiBillingAccounts = [],
  subscriptionRecords = [],
  costSummary = {
    monthApiCostUsd: 0,
    monthApiEquivalentUsd: 0,
    monthOfficialApiSpendUsd: null,
    monthActualCashSpendUsd: 0,
    actualCashCoverage: "unknown",
    monthOtherAiCostUsd: 0,
    monthSubscriptionCostUsd: 0,
    monthTotalCostUsd: 0,
    lifetimeTotalCostUsd: 0,
    usdToCny: 7.2,
  },
  otherAiGroupCosts = [],
  selectedMonth = "",
  currentMonth = "",
  onSelectedMonthChange,
  showMonthPicker = true,
  loading = false,
  error = null,
  costSummaryStale = false,
  costLastSuccessfulAt = null,
  onRetry = null,
  // 03 work order: provider API account balances from 02 endpoints.
  providerApiBalances = [],
  providerApiRefreshing = false,
  providerApiRefreshingIds = new Set(),
  providerApiStale = false,
  providerApiLastUpdatedAt = null,
  onRefreshAllProviderApis,
  onRefreshOneProviderApi,
  onRefreshTokenPackages,
  // 03 work order: subscription CRUD handlers.
  subscriptionFormState = null, // null | "new" | record
  subscriptionFormSaving = false,
  subscriptionFormError = null,
  onAddSubscription,
  onEditSubscription,
  onSaveSubscription,
  onDeleteSubscription,
  onCancelSubscriptionForm,
  sectionsInitiallyOpen = true,
  now = new Date(),
}) {
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      {/* Cost Summary */}
      <div
        data-testid="cost-summary-region"
        className="tt-surface tt-pressable-group rounded-[var(--tt-card-radius)] p-4"
      >
        {showMonthPicker ? <CostMonthPicker
          selectedMonth={selectedMonth}
          currentMonth={currentMonth}
          onChange={onSelectedMonthChange}
        /> : null}
        <CostSummaryCards
          summary={costSummary}
          loading={loading}
          selectedMonth={selectedMonth}
          stale={costSummaryStale}
          lastSuccessfulAt={costLastSuccessfulAt}
        />
      </div>
      <OtherAiGroupCostSection
        groups={otherAiGroupCosts}
        selectedMonth={selectedMonth}
        estimatedTotalUsd={costSummary.monthApiCostUsd}
        subscriptionUsd={costSummary.monthSubscriptionCostUsd}
        sectionsInitiallyOpen={sectionsInitiallyOpen}
      />

      {/* Subscription ROI (V2-W2 回本倍数) */}
      <SubscriptionRoiCard summary={costSummary} loading={loading} />

      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {copy("spend.cost.error.title")}
          </div>
          <p className="mt-1 text-xs">
            {copy(costSummaryStale
              ? "spend.cost.error.stale"
              : "spend.cost.error.unavailable")}
          </p>
          <p className="mt-1 break-words text-xs text-red-600 dark:text-red-400">{formatCostError(error)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="tt-analytics-focusable min-h-10 rounded-md border border-red-300 px-3 text-xs font-semibold dark:border-red-700"
              >
                {copy("spend.cost.error.retry")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => navigate("/settings/cost")}
              className="tt-analytics-focusable min-h-10 rounded-md border border-red-300 px-3 text-xs font-semibold dark:border-red-700"
            >
              {copy("spend.cost.error.open_settings")}
            </button>
          </div>
        </div>
      )}

      {/* Token Packages */}
      <TokenPackageSection packages={tokenPackages} loading={loading} estimatedTotalUsd={costSummary.monthApiCostUsd} sectionsInitiallyOpen={sectionsInitiallyOpen} onRefresh={onRefreshTokenPackages} now={now} />

      {/* Provider API Accounts (NEW — 03 work order, data from 02 endpoints) */}
      <ProviderApiAccountSection
        balances={providerApiBalances}
        refreshing={providerApiRefreshing}
        refreshingIds={providerApiRefreshingIds}
        stale={providerApiStale}
        lastUpdatedAt={providerApiLastUpdatedAt}
        onRefreshAll={onRefreshAllProviderApis}
        onRefreshOne={onRefreshOneProviderApi}
        sectionsInitiallyOpen={sectionsInitiallyOpen}
      />

      {/* API Billing (existing — local usage cost aggregation) */}
      <ApiBillingSection accounts={apiBillingAccounts} loading={loading} estimatedTotalUsd={costSummary.monthApiCostUsd} sectionsInitiallyOpen={sectionsInitiallyOpen} />

      {/* Subscription Records (with CRUD) */}
      {subscriptionFormState !== null && (
        <SubscriptionForm
          initial={subscriptionFormState === "new" ? null : subscriptionFormState}
          saving={subscriptionFormSaving}
          formError={subscriptionFormError}
          onSave={onSaveSubscription}
          onCancel={onCancelSubscriptionForm}
        />
      )}
      <SubscriptionSection
        records={subscriptionRecords}
        loading={loading}
        onAdd={onAddSubscription}
        onEdit={onEditSubscription}
        onDelete={onDeleteSubscription}
        sectionsInitiallyOpen={sectionsInitiallyOpen}
      />
    </div>
  );
}
