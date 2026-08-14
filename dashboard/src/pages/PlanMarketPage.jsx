import React, { useMemo, useState } from "react";
import { ArrowDownUp, BadgeCheck, CalendarDays, ChevronDown, ChevronUp, ExternalLink, ListFilter, Megaphone, RefreshCw, ShieldCheck, Store, Tags } from "lucide-react";
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
  const symbol = CURRENCY_SYMBOL[price?.currency] || "";
  return `${symbol}${formatAmount(price?.amount)}`;
}

function cycleLabel(cycle) {
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
};

function providerSummary(provider) {
  const names = provider.plans.map((plan) => plan.display_name).join(" / ");
  const detail = provider.plans.flatMap((plan) => plan.highlights || [])[0] || provider.vendor;
  return copy("plan_market.summary", { plans: names, count: provider.plans.length, detail });
}

function startingPrice(provider) {
  return provider.plans.reduce((lowest, plan) => {
    if (!lowest) return plan.price;
    const candidate = Number(plan.price?.amount);
    const current = Number(lowest.amount);
    return Number.isFinite(candidate) && Math.min(candidate, current) === candidate ? plan.price : lowest;
  }, null);
}

function PlanRow({ plan }) {
  const discontinued = plan.status === "discontinued";
  return (
    <div
      className={
        "rounded-lg border border-oai-gray-200 dark:border-oai-gray-800 p-4 flex flex-col gap-2" +
        (discontinued ? " opacity-70" : "")
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-base font-semibold text-oai-black dark:text-white">
          {plan.display_name}
        </span>
        {discontinued ? (
          <span className="inline-flex items-center rounded-full bg-oai-gray-200 dark:bg-oai-gray-800 px-2 py-0.5 text-xs text-oai-gray-600 dark:text-oai-gray-400">
            {copy("plan_market.status.discontinued")}
          </span>
        ) : null}
        <span className="ml-auto text-lg font-semibold tabular-nums text-oai-black dark:text-white">
          {priceLabel(plan.price)}
          <span className="text-sm font-normal text-oai-gray-500 dark:text-oai-gray-400">
            {cycleLabel(plan.price?.cycle)}
          </span>
        </span>
      </div>
      {Array.isArray(plan.alt_prices) && plan.alt_prices.length ? (
        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {plan.alt_prices
            .map((alt) => `${priceLabel(alt)}${cycleLabel(alt.cycle)}${alt.note ? ` · ${alt.note}` : ""}`)
            .join(" / ")}
        </div>
      ) : null}
      <div className="text-sm text-oai-gray-700 dark:text-oai-gray-300">
        <span className="text-oai-gray-500 dark:text-oai-gray-400">
          {copy("plan_market.quota_label")}
        </span>
        {copy("plan_market.quota_separator")}
        {plan.quota_summary}
      </div>
      {Array.isArray(plan.highlights) && plan.highlights.length ? (
        <ul className="text-xs text-oai-gray-500 dark:text-oai-gray-400 flex flex-col gap-0.5 list-disc pl-4">
          {plan.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ProviderCard({ provider, expanded, onToggle }) {
  const price = startingPrice(provider);
  const iconKey = PROVIDER_ICON_KEYS[provider.id] || provider.id;
  return (
    <section data-testid={`plan-market-provider-${provider.id}`} className="tt-plan-market-provider" data-open={expanded}>
      <button
        type="button"
        data-testid={`plan-market-toggle-${provider.id}`}
        className="tt-plan-market-provider-summary"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`plan-market-plans-${provider.id}`}
      >
        <span className="tt-plan-market-provider-identity">
          <span className="tt-plan-market-provider-icon" aria-hidden><ProviderIcon provider={iconKey} size={38} /></span>
          <span className="min-w-0 text-left">
            <span className="flex flex-wrap items-center gap-2">
              <span className="tt-plan-market-provider-name" role="heading" aria-level="2">{provider.display_name}</span>
              <span className="tt-plan-market-official"><BadgeCheck aria-hidden />{copy("plan_market.official")}</span>
              <span className="tt-plan-market-verified">{copy("plan_market.last_verified_label")} <time dateTime={provider.last_verified}>{provider.last_verified}</time></span>
            </span>
            <span className="tt-plan-market-provider-description">{providerSummary(provider)}</span>
          </span>
        </span>
        <span className="tt-plan-market-provider-metadata">
          <span className="tt-plan-market-plan-count">{copy("plan_market.plan_count", { count: provider.plans.length })}</span>
          <span className="tt-plan-market-starting-price">{priceLabel(price)} <small>{copy("plan_market.starting_from")}</small></span>
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
  const latestProviderCount = providers.filter((provider) => provider.last_verified === latestVerification).length;
  const toggleProvider = (providerId) => setExpandedProviderIds((current) => {
    const next = new Set(current);
    if (next.has(providerId)) next.delete(providerId); else next.add(providerId);
    return next;
  });

  return (
    <div className="tt-reference-route-spend-plans flex flex-1 flex-col text-oai-black dark:text-oai-white font-oai antialiased">
      <main className="flex-1">
        <div className="tt-plan-market-shell">
          <header className="tt-plan-market-header">
            <div>
              <h1>{copy("nav.spend.plans")}</h1>
              <p>{copy("plan_market.page.subtitle")}</p>
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
          <section data-testid="plan-market-overview" className="tt-plan-market-overview" aria-label={copy("nav.spend.plans")}>
            <MarketStat icon={Store} tone="blue" label={copy("plan_market.stat.providers")} value={copy("plan_market.stat.providers_value", { count: providers.length })} note={copy("plan_market.stat.providers_note")} />
            <MarketStat icon={CalendarDays} tone="green" label={copy("plan_market.stat.recent")} value={copy("plan_market.stat.providers_value", { count: latestProviderCount })} note={copy("plan_market.stat.recent_note", { date: latestVerification })} />
            <MarketStat icon={Tags} tone="violet" label={copy("plan_market.stat.plans")} value={copy("plan_market.stat.plans_value", { count: totalPlans })} note={copy("plan_market.stat.plans_note")} />
            <MarketStat icon={ShieldCheck} tone="orange" label={copy("plan_market.stat.coverage")} value={copy("plan_market.stat.coverage_value")} note={copy("plan_market.stat.coverage_note")} />
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

function MarketStat({ icon: Icon, tone, label, value, note }) {
  return (
    <div data-testid="plan-market-stat" className="tt-plan-market-stat">
      <span className={`tt-plan-market-stat-icon tt-plan-market-stat-icon--${tone}`}><Icon aria-hidden /></span>
      <span><span className="tt-plan-market-stat-label">{label}</span><strong>{value}</strong><small>{note}</small></span>
    </div>
  );
}

export default PlanMarketPage;
