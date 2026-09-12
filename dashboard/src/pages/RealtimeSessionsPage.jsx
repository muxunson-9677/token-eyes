import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Info, RefreshCw, Users,
} from "lucide-react";
import { copy } from "../lib/copy";
import { getRealtimeSessions, peekRealtimeSessions } from "../lib/api";
import { normalizeVisibleProviderIds } from "../lib/spend-provider-visibility.js";
import { useLimitsDisplayPrefs } from "../hooks/use-limits-display-prefs.js";
import { ValueRealtimeEvidence } from "../components/ValueRealtimeEvidence";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";
import "./value-realtime-pages.css";

const RANGES = ["today", "7d", "month", "30d"];
const TABS = ["composition", "trend", "children", "requests"];
const COMPONENTS = [
  ["input_tokens", "realtime.input", "blue", "var(--vr-blue)"],
  ["output_tokens", "realtime.output", "teal", "var(--vr-teal)"],
  ["cached_input_tokens", "realtime.cache_read", "violet", "var(--vr-violet)"],
  ["cache_creation_input_tokens", "realtime.cache_write", "amber", "var(--vr-amber)"],
];

function number(metric) {
  const value = metric && typeof metric === "object" ? metric.value : metric;
  return value == null || !Number.isFinite(Number(value)) ? copy("value_realtime.data_unavailable") : Number(value).toLocaleString();
}
function money(metric) { return metric?.value == null ? copy("value_realtime.data_unavailable") : `$${Number(metric.value).toFixed(2)}`; }
function compact(metric) {
  if (metric?.value == null) return copy("value_realtime.data_unavailable");
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(metric.value));
}
function finiteValue(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function stateLabel(state) {
  const key = ["running", "idle", "completed", "interrupted", "error", "waiting_approval", "recent_activity"].includes(state) ? state : "unknown";
  return copy(`realtime.state.${key}`);
}
function historyLabel(agent) {
  if (agent.history_state !== "installed_no_history") return copy("realtime.history.six_month");
  return agent.source === "trae" ? copy("realtime.history.authorization_pending") : copy("realtime.history.installed");
}
function historyDetail(agent) {
  if (agent.history_state !== "installed_no_history") return copy("realtime.history.six_month");
  return agent.source === "trae" ? copy("realtime.history.trae_pending_detail") : copy("realtime.history.no_usage_metric");
}
function missingHistoryMetric(agent) {
  return agent.source === "trae" ? copy("realtime.history.trae_pending_metric") : copy("realtime.history.no_usage_metric");
}
function formatTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : copy("value_realtime.data_unavailable");
}
function formatDuration(metric) {
  const value = Number(metric?.value);
  if (!Number.isFinite(value) || value < 0) return copy("value_realtime.data_unavailable");
  const minutes = Math.round(value);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return copy("realtime.duration.minutes", { minutes });
  return remainder
    ? copy("realtime.duration.hours_minutes", { hours, minutes: remainder })
    : copy("realtime.duration.hours", { hours });
}
function taskText(session) {
  const label = typeof session?.task_label === "string" ? session.task_label.trim() : "";
  return label || copy("realtime.task.current_session", { agent: session?.agent_label || session?.source || "Agent" });
}
function nativeMetrics(agent, resources) {
  if (agent.source !== "workbuddy") {
    return resources.map((resource) => `${resource.label || resource.unit} · ${resource.value == null ? copy("value_realtime.data_unavailable") : `${compact({ value: resource.value })} ${resource.unit}`}`);
  }
  const unit = copy("realtime.points");
  const parts = resources.map((resource) => {
    const rawLabel = String(resource.label || "").trim();
    const label = /credits?/i.test(rawLabel)
      ? ""
      : rawLabel.toLowerCase() === "remaining"
        ? copy("realtime.workbuddy.remaining")
        : rawLabel.toLowerCase() === "today_consumed"
          ? copy("realtime.workbuddy.today_consumed")
          : rawLabel;
    const value = resource.value == null ? copy("value_realtime.data_unavailable") : compact({ value: resource.value });
    return [label, value].filter(Boolean).join(" ");
  });
  return parts;
}
function providerTone(value) { return value === "running" ? "rt-provider-avatar--green" : "rt-provider-avatar--orange"; }
function sourceId(value) { return normalizeVisibleProviderIds([value])[0] || ""; }

