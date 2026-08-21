import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, BarChart3, CircleDollarSign, Database, Info, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { copy } from "../lib/copy";
import { getValueComparison } from "../lib/api";

const RANGES = ["today", "7d", "month", "30d"];

function money(metric) {
  return metric?.value == null ? "—" : `$${Number(metric.value).toFixed(2)}`;
}

function evidence(metric) {
  return metric?.evidence_state === "estimated" ? copy("value.estimated")
    : metric?.evidence_state === "partial" ? copy("value.partial")
      : null;
}

function MetricCard({ icon: Icon, title, metric, hint, tone }) {
  const badge = evidence(metric);
  return <section className={`rounded-2xl border p-5 shadow-sm ${tone}`}>
    <div className="flex items-start gap-4">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/65 shadow-inner"><Icon className="h-7 w-7" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm font-semibold text-slate-800"><span>{title}</span><Info className="h-4 w-4 text-slate-400" /></div>
        <div className="mt-1 text-4xl font-bold tracking-tight">{metric?.unit === "times" ? metric?.value == null ? "—" : `${Number(metric.value).toFixed(2)}×` : money(metric)}</div>
        <p className="mt-2 text-xs text-slate-500">{hint}</p>
        {badge ? <span className="mt-2 inline-flex rounded-md border border-current/15 bg-white/60 px-2 py-1 text-xs font-medium">{badge}</span> : null}
      </div>
    </div>
  </section>;
}

export function ValueComparisonPage() {
  const [range, setRange] = useState("month");
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    getValueComparison(range, controller.signal).then(setData).catch((reason) => {
      if (reason?.name !== "AbortError") setError(true);
    });
    return () => controller.abort();
  }, [range]);
  const trend = useMemo(() => (data?.monthly_trend || []).slice(-6), [data]);
  const maxTrend = Math.max(1, ...trend.map((item) => Math.max(item.actual_spend_usd || 0, item.api_equivalent_usd || 0)));
  const actualParts = data?.actual_spend || {};
  const attribution = data?.attribution || { linked: [], unattributed: [] };
  return <main className="flex flex-1 flex-col overflow-y-auto bg-slate-50 px-7 py-6 text-slate-900 dark:bg-oai-gray-950 dark:text-oai-white">
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-3xl font-bold tracking-tight">{copy("value.page.title")}</h1><p className="mt-1 text-sm text-slate-500">{copy("value.page.subtitle")}</p></div>
      <div className="flex items-center rounded-lg border bg-white p-1 shadow-sm dark:bg-oai-gray-900" role="group" aria-label={copy("value.page.title")}>
        {RANGES.map((item) => <button key={item} type="button" onClick={() => setRange(item)} className={`rounded-md px-4 py-2 text-sm font-medium ${range === item ? "bg-blue-600 text-white shadow" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300"}`}>{copy(`value.range.${item}`)}</button>)}
      </div>
    </header>
    {error ? <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">{copy("value.error")}</div> : null}
    {!data && !error ? <div className="rounded-xl border bg-white p-6 text-sm text-slate-500">{copy("value.loading")}</div> : null}
    {data ? <>
      <div className="grid gap-4 xl:grid-cols-[1fr_auto_1fr_auto_1fr] xl:items-stretch">
        <MetricCard icon={WalletCards} title={copy("value.actual")} metric={actualParts.total_usd} hint={copy("value.actual_hint")} tone="border-orange-100 bg-gradient-to-br from-orange-50 to-white text-orange-600" />
        <ArrowRight className="m-auto hidden h-8 w-8 text-slate-400 xl:block" />
        <MetricCard icon={Sparkles} title={copy("value.equivalent")} metric={data.api_equivalent_value} hint={copy("value.equivalent_hint")} tone="border-emerald-100 bg-gradient-to-br from-emerald-50 to-white text-emerald-600" />
        <ArrowRight className="m-auto hidden h-8 w-8 text-slate-400 xl:block" />
        <MetricCard icon={BarChart3} title={copy("value.multiple")} metric={data.value_multiple} hint={copy("value.multiple_hint")} tone="border-violet-100 bg-gradient-to-br from-violet-50 to-white text-violet-600" />
      </div>
      <section className="mt-4 grid gap-3 rounded-xl border bg-white px-5 py-4 text-sm shadow-sm md:grid-cols-3 dark:bg-oai-gray-900">
        <div className="flex items-center gap-2"><CircleDollarSign className="h-5 w-5 text-blue-600" />{copy("value.recognized")}：<strong>{data.recognized_tokens?.value?.toLocaleString?.() ?? "—"}</strong></div>
        <div className="flex items-center gap-2"><Database className="h-5 w-5 text-slate-500" />{copy("value.coverage")}：<strong>{data.pricing_coverage_percent?.value == null ? "—" : `${Number(data.pricing_coverage_percent.value).toFixed(0)}%`}</strong></div>
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600" />{copy("value.privacy")}</div>
      </section>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border bg-white p-5 shadow-sm dark:bg-oai-gray-900"><h2 className="font-bold">{copy("value.composition")}</h2><div className="mt-5 space-y-4">{[[copy("value.actual"), actualParts.total_usd], [copy("value.equivalent"), data.api_equivalent_value]].map(([label, metric]) => <div key={label}><div className="mb-1 flex justify-between text-sm"><span>{label}</span><strong>{money(metric)}</strong></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.min(100, Math.max(0, Number(metric?.value || 0) / Math.max(1, Number(data.api_equivalent_value?.value || 0)) * 100))}%` }} /></div></div>)}</div></section>
        <section className="rounded-xl border bg-white p-5 shadow-sm dark:bg-oai-gray-900"><h2 className="font-bold">{copy("value.plan_compare")}</h2><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="pb-3">{copy("value.plan_compare")}</th><th className="pb-3">{copy("value.equivalent")}</th></tr></thead><tbody>{attribution.linked.length ? attribution.linked.map((item) => <tr key={`${item.plan_ref}:${item.account_ref}`} className="border-t"><td className="py-3 font-medium">{item.plan_ref}</td><td className="py-3">${Number(item.api_equivalent_usd).toFixed(2)}</td></tr>) : <tr><td colSpan="2" className="py-6 text-center text-slate-500">{copy("value.no_match")}</td></tr>}</tbody></table></div></section>
      </div>
      <section className="mt-4 rounded-xl border bg-white p-5 shadow-sm dark:bg-oai-gray-900"><h2 className="font-bold">{copy("value.trend")}</h2><div className="mt-5 flex h-40 items-end gap-4">{trend.length ? trend.map((item) => <div key={item.bucket_start} className="flex min-w-10 flex-1 flex-col items-center gap-2"><div className="flex h-28 items-end gap-1"><span className="w-4 rounded-t bg-blue-600" style={{ height: `${Math.max(4, Number(item.actual_spend_usd || 0) / maxTrend * 100)}%` }} /><span className="w-4 rounded-t bg-emerald-500" style={{ height: `${Math.max(4, Number(item.api_equivalent_usd || 0) / maxTrend * 100)}%` }} /></div><span className="text-xs text-slate-500">{String(item.bucket_start).slice(5, 10)}</span></div>) : <p className="text-sm text-slate-500">{copy("value.partial")}</p>}</div></section>
    </> : null}
  </main>;
}
