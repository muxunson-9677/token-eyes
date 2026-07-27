import React, { useMemo } from "react";
import { History, RotateCcw } from "lucide-react";

import { useCodexResetEvents } from "../hooks/use-codex-reset-events";
import { copy, getCopyLocale } from "../lib/copy";
import type { CodexResetHistoryEvent } from "../lib/api";

function isSameLocalDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
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

function eventLabel(event: CodexResetHistoryEvent) {
  return event.type === "unexpected_quota_restore"
    ? copy("reset_history.restored")
    : copy("reset_history.completed");
}

function ResetRecord({ event }: { event: CodexResetHistoryEvent }) {
  return (
    <div
      data-testid="reset-history-item"
      className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-oai-gray-100 text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-300">
          <RotateCcw className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-oai-black dark:text-white">
            {copy("reset_history.codex")}
          </p>
          <p className="mt-0.5 text-sm text-oai-gray-500 dark:text-oai-gray-400">
            {eventLabel(event)}
          </p>
        </div>
      </div>
      <time
        dateTime={event.occurred_at}
        className="shrink-0 text-sm tabular-nums text-oai-gray-600 dark:text-oai-gray-300"
      >
        {formatResetDateTime(event.occurred_at)}
      </time>
    </div>
  );
}

export function ResetHistoryPage() {
  const { history } = useCodexResetEvents();
  const now = new Date();
  const { todayEvent, pastEvents } = useMemo(() => {
    const today = history.find((event) => (
      isSameLocalDay(new Date(event.occurred_at), now)
    )) || null;
    return {
      todayEvent: today,
      pastEvents: history
        .filter((event) => !isSameLocalDay(new Date(event.occurred_at), now))
        .slice(0, 3),
    };
  }, [history, now.getDate(), now.getMonth(), now.getFullYear()]);

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {copy("reset_history.title")}
            </h1>
            <p className="mt-3 text-sm text-oai-gray-500 dark:text-oai-gray-400 sm:text-base">
              {copy("reset_history.subtitle")}
            </p>
          </div>

          <section aria-labelledby="reset-today-title">
            <h2 id="reset-today-title" className="mb-3 text-base font-semibold">
              {copy("reset_history.today_title")}
            </h2>
            <div data-testid="reset-today">
              {todayEvent ? (
                <div className="flex items-center gap-4 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-5 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400 text-amber-950">
                    <RotateCcw className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <p className="font-semibold text-amber-950 dark:text-amber-100">
                      {eventLabel(todayEvent)}
                    </p>
                    <time
                      dateTime={todayEvent.occurred_at}
                      className="mt-1 block text-lg font-semibold tabular-nums text-amber-900 dark:text-amber-200"
                    >
                      {formatResetDateTime(todayEvent.occurred_at)}
                    </time>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section aria-labelledby="reset-history-title" className="mt-9">
            <div className="mb-3 flex items-center gap-2">
              <History className="h-4 w-4 text-oai-gray-500" aria-hidden />
              <h2 id="reset-history-title" className="text-base font-semibold">
                {copy("reset_history.history_title")}
              </h2>
            </div>
            <div
              data-testid="reset-history-list"
              className="divide-y divide-oai-gray-200 overflow-hidden rounded-2xl border border-oai-gray-200 bg-white dark:divide-oai-gray-800 dark:border-oai-gray-800 dark:bg-oai-gray-900"
            >
              {pastEvents.length > 0 ? (
                pastEvents.map((event) => <ResetRecord key={event.id} event={event} />)
              ) : (
                <p className="px-5 py-8 text-center text-sm text-oai-gray-500 dark:text-oai-gray-400">
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