function focusSession(sessions) {
  return [...sessions].sort((left, right) => {
    const running = Number(right?.state === "running") - Number(left?.state === "running");
    const activity = Date.parse(right?.last_activity_at || 0) - Date.parse(left?.last_activity_at || 0);
    const tokens = Number(right?.total_tokens?.value || 0) - Number(left?.total_tokens?.value || 0);
    return running || activity || tokens;
  })[0];
}

function FocusSparkline({ points }) {
  const canvasRef = useRef(null);
  const series = useMemo(() => (Array.isArray(points) ? points : [])
    .map((point) => ({ observedAt: point?.observed_at, value: finiteValue(point?.total_tokens) }))
    .filter((point) => point.observedAt && point.value !== null)
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt)), [points]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !series.length) return undefined;
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
      canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);
      const values = series.map((point) => point.value);
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      const range = Math.max(1, maximum - minimum);
      const coordinates = series.map((point, index) => ({
        x: series.length === 1 ? bounds.width / 2 : index * bounds.width / (series.length - 1),
        y: bounds.height - 4 - (point.value - minimum) / range * (bounds.height - 10),
      }));
      const blue = window.getComputedStyle(canvas).getPropertyValue("--vr-blue").trim() || "royalblue";
      context.beginPath();
      coordinates.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.strokeStyle = blue;
      context.lineWidth = 2.2;
      context.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [series]);
  if (!series.length) return React.createElement("div", { className: "rt-focus-sparkline-empty" }, copy("realtime.task_trend.unavailable"));
  return <canvas
    ref={canvasRef}
    className="rt-focus-sparkline"
    data-testid="focus-sparkline"
    data-point-count={series.length}
    data-series-signature={series.map((point) => point.value).join(",")}
    aria-label={copy("realtime.trend")}
  />;
}

function Kpi({ icon: Icon, tone, title, value, delta }) {
  return <section className="vr-card rt-kpi"><div className={`rt-kpi-icon rt-kpi-icon--${tone}`}><Icon size={31} /></div><div><div className="rt-kpi-label">{title}</div><div className="rt-kpi-value">{value}</div><div className="rt-kpi-change">{delta == null ? copy("realtime.current_range") : <>{copy("realtime.changed")}<strong>{`${delta > 0 ? "+" : ""}${delta.toLocaleString()}`}</strong></>}</div></div></section>;
}

function SessionStrip({ agents, selectedSource, onSelect }) {
  const [offset, setOffset] = useState(0);
  const pageSize = 5;
  const selectedIndex = agents.findIndex((agent) => sourceId(agent?.source) === selectedSource);
  const offsetContainsSelection = agents.length && Array.from({ length: Math.min(pageSize, agents.length) }, (_unused, index) => (
    sourceId(agents[(offset + index) % agents.length]?.source) === selectedSource
  )).some(Boolean);
  const visibleOffset = selectedIndex >= 0 && !offsetContainsSelection ? selectedIndex : offset;
  const visible = agents.length ? Array.from({ length: Math.min(pageSize, agents.length) }, function visibleAgent(_unused, index) {
    return agents[(visibleOffset + index) % agents.length];
  }) : [];
  const hasMore = agents.length !== visible.length;
  function move(delta) {
    if (!agents.length) return;
    const nextOffset = (visibleOffset + delta + agents.length) % agents.length;
    const nextVisible = Array.from({ length: Math.min(pageSize, agents.length) }, (_unused, index) => agents[(nextOffset + index) % agents.length]);
    setOffset(nextOffset);
    if (!nextVisible.some((agent) => sourceId(agent?.source) === selectedSource)) {
      onSelect(sourceId(nextVisible[0]?.source));
    }
  }
  return <section className="rt-session-strip" aria-label={copy("realtime.other")}>
    <div className="rt-session-viewport">
    {agents.length ? visible.map((agent) => {
      const agentSource = sourceId(agent.source);
      const selected = agentSource === selectedSource;
      const native = (agent.native_resources || []).filter(Boolean);
      const metrics = native.length
        ? nativeMetrics(agent, native)
        : agent.total_tokens?.value != null
          ? [compact(agent.total_tokens), money(agent.api_equivalent_usd)]
          : [missingHistoryMetric(agent)];
      return <button type="button" key={agent.source} className="vr-card rt-session-mini tt-pressable tt-product-focusable" aria-pressed={selected} onClick={() => onSelect(agentSource)}>
        <div className="rt-mini-head"><div className="rt-mini-name" title={agent.agent_label || agent.source}><i className={`rt-provider-avatar ${providerTone(agent.runtime_state)}`}><ProviderIcon provider={agent.source} size={14} /></i><span>{agent.agent_label || agent.source}</span></div><span className={`rt-mini-state${agent.runtime_state === "running" ? " rt-mini-state--running" : " rt-mini-state--idle"}`} title={historyDetail(agent)}>{stateLabel(agent.runtime_state)}</span></div>
        <div className={`rt-mini-data${agent.source === "workbuddy" ? " rt-mini-data--workbuddy" : ""}`} title={metrics.join(" · ")}>{metrics.map((metric) => <span key={metric}>{metric}</span>)}</div>
      </button>;
    }) : <div className="vr-empty">{copy("realtime.empty")}</div>}</div>
    {hasMore ? <div className="rt-session-controls">
      <button type="button" className="rt-session-nav rt-session-previous tt-pressable tt-product-focusable" aria-label={copy("realtime.agent.previous")} onClick={() => move(-1)}><ChevronLeft size={18} /></button>
      <button type="button" className="rt-session-nav rt-session-next tt-pressable tt-product-focusable" aria-label={copy("realtime.agent.next")} onClick={() => move(1)}><ChevronRight size={18} /></button>
    </div> : null}
  </section>;
}

