import React, { useMemo } from "react";
import { ArrowUpRight, History } from "lucide-react";

import { useCodexResetEvents } from "../hooks/use-codex-reset-events";
import { copy, getCopyLocale } from "../lib/copy";
import type { CodexResetHistoryEvent } from "../lib/api";
import {
  calculateResetStatistics,
  filterRecentOfficialResets,
  type ResetStatistics,
} from "../lib/reset-history-stats";

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
  if (intervalMs === null) return copy("reset_history.stats.insufficient");
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

function ResetStatisticsSummary({ statistics }: { statistics: ResetStatistics }) {
  const items = [
    {
      label: copy("reset_history.stats.period"),
      value: copy("reset_history.stats.period_value", { days: statistics.periodDays }),
    },
    {
      label: copy("reset_history.stats.count"),
      value: copy("reset_history.stats.count_value", { count: statistics.count }),
    },
    {
      label: copy("reset_history.stats.average"),
      value: formatResetInterval(statistics.averageIntervalMs),
    },
    {
      label: copy("reset_history.stats.shortest"),
      value: formatResetInterval(statistics.shortestIntervalMs),
    },
    {
      label: copy("reset_history.stats.longest"),
      value: formatResetInterval(statistics.longestIntervalMs),
    },
  ];

  return (
    <dl
      data-testid="reset-history-statistics"
      className="mb-7 grid grid-cols-2 gap-x-5 gap-y-3 border-y border-oai-gray-200 py-4 dark:border-oai-gray-800 sm:grid-cols-5"
    >
      {items.map((item) => (
        <div key={item.label} data-testid="reset-history-stat" className="min-w-0">
          <dt className="text-xs text-oai-gray-500 dark:text-oai-gray-400">{item.label}</dt>
          <dd className="mt-1 truncate text-sm font-semibold tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ResetRecord({ event }: { event: TimelineEvent }) {
  const sourceLabel = getSourceLabel(event);
  const kindLabel = copy(`reset_history.kind.${event.reset_kind || "unknown"}`);
  const scopeLabel = copy(`reset_history.scope.${event.reset_scope || "unknown"}`);

  return (
    <li
      data-testid="reset-history-item"
      className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 py-3 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto]"
    >
      <span className="relative flex justify-center pt-1.5" aria-hidden>
        <span
          data-testid="reset-history-node"
          className="relative z-10 h-3 w-3 rounded-full bg-emerald-500 ring-4 ring-emerald-100 dark:ring-emerald-500/20"
        />
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
        {formatResetDateTime(event.occurred_at)}
      </time>
    </li>
  );
}

export function ResetHistoryPage() {
  const { history } = useCodexResetEvents();
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
          <div className="mb-7">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {copy("reset_history.title")}
            </h1>
            <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400 sm:text-base">
              {copy("reset_history.subtitle")}
            </p>
          </div>

          <ResetStatisticsSummary statistics={statistics} />

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
                  <ol
                    data-testid="reset-history-timeline"
                    className="relative divide-y divide-oai-gray-200 before:absolute before:bottom-4 before:left-[0.59rem] before:top-4 before:w-px before:bg-oai-gray-200 dark:divide-oai-gray-800 dark:before:bg-oai-gray-700"
                  >
                    {events.map((event) => (
                      <ResetRecord key={event.id} event={event} />
                    ))}
                  </ol>
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
    </div>
  );
}
