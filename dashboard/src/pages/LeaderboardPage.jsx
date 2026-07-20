import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { Select } from "../ui/components";
import { motion } from "motion/react";
import { useInsforgeAuth } from "../contexts/InsforgeAuthContext.jsx";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";
import { isAccessTokenReady, resolveAuthAccessTokenWithRetry } from "../lib/auth-token";
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
  normalizeLeaderboardMetric,
  normalizeLeaderboardPeriod,
} from "../lib/leaderboard-query.js";
import { normalizeAgentMetrics } from "../lib/leaderboard-agent-metrics.js";
import { getLeaderboardBaseUrl } from "../lib/config";
import { getDashboardEntryPath } from "../lib/host-mode";
import { isMockEnabled } from "../lib/mock-data";
import { isDeveloperLeaderboardLoginEnabled } from "../lib/developer-leaderboard-preview.js";
import {
  getLeaderboard,
  refreshLeaderboard,
} from "../lib/api";
import {
  getLeaderboardPreloadContextKey,
  publishLeaderboardPreloadState,
  readLeaderboardPreloadState,
} from "../lib/dashboard-preload.js";
import { getCloudSyncEnabled, setCloudSyncEnabled } from "../lib/cloud-sync-prefs";
import { runCloudUsageSyncNow } from "../lib/cloud-sync";
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
  { value: "yesterday", copyKey: "leaderboard.period.yesterday" },
  { value: "7d", copyKey: "leaderboard.period.7d" },
  { value: "30d", copyKey: "leaderboard.period.30d" },
  { value: "total", copyKey: "leaderboard.period.total" },
];
const METRIC_OPTIONS = [
  { value: "with_cache", copyKey: "leaderboard.metric.with_cache" },
  { value: "without_cache", copyKey: "leaderboard.metric.without_cache" },
  { value: "estimated_cost", copyKey: "leaderboard.metric.estimated_cost" },
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
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const symbol = getCurrencySymbol(currency);
  const converted = currency === CURRENCY_USD ? n : n * rate;
  if (converted >= 1000) return `${symbol}${Math.round(converted).toLocaleString()}`;
  if (converted >= 10) return `${symbol}${Math.round(converted)}`;
  return `${symbol}${converted.toFixed(2)}`;
}

function TotalTokens({ value }) {
  return <span>{formatChineseTokenCount(value)}</span>;
}

function RankingScore({ entry, metric, currency, rate }) {
  let value;
  if (metric === "estimated_cost") {
    value = formatCost(entry?.score ?? entry?.estimated_cost_usd, currency, rate);
  } else {
    const fallback = metric === "without_cache"
      ? entry?.without_cache_tokens ?? entry?.total_tokens
      : entry?.total_tokens;
    value = <TotalTokens value={entry?.score ?? fallback} />;
  }
  return <span data-testid="leaderboard-score">{value}</span>;
}

function AgentDistribution({ entry, metric, currency, rate }) {
  const items = normalizeAgentMetrics(entry, metric);
  const usesCost = metric === "estimated_cost" && Object.prototype.hasOwnProperty.call(entry || {}, "agent_metrics");
  if (items.length === 0) return <span className="text-oai-gray-400 dark:text-oai-gray-600">—</span>;
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-oai-gray-400 dark:text-oai-gray-500"
      data-testid="leaderboard-user-meta"
    >
      {items.map((item) => (
        <span key={item.id} className="inline-flex items-baseline gap-1 whitespace-nowrap">
          <span className="font-medium text-oai-gray-500 dark:text-oai-gray-400">{item.label}</span>
          <span className="tabular-nums">
            {usesCost ? formatCost(item.value, currency, rate) : formatChineseTokenCount(item.value)}
          </span>
        </span>
      ))}
    </div>
  );
}

const RANK_MEDAL = {
  1: { text: "text-amber-600 dark:text-amber-400", badge: "bg-amber-50 dark:bg-amber-900/20" },
  2: { text: "text-gray-500 dark:text-gray-300", badge: "bg-gray-50 dark:bg-gray-800/40" },
  3: { text: "text-orange-700 dark:text-orange-400", badge: "bg-orange-50 dark:bg-orange-900/20" },
};

function RankCell({ rank, placeholder }) {
  const medal = RANK_MEDAL[rank];
  if (medal) {
    return (
      <span className={cn("inline-flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold", medal.text, medal.badge)}>
        {rank}
      </span>
    );
  }
  return <span className="inline-flex items-center justify-center h-7 w-7 text-sm">{rank ?? placeholder}</span>;
}

