import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Info, RefreshCw, Users,
} from "lucide-react";
import { copy, getCopyLocale } from "../lib/copy";
import { getRealtimeSessions, peekRealtimeSessions, triggerLocalSync } from "../lib/api";
import { isLocalDashboardRuntime } from "../lib/local-api-url";
import { normalizeVisibleProviderIds } from "../lib/spend-provider-visibility.js";
import { useLimitsDisplayPrefs } from "../hooks/use-limits-display-prefs.js";
import { ValueRealtimeEvidence } from "../components/ValueRealtimeEvidence";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";
import "./value-realtime-pages.css";
import { activitySegments } from "../lib/realtime-chart";
import { useCurrency } from "../hooks/useCurrency.js";
import { formatUsdCurrency } from "../lib/format";

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
  return value == null || !Number.isFinite(Number(value)) ? copy("value_realtime.data_unavailable") : Number(value).toLocaleString(getCopyLocale());
}
function Money({ metric }) {
  const { currency, rate } = useCurrency();
  return metric?.value == null ? copy("value_realtime.data_unavailable") : formatUsdCurrency(metric.value, { currency, rate });
}
function compact(metric) {
  if (metric?.value == null) return copy("value_realtime.data_unavailable");
  return new Intl.NumberFormat(getCopyLocale(), { notation: "compact", maximumFractionDigits: 1 }).format(Number(metric.value));
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
function historyDetail(agent, month) {
  if (agent.history_state !== "installed_no_history") return copy("realtime.history.month_total", { month: month || "—" });
  return agent.source === "trae" ? copy("realtime.history.trae_pending_detail") : copy("realtime.history.no_usage_metric");
}
function missingHistoryMetric(agent) {
  return agent.source === "trae" ? copy("realtime.history.trae_pending_metric") : copy("realtime.history.no_usage_metric");
}
function formatTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString(getCopyLocale(), { hour: "2-digit", minute: "2-digit" }) : copy("value_realtime.data_unavailable");
}
function formatActivityTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return copy("value_realtime.data_unavailable");
  const day = date.toLocaleDateString(getCopyLocale());
  return `${day} ${formatTime(value)}`;
}
function formatDuration(metric) {
  if (metric?.value == null) return copy("value_realtime.data_unavailable");
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
    const root = Number(Boolean(left?.parent_session_id)) - Number(Boolean(right?.parent_session_id));
    const activity = Date.parse(right?.last_activity_at || 0) - Date.parse(left?.last_activity_at || 0);
    const tokens = Number(right?.total_tokens?.value || 0) - Number(left?.total_tokens?.value || 0);
    return running || root || activity || tokens;
  })[0];
}

function FocusSparkline({ points }) {
  const canvasRef = useRef(null);
  const segments = useMemo(() => activitySegments(points), [points]);
  const series = segments.flat();
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
      const blue = window.getComputedStyle(canvas).getPropertyValue("--vr-blue").trim() || "royalblue";
      context.strokeStyle = blue;
      context.fillStyle = blue;
      context.lineWidth = 2.2;
      for (const segment of segments) {
        const coordinates = segment.map(point => ({ x: point.x * bounds.width, y: bounds.height - 4 - (point.value - minimum) / range * (bounds.height - 10) }));
        context.beginPath();
        coordinates.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
        context.stroke();
        if (coordinates.length === 1) context.fillRect(coordinates[0].x - 2, coordinates[0].y - 2, 4, 4);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [segments]);
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

function SessionStrip({ agents, selectedSource, onSelect, historyMonth }) {
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
          ? [compact(agent.total_tokens), React.createElement(Money, { key: "cost", metric: agent.api_equivalent_usd })]
          : [missingHistoryMetric(agent)];
      return <button type="button" key={agent.source} className="vr-card rt-session-mini tt-pressable tt-product-focusable" aria-pressed={selected} onClick={() => onSelect(agentSource)}>
        <div className="rt-mini-head"><div className="rt-mini-name" title={agent.agent_label || agent.source}><i className={`rt-provider-avatar ${providerTone(agent.runtime_state)}`}><ProviderIcon provider={agent.source} size={14} /></i><span>{agent.agent_label || agent.source}</span></div><span className={`rt-mini-state${agent.runtime_state === "running" ? " rt-mini-state--running" : " rt-mini-state--idle"}`} title={historyDetail(agent, historyMonth)}>{stateLabel(agent.runtime_state)}</span></div>
        <div className={`rt-mini-data${agent.source === "workbuddy" ? " rt-mini-data--workbuddy" : ""}`} title={native.length ? metrics.join(" · ") : undefined}>{metrics.map((metric, index) => <span key={index}>{metric}</span>)}</div>
        <div className="rt-mini-scope">{copy(native.length ? "realtime.history.account_snapshot" : "realtime.history.month_total", { month: historyMonth || "—" })}</div>
      </button>;
    }) : <div className="vr-empty">{copy("realtime.empty")}</div>}</div>
    {hasMore ? <div className="rt-session-controls">
      <button type="button" className="rt-session-nav rt-session-previous tt-pressable tt-product-focusable" aria-label={copy("realtime.agent.previous")} onClick={() => move(-1)}><ChevronLeft size={18} /></button>
      <button type="button" className="rt-session-nav rt-session-next tt-pressable tt-product-focusable" aria-label={copy("realtime.agent.next")} onClick={() => move(1)}><ChevronRight size={18} /></button>
    </div> : null}
  </section>;
}

