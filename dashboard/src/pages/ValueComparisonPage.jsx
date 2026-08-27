import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, BarChart3, CalendarDays, ChevronLeft, ChevronRight, CircleDollarSign, Coins, CreditCard, Database,
  Info, Landmark, Layers3, ShieldCheck, Sparkles, TrendingUp, WalletCards,
} from "lucide-react";
import { copy } from "../lib/copy";
import { getValueComparison, peekValueComparison } from "../lib/api";
import { ValueRealtimeEvidence } from "../components/ValueRealtimeEvidence";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";
import "./value-realtime-pages.css";

const RANGES = ["today", "7d", "month", "30d"];
const ACTUAL_COMPOSITION_CATEGORIES = [
  { key: "subscription" },
  { key: "official_api" },
  { key: "other_ai" },
  { key: "token_plan" },
  { key: "unknown" },
];
const VALUE_COMPOSITION_CATEGORIES = [
  { key: "subscription" },
  { key: "api_key" },
  { key: "token_plan" },
  { key: "unknown" },
];
function money(metric) {
  return metric?.value == null ? copy("value.data_unavailable") : `$${Number(metric.value).toFixed(2)}`;
}

function compactChinese(value, fractionDigits) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const absolute = Math.abs(number);
  if (absolute >= 100_000_000) return `${(number / 100_000_000).toFixed(fractionDigits).replace(/\.0+$/u, "")}亿`;
  if (absolute >= 10_000) return `${(number / 10_000).toFixed(fractionDigits).replace(/\.0+$/u, "")}万`;
  return number.toFixed(2);
}

function compactMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return copy("value.data_unavailable");
  return `$${compactChinese(number, 2)}`;
}

function compactTokens(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (Math.abs(number) >= 10_000) return compactChinese(number, 1);
  return number.toLocaleString();
}

function nativeUnit(resource) {
  return resource?.provider === "workbuddy" && /credits?/i.test(String(resource?.unit || ""))
    ? copy("realtime.points")
    : resource?.unit;
}

function nativeText(resource) {
  const unit = nativeUnit(resource);
  const rawLabel = String(resource?.label || "").trim();
  const label = rawLabel === "remaining"
    ? copy("realtime.workbuddy.remaining")
    : rawLabel === "today_consumed"
      ? copy("realtime.workbuddy.today_consumed")
      : /credits?/i.test(rawLabel) ? "" : rawLabel;
  const value = resource?.value == null ? copy("value.data_unavailable") : Number(resource.value).toLocaleString();
  return [label, value, rawLabel === "remaining" || rawLabel === "today_consumed" ? "" : unit].filter(Boolean).join(" ");
}

function percent(value, total) {
  if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(total)) || Number(total) <= 0) return copy("value.data_unavailable");
  return `${(Number(value) / Number(total) * 100).toFixed(1)}%`;
}

function category(key) {
  return copy(`value.category.${key}`);
}

function monthLabel(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  return match ? `${match[1]}年${Number(match[2])}月` : "";
}

function evidence(metric) {
  if (!metric) return copy("value.data_unavailable");
  if (metric.evidence_state === "exact") return copy("realtime.status.exact");
  if (metric.evidence_state === "observed") return copy("value.observed");
  return metric.evidence_state === "estimated" ? copy("value.estimated") : copy("value.partial");
}

function comparisonText(metric, previous, kind, range) {
  if (range !== "month") return copy("value.change_unavailable");
  if (kind === "actual" && metric?.evidence_state === "partial") return copy("value.month_compare.current_partial");
  const currentValue = Number(metric?.value);
  const previousValue = Number(previous?.value);
  if (metric?.value == null || !Number.isFinite(currentValue)) {
    if (previous?.value == null || !Number.isFinite(previousValue)) return copy("value.change_unavailable");
    if (kind === "multiple") return copy("value.previous.multiple", { value: `${previousValue.toFixed(2)}×` });
    const key = kind === "actual" ? "value.previous.actual" : "value.previous.value";
    return copy(key, { value: `$${previousValue.toFixed(2)}` });
  }
  if (previous?.value == null || !Number.isFinite(previousValue)) {
    return kind === "actual" ? copy("value.month_compare.bill_missing") : copy("value.month_compare.data_unavailable");
  }
  if (previousValue === 0) return copy("value.month_compare.zero_base");
  const delta = kind === "multiple"
    ? `${currentValue - previousValue >= 0 ? "+" : ""}${(currentValue - previousValue).toFixed(2)}×`
    : `${(currentValue - previousValue) / previousValue * 100 >= 0 ? "+" : ""}${((currentValue - previousValue) / previousValue * 100).toFixed(1)}%`;
  return copy("value.month_compare.delta", { value: delta });
}

