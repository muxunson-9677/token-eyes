import React, { useMemo } from "react";
import { Activity, AlertCircle, ArrowDown, ArrowUp, DollarSign, HelpCircle, Package, Target } from "lucide-react";
import { Card } from "../../components";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { formatChineseTokenCount } from "../../../lib/format";
import { ProviderIcon } from "./ProviderIcon";
import { getProviderColor } from "./UsageOverview.jsx";

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
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function formatTokensCompact(value) {
  const n = safeNum(value);
  return formatChineseTokenCount(n);
}

function formatFullNum(value) {
  return safeNum(value).toLocaleString();
}

function formatIntegrityDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatIntegrityTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCost(value) {
  const n = safeNum(value);
  if (n <= 0) return "$0";
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: n < 1 ? 4 : 2,
    maximumFractionDigits: n < 1 ? 4 : 2,
  })}`;
}

function formatCurrencyAmount(value, currency) {
  if (value === null || value === undefined) return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return null;
  if (currency === "CNY") {
    const compact = formatChineseTokenCount(numberValue);
    if (compact === "-") return null;
    return `¥${compact}`;
  }
  return `${currency} ${numberValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getMonthlyCostComparison(currentValue, previousValue) {
  if (currentValue === null || currentValue === undefined
    || previousValue === null || previousValue === undefined) return null;
  const current = Number(currentValue);
  const previous = Number(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || current < 0 || previous < 0) return null;

  const difference = current - previous;
  if (Math.abs(difference) < 1e-9) {
    return { kind: "flat", percent: "0.0" };
  }
  if (previous === 0) {
    return {
      kind: "increase",
      percent: "100.0",
    };
  }

  const percent = Math.abs((difference / previous) * 100).toFixed(1);
  return difference > 0
    ? { kind: "increase", percent }
    : { kind: "decrease", percent };
}

function resolveCurrencyAmount(summary, directField, usdField, exchangeRate) {
  const directValue = summary?.[directField];
  if (isProvidedNumber(directValue)) return Number(directValue);
  const usdValue = summary?.[usdField];
  if (!isProvidedNumber(usdValue) || !Number.isFinite(exchangeRate) || exchangeRate <= 0) return null;
  return Number(usdValue) * exchangeRate;
}

function inferExchangeRate(summary) {
  const configured = Number(summary?.usd_to_cny);
  if (Number.isFinite(configured) && configured > 0) return configured;
  for (const card of COST_SUMMARY_CARDS) {
    const usdValue = summary?.[card.usdField];
    const cnyValue = summary?.[card.cnyField];
    if (!isProvidedNumber(usdValue) || Number(usdValue) === 0 || !isProvidedNumber(cnyValue)) continue;
    const inferred = Number(cnyValue) / Number(usdValue);
    if (Number.isFinite(inferred) && inferred > 0) return inferred;
  }
  return 0;
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
    bgClass: "bg-oai-blue-50 dark:bg-oai-blue-500/10",
    format: formatTokensCompact,
  },
  {
    key: "output",
    icon: ArrowUp,
    iconClass: "text-green-500",
    bgClass: "bg-green-50 dark:bg-green-500/10",
    format: formatTokensCompact,
  },
  {
    key: "cache_create",
    icon: Package,
    iconClass: "text-orange-500",
    bgClass: "bg-orange-50 dark:bg-orange-500/10",
    format: formatTokensCompact,
    tooltip: true,
  },
  {
    key: "cache_hit",
    icon: Target,
    iconClass: "text-purple-500",
    bgClass: "bg-purple-50 dark:bg-purple-500/10",
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
  { labelKey: "spend.monthly_api", usdField: "api_usd", cnyField: "api_cny", previousUsdField: "previous_api_usd", previousCnyField: "previous_api_cny", icon: Activity, iconClass: "text-oai-blue-500" },
  { labelKey: "spend.monthly_subscription", usdField: "subscription_usd", cnyField: "subscription_cny", previousUsdField: "previous_subscription_usd", previousCnyField: "previous_subscription_cny", icon: Package, iconClass: "text-violet-500" },
  { labelKey: "spend.monthly_combined", usdField: "combined_usd", cnyField: "combined_cny", previousUsdField: "previous_combined_usd", previousCnyField: "previous_combined_cny", icon: DollarSign, iconClass: "text-green-500" },
  { labelKey: "spend.lifetime_combined", usdField: "lifetime_combined_usd", cnyField: "lifetime_combined_cny", icon: Target, iconClass: "text-orange-500" },
];

export function UsageStatsPanel({
  summary,
  costSummary = null,
  selectedAgent = null,
  loading = false,
  error = null,
  className,
}) {
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
  const hitRateProvided = isProvidedNumber(totals?.cache_hit_rate);
  const hitRate = hitRateProvided ? normalizeHitRate(totals.cache_hit_rate) : null;
  const selectedAgentBrandColor = selectedAgent?.queueSource
    ? getProviderColor(selectedAgent.queueSource.toUpperCase(), 0)
    : null;
  // pricing_coverage determines cost display semantics
  const pricingCoverage = totals?.pricing_coverage ?? "complete";
  const integrity = summary?.data_integrity ?? null;
  const integrityVisibleRecords = safeNum(
    integrity?.visible_records ?? integrity?.valid_records,
  );
  const integrityFrom = formatIntegrityDay(integrity?.visible_from);
  const integrityTo = formatIntegrityDay(integrity?.visible_to);
  const hasIntegrityRange = integrityVisibleRecords > 0
    && integrityFrom
    && integrityTo;
  const unavailableText = copy("shared.data.not_provided");
  const percentSymbol = copy("shared.unit.percent");
  const renderCostValue = () => {
    if (!costProvided) {
      return <span className="text-sm text-oai-gray-400">{unavailableText}</span>;
    }
    if (pricingCoverage === "unpriced") {
      return <span className="text-oai-gray-400">{copy("ticket06.pricing.unpriced")}</span>;
    }
    if (pricingCoverage === "partial") {
      return <span className="text-amber-600 dark:text-amber-400">{formatCost(cost)}</span>;
    }
    return <span className="text-green-600 dark:text-green-400">{formatCost(cost)}</span>;
  };

  if (loading && !totals) {
    return (
      <Card className={cn("mb-6", className)} bodyClassName="p-4 sm:p-6">
        <div className="flex items-center gap-2 text-sm text-oai-gray-400">
          <div className="h-3 w-3 animate-pulse rounded-full bg-oai-gray-300 dark:bg-oai-gray-700" />
          {copy("ticket02.stats.loading")}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn("mb-6", className)} bodyClassName="p-4 sm:p-6">
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
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
        <div className="py-8 text-center text-sm text-oai-gray-400">
          {copy("spend.usage.empty")}
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn("mb-6", className)} bodyClassName="p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:justify-between">
        {/* Left: main metric + 4 dimension cards */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
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
              <div className="mt-1 text-3xl font-semibold tracking-tight text-oai-black tabular-nums dark:text-white">
                {totalTokensProvided ? formatChineseTokenCount(totalTokens) : unavailableText}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DIMENSION_CARDS.map((card) => {
              const Icon = card.icon;
              const rawValue = totals[TOKEN_FIELDS[card.key]];
              const valueProvided = isProvidedNumber(rawValue);
              const value = valueProvided ? Number(rawValue) : null;
              return (
                <div
                  key={card.key}
                  className={cn("rounded-lg p-2.5", card.bgClass)}
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400">
                    <Icon className={cn("h-3.5 w-3.5", card.iconClass)} aria-hidden="true" />
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
                    {valueProvided ? card.format(value) : unavailableText}
                  </div>
                </div>
              );
            })}
          </div>

          {costSummary && (
            <div
              className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"
              data-testid="usage-cost-summary"
            >
              {COST_SUMMARY_CARDS.map((card) => {
                const exchangeRate = inferExchangeRate(costSummary);
                const currentComparisonValue = resolveCurrencyAmount(
                  costSummary,
                  card.cnyField,
                  card.usdField,
                  exchangeRate,
                );
                const previousComparisonValue = resolveCurrencyAmount(
                  costSummary,
                  card.previousCnyField,
                  card.previousUsdField,
                  exchangeRate,
                );
                const comparison = card.previousUsdField
                  ? getMonthlyCostComparison(currentComparisonValue, previousComparisonValue)
                  : null;
                const comparisonLabelKey = comparison?.kind === "increase"
                  ? "spend.monthly_change.increase"
                  : comparison?.kind === "decrease"
                    ? "spend.monthly_change.decrease"
                    : "spend.monthly_change.flat_percent";
                const usdText = formatCurrencyAmount(costSummary[card.usdField], "USD");
                const cnyText = formatCurrencyAmount(costSummary[card.cnyField], "CNY");
                const CostIcon = card.icon;
                return (
                  <div
                    key={card.labelKey}
                    data-testid="usage-cost-card"
                    className="min-w-0 rounded-lg border border-oai-gray-200 px-2.5 py-2 dark:border-oai-gray-800"
                  >
                    <div className="flex items-start gap-1 text-[10px] leading-tight text-oai-gray-500 dark:text-oai-gray-400">
                      <CostIcon className={cn("mt-px h-3 w-3 shrink-0", card.iconClass)} aria-hidden="true" />
                      <span>{copy(card.labelKey)}</span>
                    </div>
                    <div className="mt-1 break-words text-sm font-semibold leading-tight tabular-nums text-oai-gray-900 dark:text-oai-gray-100 sm:text-base">
                      {usdText || unavailableText}
                    </div>
                    <div
                      className="mt-0.5 flex min-w-0 flex-row items-center justify-between gap-1 text-[10px] leading-tight tabular-nums text-oai-gray-500 dark:text-oai-gray-400"
                      data-testid={comparison ? "monthly-cost-cny-row" : undefined}
                    >
                      <span className="min-w-0 shrink-0">{cnyText || unavailableText}</span>
                      {comparison && (
                        <span
                          data-testid="monthly-cost-comparison"
                          data-direction={comparison.kind}
                          aria-label={copy(comparisonLabelKey, { value: comparison.percent })}
                          className={cn(
                            "min-w-0 whitespace-nowrap text-[9px] font-medium leading-tight tabular-nums",
                            comparison.kind === "increase" && "text-green-600 dark:text-green-400",
                            comparison.kind === "decrease" && "text-green-600 dark:text-green-400",
                            comparison.kind === "flat" && "text-oai-gray-400 dark:text-oai-gray-500",
                          )}
                        >
                          {copy(comparisonLabelKey, { value: comparison.percent })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {integrity && (
            <div
              className={cn(
                "mt-3 flex items-center gap-2 text-[11px]",
                integrity.status === "verified"
                  ? "text-green-700 dark:text-green-400"
                  : "text-amber-700 dark:text-amber-400",
              )}
              data-testid="usage-data-integrity"
              title={copy("spend.usage.integrity.details", {
                raw: formatFullNum(integrity.raw_records),
                duplicates: formatFullNum(integrity.duplicate_records),
                malformed: formatFullNum(integrity.malformed_records),
                updated: formatIntegrityTime(integrity.updated_at) || unavailableText,
              })}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  integrity.status === "verified" ? "bg-green-500" : "bg-amber-500",
                )}
                aria-hidden="true"
              />
              <span>
                {integrity.status === "verified"
                  ? hasIntegrityRange
                    ? copy("spend.usage.integrity.verified", {
                      records: formatFullNum(integrityVisibleRecords),
                      from: integrityFrom,
                      to: integrityTo,
                    })
                    : copy("spend.usage.integrity.verified_empty")
                  : copy("spend.usage.integrity.attention", {
                    delta: formatFullNum(integrity.token_delta),
                  })}
              </span>
            </div>
          )}
        </div>

        {/* Right: 3 small cards */}
        <div className="flex flex-row gap-2 lg:w-52 lg:flex-col">
          <div
            className="flex-1 rounded-lg bg-oai-gray-50 px-3 py-2 dark:bg-oai-gray-800/50"
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
              {requestCount === null ? (
                <span className="text-sm text-oai-gray-400">{unavailableText}</span>
              ) : (
                <>
                  <Activity className="h-4 w-4 shrink-0 text-sky-500" aria-hidden="true" />
                  <span>{formatFullNum(requestCount)}</span>
                </>
              )}
            </div>
            {requestCount === null && (
              <div className="mt-0.5 text-[10px] text-oai-gray-400">
                {copy("ticket06.availability.aggregate_only")}
              </div>
            )}
          </div>

          <div
            className="flex-1 rounded-lg bg-oai-gray-50 px-3 py-2 dark:bg-oai-gray-800/50"
            data-testid="usage-total-cost-summary"
          >
            <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {copy("ticket02.stats.cost")}
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">
              {renderCostValue()}
            </div>
            {pricingCoverage === "partial" && (
              <div className="mt-0.5 text-[10px] text-amber-500 dark:text-amber-400">
                {copy("ticket06.pricing.partial_hint")}
              </div>
            )}
            {pricingCoverage === "unpriced" && (
              <div className="mt-0.5 text-[10px] text-oai-gray-400">
                {copy("ticket06.pricing.unpriced_hint")}
              </div>
            )}
          </div>

          <div className="flex-1 rounded-lg bg-oai-gray-50 px-3 py-2 dark:bg-oai-gray-800/50">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                <Target className="h-3.5 w-3.5 text-violet-500" aria-hidden="true" />
                {copy("ticket02.stats.cache_hit_rate")}
              </span>
              <span className={cn(
                "font-semibold",
                hitRateProvided
                  ? "text-sm text-green-600 dark:text-green-400"
                  : "text-[11px] text-oai-gray-400",
              )}>
                {hitRateProvided ? `${hitRate.toFixed(1)}${percentSymbol}` : unavailableText}
              </span>
            </div>
            {hitRateProvided && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-oai-gray-200 dark:bg-oai-gray-700">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${Math.min(100, hitRate)}%` }}
              />
            </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
