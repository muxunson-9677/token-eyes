import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Boxes, CalendarDays, ChevronDown, CircleDollarSign, Info, RefreshCw, Users,
} from "lucide-react";
import { copy } from "../lib/copy";
import { getRealtimeSessions } from "../lib/api";
import "./value-realtime-pages.css";

const RANGES = ["today", "7d", "month", "30d"];
const TABS = ["composition", "trend", "children", "requests"];
const COMPONENTS = [
  ["input_tokens", "realtime.input", "blue", "var(--vr-blue)"],
  ["output_tokens", "realtime.output", "teal", "var(--vr-teal)"],
  ["cached_input_tokens", "realtime.cache_read", "violet", "var(--vr-violet)"],
  ["cache_creation_input_tokens", "realtime.cache_write", "amber", "var(--vr-amber)"],
];

function number(metric) { return metric?.value == null ? "—" : Number(metric.value).toLocaleString(); }
function money(metric) { return metric?.value == null ? "—" : `$${Number(metric.value).toFixed(2)}`; }
function compact(metric) {
  if (metric?.value == null) return "—";
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(metric.value));
}
function stateLabel(state) { return state === "running" ? copy("realtime.running") : copy("realtime.recent_activity"); }
function formatTime(value) { return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"; }
function providerTone(value) { return value === "running" ? "rt-provider-avatar--green" : "rt-provider-avatar--orange"; }

function MiniWave() {
  return <div className="rt-mini-wave" aria-hidden="true"><Activity size={36} strokeWidth={1.7} /></div>;
}

function Kpi({ icon: Icon, tone, title, value, delta }) {
  return <section className="vr-card rt-kpi"><div className={`rt-kpi-icon rt-kpi-icon--${tone}`}><Icon size={31} /></div><div><div className="rt-kpi-label">{title}</div><div className="rt-kpi-value">{value}</div><div className="rt-kpi-change">{copy("realtime.changed")}<strong>{delta == null ? copy("realtime.no_change") : `${delta > 0 ? "+" : ""}${delta.toLocaleString()}`}</strong></div></div></section>;
}

function SessionStrip({ sessions }) {
  return <section className="rt-session-strip" aria-label={copy("realtime.other")}>
    {sessions.length ? sessions.map((session) => <article key={session.session_id} className="vr-card rt-session-mini">
      <div className="rt-mini-head"><div className="rt-mini-name"><i className={`rt-provider-avatar ${providerTone(session.state)}`}><Boxes size={13} /></i><span>{session.agent_label || session.source}</span></div><span className="rt-mini-state">{stateLabel(session.state)}</span></div>
      <div className="rt-mini-data"><span>{compact(session.total_tokens)} <small>{copy("realtime.token_unit")}</small></span><span>{money(session.api_equivalent_usd)}</span></div>
    </article>) : <div className="vr-empty">{copy("realtime.empty")}</div>}
  </section>;
}

function CompositionTab({ focus }) {
  const rows = COMPONENTS.map(([key, label, tone, color]) => ({ key, label, tone, color, value: focus?.[key]?.value || 0 }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const stops = rows.reduce((parts, row) => {
    const start = parts.offset;
    const end = start + (total ? row.value / total * 100 : 0);
    parts.stops.push(`${row.color} ${start}% ${end}%`);
    parts.offset = end;
    return parts;
  }, { offset: 0, stops: [] });
  return <div className="rt-composition-view">
    <div className="rt-donut-wrap"><div className="rt-donut" style={total ? { background: `conic-gradient(${stops.stops.join(", ")})` } : undefined}><span className="rt-donut-center">{copy("realtime.tokens")}<strong>{compact(focus?.total_tokens)}</strong></span></div>
      <div className="rt-breakdown">{rows.map((row) => <div className="rt-breakdown-row" key={row.key}><span><i className={`vr-dot vr-tone--${row.tone}`} />{copy(row.label)}</span><strong>{compact({ value: row.value })}</strong><em>{total ? `${(row.value / total * 100).toFixed(1)}%` : "—"}</em></div>)}</div>
    </div>
    <div className="rt-line-view"><div className="rt-chart-top"><span>{copy("realtime.trend")}</span><span>{copy("realtime.chart.window")}</span></div><div className="rt-line-chart">{rows.map((row) => <span key={row.key} className="rt-line-point" style={{ height: `${Math.max(4, total ? row.value / total * 100 : 4)}%`, background: row.color }} />)}</div></div>
  </div>;
}

function TrendTab({ points }) {
  const max = Math.max(1, ...points.map(function pointMaximum(point) { return point.total_tokens || 0; }));
  return <div className="rt-line-view"><div className="rt-chart-top"><span>{copy("realtime.trend")}</span><span>{copy("realtime.chart.window")}</span></div><div className="rt-line-chart">{points.length ? points.map((point, index) => <span key={`${point.observed_at}-${index}`} className="rt-line-point" title={`${formatTime(point.observed_at)} · ${point.total_tokens.toLocaleString()}`} style={{ height: `${Math.max(3, point.total_tokens / max * 100)}%` }} />) : <span className="rt-list-view">{copy("realtime.empty")}</span>}</div></div>;
}

function TreeTab({ tree }) {
  const nodes = tree.filter(function withChildren(node) { return node.children?.length; });
  return <div className="rt-list-view">{nodes.length ? nodes.map(function renderTreeNode(node) { return <div className="rt-request-row" key={node.session_id}><strong>{node.agent_label || node.source}</strong><span>{copy("realtime.sub_agents")} {node.children.length}</span><span>{compact(node.total_tokens)}</span></div>; }) : copy("realtime.tree.empty")}</div>;
}

function RequestsTab({ points }) {
  return <div className="rt-list-view">{points.length ? points.slice(-8).reverse().map((point, index) => <div className="rt-request-row" key={`${point.observed_at}-${index}`}><strong>{point.source}</strong><span>{formatTime(point.observed_at)}</span><span>{copy("realtime.tokens_with_unit", { value: point.total_tokens.toLocaleString() })}</span></div>) : copy("realtime.requests.empty")}</div>;
}

function SidePanels({ data, stateCounts }) {
  const all = data.sessions || [];
  const exact = all.filter(function isExact(session) { return session.total_tokens?.evidence_state === "exact"; }).length;
  const estimated = all.filter(function isEstimated(session) { return session.api_equivalent_usd?.evidence_state === "estimated"; }).length;
  const covered = all.filter(function isCovered(session) { return session.api_equivalent_usd?.value != null; }).length;
  const coverage = all.length ? Math.round(covered / all.length * 100) : 0;
  return <aside className="rt-side">
    <details className="vr-card rt-side-card" open><summary>{copy("realtime.status")} <Info size={15} className="ml-2 text-slate-400" /></summary><div className="rt-side-content rt-status-grid">
      <span><i className="rt-status-dot rt-status-dot--exact" />{copy("realtime.status.exact")}<strong>{copy("realtime.count_unit", { count: exact })}</strong></span>
      <span><i className="rt-status-dot rt-status-dot--estimated" />{copy("realtime.status.estimated")}<strong>{copy("realtime.count_unit", { count: estimated })}</strong></span>
      <span><i className="rt-status-dot rt-status-dot--cached" />{copy("realtime.status.connected")}<strong>{copy("realtime.count_unit", { count: stateCounts.recent_activity || 0 })}</strong></span>
    </div></details>
    <details className="vr-card rt-side-card" open><summary>{copy("realtime.coverage")}</summary><div className="rt-side-content rt-coverage"><div className="rt-coverage-ring" style={{ "--coverage": `${coverage}%` }}><strong>{coverage}%</strong></div><p>{copy("realtime.covered_models")}<br /><strong>{covered} / {all.length || 0}</strong><br />{copy("realtime.page.subtitle")}</p></div></details>
    <details className="vr-card rt-side-card"><summary>{copy("realtime.legend")} <Info size={15} className="ml-2 text-slate-400" /></summary><div className="rt-side-content text-sm text-slate-500">{copy("realtime.page.subtitle")}</div></details>
  </aside>;
}

export function RealtimeSessionsPage() {
  const [range, setRange] = useState("today");
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("composition");
  const previousSummary = useRef(null);
  const latestSummary = useRef(null);
  const controllerRef = useRef(null);
  const load = useCallback(async (manual = false) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRefreshing(manual);
    setError(false);
    try {
      const next = await getRealtimeSessions(range, controller.signal);
      if (!controller.signal.aborted) {
        previousSummary.current = latestSummary.current;
        latestSummary.current = next?.summary || null;
        setData(next);
      }
    } catch (reason) { if (reason?.name !== "AbortError") setError(true); } finally { if (!controller.signal.aborted) setRefreshing(false); }
  }, [range]);
  useEffect(() => { load(); return () => controllerRef.current?.abort(); }, [load]);
  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible" && document.hasFocus()) load(); };
    const id = window.setInterval(refreshVisible, 15_000);
    document.addEventListener("visibilitychange", refreshVisible); window.addEventListener("focus", refreshVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", refreshVisible); window.removeEventListener("focus", refreshVisible); };
  }, [load]);

  const sessions = data?.sessions || [];
  const focus = sessions.find(function isRunningWithUsage(session) { return session.state === "running" && Math.sign(Number(session.total_tokens?.value || 0)) === 1; })
    || sessions.find(function hasUsage(session) { return Math.sign(Number(session.total_tokens?.value || 0)) === 1; })
    || sessions[0];
  const rest = focus ? sessions.filter((item) => item.session_id !== focus.session_id) : [];
  const stateCounts = useMemo(() => sessions.reduce((counts, session) => ({ ...counts, [session.state]: (counts[session.state] || 0) + 1 }), {}), [sessions]);
  function delta(key) { return data?.summary?.[key]?.value != null && previousSummary.current?.[key]?.value != null ? data.summary[key].value - previousSummary.current[key].value : null; }

  return <main className="vr-page flex flex-1 flex-col overflow-y-auto px-6 py-7 dark:bg-oai-gray-950 dark:text-oai-white">
    <header className="vr-head"><div><h1>{copy("realtime.page.title")}</h1><p>{copy("realtime.page.subtitle")} <Info size={15} className="inline" /></p></div><div className="rt-head-actions">
      <label className="rt-range"><CalendarDays size={18} /><select aria-label={copy("realtime.range.select")} value={range} onChange={(event) => setRange(event.target.value)}>{RANGES.map((item) => <option key={item} value={item}>{copy(`realtime.range.${item}`)}</option>)}</select><ChevronDown size={15} /></label>
      <button type="button" className="rt-refresh" onClick={() => load(true)}><i className="rt-updated-dot" />{refreshing ? copy("realtime.refreshing") : `${copy("realtime.updated")} ${data?.observed_at ? formatTime(data.observed_at) : "—"}`}<RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /></button>
    </div></header>
    {error ? <div className="vr-alert" role="alert">{copy("realtime.error")}</div> : null}
    {!data && !error ? <div className="vr-loading">{copy("realtime.loading")}</div> : null}
    {data ? <>
      <section className="rt-kpis"><Kpi icon={Users} tone="blue" title={copy("realtime.active_agents")} value={number(data.summary?.active_agents)} delta={delta("active_agents")} /><Kpi icon={Boxes} tone="violet" title={copy("realtime.tokens")} value={compact(data.summary?.realtime_tokens)} delta={delta("realtime_tokens")} /><Kpi icon={CircleDollarSign} tone="green" title={copy("realtime.equivalent")} value={money(data.summary?.api_equivalent_value)} delta={delta("api_equivalent_value")} /></section>
      {focus ? <section className="vr-card rt-focus"><div className="rt-focus-top">
        <div><div className="rt-agent-title"><i className="rt-agent-cube"><Boxes size={21} /></i>{focus.agent_label || focus.source}<span className="rt-status-pill">{stateLabel(focus.state)}</span></div><div className="rt-focus-task-label">{copy("realtime.current_task")}</div><div className="rt-focus-task">{focus.project_label || copy("realtime.no_task_label")}</div><MiniWave /></div>
        <div className="rt-focus-metric"><div className="rt-focus-metric-label">{copy("realtime.tokens")}</div><div className="rt-focus-metric-value">{compact(focus.total_tokens)}</div><div className="rt-focus-metric-sub">{copy("realtime.input")} {compact(focus.input_tokens)} · {copy("realtime.output")} {compact(focus.output_tokens)}</div></div>
        <div className="rt-focus-metric"><div className="rt-focus-metric-label">{copy("realtime.equivalent")}</div><div className="rt-focus-metric-value">{money(focus.api_equivalent_usd)}</div><div className="rt-focus-metric-sub">{copy("realtime.billing_safe")}</div></div>
        <div className="rt-focus-metric rt-focus-metric--blue"><div className="rt-focus-metric-label">{copy("realtime.changed")}</div><div className="rt-focus-metric-value">{delta("realtime_tokens") == null ? copy("realtime.no_change") : `${delta("realtime_tokens") > 0 ? "+" : ""}${delta("realtime_tokens").toLocaleString()} Token`}</div></div>
      </div><div className="rt-focus-footer"><div><span>{copy("realtime.requests")}</span><strong>{number(focus.request_count)}</strong></div><div><span>{copy("realtime.sub_agents")}</span><strong>{data.session_tree.find((node) => node.session_id === focus.session_id)?.children?.length || 0}</strong></div><div><span>{copy("realtime.updated")}</span><strong>{formatTime(focus.last_activity_at)}</strong></div><div><span>{copy("realtime.model")}</span><strong>{focus.model || "—"}</strong></div><div><span>{copy("realtime.billing")}</span><strong>{copy("realtime.billing_safe")}</strong></div></div></section> : <section className="vr-empty mt-4">{copy("realtime.empty")}</section>}
      <SessionStrip sessions={rest.slice(0, 8)} />
      <section className="rt-workspace"><div className="vr-card rt-analysis"><div className="rt-tabs" role="tablist">{TABS.map((item) => <button type="button" key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{copy(`realtime.tabs.${item}`)}</button>)}</div><div className="rt-analysis-body">{tab === "composition" ? <CompositionTab focus={focus} /> : null}{tab === "trend" ? <TrendTab points={data.activity_points || []} /> : null}{tab === "children" ? <TreeTab tree={data.session_tree || []} /> : null}{tab === "requests" ? <RequestsTab points={data.activity_points || []} /> : null}</div></div><SidePanels data={data} stateCounts={stateCounts} /></section>
    </> : null}
  </main>;
}
