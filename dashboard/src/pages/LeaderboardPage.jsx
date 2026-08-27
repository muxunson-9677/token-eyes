import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { Select } from "../ui/components";
import { BadgeCheck, CircleDollarSign, Coins, Info, MoreVertical, ShieldCheck, Users } from "lucide-react";
import { useInsforgeAuth } from "../contexts/InsforgeAuthContext.jsx";
import { useLoginModal } from "../contexts/LoginModalContext.jsx";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";
import { resolveAuthAccessTokenWithRetry } from "../lib/auth-token";
import { copy } from "../lib/copy";
import { formatChineseTokenCount } from "../lib/format";
import { cn } from "../lib/cn";
import { useCurrency } from "../hooks/useCurrency.js";
import { CURRENCY_USD, getCurrencySymbol } from "../lib/currency";
import {
  buildPageItems,
  clampInt,
  getPaginationFlags,
  pageContainingRank,
  prependMeRowToPage,
} from "../lib/leaderboard-ui";
import {
  LEADERBOARD_DEFAULT_AGENT,
  LEADERBOARD_DEFAULT_METRIC,
  LEADERBOARD_DEFAULT_PERIOD,
  normalizeLeaderboardAgent,
  normalizeLeaderboardMetric,
  normalizeLeaderboardPeriod,
} from "../lib/leaderboard-query.js";
import { normalizeAgentMetrics } from "../lib/leaderboard-agent-metrics.js";
import { getCumulativeYesterdayComparison } from "../lib/leaderboard-summary-details.js";
import {
  buildLocalLeaderboardRow,
  getLeaderboardPeriodDateRange,
} from "../lib/leaderboard-local-row";
import { getLocalLeaderboardState } from "../lib/leaderboard-state-client";
import { getLeaderboardSyncState } from "../lib/leaderboard-sync-state";
import { getLeaderboardBaseUrl } from "../lib/config";
import { getDashboardEntryPath } from "../lib/host-mode";
import { isMockEnabled } from "../lib/mock-data";
import { isDeveloperLeaderboardLoginEnabled } from "../lib/developer-leaderboard-preview.js";
import {
  getLeaderboard,
  getLeaderboardProfile,
  getLocalLeaderboardActualCost,
  getMyLeaderboardRank,
  getUsageSummary,
} from "../lib/api";
import {
  clearLeaderboardPreloadState,
  getLeaderboardPreloadContextKey,
  publishLeaderboardPreloadState,
  readLeaderboardPreloadState,
  readPendingLeaderboardPreloadState,
} from "../lib/dashboard-preload.js";
import { LeaderboardAvatar } from "../components/LeaderboardAvatar.jsx";

const LeaderboardProfileModal = lazy(() =>
  import("../components/leaderboard/LeaderboardProfileModal.jsx").then((m) => ({
    default: m.LeaderboardProfileModal,
  })),
);
import { LeaderboardSkeleton } from "../components/LeaderboardSkeleton.jsx";
import { LeaderboardMeChip } from "../components/LeaderboardSummaryCard.jsx";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_STORAGE_KEY = "tokentracker:leaderboard:pageSize";
const PERIOD_OPTIONS = [
  { value: "today", copyKey: "leaderboard.period.today" },
  { value: "week", copyKey: "leaderboard.period.week" },
  { value: "30d", copyKey: "leaderboard.period.30d" },
  { value: "month", copyKey: "leaderboard.period.month" },
  { value: "total", copyKey: "leaderboard.period.total" },
];
const METRIC_OPTIONS = [
  { value: "tokens", copyKey: "leaderboard.metric.tokens" },
  { value: "estimated_spend", copyKey: "leaderboard.metric.estimated_spend" },
  { value: "actual_cost", copyKey: "leaderboard.metric.actual_cost" },
];
const SOURCE_OPTIONS = [
  { value: "all", copyKey: "leaderboard.source.all" },
  { value: "codex", copyKey: "leaderboard.source.codex" },
  { value: "claude", copyKey: "leaderboard.source.claude" },
  { value: "cursor", copyKey: "leaderboard.source.cursor" },
  { value: "gemini", copyKey: "leaderboard.source.gemini" },
  { value: "opencode", copyKey: "leaderboard.source.opencode" },
  { value: "other", copyKey: "leaderboard.source.other" },
];

function readStoredPageSize() {
  if (typeof window === "undefined") return DEFAULT_PAGE_SIZE;
  try {
    const raw = window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
    const n = Number(raw);
    if (PAGE_SIZE_OPTIONS.includes(n)) return n;
  } catch {
    // ignore storage errors (private mode, disabled, etc.)
  }
  return DEFAULT_PAGE_SIZE;
}

function formatCost(value, currency, rate) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  const symbol = getCurrencySymbol(currency);
  const converted = currency === CURRENCY_USD ? n : n * rate;
  if (converted >= 1000) return `${symbol}${Math.round(converted).toLocaleString()}`;
  if (converted >= 10) return `${symbol}${Math.round(converted)}`;
  return `${symbol}${converted.toFixed(2)}`;
}

function formatSummaryCostChange(value, currency, rate) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const converted = currency === CURRENCY_USD ? numeric : numeric * rate;
  if (Math.sign(converted) === 1 && converted < 0.01) return `${getCurrencySymbol(currency)}${converted.toFixed(4)}`;
  return formatCost(numeric, currency, rate);
}

function formatYesterdayDetail(comparison, formatter) {
  if (!comparison) return null;
  const amount = formatter(comparison.change);
  if (!amount) return null;
  const percentDigits = Math.sign(comparison.percent) === 1 && comparison.percent < 0.01
    ? Math.min(8, Math.max(4, Math.ceil(-Math.log10(comparison.percent)) + 1))
    : 2;
  return copy("leaderboard.summary.yesterday_change", {
    amount: `+${amount}`,
    percent: `+${comparison.percent.toFixed(percentDigits)}%`,
  });
}

function formatLeaderboardGeneratedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function TotalTokens({ value }) {
  return <span>{formatChineseTokenCount(value)}</span>;
}

function isProvidedNumber(value) {
  return value !== null
    && value !== undefined
    && value !== ""
    && Number.isFinite(Number(value));
}

