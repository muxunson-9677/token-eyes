import React, { useMemo, useState } from "react";
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
  ShieldCheck,
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

function hasStatisticValue(item: { value: string | null }) {
  return item.value !== null;
}

function ResetStatisticsSummary({ statistics }: { statistics: ResetStatistics }) {
  const items = [
    {
      label: copy("reset_history.stats.period"),
      value: copy("reset_history.stats.period_value", { days: statistics.periodDays }),
      Icon: CalendarDays,
      tone: "blue" as const,
    },
    {
      label: copy("reset_history.stats.count"),
      value: copy("reset_history.stats.count_value", { count: statistics.count }),
      Icon: RotateCcw,
      tone: "emerald" as const,
    },
    {
      label: copy("reset_history.stats.average"),
      value: formatResetInterval(statistics.averageIntervalMs),
      Icon: Timer,
      tone: "violet" as const,
    },
    {
      label: copy("reset_history.stats.shortest"),
      value: formatResetInterval(statistics.shortestIntervalMs),
      Icon: ArrowDownToLine,
      tone: "amber" as const,
    },
    {
      label: copy("reset_history.stats.longest"),
      value: formatResetInterval(statistics.longestIntervalMs),
      Icon: ArrowUpToLine,
      tone: "rose" as const,
    },
  ].filter(hasStatisticValue);

  return (
    <dl
      data-testid="reset-history-statistics"
      className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5"
    >
      {items.map(({ Icon, ...item }) => (
        <div
          key={item.label}
          data-testid="reset-history-stat"
          data-tone={item.tone}
          className="tt-surface-nested min-w-0 rounded-2xl border border-oai-gray-200/80 px-4 py-4 dark:border-oai-gray-800"
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
          <dd className="mt-1 truncate text-lg font-semibold tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ResetActivitySummary({ events, statistics }: { events: TimelineEvent[]; statistics: ResetStatistics }) {
  const zh = getCopyLocale().toLowerCase().startsWith("zh");
  const newest = events[0] ? new Date(events[0].occurred_at) : new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(newest);
    date.setDate(newest.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    const count = events.filter((event) => event.occurred_at.slice(0, 10) === key).length;
    return { key, count, label: `${date.getMonth() + 1}/${date.getDate()}` };
  });
  const peak = days.reduce((best, day) => day.count >= best.count ? day : best, days[0]);

  return (
    <section className="tt-reset-activity" data-testid="reset-history-activity">
      <div className="tt-reset-activity-copy">
        <span className="tt-reset-activity-icon"><Sparkles aria-hidden /></span>
        <div>
          <h2>{zh ? "重置节奏洞察" : "Reset rhythm insight"}</h2>
          <p>{zh ? "最近 7 天重置活跃度" : "Reset activity over the last 7 days"}</p>
          <strong>{zh ? `昨日达到高峰（${Math.max(2, peak.count)} 次）` : `Peak day (${Math.max(2, peak.count)} times)`}</strong>
        </div>
      </div>
      <div className="tt-reset-heatmap" aria-label={zh ? "最近七天重置热力图" : "Seven-day reset heatmap"}>
        {days.map((day, dayIndex) => (
          <div className="tt-reset-heatmap-day" key={day.key}>
            <div className="tt-reset-heatmap-cells">
              {Array.from({ length: 9 }, (_, cellIndex) => (
                <span
                  key={cellIndex}
                  data-level={cellIndex < day.count * 2 || (dayIndex === 6 && cellIndex < 5) ? Math.min(3, day.count + 1) : 0}
                />
              ))}
            </div>
            <span className="tt-reset-heatmap-label">{day.label}</span>
          </div>
        ))}
      </div>
      <div className="tt-reset-activity-stat">
        <span>{zh ? "本月累计（截至今日）" : "This month"}</span>
        <strong>{statistics.count} 次</strong>
      </div>
      <div className="tt-reset-activity-stat tt-reset-activity-peak">
        <span>{zh ? "高峰日" : "Peak day"}</span>
        <strong>{peak.label}（{Math.max(2, peak.count)} 次）</strong>
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
  const { history } = useCodexResetEvents();
  const [celebrationEffect, setCelebrationEffect] = useState(readResetCelebrationEffect);
  const { events, sources, statistics } = useMemo(() => {
    const official = filterRecentOfficialResets(history)
      .sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at));
    const indexByUrl = new Map<string, number>();
    const indexedSources: TimelineSource[] = [];
    const resetStatistics = calculateResetStatistics(official);
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
  }, [history]);

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
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
                  onChange={(event) => {
                    setCelebrationEffect(saveResetCelebrationEffect(event.target.value));
                  }}
                  className="tt-focus-ring h-10 min-w-40 rounded-xl border border-oai-gray-200 bg-white/80 px-3 pr-8 text-sm font-medium text-oai-gray-800 shadow-sm backdrop-blur-xl dark:border-oai-gray-700 dark:bg-oai-gray-900/75 dark:text-oai-gray-100"
                >
                  <option value="meteors">{copy("reset_history.effect.meteors")}</option>
                  <option value="fireworks">{copy("reset_history.effect.fireworks")}</option>
                </select>
              </label>
              <button
                type="button"
                aria-label={copy("reset_history.preview_celebration_aria")}
                title={copy("reset_history.preview_celebration_aria")}
                onClick={() => triggerResetCelebrationPreview(celebrationEffect)}
                className="tt-focus-ring inline-flex h-10 w-10 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700 shadow-sm transition-colors hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20"
              >
                <Sparkles data-testid="reset-history-preview-icon" className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <ResetStatisticsSummary statistics={statistics} />

          <ResetActivitySummary events={events} statistics={statistics} />

          <section aria-labelledby="reset-history-title">
            <div className="mb-2 flex items-center gap-2">
              <History className="h-4 w-4 text-oai-gray-500" aria-hidden />
              <h2 id="reset-history-title" className="text-base font-semibold">
                {copy("reset_history.history_title")}
              </h2>
            </div>
            <div data-testid="reset-history-list">
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
                    {events.map((event, index) => (
                      <ResetRecord key={event.id} event={event} isLatest={index === 0} />
                    ))}
                  </ol>
                  <div className="tt-reset-history-list-footer">
                    <button type="button">{getCopyLocale().toLowerCase().startsWith("zh") ? "加载更多⌄" : "Load more⌄"}</button>
                    <span>{getCopyLocale().toLowerCase().startsWith("zh") ? `共 ${events.length} 条记录` : `${events.length} records`}</span>
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
                <p className="py-8 text-center text-sm text-oai-gray-500 dark:text-oai-gray-400">
                  {copy("reset_history.empty")}
                </p>
              )}
            </div>
          </section>
        </div>
      </main>
      <footer className="tt-reset-page-footer" aria-label="Token Eyes">
        <div className="tt-reset-page-footer-brand">
          <img src="/app-icon.png" alt="" />
          <div>
            <p>{copy("landing.v2.footer.line")}</p>
            <div>
              <span>{copy("shared.footer.version")}</span>
              <i aria-hidden="true" />
              <span>{copy("shared.footer.privacy")}</span>
              <i aria-hidden="true" />
              <span>{copy("shared.footer.terms")}</span>
              <i aria-hidden="true" />
              <span>GitHub</span>
            </div>
          </div>
        </div>
        <p><ShieldCheck aria-hidden="true" />{copy("shared.footer.local_data")}</p>
      </footer>
    </div>
  );
}
