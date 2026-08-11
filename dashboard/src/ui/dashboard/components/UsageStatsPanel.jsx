import React, { useMemo } from "react";
import { Activity, AlertCircle, ArrowDown, ArrowUp, DollarSign, HelpCircle, Package, Target } from "lucide-react";
import { Card } from "../../components";
import { copy, getCopyLocale } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { formatTokenCount } from "../../../lib/format";
import { ProviderIcon } from "./ProviderIcon";
import { getProviderColor } from "./UsageOverview.jsx";
import { DataConfidenceBadge } from "./DataConfidenceBadge.jsx";
import { deriveDataConfidence } from "../../../lib/data-confidence";
import { calculateCacheHitSummary } from "../../../lib/cache-hit";

/**
 * Ticket-02 F: 统计面板。
 *
 * 纯展示组件。左侧主指标"真实消耗 Tokens" + 4 维度卡片（新增输入 /
 * Output / 创建 / 命中），右侧 3 小卡片（总请求数 / 总成本 / 缓存命中率
 * + 进度条）。数据来自 useUsageSummary 返回的 UsageSummaryResponse，
 * 优先读 totals，回退到 legacy summary 字段。
 *
 * 字段映射（工单 F）：
 *   total_tokens → 真实消耗 Tokens
 *   input_tokens → 新增输入
 *   output_tokens → Output
 *   cache_creation_input_tokens → 创建
 *   cached_input_tokens → 命中
 *   request_count → 总请求数
 *   cost_usd → 总成本
 *   cache_hit_rate → 缓存命中率
 */

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

function formatTokensCompact(value, locale) {
  const n = safeNum(value);
  return formatTokenCount(n, { locale });
}

function formatFullNum(value) {
  return safeNum(value).toLocaleString();
}

function formatCost(value) {
  if (!isProvidedNumber(value)) return null;
  const numberValue = Number(value);
  if (numberValue === 0) return "$0";
  return `$${numberValue.toLocaleString(undefined, {
    minimumFractionDigits: numberValue < 1 ? 4 : 2,
    maximumFractionDigits: numberValue < 1 ? 4 : 2,
  })}`;
}

