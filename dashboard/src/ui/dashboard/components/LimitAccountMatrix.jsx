import React, { useMemo } from "react";
import { copy } from "../../../lib/copy";
import { EvidenceBadge } from "./EvidenceBadge.jsx";

function forecastKey(accountKey, window) {
  return `${accountKey}\0${window?.kind || ""}\0${window?.label || ""}`;
}

function formatForecast(forecast) {
  if (!forecast) return null;
  if (forecast.advice === "insufficient") return copy("limits.matrix.forecast_insufficient");
  if (forecast.exhausts_before_reset && forecast.exhaust_at) return copy("limits.matrix.forecast_exhaust", { time: new Date(forecast.exhaust_at).toLocaleString() });
  return copy("limits.matrix.forecast_safe");
}

export function LimitAccountMatrix({ accounts = [], forecasts = [] }) {
  const forecastByKey = useMemo(() => new Map((forecasts || []).map((forecast) => [
    `${forecast.account_key}\0${forecast.window_kind || ""}\0${forecast.window_label || ""}`,
    forecast,
  ])), [forecasts]);
  const grouped = useMemo(() => {
    const map = new Map();
    for (const account of accounts || []) {
      if (!account?.provider_id || !account?.account_key) continue;
      const items = map.get(account.provider_id) || [];
      items.push(account);
      map.set(account.provider_id, items);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([provider, items]) => [provider, items.sort((a, b) => String(a.account_key).localeCompare(String(b.account_key)))]);
  }, [accounts]);
  return (
    <section className="space-y-4" aria-label={copy("limits.matrix.title")}>
      <div><h2 className="text-lg font-semibold text-oai-black dark:text-white">{copy("limits.matrix.title")}</h2><p className="text-xs text-oai-gray-500">{copy("limits.matrix.subtitle")}</p></div>
      {grouped.length === 0 ? <p className="rounded-lg border border-dashed border-oai-gray-200 p-4 text-sm text-oai-gray-500">{copy("limits.matrix.empty")}</p> : grouped.map(([provider, providerAccounts]) => (
        <div key={provider} className="space-y-2"><h3 className="text-sm font-medium capitalize">{provider}</h3>{providerAccounts.map((account) => (
          <article key={account.account_key} data-testid="limit-account-row" className="rounded-lg border border-oai-gray-200 p-3 dark:border-oai-gray-800">
            <div className="flex justify-between gap-2 text-sm"><span>{account.account_label}</span><span className="text-oai-gray-500">{account.status}</span></div>
            {(account.windows || []).length === 0 ? <p className="mt-2 text-xs text-oai-gray-500">{copy("limits.matrix.window_unavailable")}</p> : (account.windows || []).map((window) => {
              const forecast = forecastByKey.get(forecastKey(account.account_key, window));
              return <div key={`${window.kind}:${window.label}`} className="mt-2 border-t border-oai-gray-100 pt-2 text-xs dark:border-oai-gray-800"><div className="flex items-center gap-2"><span className="w-14">{window.label}</span><div className="h-1.5 flex-1 overflow-hidden rounded bg-oai-gray-100 dark:bg-oai-gray-800"><div className="h-full bg-oai-brand-500" style={{ width: `${Math.max(0, Math.min(100, Number(window.used_percent) || 0))}%` }} /></div><span>{window.used_percent == null ? "—" : `${Math.round(window.used_percent)}%`}</span><EvidenceBadge evidence={window.evidence} /></div>{forecast ? <p className="mt-1 text-oai-gray-500" data-advice={forecast.advice}>{formatForecast(forecast)}</p> : null}</div>;
            })}
          </article>
        ))}</div>
      ))}
    </section>
  );
}