function normalizeLeaderboardError(err) {
  if (!err) return copy("shared.error.prefix", { error: copy("leaderboard.error.unknown") });
  const msg = err?.message || String(err);
  const safe = String(msg || "").trim() || copy("leaderboard.error.unknown");
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
  placeholder,
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
  const isPinned = Boolean(entry?.is_pinned);
  const profileUserId = typeof entry?.user_id === "string" ? entry.user_id : null;
  const rawName = normalizeName(entry?.display_name);
  const entryName = isAnonymousName(rawName) ? anonLabel : rawName;
  const name = isMe ? meLabel : entryName;
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
  const secondaryValue = metric === "estimated_cost"
    ? formatChineseTokenCount(entry?.total_tokens)
    : formatCost(entry?.estimated_cost_usd, currency, rate);

  return (
    <li
      role={rowClickable ? "button" : undefined}
      tabIndex={rowClickable ? 0 : undefined}
      onClick={openRow}
      onKeyDown={onRowKeyDown}
      aria-label={rowClickable ? copy("leaderboard.profile_modal.row_aria", { name }) : undefined}
      className={cn(
        "relative grid min-h-[78px] grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors sm:grid-cols-[2.25rem_minmax(0,1fr)_9rem] sm:gap-4 sm:px-5",
        isMe ? "bg-oai-brand-50/70 dark:bg-oai-brand-900/10" : "bg-white dark:bg-oai-gray-950",
        isPinned && "before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r before:bg-oai-brand-500",
        rowClickable && "cursor-pointer hover:bg-oai-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oai-brand-500/60 dark:hover:bg-oai-gray-900/60",
      )}
      data-entry-index={entryIdx}
    >
      <div className={cn("text-oai-gray-500 dark:text-oai-gray-400", isMe && "text-oai-brand-600 dark:text-oai-brand-400")}>
        <RankCell rank={entry?.rank} placeholder={placeholder} />
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <LeaderboardAvatar
          avatarUrl={entry?.avatar_url}
          displayName={name}
          seed={leaderboardAvatarSeed(entry, name)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn(
              "truncate text-sm font-semibold sm:text-base",
              isMe ? "text-oai-brand-700 dark:text-oai-brand-300" : "text-oai-gray-900 dark:text-oai-gray-100",
            )}>
              {name}
            </span>
            {entry?.github_url && <GithubLinkWithTooltip githubUrl={entry.github_url} />}
          </div>
          <div className="mt-1 min-w-0">
            <AgentDistribution entry={entry} metric={metric} currency={currency} rate={rate} />
          </div>
        </div>
      </div>

      <div className="min-w-[5.5rem] text-right tabular-nums sm:min-w-0">
        <div className="text-sm font-semibold text-oai-gray-900 dark:text-oai-gray-100 sm:text-base">
          <RankingScore entry={entry} metric={metric} currency={currency} rate={rate} />
        </div>
        <div className="mt-1 text-[11px] text-oai-gray-400 dark:text-oai-gray-500">
          {secondaryValue}
        </div>
      </div>
    </li>
  );
}