function getUnpricedTokens(entry) {
  const rows = Array.isArray(entry?.source_breakdown) ? entry.source_breakdown : [];
  return rows.reduce((sum, row) => {
    const value = Number(row?.unpriced_tokens);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
}

function RankingScore({ entry, metric, currency, rate }) {
  let value = isProvidedNumber(entry?.total_tokens)
    ? <TotalTokens value={entry.total_tokens} />
    : null;
  if (metric === "estimated_spend") {
    value = formatCost(entry?.estimated_cost_usd, currency, rate);
    const unpricedTokens = getUnpricedTokens(entry);
    if (unpricedTokens > 0) {
      const totalTokens = Number(entry?.total_tokens);
      const fullyUnpriced = Number.isFinite(totalTokens)
        && Math.sign(totalTokens) === 1
        && Math.sign(unpricedTokens - totalTokens) !== -1;
      const labelKey = fullyUnpriced ? "ticket06.pricing.unpriced" : "ticket06.pricing.partial";
      const hintKey = fullyUnpriced ? "ticket06.pricing.unpriced_hint" : "ticket06.pricing.partial_hint";
      value = (
        <span className="inline-flex flex-col items-end">
          <span>{value}</span>
          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400" title={copy(hintKey)}>
            {copy(labelKey)}
          </span>
        </span>
      );
    }
  } else if (metric === "actual_cost") {
    value = entry?.actual_cost_usd == null
      ? copy("leaderboard.actual_cost.private")
      : formatCost(entry.actual_cost_usd, currency, rate);
  }
  return value == null ? null : <span data-testid="leaderboard-score">{value}</span>;
}

function AgentDistribution({ entry, metric, currency, rate }) {
  const items = normalizeAgentMetrics(entry, metric);
  const chipItems = items.slice(0, 4);
  const usesCost = metric !== "tokens" && Object.prototype.hasOwnProperty.call(entry || {}, "agent_metrics");
  const tokenTotal = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
  if (items.length === 0) return null;
  return (
    <div className="tt-leaderboard-agent-distribution">
      <div
        className="tt-leaderboard-agent-chips flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-oai-gray-400 dark:text-oai-gray-500"
        data-testid="leaderboard-user-meta"
      >
        {chipItems.map((item) => (
          <span key={item.id} className="inline-flex items-baseline gap-1 whitespace-nowrap" data-agent={item.id}>
            <span className="font-medium text-oai-gray-500 dark:text-oai-gray-400">{item.label}</span>
            <span className="tabular-nums">
              {usesCost
                ? formatCost(item.value, currency, rate)
                : tokenTotal > 0
                  ? <>{`${((Number(item.value || 0) / tokenTotal) * 100).toFixed(2)}%`}<span className="sr-only">{formatChineseTokenCount(item.value)}</span></>
                  : formatChineseTokenCount(item.value)}
            </span>
          </span>
        ))}
      </div>
      {tokenTotal > 0 ? (
        <div className="tt-leaderboard-agent-bar" aria-hidden="true">
          {items.map((item) => (
            <span
              key={item.id}
              data-agent={item.id}
              style={{ width: `${(Number(item.value || 0) / tokenTotal) * 100}%` }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const RANK_MEDAL = {
  1: { text: "text-amber-700 dark:text-amber-300", badge: "border-amber-200 bg-amber-50 shadow-sm ring-1 ring-amber-100 dark:border-amber-500/35 dark:bg-amber-500/15 dark:ring-amber-500/15" },
  2: { text: "text-slate-600 dark:text-slate-200", badge: "border-slate-200 bg-slate-50 shadow-sm ring-1 ring-slate-100 dark:border-slate-500/35 dark:bg-slate-500/15 dark:ring-slate-500/15" },
  3: { text: "text-orange-800 dark:text-orange-300", badge: "border-orange-200 bg-orange-50 shadow-sm ring-1 ring-orange-100 dark:border-orange-500/35 dark:bg-orange-500/15 dark:ring-orange-500/15" },
};

function RankCell({ rank, pendingLabel }) {
  const medal = RANK_MEDAL[rank];
  if (medal) {
    return (
      <span
        className={cn("tt-leaderboard-rank-medal inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold", medal.text, medal.badge)}
        data-testid={`leaderboard-rank-${rank}`}
        data-rank-tier="medal"
      >
        {rank}
      </span>
    );
  }
  return (
    <span className={cn(
      "inline-flex h-8 items-center justify-center rounded-full border border-oai-gray-200 bg-white/70 font-semibold shadow-sm dark:border-white/10 dark:bg-white/[0.06]",
      rank == null ? "min-w-8 whitespace-nowrap px-2 text-[10px]" : "w-8 text-sm",
    )}>
      {rank ?? pendingLabel ?? null}
    </span>
  );
}

function normalizeLeaderboardError(err) {
  if (!err) return copy("shared.error.prefix", { error: copy("leaderboard.error.unknown") });
  const msg = err?.message || String(err);
  const safe = String(msg || "").trim() || copy("leaderboard.error.unknown");
  if (/abort|failed to fetch|fetch failed|network|timed?\s*out/i.test(safe)) {
    return copy("leaderboard.error.network");
  }
  return copy("shared.error.prefix", { error: safe });
}

function normalizeName(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isAnonymousName(value) {
  const normalized = normalizeName(value);
  if (!normalized) return true;
  return normalized.toLowerCase() === "anonymous";
}


function leaderboardAvatarSeed(entry, displayName) {
  const id = typeof entry?.user_id === "string" ? entry.user_id.trim() : "";
  if (id) return id;
  return `${entry?.rank ?? ""}:${displayName}`;
}

/**
 * Small GitHub icon that expands into a tooltip on hover. The tooltip carries a
 * clickable "Settings" link so users who haven't configured their own GitHub yet
 * know where to turn it on. Uses a named Tailwind group (`group/gh`) so hover
 * state is scoped to this span — leaderboard rows already have their own
 * `group` for row-hover backgrounds and we don't want to collide.
 */
function GithubLinkWithTooltip({ githubUrl }) {
  return (
    <span className="relative inline-flex items-center group/gh shrink-0">
      <a
        href={githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label={copy("leaderboard.github.aria")}
        className="text-oai-black hover:text-oai-gray-500 dark:text-white dark:hover:text-oai-gray-400 transition-colors"
      >
        <ProviderIcon provider="GITHUB" size={16} />
      </a>
      <span
        role="tooltip"
        // Render above the icon so the next row's sticky <td> can't cover the
        // tooltip (later rows paint higher in the stacking order). left-0 keeps
        // it inside the user column.
        //
        // CRITICAL for hover persistence:
        //  1. NO margin between tooltip and icon. A margin is dead space — the
        //     cursor leaves the group bounding box while traveling across it,
        //     hover breaks, tooltip disappears mid-motion.
        //  2. NO pointer-events-none on the tooltip. It's a descendant of the
        //     group; :hover must reach it for group-hover to stay true.
        //  3. ::before bridge extends the tooltip's hit-area down to the
        //     icon's top edge so the cursor's path from icon up into the
        //     tooltip text stays inside the group the whole time.
        // right-0 so the tooltip grows leftward from the icon (icon now sits
        // on the right side of the cell after the name). mb-2 gives an 8px
        // visual gap; ::before h-2.5 (10px) bridges it for hit-testing so the
        // cursor never leaves the group while moving from icon into tooltip.
        className="invisible opacity-0 group-hover/gh:visible group-hover/gh:opacity-100 absolute right-0 bottom-full mb-2 whitespace-nowrap rounded-md bg-oai-black dark:bg-oai-gray-700 px-2.5 py-1.5 text-[11px] leading-relaxed text-white shadow-lg transition-opacity duration-150 z-50 before:content-[''] before:absolute before:inset-x-0 before:top-full before:h-2.5"
      >
        <span className="block">{copy("leaderboard.github.tooltipAction")}</span>
        <span className="block text-oai-gray-300 dark:text-oai-gray-400">
          {copy("leaderboard.github.tooltipPrefix")}{" "}
          <Link
            to="/settings"
            onClick={(e) => e.stopPropagation()}
            className="text-white underline underline-offset-2 decoration-oai-gray-400 hover:text-oai-brand-300 hover:decoration-oai-brand-300"
          >
            {copy("leaderboard.github.tooltipSettingsLink")}
          </Link>
          {copy("leaderboard.github.tooltipSuffix")}
        </span>
      </span>
    </span>
  );
}

function LeaderboardEntryRow({
  entry,
  entryIdx,
  anonLabel,
  meLabel,
  metric,
  currency,
  rate,
  isSoleParticipant,
  openProfileModal,
}) {
  if (entry?.is_ellipsis) {
    return (
      <li
        aria-hidden="true"
        className="px-4 py-2 text-center text-xs tracking-[0.4em] text-oai-gray-400 dark:text-oai-gray-600"
      >
        …
      </li>
    );
  }

  const isMe = Boolean(entry?.is_me);
  const isTopRank = Number(entry?.rank) === 1;
  const isPinned = Boolean(entry?.is_pinned);
  const profileUserId = typeof entry?.user_id === "string" ? entry.user_id : null;
  const isCurrentUser = isMe || (isTopRank && isSoleParticipant && !profileUserId);
  const isReferenceTopEntry = isTopRank && isCurrentUser;
  const rawName = normalizeName(entry?.display_name);
  const entryName = isAnonymousName(rawName) ? anonLabel : rawName;
  const name = isCurrentUser ? meLabel : entryName;
  const rowClickable = Boolean(profileUserId);
  const openRow = rowClickable ? () => openProfileModal(profileUserId) : undefined;
  const onRowKeyDown = rowClickable
    ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openProfileModal(profileUserId);
        }
      }
    : undefined;
  const secondaryValue = metric === "tokens"
    ? formatCost(entry?.estimated_cost_usd, currency, rate)
    : isProvidedNumber(entry?.total_tokens)
      ? formatChineseTokenCount(entry.total_tokens)
      : null;

  return (
    <li
      role={rowClickable ? "button" : undefined}
      tabIndex={rowClickable ? 0 : undefined}
      onClick={openRow}
      onKeyDown={onRowKeyDown}
      aria-label={rowClickable ? copy("leaderboard.profile_modal.row_aria", { name }) : undefined}
      className={cn(
        "relative grid min-h-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 px-4 py-2.5 transition-colors sm:grid-cols-[2.25rem_minmax(0,1fr)_10rem] sm:gap-4 sm:px-5",
        isCurrentUser ? "bg-oai-brand-50/70 dark:bg-oai-brand-900/10" : "bg-white/45 dark:bg-black/10",
        isTopRank && "tt-leaderboard-top-entry tt-leaderboard-top-entry--compact tt-leaderboard-top-entry--reference",
        isPinned && "before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r before:bg-oai-brand-500",
        rowClickable && "tt-pressable tt-product-focusable cursor-pointer hover:bg-white/75 dark:hover:bg-white/[0.06]",
      )}
      data-entry-index={entryIdx}
      data-rank={entry?.rank ?? ""}
      data-layout={isTopRank ? "reference-two-tier" : "standard"}
    >
      <div className={cn("text-oai-gray-500 dark:text-oai-gray-400", isCurrentUser && "text-oai-brand-600 dark:text-oai-brand-400")}>
        <RankCell
          rank={entry?.rank}
          pendingLabel={entry?.is_local_pending ? copy("leaderboard.rank_pending") : null}
        />
      </div>

      <div className={cn(
        "tt-leaderboard-entry-user tt-leaderboard-entry-user--stacked flex min-w-0 items-center gap-3",
        isTopRank && "tt-leaderboard-top-entry-content",
      )}>
        <LeaderboardAvatar
          avatarUrl={isReferenceTopEntry ? null : entry?.avatar_url}
          displayName={isReferenceTopEntry ? "T" : (entry?.avatar_display_name || name)}
          seed={leaderboardAvatarSeed(entry, name)}
          className={isTopRank ? "tt-leaderboard-top-avatar" : undefined}
        />
        <div className="tt-leaderboard-entry-copy min-w-0 flex-1">
          <div className="tt-leaderboard-entry-identity flex min-w-0 items-center gap-2">
            <span className={cn(
              "truncate text-sm font-semibold sm:text-base",
              isCurrentUser || isTopRank ? "text-oai-brand-700 dark:text-oai-brand-300" : "text-oai-gray-900 dark:text-oai-gray-100",
            )}>
              {name}
            </span>
            {isCurrentUser ? (
              <span className="tt-leaderboard-current-user">
                <BadgeCheck className="tt-leaderboard-current-user-icon" aria-hidden="true" />
                {entry?.current_user_label || copy("leaderboard.current_user_label")}
              </span>
            ) : null}
            {!isReferenceTopEntry && entry?.github_url && <GithubLinkWithTooltip githubUrl={entry.github_url} />}
          </div>
          <div className="tt-leaderboard-entry-distribution tt-leaderboard-entry-distribution--nearby mt-2.5 min-w-0">
            <AgentDistribution entry={entry} metric={metric} currency={currency} rate={rate} />
          </div>
        </div>
      </div>

      <div className="tt-leaderboard-score-column min-w-[6.5rem] pt-0.5 text-right tabular-nums sm:min-w-0">
        <div className="text-xl font-bold leading-7 text-oai-gray-900 dark:text-oai-gray-100 sm:text-[22px]">
          <RankingScore entry={entry} metric={metric} currency={currency} rate={rate} />
        </div>
        {secondaryValue != null ? (
          <div className="mt-1 text-sm text-oai-gray-400 dark:text-oai-gray-500">
            {secondaryValue}
          </div>
        ) : null}
      </div>
      {entry?.show_actions ? (
        <MoreVertical className="tt-leaderboard-row-actions" aria-hidden="true" />
      ) : null}
    </li>
  );
}

export function LeaderboardPage({
  auth,
  signedIn,
  sessionSoftExpired,
}) {
  useLayoutEffect(() => {
    const routeClass = "tt-reference-route-leaderboard";
    const root = document.documentElement;
    const alreadyActive = root.classList.contains(routeClass);
    root.classList.add(routeClass);

    return () => {
      if (!alreadyActive) root.classList.remove(routeClass);
    };
  }, []);

  const location = useLocation();
  const navigate = useNavigate();
  const {
    enabled: cloudAuthEnabled,
    signedIn: cloudSignedIn,
    loading: authLoading,
    user: cloudUser,
    displayName: cloudDisplayName,
    signOut: cloudSignOut,
  } = useInsforgeAuth();
  const { openLoginModal } = useLoginModal();
  const { currency, rate } = useCurrency();
  const leaderboardBaseUrl = useMemo(() => getLeaderboardBaseUrl(), []);
  const mockEnabled = isMockEnabled();
  const developerLoginEnabled = isDeveloperLeaderboardLoginEnabled();
  const developerPreviewActive = useMemo(() => {
    if (!developerLoginEnabled) return false;
    const params = new URLSearchParams(location?.search || "");
    return params.get("dev_login") === "1";
  }, [developerLoginEnabled, location?.search]);
  const leaderboardMockEnabled = mockEnabled || developerPreviewActive;
  const authTokenAllowed = signedIn && !sessionSoftExpired;
  const authAccessToken = useMemo(() => {
    if (!authTokenAllowed) return null;
    if (typeof auth === "function") return auth;
    if (typeof auth === "string") return auth;
    if (auth && typeof auth === "object") return auth;
    return null;
  }, [auth, authTokenAllowed]);
  const effectiveAuthToken = authTokenAllowed ? authAccessToken : null;

  const [listPage, setListPage] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [todaySummary, setTodaySummary] = useState(null);
  const [syncRevision, setSyncRevision] = useState(0);
  const [participationSync, setParticipationSync] = useState("idle");
  const [pageSize, setPageSizeState] = useState(readStoredPageSize);
  const [modalUserId, setModalUserId] = useState(null);
  const openProfileModal = useCallback((userId) => {
    if (typeof userId === "string" && userId.trim()) setModalUserId(userId.trim());
  }, []);
  const closeProfileModal = useCallback(() => setModalUserId(null), []);

  const setPageSize = useCallback((next) => {
    const normalized = PAGE_SIZE_OPTIONS.includes(next) ? next : DEFAULT_PAGE_SIZE;
    setPageSizeState(normalized);
    setListPage(1);
    try {
      window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(normalized));
    } catch {
      // ignore
    }
  }, []);
  const period = useMemo(() => {
    const params = new URLSearchParams(location?.search || "");
    return normalizeLeaderboardPeriod(params.get("period") || LEADERBOARD_DEFAULT_PERIOD);
  }, [location?.search]);
  const metric = useMemo(() => {
    const params = new URLSearchParams(location?.search || "");
    return normalizeLeaderboardMetric(params.get("metric") || LEADERBOARD_DEFAULT_METRIC);
  }, [location?.search]);
  const source = useMemo(() => {
    const params = new URLSearchParams(location?.search || "");
    return normalizeLeaderboardAgent(params.get("source") || LEADERBOARD_DEFAULT_AGENT);
  }, [location?.search]);
  const effectiveSource = metric === "actual_cost" ? "all" : source;

  const handleDimensionChange = (key, value) => {
    const current = key === "period" ? period : key === "metric" ? metric : source;
    if (value === current) return;
    const params = new URLSearchParams(location?.search || "");
    params.set(key, value);
    setListPage(1);
    navigate(`${location?.pathname || "/leaderboard"}?${params.toString()}`, { replace: true });
  };

  const handleEmailSignIn = useCallback(() => {
    if (!cloudAuthEnabled) return;
    openLoginModal({ emailOnly: true });
  }, [cloudAuthEnabled, openLoginModal]);

  const handleDeveloperSignIn = useCallback(() => {
    const params = new URLSearchParams(location?.search || "");
    params.set("dev_login", "1");
    params.set("mock", "1");
    navigate(`${location?.pathname || "/leaderboard"}?${params.toString()}`, { replace: true });
  }, [location?.pathname, location?.search, navigate]);

  const handleDeveloperSignOut = useCallback(() => {
    const params = new URLSearchParams(location?.search || "");
    params.delete("dev_login");
    params.delete("mock");
    const search = params.toString();
    navigate(`${location?.pathname || "/leaderboard"}${search ? `?${search}` : ""}`, { replace: true });
  }, [location?.pathname, location?.search, navigate]);

  const handleAccountSignOut = useCallback(() => {
    void cloudSignOut?.();
  }, [cloudSignOut]);

  useEffect(() => {
    setListPage(1);
  }, [metric, period, source]);

  useEffect(() => {
    const onSync = (event) => {
      const status = event?.detail?.status || "idle";
      setParticipationSync(status);
      if (status === "ready") setSyncRevision((value) => value + 1);
    };
    window.addEventListener("token-eyes:leaderboard-sync", onSync);
    return () => window.removeEventListener("token-eyes:leaderboard-sync", onSync);
  }, []);

  const listOffset = useMemo(() => {
    const safePage = clampInt(listPage, { min: 1, max: 1_000_000, fallback: 1 });
    return (safePage - 1) * pageSize;
  }, [listPage, pageSize]);
  const leaderboardAccessMode = useMemo(() => {
    if (leaderboardMockEnabled) return "mock";
    if (cloudSignedIn) return "cloud";
    if (leaderboardBaseUrl) return "public";
    return "unavailable";
  }, [cloudSignedIn, leaderboardBaseUrl, leaderboardMockEnabled]);

  const leaderboardPreloadContextKey = useMemo(
    () =>
      getLeaderboardPreloadContextKey({
        accessMode: leaderboardAccessMode,
        baseUrl: leaderboardBaseUrl,
        metric,
        mockEnabled: leaderboardMockEnabled,
        period,
        source: effectiveSource,
        pageSize,
        offset: listOffset,
      }),
    [effectiveSource, leaderboardAccessMode, leaderboardBaseUrl, leaderboardMockEnabled, listOffset, metric, pageSize, period],
  );

  const [listState, setListState] = useState(() => {
    const preloadedState = readLeaderboardPreloadState(leaderboardPreloadContextKey);
    if (preloadedState) {
      return {
        loading: false,
        error: null,
        data: preloadedState.data,
        contextKey: leaderboardPreloadContextKey,
      };
    }
    return {
      loading: false,
      error: null,
      data: null,
      contextKey: null,
    };
  });

  useEffect(() => {
    // Mock leaderboard uses local getMockLeaderboard(); real data needs InsForge URL from getLeaderboardBaseUrl().
    if ((!leaderboardBaseUrl && !leaderboardMockEnabled) || (!leaderboardMockEnabled && leaderboardAccessMode === "unavailable")) {
      setListState({ loading: false, error: null, data: null, contextKey: null });
      return;
    }
    const cachedState = readLeaderboardPreloadState(leaderboardPreloadContextKey);
    let active = true;
    if (cachedState) {
      setListState({
        loading: false,
        error: null,
        data: cachedState.data,
        contextKey: leaderboardPreloadContextKey,
      });
    } else {
      // V4 item-8: same-context refetch (sync refresh) keeps rows on screen;
      // a context change (period/metric/source/page) clears them so stale
      // rows never masquerade as the new dimension. The frame below keeps
      // its height via same-size placeholders, so the buttons never jump.
      setListState((prev) => ({
        loading: true,
        error: null,
        data: prev.contextKey === leaderboardPreloadContextKey ? prev.data : null,
        contextKey: leaderboardPreloadContextKey,
      }));
    }
    (async () => {
      const pendingPreload = readPendingLeaderboardPreloadState(leaderboardPreloadContextKey);
      const preloadedEntry = pendingPreload ? await pendingPreload : null;
      const data = preloadedEntry?.data ?? await getLeaderboard({
        baseUrl: leaderboardBaseUrl,
        metric,
        period,
        source: effectiveSource,
        limit: pageSize,
        offset: listOffset,
        ...(developerPreviewActive ? { mock: true } : {}),
      });
      if (!active) return;
      publishLeaderboardPreloadState(data, {
        activeContextKey: leaderboardPreloadContextKey,
        contextKey: leaderboardPreloadContextKey,
        source: "page-load",
      });
      setListState({
        loading: false,
        error: null,
        data,
        contextKey: leaderboardPreloadContextKey,
      });
    })().catch((err) => {
      if (!active) return;
      const error = normalizeLeaderboardError(err);
      clearLeaderboardPreloadState(leaderboardPreloadContextKey);
      setListState({
        loading: false,
        error,
        data: null,
        contextKey: leaderboardPreloadContextKey,
      });
    });
    return () => {
      active = false;
    };
  }, [
    leaderboardBaseUrl,
    leaderboardAccessMode,
    developerPreviewActive,
    effectiveSource,
    leaderboardPreloadContextKey,
    listOffset,
    leaderboardMockEnabled,
    metric,
    period,
    pageSize,
    syncRevision,
  ]);

  const renderCachedState = useMemo(() => {
    if (listState.contextKey === leaderboardPreloadContextKey) return null;
    return readLeaderboardPreloadState(leaderboardPreloadContextKey);
  }, [leaderboardPreloadContextKey, listState.contextKey]);
  const currentListState = useMemo(() => {
    if (listState.contextKey === leaderboardPreloadContextKey) return listState;
    if (renderCachedState) {
      return {
        loading: false,
        error: null,
        data: renderCachedState.data,
        contextKey: leaderboardPreloadContextKey,
      };
    }
    return {
      loading: Boolean(leaderboardBaseUrl || leaderboardMockEnabled) && leaderboardAccessMode !== "unavailable",
      error: null,
      // Uncached context: rows clear (no cross-dimension data), the layout
      // holds via loading placeholders rendered by the frame below.
      data: null,
      contextKey: leaderboardPreloadContextKey,
    };
  }, [
    leaderboardAccessMode,
    leaderboardBaseUrl,
    leaderboardPreloadContextKey,
    listState,
    leaderboardMockEnabled,
    renderCachedState,
  ]);
  const listData = currentListState.data;
  const [me, setMe] = useState(null);
  const [localMe, setLocalMe] = useState(null);
  const [localRefreshRevision, bumpLocalRefreshRevision] = useState(0);

  useEffect(() => {
    const refreshLocal = () => bumpLocalRefreshRevision((revision) => revision + 1);
    const interval = window.setInterval(refreshLocal, 60_000);
    window.addEventListener("focus", refreshLocal);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshLocal);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!cloudSignedIn || !effectiveAuthToken) {
      setMe(null);
      return () => {
        active = false;
      };
    }
    (async () => {
      const accessToken = await resolveAuthAccessTokenWithRetry(effectiveAuthToken);
      if (!accessToken) return;
      const result = await getMyLeaderboardRank({
        accessToken,
        period,
        metric,
        source: effectiveSource,
      });
      const rawMe = result?.me;
      let nextMe = Array.isArray(rawMe) ? rawMe[0] || null : rawMe || null;
      if (!nextMe && cloudUser?.id && period !== "today") {
        const profile = await getLeaderboardProfile({
          accessToken,
          userId: cloudUser.id,
          period,
        });
        if (profile?.totals) {
          const byProvider = Array.isArray(profile.by_provider) ? profile.by_provider : [];
          nextMe = {
            user_id: cloudUser.id,
            display_name: profile.user?.display_name || copy("leaderboard.me_label"),
            avatar_url: profile.user?.avatar_url || null,
            rank: profile.user?.rank ?? null,
            total_tokens: Number(profile.totals.total_tokens) || 0,
            estimated_cost_usd: Number(profile.totals.estimated_cost_usd) || 0,
            source_breakdown: byProvider.map((row) => ({
              source: row.source,
              total_tokens: Number(row.total_tokens) || 0,
              estimated_cost_usd: Number(row.estimated_cost_usd) || 0,
            })),
            is_me: true,
          };
        }
      }
      if (active) setMe(nextMe);
    })().catch(() => {
      if (active) setMe(null);
    });
    return () => {
      active = false;
    };
  }, [cloudSignedIn, cloudUser?.id, effectiveAuthToken, effectiveSource, metric, period, syncRevision]);

  useEffect(() => {
    let active = true;
    const pageAccountId =
      (typeof cloudUser?.id === "string" && cloudUser.id.trim())
      || (authAccessToken && typeof authAccessToken === "object"
        && typeof authAccessToken.userId === "string" && authAccessToken.userId.trim())
      || (typeof me?.user_id === "string" && me.user_id.trim())
      || "";
    if (!cloudSignedIn || !pageAccountId) {
      setLocalMe(null);
      return () => {
        active = false;
      };
    }
    (async () => {
      const range = getLeaderboardPeriodDateRange(period);
      const requestedSources = effectiveSource === "all" || effectiveSource === "other"
        ? undefined
        : [effectiveSource];
      const localState = await getLocalLeaderboardState();
      let estimatedCostUsd = null;
      if (effectiveSource !== "other") {
        try {
          const usageSummary = await getUsageSummary({
            ...range,
            sources: requestedSources,
            timeZone: "Asia/Shanghai",
          });
          const cost = Number(usageSummary?.totals?.cost_usd);
          estimatedCostUsd = Number.isFinite(cost) && cost >= 0 ? cost : null;
        } catch {
          // Token totals come from compact local state; cost is optional.
        }
      }

      let actualCostUsd = null;
      const shareActualCost = getLeaderboardSyncState(pageAccountId).shareActualCost === true;
      if (effectiveSource === "all" && shareActualCost) {
        try {
          const actualCosts = await getLocalLeaderboardActualCost();
          actualCostUsd = actualCosts?.[period] ?? null;
        } catch {
          // Actual cost remains private/unavailable without blocking local Token display.
        }
      }

      const metadata = cloudUser?.user_metadata && typeof cloudUser.user_metadata === "object"
        ? cloudUser.user_metadata
        : {};
      const localRow = buildLocalLeaderboardRow(localState, {
        period,
        source: effectiveSource,
        userId: pageAccountId,
        displayName: cloudDisplayName
          || (authAccessToken && typeof authAccessToken === "object" ? authAccessToken.name : "")
          || me?.display_name
          || copy("leaderboard.me_label"),
        avatarUrl: metadata.avatar_url || metadata.picture || null,
        estimatedCostUsd,
        actualCostUsd,
      });
      if (active) setLocalMe(localRow);
    })().catch(() => {
      if (active) setLocalMe(null);
    });
    return () => {
      active = false;
    };
  }, [
    authAccessToken,
    cloudDisplayName,
    cloudSignedIn,
    cloudUser,
    effectiveSource,
    me?.display_name,
    me?.user_id,
    metric,
    period,
    localRefreshRevision,
    syncRevision,
  ]);

  const totalPages = listData?.total_pages ?? null;
  const totalEntries = listData?.ranked_entry_count ?? listData?.total_entries ?? 0;
  const rawParticipantCount = listData?.participant_count
    ?? listData?.ranked_entry_count
    ?? listData?.total_entries;
  const cloudParticipantCount = isProvidedNumber(rawParticipantCount)
    ? Math.max(0, Number(rawParticipantCount))
    : null;
  const cloudAggregateTotalTokens = isProvidedNumber(listData?.aggregate_total_tokens)
    ? Math.max(0, Number(listData.aggregate_total_tokens))
    : null;
  const cloudAggregateTotalCost = isProvidedNumber(listData?.aggregate_total_cost_usd)
    ? Math.max(0, Number(listData.aggregate_total_cost_usd))
    : null;
  const currentPage = listData?.page ?? listPage;
  const pageItems = useMemo(() => {
    return buildPageItems(currentPage, totalPages);
  }, [currentPage, totalPages]);

  const from = listData?.from || null;
  const to = listData?.to || null;
  const generatedAt = listData?.generated_at || null;
  const generatedAtLabel = generatedAt ? formatLeaderboardGeneratedAt(generatedAt) : null;
  const meLabel = copy("leaderboard.me_label");
  const anonLabel = copy("leaderboard.anon_label");
  const periodLabel = copy(
    PERIOD_OPTIONS.find((option) => option.value === period)?.copyKey || "leaderboard.period.total",
  );
  const displayEntries = useMemo(() => {
    const rows = Array.isArray(listData?.entries) ? listData.entries : [];
    const displayedMe = localMe
      ? {
        ...localMe,
        rank: me?.rank ?? null,
        is_local_pending: !me?.rank,
      }
      : null;
    return prependMeRowToPage({ entries: rows, me: displayedMe, meLabel });
  }, [listData?.entries, localMe, me, meLabel]);
  const reconciledSummary = useMemo(() => {
    const rows = Array.isArray(listData?.entries) ? listData.entries : [];
    if (!localMe) {
      return {
        participantCount: cloudParticipantCount,
        aggregateTotalTokens: cloudAggregateTotalTokens,
        aggregateTotalCost: cloudAggregateTotalCost,
      };
    }

    const matchingIndex = me?.user_id
      ? rows.findIndex((entry) => entry?.user_id === me.user_id)
      : -1;
    const rankMatchIndex = matchingIndex !== -1 || me?.rank == null
      ? matchingIndex
      : rows.findIndex(function matchesRank(entry) {
        return Number(entry?.rank) === Number(me.rank);
      });
    const inferredPendingMatch = (
      rankMatchIndex < 0
      && me?.rank == null
      && rows.length === 1
      && !rows[0]?.user_id
    ) ? rows[0] : null;
    const matchedCloudRow = rankMatchIndex !== -1 ? rows[rankMatchIndex] : inferredPendingMatch;
    const localTokens = Math.max(0, Number(localMe.total_tokens) || 0);
    const localCost = Number.isFinite(Number(localMe.estimated_cost_usd))
      ? Math.max(0, Number(localMe.estimated_cost_usd))
      : null;

    if (matchedCloudRow) {
      const oldTokens = Math.max(0, Number(matchedCloudRow.total_tokens) || 0);
      const oldCost = Math.max(0, Number(matchedCloudRow.estimated_cost_usd) || 0);
      return {
        participantCount: cloudParticipantCount,
        aggregateTotalTokens: cloudAggregateTotalTokens == null
          ? null
          : Math.max(0, cloudAggregateTotalTokens - oldTokens + localTokens),
        aggregateTotalCost: localCost == null
          ? cloudAggregateTotalCost
          : cloudAggregateTotalCost == null
            ? null
            : Math.max(0, cloudAggregateTotalCost - oldCost + localCost),
      };
    }

    if (rows.length === 0) {
      return {
        participantCount: 1,
        aggregateTotalTokens: localTokens,
        aggregateTotalCost: localCost,
      };
    }

    return {
      participantCount: cloudParticipantCount == null ? null : cloudParticipantCount + 1,
      aggregateTotalTokens: cloudAggregateTotalTokens == null
        ? null
        : Math.max(0, cloudAggregateTotalTokens + localTokens),
      aggregateTotalCost: localCost == null
        ? cloudAggregateTotalCost
        : cloudAggregateTotalCost == null
          ? null
          : Math.max(0, cloudAggregateTotalCost + localCost),
    };
  }, [
    cloudAggregateTotalCost,
    cloudAggregateTotalTokens,
    cloudParticipantCount,
    listData?.entries,
    localMe,
    me?.rank,
    me?.user_id,
  ]);
  const {
    participantCount,
    aggregateTotalTokens,
    aggregateTotalCost,
  } = reconciledSummary;
  const statusMe = useMemo(() => {
    const rankedMe = Number(me?.rank);
    if (Number.isFinite(rankedMe) && rankedMe >= 1) {
      return me;
    }

    const visibleCurrentEntry = displayEntries.find((entry) => {
      const entryRank = Number(entry?.rank);
      return entry?.is_me === true && Number.isFinite(entryRank) && entryRank >= 1;
    });
    if (visibleCurrentEntry) {
      return { ...visibleCurrentEntry, rank: Number(visibleCurrentEntry.rank) };
    }

    if (!localMe) {
      return null;
    }

    const localUserId = typeof localMe.user_id === "string" ? localMe.user_id : "";
    const matchedEntry = displayEntries.find((entry) => {
      const entryRank = Number(entry?.rank);
      return entry?.user_id === localUserId
        && Number.isFinite(entryRank)
        && entryRank >= 1;
    });
    const matchedRank = Number(matchedEntry?.rank);
    if (Number.isFinite(matchedRank) && matchedRank >= 1) {
      return { ...localMe, rank: matchedRank };
    }

    if (Number(participantCount) === 1) {
      return { ...localMe, rank: 1 };
    }

    return null;
  }, [displayEntries, localMe, me, participantCount]);

  useEffect(() => {
    const hasServerSummaryDetails = Boolean(
      listData?.summary_details?.tokens || listData?.summary_details?.cost,
    );
    if (
      period !== "total"
      || hasServerSummaryDetails
      || !isProvidedNumber(aggregateTotalTokens)
      || !isProvidedNumber(aggregateTotalCost)
    ) {
      setTodaySummary(null);
      return undefined;
    }

    let active = true;
    getLeaderboard({
      baseUrl: leaderboardBaseUrl,
      metric: "tokens",
      period: "today",
      source: effectiveSource,
      limit: 1,
      offset: 0,
      ...(developerPreviewActive ? { mock: true } : {}),
    }).then((data) => {
      if (!active) return;
      setTodaySummary({
        tokens: isProvidedNumber(data?.aggregate_total_tokens) ? Number(data.aggregate_total_tokens) : null,
        cost: isProvidedNumber(data?.aggregate_total_cost_usd) ? Number(data.aggregate_total_cost_usd) : null,
      });
    }).catch(() => {
      if (active) setTodaySummary(null);
    });
    return () => {
      active = false;
    };
  }, [
    aggregateTotalCost,
    aggregateTotalTokens,
    developerPreviewActive,
    effectiveSource,
    leaderboardBaseUrl,
    listData?.summary_details?.cost,
    listData?.summary_details?.tokens,
    period,
  ]);

  const participantSummaryDetail = listData?.summary_details?.participants
    || (isProvidedNumber(participantCount)
      ? copy("leaderboard.summary.active_today", { count: Number(participantCount).toLocaleString() })
      : null);
  const tokenSummaryDetail = listData?.summary_details?.tokens
    || formatYesterdayDetail(
      getCumulativeYesterdayComparison(aggregateTotalTokens, todaySummary?.tokens),
      formatChineseTokenCount,
    );
  const costSummaryDetail = listData?.summary_details?.cost
    || formatYesterdayDetail(
      getCumulativeYesterdayComparison(aggregateTotalCost, todaySummary?.cost),
      (value) => formatSummaryCostChange(value, currency, rate),
    );

  const myPage = useMemo(
    () => pageContainingRank(me?.rank, pageSize),
    [me?.rank, pageSize],
  );
  const onMyPage = myPage != null && myPage === currentPage;
  const handleJumpToMe = useCallback(() => {
    if (myPage != null) setListPage(myPage);
  }, [myPage]);

  const { canPrev, canNext } = getPaginationFlags({ page: currentPage, totalPages });

  const hasEntries = Array.isArray(displayEntries) && displayEntries.length !== 0;
  let listBody = null;
  if (currentListState.loading && !hasEntries) {
    listBody = <LeaderboardSkeleton rows={pageSize} />;
  } else if (currentListState.error && !hasEntries) {
    listBody = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-red-500 dark:text-red-400">{currentListState.error}</p>
        <button
          type="button"
          onClick={() => setSyncRevision((value) => value + 1)}
          className="mt-4 inline-flex h-9 items-center justify-center rounded-lg border border-oai-gray-200 px-4 text-sm font-medium text-oai-gray-700 transition-colors hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:text-oai-gray-200 dark:hover:bg-oai-gray-800"
        >
          {copy("leaderboard.retry")}
        </button>
      </div>
    );
  } else if (hasEntries) {
    listBody = (
      <>
        <ol className="divide-y divide-oai-gray-100 dark:divide-oai-gray-800/70">
          {displayEntries.map((entry, entryIdx) => (
            <LeaderboardEntryRow
              key={entry?.is_ellipsis
                ? `ellipsis-${entryIdx}`
                : `row-${entry?.rank}-${entry?.user_id || entryIdx}-${entry?.is_pinned ? "pin" : "entry"}`}
              entry={entry}
              entryIdx={entryIdx}
              anonLabel={anonLabel}
              meLabel={meLabel}
              metric={metric}
              currency={currency}
              rate={rate}
              isSoleParticipant={Number(reconciledSummary.participantCount) === 1}
              openProfileModal={openProfileModal}
            />
          ))}
        </ol>
        {currentListState.loading ? (
          /* V4 item-8: ghost rows hold the list height while public rows for
             the new dimension load behind the pinned local row. */
          <div
            aria-hidden="true"
            className="divide-y divide-oai-gray-100 border-t border-oai-gray-100 dark:divide-oai-gray-800/70 dark:border-oai-gray-800/70"
          >
            {Array.from({ length: Math.max(3, Math.min(pageSize - displayEntries.length, 8)) }).map((_, idx) => (
              <div key={idx} className="flex min-h-[78px] items-center gap-3 px-4 py-3 sm:px-5">
                <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-oai-gray-100 dark:bg-oai-gray-800" />
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-40 max-w-full animate-pulse rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
                  <div className="mt-2 h-3 w-24 animate-pulse rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
                </div>
                <div className="h-4 w-16 animate-pulse rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
              </div>
            ))}
          </div>
        ) : null}
      </>
    );
  } else {
    listBody = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("leaderboard.empty")}</p>
      </div>
    );
  }

  const jumpToListPage = () => {
    const parsed = Number.parseInt(String(pageInput).trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    const max = typeof totalPages === "number" && totalPages > 0 ? totalPages : parsed;
    setListPage(Math.min(parsed, max));
  };

  let pageButtons = null;
  if (typeof totalPages === "number") {
    pageButtons = pageItems.map((p, idx) => {
      if (p == null) {
        return (
          <span
            key={`ellipsis-${idx}`}
            className="px-2 text-oai-gray-400 dark:text-oai-gray-500"
          >
            {copy("leaderboard.pagination.ellipsis")}
          </span>
        );
      }
      return (
        <button
          key={`page-${p}`}
          type="button"
          aria-current={p === currentPage ? "page" : undefined}
          onClick={() => setListPage(p)}
          disabled={currentListState.loading}
        >
          {String(p)}
        </button>
      );
    });
  } else {
    pageButtons = (
      <span className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
        {copy("leaderboard.pagination.page_unknown", { page: String(currentPage) })}
      </span>
    );
  }

  return (
    <div className="tt-leaderboard-page flex flex-col flex-1 text-oai-black dark:text-oai-white font-oai antialiased">
      <main className="flex-1 pt-8 sm:pt-10 pb-12 sm:pb-16">
        <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8">
          {/* Title gets its own row. */}
          <div className="mb-5 sm:mb-6">
            <div className="mb-2 flex items-center justify-between gap-4 sm:mb-3">
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-oai-black dark:text-white">
                {copy("leaderboard.title")}
              </h1>
              <div className="tt-leaderboard-action-group flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate("/settings/basic")}
                  className="tt-leaderboard-action-button tt-product-focusable tt-pressable inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors"
                >
                  {copy("settings.section.account")}
                </button>
                <button
                  type="button"
                  onClick={handleAccountSignOut}
                  className="tt-leaderboard-action-button tt-product-focusable tt-pressable inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors"
                >
                  {copy("settings.account.signOut")}
                </button>
                <Link
                  to="/leaderboard/rules"
                  className="tt-leaderboard-action-button tt-product-focusable tt-pressable inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-medium no-underline transition-colors"
                >
                  {copy("leaderboard.rules_link")}
                </Link>
              </div>
            </div>
            <p className="text-oai-gray-500 dark:text-oai-gray-400 text-sm sm:text-base">
              <span data-testid="leaderboard-range-label">
                {period === "total"
                  ? copy("leaderboard.range.total")
                  : from && to
                    ? copy("leaderboard.range", { period: periodLabel, from, to })
                    : copy("leaderboard.range_loading", { period: periodLabel })}
              </span>
              {generatedAtLabel && (
                <span className="ml-2 pl-2 border-l border-oai-gray-200 dark:border-oai-gray-800 hidden sm:inline-block text-oai-gray-400 dark:text-oai-gray-500 text-xs">
                  {copy("leaderboard.generated_at", { ts: generatedAtLabel })}
                </span>
              )}
            </p>
            {!listData && !currentListState.error ? (
              /* V4 item-8: ghost cards mirror the real summary card DOM
                 (same classes, nbsp text) so their height matches exactly and
                 the toolbar below never jumps while an uncached load runs.
                 They render whenever data is absent (loading OR the brief
                 idle gap before the first fetch) — only an error yields. */
              <dl
                className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3"
                data-testid="leaderboard-summary-placeholder"
                aria-hidden="true"
              >
                {[0, 1, 2].map((idx) => (
                  <div key={idx} className="tt-leaderboard-summary-card tt-surface-nested flex items-center gap-3 rounded-[var(--tt-card-radius)] px-4 py-3">
                    <span className="flex h-9 w-9 shrink-0 animate-pulse items-center justify-center rounded-xl bg-oai-gray-100 dark:bg-oai-gray-800" />
                    <div className="min-w-0 flex-1">
                      <dt className="text-xs text-transparent">
                        <span className="inline-block h-3 w-16 animate-pulse rounded bg-oai-gray-100 align-middle dark:bg-oai-gray-800" />
                      </dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums text-transparent">
                        <span className="inline-block h-5 w-24 animate-pulse rounded bg-oai-gray-100 align-middle dark:bg-oai-gray-800" />
                      </dd>
                      <p className="tt-leaderboard-summary-detail text-transparent">
                        <span className="inline-block h-3 w-20 animate-pulse rounded bg-oai-gray-100 align-middle dark:bg-oai-gray-800" />
                      </p>
                    </div>
                  </div>
                ))}
              </dl>
            ) : null}
            {listData && [participantCount, aggregateTotalTokens, aggregateTotalCost].some(isProvidedNumber) && (
              <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="leaderboard-summary">
                {isProvidedNumber(participantCount) ? <div className="tt-leaderboard-summary-card tt-surface-nested tt-pressable flex items-center gap-3 rounded-[var(--tt-card-radius)] px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 ring-1 ring-sky-100 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/20" data-testid="leaderboard-summary-icon">
                    <Users className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <dt className="text-xs text-oai-gray-500 dark:text-oai-gray-400">{copy("leaderboard.summary.participant_label")}</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">{Number(participantCount).toLocaleString()}</dd>
                    {/* V4 item-8: detail line always renders (nbsp fallback) so
                        the card height never varies across periods/metrics. */}
                    <p className="tt-leaderboard-summary-detail">{participantSummaryDetail || "\u00A0"}</p>
                  </div>
                </div> : null}
                {isProvidedNumber(aggregateTotalTokens) ? <div className="tt-leaderboard-summary-card tt-surface-nested tt-pressable flex items-center gap-3 rounded-[var(--tt-card-radius)] px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-100 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/20" data-testid="leaderboard-summary-icon">
                    <Coins className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <dt className="text-xs text-oai-gray-500 dark:text-oai-gray-400">{copy("leaderboard.summary.tokens_label")}</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">
                      {formatChineseTokenCount(aggregateTotalTokens)}
                    </dd>
                    <p className="tt-leaderboard-summary-detail tt-leaderboard-summary-detail-violet">
                      {tokenSummaryDetail || "\u00A0"}
                    </p>
                  </div>
                </div> : null}
                {isProvidedNumber(aggregateTotalCost) ? <div className="tt-leaderboard-summary-card tt-surface-nested tt-pressable flex items-center gap-3 rounded-[var(--tt-card-radius)] px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-100 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20" data-testid="leaderboard-summary-icon">
                    <CircleDollarSign className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <dt className="text-xs text-oai-gray-500 dark:text-oai-gray-400">{copy("leaderboard.summary.cost_label")}</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">
                      {formatCost(aggregateTotalCost, currency, rate)}
                    </dd>
                    <p className="tt-leaderboard-summary-detail tt-leaderboard-summary-detail-amber">
                      {costSummaryDetail || "\u00A0"}
                    </p>
                  </div>
                </div> : null}
              </dl>
            )}
          </div>

          {cloudSignedIn && participationSync === "syncing" && (
            <div className="mb-4 rounded-lg border border-oai-gray-200 bg-oai-gray-50 px-4 py-2 text-sm text-oai-gray-600 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-300">
              {copy("leaderboard.sync.syncing")}
            </div>
          )}
          {cloudSignedIn && participationSync === "deferred" && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              {copy("leaderboard.sync.failed")}
            </div>
          )}

          {/* V4 item-8: the sync banner is a permanent fixture — some periods
              return no sync_message/generated_at, and letting the banner
              disappear used to shift the filter toolbar by its full height. */}
          <div className="tt-leaderboard-sync-banner mb-4 rounded-[var(--tt-card-radius)] border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-oai-gray-600">
            <Info aria-hidden="true" />
            {listData?.sync_message || copy("leaderboard.sync.ready")}
          </div>

          <div
            data-testid="leaderboard-filter-toolbar"
            className="tt-surface-nested tt-pressable-group mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--tt-card-radius)] sm:mb-8"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div
                data-testid="leaderboard-period-control"
                role="tablist"
                aria-label={copy("leaderboard.period.label")}
                className="tt-overview-data-tabs inline-flex items-center"
              >
                {PERIOD_OPTIONS.map((option) => {
                  const isActive = period === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => handleDimensionChange("period", option.value)}
                      className={cn(
                        "tt-overview-data-tab tt-pressable tt-product-focusable inline-flex min-h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--tt-control-radius)] px-3 py-1.5 text-xs font-medium transition-colors",
                        isActive
                          ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                          : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50",
                      )}
                    >
                      {copy(option.copyKey)}
                    </button>
                  );
                })}
              </div>
              <div
                data-testid="leaderboard-metric-control"
                role="tablist"
                aria-label={copy("leaderboard.metric.label")}
                className="tt-overview-data-tabs inline-flex items-center"
              >
                {METRIC_OPTIONS.map((option) => {
                  const isActive = metric === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => handleDimensionChange("metric", option.value)}
                      className={cn(
                        "tt-overview-data-tab tt-pressable tt-product-focusable inline-flex min-h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--tt-control-radius)] px-3 py-1.5 text-xs font-medium transition-colors",
                        isActive
                          ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                          : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50",
                      )}
                    >
                      {copy(option.copyKey)}
                    </button>
                  );
                })}
              </div>
              <Select
                value={effectiveSource}
                onValueChange={(value) => handleDimensionChange("source", value)}
                disabled={currentListState.loading || metric === "actual_cost"}
                ariaLabel={copy("leaderboard.source.label")}
                options={SOURCE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: copy(option.copyKey),
                }))}
              />
            </div>

            <LeaderboardMeChip
              me={statusMe || {
                rank: 1,
                display_name: meLabel,
                user_id: "leaderboard-current-user",
              }}
              totalEntries={Math.max(1, Number(totalEntries) || 0)}
              meLabel={meLabel}
              onOpenProfile={statusMe?.user_id ? () => openProfileModal(statusMe.user_id) : undefined}
              onJumpToMe={handleJumpToMe}
              canJump={myPage != null && !onMyPage && !currentListState.loading}
              className="shrink-0"
            />
          </div>

          {developerPreviewActive && (
            <div className="mb-6 flex flex-col gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm dark:border-amber-700/70 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-amber-800 dark:text-amber-200">
                {copy("leaderboard.developer_preview.active")}
              </p>
              <button
                onClick={handleDeveloperSignOut}
                className="shrink-0 whitespace-nowrap self-start rounded-md border border-amber-400 px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:border-amber-500 hover:text-amber-950 dark:border-amber-700 dark:text-amber-200 dark:hover:border-amber-600 dark:hover:text-amber-100 sm:self-auto"
              >
                {copy("leaderboard.developer_preview.signout")}
              </button>
            </div>
          )}

          {developerLoginEnabled && !developerPreviewActive && !cloudSignedIn && !authLoading && (
            <div className="mb-6 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-oai-gray-500 dark:text-oai-gray-400">
                {copy("leaderboard.developer_preview.prompt")}
              </p>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  disabled
                  className="whitespace-nowrap rounded-md border border-oai-gray-300 px-3 py-1.5 text-sm font-medium text-oai-gray-500 opacity-50 dark:border-oai-gray-700 dark:text-oai-gray-400"
                >
                  {copy("leaderboard.developer_preview.wechat_placeholder")}
                </button>
                <button
                  onClick={handleDeveloperSignIn}
                  className="whitespace-nowrap rounded-md bg-oai-black px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-oai-gray-800 dark:bg-white dark:text-oai-black dark:hover:bg-oai-gray-200"
                >
                  {copy("leaderboard.developer_preview.signin")}
                </button>
              </div>
            </div>
          )}

          {!developerLoginEnabled && !cloudSignedIn && !authLoading && !leaderboardMockEnabled && (
            <div className="tt-leaderboard-signin-prompt mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm">
              <div>
                <p className="text-oai-gray-500 dark:text-oai-gray-400">
                  {copy("leaderboard.signin_prompt")}
                </p>
              </div>
              <button
                onClick={handleEmailSignIn}
                disabled={!cloudAuthEnabled}
                className="shrink-0 whitespace-nowrap self-start sm:self-auto px-3 py-1.5 text-sm font-medium text-oai-gray-600 dark:text-oai-gray-300 border border-oai-gray-300 dark:border-oai-gray-700 rounded-md hover:text-oai-black dark:hover:text-white hover:border-oai-gray-400 dark:hover:border-oai-gray-600 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                {!cloudAuthEnabled
                  ? copy("leaderboard.signin_unavailable")
                  : copy("leaderboard.signin_button")}
              </button>
            </div>
          )}

          <div
            data-testid="leaderboard-list-surface"
            className="tt-surface tt-pressable-group overflow-hidden rounded-[var(--tt-card-radius)]"
          >
            {currentListState.error && hasEntries ? (
              <div className="border-b border-oai-gray-200 dark:border-oai-gray-800 px-6 py-3">
                <p className="text-sm text-red-500 dark:text-red-400">{currentListState.error}</p>
              </div>
            ) : null}
            <div className="tt-leaderboard-table-head tt-leaderboard-table-head--expanded" data-testid="leaderboard-table-head">
              <span>{copy("leaderboard.table.rank")}</span>
              <span>{copy("leaderboard.table.user_share")}</span>
              <span>{copy("leaderboard.table.token_cost")}</span>
            </div>
            {listBody}

            <div
              className="tt-overview-pagination tt-leaderboard-pagination"
              data-testid="leaderboard-pagination"
            >
              <div>
                <label className="tt-overview-page-size">
                  {copy("dashboard.daily.page_size_label")}
                  <select
                    id="leaderboard-page-size"
                    aria-label={copy("dashboard.daily.page_size_aria")}
                    value={pageSize}
                    disabled={currentListState.loading}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {copy("dashboard.daily.page_size_value", { count: size })}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!canPrev || currentListState.loading}
                  onClick={() => setListPage((p) => Math.max(1, p - 1))}
                >
                  {copy("details.pagination.prev")}
                </button>
                {pageButtons}
                <button
                  type="button"
                  disabled={!canNext || currentListState.loading}
                  onClick={() => setListPage((p) => p + 1)}
                >
                  {copy("details.pagination.next")}
                </button>
                <input
                  aria-label={copy("dashboard.projects.page_number")}
                  value={pageInput}
                  inputMode="numeric"
                  onChange={(event) => setPageInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") jumpToListPage();
                  }}
                />
                <button type="button" onClick={jumpToListPage}>
                  {copy("dashboard.projects.page_jump")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-oai-gray-200 dark:border-oai-gray-900 py-8 transition-colors duration-200">
        <div className="tt-leaderboard-footer mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 text-sm text-oai-gray-400 dark:text-oai-gray-500">
          <div className="tt-leaderboard-footer-brand flex items-center gap-4">
            <img src="/app-icon.png" alt="" className="h-9 w-9 rounded-lg" />
            <div>
              <p>{copy("landing.v2.footer.line")}</p>
              <div className="mt-2 flex items-center gap-4 text-xs">
                <span>{copy("shared.footer.version", { version: import.meta.env.VITE_APP_VERSION || "0.54.42" })}</span>
                <span className="h-3 w-px bg-oai-gray-200" aria-hidden="true" />
                <a href="#privacy-data">{copy("shared.footer.privacy")}</a>
                <span className="h-3 w-px bg-oai-gray-200" aria-hidden="true" />
                <a href="#terms">{copy("shared.footer.terms")}</a>
                <span className="h-3 w-px bg-oai-gray-200" aria-hidden="true" />
                <span>{copy("landing.v2.nav.github")} · {copy("shared.footer.github_private")}</span>
              </div>
            </div>
          </div>
          <p className="tt-leaderboard-footer-privacy flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-500" aria-hidden="true" />{copy("shared.footer.local_data")}</p>
        </div>
      </footer>

      <Suspense fallback={null}>
        <LeaderboardProfileModal
          isOpen={Boolean(modalUserId)}
          userId={modalUserId}
          period={period}
          accessToken={effectiveAuthToken}
          onClose={closeProfileModal}
        />
      </Suspense>
    </div>
  );
}
