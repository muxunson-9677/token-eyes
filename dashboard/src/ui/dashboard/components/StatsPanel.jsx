import React from "react";
import { Activity, CalendarDays, CalendarRange, MessageSquare } from "lucide-react";
import { copy } from "../../../lib/copy";
import { formatChineseTokenCount, formatCompactNumber } from "../../../lib/format";
import { Card, Badge } from "../../components";

const MODEL_DOTS = [
  "bg-oai-brand-500",
  "bg-blue-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-oai-gray-400",
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

export function StatsPanel({
  rankLabel,
  streakDays,
  subscriptions = [],
  periodConversations,
  rolling,
  topModels = [],
  overviewModels,
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
      icon: CalendarDays,
      value: formatValue(rolling?.last_7d?.totals?.billable_total_tokens),
      label: rollingLabels.last7d,
      tone: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300",
    },
    {
      key: "last30d",
      icon: CalendarRange,
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
      tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
    },
  ].filter((card) => {
    return card.value !== null;
  });
  const hasRollingCards = Boolean(rollingCards.length);
  const hasMeasuredModels = Boolean(measuredModels.length);

  return (
    <Card variant="nested" className={`h-full ${className}`}>
        {hasRollingCards && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {rollingCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.key}
                className="flex flex-col items-center justify-center gap-1 rounded-lg bg-oai-gray-50 px-2 py-2 dark:bg-oai-gray-800"
              >
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${card.tone}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold text-oai-black dark:text-oai-white tabular-nums">
                  {card.value}
                </span>
                <span className="text-[10px] text-oai-gray-400 dark:text-oai-gray-400 whitespace-nowrap">{card.label}</span>
              </div>
            );
          })}
        </div>
        )}

        {hasMeasuredModels ? (
          <div className={`${hasRollingCards ? "mt-4 border-t pt-3" : ""} border-oai-gray-100 dark:border-oai-gray-800`}>
            <div
              data-testid="overview-model-list"
              className="max-h-48 space-y-0 overflow-y-auto oai-scrollbar"
            >
              {measuredModels.map((row, index) => {
                const name = String(row.name);
                const percent = row?.percent != null && row?.percent !== "" ? String(row.percent) : "";
                const tokens = row?.tokens;
                const isLast = index === measuredModels.length - 1;
                const rankNum = index + 1;

                return (
                  <div
                    key={row.id || name}
                    className={`flex items-start gap-2 py-2 ${!isLast ? "border-b border-oai-gray-50 dark:border-oai-gray-800" : ""}`}
                  >
                    <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-oai-gray-100 text-[10px] font-semibold text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-300">
                      {rankNum}
                    </span>
                    <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${MODEL_DOTS[index % MODEL_DOTS.length]}`} aria-hidden />
                    <div className="min-w-0 flex-1 px-0.5">
                      <div className="break-words text-sm text-oai-gray-700 dark:text-oai-gray-300">
                        {name}
                      </div>
                      {tokens != null && (
                        <div className="mt-0.5 text-[11px] tabular-nums text-oai-gray-400 dark:text-oai-gray-500">
                          {formatChineseTokenCount(tokens)}
                        </div>
                      )}
                    </div>
                    {percent !== "" && (
                      <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-oai-black dark:text-oai-white">
                        {percent}{percentSymbol}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
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
      </Card>
  );
}
