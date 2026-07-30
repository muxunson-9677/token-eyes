import React, { useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { useUsageLimits } from "../hooks/use-usage-limits";
import { useLimitAccounts } from "../hooks/use-limit-accounts";
import { useLimitsDisplayPrefs } from "../hooks/use-limits-display-prefs.js";
import { copy } from "../lib/copy";
import { LimitsPageSkeleton } from "../components/LimitsPageSkeleton.jsx";
import { UsageLimitsPanel } from "../ui/dashboard/components/UsageLimitsPanel.jsx";
import { LocalOnlyNotice } from "../components/LocalOnlyNotice.jsx";
import { isMockEnabled } from "../lib/mock-data";
import { readUsageLimitsPreloadState } from "../lib/dashboard-preload.js";

const IS_LOCAL_HOST =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

export function LimitsPage() {
  const preloadedUsageLimits = readUsageLimitsPreloadState();
  const { data: usageLimits, error, isLoading, refresh: refreshUsageLimits } = useUsageLimits(
    preloadedUsageLimits
      ? { initialRefresh: true, initialState: preloadedUsageLimits, publishToPreloadCache: true }
      : { initialRefresh: true, publishToPreloadCache: true },
  );
  const prefs = useLimitsDisplayPrefs();
  const {
    data: limitAccounts,
    error: limitAccountsError,
    isLoading: limitAccountsLoading,
    refresh: refreshLimitAccounts,
  } = useLimitAccounts();
  const [accountsRefreshing, setAccountsRefreshing] = useState(false);

  const refreshAllAccounts = async () => {
    if (accountsRefreshing) return;
    setAccountsRefreshing(true);
    try {
      await Promise.all([
        refreshUsageLimits?.(),
        refreshLimitAccounts?.(),
      ]);
    } finally {
      setAccountsRefreshing(false);
    }
  };

  // Limits read the local plan/rate-limit tier from the machine running the
  // CLI; there's no cloud source. On the deployed web app, surface the
  // local-only notice instead of an empty panel.
  if (!IS_LOCAL_HOST && !isMockEnabled()) {
    return (
      <div className="flex flex-col flex-1 text-oai-black dark:text-oai-white font-oai antialiased">
        <LocalOnlyNotice />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 text-oai-black dark:text-oai-white font-oai antialiased">
      <main className="flex-1 pt-8 sm:pt-10 pb-12 sm:pb-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-row items-start justify-between gap-4 mb-8">
            <div className="min-w-0">
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-oai-black dark:text-white mb-3">
                {copy("nav.limits")}
              </h1>
              <p className="text-oai-gray-500 dark:text-oai-gray-400 text-sm sm:text-base">
                {copy("limits.page.subtitle")}
              </p>
            </div>
            <div
              role="toolbar"
              aria-label={copy("nav.limits")}
              className="tt-surface-nested flex shrink-0 items-center gap-1 rounded-[var(--tt-control-radius)] p-1"
            >
              <button
                type="button"
                onClick={() => void refreshAllAccounts()}
                disabled={accountsRefreshing}
                aria-label={copy("limits.accounts.refresh_all")}
                title={copy("limits.accounts.refresh_all")}
                className="tt-pressable tt-product-focusable inline-flex h-8 items-center gap-2 rounded-[8px] px-3 text-sm text-oai-gray-600 hover:bg-white/70 hover:text-oai-black disabled:cursor-wait disabled:opacity-60 dark:text-oai-gray-300 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <RefreshCw className={`h-4 w-4 ${accountsRefreshing ? "animate-spin" : ""}`} aria-hidden />
                <span className="hidden sm:inline">
                  {copy(accountsRefreshing ? "limits.accounts.refreshing_short" : "limits.accounts.refresh_all")}
                </span>
              </button>
              <Link
                to="/settings"
                aria-label={copy("limits.page.openSettings")}
                title={copy("limits.page.openSettings")}
                className="tt-pressable tt-product-focusable inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-oai-gray-600 hover:bg-white/70 hover:text-oai-black dark:text-oai-gray-300 dark:hover:bg-white/10 dark:hover:text-white no-underline"
              >
                <SettingsIcon className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>

          {isLoading && limitAccountsLoading ? (
            <LimitsPageSkeleton />
          ) : (
            <>
              {error ? (
                <p className="mb-4 text-sm text-red-500 dark:text-red-400">
                  {copy("shared.error.prefix", { error })}
                </p>
              ) : null}
              <UsageLimitsPanel
                claude={usageLimits?.claude}
                codex={usageLimits?.codex}
                cursor={usageLimits?.cursor}
                trae={usageLimits?.trae}
                codebuddy={usageLimits?.codebuddy}
                gemini={usageLimits?.gemini}
                hermes={usageLimits?.hermes}
                openclaw={usageLimits?.openclaw}
                opencode={usageLimits?.opencode}
                kimi={usageLimits?.kimi}
                kiro={usageLimits?.kiro}
                grok={usageLimits?.grok}
                antigravity={usageLimits?.antigravity}
                copilot={usageLimits?.copilot}
                accounts={limitAccounts?.accounts}
                accountsRefreshing={accountsRefreshing}
                order={prefs.order}
                visibility={prefs.visibility}
                displayMode={prefs.displayMode}
              />
              {limitAccountsError ? <p className="mt-4 text-sm text-red-500">{copy("shared.error.prefix", { error: limitAccountsError })}</p> : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
