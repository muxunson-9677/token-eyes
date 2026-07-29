import React, { useMemo } from "react";
import { History, RotateCcw } from "lucide-react";

import { useCodexResetEvents } from "../hooks/use-codex-reset-events";
import { copy, getCopyLocale } from "../lib/copy";
import type { CodexResetHistoryEvent } from "../lib/api";

type ResetHistoryGroups = Map<string, CodexResetHistoryEvent[]>;

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

function localDateKey(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatGroupDate(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(getCopyLocale(), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function eventLabel(event: CodexResetHistoryEvent) {
  if (event.type === "manual_reset") return copy("reset_history.manual");
  if (event.type === "unexpected_quota_restore") {
    return copy("reset_history.restored");
  }
  return copy("reset_history.completed");
}

function windowLabel(event: CodexResetHistoryEvent) {
  return event.window === "rolling_weekly" ? "7d" : "5h";
}

function usageChange(event: CodexResetHistoryEvent) {
  if (
    event.previous_used_percent == null
    || event.current_used_percent == null
  ) {
    return "—";
  }
  return `${event.previous_used_percent}% → ${event.current_used_percent}%`;
}

function ResetRecord({ event }: { event: CodexResetHistoryEvent }) {
  return (
    <div
      data-testid="reset-history-item"
      className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          <RotateCcw className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-oai-black dark:text-white">
            Codex · {event.account_key}
          </p>
          <p className="mt-0.5 text-sm text-oai-gray-500 dark:text-oai-gray-400">
            {windowLabel(event)} · {eventLabel(event)} · {usageChange(event)}
          </p>
        </div>
      </div>
      <time
        dateTime={event.occurred_at}
        className="pl-12 text-sm tabular-nums text-oai-gray-600 dark:text-oai-gray-300 sm:pl-0"
      >
        {formatResetDateTime(event.occurred_at)}
      </time>
    </div>
  );
}

export function ResetHistoryPage() {
  const { history } = useCodexResetEvents();
  const groups = useMemo(() => {
    const sorted = [...history].sort((left, right) => (
      Date.parse(right.occurred_at) - Date.parse(left.occurred_at)
    ));
    const byDate: ResetHistoryGroups = new Map();
    for (const event of sorted) {
      const key = localDateKey(event.occurred_at);
      if (!key) continue;
      const group = byDate.get(key) || [];
      group.push(event);
      byDate.set(key, group);
    }
    return Array.from(byDate.entries()).map(([key, events]) => ({
      key,
      label: formatGroupDate(events[0].occurred_at),
      events,
    }));
  }, [history]);

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

          <section aria-labelledby="reset-history-title">
            <div className="mb-3 flex items-center gap-2">
              <History className="h-4 w-4 text-oai-gray-500" aria-hidden />
              <h2 id="reset-history-title" className="text-base font-semibold">
                {copy("reset_history.history_title")}
              </h2>
            </div>
            <div data-testid="reset-history-list" className="space-y-5">
              {groups.length > 0 ? groups.map((group) => (
                <section key={group.key} data-testid="reset-history-group">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                    {group.label}
                  </h3>
                  <div className="divide-y divide-oai-gray-200 overflow-hidden rounded-2xl border border-oai-gray-200 bg-white dark:divide-oai-gray-800 dark:border-oai-gray-800 dark:bg-oai-gray-900">
                    {group.events.map((event) => (
                      <ResetRecord key={event.id} event={event} />
                    ))}
                  </div>
                </section>
              )) : (
                <p className="rounded-2xl border border-oai-gray-200 bg-white px-5 py-8 text-center text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-400">
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