function filterActivityPoints(points, windowKey) {
  const ordered = (Array.isArray(points) ? points : []).filter(point => Number.isFinite(Date.parse(point?.observed_at))).slice().sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  if (!ordered.length || windowKey === "all") return ordered;
  const latest = Date.parse(ordered.at(-1)?.observed_at || "");
  const hours = windowKey === "1h" ? 1 : 4;
  const filtered = ordered.filter((point) => Date.parse(point.observed_at || "") >= latest - hours * 60 * 60 * 1000);
  return filtered;
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
      for (const segment of activitySegments(visible)) {
        const pointsToDraw = segment.map(({ x, value }) => ({ x: x * width, y: height - 5 - value / maximum * (height - 16) }));
        context.beginPath(); pointsToDraw.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.lineTo(pointsToDraw.at(-1).x, height); context.lineTo(pointsToDraw[0].x, height); context.closePath();
        context.globalAlpha = .16; context.fillStyle = blue; context.fill(); context.globalAlpha = 1;
        context.beginPath(); pointsToDraw.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.strokeStyle = blue; context.lineWidth = 2.4; context.stroke();
        if (pointsToDraw.length === 1) context.fillRect(pointsToDraw[0].x - 2, pointsToDraw[0].y - 2, 4, 4);
      }
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); return () => observer.disconnect();
  }, [maximum, visible]);
  const labels = [maximum, maximum * .75, maximum / 2, maximum * .25, 0];
  return <div className={`rt-line-view${showLegend ? "" : " rt-line-view--composition"}`}><div className="rt-chart-top"><span>{copy("realtime.trend")}</span><label className="rt-chart-window"><select aria-label={copy("realtime.chart.window")} value={windowKey} onChange={(event) => setWindowKey(event.target.value)}><option value="1h">{copy("realtime.chart.window.1h")}</option><option value="4h">{copy("realtime.chart.window.4h")}</option><option value="all">{copy("realtime.chart.window.all")}</option></select><ChevronDown size={13} /></label></div><div className="rt-live-chart"><div className="rt-live-y">{labels.map((label) => <span key={label}>{compact({ value: label })}</span>)}</div><div className="rt-live-plot"><canvas ref={canvasRef} aria-label={copy("realtime.trend")} /></div></div><div className="rt-live-x"><span>{formatActivityTime(visible[0]?.observed_at)}</span><span>{formatActivityTime(visible.at(-1)?.observed_at)}</span></div>{showLegend ? <div className="rt-live-legend"><i className="vr-dot vr-tone--blue" />{copy("realtime.tokens.short")}</div> : null}</div>;
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
  </div><footer className="rt-composition-foot"><div className="rt-composition-foot-meta"><span>{copy(focus?.session_id ? "realtime.data_range" : "realtime.data_range.agent")}</span><i /> <span data-testid="realtime-range-window">{rangeFrom && rangeTo ? copy("realtime.range.between", { from: rangeFrom, to: rangeTo }) : copy("realtime.range.between", { from: formatTime(evidence?.observed_from), to: formatTime(evidence?.observed_to) })}</span></div><span className="rt-composition-legend"><i className="vr-dot vr-tone--blue" />{copy("realtime.tokens.short")}</span></footer></>;
}