function MetricCard({ icon: Icon, title, metric, previous, compareKind, range, tone, hint, provenance, unavailableLabel = null, unavailableStateLabel = null }) {
  const unavailable = metric?.value == null
    || Boolean(unavailableLabel && metric?.evidence_state !== "exact" && Number(metric.value) === 0);
  return <section className={`vr-value-card vr-value-card--${tone}`}>
    <div className="vr-value-icon"><Icon size={36} strokeWidth={2.1} /></div>
    <div className="min-w-0">
      <div className="vr-value-label">{title}<Info size={16} aria-label={hint} /></div>
      <div className={`vr-value-number${unavailable ? " vr-value-number--status" : ""}`}>
        {unavailable ? (unavailableLabel || copy("value.data_unavailable")) : metric?.unit === "times" ? `${Number(metric.value).toFixed(2)}×` : money(metric)}
      </div>
      <div className="vr-value-meta"><span className="vr-value-state" title={evidence(metric)}>{provenance || (unavailable && unavailableStateLabel ? unavailableStateLabel : evidence(metric))}</span><span className="vr-value-badge">{comparisonText(metric, previous, compareKind, range)}</span></div>
    </div>
  </section>;
}

function CompositionColumn({ title, rows, total, categories, missingLabel }) {
  const byKey = new Map();
  rows.forEach(function indexRow(row) { byKey.set(row.key, row); });
  return <div>
    <div className="vr-composition-title">{title}</div>
    {categories.map(({ key, labelKey = key }) => {
      const row = byKey.get(key) || { key, value: null };
      const known = row.value != null && Number.isFinite(Number(row.value));
      const share = percent(row.value, total);
      const width = known && Math.sign(Number(total)) === 1 ? Math.max(0, Math.min(100, Number(row.value) / Number(total) * 100)) : 0;
      const fallbackLabel = row.fallback_applied && row.source_month
        ? `${Number(row.source_month.slice(5, 7))}月数据`
        : null;
      const nativePointResource = Array.isArray(row.native_resources)
        ? row.native_resources.find((resource) => resource?.label === "remaining" && resource?.value != null)
        : null;
      const nativePointText = nativePointResource
        ? `${Number(nativePointResource.value).toLocaleString()} ${nativeUnit(nativePointResource)}`
        : null;
      const observedTokenText = row.observed_usage?.unit === "tokens" && row.observed_usage?.value != null
        ? `${compactTokens(row.observed_usage.value)} Token`
        : null;
      const unavailableText = row.display_state === "native_only"
        ? nativePointText || copy("value.category.native_readable")
        : row.display_state === "usage_detected"
          ? observedTokenText || copy("value.category.usage_detected")
        : row.display_state === "unreadable"
          ? copy("value.category.native_unreadable")
          : row.display_state === "not_detected"
            ? copy("value.category.history_not_detected")
            : missingLabel;
      return <div className={`vr-composition-row${known ? "" : " vr-composition-row--unavailable"}`} key={row.key}>
        <span><i className={`vr-dot vr-tone--${row.key}`} />{category(labelKey)}</span>
        <span className={`vr-bar${known ? "" : " vr-bar--unavailable"}`}>{known ? <span className={`vr-tone--${row.key}`} style={{ width: `${width}%` }} /> : null}</span>
        <strong className="vr-composition-value">{known ? `$${Number(row.value).toFixed(2)}` : unavailableText}{fallbackLabel ? <small>{fallbackLabel}</small> : null}</strong>
        <em>{known ? share : ""}</em>
      </div>;
    })}
  </div>;
}

