import React from "react";
import { Activity, CalendarDays, Database, MessageSquare } from "lucide-react";
import { copy, getCopyLocale } from "../../../lib/copy";
import { formatCompactNumber, formatTokenCount } from "../../../lib/format";
import { Badge } from "../../components";

const MODEL_DOT_COLORS = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#8b5cf6",
  "#0ea5a8",
  "#9ca3af",
];

const RANK_TONES = [
  "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:ring-amber-500/30",
  "bg-slate-200 text-slate-700 ring-1 ring-inset ring-slate-300 dark:bg-slate-500/25 dark:text-slate-200 dark:ring-slate-500/30",
  "bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-200 dark:bg-orange-500/20 dark:text-orange-200 dark:ring-orange-500/30",
];

function normalizeBadgePart(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function toTitleWords(value) {
  const normalized = normalizeBadgePart(value);
  if (!normalized) return "";
  return normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function buildSubscriptionItems(subscriptions) {
  if (!Array.isArray(subscriptions)) return [];
  const deduped = new Map();
  for (const entry of subscriptions) {
    if (!entry || typeof entry !== "object") continue;
    const toolRaw = normalizeBadgePart(entry.tool);
    const planRaw = normalizeBadgePart(entry.planType) || normalizeBadgePart(entry.plan_type);
    if (!toolRaw || !planRaw) continue;
    const tool = toTitleWords(toolRaw) || toolRaw;
    const plan = toTitleWords(planRaw) || planRaw;
    deduped.set(`${toolRaw.toLowerCase()}::${planRaw.toLowerCase()}`, { tool, plan });
  }
  return Array.from(deduped.values());
}

function hasRealMetaValue(value) {
  if (value == null) return false;
  const text = String(value).trim();
  if (!text) return false;
  if (text === "—" || text === "-" || text === "--") return false;
  return true;
}

function buildSparklinePoints(values) {
  const safeValues = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (safeValues.length === 0) return "0,14 100,14";
  const points = safeValues.length === 1 ? [safeValues[0], safeValues[0]] : safeValues;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  return points.map((value, index) => {
    const x = (index / (points.length - 1)) * 100;
    const y = 24 - ((value - min) / range) * 12;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function readTrendValue(row, kind) {
  if (kind === "convs") return Number(row?.conversation_count ?? row?.request_count ?? 0);
  if (kind === "avg" && Number.isFinite(Number(row?.average_usage))) return Number(row.average_usage);
  return Number(row?.billable_total_tokens ?? row?.total_tokens ?? 0);
}

export function StatsPanel({
  rankLabel,
  streakDays,
  subscriptions = [],
  periodConversations,
  rolling,
  topModels = [],
  overviewModels,
  trendRows = [],
  className = "",
}) {
  const percentSymbol = copy("shared.unit.percent");

  const showRank = hasRealMetaValue(rankLabel);
  const streakDaysNum = Number.isFinite(Number(streakDays)) ? Number(streakDays) : 0;
  const showStreak = streakDaysNum > 0;
  const streakValue = showStreak
    ? copy("identity_card.streak_value", { days: streakDaysNum })
    : null;
  const subscriptionItems = buildSubscriptionItems(subscriptions);

  const compactConfig = {
    thousandSuffix: copy("shared.unit.thousand_abbrev"),
    millionSuffix: copy("shared.unit.million_abbrev"),
    billionSuffix: copy("shared.unit.billion_abbrev"),
  };
  const formatValue = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return null;
    const formatted = formatCompactNumber(value, compactConfig);
    return formatted === "-" ? null : formatted;
  };
  const rollingLabels = {
    last7d: copy("stats.period.last_7d"),
    last30d: copy("stats.period.last_30d"),
    avg: copy("stats.period.avg"),
    convs: copy("stats.period.convs"),
  };

  const displayModels = Array.isArray(overviewModels) && overviewModels.length > 0
    ? overviewModels
    : (Array.isArray(topModels) ? topModels : []);
  const measuredModels = displayModels.filter((row) => (
    row
    && typeof row.name === "string"
    && row.name.trim()
    && Number.isFinite(Number(row.tokens))
    && Number(row.tokens) > 0
  ));

  const rollingCards = [
    {
      key: "last7d",
      icon: Database,
      value: formatValue(rolling?.last_7d?.totals?.billable_total_tokens),
      label: rollingLabels.last7d,
      tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
    },
    {
      key: "last30d",
      icon: CalendarDays,
      value: formatValue(rolling?.last_30d?.totals?.billable_total_tokens),
      label: rollingLabels.last30d,
      tone: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
    },
    {
      key: "avg",
      icon: Activity,
      value: formatValue(rolling?.last_30d?.avg_per_active_day),
      label: rollingLabels.avg,
      tone: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
    },
    {
      key: "convs",
      icon: MessageSquare,
      value: formatValue(periodConversations),
      label: rollingLabels.convs,
      tone: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300",
    },
  ].filter((card) => {
    return card.value !== null;
  });
  const hasRollingCards = Boolean(rollingCards.length);
  const hasMeasuredModels = Boolean(measuredModels.length);

  const metricTitles = {
    last7d: "总用量",
    last30d: "总用量",
    avg: "平均用量",
    convs: "对话数",
  };

  const rollingCardsWithTrend = rollingCards.map((card) => {
    const rows = Array.isArray(trendRows)
      ? trendRows.slice(card.key === "last7d" ? -7 : -30)
      : [];
    const values = rows.map((row) => readTrendValue(row, card.key));
    const fallback = Number(
      card.key === "last7d"
        ? rolling?.last_7d?.totals?.billable_total_tokens
        : card.key === "last30d"
          ? rolling?.last_30d?.totals?.billable_total_tokens
          : card.key === "avg"
            ? rolling?.last_30d?.avg_per_active_day
            : periodConversations,
    );
    const sparkValues = values.length > 0 ? values : [fallback, fallback];
    const first = sparkValues[0];
    const last = sparkValues[sparkValues.length - 1];
    const change = Number.isFinite(first) && first !== 0 && Number.isFinite(last)
      ? ((last - first) / Math.abs(first)) * 100
      : null;
    const explicitChange = {
      last7d: rolling?.last_7d_change_percent,
      last30d: rolling?.last_30d_change_percent,
      avg: rolling?.avg_change_percent,
      convs: rolling?.conversation_change_percent,
    }[card.key];
    return {
      ...card,
      sparkValues,
      change: Number.isFinite(Number(explicitChange)) ? Number(explicitChange) : change,
    };
  });

  return (
    <div className={`tt-overview-stats h-full ${className}`}>
        {hasRollingCards && (
        <div className="tt-overview-stat-grid grid grid-cols-2 sm:grid-cols-4 gap-2">
          {rollingCardsWithTrend.map((card) => {
            const Icon = card.icon;
            const sparklinePoints = buildSparklinePoints(card.sparkValues);
            const sparklineTone = card.tone.includes("sky") ? "text-sky-500" : card.tone.includes("violet") ? "text-violet-500" : card.tone.includes("amber") ? "text-amber-500" : "text-emerald-500";
            return (
              <div
                key={card.key}
                data-testid="overview-stat-card"
                className="tt-overview-stat-card tt-surface-nested tt-pressable flex min-w-0 flex-col rounded-[var(--tt-card-radius)] px-4 py-4"
              >
                <div className="flex items-center gap-3 text-sm text-oai-gray-500 dark:text-oai-gray-300">
                  <span data-testid="overview-stat-icon" className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${card.tone}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="whitespace-nowrap">{metricTitles[card.key]}</span>
                </div>
                <span className="mt-3 text-[28px] font-semibold leading-none text-oai-black dark:text-oai-white tabular-nums">
                  {card.value}
                </span>
                  <span className="mt-2 text-xs text-oai-gray-500 dark:text-oai-gray-400 whitespace-nowrap">
                    {card.key === "last7d" ? "7天" : card.key === "last30d" ? "30天" : card.key === "avg" ? "平均 / 日" : "对话"}
                  </span>
                <svg
                  data-testid="overview-stat-sparkline"
                  aria-hidden="true"
                  className="mt-2 h-7 w-full overflow-visible"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 30"
                >
                  <polyline
                    fill="none"
                    points={sparklinePoints}
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    className={sparklineTone}
                    vectorEffect="non-scaling-stroke"
                  />
                  {sparklinePoints.split(" ").map((point, index) => {
                    const [cx, cy] = point.split(",");
                    return <circle key={`${card.key}-${index}`} cx={cx} cy={cy} r="1.15" fill="currentColor" className={sparklineTone} />;
                  })}
                </svg>
                {card.change != null ? (
                  <span className={`mt-0.5 text-xs font-medium tabular-nums ${card.change >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {card.change >= 0 ? "↑" : "↓"} {Math.abs(card.change).toFixed(1)}%
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        )}

        {hasMeasuredModels ? (
          <section
            data-testid="overview-model-ranking"
            className={`tt-overview-model-ranking tt-surface-nested tt-pressable-group flex min-h-0 flex-col ${hasRollingCards ? "mt-3" : ""}`}
          >
            <header className="flex items-center justify-between px-4 pb-2 pt-4">
              <h2 className="text-base font-semibold text-oai-black dark:text-white">{copy("stats.model_ranking")}</h2>
            </header>
            <div
              data-testid="overview-model-list"
              className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 pb-3 oai-scrollbar"
            >
              {measuredModels.map((row, index) => {
                const name = String(row.name);
                const percent = row?.percent != null && row?.percent !== "" ? String(row.percent) : "";
                const tokens = row?.tokens;
                const rankNum = index + 1;

                return (
                  <div
                    key={row.id || name}
                    data-testid="overview-model-row"
                    className="tt-pressable flex items-center gap-2 rounded-lg border border-oai-gray-200/80 bg-white/70 px-2.5 py-2 shadow-sm dark:border-oai-gray-700 dark:bg-oai-gray-900/55"
                  >
                    <span
                      data-testid="overview-model-rank"
                      className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${RANK_TONES[index] || "bg-oai-gray-100 text-oai-gray-500 ring-1 ring-inset ring-oai-gray-200 dark:bg-oai-gray-800 dark:text-oai-gray-300 dark:ring-oai-gray-700"}`}
                    >
                      {rankNum}
                    </span>
                    <span
                      data-testid="overview-model-marker"
                      className="mt-2 h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-white dark:ring-oai-gray-900"
                      style={{ backgroundColor: MODEL_DOT_COLORS[index % MODEL_DOT_COLORS.length] }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 px-0.5">
                      <div className="break-words text-sm font-medium text-oai-gray-800 dark:text-oai-gray-200">
                        {name}
                      </div>
                      {tokens != null && (
                        <div className="mt-0.5 text-[11px] tabular-nums text-oai-gray-400 dark:text-oai-gray-500">
                            {formatTokenCount(tokens, { locale: getCopyLocale() })} Tokens
                        </div>
                      )}
                    </div>
                    {percent !== "" ? (
                      <div className="flex w-44 shrink-0 items-center gap-3">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800">
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${Math.min(Math.max(Number(percent) || 0, 0), 100)}%`, backgroundColor: MODEL_DOT_COLORS[index % MODEL_DOT_COLORS.length] }}
                          />
                        </span>
                        <span className="w-12 flex-shrink-0 text-right text-sm font-semibold tabular-nums text-oai-black dark:text-oai-white">
                          {percent}{percentSymbol}
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <div className={`${hasRollingCards ? "mt-4 border-t pt-4" : "py-4"} border-oai-gray-100 text-center text-sm text-oai-gray-400 dark:border-oai-gray-800 dark:text-oai-gray-500`}>
            {copy("dashboard.model_distribution.empty")}
          </div>
        )}

        {subscriptionItems.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-oai-gray-100 pt-3 dark:border-oai-gray-800">
            {subscriptionItems.map((entry, index) => (
              <Badge
                key={`${entry.tool}:${entry.plan}:${index}`}
                variant="secondary"
                size="sm"
              >
                {entry.tool} {entry.plan}
              </Badge>
            ))}
          </div>
        )}

        {(showRank || showStreak) && (
          <div className="mt-4 flex items-center justify-between border-t border-oai-gray-100 pt-3 text-xs text-oai-gray-400 dark:border-oai-gray-800 dark:text-oai-gray-400">
            {showRank ? (
              <div className="flex items-center gap-1.5">
                <span>{copy("identity_card.rank_label")}</span>
                <span className="tabular-nums text-oai-gray-500 dark:text-oai-gray-300">{rankLabel}</span>
              </div>
            ) : <span />}
            {showStreak ? (
              <div className="flex items-center gap-1">
                <span>{copy("identity_card.streak_label")}</span>
                <span className="tabular-nums text-oai-gray-500 dark:text-oai-gray-300">{streakValue}</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
  );
}
