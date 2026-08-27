import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, Clock3, FolderOpen, FolderPlus, GripVertical, MessageSquareText, X } from "lucide-react";

import { Select } from "../../components";
import { copy, getCopyLocale } from "../../../lib/copy";
import { formatCompactNumber, formatCompactUsdCurrency, formatUsdCurrency, toFiniteNumber } from "../../../lib/format";
import { useCurrency } from "../../../hooks/useCurrency";
import { ProviderIcon } from "./ProviderIcon";

// V4 round 1 item-5: 0 = show every project (recent + manually added) in the
// scrollable grid; the numeric options keep the old paginated TOP-N views.
const LIMIT_ALL = 0;
const LIMIT_OPTIONS = [LIMIT_ALL, 3, 6, 10];
export const PROJECT_ORDER_STORAGE_KEY = "tt.projects.order.v1";
const PROJECT_CARD_COLORS = [
  "var(--tt-project-accent-blue)",
  "var(--tt-project-accent-green)",
  "var(--tt-project-accent-purple)",
  "var(--tt-project-accent-orange)",
  "var(--tt-project-accent-pink)",
];

function resolveTokens(entry) {
  const billable = toFiniteNumber(entry?.billable_total_tokens);
  const total = toFiniteNumber(entry?.total_tokens);
  return billable === 0 && total > 0 ? total : (billable ?? total ?? 0);
}

function formatRelativeTime(value) {
  if (!value) return null;
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff) || diff < 0) return null;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatProjectCost(value) {
  if (value == null) return copy("dashboard.projects.cost_unavailable");
  return value;
}

function projectOrderId(entry) {
  return `${String(entry?.project_key || "project")}|${String(entry?.project_path || entry?.project_ref || "")}`;
}

function readProjectOrder() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROJECT_ORDER_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string" && value) : [];
  } catch {
    return [];
  }
}

function persistProjectOrder(order) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Keep the in-memory order when storage is unavailable.
  }
}

export function reorderProjectOrder(order, activeId, overId) {
  const current = Array.isArray(order) ? order.slice() : [];
  const from = current.indexOf(String(activeId || ""));
  const to = current.indexOf(String(overId || ""));
  if (from < 0 || to < 0 || from === to) return current;
  const [moved] = current.splice(from, 1);
  current.splice(to, 0, moved);
  return current;
}

function applyProjectOrder(entries, order) {
  const rank = new Map((Array.isArray(order) ? order : []).map((id, index) => [id, index]));
  return entries.slice().sort((left, right) => {
    const leftRank = rank.get(projectOrderId(left));
    const rightRank = rank.get(projectOrderId(right));
    if (leftRank != null || rightRank != null) {
      if (leftRank == null) return 1;
      if (rightRank == null) return -1;
      return leftRank - rightRank;
    }
    return 0;
  });
}

function normalizeUsageItems(items, fallbackIds = [], providerMap = {}) {
  if (Array.isArray(items) && items.length > 0) {
    return items.filter((item) => item?.id).map((item) => ({
      id: item.id,
      provider: item.provider || providerMap[item.id] || item.id,
      tokens: toFiniteNumber(item.tokens),
      percent: toFiniteNumber(item.percent),
    }));
  }
  return fallbackIds.map((id) => ({ id, provider: providerMap[id] || id, tokens: null, percent: null }));
}