export function LeaderboardPage({
  auth,
  signedIn,
  sessionSoftExpired,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    enabled: cloudAuthEnabled,
    signedIn: cloudSignedIn,
    loading: authLoading,
    user: cloudUser,
    signInWithOAuth,
    getPublicAuthConfig,
  } = useInsforgeAuth();
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
  const authTokenReady = authTokenAllowed && isAccessTokenReady(effectiveAuthToken);

  const placeholder = copy("shared.placeholder.short");

  const [listPage, setListPage] = useState(1);
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
  const [listReloadToken, setListReloadToken] = useState(0);

  const [cloudSyncOn, setCloudSyncOn] = useState(() => getCloudSyncEnabled());
  const [syncing, setSyncing] = useState(false);
  const [wechatLoginBusy, setWechatLoginBusy] = useState(false);
  const [wechatLoginError, setWechatLoginError] = useState(false);
  const [wechatProviderAvailable, setWechatProviderAvailable] = useState(null);

  const period = useMemo(() => {
    const params = new URLSearchParams(location?.search || "");
    return normalizeLeaderboardPeriod(params.get("period") || LEADERBOARD_DEFAULT_PERIOD);
  }, [location?.search]);
  const agent = LEADERBOARD_DEFAULT_AGENT;
  const metric = useMemo(() => {
    const params = new URLSearchParams(location?.search || "");
    return normalizeLeaderboardMetric(params.get("metric") || LEADERBOARD_DEFAULT_METRIC);
  }, [location?.search]);

  useEffect(() => {
    if (leaderboardMockEnabled || cloudSignedIn || developerLoginEnabled) return undefined;
    if (!cloudAuthEnabled || typeof getPublicAuthConfig !== "function") {
      setWechatProviderAvailable(false);
      return undefined;
    }
    let active = true;
    setWechatProviderAvailable(null);
    (async () => {
      try {
        const { data, error } = await getPublicAuthConfig();
        if (!active) return;
        if (error || !data) {
          setWechatProviderAvailable(false);
          return;
        }
        const builtIn = Array.isArray(data.oAuthProviders) ? data.oAuthProviders : [];
        const custom = Array.isArray(data.customOAuthProviders) ? data.customOAuthProviders : [];
        setWechatProviderAvailable([...builtIn, ...custom].includes("wechat"));
      } catch {
        if (!active) return;
        setWechatProviderAvailable(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [cloudAuthEnabled, cloudSignedIn, developerLoginEnabled, getPublicAuthConfig, leaderboardMockEnabled]);

  const handleDimensionChange = (key, value) => {
    const current = key === "period" ? period : metric;
    if (value === current) return;
    const params = new URLSearchParams(location?.search || "");
    params.set(key, value);
    setListPage(1);
    navigate(`${location?.pathname || "/leaderboard"}?${params.toString()}`, { replace: true });
  };

  const handleWechatSignIn = useCallback(async () => {
    if (!cloudAuthEnabled || wechatProviderAvailable !== true || wechatLoginBusy) return;
    setWechatLoginBusy(true);
    setWechatLoginError(false);
    try {
      const isNativeOAuth = Boolean(window.webkit?.messageHandlers?.nativeOAuth);
      const redirectTo = `${window.location.origin}${isNativeOAuth ? "/auth/callback" : "/leaderboard"}`;
      const result = await signInWithOAuth("wechat", redirectTo);
      if (result?.error) throw result.error;
    } catch {
      setWechatLoginError(true);
    } finally {
      setWechatLoginBusy(false);
    }
  }, [cloudAuthEnabled, signInWithOAuth, wechatLoginBusy, wechatProviderAvailable]);

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

  useEffect(() => {
    setListPage(1);
  }, [agent, metric, period]);

  const listOffset = useMemo(() => {
    const safePage = clampInt(listPage, { min: 1, max: 1_000_000, fallback: 1 });
    return (safePage - 1) * pageSize;
  }, [listPage, pageSize]);
  const leaderboardAccessMode = useMemo(() => {
    if (leaderboardMockEnabled) return "mock";
    if (authLoading) return "unavailable";
    if (cloudSignedIn) return "cloud";
    if (signedIn) return "local";
    if (leaderboardBaseUrl) return "public";
    return "unavailable";
  }, [authLoading, cloudSignedIn, leaderboardBaseUrl, leaderboardMockEnabled, signedIn]);

  const leaderboardPreloadContextKey = useMemo(
    () =>
      getLeaderboardPreloadContextKey({
        accessMode: leaderboardAccessMode,
        agent,
        baseUrl: leaderboardBaseUrl,
        metric,
        mockEnabled: leaderboardMockEnabled,
        userId: cloudUser?.id || null,
        period,
        pageSize,
        offset: listOffset,
      }),
    [agent, cloudUser?.id, leaderboardAccessMode, leaderboardBaseUrl, leaderboardMockEnabled, listOffset, metric, pageSize, period],
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
      setListState({
        loading: true,
        error: null,
        data: null,
        contextKey: null,
      });
    }
    (async () => {
      const data = await getLeaderboard({
        baseUrl: leaderboardBaseUrl,
        agent,
        userId: cloudUser?.id || null,
        metric,
        period,
        limit: pageSize,
        offset: listOffset,
        ...(developerPreviewActive ? { mock: true } : {}),
      });
      if (!active) return;
      publishLeaderboardPreloadState(data, {
        activeContextKey: leaderboardPreloadContextKey,
        contextKey: leaderboardPreloadContextKey,
        source: listReloadToken > 0 ? "manual-refresh" : "page-load",
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
      setListState((prev) => {
        if (prev.contextKey === leaderboardPreloadContextKey) {
          return { ...prev, loading: false, error };
        }
        return { loading: false, error, data: null, contextKey: leaderboardPreloadContextKey };
      });
    });
    return () => {
      active = false;
    };
  }, [
    leaderboardBaseUrl,
    leaderboardAccessMode,
    agent,
    cloudUser?.id,
    developerPreviewActive,
    leaderboardPreloadContextKey,
    listOffset,
    listReloadToken,
    leaderboardMockEnabled,
    metric,
    period,
    pageSize,
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

  const totalPages = listData?.total_pages ?? null;
  const totalEntries = listData?.ranked_entry_count ?? listData?.total_entries ?? 0;
  const participantCount = listData?.participant_count ?? totalEntries;
  const aggregateTotalTokens = listData?.aggregate_total_tokens
    ?? (metric === "with_cache" ? listData?.total_score : null);
  const aggregateTotalCost = listData?.aggregate_total_cost_usd ?? null;
  const currentPage = listData?.page ?? listPage;
  const pageItems = useMemo(() => {
    return buildPageItems(currentPage, totalPages);
  }, [currentPage, totalPages]);

  const from = listData?.from || null;
  const to = listData?.to || null;
  const generatedAt = listData?.generated_at || null;
  const me = listData?.me || null;
  const meLabel = copy("leaderboard.me_label");
  const anonLabel = copy("leaderboard.anon_label");
  const periodLabel = copy(
    PERIOD_OPTIONS.find((option) => option.value === period)?.copyKey || "leaderboard.period.total",
  );
  const displayEntries = useMemo(() => {
    const rows = Array.isArray(listData?.entries) ? listData.entries : [];
    return prependMeRowToPage({ entries: rows, me, meLabel });
  }, [listData?.entries, me, meLabel]);

  const myPage = useMemo(
    () => pageContainingRank(me?.rank, pageSize),
    [me?.rank, pageSize],
  );
  const onMyPage = myPage != null && myPage === currentPage;
  const handleJumpToMe = useCallback(() => {
    if (myPage != null) setListPage(myPage);
  }, [myPage]);

  const handleEnableSync = async () => {
    setSyncing(true);
    try {
      setCloudSyncEnabled(true);
      setCloudSyncOn(true);
      await runCloudUsageSyncNow(() => resolveAuthAccessTokenWithRetry(effectiveAuthToken));
      const token = await resolveAuthAccessTokenWithRetry(effectiveAuthToken);
      if (token) await refreshLeaderboard({ accessToken: token, period, source: "leaderboard-enable-sync" });
      setListReloadToken((v) => v + 1);
    } catch (e) {
      console.warn("[tokentracker] sync:", e);
    } finally {
      setSyncing(false);
    }
  };

  const { canPrev, canNext } = getPaginationFlags({ page: currentPage, totalPages });

  const hasEntries = Array.isArray(displayEntries) && displayEntries.length !== 0;
  let listBody = null;
  if (currentListState.loading && !hasEntries) {
    listBody = <LeaderboardSkeleton rows={pageSize} />;
  } else if (currentListState.error && !hasEntries) {
    listBody = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-red-500 dark:text-red-400">{currentListState.error}</p>
      </div>
    );
  } else if (hasEntries) {
    listBody = (
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
            placeholder={placeholder}
            openProfileModal={openProfileModal}
          />
        ))}
      </ol>
    );
  } else {
    listBody = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("leaderboard.empty")}</p>
      </div>
    );
  }

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
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium transition-colors",
            p === currentPage
              ? "bg-oai-gray-200 dark:bg-oai-gray-800 text-oai-black dark:text-white"
              : "text-oai-gray-500 dark:text-oai-gray-400 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 hover:text-oai-black dark:hover:text-white"
          )}
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
    <div className="flex flex-col flex-1 text-oai-black dark:text-oai-white font-oai antialiased">
      <main className="flex-1 pt-8 sm:pt-10 pb-12 sm:pb-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* Title gets its own row. */}
          <div className="mb-5 sm:mb-6">
            <div className="mb-2 flex items-center justify-between gap-4 sm:mb-3">
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-oai-black dark:text-white">
                {copy("leaderboard.title")}
              </h1>
              <div className="flex shrink-0 items-center gap-3">
                <Link
                  to="/leaderboard/rules"
                  className="text-sm font-medium text-oai-gray-500 transition-colors hover:text-oai-black dark:text-oai-gray-400 dark:hover:text-white"
                >
                  {copy("leaderboard.rules_link")}
                </Link>
              </div>
            </div>
            <p className="text-oai-gray-500 dark:text-oai-gray-400 text-sm sm:text-base">
              {period === "total"
                ? copy("leaderboard.range.total")
                : from && to
                  ? copy("leaderboard.range", { period: periodLabel, from, to })
                  : copy("leaderboard.range_loading", { period: periodLabel })}
              {generatedAt && (
                <span className="ml-2 pl-2 border-l border-oai-gray-200 dark:border-oai-gray-800 hidden sm:inline-block text-oai-gray-400 dark:text-oai-gray-500 text-xs">
                  {copy("leaderboard.generated_at", { ts: generatedAt })}
                </span>
              )}
            </p>
            {listData && (
              <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="leaderboard-summary">
                <div className="rounded-xl border border-oai-gray-200 px-4 py-3 dark:border-oai-gray-800">
                  <dt className="text-xs text-oai-gray-500 dark:text-oai-gray-400">{copy("leaderboard.summary.participant_label")}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">{Number(participantCount || 0).toLocaleString()}</dd>
                </div>
                <div className="rounded-xl border border-oai-gray-200 px-4 py-3 dark:border-oai-gray-800">
                  <dt className="text-xs text-oai-gray-500 dark:text-oai-gray-400">{copy("leaderboard.summary.tokens_label")}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {aggregateTotalTokens == null ? "—" : formatChineseTokenCount(aggregateTotalTokens)}
                  </dd>
                </div>
                <div className="rounded-xl border border-oai-gray-200 px-4 py-3 dark:border-oai-gray-800">
                  <dt className="text-xs text-oai-gray-500 dark:text-oai-gray-400">{copy("leaderboard.summary.cost_label")}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {aggregateTotalCost == null ? "—" : formatCost(aggregateTotalCost, currency, rate)}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          <div className="mb-6 sm:mb-8 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-9 p-1 border border-oai-gray-200 dark:border-oai-gray-800 rounded-full items-center relative">
                {PERIOD_OPTIONS.map((option) => {
                  const isActive = period === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleDimensionChange("period", option.value)}
                      disabled={currentListState.loading}
                      aria-pressed={isActive}
                      className={cn(
                        "px-3 h-7 text-sm font-medium rounded-full flex items-center justify-center transition-colors relative",
                        isActive
                          ? "text-oai-brand-700 dark:text-oai-brand-200"
                          : "text-oai-gray-500 dark:text-oai-gray-400 hover:text-oai-gray-800 dark:hover:text-oai-gray-200",
                      )}
                    >
                      <span className="relative z-10">{copy(option.copyKey)}</span>
                      {isActive && (
                        <motion.div
                          layoutId="leaderboard-period-active-bg"
                          className="absolute inset-0 rounded-full bg-oai-brand-50 ring-1 ring-inset ring-oai-brand-200 dark:bg-oai-brand-500/15 dark:ring-oai-brand-500/30 z-0"
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="inline-flex h-9 p-1 border border-oai-gray-200 dark:border-oai-gray-800 rounded-full items-center relative">
                {METRIC_OPTIONS.map((option) => {
                  const isActive = metric === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleDimensionChange("metric", option.value)}
                      disabled={currentListState.loading}
                      aria-pressed={isActive}
                      className={cn(
                        "px-3 h-7 text-sm font-medium rounded-full flex items-center justify-center transition-colors relative",
                        isActive
                          ? "text-oai-brand-700 dark:text-oai-brand-200"
                          : "text-oai-gray-500 dark:text-oai-gray-400 hover:text-oai-gray-800 dark:hover:text-oai-gray-200",
                      )}
                    >
                      <span className="relative z-10">{copy(option.copyKey)}</span>
                      {isActive && (
                        <motion.div
                          layoutId="leaderboard-metric-active-bg"
                          className="absolute inset-0 rounded-full bg-oai-brand-50 ring-1 ring-inset ring-oai-brand-200 dark:bg-oai-brand-500/15 dark:ring-oai-brand-500/30 z-0"
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <LeaderboardMeChip
              me={me}
              totalEntries={totalEntries}
              meLabel={meLabel}
              onOpenProfile={me?.user_id ? () => openProfileModal(me.user_id) : undefined}
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
            <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm">
              <div>
                <p className="text-oai-gray-500 dark:text-oai-gray-400">
                  {copy("leaderboard.signin_prompt")}
                </p>
                {wechatLoginError && (
                  <p className="mt-1 text-red-500 dark:text-red-400" role="alert">
                    {copy("leaderboard.signin_error")}
                  </p>
                )}
              </div>
              <button
                onClick={handleWechatSignIn}
                disabled={!cloudAuthEnabled || wechatProviderAvailable !== true || wechatLoginBusy}
                className="shrink-0 whitespace-nowrap self-start sm:self-auto px-3 py-1.5 text-sm font-medium text-oai-gray-600 dark:text-oai-gray-300 border border-oai-gray-300 dark:border-oai-gray-700 rounded-md hover:text-oai-black dark:hover:text-white hover:border-oai-gray-400 dark:hover:border-oai-gray-600 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                {!cloudAuthEnabled || wechatProviderAvailable === false
                  ? copy("leaderboard.signin_unavailable")
                  : wechatProviderAvailable == null
                    ? copy("leaderboard.signin_checking")
                  : wechatLoginBusy
                    ? copy("leaderboard.signin_busy")
                    : copy("leaderboard.signin_button")}
              </button>
            </div>
          )}

          {authTokenAllowed && authTokenReady && !cloudSyncOn && (
            <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm">
              <p className="text-oai-gray-500 dark:text-oai-gray-400">{copy("leaderboard.sync_prompt")}</p>
              <button
                onClick={handleEnableSync}
                disabled={syncing}
                className="shrink-0 whitespace-nowrap self-start sm:self-auto px-3 py-1.5 text-sm font-medium text-oai-gray-600 dark:text-oai-gray-300 border border-oai-gray-300 dark:border-oai-gray-700 rounded-md hover:text-oai-black dark:hover:text-white hover:border-oai-gray-400 dark:hover:border-oai-gray-600 disabled:opacity-50 transition-colors"
              >
                {syncing ? copy("leaderboard.sync_button.busy") : copy("leaderboard.sync_button.idle")}
              </button>
            </div>
          )}

          <div className="rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 overflow-hidden">
            {currentListState.error && hasEntries ? (
              <div className="border-b border-oai-gray-200 dark:border-oai-gray-800 px-6 py-3">
                <p className="text-sm text-red-500 dark:text-red-400">{currentListState.error}</p>
              </div>
            ) : null}
            {listBody}

            <div className="px-6 py-3 border-t border-oai-gray-200 dark:border-oai-gray-800 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
              <div className="flex items-center gap-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                <label htmlFor="leaderboard-page-size" className="whitespace-nowrap">
                  {copy("leaderboard.pagination.page_size_label")}
                </label>
                <Select
                  id="leaderboard-page-size"
                  value={pageSize}
                  onValueChange={(value) => setPageSize(Number(value))}
                  disabled={currentListState.loading}
                  ariaLabel={copy("leaderboard.pagination.page_size_label")}
                  options={PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
                  align="end"
                  className="px-3 py-1 text-oai-gray-700 dark:text-oai-gray-300"
                />
              </div>
              <div className="h-5 w-px bg-oai-gray-200 dark:bg-oai-gray-800" aria-hidden="true" />
              <button
                className={cn(
                  "px-3 py-1.5 text-sm font-medium text-oai-gray-500 dark:text-oai-gray-400 rounded-md transition-colors",
                  canPrev && !currentListState.loading
                    ? "hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 hover:text-oai-black dark:hover:text-white"
                    : "opacity-50 cursor-not-allowed"
                )}
                onClick={() => setListPage((p) => Math.max(1, p - 1))}
                disabled={!canPrev || currentListState.loading}
              >
                {copy("leaderboard.pagination.prev")}
              </button>
              <div className="flex flex-wrap items-center gap-1">{pageButtons}</div>
              <button
                className={cn(
                  "px-3 py-1.5 text-sm font-medium text-oai-gray-500 dark:text-oai-gray-400 rounded-md transition-colors",
                  canNext && !currentListState.loading
                    ? "hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 hover:text-oai-black dark:hover:text-white"
                    : "opacity-50 cursor-not-allowed"
                )}
                onClick={() => setListPage((p) => p + 1)}
                disabled={!canNext || currentListState.loading}
              >
                {copy("leaderboard.pagination.next")}
              </button>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-oai-gray-200 dark:border-oai-gray-900 py-8 transition-colors duration-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 text-sm text-oai-gray-400 dark:text-oai-gray-500">
          <p>{copy("landing.v2.footer.line")}</p>
          <a
            href="https://github.com/mm7894215/TokenTracker"
            className="text-oai-gray-400 dark:text-oai-gray-500 hover:text-oai-black dark:hover:text-white transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy("landing.v2.nav.github")}
          </a>
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
