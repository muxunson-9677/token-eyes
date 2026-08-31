import React, { useId, useMemo, useState } from "react";
import { AlertCircle, CircleDollarSign, Coins, MessageSquareText, TrendingUp } from "lucide-react";
import { useRecentApiProviderStats } from "../../../hooks/use-provider-stats";
import { useCurrency } from "../../../hooks/useCurrency";
import { copy, getCopyLocale } from "../../../lib/copy";
import { formatChineseTokenCount, formatUsdCurrency } from "../../../lib/format";
import { ProviderIcon } from "./ProviderIcon.jsx";

const CHART_WIDTH = 720;
const CHART_HEIGHT = 190;
const CHART_LEFT = 24;
const CHART_RIGHT = 18;
const CHART_TOP = 18;
const CHART_BOTTOM = 28;
const PROVIDER_COLOR_CLASSES = [
  "text-blue-600",
  "text-violet-600",
  "text-emerald-600",
  "text-orange-600",
  "text-pink-600",
];

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(value) {
  return Math.max(0, number(value)).toLocaleString(getCopyLocale());
}

function formatMoney(value, currency, rate) {
  return formatUsdCurrency(number(value), {
    decimals: number(value) < 1 ? 4 : 2,
    currency,
    rate,
  });
}

function formatAttributedMoney(value, currency, rate) {
  return value == null ? "—" : formatMoney(value, currency, rate);
}