function SourceTable({ data }) {
  const pageSize = 5;
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const linked = data.attribution?.linked || [];
    const unlinked = data.attribution?.unattributed || [];
    return [
      ...linked.map((item) => ({ key: `${item.plan_ref}:${item.account_ref}`, source: item.source, label: item.plan_label || item.plan_ref, actual: item.actual_spend_usd, value: item.api_equivalent_usd, tokens: item.observed_tokens, evidence: item.evidence, associationState: item.association_state })),
      ...unlinked.map((item) => ({ key: item.source, source: item.source, label: item.source, actual: item.actual_spend_usd, value: item.api_equivalent_usd, tokens: item.observed_tokens, evidence: item.evidence, associationState: item.association_state || "usage_detected" })),
    ];
  }, [data]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(function clampSourcePage() {
    setPage(function clampCurrentPage(current) { return Math.min(current, pageCount - 1); });
  }, [pageCount]);
  const visibleRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  const hasMultiplePages = pageCount !== 1;
  function associationBadge(state) {
    const copyKey = state === "configured_current_account"
      ? "value.table.current_binding"
      : state === "configured_plan"
        ? "value.table.configured_plan"
        : state === "usage_detected" ? "value.table.usage_detected" : null;
    return copyKey ? React.createElement("small", { className: "vr-source-state", title: copy(copyKey) }, copy(copyKey)) : null;
  }

  function actualValue(row) {
    if (row.actual != null) return `$${Number(row.actual).toFixed(2)}`;
    return <a className="vr-table-action" href="/spend/cost#subscriptions">{copy("value.action.configure_bill")}</a>;
  }

  function equivalentValue(row) {
    if (row.value != null) return `$${Number(row.value).toFixed(2)}`;
    return <a className="vr-table-action" href="/settings/cost">{copy("value.action.configure_price")}</a>;
  }

  function valueMultiple(row) {
    if (row.actual == null) {
      return <a className="vr-table-action" href="/spend/cost#subscriptions">{copy("value.action.bill_then_compare")}</a>;
    }
    if (row.value == null) {
      return <a className="vr-table-action" href="/settings/cost">{copy("value.action.price_then_compare")}</a>;
    }
    return Number(row.actual) > 0
      ? `${(Number(row.value) / Number(row.actual)).toFixed(2)}×`
      : copy("value.data_unavailable");
  }

  return <div className="vr-data-table-wrap"><table className="vr-data-table">
    <thead><tr><th>{copy("value.table.source")}</th><th>{copy("value.table.actual")}</th><th>{copy("value.table.value")}</th><th>{copy("value.table.multiple")}</th><th>{copy("value.table.trend")}</th></tr></thead>
    <tbody>{rows.length ? visibleRows.map((row) => <tr key={row.key}>
      <td><span className="vr-source-name"><i className="vr-source-mark">{row.source ? <ProviderIcon provider={row.source} size={12} /> : <Layers3 size={11} />}</i>{row.label}{associationBadge(row.associationState)}</span></td>
      <td>{actualValue(row)}</td>
      <td>{equivalentValue(row)}</td>
      <td>{valueMultiple(row)}</td><td>{row.evidence?.pricing?.source_url ? <a className="vr-source-link" href={row.evidence.pricing.source_url} target="_blank" rel="noreferrer" aria-label={copy("value_realtime.evidence.open_pricing")} title={copy("value_realtime.evidence.open_pricing")}><TrendingUp className="vr-spark" /></a> : <TrendingUp className="vr-spark" aria-label={copy("value.table.trend")} />}</td>
    </tr>) : <tr><td colSpan="5" className="text-center text-slate-500">{copy("value.no_match")}</td></tr>}</tbody>
  </table>{hasMultiplePages ? <div className="vr-table-pager">
    <button type="button" aria-label={copy("value.table.previous_page")} disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft size={15} /></button>
    <span aria-live="polite">{copy("value.table.page", { current: page + 1, total: pageCount })}</span>
    <button type="button" aria-label={copy("value.table.next_page")} disabled={page === pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}><ChevronRight size={15} /></button>
  </div> : null}</div>;
}