function ProjectSparkline({ points, color }) {
  const values = (Array.isArray(points) ? points : [])
    .map(function mapPoint(point) { return toFiniteNumber(point?.tokens); })
    .filter(function isValidPoint(value) { return value != null && value >= 0; });
  if (values.length < 2) return null;
  const maximum = Math.max(...values, 1);
  const pointsValue = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * 100;
    const y = 26 - ((value / maximum) * 21);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return (
    <svg data-testid="project-usage-sparkline" className="tt-overview-project-sparkline" viewBox="0 0 100 28" preserveAspectRatio="none" aria-label={copy("dashboard.projects.usage_trend")}>
      <path d="M0 27 H100" className="tt-overview-project-sparkline-base" />
      <polyline points={pointsValue} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProjectUsageHeader({ entries, limit, onLimitChange, onSelectFolder, showSummary = true }) {
  const { currency, rate } = useCurrency();
  const locale = getCopyLocale();
  const compactOptions = {
    thousandSuffix: copy("shared.unit.thousand_abbrev"),
    millionSuffix: copy("shared.unit.million_abbrev"),
    billionSuffix: copy("shared.unit.billion_abbrev"),
    decimals: 1,
  };
  const tokenTotal = entries.reduce((total, entry) => total + resolveTokens(entry), 0);
  const pricedCosts = entries
    .filter((entry) => entry?.pricing_coverage !== "unpriced")
    .map((entry) => toFiniteNumber(entry?.cost_usd))
    .filter((value) => value != null);
  const costTotal = pricedCosts.reduce((total, value) => total + value, 0);
  const costSummary = pricedCosts.length > 0
    ? formatCompactUsdCurrency(costTotal, { currency, rate, locale, decimals: 2 })
    : copy("dashboard.projects.cost_unavailable");
  const costTitle = pricedCosts.length > 0
    ? formatUsdCurrency(costTotal, { currency, rate, decimals: 4 })
    : undefined;
  return (
    <div className="tt-overview-project-header">
      {typeof onSelectFolder === "function" ? (
        <button type="button" className="tt-overview-project-folder-button" onClick={onSelectFolder}>
          <FolderPlus aria-hidden="true" />
          {copy("widgets.windows.projects.add_folder")}
        </button>
      ) : null}
      {showSummary ? <div data-testid="project-usage-summary" className="tt-overview-project-summary">
        <div><span>{copy("dashboard.projects.count")}</span><strong>{entries.length}</strong></div>
        <div><span>{copy("dashboard.projects.total_tokens")}</span><strong>{formatCompactNumber(tokenTotal, compactOptions)}</strong></div>
        <div><span>{copy("dashboard.projects.total_cost")}</span><strong title={costTitle}>{costSummary}</strong></div>
      </div> : null}
      <Select
        value={limit}
        onValueChange={(value) => onLimitChange?.(value)}
        options={LIMIT_OPTIONS.map((value) => ({
          value,
          label: {
            [LIMIT_ALL]: copy("dashboard.projects.limit_all"),
            3: copy("dashboard.projects.limit_top_3"),
            6: copy("dashboard.projects.limit_top_6"),
            10: copy("dashboard.projects.limit_top_10"),
          }[value],
        }))}
        ariaLabel={copy("dashboard.projects.limit_aria")}
        align="end"
        className="tt-overview-project-limit px-2 py-1 text-xs text-oai-gray-600 dark:text-oai-gray-300"
      />
    </div>
  );
}

export function ProjectUsagePanel({
  entries = [],
  limit = LIMIT_ALL,
  onLimitChange,
  className = "",
  embedded = false,
  onSelectFolder,
  onRemoveProject,
}) {
  const resolvedLimit = LIMIT_OPTIONS.includes(limit) ? limit : LIMIT_OPTIONS[0];
  const showAll = resolvedLimit === LIMIT_ALL;
  const [projectOrder, setProjectOrder] = useState(readProjectOrder);
  const defaultEntries = useMemo(() => (Array.isArray(entries) ? entries.slice() : []).sort((a, b) => {
    if (Boolean(a?.selected_folder) !== Boolean(b?.selected_folder)) return a?.selected_folder ? -1 : 1;
    return resolveTokens(b) - resolveTokens(a);
  }), [entries]);
  const sortedEntries = useMemo(
    () => applyProjectOrder(defaultEntries, projectOrder),
    [defaultEntries, projectOrder],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [page, setPage] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const pageCount = showAll ? 1 : Math.max(1, Math.ceil(sortedEntries.length / resolvedLimit));
  const currentPage = Math.min(page, pageCount - 1);
  const displayEntries = showAll
    ? sortedEntries
    : sortedEntries.slice(currentPage * resolvedLimit, (currentPage + 1) * resolvedLimit);
  const compactOptions = {
    thousandSuffix: copy("shared.unit.thousand_abbrev"),
    millionSuffix: copy("shared.unit.million_abbrev"),
    billionSuffix: copy("shared.unit.billion_abbrev"),
    decimals: 1,
  };
  const totalTokens = sortedEntries.reduce((total, entry) => total + resolveTokens(entry), 0);
  const navigate = (nextPage) => {
    const target = Math.max(0, Math.min(pageCount - 1, nextPage));
    setPage(target);
    setPageInput(String(target + 1));
  };
  const jump = () => {
    const target = Number.parseInt(pageInput, 10);
    if (Number.isFinite(target)) navigate(target - 1);
  };
  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const currentOrder = sortedEntries.map(projectOrderId);
    const nextOrder = reorderProjectOrder(currentOrder, active.id, over.id);
    setProjectOrder(nextOrder);
    persistProjectOrder(nextOrder);
  };

  const projectGrid = (
    <div
      data-testid="project-usage-grid"
      className="tt-overview-project-grid tt-overview-project-grid--stable grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3"
    >
      {displayEntries.map((entry, index) => {
        const card = <ProjectUsageCard entry={entry} embedded={embedded} aggregateTokens={totalTokens} compactOptions={compactOptions} projectIndex={index} onRemove={onRemoveProject} />;
        return embedded
          ? <SortableProjectUsageCard key={projectOrderId(entry)} id={projectOrderId(entry)}>{card}</SortableProjectUsageCard>
          : <React.Fragment key={projectOrderId(entry)}>{card}</React.Fragment>;
      })}
    </div>
  );

  return (
    <div className={embedded ? `tt-overview-project-panel ${className}` : `rounded-xl border border-oai-gray-200 bg-white p-5 dark:border-oai-gray-800 dark:bg-oai-gray-900 ${className}`}>
      {!embedded ? <h3 className="mb-4 text-sm font-medium uppercase tracking-wide text-oai-gray-500">{copy("dashboard.projects.title")}</h3> : null}
      <ProjectUsageHeader entries={sortedEntries} limit={resolvedLimit} onLimitChange={(value) => { navigate(0); onLimitChange?.(value); }} onSelectFolder={embedded ? onSelectFolder : undefined} showSummary={embedded} />
      {displayEntries.length === 0 ? (
        <div className="py-6 text-sm text-oai-gray-400">{copy("dashboard.projects.empty")}</div>
      ) : embedded ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={displayEntries.map(projectOrderId)} strategy={rectSortingStrategy}>
            {projectGrid}
          </SortableContext>
        </DndContext>
      ) : projectGrid}
      {Math.sign(sortedEntries.length) === 1 ? (
        <div className="tt-overview-pagination tt-overview-project-pagination" data-testid="project-pagination">
          <span data-testid="project-pagination-total">{copy("dashboard.projects.records", { count: sortedEntries.length })}</span>
          {!showAll ? (
            <div>
              <button type="button" disabled={currentPage === 0} onClick={() => navigate(currentPage - 1)}>{copy("details.pagination.prev")}</button>
              {Array.from({ length: pageCount }, (_, index) => <button key={index} type="button" aria-current={currentPage === index ? "page" : undefined} onClick={() => navigate(index)}>{index + 1}</button>)}
              <button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => navigate(currentPage + 1)}>{copy("details.pagination.next")}</button>
              <input aria-label={copy("dashboard.projects.page_number")} value={pageInput} inputMode="numeric" onChange={(event) => setPageInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") jump(); }} />
              <button type="button" onClick={jump}>{copy("dashboard.projects.page_jump")}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SortableProjectUsageCard({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return React.cloneElement(children, {
    sortableRef: setNodeRef,
    sortableStyle: { transform: CSS.Transform.toString(transform), transition },
    isDragging,
    dragHandleProps: { ...attributes, ...listeners },
  });
}

function ProjectUsageCard({ entry, embedded, aggregateTokens, compactOptions, projectIndex, onRemove, sortableRef, sortableStyle, isDragging = false, dragHandleProps }) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef(null);
  const detailRef = useRef(null);
  const triggerRef = useRef(null);
  const { currency, rate } = useCurrency();
  const locale = getCopyLocale();
  const projectName = entry?.project_name || entry?.project_key || copy("data.confidence.unattributed");
  const projectPath = entry?.project_path || "";
  const projectRef = entry?.project_ref || "";
  const tokens = resolveTokens(entry);
  const hasTokens = toFiniteNumber(entry?.billable_total_tokens) != null || toFiniteNumber(entry?.total_tokens) != null;
  const cost = toFiniteNumber(entry?.cost_usd);
  const pricingCoverage = entry?.pricing_coverage || "unpriced";
  const isUnpriced = pricingCoverage === "unpriced";
  const costDisplay = !isUnpriced && cost != null
    ? formatCompactUsdCurrency(cost, { currency, rate, locale })
    : null;
  const costFull = !isUnpriced && cost != null
    ? formatUsdCurrency(cost, { currency, rate, decimals: 4 })
    : null;
  const pricingLabel = {
    complete: copy("dashboard.projects.pricing_complete"),
    partial: copy("dashboard.projects.pricing_partial"),
    unpriced: copy("dashboard.projects.pricing_unpriced"),
  }[pricingCoverage] || copy("dashboard.projects.pricing_unpriced");
  const agents = Array.isArray(entry?.top_agents) ? entry.top_agents : [];
  const models = Array.isArray(entry?.top_models) ? entry.top_models : [];
  const providers = entry?.model_providers || {};
  const agentUsage = normalizeUsageItems(entry?.agent_usage, agents);
  const modelUsage = normalizeUsageItems(entry?.model_usage, models, providers);
  const accent = PROJECT_CARD_COLORS[projectIndex % PROJECT_CARD_COLORS.length];
  const percentage = aggregateTokens > 0 ? Math.round((tokens / aggregateTokens) * 1000) / 10 : 0;
  const detailsId = `project-details-${String(entry?.project_key || projectName).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const setCardRef = useCallback((node) => {
    cardRef.current = node;
    sortableRef?.(node);
  }, [sortableRef]);
  const closeDetails = useCallback(() => {
    const trigger = triggerRef.current;
    setExpanded(false);
    queueMicrotask(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  }, []);
  useEffect(() => {
    if (!expanded) return undefined;
    detailRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") closeDetails();
    };
    const handlePointerDown = (event) => {
      if (!(event.target instanceof Node)) return;
      if (cardRef.current?.contains(event.target)) return;
      closeDetails();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [closeDetails, expanded]);

  if (!embedded) {
    return (
      <article className="flex flex-col gap-3 rounded-lg border border-oai-gray-200 p-3 dark:border-oai-gray-700">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-oai-gray-100 dark:bg-oai-gray-800"><ProviderIcon provider={entry?.project_key} size={24} /></div>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-oai-black dark:text-oai-white">{projectName}</div>
            {projectPath ? <div data-slot="project-path" className="mt-1 flex items-center gap-1.5"><span className="max-w-[120px] truncate text-xs text-oai-gray-400">{projectPath}</span><button type="button" title={copy("dashboard.projects.copy_path")} onClick={() => navigator.clipboard?.writeText(projectPath)}>⎘</button></div> : null}
            {projectRef && /^https?:\/\//.test(projectRef) ? <div data-slot="project-remote" className="mt-1 truncate text-xs text-oai-gray-400">{copy("dashboard.projects.remote_repo")} {projectRef.replace(/^https?:\/\//, "")}</div> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-oai-gray-500">{hasTokens ? <span>{formatCompactNumber(tokens, compactOptions)} <span className="text-oai-gray-400">{copy("dashboard.projects.tokens_label")}</span></span> : null}{costDisplay != null ? <span title={costFull} aria-label={costFull}>{costDisplay} <span className="text-oai-gray-400">{copy("dashboard.projects.cost_label")}</span></span> : null}{entry?.request_count != null ? <span>{entry.request_count} <span className="text-oai-gray-400">{copy("dashboard.projects.requests_label")}</span></span> : null}<span>{pricingLabel}</span></div>
      </article>
    );
  }
  return (
    <article ref={setCardRef} data-testid="project-usage-card" data-expanded={expanded} className={`tt-overview-project-card tt-overview-project-card--embedded tt-overview-project-card--compact flex flex-col${isDragging ? " is-dragging" : ""}`} style={{ "--tt-project-accent": accent, ...sortableStyle }}>
      <div className="tt-overview-project-toggle-row flex items-start gap-1">
        <button
          type="button"
          data-testid="project-usage-drag-handle"
          className="tt-overview-project-drag-handle tt-pressable tt-product-focusable"
          aria-label={`${copy("dashboard.projects.title")} · ${projectName}`}
          onClick={(event) => event.stopPropagation()}
          {...dragHandleProps}
        >
          <GripVertical aria-hidden="true" />
        </button>
        <button ref={triggerRef} type="button" className="tt-overview-project-toggle tt-pressable tt-product-focusable min-w-0 flex-1" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls={detailsId}>
          <span className="tt-overview-project-icon" aria-hidden="true"><FolderOpen size={18} /></span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-semibold text-oai-black dark:text-oai-white">{projectName}</span>
            {entry?.selected_folder && projectPath ? <span data-slot="selected-project-folder" className="mt-0.5 block truncate text-[10px] text-oai-green-600">{copy("dashboard.projects.selected_folder")} · {projectPath}</span> : null}
            {!entry?.selected_folder && /^https?:\/\//.test(projectRef) ? <span data-slot="project-remote" className="mt-0.5 block truncate text-[10px] text-oai-gray-400">{copy("dashboard.projects.remote_repo")} · {projectRef.replace(/^https?:\/\//, "")}</span> : null}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-oai-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {typeof onRemove === "function" ? (
          <button
            type="button"
            data-testid="project-usage-remove"
            className="tt-pressable mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-oai-gray-400 transition-colors hover:bg-oai-gray-100 hover:text-oai-gray-700 dark:hover:bg-oai-gray-800 dark:hover:text-oai-gray-200"
            aria-label={copy("dashboard.projects.remove", { name: projectName })}
            title={copy("dashboard.projects.remove", { name: projectName })}
            onClick={(event) => { event.stopPropagation(); onRemove(entry); }}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="tt-overview-project-location">
        {!entry?.selected_folder && projectPath ? <span data-slot="project-path" className="block truncate text-[10px] text-oai-gray-400">{projectPath}</span> : null}
      </div>
      {agentUsage.length ? <div className="tt-overview-project-tags tt-overview-project-tags--summary" data-slot="project-agent-summary">
        {agentUsage.slice(0, 3).map((agent) => <span key={`summary-agent-${agent.id}`}><i><ProviderIcon provider={agent.provider} size={12} /></i>{agent.id}</span>)}
      </div> : null}
      <div className="tt-overview-project-default-metrics">
        <div><span>{copy("dashboard.projects.tokens_label")}</span><strong>{formatCompactNumber(tokens, compactOptions)}</strong></div>
        <div><span>{copy("dashboard.projects.cost_label")}</span><strong data-testid={costDisplay != null ? "project-cost-value" : undefined} title={costFull || undefined} aria-label={costFull || undefined}>{formatProjectCost(costDisplay)}</strong></div>
      </div>
      <span className="tt-overview-project-pricing">{pricingLabel}</span>
      <div className="tt-overview-project-progress-row"><div className="tt-overview-project-progress" style={{ "--tt-project-progress": `${percentage}%` }} /><span>{percentage}%</span></div>
      {expanded ? <div ref={detailRef} id={detailsId} className="tt-overview-project-details" role="dialog" aria-label={projectName} tabIndex={-1} data-overlay-layout="cover">
        <div className="tt-overview-project-detail-grid">
          {entry?.request_count != null ? <div><MessageSquareText aria-hidden="true" /><span><small>{copy("dashboard.projects.requests_label")}</small>{entry.request_count}</span></div> : null}
          {entry?.last_active_at ? <div data-slot="project-last-active"><Clock3 aria-hidden="true" /><span><small>{copy("dashboard.projects.last_active_label")}</small>{formatRelativeTime(entry.last_active_at)}</span></div> : null}
          {(entry?.period_from || entry?.period_to) ? <div data-slot="project-period"><Clock3 aria-hidden="true" /><span><small>{copy("dashboard.projects.period_label")}</small>{entry?.period_from || entry?.period_to} — {entry?.period_to || entry?.period_from}</span></div> : null}
        </div>
        {agentUsage.length ? <div className="tt-overview-project-breakdown" data-slot="project-agent-usage"><small>{copy("dashboard.projects.agents_label")}</small>{agentUsage.slice(0, 4).map((agent) => <span key={`agent-${agent.id}`}><i data-slot="project-agent-icon"><ProviderIcon provider={agent.provider} size={12} /></i><b>{agent.id}</b>{agent.tokens != null ? <em>{formatCompactNumber(agent.tokens, compactOptions)}</em> : null}{agent.percent != null ? <strong>{agent.percent}%</strong> : null}</span>)}</div> : null}
        {modelUsage.length ? <div className="tt-overview-project-breakdown" data-slot="project-model-usage"><small>{copy("dashboard.projects.models_label")}</small>{modelUsage.slice(0, 4).map((model) => <span key={`model-${model.id}`}><i data-slot="project-model-icon"><ProviderIcon provider={model.provider} size={12} /></i><b>{model.id}</b>{model.tokens != null ? <em>{formatCompactNumber(model.tokens, compactOptions)}</em> : null}{model.percent != null ? <strong>{model.percent}%</strong> : null}</span>)}</div> : null}
        <ProjectSparkline points={entry?.usage_trend} color={accent} />
      </div> : null}
    </article>
  );
}