function formatCurrencyAmount(value, currency, locale) {
  if (!isProvidedNumber(value)) return null;
  return `${currency} ${Number(value).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getMonthlyCostComparison(currentValue, previousValue) {
  if (!isProvidedNumber(currentValue) || !isProvidedNumber(previousValue)) return null;
  const current = Number(currentValue);
  const previous = Number(previousValue);
  if (current < 0 || previous < 0) return null;
  const delta = Number((current - previous).toFixed(2));
  if (previous === 0 && current === 0) return { kind: "flat", percent: 0, delta };
  if (previous === 0 && current > 0) return { kind: "new", percent: null, delta };
  const percent = Math.abs(((current - previous) / previous) * 100);
  return current > previous
    ? { kind: "increase", percent, delta }
    : current < previous
      ? { kind: "decrease", percent, delta }
      : { kind: "flat", percent: 0, delta };
}

function resolveComparisonValues(summary, card) {
  if (
    isProvidedNumber(summary?.[card.usdField])
    && isProvidedNumber(summary?.[card.previousUsdField])
  ) {
    return {
      current: Number(summary[card.usdField]),
      previous: Number(summary[card.previousUsdField]),
    };
  }
  if (
    isProvidedNumber(summary?.[card.cnyField])
    && isProvidedNumber(summary?.[card.previousCnyField])
  ) {
    return {
      current: Number(summary[card.cnyField]),
      previous: Number(summary[card.previousCnyField]),
    };
  }
  return null;
}


function normalizeHitRate(value) {
  const n = safeNum(value);
  // cache_hit_rate may be 0–1 (ratio) or 0–100 (percent).
  if (n <= 1) return n * 100;
  return n;
}

const DIMENSION_CARDS = [
  {
    key: "input",
    icon: ArrowDown,
    iconClass: "text-oai-blue-500",
    format: formatTokensCompact,
  },
  {
    key: "output",
    icon: ArrowUp,
    iconClass: "text-green-500",
    format: formatTokensCompact,
  },
  {
    key: "cache_create",
    icon: Package,
    iconClass: "text-orange-500",
    format: formatTokensCompact,
    tooltip: true,
  },
  {
    key: "cache_hit",
    icon: Target,
    iconClass: "text-purple-500",
    format: formatTokensCompact,
  },
];

const TOKEN_FIELDS = {
  input: "input_tokens",
  output: "output_tokens",
  cache_create: "cache_creation_input_tokens",
  cache_hit: "cached_input_tokens",
};

const COST_SUMMARY_CARDS = [
  {
    labelKey: "spend.monthly_api",
    usdField: "api_usd",
    cnyField: "api_cny",
    previousUsdField: "previous_api_usd",
    previousCnyField: "previous_api_cny",
    icon: Activity,
    iconClass: "text-sky-500",
  },
  {
    labelKey: "spend.monthly_subscription",
    usdField: "subscription_usd",
    cnyField: "subscription_cny",
    previousUsdField: "previous_subscription_usd",
    previousCnyField: "previous_subscription_cny",
    icon: Package,
    iconClass: "text-violet-500",
  },
  {
    labelKey: "spend.monthly_combined",
    usdField: "combined_usd",
    cnyField: "combined_cny",
    previousUsdField: "previous_combined_usd",
    previousCnyField: "previous_combined_cny",
    icon: DollarSign,
    iconClass: "text-emerald-500",
  },
  {
    labelKey: "spend.lifetime_combined",
    usdField: "lifetime_combined_usd",
    cnyField: "lifetime_combined_cny",
    previousUsdField: null,
    previousCnyField: null,
    icon: Target,
    iconClass: "text-amber-500",
  },
];

export function UsageStatsPanel({
  summary,
  costSummary = null,
  costSummaryError = null,
  costSummaryStale = false,
  costSummaryBaselineUnavailable = false,
  costLastSuccessfulAt = null,
  onRetryCostSummary = null,
  selectedAgent = null,
  loading = false,
  error = null,
  source = "edge",
  fetchedAt = null,
  onOpenDiagnostics = null,
  className,
}) {
  const locale = getCopyLocale();
  const totals = useMemo(
    () => summary?.totals ?? summary?.summary ?? null,
    [summary],
  );

  const totalTokensProvided = isProvidedNumber(totals?.total_tokens);
  const totalTokens = totalTokensProvided ? Number(totals.total_tokens) : null;
  const requestCountValue = totals?.request_count ?? totals?.display_request_count ?? totals?.conversation_count;
  const requestCount = isProvidedNumber(requestCountValue) ? Number(requestCountValue) : null;
  const costValue = totals?.cost_usd ?? totals?.total_cost_usd;
  const costProvided = isProvidedNumber(costValue);
  const cost = costProvided ? Number(costValue) : null;
  const explicitHitRateProvided = isProvidedNumber(totals?.cache_hit_rate);
  const derivedHitRate = calculateCacheHitSummary(totals).cacheHitRate;
  const canDeriveHitRate = isProvidedNumber(totals?.cached_input_tokens)
    && [totals?.input_tokens, totals?.cache_creation_input_tokens, totals?.cached_input_tokens]
      .some((value) => Number(value || 0) > 0);
  const hitRateProvided = explicitHitRateProvided || canDeriveHitRate;
  const hitRate = explicitHitRateProvided
    ? normalizeHitRate(totals.cache_hit_rate)
    : derivedHitRate * 100;
  const selectedAgentBrandColor = selectedAgent?.queueSource
    ? getProviderColor(selectedAgent.queueSource.toUpperCase(), 0)
    : null;
  const confidenceSourceLabel = copy(
    source === "cache"
      ? "data.confidence.source.cached_logs"
      : "data.confidence.source.local_logs",
  );
  const integrity = summary?.data_integrity ?? null;
  const integrityNeedsAttention = Boolean(
    Number(integrity?.token_delta || 0) !== 0
    || Number(integrity?.malformed_records || 0) > 0,
  );
  const tokenConfidence = deriveDataConfidence({
    metric: "tokens",
    hasValue: Boolean(totals),
    availability: totals ? "available" : "unavailable",
    accuracy: "exact",
    coverage: totals ? (integrityNeedsAttention ? "partial" : "complete") : "unavailable",
    sourceKind: source,
    sourceLabel: confidenceSourceLabel,
    observedAt: fetchedAt,
    lastSuccessAt: fetchedAt,
    isStale: Boolean(error && totals),
    totalTokens,
    reason: error || null,
  });
  const pricingCoverage = totals?.pricing_coverage ?? "complete";
  const visibleCostCards = COST_SUMMARY_CARDS.filter((card) => (
    isProvidedNumber(costSummary?.[card.usdField])
    || isProvidedNumber(costSummary?.[card.cnyField])
  ));
  const visibleDimensionCards = DIMENSION_CARDS.filter((card) => (
    isProvidedNumber(totals?.[TOKEN_FIELDS[card.key]])
  ));
  const costLastSuccessLabel = costLastSuccessfulAt
    ? new Date(costLastSuccessfulAt).toLocaleString(locale)
    : null;
  const percentSymbol = copy("shared.unit.percent");
  if (loading && !totals) {
    return (
      <Card className={cn("mb-6", className)} bodyClassName="p-4 sm:p-6">
        <div
          className="flex items-center gap-2 text-sm text-oai-gray-400"
          data-testid="usage-stats-state"
          data-state="loading"
        >
          <div className="h-3 w-3 animate-pulse rounded-full bg-oai-gray-300 dark:bg-oai-gray-700" />
          {copy("ticket02.stats.loading")}
        </div>
      </Card>
    );
  }

  if (error && !totals) {
    return (
      <Card className={cn("mb-6", className)} bodyClassName="p-4 sm:p-6">
        <div
          className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400"
          data-testid="usage-stats-state"
          data-state="error"
        >
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <span>{copy("ticket02.stats.error")}</span>
          <span className="text-xs text-oai-gray-400">{error}</span>
        </div>
      </Card>
    );
  }

  if (!totals) {
    return (
      <Card className={cn("mb-6", className)} bodyClassName="p-4 sm:p-6">
        <div
          className="py-8 text-center text-sm text-oai-gray-400"
          data-testid="usage-stats-state"
          data-state="empty"
        >
          {copy("spend.usage.empty")}
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn("tt-usage-stats-card mb-6", className)} bodyClassName="p-4 sm:p-6">
      {error ? (
        <div
          role="status"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <span className="font-semibold">{copy("dashboard.usage_error.stale_title")}</span>
          <span className="ml-2 text-xs">{error}</span>
        </div>
      ) : null}
      {costSummaryError ? (
        <div
          role={costSummaryStale || costSummaryBaselineUnavailable ? "status" : "alert"}
          data-testid="usage-financial-status"
          data-state={costSummaryStale
            ? "stale"
            : costSummaryBaselineUnavailable
              ? "partial"
              : "unavailable"}
          className={cn(
            "mb-4 flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between",
            costSummaryStale || costSummaryBaselineUnavailable
              ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
              : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100",
          )}
        >
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-semibold">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {costSummaryStale
                ? copy("spend.cost.error.stale")
                : costSummaryBaselineUnavailable
                  ? copy("spend.monthly_change.no_baseline")
                  : copy("spend.cost.error.title")}
            </p>
            <p className="mt-0.5 break-words text-xs opacity-90">{costSummaryError}</p>
            {costLastSuccessLabel ? (
              <p className="mt-0.5 text-xs opacity-80">
                {copy("dashboard.usage_error.last_success", { time: costLastSuccessLabel })}
              </p>
            ) : null}
          </div>
          {onRetryCostSummary ? (
            <button
              type="button"
              onClick={onRetryCostSummary}
              className="min-h-10 shrink-0 rounded-lg border border-current/30 px-3 text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/5"
            >
              {copy("spend.cost.error.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        className="tt-usage-stats-layout tt-usage-stats-reference flex min-w-0 flex-col gap-4 lg:items-stretch"
        data-testid="usage-stats-layout"
      >
        {/* Left: main metric + 4 dimension cards */}
        <div className="tt-usage-stats-main min-w-0 flex-1">
          <div className="flex items-start gap-3" data-layout-row="headline">
            {selectedAgent?.queueSource && (
              <div
                className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{
                  backgroundColor: selectedAgentBrandColor ? `${selectedAgentBrandColor}18` : undefined,
                  color: selectedAgentBrandColor || undefined,
                }}
              >
                <ProviderIcon
                  provider={selectedAgent.queueSource.toUpperCase()}
                  size={22}
                  className="shrink-0"
                  color={selectedAgentBrandColor || undefined}
                />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400">
                {selectedAgent?.displayName && (
                  <>
                    <span
                      style={{ color: selectedAgentBrandColor || undefined }}
                      className={!selectedAgentBrandColor ? "text-orange-600 dark:text-orange-300" : ""}
                      data-testid="usage-selected-agent"
                    >
                      {selectedAgent.displayName}
                    </span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span>{copy("ticket02.stats.real_tokens")}</span>
              </div>
              {totalTokensProvided ? (
                <div className="mt-1 text-3xl font-semibold tracking-tight text-oai-black tabular-nums dark:text-white">
                  {formatTokenCount(totalTokens, { locale })}
                </div>
              ) : null}
              <DataConfidenceBadge
                confidence={tokenConfidence}
                onOpenDiagnostics={onOpenDiagnostics}
                className="mt-2 justify-start"
                data-testid="usage-token-confidence"
              />
            </div>
          </div>

          {visibleDimensionCards.length ? (
            <div
              className="mt-4 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4"
              data-layout-row="tokens"
            >
            {visibleDimensionCards.map((card) => {
              const Icon = card.icon;
              const rawValue = totals[TOKEN_FIELDS[card.key]];
              const value = Number(rawValue);
              return (
                <div
                  key={card.key}
                  className="tt-surface-nested tt-usage-dimension min-w-0 rounded-lg p-2.5"
                  data-dimension={card.key}
                  data-testid="usage-dimension-card"
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400">
                    <Icon
                      className={cn("h-3.5 w-3.5", card.iconClass)}
                      aria-hidden="true"
                      data-testid="usage-dimension-icon"
                    />
                    <span>{copy(`ticket02.stats.${card.key}`)}</span>
                    {card.tooltip && (
                      <span
                        title={copy("ticket02.stats.cache_create_tooltip")}
                        className="inline-flex cursor-help"
                      >
                        <HelpCircle className="h-3 w-3 text-oai-gray-400" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-lg font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">
                    {card.format(value, locale)}
                  </div>
                </div>
              );
            })}
            </div>
          ) : null}

          {visibleCostCards.length ? (
            <div
              className="mt-2 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4"
              data-layout-row="costs"
              data-testid="usage-cost-summary"
            >
              {visibleCostCards.map((card) => {
                const CostIcon = card.icon;
                const usdText = formatCurrencyAmount(costSummary[card.usdField], "USD", locale);
                const cnyText = formatCurrencyAmount(costSummary[card.cnyField], "CNY", locale);
                const comparisonValues = card.previousUsdField
                  ? resolveComparisonValues(costSummary, card)
                  : null;
                const comparison = comparisonValues
                  ? getMonthlyCostComparison(comparisonValues.current, comparisonValues.previous)
                  : null;
                const comparisonText = comparison?.kind === "increase"
                  ? copy("spend.monthly_change.increase", { value: comparison.percent.toFixed(1) })
                  : comparison?.kind === "decrease"
                    ? copy("spend.monthly_change.decrease", { value: comparison.percent.toFixed(1) })
                    : comparison?.kind === "new"
                      ? copy("spend.monthly_change.new_amount")
                        : comparison?.kind === "flat"
                          ? copy("spend.monthly_change.flat")
                          : null;
                return (
                  <div
                    key={card.labelKey}
                    data-testid="usage-cost-card"
                    className="tt-surface-nested tt-usage-cost-card min-w-0 rounded-lg px-2.5 py-2"
                  >
                    <div className="flex items-start gap-1.5 text-[10px] leading-tight text-oai-gray-500 dark:text-oai-gray-400">
                      <CostIcon className={cn("mt-px h-3 w-3 shrink-0", card.iconClass)} aria-hidden="true" />
                      <span>{copy(card.labelKey)}</span>
                    </div>
                    <div className="mt-1 break-words text-sm font-semibold leading-tight tabular-nums text-oai-gray-900 dark:text-oai-gray-100 sm:text-base">
                      {usdText ? <div data-testid="usage-cost-usd">{usdText}</div> : null}
                      <div
                        className="mt-0.5 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5"
                        data-testid="usage-cost-secondary-row"
                      >
                        {cnyText ? (
                          <div className="text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400" data-testid="usage-cost-cny">
                            {cnyText}
                          </div>
                        ) : null}
                        {comparisonText ? (
                          <div
                            data-testid="monthly-cost-comparison"
                            data-direction={comparison.kind}
                            title={copy("spend.monthly_change.explanation")}
                            className={cn(
                              "break-words text-[10px] font-medium leading-tight tabular-nums",
                              comparison.kind === "increase" && "text-emerald-700 dark:text-emerald-300",
                              comparison.kind === "decrease" && "text-emerald-700 dark:text-emerald-300",
                              comparison.kind === "new" && "text-emerald-700 dark:text-emerald-300",
                              comparison.kind === "flat" && "text-oai-gray-500 dark:text-oai-gray-400",
                            )}
                          >
                            {comparisonText}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

        </div>

        {/* Right: 3 small cards */}
        <div
          className="tt-usage-summary-rail flex flex-row gap-2 lg:w-52 lg:flex-col"
          data-testid="usage-summary-rail"
        >
          {requestCount !== null ? (
          <div
            className="tt-surface-nested tt-usage-summary-card min-w-0 flex-1 rounded-lg px-3 py-2"
            data-layout-row="headline"
            data-testid="usage-request-summary"
          >
            <div
              className="text-xs text-oai-gray-500 dark:text-oai-gray-400"
              data-testid="usage-request-label"
            >
              {copy("ticket02.stats.requests")}
            </div>
            <div
              className="mt-1 flex items-center gap-1.5 text-xl font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100"
              data-testid="usage-request-value"
            >
              <Activity className="h-4 w-4 shrink-0 text-sky-500" aria-hidden="true" />
              <span>{formatFullNum(requestCount)}</span>
            </div>
          </div>
          ) : null}

          {costProvided ? (
            <div
              className="tt-surface-nested tt-usage-summary-card min-w-0 flex-1 rounded-lg px-3 py-2"
              data-layout-row="tokens"
              data-testid="usage-total-cost-summary"
            >
              <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                {copy("spend.cost.summary.estimated_usage")}
              </div>
              <div
                className={cn(
                  "mt-1 text-xl font-semibold tabular-nums",
                  pricingCoverage === "partial"
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-oai-gray-900 dark:text-oai-gray-100",
                )}
              >
                {formatCost(cost)}
              </div>
              {pricingCoverage === "partial" ? (
                <div className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                  {copy("ticket06.pricing.partial_hint")}
                </div>
              ) : null}
            </div>
          ) : null}

          {hitRateProvided ? (
          <div
            className="tt-surface-nested tt-usage-summary-card min-w-0 flex-1 rounded-lg px-3 py-2"
            data-layout-row="costs"
            data-testid="usage-cache-hit-summary"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                <Target className="h-3.5 w-3.5 text-violet-500" aria-hidden="true" />
                {copy("ticket02.stats.cache_hit_rate")}
              </span>
              <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                {`${hitRate.toFixed(1)}${percentSymbol}`}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-oai-gray-200 dark:bg-oai-gray-700">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${Math.min(100, hitRate)}%` }}
              />
            </div>
          </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