function TrendTab({ points }) {
  return <RealtimeLineChart points={points} />;
}

function TreeTab({ tree }) {
  const nodes = tree.filter(function withChildren(node) { return node.children?.length; });
  function renderNode(node) {
    return <li key={node.session_id}><div className="rt-request-row"><strong>{node.agent_label || node.source}</strong><span title={taskText(node)}>{taskText(node)}</span><span>{stateLabel(node.state)}</span><span>{compact(node.total_tokens)}</span><span>{formatActivityTime(node.last_activity_at)}</span></div>{node.children?.length ? <ul>{node.children.map(renderNode)}</ul> : null}</li>;
  }
  return <div className="rt-list-view">{nodes.length ? <ul className="rt-session-tree">{nodes.map(renderNode)}</ul> : copy("realtime.tree.empty")}</div>;
}

function RequestsTab({ requests }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(requests.length / 25));
  const current = Math.min(page, pageCount - 1);
  const hasMultiplePages = pageCount !== 1;
  return <div className="rt-list-view">
    {hasMultiplePages ? <nav className="rt-usage-pagination" aria-label={copy("realtime.pagination.label")}>
      <span>{copy("realtime.pagination.status", { current: current + 1, pages: pageCount, count: requests.length })}</span>
      <button type="button" className="tt-raised-control tt-pressable" disabled={current === 0} onClick={() => setPage(current - 1)}>{copy("realtime.pagination.previous")}</button>
      <button type="button" className="tt-raised-control tt-pressable" disabled={current === pageCount - 1} onClick={() => setPage(current + 1)}>{copy("realtime.pagination.next")}</button>
    </nav> : null}
    {requests.length ? requests.slice(current * 25, (current + 1) * 25).map((request) => <div className="rt-request-row" key={request.record_ref}><strong>{request.source}</strong><span title={request.model || request.record_ref}>{copy(request.range_included === false ? "realtime.record.included" : request.record_kind === "aggregate_bucket" ? "realtime.record.aggregate" : "realtime.record.request")}</span><span>{formatActivityTime(request.observed_at)}</span><span>{request.total_tokens?.value == null ? copy("value_realtime.data_unavailable") : copy("realtime.tokens_with_unit", { value: request.total_tokens.value.toLocaleString() })}</span><span>{<Money metric={request.api_equivalent_usd} />}</span></div>) : copy("realtime.requests.empty")}
  </div>;
}

function SidePanels({ data, stateCounts }) {
  const [showUncovered, setShowUncovered] = useState(false);
  const all = data.sessions || [];
  const exact = all.filter(function isExact(session) { return session.total_tokens?.evidence_state === "exact"; }).length;
  const estimated = all.filter(function isEstimated(session) { return session.api_equivalent_usd?.evidence_state === "estimated"; }).length;
  const coverage = data.pricing_coverage || { covered_models: 0, total_models: 0, percent: 0, uncovered_models: [] };
  return <aside className="rt-side">
    <details className="vr-card rt-side-card" open><summary className="tt-pressable tt-product-focusable">{copy("realtime.status")} · {copy("realtime.scope.all_agents")} <Info size={15} className="ml-2 text-slate-400" /></summary><div className="rt-side-content rt-status-grid">
      <span><i className="rt-status-dot rt-status-dot--exact" />{copy("realtime.status.exact")}<strong>{copy("realtime.count_unit", { count: exact })}</strong></span>
      <span><i className="rt-status-dot rt-status-dot--estimated" />{copy("realtime.status.estimated")}<strong>{copy("realtime.count_unit", { count: estimated })}</strong></span>
      <span><i className="rt-status-dot rt-status-dot--cached" />{copy("realtime.status.observed")}<strong>{copy("realtime.count_unit", { count: all.filter((session) => session.state !== "running").length })}</strong></span>
    </div></details>
    <details className="vr-card rt-side-card" open><summary className="tt-pressable tt-product-focusable">{copy("realtime.coverage")} · {copy("realtime.scope.all_agents")}</summary>{showUncovered ? <div className="rt-side-content rt-uncovered"><button type="button" onClick={() => setShowUncovered(false)}>{copy("realtime.coverage.back")}</button>{coverage.uncovered_models.length ? coverage.uncovered_models.map((model) => <span key={model}>{model}</span>) : <p>{copy("realtime.coverage.full")}</p>}</div> : <div className="rt-side-content rt-coverage"><div className="rt-coverage-ring" style={{ "--coverage": `${coverage.percent}%` }}><strong>{coverage.percent}%<small>{copy("realtime.coverage.in_progress")}</small></strong></div><p><span>{copy("realtime.covered_models")}</span><strong>{coverage.covered_models} / {coverage.total_models}</strong><button type="button" onClick={() => setShowUncovered(true)}>{copy("realtime.coverage.uncovered")} <ChevronRight size={14} /></button></p></div>}</details>
    <ValueRealtimeEvidence evidence={data.summary?.realtime_tokens?.evidence} className="vr-card rt-side-card" />
  </aside>;
}