function compositionAmount(rows, key, missingLabel) {
  const item = (rows || []).find((row) => row.key === key);
  return item?.value == null ? missingLabel : `$${Number(item.value).toFixed(2)}`;
}

function DetailPanel({ title, icon: Icon, tone, children }) {
  return <details className="vr-evidence-details"><summary><span className={`vr-detail-icon vr-detail-icon--${tone}`}><Icon data-detail-icon={tone === "orange" ? "credits" : "subscription"} size={15} /></span>{title}</summary><div className="vr-detail-body">{children}</div></details>;
}

function SixMonthChart({ trend }) {
  const max = Math.max(1, ...trend.map(function rowMaximum(row) { return Math.max(Number(row.actual_spend_usd || 0), Number(row.api_equivalent_usd || 0)); }));
  function bar(value, label, tone) {
    const known = value != null && Number.isFinite(Number(value));
    const text = known ? compactMoney(value) : tone === "actual" ? copy("value.table.bill_missing") : copy("value.data_unavailable");
    const height = known && Number(value) > 0 ? `${Math.max(2, Number(value) / max * 58)}px` : undefined;
    return <span
      className={!known ? "vr-month-bar--unavailable" : Number(value) === 0 ? "vr-month-bar--zero" : ""}
      aria-label={`${label} ${tone === "actual" ? copy("value.actual") : copy("value.chart.value_usd")} ${text}`}
      title={text}
      style={height ? { height } : undefined}
    />;
  }
  return <section className="vr-card vr-trend">
    <div className="vr-section-heading"><h2>{copy("value.trend")} <Info size={15} className="inline text-slate-400" /></h2></div>
    <div className="vr-legend"><span><i className="vr-dot vr-tone--blue" />{copy("value.actual")}</span><span><i className="vr-dot vr-tone--green" />{copy("value.chart.value_usd")}</span></div>
    <div className="vr-trend-chart">
      <div className="vr-y-axis"><span>{compactMoney(max)}</span><span>{compactMoney(max / 2)}</span><span>{copy("value.zero")}</span></div>
      <div className="vr-month-bars">{trend.map((row, index) => <div key={row.bucket_start} className={`vr-month ${index === trend.length - 1 ? "vr-month--current" : ""}`}>
        <div className="vr-month-pair">
          <div className="vr-month-series vr-month-series--actual">{row.actual_spend_usd != null ? <strong>{compactMoney(row.actual_spend_usd)}</strong> : <strong aria-hidden="true" />}{bar(row.actual_spend_usd, row.label, "actual")}</div>
          <div className={`vr-month-series vr-month-series--value${index === trend.length - 1 ? " vr-month-current-values" : ""}`}>{row.api_equivalent_usd != null ? <strong data-testid="monthly-value-label">{compactMoney(row.api_equivalent_usd)}</strong> : <strong aria-hidden="true" />}{bar(row.api_equivalent_usd, row.label, "value")}</div>
        </div>
        <label>{row.label}</label>
      </div>)}</div>
    </div>
  </section>;
}