function filterActivityPoints(points, windowKey) {
  const ordered = Array.isArray(points) ? points : [];
  if (!ordered.length || windowKey === "all") return ordered;
  const latest = Date.parse(ordered.at(-1)?.observed_at || "");
  const hours = windowKey === "1h" ? 1 : 4;
  const filtered = ordered.filter((point) => Date.parse(point.observed_at || "") >= latest - hours * 60 * 60 * 1000);
  return filtered.length > 1 ? filtered : ordered.slice(-Math.min(2, ordered.length));
}

function RealtimeLineChart({ points, showLegend = true }) {
  const [windowKey, setWindowKey] = useState("1h");
  const canvasRef = useRef(null);
  const visible = useMemo(() => filterActivityPoints(points, windowKey), [points, windowKey]);
  const knownPoints = visible
    .map((point, index) => ({ point, index, value: finiteValue(point.total_tokens) }))
    .filter((item) => item.value !== null);
  const maximum = Math.max(1, ...knownPoints.map((item) => item.value));
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
      canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const width = bounds.width;
      const height = bounds.height;
      const styles = window.getComputedStyle(canvas);
      const blue = styles.getPropertyValue("--vr-blue").trim();
      const grid = styles.getPropertyValue("--vr-line").trim();
      context.clearRect(0, 0, width, height);
      context.strokeStyle = grid;
      context.lineWidth = 1;
      for (let row = 0; row < 4; row += 1) { const y = 8 + row * (height - 16) / 3; context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
      if (!knownPoints.length) return;
      const pointsToDraw = knownPoints.map(({ index, value }) => ({ x: visible.length === 1 ? width / 2 : index * width / (visible.length - 1), y: height - 5 - value / maximum * (height - 16) }));
      context.beginPath(); pointsToDraw.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.lineTo(pointsToDraw.at(-1).x, height); context.lineTo(pointsToDraw[0].x, height); context.closePath();
      context.globalAlpha = .16; context.fillStyle = blue; context.fill(); context.globalAlpha = 1;
      context.beginPath(); pointsToDraw.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.strokeStyle = blue; context.lineWidth = 2.4; context.stroke();
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); return () => observer.disconnect();
  }, [maximum, visible]);
  const labels = [maximum, maximum * .75, maximum / 2, maximum * .25, 0];
  return <div className={`rt-line-view${showLegend ? "" : " rt-line-view--composition"}`}><div className="rt-chart-top"><span>{copy("realtime.trend")}</span><label className="rt-chart-window"><select aria-label={copy("realtime.chart.window")} value={windowKey} onChange={(event) => setWindowKey(event.target.value)}><option value="1h">{copy("realtime.chart.window.1h")}</option><option value="4h">{copy("realtime.chart.window.4h")}</option><option value="all">{copy("realtime.chart.window.all")}</option></select><ChevronDown size={13} /></label></div><div className="rt-live-chart"><div className="rt-live-y">{labels.map((label) => <span key={label}>{compact({ value: label })}</span>)}</div><div className="rt-live-plot"><canvas ref={canvasRef} aria-label={copy("realtime.trend")} /></div></div><div className="rt-live-x"><span>{formatTime(visible[0]?.observed_at)}</span><span>{formatTime(visible.at(-1)?.observed_at)}</span></div>{showLegend ? <div className="rt-live-legend"><i className="vr-dot vr-tone--blue" />{copy("realtime.tokens.short")}</div> : null}</div>;
}

