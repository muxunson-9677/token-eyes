import React, { useLayoutEffect, useMemo, useState } from "react";
import {
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpRight,
  ArrowUpToLine,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  History,
  RotateCcw,
  Sparkles,
  Timer,
  Zap,
} from "lucide-react";

import { useCodexResetEvents } from "../hooks/use-codex-reset-events";
import { copy, getCopyLocale } from "../lib/copy";
import type { CodexResetHistoryEvent } from "../lib/api";
import {
  calculateResetStatistics,
  filterRecentOfficialResets,
  type ResetStatistics,
} from "../lib/reset-history-stats";
import { triggerResetCelebrationPreview } from "../ui/celebration/ResetCelebrationProvider.jsx";
import {
  readResetCelebrationEffect,
  saveResetCelebrationEffect,
} from "../ui/celebration/reset-celebration-preference.js";

type TimelineEvent = CodexResetHistoryEvent & {
  sourceIndex: number | null;
};

type TimelineSource = {
  index: number;
  label: string;
  url: string;
};

const PREVIEW_RESET_DATES = [
  "2026-08-01T11:32:00.000Z",
  "2026-07-29T12:09:00.000Z",
  "2026-07-28T11:09:00.000Z",
  "2026-07-26T03:17:00.000Z",
  "2026-07-22T00:47:00.000Z",
  "2026-07-18T11:28:00.000Z",
  "2026-07-16T12:14:00.000Z",
  "2026-07-15T03:34:00.000Z",
  "2026-07-14T02:29:00.000Z",
  "2026-07-13T05:28:00.000Z",
  "2026-07-12T18:20:00.000Z",
  "2026-07-11T13:54:00.000Z",
  "2026-07-10T22:18:00.000Z",
] as const;

const PREVIEW_RESET_HISTORY: CodexResetHistoryEvent[] = PREVIEW_RESET_DATES.map(
  (occurredAt, index) => ({
    id: `preview-official-reset-${index + 1}`,
    type: "official_reset_announcement",
    agent: "codex",
    account_key: "preview",
    window: null,
    created_at: occurredAt,
    reset_at: null,
    occurred_at: occurredAt,
    observed_at: occurredAt,
    previous_used_percent: null,
    current_used_percent: null,
    confidence: "confirmed",
    alert_eligible: false,
    official_url: "https://chatgpt.com/codex",
    source_url: "https://x.com/thsottiaux/status/2082317452755751098",
    source_author: "thsottiaux",
    source: "signed_feed",
    reset_kind: index === 4 ? "unknown" : index >= 8 ? "banked" : "hard",
    reset_scope: index % 3 === 0 ? "all_codex_work_users" : "all_paid_users",
    title: "Codex official extra reset",
  }),
);

function startResetControlPress(event: React.PointerEvent<HTMLElement>) {
  if (event.button !== undefined && event.button !== 0) return;
  const target = event.currentTarget;
  target.classList.remove("tt-reset-control-click-bounce");
  void target.offsetWidth;
  target.classList.add("tt-reset-control-click-bounce");
}

function finishResetControlPress(event: React.AnimationEvent<HTMLElement>) {
  event.currentTarget.classList.remove("tt-reset-control-click-bounce");
}

