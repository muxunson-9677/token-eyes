import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  FileText,
  Palette,
  Pin,
  PinOff,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDesktopWidget } from "../hooks/use-desktop-widget";
import {
  type DesktopWidgetAgent,
  type DesktopWidgetMaterial,
  type DesktopWidgetMode,
  type DesktopWidgetPrefs,
  type DesktopWidgetViewModel,
} from "../lib/api";
import { copy, getCopyLocale } from "../lib/copy";
import {
  readResetCelebrationEffect,
  RESET_CELEBRATION_EFFECT_CHANGE_EVENT,
  RESET_CELEBRATION_EFFECT_STORAGE_KEY,
  type ResetCelebrationEffectId,
} from "../ui/celebration/reset-celebration-preference.js";
// ResetCelebrationProvider is a JSX module with no declaration file.
// @ts-expect-error importing named constants from an untyped JSX module
import { DESKTOP_WIDGET_CELEBRATION_EVENT, RESET_CELEBRATION_DURATION_MS } from "../ui/celebration/ResetCelebrationProvider.jsx";
// The widget reuses the same canvas celebration as the reset page.
// @ts-expect-error importing an untyped JSX component
import { ResetCelebrationOverlay } from "../ui/celebration/ResetCelebrationOverlay.jsx";
// PillNav is a JSX module with a stable prop contract but no declaration file.
// @ts-expect-error importing an untyped JSX component
import { PillNav } from "../ui/components/PillNav";
// ProviderIcon is a legacy JSX module; its props are stable but it has no declaration file.
// @ts-expect-error importing an untyped JSX component
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon";
import "./desktop-widget.css";

const AGENT_LABELS: Record<DesktopWidgetAgent, string> = {
  all: "Token Eyes",
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  hermes: "Hermes",
};

const MODE_KEYS: Record<DesktopWidgetMode, string> = {
  projects: "widget.mode.projects",
  limits: "widget.mode.limits",
  models: "widget.mode.models",
};

const MATERIAL_KEYS: Record<DesktopWidgetMaterial, string> = {
  frost: "widget.material.frost",
  graphite: "widget.material.graphite",
  ocean: "widget.material.ocean",
  sand: "widget.material.sand",
};

function AgentIcon({ agent, size = 24 }: { agent: DesktopWidgetAgent | string; size?: number }) {
  if (agent === "all") {
    return <img src="/app-icon.png" alt="" width={size} height={size} aria-hidden />;
  }
  if (agent === "codex") {
    return (
      <span className="widget-codex-mark" style={{ width: size, height: size }} aria-hidden>
        <Terminal size={Math.max(10, Math.round(size * 0.56))} strokeWidth={2.5} />
      </span>
    );
  }
  return <ProviderIcon provider={agent} size={size} />;
}

function TrafficLights({
  status,
}: {
  status: DesktopWidgetViewModel["projectStatus"];
}) {
  return (
    <div className="widget-traffic-lights" aria-label={copy("widget.projects.summary")}>
      {(["red", "yellow", "green"] as const).map((color) => {
        const count = status[color];
        return (
          <span
            className={`widget-traffic-light widget-traffic-light--${color}`}
            data-testid="widget-traffic-light"
            data-active={count > 0 ? "true" : "false"}
            key={color}
          >
            <span className="widget-traffic-light__dot" />
            <span className="widget-traffic-light__count">{count}</span>
          </span>
        );
      })}
    </div>
  );
}

type DesktopWidgetLimit = DesktopWidgetViewModel["limits"][number];
type DesktopWidgetModelUsage = DesktopWidgetViewModel["totals"]["models"][number];

export function orderedWidgetLimits(
  limits: DesktopWidgetLimit[],
  selectedIds: string[] | null | undefined,
) {
  if (selectedIds == null) return limits;
  const byId = new Map(limits.map((limit) => [limit.id, limit]));
  const selected = new Set<string>();
  return selectedIds.flatMap((id) => {
    const limit = byId.get(id) || limits.find((candidate) => id.startsWith(`${candidate.id}:`));
    if (!limit || selected.has(limit.id)) return [];
    selected.add(limit.id);
    return [limit];
  });
}

