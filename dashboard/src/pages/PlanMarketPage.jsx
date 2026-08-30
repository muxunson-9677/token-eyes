import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, CalendarDays, ChevronDown, ChevronUp, ExternalLink, Globe2, ListFilter, Megaphone, RefreshCw, ShieldAlert, ShieldCheck, Store, Tags, Wifi } from "lucide-react";
import { copy } from "../lib/copy";
import { getPlanMarketState, refreshPlanMarketCatalog } from "../lib/api";
import bundledPlanMarketCatalog from "../../../shared/plan-market-catalog.json";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";
import {
  OfficialExternalLink,
  resolveProviderLink,
} from "../components/OfficialExternalLink.jsx";

// V2-W1 plan market: curated subscription-plan snapshot for AI providers.
// Data lives in shared/plan-market-catalog.json (single source of truth,
// also served by the local API at /functions/tokentracker-plan-market) and
// every provider entry carries official source links + a last_verified date.

const CURRENCY_SYMBOL = { CNY: "¥", USD: "$" };
const DEFAULT_STALE_AFTER_SECONDS = 30 * 24 * 60 * 60;
const FRESHNESS_BADGES = new Set(["latest", "new", "hot"]);
const REFRESH_CADENCE_STORAGE_KEY = "tt.planMarketRefreshCadence.v1";
const REFRESH_CADENCE_MS = Object.freeze({
  manual: 0,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
});
const EMPTY_MARKET_CHANGES = Object.freeze({
  plans_added: 0,
  plans_changed: 0,
  plans_removed: 0,
  price_changed: 0,
  listed: 0,
  delisted: 0,
});

function storedRefreshCadence() {
  try {
    const value = window.localStorage.getItem(REFRESH_CADENCE_STORAGE_KEY);
    return Object.hasOwn(REFRESH_CADENCE_MS, value) ? value : "manual";
  } catch {
    return "manual";
  }
}

function displayTimestamp(value) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value || "");
}

export function hasOfficialProviderSource(provider) {
  return provider?.evidence?.verified === true
    && String(provider?.evidence?.source_type || "").startsWith("official_");
}

function marketNowMilliseconds(now) {
  if (now === undefined) return Date.now();
  if (now === null) throw new TypeError("now must be a valid date");
  const value = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(value)) throw new TypeError("now must be a valid date");
  return value;
}