function shouldUseLocalPreviewHistory(available: boolean, history: CodexResetHistoryEvent[]) {
  if (!import.meta.env.DEV || available || history.length > 0 || typeof window === "undefined") {
    return false;
  }
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

export function formatResetDateTime(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(getCopyLocale(), {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getSourceLabel(event: CodexResetHistoryEvent) {
  return event.source_author === "thsottiaux"
    ? copy("reset_history.source.tibo")
    : copy("reset_history.source.openai");
}

function formatResetInterval(intervalMs: number | null) {
  if (intervalMs === null) return null;
  const totalMinutes = Math.max(1, Math.round(intervalMs / (60 * 1000)));
  if (totalMinutes < 60) {
    return copy("reset_history.stats.duration_minutes", { minutes: totalMinutes });
  }
  const totalHours = Math.round(totalMinutes / 60);
  if (totalHours < 24) {
    return copy("reset_history.stats.duration_hours", { hours: totalHours });
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0
    ? copy("reset_history.stats.duration_days_hours", { days, hours })
    : copy("reset_history.stats.duration_days", { days });
}

const STAT_TONE_CLASSES = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
} as const;

const RESET_KIND_VISUALS = {
  hard: {
    Icon: Zap,
    tone: "emerald",
    className: "bg-emerald-50 text-emerald-600 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/20",
  },
  banked: {
    Icon: ArchiveRestore,
    tone: "blue",
    className: "bg-blue-50 text-blue-600 ring-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/20",
  },
  mixed: {
    Icon: Sparkles,
    tone: "violet",
    className: "bg-violet-50 text-violet-600 ring-violet-100 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/20",
  },
  unknown: {
    Icon: CircleHelp,
    tone: "amber",
    className: "bg-amber-50 text-amber-600 ring-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20",
  },
} as const;

function formatResetStatDate(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(getCopyLocale(), {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function ResetStatisticsSummary({
  statistics,
  events,
  isLoading,
}: {
  statistics: ResetStatistics;
  events: TimelineEvent[];
  isLoading: boolean;
}) {
  const unavailableValue = copy("reset_history.stats.insufficient");
  const chronological = [...events].sort(
    (left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at),
  );
  const intervals = chronological.slice(1).map((event, index) => ({
    start: chronological[index],
    end: event,
    duration: Date.parse(event.occurred_at) - Date.parse(chronological[index].occurred_at),
  })).filter(function hasFiniteDuration(interval) {
    return Number.isFinite(interval.duration);
  });
  const shortest = intervals.reduce<typeof intervals[number] | null>(function selectShortest(current, interval) {
    return !current || interval.duration < current.duration ? interval : current;
  }, null);
  const longest = intervals.reduce<typeof intervals[number] | null>(function selectLongest(current, interval) {
    return !current || current.duration < interval.duration ? interval : current;
  }, null);
  const items = [
    {
      label: copy("reset_history.stats.period"),
      value: copy("reset_history.stats.period_value", { days: statistics.periodDays }),
      detail: copy("reset_history.stats.period_detail", { count: statistics.count }),
      Icon: CalendarDays,
      tone: "blue" as const,
    },
    {
      label: copy("reset_history.stats.count"),
      value: copy("reset_history.stats.count_value", { count: statistics.count }),
      detail: statistics.countChangePercent !== null
        ? copy("reset_history.stats.count_change", {
          change: formatCountChange(statistics.countChangePercent) ?? "",
          days: statistics.periodDays,
        })
        : statistics.count > 0 && statistics.previousCount === 0
          ? copy("reset_history.stats.count_change_new", {
            count: statistics.count,
            days: statistics.periodDays,
          })
          : copy("reset_history.stats.count_detail"),
      Icon: RotateCcw,
      tone: "emerald" as const,
    },
    {
      label: copy("reset_history.stats.average"),
      value: formatResetInterval(statistics.averageIntervalMs),
      detail: intervals.length > 0
        ? copy("reset_history.stats.average_detail", { count: intervals.length })
        : unavailableValue,
      Icon: Timer,
      tone: "violet" as const,
    },
    {
      label: copy("reset_history.stats.shortest"),
      value: formatResetInterval(statistics.shortestIntervalMs),
      detail: shortest
        ? copy("reset_history.stats.occurred_detail", { date: formatResetStatDate(shortest.end.occurred_at) })
        : unavailableValue,
      Icon: ArrowDownToLine,
      tone: "amber" as const,
    },
    {
      label: copy("reset_history.stats.longest"),
      value: formatResetInterval(statistics.longestIntervalMs),
      detail: longest
        ? copy("reset_history.stats.range_detail", {
          start: formatResetStatDate(longest.start.occurred_at),
          end: formatResetStatDate(longest.end.occurred_at),
        })
        : unavailableValue,
      Icon: ArrowUpToLine,
      tone: "rose" as const,
    },
];

  return (
    <dl
      data-testid="reset-history-statistics"
      className="tt-reset-statistics--compact mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5"
    >
      {items.map(({ Icon, ...item }) => (
        <div
          key={item.label}
          data-testid="reset-history-stat"
          data-tone={item.tone}
          data-empty={item.value === null || isLoading ? "true" : undefined}
          className="tt-surface-nested tt-pressable min-w-0 rounded-2xl border border-oai-gray-200/80 px-4 py-4 dark:border-oai-gray-800"
        >
          <span
            data-testid="reset-history-stat-icon"
            className={`flex h-9 w-9 items-center justify-center rounded-xl ${STAT_TONE_CLASSES[item.tone]}`}
            aria-hidden
          >
            <Icon className="h-4 w-4" />
          </span>
          <dt className="mt-4 text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400">
            {item.label}
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {isLoading ? copy("reset_history.loading") : item.value ?? unavailableValue}
          </dd>
          <p className="tt-reset-stat-detail">
            {isLoading ? copy("reset_history.loading_detail") : item.detail}
          </p>
        </div>
      ))}
    </dl>
  );
}

function formatCountChange(percent: number | null) {
  if (percent === null || !Number.isFinite(percent)) return null;
  const rounded = Math.round(Math.abs(percent) * 10) / 10;
  if (rounded === 0) return "±0%";
  return `${percent > 0 ? "+" : "-"}${rounded.toFixed(1)}%`;
}

function ResetActivitySummary({ events, statistics }: { events: TimelineEvent[]; statistics: ResetStatistics }) {
  const zh = getCopyLocale().toLowerCase().startsWith("zh");
  // V4 item-9a: the 7-day window is anchored to TODAY (it used to anchor to
  // the newest event, so the whole panel looked frozen on that date), and all
  // counts are real — no minimum-2 floor, no force-lit heatmap cells.
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    const count = events.filter((event) => event.occurred_at.slice(0, 10) === key).length;
    return { key, count, label: `${date.getMonth() + 1}/${date.getDate()}`, offset: 6 - index };
  });
  const peak = days.reduce((best, day) => day.count > best.count ? day : best, days[0]);
  const hasRecentActivity = peak.count > 0;
  const peakDayLabel = (() => {
    if (peak.offset === 0) return copy("reset_history.activity.day_today");
    if (peak.offset === 1) return copy("reset_history.activity.day_yesterday");
    return peak.label;
  })();
  // V4 item-9a: prior window empty → percent is undefined, but the user still
  // deserves a period-over-period cue, so fall back to the absolute delta.
  const countChange = statistics.countChangePercent !== null
    ? formatCountChange(statistics.countChangePercent)
    : statistics.count > 0 && statistics.previousCount === 0
      ? (zh ? `+${statistics.count} 次` : `+${statistics.count}`)
      : null;

  return (
    <section className="tt-reset-activity tt-pressable" data-testid="reset-history-activity">
      <div className="tt-reset-activity-copy">
        <span className="tt-reset-activity-icon"><Sparkles aria-hidden /></span>
        <div>
          <h2>{zh ? "重置节奏洞察" : "Reset rhythm insight"}</h2>
          <p>{zh ? "最近 7 天重置活跃度" : "Reset activity over the last 7 days"}</p>
          <strong data-testid="reset-activity-peak-line">
            {hasRecentActivity
              ? (zh ? `${peakDayLabel}达到高峰（${peak.count} 次）` : `Peak on ${peakDayLabel} (${peak.count}x)`)
              : (zh ? "近 7 天暂无官方重置" : "No official resets in the last 7 days")}
          </strong>
        </div>
      </div>
      <div className="tt-reset-activity-data tt-reset-activity-data--right-aligned">
        <div className="tt-reset-heatmap" aria-label={zh ? "最近七天重置热力图" : "Seven-day reset heatmap"}>
          {days.map((day) => (
            <div className="tt-reset-heatmap-day" key={day.key}>
              <div className="tt-reset-heatmap-cells">
                {Array.from({ length: 9 }, (_, cellIndex) => (
                  <span
                    key={cellIndex}
                    data-level={cellIndex < Math.min(9, day.count * 2) ? Math.min(3, day.count + 1) : 0}
                  />
                ))}
              </div>
              <span className="tt-reset-heatmap-label" data-today={day.offset === 0 ? "true" : undefined}>{day.label}</span>
            </div>
          ))}
        </div>
        <div className="tt-reset-activity-stat">
          <span>
            {zh ? `近 ${statistics.periodDays} 天累计` : `Last ${statistics.periodDays} days`}
            {countChange ? (
              <em className="tt-reset-activity-change" data-positive={statistics.countChangePercent == null || statistics.countChangePercent >= 0 ? "true" : "false"} data-testid="reset-activity-count-change">
                {countChange}
              </em>
            ) : null}
          </span>
          <strong>{zh ? `${statistics.count} 次` : `${statistics.count}x`}</strong>
        </div>
        <div className="tt-reset-activity-stat tt-reset-activity-stat--divided tt-reset-activity-peak">
          <span>{zh ? "高峰日" : "Peak day"}</span>
          <strong>
            {hasRecentActivity
              ? (zh ? `${peak.label}（${peak.count} 次）` : `${peak.label} (${peak.count}x)`)
              : (zh ? "近 7 天无重置" : "None in 7 days")}
          </strong>
        </div>
      </div>
    </section>
  );
}

function ResetRecord({ event, isLatest = false }: { event: TimelineEvent; isLatest?: boolean }) {
  const sourceLabel = getSourceLabel(event);
  const resetKind = event.reset_kind && event.reset_kind in RESET_KIND_VISUALS
    ? event.reset_kind as keyof typeof RESET_KIND_VISUALS
    : "unknown";
  const kindLabel = copy(`reset_history.kind.${resetKind}`);
  const scopeLabel = copy(`reset_history.scope.${event.reset_scope || "unknown"}`);
  const { Icon, tone, className } = RESET_KIND_VISUALS[resetKind];

  return (
    <li
      data-testid="reset-history-item"
      className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 py-2 sm:grid-cols-[1.75rem_minmax(0,1fr)_auto]"
    >
      <span className="relative flex justify-center pt-0.5" aria-hidden>
        <span
          data-testid="reset-history-node"
          data-kind={resetKind}
          data-tone={tone}
          className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-lg ring-4 ${className}`}
        >
          <Icon data-kind={resetKind} className="h-3.5 w-3.5" />
        </span>
      </span>
      <p className="min-w-0 text-sm leading-6 text-oai-gray-700 dark:text-oai-gray-200">
        <span className="font-medium text-oai-black dark:text-white">{sourceLabel}</span>
        <span aria-hidden> · </span>
        {kindLabel}
        <span aria-hidden> · </span>
        {scopeLabel}
        {event.source_url && event.sourceIndex ? (
          <>
            <span aria-hidden> </span>
            <a
              data-testid="reset-history-source-ref"
              href={event.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-emerald-700 hover:underline dark:text-emerald-300"
              aria-label={`${copy("codex_reset.action.view_official")} ${event.sourceIndex}`}
            >
              [{event.sourceIndex}]
            </a>
          </>
        ) : null}
      </p>
      <time
        dateTime={event.occurred_at}
        className="col-start-2 text-xs tabular-nums text-oai-gray-500 dark:text-oai-gray-400 sm:col-start-3 sm:row-start-1 sm:pt-1"
      >
        {isLatest ? <span className="tt-reset-latest-badge">{copy("reset_history.latest")}</span> : null}
        {formatResetDateTime(event.occurred_at)}
        <ChevronRight className="tt-reset-row-chevron" aria-hidden />
      </time>
    </li>
  );
}

export function ResetHistoryPage() {
  useLayoutEffect(() => {
    const routeClass = "tt-reference-route-reset-history";
    const root = document.documentElement;
    const alreadyActive = root.classList.contains(routeClass);
    root.classList.add(routeClass);

    return () => {
      if (!alreadyActive) root.classList.remove(routeClass);
    };
  }, []);

  const { history, available } = useCodexResetEvents();
  const usePreviewHistory = shouldUseLocalPreviewHistory(available, history);
  const displayedHistory = usePreviewHistory ? PREVIEW_RESET_HISTORY : history;
  const [celebrationEffect, setCelebrationEffect] = useState(readResetCelebrationEffect);
  const [visibleRecordCount, setVisibleRecordCount] = useState(11);
  const { events, sources, statistics } = useMemo(() => {
    const official = filterRecentOfficialResets(displayedHistory)
      .sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at));
    const indexByUrl = new Map<string, number>();
    const indexedSources: TimelineSource[] = [];
    // Feed the FULL history so the previous 30-day window is available for
    // the period-over-period comparison (item-9a); the current-window stats
    // are still filtered inside calculateResetStatistics.
    const resetStatistics = calculateResetStatistics(displayedHistory);
    const indexedEvents: TimelineEvent[] = official.map((event) => {
      const url = String(event.source_url || "").trim();
      if (!url) return { ...event, sourceIndex: null };
      let sourceIndex = indexByUrl.get(url);
      if (!sourceIndex) {
        sourceIndex = indexedSources.length + 1;
        indexByUrl.set(url, sourceIndex);
        indexedSources.push({
          index: sourceIndex,
          label: getSourceLabel(event),
          url,
        });
      }
      return { ...event, sourceIndex };
    });
    return { events: indexedEvents, sources: indexedSources, statistics: resetStatistics };
  }, [displayedHistory]);
  const visibleEvents = events.slice(0, visibleRecordCount);
  const hasMoreRecords = visibleEvents.length < events.length;

  return (
    <div className="tt-reset-history-page flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="tt-reset-history-main flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8">
          <div className="mb-7 flex flex-col items-start justify-between gap-4 sm:flex-row" data-testid="reset-history-heading">
            <div className="tt-reset-heading-copy">
              <History className="tt-reset-heading-icon" aria-hidden />
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                {copy("reset_history.title")}
              </h1>
              <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400 sm:text-base">
                {copy("reset_history.subtitle")}
              </p>
            </div>
            <div className="flex shrink-0 items-end gap-2">
              <label className="grid gap-1.5 text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400">
                <span>{copy("reset_history.effect.label")}</span>
                <select
                  value={celebrationEffect}
                  onPointerDown={startResetControlPress}
                  onAnimationEnd={finishResetControlPress}
                  onChange={(event) => {
                    setCelebrationEffect(saveResetCelebrationEffect(event.target.value));
                  }}
                  className="tt-reset-effect-control tt-focus-ring h-10 min-w-40 rounded-xl border border-oai-gray-200 bg-white/80 px-3 pr-8 text-sm font-medium text-oai-gray-800 shadow-sm backdrop-blur-xl dark:border-oai-gray-700 dark:bg-oai-gray-900/75 dark:text-oai-gray-100"
                >
                  <option value="meteors">{copy("reset_history.effect.meteors")}</option>
                  <option value="fireworks">{copy("reset_history.effect.fireworks")}</option>
                </select>
              </label>
              <button
                type="button"
                aria-label={copy("reset_history.preview_celebration_aria")}
                title={copy("reset_history.preview_celebration_aria")}
                onPointerDown={startResetControlPress}
                onAnimationEnd={finishResetControlPress}
                onClick={() => triggerResetCelebrationPreview(celebrationEffect)}
                className="tt-reset-effect-control tt-focus-ring inline-flex h-10 w-10 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700 shadow-sm transition-colors hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20"
              >
                <Sparkles data-testid="reset-history-preview-icon" className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <ResetStatisticsSummary
            statistics={statistics}
            events={events}
            isLoading={!available && !usePreviewHistory}
          />

          <ResetActivitySummary events={events} statistics={statistics} />

          <section aria-labelledby="reset-history-title">
            <div className="mb-2 flex items-center gap-2">
              <History className="h-4 w-4 text-oai-gray-500" aria-hidden />
              <h2 id="reset-history-title" className="text-base font-semibold">
                {copy("reset_history.history_title")}
              </h2>
            </div>
            <div className="tt-reset-history-list" data-testid="reset-history-list">
              {events.length > 0 ? (
                <>
                  <div className="tt-reset-history-table-head" aria-hidden="true">
                    <span>{getCopyLocale().toLowerCase().startsWith("zh") ? "来源" : "Source"}</span>
                    <span>{getCopyLocale().toLowerCase().startsWith("zh") ? "公告内容" : "Announcement"}</span>
                    <span>{getCopyLocale().toLowerCase().startsWith("zh") ? "发布时间" : "Published"}</span>
                  </div>
                  <ol
                    data-testid="reset-history-timeline"
                    className="relative divide-y divide-oai-gray-200 before:absolute before:bottom-4 before:left-[0.875rem] before:top-4 before:w-px before:bg-oai-gray-200 dark:divide-oai-gray-800 dark:before:bg-oai-gray-700"
                  >
                    {visibleEvents.map((event, index) => (
                      <ResetRecord key={event.id} event={event} isLatest={index === 0} />
                    ))}
                  </ol>
                  <div className="tt-reset-history-list-footer">
                    {hasMoreRecords ? (
                      <button type="button" onClick={() => setVisibleRecordCount(events.length)}>
                        {copy("reset_history.load_more")}
                      </button>
                    ) : null}
                    <span>{copy("reset_history.records_total", { count: events.length })}</span>
                  </div>
                  {sources.length > 0 ? (
                    <footer
                      data-testid="reset-history-source-index"
                      className="mt-5 border-t border-oai-gray-200 pt-4 text-xs text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400"
                    >
                      <p className="mb-2 font-medium text-oai-gray-700 dark:text-oai-gray-200">
                        {copy("reset_history.sources_title")}
                      </p>
                      <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {sources.map((source) => (
                          <a
                            key={source.url}
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 hover:text-emerald-700 hover:underline dark:hover:text-emerald-300"
                          >
                            [{source.index}] {source.label}
                            <ArrowUpRight className="h-3 w-3" aria-hidden />
                          </a>
                        ))}
                      </div>
                    </footer>
                  ) : null}
                </>
              ) : (
                <p className="tt-reset-history-empty py-8 text-center text-sm text-oai-gray-500 dark:text-oai-gray-400">
                  {available || usePreviewHistory
                    ? copy("reset_history.empty")
                    : copy("reset_history.loading_detail")}
                </p>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