export function activeWidgetModels(models: DesktopWidgetModelUsage[]) {
  return models.filter((model) => model.tokens > 0);
}

export function formatCompactTokenCount(tokens: number) {
  const absolute = Math.abs(tokens);
  const unit = absolute >= 100_000_000 ? "亿" : absolute >= 10_000 ? "万" : "";
  const divisor = unit === "亿" ? 100_000_000 : unit === "万" ? 10_000 : 1;
  const value = tokens / divisor;
  const maximumFractionDigits = Math.abs(value) >= 100 ? 0 : unit ? 1 : 0;
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(value)}${unit}`;
}

export function formatCompactCost(costUsd: number) {
  if (Math.abs(costUsd) >= 10_000) return `$${formatCompactTokenCount(costUsd)}`;
  return `$${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(costUsd)}`;
}

export function formatWidgetCompactTokenCount(tokens: number) {
  const absolute = Math.abs(tokens);
  const unit = absolute >= 100_000_000 ? "亿" : absolute >= 10_000 ? "万" : "";
  const divisor = unit === "亿" ? 100_000_000 : unit === "万" ? 10_000 : 1;
  const value = tokens / divisor;
  return `${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: unit ? 1 : 0,
  }).format(value)}${unit}`;
}

export function formatWidgetCompactCost(costUsd: number) {
  if (Math.abs(costUsd) >= 10_000) return `$${formatWidgetCompactTokenCount(costUsd)}`;
  return `$${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(costUsd)}`;
}

function LimitProgress({ value }: { value: number | null }) {
  const percent = Math.max(0, Math.min(100, value ?? 0));
  return (
    <span
      className="widget-limit-progress-bar"
      data-testid="widget-limit-progress"
      aria-hidden
    >
      <span style={{ width: `${percent}%` }} />
    </span>
  );
}

function LimitsSummary({ model }: { model: DesktopWidgetViewModel }) {
  const limits = model.limits;
  if (!limits.length) {
    return React.createElement("span", { className: "widget-empty" }, copy("widget.empty"));
  }
  return (
    <div className="widget-limit-summary">
      {limits.map((limit) => (
        <span className="widget-limit-summary__item" key={limit.id}>
          <LimitProgress value={limit.usedPercent} />
          <span className="widget-limit-summary__window">{limit.window}</span>
          <strong>{limit.usedPercent == null ? "—" : `${limit.usedPercent}%`}</strong>
          {limit.notes ? (
            <small className="widget-limit-summary__note widget-truncate" title={limit.notes}>
              {limit.notes}
            </small>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function ModelsSummary({ model }: { model: DesktopWidgetViewModel }) {
  return (
    <div className="widget-model-summary" data-testid="widget-model-summary">
      <span>
        <small>{copy("widget.models.tokens")}</small>
        <strong>{formatWidgetCompactTokenCount(model.totals.tokens)}</strong>
      </span>
      <span>
        <small>{copy("widget.models.cost")}</small>
        <strong>{formatWidgetCompactCost(model.totals.costUsd)}</strong>
      </span>
    </div>
  );
}

function WidgetResetCelebration({
  resetId,
  preferredEffectId,
  onDismiss,
}: {
  resetId: string;
  preferredEffectId?: ResetCelebrationEffectId;
  onDismiss: () => void;
}) {
  const [effectId, setEffectId] = useState<ResetCelebrationEffectId>(
    preferredEffectId ?? readResetCelebrationEffect,
  );
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(
      () => setCycle((value) => value + 1),
      RESET_CELEBRATION_DURATION_MS,
    );
    return () => window.clearInterval(timer);
  }, [resetId, effectId]);

  useEffect(() => {
    const syncEffect = (event?: Event) => {
      const selected = (event as CustomEvent<{ effectId?: ResetCelebrationEffectId }> | undefined)
        ?.detail?.effectId;
      setEffectId(selected === "fireworks" || selected === "meteors"
        ? selected
        : preferredEffectId ?? readResetCelebrationEffect());
    };
    const syncStoredEffect = (event: StorageEvent) => {
      if (event.key === RESET_CELEBRATION_EFFECT_STORAGE_KEY) syncEffect();
    };
    syncEffect();
    window.addEventListener(RESET_CELEBRATION_EFFECT_CHANGE_EVENT, syncEffect);
    window.addEventListener("storage", syncStoredEffect);
    return () => {
      window.removeEventListener(RESET_CELEBRATION_EFFECT_CHANGE_EVENT, syncEffect);
      window.removeEventListener("storage", syncStoredEffect);
    };
  }, [preferredEffectId, resetId]);

  return (
    <div
      className="widget-reset-celebration"
      data-testid="widget-reset-celebration"
      data-effect-id={effectId}
    >
      <ResetCelebrationOverlay
        key={`${resetId}:${effectId}:${cycle}`}
        event={{ eventId: `${resetId}:${cycle}` }}
        effectId={effectId}
        durationMs={RESET_CELEBRATION_DURATION_MS}
        showNotice={false}
        fitToHost
      />
      <button
        type="button"
        aria-label={copy("widget.reset.acknowledge")}
        onClick={onDismiss}
        className="widget-reset-celebration__dismiss"
      >
        <Sparkles aria-hidden />
      </button>
    </div>
  );
}

function CompactSummary({
  mode,
  model,
  expanded,
}: {
  mode: DesktopWidgetMode;
  model: DesktopWidgetViewModel;
  expanded: boolean;
}) {
  if (mode === "models") return React.createElement(ModelsSummary, { model });
  if (mode === "limits" && !expanded) return React.createElement(LimitsSummary, { model });
  return React.createElement(TrafficLights, { status: model.projectStatus });
}

function filteredProjectStatus(
  status: DesktopWidgetViewModel["projectStatus"],
  selectedProjectIds: string[],
  selectedProjects: Array<{ id: string; label: string; path: string }> = [],
) {
  let projects = status.projects;
  if (selectedProjectIds.length > 0) {
    const selected = new Set(selectedProjectIds);
    projects = projects.filter((project) => selected.has(project.id));
    const liveById = new Map(projects.map((project) => [project.id, project]));
    const selectedById = new Map(selectedProjects.map((project) => [project.id, project]));
    projects = selectedProjectIds.map((id) => {
      const live = liveById.get(id);
      if (live) return live;
      const saved = selectedById.get(id);
      return saved ? {
        id,
        label: saved.label,
        red: 0,
        yellow: 0,
        green: 0,
        unknown: 0,
        sessions: [],
      } : null;
    }).filter(Boolean) as DesktopWidgetViewModel["projectStatus"]["projects"];
  }
  projects = projects.filter((project) => (
    project.sessions.length > 0
    || project.red > 0
    || project.yellow > 0
    || project.green > 0
    || project.unknown > 0
  ));
  return projects.reduce((result, project) => ({
    red: result.red + project.red,
    yellow: result.yellow + project.yellow,
    green: result.green + project.green,
    unknown: result.unknown + project.unknown,
    recentProjects: result.recentProjects,
    projects: [...result.projects, project],
  }), {
    red: 0,
    yellow: 0,
    green: 0,
    unknown: 0,
    recentProjects: status.recentProjects,
    projects: [] as DesktopWidgetViewModel["projectStatus"]["projects"],
  });
}

function EmptyProjectSessions() {
  return (
    <div className="widget-project__empty">
      {copy("widget.projects.no_active")}
    </div>
  );
}

function formatSessionTime(value: string | null) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return copy("widget.session.time_unknown");
  return new Intl.DateTimeFormat(getCopyLocale(), {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function shortSessionId(value: string) {
  return value.length > 8 ? value.slice(-8) : value;
}

function ExpandedProjects({ status }: {
  status: DesktopWidgetViewModel["projectStatus"];
}) {
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  if (!status.projects.length) {
    return <div className="widget-detail-empty">{copy("widget.empty")}</div>;
  }
  return (
    <div className="widget-project-list">
      {status.projects.map((project) => {
        const hasSessions = Boolean(project.sessions.length);
        const open = expandedProject === project.id;
        return (
          <div className="widget-project" key={project.id}>
            <button
              type="button"
              className="widget-project__button"
              onClick={() => {
                if (hasSessions) setExpandedProject(open ? null : project.id);
              }}
              aria-expanded={hasSessions ? open : undefined}
            >
              <span className="widget-project__icon" data-testid="widget-project-icon">
                <FileText size={15} aria-hidden />
              </span>
              <span className="widget-truncate">{project.label}</span>
              <span className="widget-project__counts">
                <i className="red">{project.red}</i>
                <i className="yellow">{project.yellow}</i>
                <i className="green">{project.green}</i>
              </span>
              {hasSessions ? <ChevronDown size={13} aria-hidden /> : <span />}
            </button>
            {!hasSessions ? <EmptyProjectSessions /> : null}
            {open ? (
              <div className="widget-session-list">
                {project.sessions.map((session) => {
                  const time = formatSessionTime(session.updatedAt);
                  const stateLabel = copy(`widget.session_state.${session.state}`);
                  const sessionLabel = session.label
                    || copy("widget.session.untitled", { time });
                  return (
                    <div
                      className="widget-session"
                      key={session.id}
                      title={copy("widget.session.details", {
                        status: stateLabel,
                        time,
                        id: shortSessionId(session.id),
                      })}
                    >
                      <span className={`widget-session__status ${session.status}`} />
                      <span className="widget-truncate">{sessionLabel}</span>
                      <span>{stateLabel}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ExpandedLimits({ model }: { model: DesktopWidgetViewModel }) {
  if (!model.limits.length) {
    return <div className="widget-detail-empty">{copy("widget.empty")}</div>;
  }
  return (
    <div className="widget-limit-list">
      {model.limits.map((limit) => (
        <div className="widget-limit-row" key={limit.id}>
          <LimitProgress value={limit.usedPercent} />
          <span className="widget-limit-row__identity">
            <strong className="widget-truncate">{limit.provider} · {limit.accountLabel}</strong>
            <small>{limit.window}{limit.error ? ` · ${copy("widget.refresh_failed")}` : ""}</small>
            {limit.notes ? (
              <small className="widget-limit-row__note widget-truncate" title={limit.notes}>
                {limit.notes}
              </small>
            ) : null}
          </span>
          <strong>{limit.usedPercent == null ? "—" : `${limit.usedPercent}%`}</strong>
        </div>
      ))}
    </div>
  );
}

function ExpandedModels({ model }: { model: DesktopWidgetViewModel }) {
  const models = activeWidgetModels(model.totals.models);
  if (!models.length) {
    return <div className="widget-detail-empty">{copy("widget.empty")}</div>;
  }
  return (
    <div className="widget-model-list">
      {models.map((item, index) => (
        <div className="widget-model-row" key={item.name}>
          <div className="widget-model-row__labels">
            <strong className="widget-truncate">
              <i className="widget-model-row__tone" data-testid="widget-model-tone" data-tone={String(index % 7)} />
              {item.name}
            </strong>
            <span>{formatCompactTokenCount(item.tokens)} · {item.share}%</span>
          </div>
          <div className="widget-model-row__bar">
            <span data-tone={String(index % 7)} style={{ width: `${Math.max(0, Math.min(100, item.share))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PortalMenu({
  anchor,
  label,
  kind,
  children,
}: {
  anchor: React.RefObject<HTMLElement>;
  label: string;
  kind: "agent" | "mode";
  children: React.ReactNode;
}) {
  const rect = anchor.current?.getBoundingClientRect();
  return createPortal(
    <div
      className="widget-menu"
      role="menu"
      aria-label={label}
      data-menu-kind={kind}
      data-menu-layout="vertical"
      style={{
        top: Math.max(8, (rect?.bottom ?? 8) + 5),
        left: Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - 190)),
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function PortalAppearance({
  anchor,
  prefs,
  updatePrefs,
  close,
}: {
  anchor: React.RefObject<HTMLElement>;
  prefs: DesktopWidgetPrefs;
  updatePrefs: (patch: {
    material?: DesktopWidgetMaterial;
    opacity?: number;
  }) => unknown;
  close: () => void;
}) {
  const rect = anchor.current?.getBoundingClientRect();
  return createPortal(
    <div
      className="widget-appearance"
      role="dialog"
      aria-label={copy("widget.appearance")}
      data-text-contrast="light"
      style={{
        top: Math.max(8, (rect?.bottom ?? 8) + 5),
        left: Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - 292)),
      }}
    >
      <button
        type="button"
        className="widget-appearance-close"
        aria-label={copy("widget.appearance.close")}
        onClick={close}
      >
        <X size={12} aria-hidden />
      </button>
      <div className="widget-material-options">
        {(Object.keys(MATERIAL_KEYS) as DesktopWidgetMaterial[]).map((material) => (
          <label key={material} className={`widget-material-option widget-material-option--${material}`}>
            <input
              type="radio"
              name="widget-material"
              checked={prefs.material === material}
              onChange={() => void updatePrefs({ material })}
            />
            <span>{copy(MATERIAL_KEYS[material])}</span>
          </label>
        ))}
      </div>
      <label className="widget-opacity-control">
        <span>{copy("widget.opacity")}</span>
        <input
          type="range"
          min="0.4"
          max="0.96"
          step="0.02"
          value={prefs.opacity}
          aria-label={copy("widget.opacity")}
          onChange={(event) => void updatePrefs({ opacity: Number(event.target.value) })}
        />
        <output>{Math.round(prefs.opacity * 100)}%</output>
      </label>
    </div>,
    document.body,
  );
}

export function DesktopWidgetPage() {
  const {
    prefs,
    viewModel,
    loading,
    error,
    updatePrefs,
    setPopoverOpen,
    setCelebrationOpen,
    acknowledgePendingReset,
  } = useDesktopWidget();
  const [openMenu, setOpenMenu] = useState(null as "agent" | null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const browserPreviewEffect = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("preview")
    ? new URLSearchParams(window.location.search).get("celebration")
    : null;
  const [previewCelebration, setPreviewCelebration] = useState<{
    eventId: string;
    effectId: ResetCelebrationEffectId;
  } | null>(() => browserPreviewEffect === "meteors" || browserPreviewEffect === "fireworks"
    ? { eventId: `browser-preview:${browserPreviewEffect}`, effectId: browserPreviewEffect }
    : null);
  const [dismissedResetId, setDismissedResetId] = useState(null as string | null);
  const agentMenuAnchor = useRef(null as HTMLButtonElement | null);
  const appearanceAnchor = useRef(null as HTMLButtonElement | null);
  const isBrowserPreview = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("preview");
  const browserPreviewClassName = isBrowserPreview ? " desktop-widget-root--browser-preview" : "";

  useEffect(() => {
    document.documentElement.classList.add("desktop-widget-document");
    if (isBrowserPreview) {
      document.documentElement.classList.add("desktop-widget-browser-preview");
    }
    return () => {
      document.documentElement.classList.remove("desktop-widget-document");
      document.documentElement.classList.remove("desktop-widget-browser-preview");
    };
  }, [isBrowserPreview]);

  useEffect(() => {
    void setPopoverOpen(Boolean(openMenu || appearanceOpen));
  }, [appearanceOpen, openMenu, setPopoverOpen]);

  useEffect(() => {
    if (!openMenu && !appearanceOpen) return undefined;
    const closePopover = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
      } else {
        const target = event.target as HTMLElement;
        if (target.closest(".widget-menu, .widget-appearance, .widget-agent-control, .widget-corner-controls")) {
          return;
        }
      }
      setOpenMenu(null);
      setAppearanceOpen(false);
    };
    document.addEventListener("keydown", closePopover);
    document.addEventListener("pointerdown", closePopover);
    return () => {
      document.removeEventListener("keydown", closePopover);
      document.removeEventListener("pointerdown", closePopover);
    };
  }, [appearanceOpen, openMenu]);

  useEffect(() => () => {
    void setPopoverOpen(false);
  }, [setPopoverOpen]);

  useEffect(() => {
    const handleCelebration = (event: Event) => {
      const detail = (event as CustomEvent<{
        eventId?: string;
        effectId?: ResetCelebrationEffectId;
      }>).detail;
      if (!detail?.eventId || (detail.effectId !== "fireworks" && detail.effectId !== "meteors")) return;
      setPreviewCelebration({ eventId: detail.eventId, effectId: detail.effectId });
    };
    window.addEventListener(DESKTOP_WIDGET_CELEBRATION_EVENT, handleCelebration);
    return () => window.removeEventListener(DESKTOP_WIDGET_CELEBRATION_EVENT, handleCelebration);
  }, []);

  const model = viewModel;
  const selectedProjectIds = prefs.selectedProjectIds ?? [];
  const visibleLimits = model
    ? orderedWidgetLimits(model.limits, prefs.selectedLimitIds)
    : null;
  const visibleProjectStatus = model
    ? filteredProjectStatus(
      model.projectStatus,
      selectedProjectIds,
      prefs.selectedProjects ?? [],
    )
    : null;
  const visibleModel = model && visibleProjectStatus
    ? {
      ...model,
      projectStatus: visibleProjectStatus,
      limits: visibleLimits ?? [],
    }
    : model;
  const pendingReset = model?.pendingReset;
  const pendingResetId = pendingReset?.id;
  const activePendingResetId = pendingResetId && pendingResetId !== dismissedResetId
    ? pendingResetId
    : undefined;
  const activeCelebrationId = activePendingResetId ?? previewCelebration?.eventId;
  const rootStyle = {
    "--widget-opacity": prefs.opacity,
    "--widget-preview-width": `${prefs.width}px`,
    "--widget-preview-height": `${prefs.expanded ? prefs.expandedHeight : prefs.collapsedHeight}px`,
  } as React.CSSProperties;
  const setMode = (mode: string) => {
    void updatePrefs({ mode: mode as DesktopWidgetMode });
  };
  const handleDragStart = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, label, a, select, textarea, [role='menu'], [role='slider'], .widget-scroll-region")) {
      return;
    }
    void getCurrentWindow().startDragging();
  };

  useEffect(() => {
    void setCelebrationOpen(Boolean(activeCelebrationId));
    return () => {
      if (activeCelebrationId) void setCelebrationOpen(false);
    };
  }, [activeCelebrationId, setCelebrationOpen]);

  const dismissCelebration = () => {
    void setCelebrationOpen(false);
    if (activePendingResetId) {
      setDismissedResetId(activePendingResetId);
      void acknowledgePendingReset();
    }
    setPreviewCelebration(null);
  };

  return (
    <main
      className={`desktop-widget-root${browserPreviewClassName} ${openMenu || appearanceOpen ? "has-popover" : ""} ${activeCelebrationId ? "has-celebration" : ""}`}
      style={rootStyle}
    >
      {activeCelebrationId ? (
        <WidgetResetCelebration
          resetId={activeCelebrationId}
          preferredEffectId={activePendingResetId ? undefined : previewCelebration?.effectId}
          onDismiss={dismissCelebration}
        />
      ) : null}
      <article
        className={`desktop-widget-card desktop-widget-card--reference-dock desktop-widget-card--${prefs.material} ${prefs.expanded ? "is-expanded" : ""}`}
        data-testid="desktop-widget-card"
        onPointerDown={handleDragStart}
      >
        <div className="widget-toolbar">
          <div className="widget-agent-control">
            <button
              type="button"
              className="widget-agent-main"
              aria-label={copy(prefs.expanded ? "widget.collapse" : "widget.expand")}
              onClick={() => void updatePrefs({ expanded: !prefs.expanded })}
            >
              <AgentIcon agent={prefs.selectedAgent} size={27} />
            </button>
            <button
              ref={agentMenuAnchor}
              type="button"
              className="widget-agent-arrow"
              aria-label={copy("widget.agent_menu")}
              aria-expanded={openMenu === "agent"}
              onClick={() => {
                setAppearanceOpen(false);
                setOpenMenu(openMenu === "agent" ? null : "agent");
              }}
            >
              <ChevronDown size={12} aria-hidden />
            </button>
          </div>

          <div className="widget-summary" data-testid="widget-drag-surface">
            {visibleModel ? (
              <CompactSummary mode={prefs.mode} model={visibleModel} expanded={prefs.expanded} />
            ) : (
              <span className="widget-empty">
                {loading ? copy("widget.loading") : error ? copy("widget.unavailable") : copy("widget.empty")}
              </span>
            )}
          </div>


          <div className="widget-corner-controls">
            <button
              ref={appearanceAnchor}
              type="button"
              className="widget-icon-button"
              aria-label={copy("widget.appearance")}
              aria-expanded={appearanceOpen}
              onClick={() => {
                setAppearanceOpen(!appearanceOpen);
                setOpenMenu(null);
              }}
            >
              <Palette size={11} aria-hidden />
            </button>
            <button
              type="button"
              className="widget-icon-button"
              aria-label={copy(prefs.alwaysOnTop ? "widget.unpin" : "widget.pin")}
              onClick={() => void updatePrefs({ alwaysOnTop: !prefs.alwaysOnTop })}
            >
              {prefs.alwaysOnTop ? <Pin size={10} aria-hidden /> : <PinOff size={10} aria-hidden />}
            </button>
          </div>
        </div>

        {prefs.expanded && visibleModel ? (
          <div className="widget-scroll-region" data-widget-scroll-region>
            {prefs.mode === "projects" ? <ExpandedProjects status={visibleModel.projectStatus} /> : null}
            {prefs.mode === "limits" ? <ExpandedLimits model={visibleModel} /> : null}
            {prefs.mode === "models" ? <ExpandedModels model={visibleModel} /> : null}
          </div>
        ) : null}

      </article>

      <nav className="widget-mode-rail widget-mode-rail--reference-dock" data-testid="widget-mode-rail">
        <PillNav
          value={prefs.mode}
          options={(Object.keys(MODE_KEYS) as DesktopWidgetMode[]).map((mode) => ({
            value: mode,
            label: copy(MODE_KEYS[mode]),
          }))}
          onValueChange={setMode}
          ariaLabel={copy("widget.mode_menu")}
        />
      </nav>

      {openMenu === "agent" ? (
        <PortalMenu anchor={agentMenuAnchor} label={copy("widget.agent_menu")} kind="agent">
          {(model?.agents ?? ["all", "claude", "codex", "cursor", "hermes"]).map((agent) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={prefs.selectedAgent === agent}
              key={agent}
              onClick={() => {
                setOpenMenu(null);
                void updatePrefs({ selectedAgent: agent });
              }}
            >
              <AgentIcon agent={agent} size={17} />
              <span>{AGENT_LABELS[agent]}</span>
              {prefs.selectedAgent === agent ? <Check size={14} aria-hidden /> : null}
            </button>
          ))}
        </PortalMenu>
      ) : null}

      {appearanceOpen ? (
        <PortalAppearance
          anchor={appearanceAnchor}
          prefs={prefs}
          updatePrefs={updatePrefs}
          close={() => setAppearanceOpen(false)}
        />
      ) : null}

    </main>
  );
}
