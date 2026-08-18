import React, { useMemo, useState } from "react";
import { ArrowDownUp, CalendarDays, ChevronDown, ChevronUp, ExternalLink, Globe2, ListFilter, Megaphone, RefreshCw, ShieldAlert, ShieldCheck, Store, Tags, Wifi } from "lucide-react";
import { copy } from "../lib/copy";
import planMarketCatalog from "../../../shared/plan-market-catalog.json";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";

// V2-W1 plan market: curated subscription-plan snapshot for AI providers.
// Data lives in shared/plan-market-catalog.json (single source of truth,
// also served by the local API at /functions/tokentracker-plan-market) and
// every provider entry carries official source links + a last_verified date.

const CURRENCY_SYMBOL = { CNY: "¥", USD: "$" };

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
  copilot: "copilot",
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
  copilot: "/plan-market-icons/copilot.png",
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
              <span className="tt-plan-market-official">{copy("plan_market.official")}</span>
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
              <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                {source.label}<ExternalLink aria-hidden />
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function PlanMarketPage() {
  const providers = planMarketCatalog.providers;
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
  const providersWithOfficialSources = providers.filter((provider) => provider.sources?.length);
  const officialProviderCount = providersWithOfficialSources.length;
  const customProviderCount = providers.length - officialProviderCount;
  const recentProviders = providers.filter((provider) => provider.is_recent);
  const recentPlanCount = recentProviders.flatMap((provider) => provider.plans).length;
  const freePlanCount = plans.filter((plan) => Number(plan.price?.amount) === 0).length;
  const paidPlanCount = plans.filter((plan) => Number(plan.price?.amount) > 0 || plan.price?.display).length;
  const officialSourcePlanCount = providersWithOfficialSources.flatMap((provider) => provider.plans).length;
  const noSourcePlanCount = totalPlans - officialSourcePlanCount;
  const officialSourceCoverage = totalPlans > 0 ? Math.round((officialSourcePlanCount / totalPlans) * 100) : 0;
  const latestProviderCount = providers.filter((provider) => provider.is_recent).length
    || providers.filter((provider) => provider.last_verified === latestVerification).length;
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
              <a data-testid="plan-market-global-price-comparison" className="tt-plan-market-global-price-comparison" href="https://opentherank.com/zh/ai-pricing/" target="_blank" rel="noopener noreferrer">
                <Globe2 aria-hidden />{copy("plan_market.global_price_comparison")}<ExternalLink aria-hidden />
              </a>
            </div>
            <div className="tt-plan-market-controls">
              <span className="tt-plan-market-updated"><RefreshCw aria-hidden />{copy("plan_market.last_verified_label")} <time dateTime={planMarketCatalog._meta.updated_at}>{planMarketCatalog._meta.updated_at}</time></span>
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