export function RealtimeSessionsPage() {
  const { visibleOrdered } = useLimitsDisplayPrefs();
  const [period, setPeriod] = useState({ range: "today", month: "" });
  const { range, month } = period;
  const [data, setData] = useState(() => peekRealtimeSessions("today"));
  const [error, setError] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("composition");
  const [selectedSource, setSelectedSource] = useState("");
  const previousSummary = useRef(null);
  const latestSummary = useRef(null);
  const controllerRef = useRef(null);
  const entrySyncRef = useRef(null);
  const load = useCallback(async (manual = false, replaceInFlight = false) => {
    if (controllerRef.current && !replaceInFlight) return;
    if (manual) entrySyncRef.current?.abort();
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestedMonth = range === "month" ? month || undefined : undefined;
    const cached = peekRealtimeSessions(range, requestedMonth);
    if (!manual && cached) setData(cached);
    setRefreshing(manual);
    setError(false);
    try {
      if (manual && isLocalDashboardRuntime()) {
        setSyncError(false);
        try { await triggerLocalSync({ signal: controller.signal }); }
        catch (reason) { if (reason?.name !== "AbortError") setSyncError(true); }
        if (controller.signal.aborted) return;
      }
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
    if (!isLocalDashboardRuntime()) return undefined;
    const controller = new AbortController();
    entrySyncRef.current = controller;
    setSyncError(false);
    Promise.resolve(triggerLocalSync({ signal: controller.signal, minIntervalMs: 30_000 }))
      .then((result) => { if (!controller.signal.aborted && result?.ok) load(false, true); })
      .catch((reason) => { if (!controller.signal.aborted && reason?.name !== "AbortError") setSyncError(true); });
    return () => controller.abort();
  }, [load]);
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
  const hasHiddenSources = sessions.length !== visibleSessions.length || (data?.agent_history || []).length !== agentHistory.length;
  const preferredFocus = focusSession(visibleSessions);
  const selectableSources = agentHistory.map((agent) => sourceId(agent?.source)).filter(Boolean);
  const preferredSource = sourceId(preferredFocus?.source);
  const activeSource = selectableSources.includes(selectedSource)
    ? selectedSource
    : selectableSources.includes(preferredSource)
      ? preferredSource
      : selectableSources[0] || "";
  const selectedAgent = agentHistory.find((agent) => sourceId(agent?.source) === activeSource);
  const rangeUsage = data?.agent_range_summary?.find((agent) => sourceId(agent.source) === activeSource);
  const sessionFocus = focusSession(visibleSessions.filter((session) => sourceId(session?.source) === activeSource));
  const focus = sessionFocus || (selectedAgent ? {
    ...rangeUsage,
    source: selectedAgent.source,
    agent_label: selectedAgent.agent_label,
    task_label: copy(rangeUsage ? "realtime.range.aggregate_only" : "realtime.range.no_usage"),
  } : null);
  const monthOptions = data?.month_options?.length ? data.month_options : data?.available_months || [];
  const selectedMonth = range === "month" && month ? month : data?.data_month || monthOptions[0] || "";
  const changePeriod = (nextRange, nextMonth = month) => {
    const requestedMonth = nextRange === "month" ? nextMonth || undefined : undefined;
    setData(peekRealtimeSessions(nextRange, requestedMonth) || null);
    setError(false);
    setPeriod({ range: nextRange, month: nextMonth });
  };
  const stateCounts = useMemo(() => sessions.reduce((counts, session) => ({ ...counts, [session.state]: (counts[session.state] || 0) + 1 }), {}), [sessions]);
  function delta(key) { return !hasHiddenSources && data?.summary?.[key]?.value != null && previousSummary.current?.[key]?.value != null ? data.summary[key].value - previousSummary.current[key].value : null; }
  const focusUsesAgentDay = focus?.total_tokens?.value == null && focus?.agent_day_usage?.total_tokens?.value != null;
  const focusUsage = focusUsesAgentDay ? focus.agent_day_usage : focus;
  const focusPoints = Array.isArray(focus?.activity_points) && focus.activity_points.length
    ? focus.activity_points
    : focusUsesAgentDay ? focus.agent_day_activity_points || [] : [];
  const focusForAnalysis = focusUsesAgentDay ? { ...focus, ...focusUsage, activity_points: focusPoints } : focus;
  const analysisUsage = rangeUsage || focusForAnalysis;
  const analysisPoints = rangeUsage ? rangeUsage.activity_points || [] : focusPoints;
  const selectedRuntimeState = selectedAgent?.runtime_state || focus?.state;
  const selectedSummary = selectedAgent ? {
    active_agents: { value: selectedRuntimeState === "running" ? 1 : ["idle", "completed", "interrupted", "error", "waiting_approval"].includes(selectedRuntimeState) ? 0 : null },
    realtime_tokens: rangeUsage?.total_tokens || focusUsage?.total_tokens,
    api_equivalent_value: rangeUsage?.api_equivalent_usd || focusUsage?.api_equivalent_usd,
  } : hasHiddenSources ? null : data?.summary;
  const focusSessionRef = focus?.session_id ? `session:${focus.session_id}` : null;
  const focusRequests = rangeUsage
    ? (data?.usage_records || []).filter((request) => sourceId(request.source) === activeSource)
    : focusSessionRef
    ? (data?.usage_records || data?.requests || []).filter((request) => request?.session_ref === focusSessionRef)
    : (data?.usage_records || []).filter((request) => sourceId(request.source) === activeSource);
  function containsFocus(node) { return node?.session_id === focus?.session_id || node.children?.some(containsFocus); }
  const focusTree = focus?.session_id
    ? (data?.session_tree || []).filter(containsFocus)
    : [];
  const childCount = focus?.session_id ? focusTree[0]?.children?.length ?? 0 : copy("value_realtime.data_unavailable");

  return <main className="vr-page vr-page--realtime flex flex-1 flex-col px-5 py-7 dark:bg-oai-gray-950 dark:text-oai-white">
    {Object.entries(data?.collection_status || {}).filter(([, state]) => state.status === "error").map(([source, state]) => <p key={source} role="alert">{copy("realtime.collection.error", { source, time: formatActivityTime(state.last_successful_at) })}</p>)}
    <header className="vr-head"><div><h1>{copy("realtime.page.title")}</h1><p>{copy("realtime.page.subtitle")} <Info size={15} className="inline" /></p></div><div className="rt-head-actions">
      <label className="rt-range"><CalendarDays size={18} /><select aria-label={copy("realtime.range.select")} value={range} onChange={(event) => changePeriod(event.target.value, event.target.value === "month" ? month || selectedMonth : month)}>{RANGES.map((item) => <option key={item} value={item}>{copy(`realtime.range.${item}`)}</option>)}</select><ChevronDown size={15} /></label>
      <label className="rt-range rt-month-range"><select aria-label={copy("realtime.month.select")} value={selectedMonth} onChange={(event) => changePeriod("month", event.target.value)}>{monthOptions.map((item) => <option key={item} value={item}>{new Date(`${item}-01T12:00:00`).toLocaleDateString(getCopyLocale(), { year: "numeric", month: "long" })}</option>)}</select><ChevronDown size={15} /></label>
      <button type="button" className="rt-refresh" onClick={() => load(true, true)}><i className="rt-updated-dot" />{refreshing ? copy("realtime.refreshing") : `${copy("realtime.updated")} ${formatTime(data?.summary?.realtime_tokens?.evidence?.observed_to)}`}<RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /></button>
    </div></header>
    {error ? <div className="vr-alert" role="alert">{copy("realtime.error")}</div> : null}
    {syncError ? <div className="vr-alert" role="alert">{copy("realtime.sync_error")}</div> : null}
    {!data && !error ? <div className="vr-loading">{copy("realtime.loading")}</div> : null}
    {data ? <>
      <section className="rt-kpis"><Kpi icon={Users} tone="blue" title={copy("realtime.active_agents")} value={number(selectedSummary?.active_agents)} delta={selectedAgent ? null : delta("active_agents")} /><Kpi icon={Boxes} tone="violet" title={copy("realtime.tokens")} value={<>{compact(selectedSummary?.realtime_tokens)}{["partial", "estimated"].includes(selectedSummary?.realtime_tokens?.evidence_state) ? <small> · {copy(`observability.evidence.${selectedSummary.realtime_tokens.evidence_state}`)}</small> : null}</>} delta={selectedAgent ? null : delta("realtime_tokens")} /><Kpi icon={CircleDollarSign} tone="green" title={copy("realtime.equivalent")} value={<Money metric={selectedSummary?.api_equivalent_value} />} delta={selectedAgent ? null : delta("api_equivalent_value")} /></section>
      {focus ? <section className="vr-card rt-focus tt-pressable-group"><div className="rt-focus-top">
        <div><div className="rt-agent-title"><i className="rt-agent-cube"><ProviderIcon provider={focus.source} size={21} /></i>{focus.agent_label || focus.source}{focus.state === "running" ? <span className="rt-status-pill">{stateLabel(focus.state)}</span> : null}</div><div className="rt-focus-task-label">{copy("realtime.current_task")}</div><div className="rt-focus-task">{taskText(focus)}</div><FocusSparkline points={focusPoints} /></div>
        <div className="rt-focus-metric"><div className="rt-focus-metric-label">{focusUsesAgentDay ? copy("realtime.agent_today_total") : copy("realtime.tokens")}</div><div className="rt-focus-metric-value">{compact(focusUsage?.total_tokens)}</div><div className="rt-focus-metric-sub">{copy("realtime.input")} {compact(focusUsage?.input_tokens)} · {copy("realtime.output")} {compact(focusUsage?.output_tokens)}</div></div>
        <div className="rt-focus-metric"><div className="rt-focus-metric-label">{copy("realtime.equivalent")}</div><div className="rt-focus-metric-value">{<Money metric={focusUsage?.api_equivalent_usd} />}</div><div className="rt-focus-metric-sub">{focusUsesAgentDay ? copy("realtime.agent_today_total") : copy("realtime.billing_safe")}</div></div>
        <div className="rt-focus-metric rt-focus-metric--blue"><div className="rt-focus-metric-label">{copy("realtime.current_range")}</div><div className="rt-focus-metric-value">{range === "month" ? selectedMonth : copy(`realtime.range.${range}`)}</div></div>
      </div><div className="rt-focus-footer"><div><span>{copy("realtime.requests")}</span><strong>{number(focusUsage?.request_count)}</strong></div><div><span>{copy("realtime.sub_agents")}</span><strong>{childCount}</strong></div><div><span>{copy("realtime.duration")}</span><strong>{formatDuration(focus.duration_minutes)}</strong></div><div><span>{copy("realtime.model")}</span><strong>{focus.model || copy("value_realtime.data_unavailable")}</strong></div><div><span>{copy("realtime.billing")}</span><strong>{copy("realtime.billing_safe")}</strong></div></div></section> : <section className="vr-empty mt-4">{copy("realtime.empty")}</section>}
      {agentHistory.length ? <SessionStrip agents={agentHistory} selectedSource={activeSource} onSelect={setSelectedSource} historyMonth={data.data_month} /> : null}
      <section className="rt-workspace"><div className="vr-card rt-analysis"><div className="rt-tabs" role="tablist">{TABS.map((item) => <button type="button" key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{copy(`realtime.tabs.${item}`)}</button>)}</div><div className="rt-analysis-body">{!analysisUsage ? <div className="vr-empty">{copy("realtime.empty")}</div> : <>{tab === "composition" ? <CompositionTab focus={analysisUsage} points={analysisPoints} evidence={analysisUsage?.total_tokens?.evidence || focus?.evidence || data.summary?.realtime_tokens?.evidence} rangeFrom={data.range_from} rangeTo={data.range_to} /> : null}{tab === "trend" ? <TrendTab points={analysisPoints} /> : null}{tab === "children" ? <TreeTab tree={focusTree} /> : null}{tab === "requests" ? <RequestsTab key={`${activeSource}:${range}:${selectedMonth}`} requests={focusRequests} /> : null}</>}</div></div><SidePanels data={data} stateCounts={stateCounts} /></section>
    </> : null}
  </main>;
}