function CompositionTab({ focus, points, evidence, rangeFrom, rangeTo }) {
  const rows = COMPONENTS.map(([key, label, tone, color]) => ({ key, label, tone, color, value: finiteValue(focus?.[key]?.value) }));
  const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const stops = rows.reduce((parts, row) => {
    const start = parts.offset;
    const end = start + (total ? (row.value ?? 0) / total * 100 : 0);
    parts.stops.push(`${row.color} ${start}% ${end}%`);
    parts.offset = end;
    return parts;
  }, { offset: 0, stops: [] });
  return <><div className="rt-composition-view">
    <div className="rt-donut-wrap"><div className="rt-donut" style={total ? { background: `conic-gradient(${stops.stops.join(", ")})` } : undefined}><span className="rt-donut-center">{copy("realtime.tokens.short")}<strong>{compact(focus?.total_tokens)}</strong></span></div>
      <div className="rt-breakdown">{rows.map((row) => <div className="rt-breakdown-row" key={row.key}><span><i className={`vr-dot vr-tone--${row.tone}`} />{copy(row.label)}</span><strong>{compact({ value: row.value })}</strong><em>{total && row.value !== null ? `${(row.value / total * 100).toFixed(1)}%` : copy("value_realtime.share_unavailable")}</em></div>)}</div>
    </div>
    <RealtimeLineChart points={points} showLegend={false} />
  </div><footer className="rt-composition-foot"><div className="rt-composition-foot-meta"><span>{copy("realtime.data_range")}</span><i /> <span data-testid="realtime-range-window">{rangeFrom && rangeTo ? `${rangeFrom} 至 ${rangeTo}` : `${formatTime(evidence?.observed_from)} 至 ${formatTime(evidence?.observed_to)}`}</span></div><span className="rt-composition-legend"><i className="vr-dot vr-tone--blue" />{copy("realtime.tokens.short")}</span></footer></>;
}

function TrendTab({ points }) {
  return <RealtimeLineChart points={points} />;
}

function TreeTab({ tree }) {
  const nodes = tree.filter(function withChildren(node) { return node.children?.length; });
  return <div className="rt-list-view">{nodes.length ? nodes.map(function renderTreeNode(node) { return <div className="rt-request-row" key={node.session_id}><strong>{node.agent_label || node.source}</strong><span>{copy("realtime.sub_agents")} {node.children.length}</span><span>{compact(node.total_tokens)}</span></div>; }) : copy("realtime.tree.empty")}</div>;
}

function RequestsTab({ requests }) {
  return <div className="rt-list-view">{requests.length ? requests.slice(0, 8).map((request) => <div className="rt-request-row" key={request.record_ref}><strong>{request.source}</strong><span>{request.record_ref}</span><span>{formatTime(request.observed_at)}</span><span>{request.total_tokens?.value == null ? copy("value_realtime.data_unavailable") : copy("realtime.tokens_with_unit", { value: request.total_tokens.value.toLocaleString() })}</span><span>{money(request.api_equivalent_usd)}</span></div>) : copy("realtime.requests.empty")}</div>;
}

