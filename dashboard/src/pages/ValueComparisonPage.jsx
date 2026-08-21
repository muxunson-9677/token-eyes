import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, BarChart3, CalendarDays, CircleDollarSign, Database,
  Info, Landmark, Layers3, ShieldCheck, Sparkles, TrendingUp, WalletCards,
} from "lucide-react";
import { copy } from "../lib/copy";
import { getValueComparison } from "../lib/api";
import "./value-realtime-pages.css";

const RANGES = ["today", "7d", "month", "30d"];
function money(metric) {
  return metric?.value == null ? "—" : `$${Number(metric.value).toFixed(2)}`;
}

function percent(value, total) {
  if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(total)) || Number(total) <= 0) return "—";
  return `${(Number(value) / Number(total) * 100).toFixed(1)}%`;
}

function category(key) {
  return copy(`value.category.${key}`);
}

function evidence(metric) {
  if (!metric || metric.evidence_state === "exact") return copy("value.change_unavailable");
  return metric.evidence_state === "estimated" ? copy("value.estimated") : copy("value.partial");
}

function MetricCard({ icon: Icon, title, metric, tone, hint }) {
  return <section className={`vr-value-card vr-value-card--${tone}`}>
    <div className="vr-value-icon"><Icon size={42} strokeWidth={2.1} /></div>
    <div className="min-w-0">
      <div className="vr-value-label">{title}<Info size={16} aria-label={hint} /></div>
      <div className="vr-value-number">
        {metric?.unit === "times" ? metric?.value == null ? "—" : `${Number(metric.value).toFixed(2)}×` : money(metric)}
      </div>
      <span className="vr-value-badge">{evidence(metric)}</span>
    </div>
  </section>;
}

function CompositionColumn({ title, rows, total }) {
  return <div>
    <div className="vr-composition-title">{title}</div>
    {rows.map((row) => {
      return <div className="vr-composition-row" key={row.key}>
        <span><i className={`vr-dot vr-tone--${row.key}`} />{category(row.key)}</span>
        <span className="vr-bar"><span className={`vr-tone--${row.key}`} style={{ width: `${Math.max(0, Math.min(100, Number(row.value || 0) / Math.max(1, Number(total || 0)) * 100))}%` }} /></span>
        <strong>{row.value == null ? "—" : `$${Number(row.value).toFixed(2)}`}</strong>
        <em>{percent(row.value, total)}</em>
      </div>;
    })}
  </div>;
}

function SourceTable({ data }) {
  const rows = useMemo(() => {
    const linked = data.attribution?.linked || [];
    const unlinked = data.attribution?.unattributed || [];
    return [
      ...linked.map((item) => ({ key: `${item.plan_ref}:${item.account_ref}`, label: item.plan_ref, actual: null, value: item.api_equivalent_usd })),
      ...unlinked.map((item) => ({ key: item.source, label: copy("value.table.unlinked", { source: item.source }), actual: null, value: item.api_equivalent_usd })),
    ];
  }, [data]);
  return <table className="vr-data-table">
    <thead><tr><th>{copy("value.table.source")}</th><th>{copy("value.table.actual")}</th><th>{copy("value.table.value")}</th><th>{copy("value.table.multiple")}</th><th>{copy("value.table.trend")}</th></tr></thead>
    <tbody>{rows.length ? rows.slice(0, 5).map((row) => <tr key={row.key}>
      <td><span className="vr-source-name"><i className="vr-source-mark"><Layers3 size={11} /></i>{row.label}</span></td>
      <td>{row.actual == null ? "—" : `$${Number(row.actual).toFixed(2)}`}</td>
      <td>{row.value == null ? "—" : `$${Number(row.value).toFixed(2)}`}</td>
      <td>—</td><td><TrendingUp className="vr-spark" aria-label={copy("value.table.trend")} /></td>
    </tr>) : <tr><td colSpan="5" className="text-center text-slate-500">{copy("value.no_match")}</td></tr>}</tbody>
  </table>;
}