function marketDateMilliseconds(value, { endOfDay = false } = {}) {
  if (!value) return NaN;
  const raw = String(value);
  const suffix = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? (endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z")
    : "";
  return Date.parse(raw + suffix);
}

function marketEvidenceIsStale(evidence, nowMs) {
  if (!evidence?.verified) return true;
  const validFromMs = marketDateMilliseconds(evidence.valid_from);
  if (Number.isFinite(validFromMs) && Math.sign(nowMs - validFromMs) === -1) return true;
  const validUntilMs = marketDateMilliseconds(evidence.valid_until, { endOfDay: true });
  if (Number.isFinite(validUntilMs) && Math.sign(nowMs - validUntilMs) === 1) return true;
  const fetchedAtMs = marketDateMilliseconds(evidence.fetched_at);
  const ttlSeconds = Number(evidence.stale_after_seconds);
  if (!Number.isFinite(fetchedAtMs) || !Number.isFinite(ttlSeconds) || Math.sign(ttlSeconds) !== 1) return true;
  return Math.sign(nowMs - fetchedAtMs - (ttlSeconds * 1000)) === 1;
}

function requireMarketLink(linkId) {
  const link = resolveProviderLink(linkId);
  if (!link) throw new Error("Unknown plan market link_id");
  return link;
}

function projectMarketEvidence(evidence, nowMs) {
  const link = requireMarketLink(evidence?.link_id);
  return {
    ...structuredClone(evidence),
    source_type: link.source_type,
    source_url: link.url,
    is_stale: marketEvidenceIsStale(evidence, nowMs),
  };
}

function projectMarketSource(source) {
  const link = requireMarketLink(source?.link_id);
  return {
    ...structuredClone(source),
    url: link.url,
    source_type: link.source_type,
  };
}

function projectMarketEntitlementWindow(window, nowMs) {
  const link = requireMarketLink(window?.link_id);
  const evidence = {
    ...structuredClone(window),
    supports: structuredClone(window?.supports || ["quota", "effective_dates"]),
    stale_after_seconds: Number(window?.stale_after_seconds) || DEFAULT_STALE_AFTER_SECONDS,
  };
  return {
    ...evidence,
    source_type: link.source_type,
    source_url: link.url,
    is_stale: marketEvidenceIsStale(evidence, nowMs),
  };
}

function withoutMarketFreshnessBadges(values) {
  return (values || []).filter((value) => (
    !FRESHNESS_BADGES.has(String(value).toLowerCase())
  ));
}

function projectMarketProvider(rawProvider, nowMs) {
  const sourcesByLinkId = new Map((rawProvider.sources || []).map((source) => [source.link_id, source]));
  assertMarketEvidenceSupportedBySource(rawProvider, sourcesByLinkId);
  assertMarketEvidenceHash(rawProvider);
  assertMarketPromotionOffers(rawProvider);
  const provider = structuredClone(rawProvider);
  provider.evidence = projectMarketEvidence(provider.evidence, nowMs);
  provider.sources = (provider.sources || []).map(projectMarketSource);
  provider.promotions = (provider.promotions || [])
    .map((promotion) => {
      assertMarketEvidenceSupportedBySource(promotion, sourcesByLinkId);
      assertMarketEvidenceHash(promotion);
      return {
        ...promotion,
        evidence: projectMarketEvidence(promotion.evidence, nowMs),
      };
    })
    .filter((promotion) => !promotion.evidence.is_stale);

  const activePromotionIds = new Set(
    provider.promotions.map((promotion) => promotion.promotion_id),
  );
  provider.plans = (provider.plans || []).map((rawPlan) => {
    assertMarketEvidenceSupportedBySource(rawPlan, sourcesByLinkId);
    assertMarketEvidenceHash(rawPlan);
    const plan = structuredClone(rawPlan);
    plan.evidence = projectMarketEvidence(plan.evidence, nowMs);
    plan.entitlement_windows = (plan.entitlement_windows || []).map((window) => (
      projectMarketEntitlementWindow(window, nowMs)
    ));
    plan.alt_prices = (plan.alt_prices || []).filter((price) => (
      !price.promotion_id || activePromotionIds.has(price.promotion_id)
    ));
    if (plan.evidence.is_stale) {
      plan.badges = withoutMarketFreshnessBadges(plan.badges);
    }
    return plan;
  });

  provider.announcement = [
    provider.announcement,
    ...provider.promotions.map((promotion) => promotion.display),
  ].filter(Boolean).join("；");
  provider.is_recent = Boolean(provider.is_recent) && !provider.evidence.is_stale;
  if (provider.evidence.is_stale) {
    provider.tags = withoutMarketFreshnessBadges(provider.tags);
  }
  return provider;
}

function marketOfficialSourceCoverage(providers) {
  const sourceLinkIds = new Set();
  let providerCount = 0;
  let planCount = 0;
  for (const provider of providers) {
    if (hasOfficialProviderSource(provider)) {
      providerCount += 1;
      for (const source of provider.sources) {
        if (source.source_type.startsWith("official_")) sourceLinkIds.add(source.link_id);
      }
    }
    for (const plan of provider.plans) {
      if (plan.evidence.verified && plan.evidence.source_type.startsWith("official_")) {
        planCount += 1;
        sourceLinkIds.add(plan.evidence.link_id);
      }
    }
  }
  return {
    provider_count: providerCount,
    plan_count: planCount,
    source_link_ids: [...sourceLinkIds].sort(),
  };
}

export function projectPlanMarketCatalogForDashboard(data, { now } = {}) {
  const nowMs = marketNowMilliseconds(now);
  const providers = (data?.providers || []).map((provider) => (
    projectMarketProvider(provider, nowMs)
  ));
  return {
    updated_at: data?._meta?.updated_at || "",
    providers,
    comparison_links: (data?.comparison_links || []).map(projectMarketSource),
    official_source_coverage: marketOfficialSourceCoverage(providers),
  };
}

function formatAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function priceLabel(price) {
  if (price?.display) return price.display;
  const symbol = CURRENCY_SYMBOL[price?.currency] || "";
  return `${symbol}${formatAmount(price?.amount)}`;
}

function cycleLabel(cycle) {
  if (!cycle) return "";
  switch (cycle) {
    case "quarterly":
      return copy("plan_market.cycle.quarterly");
    case "yearly":
      return copy("plan_market.cycle.yearly");
    case "one_time":
      return copy("plan_market.cycle.one_time");
    case "monthly":
    default:
      return copy("plan_market.cycle.monthly");
  }
}

const PROVIDER_ICON_KEYS = {
  glm: "glm",
  "aliyun-bailian": "aliyun_bailian",
  claude: "claude",
  openai: "codex",
  cursor: "cursor",
  kimi: "kimi",
  "microsoft-copilot": "microsoft-copilot",
  grok: "grok",
  antigravity: "antigravity",
};

const PLAN_MARKET_ICON_SOURCES = {
  glm: "/plan-market-icons/glm.png",
  "aliyun-bailian": "/plan-market-icons/aliyun-bailian.png",
  claude: "/plan-market-icons/claude.png",
  openai: "/plan-market-icons/openai.png",
  cursor: "/plan-market-icons/cursor.png",
  kimi: "/plan-market-icons/kimi.png",
  "microsoft-copilot": "/plan-market-icons/copilot.png",
  "xiaomi-mimo": "/plan-market-icons/xiaomi-mimo.png",
  "volcengine-doubao": "https://portal.volccdn.com/obj/volcfe/misc/favicon.png",
  antigravity: "/brand-logos/antigravity.svg",
};

function accessLabel(access) {
  return access === "vpn" ? copy("plan_market.access.vpn") : copy("plan_market.access.direct");
}

function riskLabel(risk) {
  switch (risk) {
    case "extreme": return copy("plan_market.risk.extreme");
    case "high": return copy("plan_market.risk.high");
    case "medium": return copy("plan_market.risk.medium");
    default: return copy("plan_market.risk.low");
  }
}

function providerAccess(provider) {
  return provider.access || (provider.region === "CN" ? "direct" : "vpn");
}

function providerRisk(provider) {
  return provider.risk || "medium";
}

function providerTagLabel(tag) {
  switch (tag) {
    case "hot": return copy("plan_market.tag.hot");
    case "discount": return copy("plan_market.tag.discount");
    case "new": return copy("plan_market.tag.new");
    default: return "";
  }
}

function planBadgeLabel(badge) {
  switch (badge) {
    case "entry": return copy("plan_market.plan_badge.entry");
    case "hot": return copy("plan_market.tag.hot");
    case "recommended": return copy("plan_market.plan_badge.recommended");
    case "premium": return copy("plan_market.plan_badge.premium");
    default: return "";
  }
}

function startingPrice(provider) {
  return provider.plans.reduce((lowest, plan) => {
    if (!Number.isFinite(Number(plan.price?.amount))) return lowest;
    if (!lowest) return plan.price;
    const candidate = Number(plan.price?.amount);
    const current = Number(lowest.amount);
    return Number.isFinite(candidate) && Math.min(candidate, current) === candidate ? plan.price : lowest;
  }, null);
}

function PlanRow({ plan }) {
  const discontinued = plan.status === "discontinued";
  const needsReview = plan.evidence?.is_stale === true;
  return (
    <article className={`tt-plan-market-plan-card${discontinued ? " opacity-70" : ""}`}>
      <div className="tt-plan-market-plan-card-heading">
        <span className="tt-plan-market-plan-name">{plan.display_name}</span>
        {Array.isArray(plan.badges) ? plan.badges.map((badge) => (
          <span key={badge} className={`tt-plan-market-plan-badge tt-plan-market-plan-badge--${badge}`}>
            {planBadgeLabel(badge)}
          </span>
        )) : null}
        {discontinued ? (
          <span className="tt-plan-market-status-discontinued">
            {copy("plan_market.status.discontinued")}
          </span>
        ) : null}
        {needsReview ? (
          <span className="tt-plan-market-plan-badge tt-plan-market-plan-badge--review">
            {copy("plan_market.status.needs_review")}
          </span>
        ) : null}
        <span className="tt-plan-market-plan-price">
          {priceLabel(plan.price)}
          <span>
            {cycleLabel(plan.price?.cycle)}
          </span>
        </span>
      </div>
      {Array.isArray(plan.alt_prices) && plan.alt_prices.length ? (
        <div className="tt-plan-market-alt-prices">
          {plan.alt_prices
            .map((alt) => `${priceLabel(alt)}${cycleLabel(alt.cycle)}${alt.note ? ` · ${alt.note}` : ""}`)
            .join(" / ")}
        </div>
      ) : null}
      <div className="tt-plan-market-plan-quota">
        <span>{copy("plan_market.quota_label")}</span>
        {copy("plan_market.quota_separator")}
        {plan.quota_summary}
      </div>
      {Array.isArray(plan.highlights) && plan.highlights.length ? (
        <ul className="tt-plan-market-plan-highlights">
          {plan.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function PlanMarketProviderIcon({ providerId }) {
  const source = PLAN_MARKET_ICON_SOURCES[providerId];
  if (source) return <img src={source} alt="" width="64" height="64" />;
  return <ProviderIcon provider={PROVIDER_ICON_KEYS[providerId] || providerId} size={38} />;
}

function ProviderCard({ provider, expanded, onToggle }) {
  const price = startingPrice(provider);
  const access = providerAccess(provider);
  const risk = providerRisk(provider);
  const official = hasOfficialProviderSource(provider);
  const needsReview = provider.evidence?.verified !== true
    || provider.evidence?.is_stale === true;
  return (
    <section data-testid={`plan-market-provider-${provider.id}`} className="tt-plan-market-provider" data-open={expanded}>
      <button
        type="button"
        data-testid={`plan-market-toggle-${provider.id}`}
        className="tt-plan-market-provider-summary tt-pressable tt-product-focusable"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`plan-market-plans-${provider.id}`}
      >
        <span className="tt-plan-market-provider-identity">
          <span className="tt-plan-market-provider-icon" aria-hidden><PlanMarketProviderIcon providerId={provider.id} /></span>
          <span className="min-w-0 text-left">
            <span className="flex flex-wrap items-center gap-2">
              <span className="tt-plan-market-provider-name" role="heading" aria-level="2">{provider.display_name}</span>
              {official ? <span className="tt-plan-market-official">{copy("plan_market.official")}</span> : null}
              {needsReview ? (
                <span className="tt-plan-market-plan-badge tt-plan-market-plan-badge--review">
                  {copy("plan_market.status.needs_review")}
                </span>
              ) : null}
            </span>
            {!expanded ? (
              <span className="tt-plan-market-compact-details" data-testid={`plan-market-compact-details-${provider.id}`}>
                <span className="tt-plan-market-verified">{copy("plan_market.last_verified_label")} <time dateTime={provider.last_verified}>{provider.last_verified}</time></span>
                <span className="tt-plan-market-provider-access" data-testid={`plan-market-provider-access-${provider.id}`}>
                  <span className={`tt-plan-market-access tt-plan-market-access--${access}`}><Wifi aria-hidden />{accessLabel(access)}</span>
                  {access === "vpn" ? (
                    <span data-testid={`plan-market-provider-risk-${provider.id}`} className={`tt-plan-market-risk tt-plan-market-risk--${risk}`}><ShieldAlert aria-hidden />{copy("plan_market.risk_label")}：{riskLabel(risk)}</span>
                  ) : null}
                </span>
              </span>
            ) : null}
          </span>
        </span>
        <span className="tt-plan-market-provider-metadata" data-testid={`plan-market-metadata-${provider.id}`}>
          {Array.isArray(provider.tags) && provider.tags.length ? (
            <span className="tt-plan-market-provider-tags" data-testid={`plan-market-tags-${provider.id}`}>
              {provider.tags.map((tag) => (
                <span key={tag} className={`tt-plan-market-provider-tag tt-plan-market-provider-tag--${tag}`}>
                  {providerTagLabel(tag)}
                </span>
              ))}
            </span>
          ) : null}
          {Array.isArray(provider.tags) && provider.tags.length ? (
            <span className="tt-plan-market-metadata-separator" data-testid={`plan-market-metadata-separator-${provider.id}`} aria-hidden />
          ) : null}
          <span className="tt-plan-market-provider-pricing">
            <span className="tt-plan-market-plan-count" data-testid={`plan-market-plan-count-${provider.id}`}>{copy("plan_market.plan_count", { count: provider.plans.length })}</span>
            <span className="tt-plan-market-metadata-separator" aria-hidden />
            <span className="tt-plan-market-starting-price" data-testid={`plan-market-starting-price-${provider.id}`}>{priceLabel(price)} <small>{copy("plan_market.starting_from")}</small></span>
          </span>
          {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
        </span>
      </button>
      {expanded ? (
        <div id={`plan-market-plans-${provider.id}`} data-testid={`plan-market-plans-${provider.id}`} className="tt-plan-market-provider-details">
          {provider.announcement ? (
            <div className={`tt-plan-market-announcement tt-plan-market-announcement--${provider.id}`}>
              <Megaphone aria-hidden />
              <span>{provider.announcement}</span>
            </div>
          ) : null}
          <div className="tt-plan-market-plan-grid">
            {provider.plans.map((plan) => <PlanRow key={plan.plan_id} plan={plan} />)}
          </div>
          <div className="tt-plan-market-sources">
            <span>{copy("plan_market.sources_label")}：</span>
            {provider.sources.map((source) => (
              <OfficialExternalLink key={source.link_id} linkId={source.link_id}>
                {source.label}<ExternalLink aria-hidden />
              </OfficialExternalLink>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function PlanMarketPage() {
  const fallbackCatalog = useMemo(() => (
    projectPlanMarketCatalogForDashboard(bundledPlanMarketCatalog, { now: new Date() })
  ), []);
  const [marketCatalog, setMarketCatalog] = useState(fallbackCatalog);
  const [refreshMeta, setRefreshMeta] = useState({
    source_status: "configured",
    last_checked_at: null,
    last_successful_at: null,
    catalog_version: null,
    changes: EMPTY_MARKET_CHANGES,
    error_code: null,
  });
  const [refreshState, setRefreshState] = useState("idle");
  const [initialStateLoaded, setInitialStateLoaded] = useState(false);
  const [refreshCadence, setRefreshCadence] = useState(storedRefreshCadence);
  const refreshPromiseRef = useRef(null);
  const lastAttemptAtRef = useRef(null);
  const remoteStateRevisionRef = useRef(0);
  const applyRemoteState = useCallback((state) => {
    if (!state?.catalog || !Array.isArray(state.catalog.providers)) {
      throw new TypeError("Invalid plan market state");
    }
    setMarketCatalog(state.catalog);
    setRefreshMeta({
      source_status: state.refresh?.source_status || "configured",
      last_checked_at: state.refresh?.last_checked_at || null,
      last_successful_at: state.refresh?.last_successful_at || null,
      catalog_version: state.refresh?.catalog_version || null,
      changes: { ...EMPTY_MARKET_CHANGES, ...(state.refresh?.changes || {}) },
      error_code: state.refresh?.error_code || null,
    });
  }, []);
  const runRefresh = useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    remoteStateRevisionRef.current += 1;
    setRefreshState("loading");
    lastAttemptAtRef.current = Date.now();
    const request = refreshPlanMarketCatalog()
      .then((state) => {
        applyRemoteState(state);
        setRefreshState("success");
        return state;
      })
      .catch((error) => {
        setRefreshMeta((current) => ({
          ...current,
          source_status: "unreachable",
          last_checked_at: new Date(lastAttemptAtRef.current).toISOString(),
          error_code: error?.error_code || "feed_unavailable",
        }));
        setRefreshState("failure");
        throw error;
      })
      .finally(() => {
        refreshPromiseRef.current = null;
      });
    refreshPromiseRef.current = request;
    return request;
  }, [applyRemoteState]);

  useEffect(() => {
    const controller = new AbortController();
    const requestRevision = remoteStateRevisionRef.current;
    getPlanMarketState({ signal: controller.signal })
      .then((state) => {
        if (remoteStateRevisionRef.current === requestRevision) applyRemoteState(state);
      })
      .catch((error) => {
        if (error?.name !== "AbortError" && remoteStateRevisionRef.current === requestRevision) {
          setRefreshMeta((current) => ({ ...current, source_status: "unreachable" }));
        }
      })
      .finally(() => setInitialStateLoaded(true));
    return () => controller.abort();
  }, [applyRemoteState]);

  useEffect(() => {
    const intervalMs = REFRESH_CADENCE_MS[refreshCadence] || 0;
    if (!initialStateLoaded || intervalMs === 0) return undefined;
    let timer = null;
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (document.visibilityState === "hidden") return;
      const lastSuccessMs = Date.parse(String(refreshMeta.last_successful_at || ""));
      const lastCheckedMs = Date.parse(String(refreshMeta.last_checked_at || ""));
      const cadenceAnchorMs = Math.max(
        Number.isFinite(lastSuccessMs) ? lastSuccessMs : 0,
        Number.isFinite(lastCheckedMs) ? lastCheckedMs : 0,
        Number(lastAttemptAtRef.current) || 0,
      );
      const delay = cadenceAnchorMs > 0
        ? Math.max(0, cadenceAnchorMs + intervalMs - Date.now())
        : 0;
      if (delay === 0) {
        void runRefresh().catch(() => {});
        return;
      }
      timer = window.setTimeout(() => {
        timer = null;
        if (document.visibilityState !== "hidden") void runRefresh().catch(() => {});
      }, delay);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") schedule();
      else if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [initialStateLoaded, refreshCadence, refreshMeta.last_checked_at, refreshMeta.last_successful_at, runRefresh]);

  const changeRefreshCadence = (event) => {
    const value = Object.hasOwn(REFRESH_CADENCE_MS, event.target.value)
      ? event.target.value
      : "manual";
    setRefreshCadence(value);
    try {
      window.localStorage.setItem(REFRESH_CADENCE_STORAGE_KEY, value);
    } catch {
      // The selection remains active for this page even if storage is unavailable.
    }
  };
  const providers = marketCatalog.providers;
  const [providerFilter, setProviderFilter] = useState("all");
  const [sort, setSort] = useState("default");
  const [expandedProviderIds, setExpandedProviderIds] = useState(() => new Set());
  const latestVerification = useMemo(() => providers.reduce((latest, provider) => (
    String(provider.last_verified) > String(latest) ? provider.last_verified : latest
  ), ""), [providers]);
  const visibleProviders = useMemo(() => {
    const filtered = providerFilter === "all" ? providers : providers.filter((provider) => provider.id === providerFilter);
    if (sort !== "plan-count-asc") return filtered;
    return [...filtered].sort((left, right) => left.plans.length - right.plans.length || left.display_name.localeCompare(right.display_name));
  }, [providerFilter, providers, sort]);
  const totalPlans = providers.reduce((count, provider) => count + provider.plans.length, 0);
  const plans = providers.flatMap((provider) => provider.plans);
  const officialProviderCount = marketCatalog.official_source_coverage.provider_count;
  const customProviderCount = providers.length - officialProviderCount;
  const recentProviders = providers.filter((provider) => provider.is_recent);
  const recentPlanCount = recentProviders.flatMap((provider) => provider.plans).length;
  const freePlanCount = plans.filter((plan) => Number(plan.price?.amount) === 0).length;
  const paidPlanCount = plans.filter((plan) => Number(plan.price?.amount) > 0 || plan.price?.display).length;
  const officialSourcePlanCount = marketCatalog.official_source_coverage.plan_count;
  const noSourcePlanCount = totalPlans - officialSourcePlanCount;
  const officialSourceCoverage = totalPlans > 0 ? Math.round((officialSourcePlanCount / totalPlans) * 100) : 0;
  const latestProviderCount = recentProviders.length;
  const globalComparisonLinkId = marketCatalog.comparison_links.find((source) => (
    source.source_type === "third_party_comparison"
  ))?.link_id;
  const toggleProvider = (providerId) => setExpandedProviderIds((current) => {
    const next = new Set(current);
    if (next.has(providerId)) next.delete(providerId); else next.add(providerId);
    return next;
  });

  return (
    <div data-testid="plan-market-page" className="tt-reference-route-spend-plans flex flex-1 flex-col text-oai-black dark:text-oai-white font-oai antialiased">
      <main className="flex-1">
        <div className="tt-plan-market-shell">
          <header className="tt-plan-market-header">
            <div>
              <h1>{copy("nav.spend.plans")}</h1>
              <p>{copy("plan_market.page.subtitle")}</p>
              <OfficialExternalLink
                linkId={globalComparisonLinkId}
                data-testid="plan-market-global-price-comparison"
                className="tt-plan-market-global-price-comparison"
              >
                <Globe2 aria-hidden />{copy("plan_market.global_price_comparison")}<ExternalLink aria-hidden />
              </OfficialExternalLink>
            </div>
            <div className="tt-plan-market-controls">
              <span className="tt-plan-market-updated">
                <RefreshCw aria-hidden />
                {refreshMeta.last_successful_at ? (
                  <>{copy("plan_market.refresh.last_success")} <time data-testid="plan-market-last-success" dateTime={refreshMeta.last_successful_at}>{displayTimestamp(refreshMeta.last_successful_at)}</time></>
                ) : copy("plan_market.refresh.never")}
                <small>{copy("plan_market.refresh.catalog_version")} {refreshMeta.catalog_version || marketCatalog.updated_at}</small>
              </span>
              <button
                type="button"
                data-testid="plan-market-refresh-button"
                className="tt-plan-market-refresh-button tt-pressable tt-product-focusable"
                disabled={refreshState === "loading"}
                aria-busy={refreshState === "loading" ? "true" : "false"}
                onClick={() => { void runRefresh().catch(() => {}); }}
              >
                <RefreshCw aria-hidden className={refreshState === "loading" ? "tt-plan-market-refresh-spin" : ""} />
                {refreshState === "failure"
                  ? copy("plan_market.refresh.retry")
                  : copy("plan_market.refresh.button")}
              </button>
              <label className="tt-plan-market-select-wrap tt-plan-market-refresh-cadence">
                <Wifi aria-hidden />
                <span className="sr-only">{copy("plan_market.refresh.cadence_label")}</span>
                <select value={refreshCadence} onChange={changeRefreshCadence} aria-label={copy("plan_market.refresh.cadence_label")}>
                  <option value="manual">{copy("plan_market.refresh.cadence_manual")}</option>
                  <option value="6h">{copy("plan_market.refresh.cadence_6h")}</option>
                  <option value="24h">{copy("plan_market.refresh.cadence_24h")}</option>
                </select>
              </label>
              <label className="tt-plan-market-select-wrap"><ListFilter aria-hidden /><span className="sr-only">{copy("plan_market.filter.label")}</span>
                <select data-testid="plan-market-provider-filter" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} aria-label={copy("plan_market.filter.label")}>
                  <option value="all">{copy("plan_market.filter.all")}</option>
                  {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.display_name}</option>)}
                </select>
              </label>
              <label className="tt-plan-market-select-wrap"><ArrowDownUp aria-hidden /><span className="sr-only">{copy("plan_market.sort.label")}</span>
                <select data-testid="plan-market-sort" value={sort} onChange={(event) => setSort(event.target.value)} aria-label={copy("plan_market.sort.label")}>
                  <option value="default">{copy("plan_market.sort.default")}</option>
                  <option value="plan-count-asc">{copy("plan_market.sort.plan_count_asc")}</option>
                </select>
              </label>
              {refreshState === "loading" ? (
                <div className="tt-plan-market-refresh-feedback" role="status" aria-live="polite">{copy("plan_market.refresh.loading")}</div>
              ) : null}
              {refreshState === "failure" ? (
                <div className="tt-plan-market-refresh-feedback tt-plan-market-refresh-feedback--failure" role="alert">{copy("plan_market.refresh.failure")}</div>
              ) : null}
              {refreshState === "success" ? (
                <div className="tt-plan-market-refresh-feedback tt-plan-market-refresh-feedback--success" role="status" aria-live="polite">
                  <span>{copy("plan_market.refresh.success")}</span>
                  <span data-testid="plan-market-refresh-added">{copy("plan_market.refresh.added")} <strong>{refreshMeta.changes.plans_added}</strong></span>
                  <span data-testid="plan-market-refresh-changed">{copy("plan_market.refresh.changed")} <strong>{refreshMeta.changes.plans_changed}</strong></span>
                  <span data-testid="plan-market-refresh-listed">{copy("plan_market.refresh.listed")} <strong>{refreshMeta.changes.listed}</strong></span>
                  <span data-testid="plan-market-refresh-delisted">{copy("plan_market.refresh.delisted")} <strong>{refreshMeta.changes.delisted}</strong></span>
                  <span data-testid="plan-market-refresh-price-changed">{copy("plan_market.refresh.price_changed")} <strong>{refreshMeta.changes.price_changed}</strong></span>
                </div>
              ) : null}
            </div>
          </header>
          <section data-testid="plan-market-overview" data-layout-stable="true" className="tt-plan-market-overview" aria-label={copy("nav.spend.plans")}>
            <MarketStat icon={Store} tone="blue" label={copy("plan_market.stat.providers")} value={copy("plan_market.stat.providers_value", { count: providers.length })} note={copy("plan_market.stat.providers_note")} metrics={[
              { id: "catalog-official", label: copy("plan_market.stat.catalog_official"), value: officialProviderCount },
              { id: "catalog-custom", label: copy("plan_market.stat.catalog_custom"), value: customProviderCount },
            ]} />
            <MarketStat icon={CalendarDays} tone="green" label={copy("plan_market.stat.recent")} value={copy("plan_market.stat.providers_value", { count: latestProviderCount })} note={copy("plan_market.stat.recent_note", { date: latestVerification })} metrics={[
              { id: "recent-vendors", label: copy("plan_market.stat.recent_vendors"), value: recentProviders.length },
              { id: "recent-plans", label: copy("plan_market.stat.recent_plans"), value: recentPlanCount },
            ]} />
            <MarketStat icon={Tags} tone="violet" label={copy("plan_market.stat.plans")} value={copy("plan_market.stat.plans_value", { count: totalPlans })} note={copy("plan_market.stat.plans_note")} metrics={[
              { id: "paid-plans", label: copy("plan_market.stat.paid_plans"), value: paidPlanCount },
              { id: "free-plans", label: copy("plan_market.stat.free_plans"), value: freePlanCount },
            ]} />
            <MarketStat icon={ShieldCheck} tone="orange" label={copy("plan_market.stat.coverage")} value={`${officialSourceCoverage}%`} note={copy("plan_market.stat.coverage_note")} metrics={[
              { id: "official-source-plans", label: copy("plan_market.stat.official_source_plans"), value: officialSourcePlanCount },
              { id: "no-source-plans", label: copy("plan_market.stat.no_source_plans"), value: noSourcePlanCount },
            ]} />
          </section>
          <div className="tt-plan-market-provider-list">
            {visibleProviders.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} expanded={expandedProviderIds.has(provider.id)} onToggle={() => toggleProvider(provider.id)} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function MarketStat({ icon: Icon, tone, label, value, note, metrics = [] }) {
  return (
    <div data-testid="plan-market-stat" className="tt-plan-market-stat">
      <div className="tt-plan-market-stat-main">
        <span className={`tt-plan-market-stat-icon tt-plan-market-stat-icon--${tone}`}><Icon aria-hidden /></span>
        <span><span className="tt-plan-market-stat-label">{label}</span><strong>{value}</strong><small>{note}</small></span>
      </div>
      <div className="tt-plan-market-stat-details">
        {metrics.map((metric) => (
          <span key={metric.id} data-testid={`plan-market-stat-${metric.id}`}>
            <small>{metric.label}</small>
            <strong>{metric.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export default PlanMarketPage;

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotateMarketHashRight(value, shift) {
  const wrapped = (value % (2 ** shift)) * (2 ** (32 - shift));
  return ((value >>> shift) | wrapped) >>> 0;
}

function marketSha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const hash = [...SHA256_INITIAL];

  Array.from({ length: paddedLength / 64 }).forEach((_, blockIndex) => {
    const words = new Uint32Array(64);
    const offset = blockIndex * 64;
    Array.from({ length: 16 }).forEach((unused, index) => {
      words[index] = view.getUint32(offset + (index * 4));
    });
    Array.from({ length: 48 }).forEach((unused, wordIndex) => {
      const index = wordIndex + 16;
      const before15 = words[index - 15];
      const before2 = words[index - 2];
      const sigma0 = rotateMarketHashRight(before15, 7)
        ^ rotateMarketHashRight(before15, 18)
        ^ (before15 >>> 3);
      const sigma1 = rotateMarketHashRight(before2, 17)
        ^ rotateMarketHashRight(before2, 19)
        ^ (before2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    });

    let [a, b, c, d, e, f, g, h] = hash;
    SHA256_CONSTANTS.forEach((constant, index) => {
      const sum1 = rotateMarketHashRight(e, 6)
        ^ rotateMarketHashRight(e, 11)
        ^ rotateMarketHashRight(e, 25);
      const choose = (e & f) ^ ((~e) & g);
      const first = (h + sum1 + choose + constant + words[index]) >>> 0;
      const sum0 = rotateMarketHashRight(a, 2)
        ^ rotateMarketHashRight(a, 13)
        ^ rotateMarketHashRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sum0 + majority) >>> 0;
      [a, b, c, d, e, f, g, h] = [
        (first + second) >>> 0,
        a,
        b,
        c,
        (d + first) >>> 0,
        e,
        f,
        g,
      ];
    });
    [a, b, c, d, e, f, g, h].forEach((word, index) => {
      hash[index] = (hash[index] + word) >>> 0;
    });
  });

  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function canonicalMarketJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalMarketJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalMarketJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedMarketEvidenceClaim(claim) {
  const scope = claim.evidence?.claim_scope;
  const supports = [...(claim.evidence?.supports || [])].sort();
  const normalized = { claim_scope: scope, supports };
  if (scope === "market_provider") {
    if (supports.includes("provider_identity")) Object.assign(normalized, {
      id: claim.id,
      display_name: claim.display_name,
      vendor: claim.vendor,
      region: claim.region,
    });
    if (supports.includes("plan_inventory")) {
      normalized.plan_ids = (claim.plans || []).map((plan) => plan.plan_id).sort();
    }
    return normalized;
  }
  if (scope === "market_plan") {
    if (supports.includes("plan_identity")) Object.assign(normalized, {
      plan_id: claim.plan_id,
      display_name: claim.display_name,
      status: claim.status,
    });
    if (supports.includes("price")) Object.assign(normalized, {
      price: claim.price,
      alt_prices: claim.alt_prices ?? null,
    });
    if (supports.includes("quota")) Object.assign(normalized, {
      quota_summary: claim.quota_summary,
      entitlement_windows: (claim.entitlement_windows || []).map((window) => ({
        kind: window.kind,
        unit: window.unit,
        total: window.total,
      })),
    });
    if (supports.includes("eligibility")) normalized.highlights = claim.highlights ?? null;
    if (supports.includes("effective_dates")) Object.assign(normalized, {
      valid_from: claim.evidence.valid_from,
      valid_until: claim.evidence.valid_until,
    });
    if (supports.includes("promotion")) {
      normalized.promotion_prices = (claim.alt_prices || [])
        .filter((price) => price.promotion_id)
        .map((price) => ({ ...price }));
    }
    return normalized;
  }
  if (scope === "market_promotion") {
    if (supports.includes("promotion")) Object.assign(normalized, {
      promotion_id: claim.promotion_id,
      display: claim.display,
      offers: (claim.offers || []).map((offer) => ({
        promotion_id: offer.promotion_id,
        plan_id: offer.plan_id,
        amount: offer.amount,
        currency: offer.currency,
        cycle: offer.cycle,
        note: offer.note ?? null,
      })).sort(compareCanonicalMarketValues),
    });
    if (supports.includes("effective_dates")) Object.assign(normalized, {
      valid_from: claim.evidence.valid_from,
      valid_until: claim.evidence.valid_until,
    });
    return normalized;
  }
  throw new Error(`Unsupported evidence claim scope: ${scope}`);
}

function assertMarketEvidenceHash(claim) {
  const evidence = claim?.evidence;
  if (!evidence?.verified) {
    if (evidence?.content_sha256 !== null) throw new Error("Unverified evidence must not carry a content hash");
    return;
  }
  if (evidence.content_hash_kind !== "normalized_extracted_fields_v1") {
    throw new Error(`Market claims require normalized evidence hash kind: ${evidence.content_hash_kind}`);
  }
  const actual = marketSha256Hex(canonicalMarketJson(normalizedMarketEvidenceClaim(claim)));
  if (actual !== evidence.content_sha256) {
    throw new Error(`Evidence hash mismatch for ${evidence.claim_scope}`);
  }
}

function assertMarketEvidenceSupportedBySource(claim, sourcesByLinkId) {
  const evidence = claim?.evidence;
  if (!evidence?.verified) return;
  const source = sourcesByLinkId.get(evidence.link_id);
  if (!source) {
    throw new Error(`Evidence source reference is missing: ${evidence.link_id}`);
  }
  const sourceSupports = new Set(source.supports || []);
  for (const support of evidence.supports || []) {
    if (!sourceSupports.has(support)) {
      throw new Error(`Evidence source ${evidence.link_id} does not support ${support}`);
    }
  }
}

function assertMarketPromotionOffers(provider) {
  const planIds = new Set((provider.plans || []).map((plan) => plan.plan_id));
  const promotionsById = new Map();
  const offersByKey = new Map();
  for (const promotion of provider.promotions || []) {
    if (promotionsById.has(promotion.promotion_id)) {
      throw new Error(`Duplicate promotion ${promotion.promotion_id}`);
    }
    promotionsById.set(promotion.promotion_id, promotion);
    for (const offer of promotion.offers || []) {
      if (offer.promotion_id !== promotion.promotion_id) {
        throw new Error(`Promotion offer mismatch for ${promotion.promotion_id}/${offer.plan_id}`);
      }
      if (!planIds.has(offer.plan_id)) {
        throw new Error(`Promotion offer references unknown plan ${offer.plan_id}`);
      }
      const key = `${offer.promotion_id}\u0000${offer.plan_id}`;
      if (offersByKey.has(key)) {
        throw new Error(`Duplicate promotion offer for ${offer.promotion_id}/${offer.plan_id}`);
      }
      offersByKey.set(key, offer);
    }
  }
  const matchedOfferKeys = new Set();
  for (const plan of provider.plans || []) {
    for (const price of plan.alt_prices || []) {
      if (!price.promotion_id) continue;
      const promotion = promotionsById.get(price.promotion_id);
      if (!promotion) {
        throw new Error(`Orphan promotion price ${price.promotion_id} for plan ${plan.plan_id}`);
      }
      const key = `${price.promotion_id}\u0000${plan.plan_id}`;
      if (matchedOfferKeys.has(key)) {
        throw new Error(`Duplicate promotion price for ${price.promotion_id}/${plan.plan_id}`);
      }
      const offer = offersByKey.get(key);
      if (!offer
        || offer.amount !== price.amount
        || offer.currency !== price.currency
        || offer.cycle !== price.cycle
        || (offer.note ?? null) !== (price.note ?? null)) {
        throw new Error(`Promotion offer mismatch for ${price.promotion_id}/${plan.plan_id}`);
      }
      matchedOfferKeys.add(key);
    }
  }
  for (const [key, offer] of offersByKey) {
    if (!matchedOfferKeys.has(key)) {
      throw new Error(`Orphan promotion offer for ${offer.promotion_id}/${offer.plan_id}`);
    }
  }
}

function compareCanonicalMarketValues(left, right) {
  const leftJson = canonicalMarketJson(left);
  const rightJson = canonicalMarketJson(right);
  if (leftJson < rightJson) return -1;
  if (leftJson > rightJson) return 1;
  return 0;
}