function SidePanels({ data, stateCounts }) {
  const [showUncovered, setShowUncovered] = useState(false);
  const all = data.sessions || [];
  const exact = all.filter(function isExact(session) { return session.total_tokens?.evidence_state === "exact"; }).length;
  const estimated = all.filter(function isEstimated(session) { return session.api_equivalent_usd?.evidence_state === "estimated"; }).length;
  const coverage = data.pricing_coverage || { covered_models: 0, total_models: 0, percent: 0, uncovered_models: [] };
  return <aside className="rt-side">
    <details className="vr-card rt-side-card" open><summary className="tt-pressable tt-product-focusable">{copy("realtime.status")} <Info size={15} className="ml-2 text-slate-400" /></summary><div className="rt-side-content rt-status-grid">
      <span><i className="rt-status-dot rt-status-dot--exact" />{copy("realtime.status.exact")}<strong>{copy("realtime.count_unit", { count: exact })}</strong></span>
      <span><i className="rt-status-dot rt-status-dot--estimated" />{copy("realtime.status.estimated")}<strong>{copy("realtime.count_unit", { count: estimated })}</strong></span>
      <span><i className="rt-status-dot rt-status-dot--cached" />{copy("realtime.status.observed")}<strong>{copy("realtime.count_unit", { count: all.filter((session) => session.state !== "running").length })}</strong></span>
    </div></details>
    <details className="vr-card rt-side-card" open><summary className="tt-pressable tt-product-focusable">{copy("realtime.coverage")}</summary>{showUncovered ? <div className="rt-side-content rt-uncovered"><button type="button" onClick={() => setShowUncovered(false)}>{copy("realtime.coverage.back")}</button>{coverage.uncovered_models.length ? coverage.uncovered_models.map((model) => <span key={model}>{model}</span>) : <p>{copy("realtime.coverage.full")}</p>}</div> : <div className="rt-side-content rt-coverage"><div className="rt-coverage-ring" style={{ "--coverage": `${coverage.percent}%` }}><strong>{coverage.percent}%<small>{copy("realtime.coverage.in_progress")}</small></strong></div><p><span>{copy("realtime.covered_models")}</span><strong>{coverage.covered_models} / {coverage.total_models}</strong><button type="button" onClick={() => setShowUncovered(true)}>{copy("realtime.coverage.uncovered")} <ChevronRight size={14} /></button></p></div>}</details>
    <ValueRealtimeEvidence evidence={data.summary?.realtime_tokens?.evidence} className="vr-card rt-side-card" />
  </aside>;
}