function formatBalance(balance) {
  const amount = Number(balance?.amount);
  const currency = String(balance?.currency || "").trim().toUpperCase();
  if (!Number.isFinite(amount) || !currency) return null;
  return `${currency} ${amount.toLocaleString(getCopyLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizedDaily(provider) {
  const rows = Array.isArray(provider?.daily) ? provider.daily : [];
  return rows.map((row) => ({
    ...row,
    date: String(row?.date || ""),
    agents: Array.isArray(row?.agents) ? row.agents : [],
    models: Array.isArray(row?.models) ? row.models : [],
    tokens: Math.max(0, number(row?.tokens)),
    request_count: row?.request_count == null ? null : Math.max(0, number(row.request_count)),
    cost_usd: row?.cost_usd == null ? null : Math.max(0, number(row.cost_usd)),
  }));
}

function chartGeometry(daily) {
  if (daily.length === 0) return { points: [], line: "", area: "", max: 0 };
  const observedMax = Math.max(...daily.map((day) => number(day.cost_usd)));
  const max = observedMax > 0 ? observedMax : 1;
  const plotWidth = CHART_WIDTH - CHART_LEFT - CHART_RIGHT;
  const plotHeight = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
  const points = daily.map((day, index) => ({
    ...day,
    x: CHART_LEFT + (daily.length === 1 ? plotWidth / 2 : (index / (daily.length - 1)) * plotWidth),
    y: CHART_TOP + plotHeight - (number(day.cost_usd) / max) * plotHeight,
  }));
  let line = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midpoint = (previous.x + current.x) / 2;
    line += ` C ${midpoint} ${previous.y}, ${midpoint} ${current.y}, ${current.x} ${current.y}`;
  }
  const baseline = CHART_HEIGHT - CHART_BOTTOM;
  const area = `${line} L ${points.at(-1).x} ${baseline} L ${points[0].x} ${baseline} Z`;
  return { points, line, area, max };
}

function Breakdown({ title, rows, currency, rate }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-oai-gray-800 dark:text-oai-gray-100">{title}</div>
      <div className="space-y-1">
        {rows.length > 0 ? rows.map((row) => (
          <div key={row.id || row.display_name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-[11px]">
            <span className="min-w-0 break-words text-oai-gray-700 dark:text-oai-gray-200">{row.display_name || row.id}</span>
            <span className="tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatCount(row.tokens)}</span>
            <span className="tabular-nums text-oai-gray-900 dark:text-oai-gray-100">{formatAttributedMoney(row.cost_usd, currency, rate)}</span>
          </div>
        )) : <div className="text-[11px] text-oai-gray-400">—</div>}
      </div>
    </div>
  );
}

function DayTooltip({ day, currency, rate }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute right-3 top-3 z-10 w-[min(340px,calc(100%-24px))] rounded-xl border border-oai-gray-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-oai-gray-700 dark:bg-oai-gray-900/95"
    >
      <div className="mb-2 text-xs font-semibold text-oai-gray-900 dark:text-white">{day.date}</div>
      <div className="space-y-3">
        <Breakdown title={copy("spend.usage.provider_api.tooltip.agents")} rows={day.agents} currency={currency} rate={rate} />
        <Breakdown title={copy("spend.usage.provider_api.tooltip.models")} rows={day.models} currency={currency} rate={rate} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-oai-gray-100 pt-2 text-[10px] dark:border-oai-gray-800">
        <div><span className="block text-oai-gray-400">{copy("spend.usage.provider_api.tooltip.cost")}</span><strong>{formatAttributedMoney(day.cost_usd, currency, rate)}</strong></div>
        <div><span className="block text-oai-gray-400">{copy("spend.usage.provider_api.tooltip.requests")}</span><strong>{day.request_count == null ? "—" : formatCount(day.request_count)}</strong></div>
        <div><span className="block text-oai-gray-400">{copy("spend.usage.provider_api.tooltip.tokens")}</span><strong>{formatCount(day.tokens)}</strong></div>
      </div>
    </div>
  );
}

function ProviderAreaChart({ provider, colorClass, currency, rate }) {
  const gradientId = useId().replace(/:/g, "");
  const daily = useMemo(() => normalizedDaily(provider), [provider]);
  const geometry = useMemo(() => chartGeometry(daily), [daily]);
  const [activeIndex, setActiveIndex] = useState(null);
  const activeDay = activeIndex == null ? null : daily[activeIndex];

  return (
    <div className="relative mt-4 min-w-0" onMouseLeave={() => setActiveIndex(null)}>
      {activeDay ? <DayTooltip day={activeDay} currency={currency} rate={rate} /> : null}
      <div className="mb-1 text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("spend.usage.provider_api.cost_axis")}</div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className={`block h-auto w-full overflow-visible ${colorClass}`}
        role="img"
        aria-label={`${provider.display_name} ${copy("spend.usage.provider_api.cost_axis")}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.30" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {[0, 0.33, 0.66, 1].map((fraction) => {
          const y = CHART_TOP + (CHART_HEIGHT - CHART_TOP - CHART_BOTTOM) * fraction;
          return <line key={fraction} x1={CHART_LEFT} x2={CHART_WIDTH - CHART_RIGHT} y1={y} y2={y} stroke="currentColor" className="text-oai-gray-200 dark:text-oai-gray-800" strokeDasharray="2 4" />;
        })}
        {geometry.points.length > 0 ? (
          <>
            <path d={geometry.area} fill={`url(#${gradientId})`} />
            <path data-testid="provider-api-area-line" d={geometry.line} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            {geometry.points.map((point, index) => (
              <g key={point.date}>
                <circle
                  data-testid="provider-api-day-point"
                  cx={point.x}
                  cy={point.y}
                  r={activeIndex === index ? 6 : 4}
                  fill="currentColor"
                  stroke="white"
                  strokeWidth="2"
                  tabIndex="0"
                  role="button"
                  aria-label={`${point.date} ${formatAttributedMoney(point.cost_usd, currency, rate)}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onBlur={() => setActiveIndex(null)}
                />
                <text x={point.x} y={CHART_HEIGHT - 7} textAnchor="middle" className="fill-oai-gray-400 text-[10px]">
                  {point.date.slice(5)}
                </text>
              </g>
            ))}
          </>
        ) : null}
      </svg>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-2">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <span className="min-w-0"><span className="block text-[10px] text-oai-gray-400">{label}</span><strong className="block break-words text-sm tabular-nums text-oai-gray-900 dark:text-white">{value}</strong></span>
    </div>
  );
}

function ProviderCard({ provider, index, currency, rate, source, compact = false }) {
  const colorClass = PROVIDER_COLOR_CLASSES[index % PROVIDER_COLOR_CLASSES.length];
  const daily = normalizedDaily(provider);
  const peak = daily
    .filter((day) => day.cost_usd != null)
    .reduce((current, day) => day.cost_usd > (current?.cost_usd ?? -1) ? day : current, null);
  const cached = source === "cache";
  const balance = cached ? null : formatBalance(provider.balance);
  const period = provider.period || { from: daily[0]?.date || "", to: daily.at(-1)?.date || "", days: daily.length };
  const periodTimeZone = /^[A-Za-z0-9_+\-/:]{1,64}$/u.test(String(period.time_zone || ""))
    ? String(period.time_zone)
    : "";

  return (
    <article data-testid="provider-api-card" className={`tt-surface-nested min-w-0 rounded-xl border border-oai-gray-200/80 dark:border-oai-gray-800 ${compact ? "p-3" : "p-4 sm:p-5"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-oai-gray-100 text-sm font-semibold text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-300">{index + 1}</span>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-oai-gray-200 bg-white dark:border-oai-gray-700 dark:bg-oai-gray-900">
            <ProviderIcon provider={provider.provider_id} size={28} />
          </span>
          <span className="min-w-0">
            <strong className={`block break-words text-oai-gray-950 dark:text-white ${compact ? "text-sm" : "text-lg"}`}>{provider.display_name || provider.provider_id}</strong>
            <span className="block break-words text-xs text-oai-gray-500 dark:text-oai-gray-400">{(!cached && provider.account_label) || copy("spend.usage.provider_api.account_unavailable")}</span>
          </span>
        </div>
        <div className="flex flex-col items-end gap-2">
          {balance ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{copy("spend.usage.provider_api.balance")} {balance}</span> : null}
          <span className="rounded-lg border border-oai-gray-200 px-3 py-1 text-xs text-oai-gray-600 dark:border-oai-gray-700 dark:text-oai-gray-300">
            {copy("spend.usage.provider_api.period", { days: period.days || 7 })}{periodTimeZone ? ` · ${periodTimeZone}` : ""}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-oai-gray-600 dark:text-oai-gray-300">
        <span className="rounded-lg bg-oai-gray-50 px-3 py-1.5 dark:bg-oai-gray-900">{copy("spend.usage.provider_api.agent_count", { count: provider.agents?.length || 0 })}</span>
        <span className="rounded-lg bg-oai-gray-50 px-3 py-1.5 dark:bg-oai-gray-900">{copy("spend.usage.provider_api.model_count", { count: provider.models?.length || 0 })}</span>
      </div>

      {!compact ? <ProviderAreaChart provider={provider} colorClass={colorClass} currency={currency} rate={rate} /> : null}

      <div className={`mt-3 grid divide-oai-gray-100 rounded-xl border border-oai-gray-100 dark:divide-oai-gray-800 dark:border-oai-gray-800 ${compact ? "grid-cols-2 divide-x divide-y" : "divide-y sm:grid-cols-4 sm:divide-x sm:divide-y-0"}`}>
        <Metric icon={CircleDollarSign} label={copy("spend.usage.provider_api.total_cost")} value={formatAttributedMoney(provider.cost_usd, currency, rate)} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" />
        <Metric icon={MessageSquareText} label={copy("spend.usage.provider_api.requests")} value={provider.request_count == null ? "—" : formatCount(provider.request_count)} tone="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400" />
        <Metric icon={Coins} label={copy("spend.usage.provider_api.tokens")} value={formatChineseTokenCount(provider.tokens || 0)} tone="bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400" />
        <Metric icon={TrendingUp} label={copy("spend.usage.provider_api.peak")} value={peak ? `${peak.date.slice(5)} · ${formatMoney(peak.cost_usd, currency, rate)}` : "—"} tone="bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400" />
      </div>

      <div className={`mt-3 flex items-center gap-2 text-[11px] ${cached ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
        <span aria-hidden="true">●</span>
        <span>{cached ? copy("observability.evidence.cached") : copy("spend.usage.provider_api.synced", { from: period.from, to: period.to })}</span>
      </div>
    </article>
  );
}

export function ProviderApiServiceList({
  from,
  to,
  timeZone,
  tzOffsetMinutes,
  baseUrl,
  accessToken = null,
  guestAllowed = true,
  cacheKey,
  visibleProviderIds,
  compact = false,
}) {
  const { currency, rate } = useCurrency();
  const { providers, source, loading, error, refresh } = useRecentApiProviderStats({
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
  const rows = Array.isArray(providers?.providers) ? providers.providers : [];

  if (loading && rows.length === 0) {
    return <div className="flex min-h-52 items-center justify-center text-sm text-oai-gray-400" role="status">{copy("spend.usage.provider_api.loading")}</div>;
  }
  if (error && rows.length === 0) {
    return (
      <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-sm text-red-500">
        <AlertCircle className="h-5 w-5" aria-hidden="true" />
        <span>{copy("spend.usage.provider_api.error")}</span>
        <button type="button" onClick={refresh} className="rounded-lg border border-oai-gray-300 px-3 py-2 text-xs font-medium text-oai-gray-700 dark:border-oai-gray-700 dark:text-oai-gray-200">{copy("spend.usage.provider_api.retry")}</button>
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="flex min-h-52 items-center justify-center px-4 text-center text-sm text-oai-gray-400">{copy("spend.usage.provider_api.empty")}</div>;
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" role="alert">
          <span>{copy("spend.usage.provider_api.error")}</span>
          <button type="button" onClick={refresh} className="shrink-0 rounded-lg border border-amber-300 px-3 py-1.5 font-medium dark:border-amber-800">{copy("spend.usage.provider_api.retry")}</button>
        </div>
      ) : null}
      {rows.map((provider, index) => (
        <ProviderCard key={provider.provider_id} provider={provider} index={index} currency={currency} rate={rate} source={source} compact={compact} />
      ))}
    </div>
  );
}
