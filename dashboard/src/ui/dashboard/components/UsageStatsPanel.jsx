import React, { useMemo } from "react";
import { ArrowDown, ArrowUp, Package, Target, HelpCircle, AlertCircle } from "lucide-react";
import { Card } from "../../components";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { formatCompactNumber } from "../../../lib/format";
import { ProviderIcon } from "./ProviderIcon";

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

function formatTokensCompact(value) {
  const n = safeNum(value);
  if (n <= 0) return "0";
  return formatCompactNumber(n, {
    decimals: n >= 1000000 ? 1 : 0,
    thousandSuffix: "k",
    millionSuffix: "M",
    billionSuffix: "B",
  });
}

function formatFullNum(value) {
  return safeNum(value).toLocaleString();
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
  if (value === null || value === undefined) return "—";
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return "—";
  return `${currency} ${numberValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatApprox(value) {
  const n = safeNum(value);
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`;
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
  { labelKey: "spend.monthly_api", usdField: "api_usd", cnyField: "api_cny" },
  { labelKey: "spend.monthly_subscription", usdField: "subscription_usd", cnyField: "subscription_cny" },
  { labelKey: "spend.monthly_combined", usdField: "combined_usd", cnyField: "combined_cny" },
  { labelKey: "spend.lifetime_combined", usdField: "lifetime_combined_usd", cnyField: "lifetime_combined_cny" },
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

  const totalTokens = safeNum(totals?.total_tokens);
  // request_count can be null (aggregate_only) - show em-dash instead of 0
  const requestCount = totals?.request_count == null ? null : safeNum(totals.request_count);
  const cost = safeNum(totals?.cost_usd ?? totals?.total_cost_usd);
  const hitRate = normalizeHitRate(totals?.cache_hit_rate);
  const approx = formatApprox(totalTokens);
  // pricing_coverage determines cost display semantics
  const pricingCoverage = totals?.pricing_coverage ?? "complete";

  if (loading) {
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
          {copy("ticket02.stats.loading")}
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
              <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300">
                <ProviderIcon
                  provider={selectedAgent.queueSource.toUpperCase()}
                  size={22}
                  className="shrink-0"
                />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400">
                {selectedAgent?.displayName && (
                  <>
                    <span
                      className="text-orange-600 dark:text-orange-300"
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
                {formatFullNum(totalTokens)}
              </div>
              {approx && (
                <div className="mt-0.5 text-xs text-oai-gray-400 dark:text-oai-gray-500">
                  {copy("ticket02.stats.approx", { value: approx })}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DIMENSION_CARDS.map((card) => {
              const Icon = card.icon;
              const value = safeNum(totals[TOKEN_FIELDS[card.key]]);
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
                    {card.format(value)}
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
              {COST_SUMMARY_CARDS.map((card) => (
                <div
                  key={card.labelKey}
                  className="min-w-0 rounded-lg border border-oai-gray-200 px-2.5 py-2 dark:border-oai-gray-800"
                >
                  <div className="truncate text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                    {copy(card.labelKey)}
                  </div>
                  <div className="mt-1 truncate text-base font-semibold leading-tight tabular-nums text-oai-gray-900 dark:text-oai-gray-100">
                    {formatCurrencyAmount(costSummary[card.usdField], "USD")}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] leading-tight tabular-nums text-oai-gray-500 dark:text-oai-gray-400">
                    {formatCurrencyAmount(costSummary[card.cnyField], "CNY")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: 3 small cards */}
        <div className="flex flex-row gap-2 lg:w-52 lg:flex-col">
          <div className="flex-1 rounded-lg bg-oai-gray-50 px-3 py-2 dark:bg-oai-gray-800/50">
            <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {copy("ticket02.stats.requests")}
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">
              {requestCount === null ? (
                <span className="text-oai-gray-400">—</span>
              ) : (
                formatFullNum(requestCount)
              )}
            </div>
            {requestCount === null && (
              <div className="mt-0.5 text-[10px] text-oai-gray-400">
                {copy("ticket06.availability.aggregate_only")}
              </div>
            )}
          </div>

          <div className="flex-1 rounded-lg bg-oai-gray-50 px-3 py-2 dark:bg-oai-gray-800/50">
            <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {copy("ticket02.stats.cost")}
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">
              {pricingCoverage === "unpriced" ? (
                <span className="text-oai-gray-400">{copy("ticket06.pricing.unpriced")}</span>
              ) : pricingCoverage === "partial" ? (
                <span className="text-amber-600 dark:text-amber-400">{formatCost(cost)}</span>
              ) : (
                <span className="text-green-600 dark:text-green-400">{formatCost(cost)}</span>
              )}
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
              <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                {copy("ticket02.stats.cache_hit_rate")}
              </span>
              <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                {hitRate.toFixed(1)}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-oai-gray-200 dark:bg-oai-gray-700">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${Math.min(100, hitRate)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
