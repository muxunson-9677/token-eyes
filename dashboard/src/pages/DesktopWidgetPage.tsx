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
import { DASHBOARD_AGENTS } from "../lib/agent-adapters-dashboard";
import { groupWidgetLimits } from "../lib/widget-limit-groups.js";
// The shared preference hook is a legacy JSX-facing module without declarations.
// @ts-expect-error stable runtime contract is narrowed by LimitsDisplaySnapshot below
import { LIMITS_DISPLAY_CHANGE_EVENT, readLimitsDisplaySnapshot } from "../hooks/use-limits-display-prefs";
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

const AGENT_LABELS: Partial<Record<DesktopWidgetAgent, string>> = {
  all: "Token Eyes",
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  hermes: "Hermes",
};

const DASHBOARD_AGENT_LABELS = new Map(DASHBOARD_AGENTS.map((agent) => [agent.id, agent.displayName]));

type LimitsDisplaySnapshot = {
  providerOrder: string[];
  providerVisibility: Record<string, boolean>;
};

function agentLabel(agent: DesktopWidgetAgent) {
  return AGENT_LABELS[agent] || DASHBOARD_AGENT_LABELS.get(agent) || agent;
}

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
  const selected = new Set<string>();
  return selectedIds.flatMap((id) => {
    return limits.filter((candidate) => (
      candidate.id === id
      || candidate.id.startsWith(`${id}:`)
      || id.startsWith(`${candidate.id}:`)
    )).filter((candidate) => {
      if (selected.has(candidate.id)) return false;
      selected.add(candidate.id);
      return true;
    });
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
  const plans = groupWidgetLimits(model.limits);
  if (!plans.length) {
    return React.createElement("span", { className: "widget-empty" }, copy("widget.empty"));
  }
  const plan = plans[0];
  const planIdentity = plan.planLabel
    ? `${plan.provider} · ${plan.planLabel}`
    : `${plan.provider} · ${plan.accountLabel}`;
  return (
    <div className="widget-limit-summary">
      <span className="widget-limit-summary__item" key={plan.id}>
        <span className="widget-limit-summary__identity widget-truncate">
          {planIdentity}
        </span>
        <LimitProgress value={plan.usedPercent} />
        <strong>{plan.usedPercent == null ? "—" : `${plan.usedPercent}%`}</strong>
      </span>
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
}: {
  mode: DesktopWidgetMode;
  model: DesktopWidgetViewModel;
}) {
  if (mode === "models") return React.createElement(ModelsSummary, { model });
  if (mode === "limits") return React.createElement(LimitsSummary, { model });
  return React.createElement(TrafficLights, { status: model.projectStatus });
}

function filteredProjectStatus(
  status: DesktopWidgetViewModel["projectStatus"],
  selectedProjectIds: string[],
  selectedProjects: Array<{ id: string; label: string; path: string }> = [],
) {
  let projects = status.projects;
  if (selectedProjectIds.length > 0) {
    const liveById = new Map();
    const liveByLabel = new Map<string, DesktopWidgetViewModel["projectStatus"]["projects"]>();
    status.projects.forEach((project) => {
      liveById.set(project.id, project);
      project.sessions.forEach((session) => liveById.set(session.id, project));
      const label = project.label.trim().toLocaleLowerCase();
      if (label) liveByLabel.set(label, [...(liveByLabel.get(label) ?? []), project]);
    });
    const selectedById = new Map(selectedProjects.map((project) => {
      return [project.id, project] as const;
    }));
    const seen = new Set<string>();
    projects = selectedProjectIds.map((id) => {
      const saved = selectedById.get(id);
      const savedLabel = saved?.label.trim().toLocaleLowerCase();
      const exactLive = liveById.get(id);
      const live = exactLive || (savedLabel
        ? liveByLabel.get(savedLabel)?.find((project) => !seen.has(project.id))
        : null);
      if (live) {
        if (seen.has(live.id)) return null;
        seen.add(live.id);
        return live;
      }
      if (saved && !seen.has(id)) {
        seen.add(id);
        return {
        id,
        label: saved.label,
        red: 0,
        yellow: 0,
        green: 0,
        unknown: 0,
        sessions: [],
        };
      }
      return null;
    }).filter(Boolean) as DesktopWidgetViewModel["projectStatus"]["projects"];
  }
  const groupedProjects = Array.from(projects.reduce((groups, project) => {
    const key = project.label.trim().toLocaleLowerCase() || project.id;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { ...project, sessions: [...project.sessions] });
      return groups;
    }
    const sessionIds = new Set(current.sessions.map((session) => session.id));
    const sessions = [
      ...current.sessions,
      ...project.sessions.filter((session) => !sessionIds.has(session.id)),
    ];
    groups.set(key, {
      ...current,
      red: current.red + project.red,
      yellow: current.yellow + project.yellow,
      green: current.green + project.green,
      unknown: current.unknown + project.unknown,
      sessions,
    });
    return groups;
  }, new Map<string, DesktopWidgetViewModel["projectStatus"]["projects"][number]>()).values());

  return groupedProjects.reduce((result, project) => ({
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

function formatCompactLimitTime(value: string | null) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return copy("widget.limit.time_unknown");
  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatCompactRemainingTime(value: string | null) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return copy("widget.limit.time_unknown");
  const totalHours = Math.max(0, Math.floor((timestamp - Date.now()) / (60 * 60 * 1000)));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}d ${hours}h`;
}

function formatCompactReset(value: string | null) {
  return `${formatCompactRemainingTime(value)}（${formatCompactLimitTime(value)}）`;
}

function formatCompactValidity(value: string | null) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return copy("widget.limit.time_unknown");
  const days = Math.max(0, Math.ceil((timestamp - Date.now()) / (24 * 60 * 60 * 1000)));
  return `有效期 ${days} 天`;
}

function formatCompactLimitWindow(value: string | null) {
  const label = String(value || "").trim();
  const normalized = label.toLocaleLowerCase().replace(/\s+/g, "");
  if (["1w", "7d", "7天", "weekly", "week"].includes(normalized)) return "Weekly";
  return label;
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
  const plans = groupWidgetLimits(model.limits);
  if (!plans.length) {
    return <div className="widget-detail-empty">{copy("widget.empty")}</div>;
  }
  return (
    <div className="widget-limit-list">
      {plans.map((plan) => {
        const planName = plan.planLabel || plan.accountLabel || plan.provider;
        const planIdentity = `${plan.provider} · ${planName}`;
        const accountLabel = plan.accountLabel && plan.accountLabel !== planName
          ? plan.accountLabel
          : null;
        return (
        <div className="widget-limit-plan" data-testid="widget-expanded-limit-plan" key={plan.id}>
          <span className="widget-limit-plan__identity">
            <strong className="widget-limit-plan__title widget-truncate">{planIdentity}</strong>
            {accountLabel ? <small className="widget-limit-plan__account widget-truncate">{accountLabel}</small> : null}
          </span>
          {plan.windows.map((limit) => (
            <div className="widget-limit-row" key={limit.id}>
              <span className="widget-limit-row__head">
                <strong>{formatCompactLimitWindow(limit.window)}</strong>
                <strong>{limit.usedPercent == null ? "—" : `${limit.usedPercent}%`}</strong>
              </span>
              <LimitProgress value={limit.usedPercent} />
              <small className="widget-limit-row__reset">
                {limit.resetAt
                  ? formatCompactReset(limit.resetAt)
                  : copy("widget.limit.reset_at", { time: copy("widget.limit.time_unknown") })}
              </small>
              {limit.error ? <small className="widget-limit-row__error">{copy("widget.refresh_failed")}</small> : null}
            </div>
          ))}
          {plan.expiresAt ? <small className="widget-limit-plan__validity">{formatCompactValidity(plan.expiresAt)}</small> : null}
        </div>
        );
      })}
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
            <span>{new Intl.NumberFormat("en-US").format(item.tokens)} · {item.share}%</span>
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
      data-menu-depth={kind === "agent" ? "reference-glass" : undefined}
      data-menu-scrollbar={kind === "agent" ? "hidden" : undefined}
      style={{
        top: Math.max(8, (rect?.bottom ?? 8) + 5),
        left: Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - 290)),
        "--widget-menu-pointer-left": `${Math.max(22, Math.min(258, (rect?.left ?? 8) + (rect?.width ?? 44) / 2 - Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - 290))))}px`,
      } as React.CSSProperties}
    >
      <div className="widget-menu__items">{children}</div>
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
  const [limitsDisplay, setLimitsDisplay] = useState<LimitsDisplaySnapshot>(
    () => readLimitsDisplaySnapshot() as LimitsDisplaySnapshot,
  );
  const agentMenuAnchor = useRef(null as HTMLDivElement | null);
  const appearanceAnchor = useRef(null as HTMLButtonElement | null);
  const isBrowserPreview = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("preview");
  const browserPreviewClassName = isBrowserPreview ? " desktop-widget-root--browser-preview" : "";

  useEffect(() => {
    const refreshLimitsDisplay = () => setLimitsDisplay(
      readLimitsDisplaySnapshot() as LimitsDisplaySnapshot,
    );
    window.addEventListener(LIMITS_DISPLAY_CHANGE_EVENT, refreshLimitsDisplay);
    window.addEventListener("storage", refreshLimitsDisplay);
    return () => {
      window.removeEventListener(LIMITS_DISPLAY_CHANGE_EVENT, refreshLimitsDisplay);
      window.removeEventListener("storage", refreshLimitsDisplay);
    };
  }, []);

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
  const visibleAgentOptions = [
    "all",
    ...limitsDisplay.providerOrder.filter((agent: string) => (
      limitsDisplay.providerVisibility[agent] !== false
    )),
  ].filter((agent, index, options) => options.indexOf(agent) === index) as DesktopWidgetAgent[];
  const selectedAgentVisible = prefs.selectedAgent === "all"
    || visibleAgentOptions.includes(prefs.selectedAgent);

  useEffect(() => {
    if (!selectedAgentVisible) void updatePrefs({ selectedAgent: "all" });
  }, [prefs.selectedAgent, selectedAgentVisible, updatePrefs]);
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
    const nextMode = mode as DesktopWidgetMode;
    void updatePrefs({ mode: nextMode });
  };
  const handleDragStart = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (openMenu || appearanceOpen) return;
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

  const dismissCelebration = async () => {
    await setCelebrationOpen(false);
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
          <div ref={agentMenuAnchor} className="widget-agent-control">
            <button
              type="button"
              className="widget-agent-main"
              aria-label={copy(prefs.expanded ? "widget.collapse" : "widget.expand")}
              onClick={() => {
                const expanded = !prefs.expanded;
                void updatePrefs({ expanded });
              }}
            >
              <AgentIcon agent={prefs.selectedAgent} size={27} />
            </button>
            <button
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
              <CompactSummary mode={prefs.mode} model={visibleModel} />
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
          {visibleAgentOptions.map((agent) => (
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
              <AgentIcon agent={agent} size={30} />
              <span>{agentLabel(agent)}</span>
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