export function ValueComparisonPage() {
  const [range, setRange] = useState("month");
  const [month, setMonth] = useState("");
  const [data, setData] = useState(() => peekValueComparison("month"));
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const requestedMonth = range === "month" ? month || undefined : undefined;
    const cached = peekValueComparison(range, requestedMonth);
    if (cached) setData(cached);
    setError(false);
    getValueComparison(range, controller.signal, requestedMonth).then(setData).catch((reason) => {
      if (reason?.name !== "AbortError") setError(true);
    });
    return () => controller.abort();
  }, [range, month]);

  const trend = data?.monthly_trend || [];
  const actualTotal = data?.actual_spend?.total_usd?.value;
  const equivalentTotal = data?.api_equivalent_value?.value;
  const equivalentPerDollar = Math.sign(actualTotal) === 1 && equivalentTotal != null
    ? equivalentTotal / actualTotal : null;
  const previousMonth = trend.length > 1 ? trend.at(-2) : null;
  const previousActual = { value: previousMonth?.actual_spend_usd ?? null, evidence_state: previousMonth?.actual_spend_usd == null ? "unsupported" : "exact" };
  const previousValue = { value: previousMonth?.api_equivalent_usd ?? null, evidence_state: previousMonth?.api_equivalent_usd == null ? "unsupported" : "estimated" };
  const previousMultiple = {
    value: previousMonth?.actual_spend_usd > 0 && previousMonth?.api_equivalent_usd != null
      ? previousMonth.api_equivalent_usd / previousMonth.actual_spend_usd
      : null,
    evidence_state: "estimated",
  };
  const monthOptions = data?.month_options?.length ? data.month_options : data?.available_months || [];
  const selectedMonth = month || data?.requested_month || monthOptions[0] || "";
  const displayedMonthLabel = monthLabel(data?.data_month);
  const actualTrackedCategories = ["subscription", "official_api", "other_ai"];
  const knownActualCategories = (data?.actual_composition || []).filter(function isKnownActualCategory(row) {
    return actualTrackedCategories.includes(row.key) && row.value != null;
  }).length;

  return <main className="vr-page vr-page--value flex flex-1 flex-col px-5 py-7 dark:bg-oai-gray-950 dark:text-oai-white">
    <header className="vr-head">
      <div><h1>{copy("value.page.title")}</h1><p>{copy("value.page.subtitle")} <Info size={15} className="inline" /></p></div>
      <div className="vr-controls">
        <div className="vr-range" role="group" aria-label={copy("value.calendar")}>
          {RANGES.map((item) => <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}>{copy(`value.range.${item}`)}</button>)}
          <label className="vr-calendar-select" aria-label={copy("value.month.select")}><CalendarDays size={17} /><select value={selectedMonth} onChange={(event) => { setMonth(event.target.value); setRange("month"); }}>{monthOptions.map((item) => <option key={item} value={item}>{monthLabel(item)}</option>)}</select></label>
        </div>
        <span className="vr-privacy"><ShieldCheck size={17} className="vr-icon-blue" />{copy("value.privacy")}</span>
      </div>
    </header>
    {error ? <div className="vr-alert" role="alert">{copy("value.error")}</div> : null}
    {!data && !error ? <div className="vr-loading">{copy("value.loading")}</div> : null}
    {data ? <>
      {data.fallback_applied && displayedMonthLabel ? <div className="vr-month-notice" role="status">{copy("value.month.fallback", { month: displayedMonthLabel })}</div> : null}
      <section className="vr-value-flow">
        <MetricCard icon={WalletCards} tone="orange" title={copy("value.actual")} metric={data.actual_spend?.total_usd} previous={previousActual} compareKind="actual" range={range} hint={copy("value.actual_hint")} provenance={copy("value.provenance.actual", { known: knownActualCategories, total: actualTrackedCategories.length })} unavailableLabel={copy("value.table.bill_missing")} unavailableStateLabel={copy("value.state.unrecorded")} />
        <ArrowRight className="vr-flow-arrow" size={29} />
        <MetricCard icon={Sparkles} tone="green" title={copy("value.equivalent")} metric={data.api_equivalent_value} previous={previousValue} compareKind="value" range={range} hint={copy("value.equivalent_hint")} provenance={copy("value.provenance.equivalent")} />
        <ArrowRight className="vr-flow-arrow" size={29} />
        <MetricCard icon={BarChart3} tone="violet" title={copy("value.multiple")} metric={data.value_multiple} previous={previousMultiple} compareKind="multiple" range={range} hint={copy("value.multiple_hint")} provenance={copy("value.provenance.multiple")} unavailableLabel={copy("value.multiple.pending_bill")} unavailableStateLabel={copy("value.state.awaiting_bill")} />
      </section>
      <section className="vr-evidence-strip">
        <div className="vr-evidence-cell--actual"><CircleDollarSign size={24} />{equivalentPerDollar == null ? copy("value.actual_hint") : <>{copy("value.equivalence_prefix")} <strong>{equivalentPerDollar.toFixed(2)}×</strong> {copy("value.equivalence_suffix")}</>}</div>
        <div className="vr-evidence-cell--value"><Database size={23} />{copy("value.recognized")} <strong>{data.recognized_tokens?.value == null ? copy("value.data_unavailable") : Number(data.recognized_tokens.value).toLocaleString()}</strong></div>
        <div className="vr-evidence-cell--coverage"><Landmark size={22} />{copy("value.coverage")} <strong>{data.pricing_coverage_percent?.value == null ? copy("value.data_unavailable") : `${Number(data.pricing_coverage_percent.value).toFixed(0)}%`}</strong></div>
      </section>
      <div className="vr-twin-grid">
        <section className="vr-card vr-section"><div className="vr-section-heading"><h2>{displayedMonthLabel ? `${displayedMonthLabel}构成` : copy("value.composition")} <Info size={15} className="inline text-slate-400" /></h2><a className="vr-link-button" href="/spend/cost#subscriptions">{copy("value.action.configure_bill")}</a></div>
          <div className="vr-comparison-columns"><CompositionColumn title={copy("value.actual_breakdown")} rows={data.actual_composition || []} total={actualTotal} categories={ACTUAL_COMPOSITION_CATEGORIES} missingLabel={copy("value.category.history_not_detected")} /><CompositionColumn title={copy("value.value_breakdown")} rows={data.value_composition || []} total={equivalentTotal} categories={VALUE_COMPOSITION_CATEGORIES} missingLabel={copy("value.category.history_not_detected")} /></div>
        </section>
        <section className="vr-card vr-section"><div className="vr-section-heading"><h2>{copy("value.plan_compare")} <Info size={15} className="inline text-slate-400" /></h2><button type="button" className="vr-link-button" onClick={() => document.getElementById("value-source-table")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}>{copy("value.table.all")}</button></div>
          <div id="value-source-table"><SourceTable data={data} /></div>
        </section>
      </div>
      <SixMonthChart trend={trend} />
      <section className="vr-accordions">
        <DetailPanel title={copy("value.details.subscription")} icon={CreditCard} tone="blue"><div className="vr-detail-grid">
          <span>{copy("value.actual")} · {category("subscription")}</span><strong>{compositionAmount(data.actual_composition, "subscription", copy("value.table.bill_missing"))}</strong>
          <span>{copy("value.actual")} · {category("official_api")}</span><strong>{compositionAmount(data.actual_composition, "official_api", copy("value.table.bill_missing"))}</strong>
          <span>{copy("value.equivalent")} · {category("subscription")}</span><strong>{compositionAmount(data.value_composition, "subscription", copy("value.data_unavailable"))}</strong>
          <span>{copy("value.equivalent")} · {category("api_key")}</span><strong>{compositionAmount(data.value_composition, "api_key", copy("value.category.history_not_detected"))}</strong>
        </div><p className="vr-manual-guidance">{copy("value.manual.billing")}</p><a className="vr-link-button" href="/settings/cost">{copy("value.manual.open_cost_settings")}</a></DetailPanel>
        <DetailPanel title={copy("value.details.credits")} icon={Coins} tone="orange"><div className="vr-detail-resources vr-native-resources">{data.native_resources?.length ? data.native_resources.map((resource) => <span key={`${resource.provider}:${resource.label || resource.unit}`}><ProviderIcon provider={resource.provider} size={15} /><strong>{nativeText(resource)}</strong><em>{evidence(resource)}</em></span>) : <p>{copy("value.category.history_not_detected")}</p>}</div><p className="vr-manual-guidance">{copy("value.manual.native_points")}</p></DetailPanel>
        <ValueRealtimeEvidence evidence={data.api_equivalent_value?.evidence} />
      </section>
    </> : null}
  </main>;
}
