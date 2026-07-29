import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  Layers3,
  Palette,
  Pin,
  PinOff,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDesktopWidget } from "../hooks/use-desktop-widget";
import {
  type DesktopWidgetAgent,
  type DesktopWidgetMaterial,
  type DesktopWidgetMode,
  type DesktopWidgetViewModel,
} from "../lib/api";
import { copy } from "../lib/copy";
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

function ProgressRing({ value }: { value: number | null }) {
  const percent = value ?? 0;
  return (
    <span
      className="widget-progress-ring"
      data-testid="widget-limit-progress"
      style={{ "--widget-progress": `${percent * 3.6}deg` } as React.CSSProperties}
      aria-hidden
    >
      <span />
    </span>
  );
}

function LimitsSummary({ model }: { model: DesktopWidgetViewModel }) {
  const limits = model.limits.slice(0, 2);
  if (!limits.length) {
    return React.createElement("span", { className: "widget-empty" }, copy("widget.empty"));
  }
  return (
    <div className="widget-limit-summary">
      {limits.map((limit) => (
        <span className="widget-limit-summary__item" key={limit.id}>
          <ProgressRing value={limit.usedPercent} />
          <span className="widget-limit-summary__window">{limit.window}</span>
          <strong>{limit.usedPercent == null ? "—" : `${limit.usedPercent}%`}</strong>
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
        <strong>{new Intl.NumberFormat().format(model.totals.tokens)}</strong>
      </span>
      <span>
        <small>{copy("widget.models.cost")}</small>
        <strong>${model.totals.costUsd.toFixed(2)}</strong>
      </span>
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
  if (mode === "limits") return React.createElement(LimitsSummary, { model });
  if (mode === "models") return React.createElement(ModelsSummary, { model });
  return React.createElement(TrafficLights, { status: model.projectStatus });
}

function filteredProjectStatus(
  status: DesktopWidgetViewModel["projectStatus"],
  selectedProjectIds: string[],
) {
  let projects = status.projects;
  if (selectedProjectIds.length > 0) {
    const selected = new Set(selectedProjectIds);
    projects = projects.filter((project) => selected.has(project.id));
  } else {
    const cutoff = Date.now() - 24 * 60 * 60_000;
    const recent = projects.filter((project) => project.sessions.some(
      (session) => session.updatedAt && Date.parse(session.updatedAt) >= cutoff,
    ));
    if (recent.length > 0) {
      projects = recent;
    } else if (projects.length > 0) {
      projects = [projects[0]];
    }
  }
  return projects.reduce((result, project) => ({
    red: result.red + project.red,
    yellow: result.yellow + project.yellow,
    green: result.green + project.green,
    unknown: result.unknown + project.unknown,
    projects: [...result.projects, project],
  }), {
    red: 0,
    yellow: 0,
    green: 0,
    unknown: 0,
    projects: [] as DesktopWidgetViewModel["projectStatus"]["projects"],
  });
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
        const open = expandedProject === project.id;
        return (
          <div className="widget-project" key={project.id}>
            <button
              type="button"
              className="widget-project__button"
              onClick={() => setExpandedProject(open ? null : project.id)}
              aria-expanded={open}
            >
              <span className="widget-truncate">{project.label}</span>
              <span className="widget-project__counts">
                <i className="red">{project.red}</i>
                <i className="yellow">{project.yellow}</i>
                <i className="green">{project.green}</i>
              </span>
              <ChevronDown size={13} aria-hidden />
            </button>
            {open ? (
              <div className="widget-session-list">
                {project.sessions.map((session) => (
                  <div className="widget-session" key={session.id}>
                    <span className={`widget-session__status ${session.status}`} />
                    <span className="widget-truncate">{session.label}</span>
                    <span>{copy(`widget.status.${session.status}`)}</span>
                  </div>
                ))}
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
          <ProgressRing value={limit.usedPercent} />
          <span className="widget-limit-row__identity">
            <strong className="widget-truncate">{limit.provider} · {limit.accountLabel}</strong>
            <small>{limit.window}{limit.error ? ` · ${copy("widget.refresh_failed")}` : ""}</small>
          </span>
          <strong>{limit.usedPercent == null ? "—" : `${limit.usedPercent}%`}</strong>
        </div>
      ))}
    </div>
  );
}

function ExpandedModels({ model }: { model: DesktopWidgetViewModel }) {
  if (!model.totals.models.length) {
    return <div className="widget-detail-empty">{copy("widget.empty")}</div>;
  }
  return (
    <div className="widget-model-list">
      {model.totals.models.map((item) => (
        <div className="widget-model-row" key={item.name}>
          <div className="widget-model-row__labels">
            <strong className="widget-truncate">{item.name}</strong>
            <span>{new Intl.NumberFormat().format(item.tokens)} · {item.share}%</span>
          </div>
          <div className="widget-model-row__bar">
            <span style={{ width: `${Math.max(0, Math.min(100, item.share))}%` }} />
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

export function DesktopWidgetPage() {
  const {
    prefs,
    viewModel,
    loading,
    error,
    updatePrefs,
    acknowledgePendingReset,
  } = useDesktopWidget();
  const [openMenu, setOpenMenu] = useState(null as "agent" | "mode" | null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const agentMenuAnchor = useRef(null as HTMLButtonElement | null);
  const modeMenuAnchor = useRef(null as HTMLButtonElement | null);

  useEffect(() => {
    document.documentElement.classList.add("desktop-widget-document");
    return () => document.documentElement.classList.remove("desktop-widget-document");
  }, []);

  const model = viewModel;
  const selectedProjectIds = prefs.selectedProjectIds ?? [];
  const visibleProjectStatus = model
    ? filteredProjectStatus(model.projectStatus, selectedProjectIds)
    : null;
  const visibleModel = model && visibleProjectStatus
    ? { ...model, projectStatus: visibleProjectStatus }
    : model;
  const pendingReset = model?.pendingReset;
  const rootStyle = {
    "--widget-opacity": prefs.opacity,
  } as React.CSSProperties;
  const handleDragStart = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, label, a, select, textarea, [role='menu'], [role='slider'], .widget-scroll-region")) {
      return;
    }
    void getCurrentWindow().startDragging();
  };

  if (pendingReset) {
    const change = pendingReset.previousUsedPercent == null
      || pendingReset.currentUsedPercent == null
      ? null
      : `${pendingReset.previousUsedPercent}% → ${pendingReset.currentUsedPercent}%`;
    return (
      <main className="desktop-widget-root" style={rootStyle}>
        <article
          className={`desktop-widget-card desktop-widget-card--${prefs.material} desktop-widget-card--reset`}
          data-testid="desktop-widget-card"
          onPointerDown={handleDragStart}
        >
          <button
            type="button"
            className="widget-reset-alert"
            aria-label={copy("widget.reset.acknowledge")}
            onClick={() => void acknowledgePendingReset()}
          >
            <span className="widget-reset-alert__icon">
              <AgentIcon agent={pendingReset.agent} size={25} />
              <Check size={13} aria-hidden />
            </span>
            <span className="widget-reset-alert__message">
              <strong>{copy("widget.reset.title")}</strong>
              <small>
                {new Intl.DateTimeFormat(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(pendingReset.occurredAt))}
                {change ? ` · ${change}` : ""}
              </small>
            </span>
          </button>
        </article>
      </main>
    );
  }

  return (
    <main className="desktop-widget-root" style={rootStyle}>
      <article
        className={`desktop-widget-card desktop-widget-card--${prefs.material} ${prefs.expanded ? "is-expanded" : ""}`}
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
              onClick={() => setOpenMenu(openMenu === "agent" ? null : "agent")}
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
              ref={modeMenuAnchor}
              type="button"
              className="widget-icon-button"
              aria-label={copy("widget.mode_menu")}
              aria-expanded={openMenu === "mode"}
              onClick={() => setOpenMenu(openMenu === "mode" ? null : "mode")}
            >
              <Layers3 size={11} aria-hidden />
            </button>
            <button
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

        {appearanceOpen ? (
          <div className="widget-appearance" role="dialog" aria-label={copy("widget.appearance")}>
            <button
              type="button"
              className="widget-appearance-close"
              aria-label={copy("widget.appearance.close")}
              onClick={() => setAppearanceOpen(false)}
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
          </div>
        ) : null}
      </article>

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

      {openMenu === "mode" ? (
        <PortalMenu anchor={modeMenuAnchor} label={copy("widget.mode_menu")} kind="mode">
          {(Object.keys(MODE_KEYS) as DesktopWidgetMode[]).map((mode) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={prefs.mode === mode}
              key={mode}
              onClick={() => {
                setOpenMenu(null);
                void updatePrefs({ mode });
              }}
            >
              <span>{copy(MODE_KEYS[mode])}</span>
              {prefs.mode === mode ? <Check size={14} aria-hidden /> : null}
            </button>
          ))}
        </PortalMenu>
      ) : null}

    </main>
  );
}
