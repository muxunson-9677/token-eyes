import React from "react";
import { ArrowUpRight, BellRing } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Link } from "react-router-dom";

import { useCodexResetEvents } from "../hooks/use-codex-reset-events";
import { copy } from "../lib/copy";
import type { CodexResetEvent } from "../lib/api";

const OPENAI_HOSTS = new Set(["help.openai.com", "openai.com", "chatgpt.com"]);

function safeActionUrl(value: string | undefined, allowX = false) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || url.hash
    ) {
      return null;
    }
    if (OPENAI_HOSTS.has(url.hostname.toLowerCase())) return url.toString();
    if (
      allowX
      && url.hostname.toLowerCase() === "x.com"
      && !url.search
      && /^\/(?:OpenAI|thsottiaux)\/status\/[0-9]+\/?$/iu.test(url.pathname)
    ) {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function localEventCopy(event: CodexResetEvent) {
  const weekly = event.window === "rolling_weekly";
  if (event.type === "reset_upcoming") {
    return weekly
      ? {
          title: copy("codex_reset.upcoming.rolling_weekly.title"),
          summary: copy("codex_reset.upcoming.rolling_weekly.summary"),
        }
      : {
          title: copy("codex_reset.upcoming.rolling_5_hour.title"),
          summary: copy("codex_reset.upcoming.rolling_5_hour.summary"),
        };
  }
  if (event.type === "reset_completed" || event.type === "manual_reset") {
    return weekly
      ? {
          title: copy("codex_reset.completed.rolling_weekly.title"),
          summary: copy("codex_reset.completed.rolling_weekly.summary"),
        }
      : {
          title: copy("codex_reset.completed.rolling_5_hour.title"),
          summary: copy("codex_reset.completed.rolling_5_hour.summary"),
        };
  }
  if (event.type === "unexpected_quota_restore") {
    return {
      title: copy("codex_reset.restored.title"),
      summary: copy("codex_reset.restored.summary"),
    };
  }
  return {
    title: copy("codex_reset.available.title"),
    summary: copy("codex_reset.available.summary"),
  };
}

function ExternalAction({ href, children }: {
  href: string | null;
  children: React.ReactNode;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-amber-950 underline decoration-amber-700/35 underline-offset-4 transition-colors hover:decoration-amber-900 dark:text-amber-100 dark:decoration-amber-300/35 dark:hover:decoration-amber-100"
    >
      {children}
      <ArrowUpRight className="h-3 w-3" aria-hidden />
    </a>
  );
}

export function CodexResetBanner() {
  const reduceMotion = useReducedMotion();
  const { events, acknowledge } = useCodexResetEvents();
  const event = events.find((candidate) => (
    candidate.type === "reset_completed" || candidate.type === "manual_reset"
  )) || events.find((candidate) => candidate.type === "official_reset_announcement");
  const announcement = event?.type === "official_reset_announcement";
  const text = event
    ? announcement
      ? { title: event.title || "", summary: event.summary || "" }
      : localEventCopy(event)
    : null;
  const officialUrl = safeActionUrl(event?.official_url);
  const sourceUrl = announcement
    ? safeActionUrl(event?.source_url, true)
    : null;

  return (
    <AnimatePresence initial={false}>
      {event && text ? (
        <motion.section
          key={event.id}
          role="status"
          aria-live="polite"
          initial={reduceMotion ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
          className="shrink-0 border-b border-emerald-300/70 bg-emerald-50 px-4 py-3 text-emerald-950 dark:border-emerald-800/70 dark:bg-emerald-950/45 dark:text-emerald-50 sm:px-5"
        >
          <div className="mx-auto flex max-w-6xl items-start gap-3">
            <BellRing
              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-5">{text.title}</p>
              <p className="mt-0.5 text-xs leading-5 text-emerald-900/75 dark:text-emerald-100/75">
                {text.summary}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <Link
                  to="/settings/cost#codex-quota"
                  className="text-xs font-medium text-amber-950 underline decoration-amber-700/35 underline-offset-4 transition-colors hover:decoration-amber-900 dark:text-amber-100 dark:decoration-amber-300/35 dark:hover:decoration-amber-100"
                >
                  {copy("codex_reset.action.view_quota")}
                </Link>
                <ExternalAction href={officialUrl}>
                  {copy("codex_reset.action.open_codex")}
                </ExternalAction>
                {announcement ? (
                  <ExternalAction href={sourceUrl}>
                    {copy("codex_reset.action.view_official")}
                  </ExternalAction>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void acknowledge(event.id)}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-emerald-900/70 transition-colors hover:bg-emerald-200/60 hover:text-emerald-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:text-emerald-100/70 dark:hover:bg-emerald-800/50 dark:hover:text-emerald-50"
            >
              {copy("codex_reset.action.acknowledge")}
            </button>
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

export { safeActionUrl };
