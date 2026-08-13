import React from "react";
import { ExternalLink, BadgeCheck, Megaphone } from "lucide-react";
import { copy } from "../lib/copy";
import planMarketCatalog from "../../../shared/plan-market-catalog.json";

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
        {" · "}
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

function ProviderCard({ provider }) {
  return (
    <section className="rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-oai-white dark:bg-oai-gray-900 p-5 sm:p-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-oai-black dark:text-white">
          {provider.display_name}
        </h2>
        <span className="inline-flex items-center gap-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
          {copy("plan_market.last_verified_label")}
          <span className="tabular-nums">{provider.last_verified}</span>
        </span>
      </div>
      {provider.announcement ? (
        <div className="flex items-start gap-2 rounded-lg bg-oai-gray-100 dark:bg-oai-gray-800/60 px-3 py-2 text-sm text-oai-gray-700 dark:text-oai-gray-300">
          <Megaphone className="h-4 w-4 mt-0.5 shrink-0 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden />
          <span>{provider.announcement}</span>
        </div>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {provider.plans.map((plan) => (
          <PlanRow key={plan.plan_id} plan={plan} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-oai-gray-500 dark:text-oai-gray-400">
          {copy("plan_market.sources_label")}
        </span>
        {provider.sources.map((source) => (
          <a
            key={source.url}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-oai-gray-600 dark:text-oai-gray-400 hover:text-oai-black dark:hover:text-white underline underline-offset-2 transition-colors"
          >
            {source.label}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ))}
      </div>
    </section>
  );
}

export function PlanMarketPage() {
  return (
    <div className="flex flex-col flex-1 text-oai-black dark:text-oai-white font-oai antialiased">
      <main className="flex-1 pt-8 sm:pt-10 pb-12 sm:pb-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-6">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-oai-black dark:text-white mb-3">
              {copy("nav.spend.plans")}
            </h1>
            <p className="text-oai-gray-500 dark:text-oai-gray-400 text-sm sm:text-base">
              {copy("plan_market.page.subtitle")}
            </p>
          </div>
          <p className="mb-8 rounded-lg border border-oai-gray-200 dark:border-oai-gray-800 bg-oai-gray-50 dark:bg-oai-gray-900 px-3 py-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("plan_market.disclaimer")}
          </p>
          <div className="flex flex-col gap-6">
            {planMarketCatalog.providers.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

export default PlanMarketPage;