function SixMonthChart({ trend }) {
  const max = Math.max(1, ...trend.map(function rowMaximum(row) { return Math.max(Number(row.actual_spend_usd || 0), Number(row.api_equivalent_usd || 0)); }));
  return <section className="vr-card vr-trend">
    <div className="vr-section-heading"><h2>{copy("value.trend")} <Info size={15} className="inline text-slate-400" /></h2></div>
    <div className="vr-legend"><span><i className="vr-dot vr-tone--blue" />{copy("value.actual")}</span><span><i className="vr-dot vr-tone--green" />{copy("value.chart.value_usd")}</span></div>
    <div className="vr-trend-chart">
      <div className="vr-y-axis"><span>{Math.ceil(max)}</span><span>{Math.ceil(max / 2)}</span><span>{copy("value.zero")}</span></div>
      <div className="vr-month-bars">{trend.map((row, index) => <div key={row.bucket_start} className={`vr-month ${index === trend.length - 1 ? "vr-month--current" : ""}`}>
        <span title={money({ value: row.actual_spend_usd })} style={{ height: `${Math.max(2, Number(row.actual_spend_usd || 0) / max * 100)}%` }} />
        <span title={money({ value: row.api_equivalent_usd })} style={{ height: `${Math.max(2, Number(row.api_equivalent_usd || 0) / max * 100)}%` }} />
        <label>{row.label}</label>
      </div>)}</div>
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

  const trend = data?.monthly_trend || [];
  const actualTotal = data?.actual_spend?.total_usd?.value;
  const equivalentTotal = data?.api_equivalent_value?.value;
  const equivalentPerDollar = data?.actual_spend?.total_usd?.evidence_state === "exact" && Math.sign(actualTotal) === 1 && equivalentTotal != null
    ? equivalentTotal / actualTotal : null;

  return <main className="vr-page flex flex-1 flex-col overflow-y-auto px-7 py-5 dark:bg-oai-gray-950 dark:text-oai-white">
    <header className="vr-head">
      <div><h1>{copy("value.page.title")}</h1><p>{copy("value.page.subtitle")} <Info size={15} className="inline" /></p></div>
      <div className="vr-controls">
        <div className="vr-range" role="group" aria-label={copy("value.calendar")}>
          {RANGES.map((item) => <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}>{copy(`value.range.${item}`)}</button>)}
          <label className="vr-calendar-select" aria-label={copy("value.calendar")}><CalendarDays size={17} /><select value={range} onChange={(event) => setRange(event.target.value)}>{RANGES.map((item) => <option key={item} value={item}>{copy(`value.range.${item}`)}</option>)}</select></label>
        </div>
        <span className="vr-privacy"><ShieldCheck size={17} className="vr-icon-blue" />{copy("value.privacy")}</span>
      </div>
    </header>
    {error ? <div className="vr-alert" role="alert">{copy("value.error")}</div> : null}
    {!data && !error ? <div className="vr-loading">{copy("value.loading")}</div> : null}
    {data ? <>
      <section className="vr-value-flow">
        <MetricCard icon={WalletCards} tone="orange" title={copy("value.actual")} metric={data.actual_spend?.total_usd} hint={copy("value.actual_hint")} />
        <ArrowRight className="vr-flow-arrow" size={29} />
        <MetricCard icon={Sparkles} tone="green" title={copy("value.equivalent")} metric={data.api_equivalent_value} hint={copy("value.equivalent_hint")} />
        <ArrowRight className="vr-flow-arrow" size={29} />
        <MetricCard icon={BarChart3} tone="violet" title={copy("value.multiple")} metric={data.value_multiple} hint={copy("value.multiple_hint")} />
      </section>
      <section className="vr-evidence-strip">
        <div><CircleDollarSign size={24} />{equivalentPerDollar == null ? copy("value.actual_hint") : <>{copy("value.equivalence_prefix")} <strong>{equivalentPerDollar.toFixed(2)}×</strong> {copy("value.equivalence_suffix")}</>}</div>
        <div><Database size={23} />{copy("value.recognized")} <strong>{data.recognized_tokens?.value == null ? "—" : Number(data.recognized_tokens.value).toLocaleString()}</strong></div>
        <div><Landmark size={22} />{copy("value.coverage")} <strong>{data.pricing_coverage_percent?.value == null ? "—" : `${Number(data.pricing_coverage_percent.value).toFixed(0)}%`}</strong></div>
      </section>
      <div className="vr-twin-grid">
        <section className="vr-card vr-section"><div className="vr-section-heading"><h2>{copy("value.composition")} <Info size={15} className="inline text-slate-400" /></h2></div>
          <div className="vr-comparison-columns"><CompositionColumn title={copy("value.actual_breakdown")} rows={data.actual_composition || []} total={actualTotal} /><CompositionColumn title={copy("value.value_breakdown")} rows={data.value_composition || []} total={equivalentTotal} /></div>
        </section>
        <section className="vr-card vr-section"><div className="vr-section-heading"><h2>{copy("value.plan_compare")} <Info size={15} className="inline text-slate-400" /></h2><button type="button" className="vr-link-button" onClick={() => document.getElementById("value-source-table")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}>{copy("value.table.all")}</button></div>
          <div id="value-source-table"><SourceTable data={data} /></div>
        </section>
      </div>
      <SixMonthChart trend={trend} />
      <section className="vr-accordions">
        <details><summary><Database size={20} className="vr-icon-blue" />{copy("value.details.subscription")}</summary><p>{copy("value.details.summary")}</p></details>
        <details><summary><Layers3 size={20} className="vr-icon-orange" />{copy("value.details.credits")}</summary><p>{copy("value.details.summary")}</p></details>
        <details><summary><Info size={20} className="vr-icon-violet" />{copy("value.details.evidence")}</summary><p>{copy("value.privacy")}；{copy("value.actual_hint")}</p></details>
      </section>
    </> : null}
  </main>;
}