export function RealtimeSessionsPage() {
  const { visibleOrdered } = useLimitsDisplayPrefs();
  const [period, setPeriod] = useState({ range: "today", month: "" });
  const { range, month } = period;
  const [data, setData] = useState(() => peekRealtimeSessions("today"));
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("composition");
  const [selectedSource, setSelectedSource] = useState("");
  const previousSummary = useRef(null);
  const latestSummary = useRef(null);
  const controllerRef = useRef(null);
  const load = useCallback(async (manual = false, replaceInFlight = false) => {
    if (controllerRef.current && !replaceInFlight) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestedMonth = range === "month" ? month || undefined : undefined;
    const cached = peekRealtimeSessions(range, requestedMonth);
    if (!manual && cached) setData(cached);
    setRefreshing(manual);
    setError(false);
    try {
      const next = await getRealtimeSessions(range, controller.signal, requestedMonth);
      if (!controller.signal.aborted) {
        previousSummary.current = latestSummary.current;
        latestSummary.current = next?.summary || null;
        setData(next);
      }
    } catch (reason) {
      if (reason?.name !== "AbortError") setError(true);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        if (!controller.signal.aborted) setRefreshing(false);
      }
    }
  }, [range, month]);
  useEffect(() => { load(false, true); return () => controllerRef.current?.abort(); }, [load]);
  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible" && document.hasFocus()) load(); };
    const id = window.setInterval(refreshVisible, 15_000);
    document.addEventListener("visibilitychange", refreshVisible); window.addEventListener("focus", refreshVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", refreshVisible); window.removeEventListener("focus", refreshVisible); };
  }, [load]);

  const sessions = data?.sessions || [];
  const visibleAgentIds = new Set(normalizeVisibleProviderIds(visibleOrdered));
  const agentHistory = (data?.agent_history || []).filter((agent) => {
    return visibleAgentIds.has(sourceId(agent?.source));
  });
  const visibleSessions = sessions.filter((session) => visibleAgentIds.has(sourceId(session?.source)));
  const preferredFocus = focusSession(visibleSessions);
  const selectableSources = agentHistory.map((agent) => sourceId(agent?.source)).filter(Boolean);
  const preferredSource = sourceId(preferredFocus?.source);
  const activeSource = selectableSources.includes(selectedSource)
    ? selectedSource
    : selectableSources.includes(preferredSource)
      ? preferredSource
      : selectableSources[0] || "";
  const focus = focusSession(visibleSessions.filter((session) => sourceId(session?.source) === activeSource));
  const monthOptions = data?.month_options?.length ? data.month_options : data?.available_months || [];
  const selectedMonth = range === "month" && month ? month : data?.data_month || monthOptions[0] || "";
  const changePeriod = (nextRange, nextMonth = month) => {
    const requestedMonth = nextRange === "month" ? nextMonth || undefined : undefined;
    setData(peekRealtimeSessions(nextRange, requestedMonth) || null);
    setError(false);
    setPeriod({ range: nextRange, month: nextMonth });
  };
  const stateCounts = useMemo(() => sessions.reduce((counts, session) => ({ ...counts, [session.state]: (counts[session.state] || 0) + 1 }), {}), [sessions]);
  function delta(key) { return data?.summary?.[key]?.value != null && previousSummary.current?.[key]?.value != null ? data.summary[key].value - previousSummary.current[key].value : null; }
  const focusUsesAgentDay = focus?.total_tokens?.value == null && focus?.agent_day_usage?.total_tokens?.value != null;
  const focusUsage = focusUsesAgentDay ? focus.agent_day_usage : focus;
  const focusPoints = Array.isArray(focus?.activity_points) && focus.activity_points.length
    ? focus.activity_points
    : focusUsesAgentDay ? focus.agent_day_activity_points || [] : [];
  const focusForAnalysis = focusUsesAgentDay ? { ...focus, ...focusUsage, activity_points: focusPoints } : focus;
  const selectedAgent = agentHistory.find((agent) => sourceId(agent?.source) === activeSource);
  const selectedRuntimeState = selectedAgent?.runtime_state || focus?.state;
  const selectedSummary = selectedAgent ? {
    active_agents: { value: selectedRuntimeState === "running" ? 1 : 0 },
    realtime_tokens: focusUsage?.total_tokens,
    api_equivalent_value: focusUsage?.api_equivalent_usd,
  } : data?.summary;
  const focusSessionRef = focus?.session_id ? `session:${focus.session_id}` : null;
  const focusRequests = focusSessionRef
    ? (data?.requests || []).filter((request) => request?.session_ref === focusSessionRef)
    : [];
  const focusTree = focus?.session_id
    ? (data?.session_tree || []).filter((node) => node?.session_id === focus.session_id)
    : [];

  return <main className="vr-page vr-page--realtime flex flex-1 flex-col px-5 py-7 dark:bg-oai-gray-950 dark:text-oai-white">
    <header className="vr-head"><div><h1>{copy("realtime.page.title")}</h1><p>{copy("realtime.page.subtitle")} <Info size={15} className="inline" /></p></div><div className="rt-head-actions">
      <label className="rt-range"><CalendarDays size={18} /><select aria-label={copy("realtime.range.select")} value={range} onChange={(event) => changePeriod(event.target.value, event.target.value === "month" ? month || selectedMonth : month)}>{RANGES.map((item) => <option key={item} value={item}>{copy(`realtime.range.${item}`)}</option>)}</select><ChevronDown size={15} /></label>
      <label className="rt-range rt-month-range"><select aria-label={copy("realtime.month.select")} value={selectedMonth} onChange={(event) => changePeriod("month", event.target.value)}>{monthOptions.map((item) => <option key={item} value={item}>{item.replace("-", "年")}月</option>)}</select><ChevronDown size={15} /></label>
      <button type="button" className="rt-refresh" onClick={() => load(true, true)}><i className="rt-updated-dot" />{refreshing ? copy("realtime.refreshing") : `${copy("realtime.updated")} ${formatTime(data?.observed_at)}`}<RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /></button>
    </div></header>
    {error ? <div className="vr-alert" role="alert">{copy("realtime.error")}</div> : null}
    {!data && !error ? <div className="vr-loading">{copy("realtime.loading")}</div> : null}
    {data ? <>
      <section className="rt-kpis"><Kpi icon={Users} tone="blue" title={copy("realtime.active_agents")} value={number(selectedSummary?.active_agents)} delta={selectedAgent ? null : delta("active_agents")} /><Kpi icon={Boxes} tone="violet" title={copy("realtime.tokens")} value={compact(selectedSummary?.realtime_tokens)} delta={selectedAgent ? null : delta("realtime_tokens")} /><Kpi icon={CircleDollarSign} tone="green" title={copy("realtime.equivalent")} value={money(selectedSummary?.api_equivalent_value)} delta={selectedAgent ? null : delta("api_equivalent_value")} /></section>
      {focus ? <section className="vr-card rt-focus tt-pressable-group"><div className="rt-focus-top">
        <div><div className="rt-agent-title"><i className="rt-agent-cube"><ProviderIcon provider={focus.source} size={21} /></i>{focus.agent_label || focus.source}{focus.state === "running" ? <span className="rt-status-pill">{stateLabel(focus.state)}</span> : null}</div><div className="rt-focus-task-label">{copy("realtime.current_task")}</div><div className="rt-focus-task">{taskText(focus)}</div><FocusSparkline points={focusPoints} /></div>
        <div className="rt-focus-metric"><div className="rt-focus-metric-label">{focusUsesAgentDay ? copy("realtime.agent_today_total") : copy("realtime.tokens")}</div><div className="rt-focus-metric-value">{compact(focusUsage?.total_tokens)}</div><div className="rt-focus-metric-sub">{copy("realtime.input")} {compact(focusUsage?.input_tokens)} · {copy("realtime.output")} {compact(focusUsage?.output_tokens)}</div></div>
        <div className="rt-focus-metric"><div className="rt-focus-metric-label">{copy("realtime.equivalent")}</div><div className="rt-focus-metric-value">{money(focusUsage?.api_equivalent_usd)}</div><div className="rt-focus-metric-sub">{focusUsesAgentDay ? copy("realtime.agent_today_total") : copy("realtime.billing_safe")}</div></div>
        <div className="rt-focus-metric rt-focus-metric--blue"><div className="rt-focus-metric-label">{copy("realtime.current_range")}</div><div className="rt-focus-metric-value">{copy("realtime.current_range_value")}</div></div>
      </div><div className="rt-focus-footer"><div><span>{copy("realtime.requests")}</span><strong>{number(focusUsage?.request_count)}</strong></div><div><span>{copy("realtime.sub_agents")}</span><strong>{focusTree[0]?.children?.length || 0}</strong></div><div><span>{copy("realtime.duration")}</span><strong>{formatDuration(focus.duration_minutes)}</strong></div><div><span>{copy("realtime.model")}</span><strong>{focus.model || copy("value_realtime.data_unavailable")}</strong></div><div><span>{copy("realtime.billing")}</span><strong>{copy("realtime.billing_safe")}</strong></div></div></section> : <section className="vr-empty mt-4">{copy("realtime.empty")}</section>}
      {agentHistory.length ? <SessionStrip agents={agentHistory} selectedSource={activeSource} onSelect={setSelectedSource} /> : null}
      <section className="rt-workspace"><div className="vr-card rt-analysis"><div className="rt-tabs" role="tablist">{TABS.map((item) => <button type="button" key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{copy(`realtime.tabs.${item}`)}</button>)}</div><div className="rt-analysis-body">{!focus ? <div className="vr-empty">{copy("realtime.empty")}</div> : <>{tab === "composition" ? <CompositionTab focus={focusForAnalysis} points={focusPoints} evidence={focusUsage?.total_tokens?.evidence || focus?.evidence || data.summary?.realtime_tokens?.evidence} rangeFrom={data.range_from} rangeTo={data.range_to} /> : null}{tab === "trend" ? <TrendTab points={focusPoints} /> : null}{tab === "children" ? <TreeTab tree={focusTree} /> : null}{tab === "requests" ? <RequestsTab requests={focusRequests} /> : null}</>}</div></div><SidePanels data={data} stateCounts={stateCounts} /></section>
    </> : null}
  </main>;
}
