import React from "react";
// Vitest provides Node at runtime; this project intentionally omits Node type declarations.
// @ts-expect-error node:fs is available in the Vitest runtime
import { readFileSync } from "node:fs";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const widget = vi.hoisted(() => ({
  updatePrefs: vi.fn(),
  setPopoverOpen: vi.fn(),
  setCelebrationOpen: vi.fn(),
  acknowledgePendingReset: vi.fn(),
  value: {} as any,
}));
const startDragging = vi.hoisted(() => vi.fn());

vi.mock("../hooks/use-desktop-widget", () => ({
  useDesktopWidget: () => widget.value,
}));
vi.mock("../lib/copy", () => ({
  getCopyLocale: () => {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  },
  copy: (key: string, params?: Record<string, string>) => {
    if (key === "widget.session.untitled") return `${params?.time} \u7684\u4f1a\u8bdd`;
    if (key === "widget.session.details") {
      return `${params?.status} · ${params?.time} · ${params?.id}`;
    }
    if (key === "widget.limit.time_unknown") return "reset unavailable";
    if (key === "widget.limit.reset_at") return `reset: ${params?.time}`;
    if (key === "widget.limit.reset_unavailable") return "reset time unavailable";
    if (key === "widget.limit.expires_at") return `expiry: ${params?.days}d · ${params?.absolute}`;
    return `copy:${key}`;
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging }),
}));
vi.mock("motion/react", () => ({
  LayoutGroup: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    span: ({
      layoutId: _layoutId,
      transition: _transition,
      ...props
    }: React.HTMLAttributes<HTMLSpanElement> & {
      layoutId?: string;
      transition?: unknown;
    }) => <span {...props} />,
  },
  useReducedMotion: () => false,
}));

import {
  DesktopWidgetPage,
  formatCompactReset,
  formatCompactValidity,
  formatWidgetCompactCost,
  formatWidgetCompactTokenCount,
  orderedWidgetLimits,
} from "./DesktopWidgetPage";

const widgetStyles = readFileSync("src/pages/desktop-widget.css", "utf8");

const prefs = {
  version: 11,
  visible: true,
  width: 352,
  height: 76,
  collapsedHeight: 76,
  expandedHeight: 360,
  scaleFactor: 1,
  selectedAgent: "codex",
  mode: "projects",
  selectedLimitIds: null,
  expanded: false,
  material: "frost",
  opacity: 0.72,
  alwaysOnTop: true,
  selectedProjectIds: [],
};

const viewModel = {
  agents: ["all", "claude", "codex", "cursor", "hermes"],
  selectedAgent: "codex",
  projectStatus: {
    red: 0,
    yellow: 2,
    green: 0,
    unknown: 0,
    projects: [
      {
        id: "project-a",
        label: "Token Eyes",
        red: 0,
        yellow: 2,
        green: 0,
        unknown: 0,
        sessions: [
          { id: "session-a", label: "session-a", status: "yellow", updatedAt: null },
        ],
      },
    ],
  },
  limits: [
    {
      id: "codex:default:5h",
      planId: "codex:default",
      agent: "codex",
      provider: "Codex",
      planLabel: "Plus",
      accountLabel: "",
      window: "5h",
      usedPercent: 42,
      resetAt: null,
      expiresAt: null,
      error: null,
      notes: "主力开发账号",
    },
    {
      id: "codex:default:weekly",
      planId: "codex:default",
      agent: "codex",
      provider: "Codex",
      planLabel: "Plus",
      accountLabel: "",
      window: "1w",
      usedPercent: 68,
      resetAt: null,
      error: null,
      notes: "备用周额度",
    },
  ],
  totals: {
    tokens: 12_345,
    costUsd: 1.25,
    models: [
      { name: "gpt-5-codex", tokens: 12_345, share: 100, costUsd: 1.25 },
      { name: "inactive-model", tokens: 0, share: 0, costUsd: 0 },
    ],
  },
  pendingReset: null,
};

describe("DesktopWidgetPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    widget.updatePrefs.mockReset().mockResolvedValue(undefined);
    widget.setPopoverOpen.mockReset().mockResolvedValue(undefined);
    widget.setCelebrationOpen.mockReset().mockResolvedValue(undefined);
    widget.acknowledgePendingReset.mockReset().mockResolvedValue(undefined);
    startDragging.mockReset().mockResolvedValue(undefined);
    widget.value = {
      prefs,
      viewModel,
      loading: false,
      error: null,
      updatePrefs: widget.updatePrefs,
      setPopoverOpen: widget.setPopoverOpen,
      setCelebrationOpen: widget.setCelebrationOpen,
      acknowledgePendingReset: widget.acknowledgePendingReset,
    };
  });

  it("keeps plan selections attached to every configured quota window", () => {
    const weekly = {
      id: "cursor:pro-plan:7d",
      planId: "cursor:pro-plan",
      agent: "cursor",
      provider: "Cursor",
      planLabel: "Pro",
      accountLabel: "Cursor Pro",
      subscriptionAmount: 0,
      subscriptionCurrency: "USD",
      kind: "total",
      window: "7d",
      usedPercent: 42,
      resetAt: null,
      expiresAt: null,
      error: null,
      notes: null,
    };
    const auto = {
      ...weekly,
      id: "cursor:pro-plan:auto_composer",
      kind: "auto_composer",
      window: "自动与 Composer",
    };

    expect(orderedWidgetLimits([weekly, auto], ["cursor:pro-plan"])).toEqual([weekly, auto]);
  });

  it("formats widget totals with Chinese compact units", () => {
    expect(formatWidgetCompactTokenCount(13_857_521_151)).toBe("138.6亿");
    expect(formatWidgetCompactCost(35_508.35)).toBe("$3.6万");
  });

  it("constrains the browser-only preview to the native widget frame", () => {
    window.history.pushState({}, "", "/desktop-widget?preview=1");
    const { unmount } = render(<DesktopWidgetPage />);

    try {
      expect(document.querySelector(".desktop-widget-root"))
        .toHaveClass("desktop-widget-root--browser-preview");
      expect(widgetStyles).toContain(".desktop-widget-browser-preview #root");
      expect(widgetStyles).toContain(".desktop-widget-root.desktop-widget-root--browser-preview");
    } finally {
      unmount();
      window.history.pushState({}, "", "/desktop-widget");
    }
  });

  it("shows a requested celebration directly in the browser-only preview", () => {
    window.history.pushState({}, "", "/desktop-widget?preview=1&celebration=fireworks");
    const { unmount } = render(<DesktopWidgetPage />);

    try {
      expect(screen.getByTestId("widget-reset-celebration"))
        .toHaveAttribute("data-effect-id", "fireworks");
    } finally {
      unmount();
      window.history.pushState({}, "", "/desktop-widget");
    }
  });

  it("keeps one card, separates expand and agent controls, and portals the agent menu", async () => {
    const user = userEvent.setup();
    render(<DesktopWidgetPage />);

    expect(screen.getAllByTestId("desktop-widget-card")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "copy:widget.expand" }));
    expect(widget.updatePrefs).toHaveBeenCalledWith({ expanded: true });

    widget.updatePrefs.mockClear();
    await user.click(screen.getByRole("button", { name: "copy:widget.agent_menu" }));
    expect(widget.updatePrefs).not.toHaveBeenCalled();
    const agentMenu = screen.getByRole("menu", { name: "copy:widget.agent_menu" });
    expect(agentMenu.parentElement).toBe(document.body);
    expect(agentMenu).toHaveAttribute("data-menu-layout", "vertical");
    expect(agentMenu).toHaveAttribute("data-menu-depth", "reference-glass");
    expect(agentMenu).toHaveAttribute("data-menu-scrollbar", "hidden");
    expect(within(agentMenu).getAllByRole("menuitemradio").length).toBeGreaterThanOrEqual(5);
    expect(widgetStyles).toMatch(/\.widget-menu\[data-menu-kind="agent"\]\s+\.widget-menu__items\s*\{[^}]*max-height:\s*180px/s);
    expect(widgetStyles).toMatch(/\.widget-menu\[data-menu-kind="agent"\]\s+\.widget-menu__items\s*\{[^}]*scrollbar-width:\s*none/s);
    expect(widgetStyles).toMatch(/\.widget-menu\[data-menu-kind="agent"\]\s+button\[role="menuitemradio"\]\s*\{[^}]*width:\s*100%/s);
    expect(widgetStyles).toMatch(/\.widget-menu\[data-menu-kind="agent"\]::after\s*\{/s);
    expect(widget.setPopoverOpen).toHaveBeenCalledWith(true);

    expect(screen.queryByRole("menu", { name: "copy:widget.mode_menu" })).not.toBeInTheDocument();
  });

  it("uses the controlled three-mode Pill Nav in collapsed and expanded states", async () => {
    const user = userEvent.setup();
    const originalPrefs = { ...prefs };
    const { rerender } = render(<DesktopWidgetPage />);

    const nav = screen.getByRole("navigation", { name: "copy:widget.mode_menu" });
    const projects = within(nav).getByRole("button", { name: "copy:widget.mode.projects" });
    const limits = within(nav).getByRole("button", { name: "copy:widget.mode.limits" });
    expect(within(nav).getByRole("button", { name: "copy:widget.mode.models" })).toBeInTheDocument();
    expect(projects).toHaveAttribute("aria-pressed", "true");

    await act(async () => user.hover(limits));
    expect(nav).toHaveAttribute("data-preview-value", "limits");
    expect(widget.updatePrefs).not.toHaveBeenCalled();
    await act(async () => user.unhover(limits));
    expect(nav).toHaveAttribute("data-preview-value", "projects");

    await act(async () => user.click(limits));
    expect(widget.updatePrefs).toHaveBeenCalledTimes(1);
    expect(widget.updatePrefs).toHaveBeenCalledWith({ mode: "limits" });
    expect(widget.value.prefs).toEqual(originalPrefs);
    expect(projects).toHaveAttribute("aria-pressed", "true");

    widget.value = {
      ...widget.value,
      prefs: { ...originalPrefs, expanded: true, mode: "limits" },
    };
    rerender(<DesktopWidgetPage />);
    const expandedNav = screen.getByRole("navigation", { name: "copy:widget.mode_menu" });
    expect(expandedNav).toBeInTheDocument();
    expect(
      within(expandedNav).getByRole("button", { name: "copy:widget.mode.limits" }),
    ).toHaveAttribute("aria-pressed", "true");

    widget.updatePrefs.mockClear();
    await act(async () => user.click(
      within(expandedNav).getByRole("button", { name: "copy:widget.mode.models" }),
    ));
    expect(widget.updatePrefs).toHaveBeenCalledWith({ mode: "models" });
  });

  it("keeps the 0.54.40 external mode rail beside the card in both widget states", () => {
    const { rerender } = render(<DesktopWidgetPage />);
    const card = screen.getByTestId("desktop-widget-card");
    const rail = screen.getByTestId("widget-mode-rail");
    expect(card.contains(rail)).toBe(false);
    expect(rail.parentElement).toBe(card.parentElement);
    expect(within(rail).getAllByRole("button")).toHaveLength(3);

    widget.value = { ...widget.value, prefs: { ...prefs, expanded: true } };
    rerender(<DesktopWidgetPage />);
    expect(screen.getByTestId("widget-mode-rail").parentElement)
      .toBe(screen.getByTestId("desktop-widget-card").parentElement);
    expect(widgetStyles).toContain("grid-template-columns: minmax(0, 1fr) 22px");
    expect(widgetStyles).not.toContain("min-height: 138px");
    expect(widgetStyles).not.toContain("height: 128px");
  });

  it("uses the reference dock chrome while keeping the real model totals available", () => {
    widget.value = {
      ...widget.value,
      prefs: { ...prefs, expanded: true, mode: "models" },
    };
    render(<DesktopWidgetPage />);

    expect(screen.getByTestId("desktop-widget-card"))
      .toHaveClass("desktop-widget-card--reference-dock");
    expect(screen.getByTestId("widget-mode-rail"))
      .toHaveClass("widget-mode-rail--reference-dock");
    expect(screen.getByTestId("widget-model-summary"))
      .toHaveTextContent("copy:widget.models.tokens");
    expect(screen.getByTestId("widget-model-summary")).toHaveTextContent("$1.25");
    expect(document.querySelector(".widget-toolbar"))
      .not.toHaveClass("widget-toolbar--models");
    expect(widgetStyles).not.toContain(".widget-toolbar--models");
  });

  it("renders all three traffic lights and preserves zero-count semantics without losing their tones", () => {
    render(<DesktopWidgetPage />);
    const lights = screen.getAllByTestId("widget-traffic-light");
    expect(lights).toHaveLength(3);
    expect(lights[0]).toHaveAttribute("data-active", "false");
    expect(lights[1]).toHaveAttribute("data-active", "true");
    expect(lights[2]).toHaveAttribute("data-active", "false");
    expect(widgetStyles).toContain(".widget-traffic-light--red { color:");
    expect(widgetStyles).toContain(".widget-traffic-light--yellow { color:");
  });

  it("uses compact Chinese units in the reference dock without widening the widget chrome", async () => {
    const user = userEvent.setup();
    widget.value = {
      ...widget.value,
      prefs: { ...prefs, mode: "models" },
      viewModel: {
        ...viewModel,
        totals: { ...viewModel.totals, costUsd: 12_345.6 },
      },
    };
    render(<DesktopWidgetPage />);

    expect(screen.getByTestId("widget-model-summary")).toHaveTextContent("1.2万");
    expect(screen.getByTestId("widget-model-summary")).toHaveTextContent("$1.2万");
    await user.click(screen.getByRole("button", { name: "copy:widget.agent_menu" }));
    expect(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: "Codex" }))
      .toHaveAttribute("aria-checked", "true");
    expect(widgetStyles).toContain('.widget-menu button[aria-checked="true"]');
    expect(widgetStyles).toContain("inset: 66px 5px 5px;");
  });

  it("uses a scoped layered-glass treatment for the floating widget without changing its structure", () => {
    expect(widgetStyles).toContain(".desktop-widget-card::before");
    expect(widgetStyles).toContain(".desktop-widget-card::after");
    expect(widgetStyles).toContain("radial-gradient(circle at 12% 0%");
    expect(widgetStyles).toContain("inset 0 0 0 1px");
    expect(widgetStyles).toContain(".widget-agent-control::before");
    expect(widgetStyles).toContain(".widget-mode-rail .pill-nav__item::before");
  });

  it("tucks the external mode rail behind the capsule edge without a visible bridge plate", () => {
    expect(widgetStyles).toMatch(
      /\.desktop-widget-card--reference-dock\s*\{[^}]*z-index:\s*2/u,
    );
    expect(widgetStyles).toMatch(
      /\.widget-mode-rail--reference-dock\s*\{[^}]*z-index:\s*1[^}]*margin-left:\s*-6px/u,
    );
    expect(widgetStyles).not.toMatch(/\.widget-mode-rail--reference-dock::before\s*\{/u);
  });

  it("keeps the collapsed toolbar geometry fixed when detail content expands", () => {
    expect(widgetStyles).toMatch(
      /\.desktop-widget-root\.has-popover \.desktop-widget-card:not\(\.is-expanded\)\s*\{[^}]*height:\s*66px/u,
    );
    expect(widgetStyles).toMatch(
      /\.desktop-widget-card--reference-dock \.widget-toolbar\s*\{[^}]*height:\s*65px/u,
    );
    expect(widgetStyles).not.toMatch(
      /\.desktop-widget-card--reference-dock:not\(\.is-expanded\) \.widget-toolbar\s*\{/u,
    );
  });

  it("removes the rectangular projection below the agent menu", () => {
    const agentMenuRule = widgetStyles.match(
      /\.widget-menu\[data-menu-kind="agent"\]\s*\{([^}]*)\}/u,
    )?.[1] ?? "";
    expect(agentMenuRule).toContain("box-shadow:");
    expect(agentMenuRule).not.toMatch(/\n\s*0 (?:8|24)px (?:18|42)px/u);
    expect(agentMenuRule).toMatch(/\n\s*0 0 0 1px/u);
  });

  it("keeps the side rail shadow tight", () => {
    expect(widgetStyles).toMatch(
      /\.widget-mode-rail--reference-dock \.pill-nav__item\s*\{[^}]*box-shadow:\s*\n\s*0 1px 3px/u,
    );
    expect(widgetStyles).toMatch(
      /\.widget-mode-rail--reference-dock \.pill-nav__item\[aria-pressed="true"\]\s*\{[^}]*box-shadow:\s*\n\s*0 0 4px/u,
    );
    expect(widgetStyles).not.toMatch(
      /\.widget-mode-rail--reference-dock \.pill-nav__item(?:\[aria-pressed="true"\])?\s*\{[^}]*(?:0 4px 8px|13px)/u,
    );
  });

  it("keeps model usage as a divided list inside the expanded content layer", () => {
    expect(widgetStyles).toContain(".widget-model-row {\n  padding: 7px 0;");
    expect(widgetStyles).toContain(".widget-model-row + .widget-model-row {");
  });

  it("drags from the data surface but not from controls", async () => {
    const user = userEvent.setup();
    render(<DesktopWidgetPage />);
    await user.pointer({ keys: "[MouseLeft>]", target: screen.getByTestId("widget-drag-surface") });
    expect(startDragging).toHaveBeenCalledTimes(1);

    startDragging.mockClear();
    await act(async () => user.pointer({
      keys: "[MouseLeft>]",
      target: screen.getByRole("button", { name: "copy:widget.mode.limits" }),
    }));
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("dismisses an open agent menu from blank space without starting a native drag", async () => {
    const user = userEvent.setup();
    render(<DesktopWidgetPage />);

    await user.click(screen.getByRole("button", { name: "copy:widget.agent_menu" }));
    expect(screen.getByRole("menu", { name: "copy:widget.agent_menu" })).toBeInTheDocument();
    expect(widget.setPopoverOpen).toHaveBeenLastCalledWith(true);

    startDragging.mockClear();
    widget.setPopoverOpen.mockClear();
    await act(async () => user.pointer({
      keys: "[MouseLeft>]",
      target: screen.getByTestId("desktop-widget-card"),
    }));

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "copy:widget.agent_menu" })).not.toBeInTheDocument();
    });
    expect(startDragging).not.toHaveBeenCalled();
    expect(widget.setPopoverOpen).toHaveBeenLastCalledWith(false);
  });

  it("keeps project selection out of the desktop capsule", () => {
    render(<DesktopWidgetPage />);
    expect(
      screen.queryByRole("button", { name: "copy:widget.projects.filter" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menu", { name: "copy:widget.projects.filter" }),
    ).not.toBeInTheDocument();
  });

  it("keeps selected project folders visible even when they have no active sessions", () => {
    widget.value = {
      ...widget.value,
      prefs: {
        ...prefs,
        expanded: true,
        selectedProjectIds: ["project-folder"],
        selectedProjects: [{
          id: "project-folder",
          label: "012-EDU-lite",
          path: "D:\\Work\\012-EDU-lite",
        }],
      },
      viewModel: {
        ...viewModel,
        projectStatus: {
          red: 0,
          yellow: 0,
          green: 0,
          unknown: 0,
          projects: [],
        },
      },
    };

    render(<DesktopWidgetPage />);
    expect(screen.getByText("012-EDU-lite")).toBeInTheDocument();
    expect(screen.getByText("copy:widget.projects.no_active")).toBeInTheDocument();
  });

  it("maps a legacy selected session id back to its live project instead of showing a false inactive fallback", () => {
    widget.value = {
      ...widget.value,
      prefs: {
        ...prefs,
        expanded: true,
        selectedProjectIds: ["session-a"],
        selectedProjects: [{
          id: "session-a",
          label: "Token Eyes",
          path: "D:\\Work\\Token Eyes",
        }],
      },
    };

    render(<DesktopWidgetPage />);
    expect(screen.getByText("Token Eyes")).toBeInTheDocument();
    expect(screen.queryByText("copy:widget.projects.no_active")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("widget-traffic-light")[1]).toHaveTextContent("2");
  });

  it("reconnects a saved folder to the live project when its generated id changed", () => {
    widget.value = {
      ...widget.value,
      prefs: {
        ...prefs,
        expanded: true,
        selectedProjectIds: ["project-saved-folder"],
        selectedProjects: [{
          id: "project-saved-folder",
          label: "Token Eyes",
          path: "D:\\Work\\Token Eyes",
        }],
      },
    };

    render(<DesktopWidgetPage />);
    expect(screen.getByText("Token Eyes")).toBeInTheDocument();
    expect(screen.queryByText("copy:widget.projects.no_active")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("widget-traffic-light")[1]).toHaveTextContent("2");
  });

  it("shows one project folder and merges the sessions from repeated live worktrees", async () => {
    const user = userEvent.setup();
    widget.value = {
      ...widget.value,
      prefs: {
        ...prefs,
        expanded: true,
        selectedProjectIds: ["project-saved-a", "project-saved-b"],
        selectedProjects: [
          { id: "project-saved-a", label: "Token Eyes", path: "D:\\Work\\Token Eyes A" },
          { id: "project-saved-b", label: "Token Eyes", path: "D:\\Work\\Token Eyes B" },
        ],
      },
      viewModel: {
        ...viewModel,
        projectStatus: {
          red: 0,
          yellow: 1,
          green: 1,
          unknown: 0,
          recentProjects: [],
          projects: [
            viewModel.projectStatus.projects[0],
            {
              ...viewModel.projectStatus.projects[0],
              id: "project-b",
              green: 1,
              yellow: 0,
              sessions: [{
                ...viewModel.projectStatus.projects[0].sessions[0],
                id: "session-b",
                label: "session-b",
                status: "green",
                state: "completed",
              }],
            },
          ],
        },
      },
    };

    render(<DesktopWidgetPage />);
    expect(screen.getAllByText("Token Eyes")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /Token Eyes/u }));
    expect(screen.getByText("session-a")).toBeInTheDocument();
    expect(screen.getByText("session-b")).toBeInTheDocument();
    expect(screen.getAllByTestId("widget-traffic-light")[1]).toHaveTextContent("2");
    expect(screen.getAllByTestId("widget-traffic-light")[2]).toHaveTextContent("1");
  });

  it("normalizes legacy Limits Display prefs to the renderer-backed agent menu", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "tt.limits.providerOrder",
      JSON.stringify(["workbuddy", "deepseek-harness", "codex", "claude"]),
    );
    window.localStorage.setItem(
      "tt.limits.providerVisibility",
      JSON.stringify({ workbuddy: true, "deepseek-harness": true, codex: true, claude: false }),
    );
    widget.value = {
      ...widget.value,
      viewModel: {
        ...viewModel,
        agents: ["all", "claude", "codex", "workbuddy", "deepseek-harness"],
      },
    };

    render(<DesktopWidgetPage />);
    await user.click(screen.getByRole("button", { name: "copy:widget.agent_menu" }));
    const menu = screen.getByRole("menu", { name: "copy:widget.agent_menu" });
    expect(within(menu).getByText("WorkBuddy")).toBeInTheDocument();
    expect(within(menu).getByText("Codex")).toBeInTheDocument();
    expect(within(menu).queryByText("DeepSeek Harness")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Claude")).not.toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(16);
  });

  it("does not revive a retired non-renderer from legacy prefs before usage data exists", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "tt.limits.providerOrder",
      JSON.stringify(["deepseek-harness", "codex"]),
    );
    window.localStorage.setItem(
      "tt.limits.providerVisibility",
      JSON.stringify({ "deepseek-harness": true, codex: true }),
    );
    widget.value = {
      ...widget.value,
      viewModel: {
        ...viewModel,
        agents: ["all", "codex"],
      },
    };

    render(<DesktopWidgetPage />);
    await user.click(screen.getByRole("button", { name: "copy:widget.agent_menu" }));
    const menu = within(screen.getByRole("menu", { name: "copy:widget.agent_menu" }));
    expect(menu.getByText("Codex")).toBeInTheDocument();
    expect(menu.queryByText("DeepSeek Harness")).not.toBeInTheDocument();
  });

  it.each([
    {
      name: "both reset and expiry",
      resetAt: "2026-08-20T03:33:00.000Z",
      expiresAt: "2026-08-30T14:24:00.000Z",
      resetText: "2026-08-20T03:33:00.000Z",
      expiryText: "2026-08-30T14:24:00.000Z",
    },
    {
      name: "reset only",
      resetAt: "2026-08-20T03:33:00.000Z",
      expiresAt: null,
      resetText: "2026-08-20T03:33:00.000Z",
      expiryText: null,
    },
    {
      name: "expiry only",
      resetAt: null,
      expiresAt: "2026-08-30T14:24:00.000Z",
      resetText: null,
      expiryText: "2026-08-30T14:24:00.000Z",
    },
    {
      name: "neither reset nor expiry",
      resetAt: null,
      expiresAt: null,
      resetText: null,
      expiryText: null,
    },
  ])("shows $name as independent facts", ({ resetAt, expiresAt, resetText, expiryText }) => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-17T11:33:00.000Z"));
    widget.value = {
      ...widget.value,
      prefs: { ...prefs, expanded: true, mode: "limits" },
      viewModel: {
        ...viewModel,
        limits: [{
          ...viewModel.limits[0],
          resetAt,
          expiresAt,
        }],
      },
    };

    render(<DesktopWidgetPage />);
    expect(screen.getByText(resetText ? formatCompactReset(resetText) : "reset time unavailable"))
      .toBeInTheDocument();
    if (expiryText) {
      expect(screen.getByText(formatCompactValidity(expiryText))).toBeInTheDocument();
    } else {
      expect(screen.queryByText(/^expiry:/)).not.toBeInTheDocument();
    }
    now.mockRestore();
  });

  it("keeps an open agent menu mounted while the main card changes expansion state", async () => {
    const user = userEvent.setup();
    render(<DesktopWidgetPage />);

    await user.click(screen.getByRole("button", { name: "copy:widget.agent_menu" }));
    expect(screen.getByRole("menu", { name: "copy:widget.agent_menu" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "copy:widget.expand" }));
    expect(widget.updatePrefs).toHaveBeenCalledWith({ expanded: true });
    expect(screen.getByRole("menu", { name: "copy:widget.agent_menu" })).toBeInTheDocument();
    expect(widget.setPopoverOpen).toHaveBeenLastCalledWith(true);
  });

  it("falls back to all agents when the current agent is hidden in Limits Display", async () => {
    window.localStorage.setItem(
      "tt.limits.providerOrder",
      JSON.stringify(["codex", "claude"]),
    );
    window.localStorage.setItem(
      "tt.limits.providerVisibility",
      JSON.stringify({ codex: true, claude: false }),
    );
    widget.value = {
      ...widget.value,
      prefs: { ...prefs, selectedAgent: "claude" },
      viewModel: { ...viewModel, agents: ["all", "claude", "codex"] },
    };

    render(<DesktopWidgetPage />);

    await waitFor(() => {
      expect(widget.updatePrefs).toHaveBeenCalledWith({ selectedAgent: "all" });
    });
  });

  it("shows the official task title, exact stopped state, and a readable fallback instead of UUIDs", async () => {
    const user = userEvent.setup();
    const officialTitle = "\u6267\u884c\u4ee3\u7801\u4fee\u590d";
    widget.value = {
      ...widget.value,
      prefs: { ...prefs, expanded: true },
      viewModel: {
        ...viewModel,
        projectStatus: {
          red: 0,
          yellow: 0,
          green: 0,
          unknown: 2,
          projects: [{
            id: "project-a",
            label: "010-Token eye",
            red: 0,
            yellow: 0,
            green: 0,
            unknown: 2,
            sessions: [
              {
                id: "019f9c26-1e55-7100-bc08-5a8f6b4a6892",
                label: officialTitle,
                status: "stopped",
                state: "stopped",
                updatedAt: "2026-07-27T08:57:29.273Z",
              },
              {
                id: "019-untitled-session",
                label: null,
                status: "stopped",
                state: "stopped",
                updatedAt: "2026-07-27T09:00:00.000Z",
              },
            ],
          }],
        },
      },
    };

    render(<DesktopWidgetPage />);
    await user.click(screen.getByRole("button", { name: /010-Token eye/u }));

    expect(screen.getAllByTestId("widget-project-icon")).toHaveLength(1);
    const taskTitle = screen.getByText(officialTitle);
    const taskRow = taskTitle.closest(".widget-session");
    expect(taskRow).toHaveTextContent("copy:widget.session_state.stopped");
    expect(taskRow).toHaveAttribute("title", expect.stringContaining("5a8f6b4a6892".slice(-8)));
    expect(screen.queryByText("019f9c26-1e55-7100-bc08-5a8f6b4a6892")).not.toBeInTheDocument();
    expect(screen.queryByText("019-untitled-session")).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp("\u7684\u4f1a\u8bdd$", "u"))).toBeInTheDocument();
  });

  it("groups one plan's quota windows and keeps details out of the collapsed capsule", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-17T11:33:00.000Z"));
    const cursorLimit = {
      ...viewModel.limits[0],
      id: "cursor:pro:7d",
      planId: "cursor:pro",
      agent: "cursor",
      provider: "Cursor",
      planLabel: "Pro",
      accountLabel: "ezequielhuelsxw@outlook.com",
      window: "7d",
      usedPercent: 100,
      resetAt: "2026-08-20T03:33:00.000Z",
      expiresAt: "2026-08-30T14:24:00.000Z",
      notes: "Cursor 周额度",
    };
    widget.value = {
      ...widget.value,
      prefs: {
        ...prefs,
        mode: "limits",
        selectedLimitIds: ["codex:default:weekly", "codex:default:5h", "cursor:pro:7d"],
      },
      viewModel: { ...viewModel, limits: [...viewModel.limits, cursorLimit] },
    };
    const { rerender } = render(<DesktopWidgetPage />);
    expect(screen.getByText(/Codex · Plus/u)).toBeInTheDocument();
    expect(screen.queryByText(/Cursor · Pro/u)).not.toBeInTheDocument();
    expect(screen.queryByText("1w")).not.toBeInTheDocument();
    expect(screen.queryByText("备用周额度")).not.toBeInTheDocument();
    expect(screen.queryByText("主力开发账号")).not.toBeInTheDocument();
    expect(screen.queryByText("5h")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("widget-limit-progress")).toHaveLength(1);
    expect(screen.getAllByTestId("widget-limit-progress")[0]).toHaveClass("widget-limit-progress-bar");

    widget.value = {
      ...widget.value,
      prefs: { ...widget.value.prefs, expanded: true },
    };
    rerender(<DesktopWidgetPage />);
    const planCards = screen.getAllByTestId("widget-expanded-limit-plan");
    expect(planCards).toHaveLength(2);
    const cursorCard = planCards.find((card) => within(card).queryByText("Cursor · Pro"));
    expect(cursorCard).toBeDefined();
    expect(within(cursorCard!).getByText("ezequielhuelsxw@outlook.com")).toBeInTheDocument();
    expect(within(cursorCard!).getByText("Weekly")).toBeInTheDocument();
    expect(within(cursorCard!).getByText(formatCompactReset("2026-08-20T03:33:00.000Z")))
      .toBeInTheDocument();
    expect(within(cursorCard!).getByText(formatCompactValidity("2026-08-30T14:24:00.000Z")))
      .toBeInTheDocument();
    expect(screen.queryAllByText("1w")).toHaveLength(0);
    expect(screen.getAllByText("5h")).not.toHaveLength(0);
    expect(screen.queryByText("备用周额度")).not.toBeInTheDocument();
    expect(screen.queryByText("主力开发账号")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("widget-limit-progress")).toHaveLength(4);
    expect(screen.queryAllByTestId("widget-traffic-light")).toHaveLength(0);
    now.mockRestore();
  });

  it("falls back to the provider name when both plan and account labels are unavailable", () => {
    widget.value = {
      ...widget.value,
      prefs: { ...prefs, mode: "limits", selectedLimitIds: ["codex:default:5h"] },
      viewModel: {
        ...viewModel,
        limits: [{
          ...viewModel.limits[0],
          planLabel: "",
          accountLabel: "",
        }],
      },
    };

    const { rerender } = render(<DesktopWidgetPage />);

    expect(screen.getByText(/^Codex$/u)).toBeInTheDocument();
    expect(screen.queryByText(/^Codex\s*·/u)).not.toBeInTheDocument();

    widget.value = {
      ...widget.value,
      prefs: { ...widget.value.prefs, expanded: true },
    };
    rerender(<DesktopWidgetPage />);

    const expandedPlan = screen.getByTestId("widget-expanded-limit-plan");
    expect(within(expandedPlan).getByText(/^Codex$/u)).toBeInTheDocument();
    expect(screen.queryByText(/^Codex\s*·/u)).not.toBeInTheDocument();
  });

  it("keeps all ten three-window plans reachable through the expanded scroll region", () => {
    const denseLimits = Array.from({ length: 10 }, (_, planIndex) => (
      ["5h", "1w", "API Usage"].map((window, windowIndex) => ({
        ...viewModel.limits[0],
        id: `codex:plan-${planIndex}:window-${windowIndex}`,
        planId: `codex:plan-${planIndex}`,
        planLabel: `Plan ${planIndex + 1}`,
        accountLabel: "",
        window,
        usedPercent: planIndex * 10 + windowIndex,
      }))
    )).flat();
    widget.value = {
      ...widget.value,
      prefs: { ...prefs, expanded: false, mode: "limits", selectedLimitIds: null },
      viewModel: { ...viewModel, limits: denseLimits },
    };

    const { rerender } = render(<DesktopWidgetPage />);
    expect(screen.queryByText("Codex · Plan 10")).not.toBeInTheDocument();

    widget.value = {
      ...widget.value,
      prefs: { ...widget.value.prefs, expanded: true },
    };
    rerender(<DesktopWidgetPage />);

    const scrollRegion = document.querySelector("[data-widget-scroll-region]");
    const plans = screen.getAllByTestId("widget-expanded-limit-plan");
    expect(plans).toHaveLength(10);
    expect(plans.every((plan) => within(plan).getAllByTestId("widget-limit-progress").length === 3)).toBe(true);
    expect(within(plans.at(-1)!).getByText("Codex · Plan 10")).toBeInTheDocument();
    expect(scrollRegion).toContainElement(plans.at(-1)!);
    expect(widgetStyles).toMatch(/\.widget-scroll-region\s*\{[^}]*overflow-y:\s*auto/s);
  });

  it("keeps each mode's collapsed summary unchanged when the detail panel expands", () => {
    const summaryText = () => screen.getByTestId("widget-drag-surface").textContent;
    const cases = ["projects", "limits", "models"] as const;

    for (const mode of cases) {
      widget.value = { ...widget.value, prefs: { ...prefs, mode, expanded: false } };
      const { rerender, unmount } = render(<DesktopWidgetPage />);
      const collapsed = summaryText();

      widget.value = { ...widget.value, prefs: { ...prefs, mode, expanded: true } };
      rerender(<DesktopWidgetPage />);
      expect(summaryText()).toBe(collapsed);
      unmount();
    }
  });

  it("keeps the agent icon geometry stable across collapse and expand", () => {
    const { rerender } = render(<DesktopWidgetPage />);
    const collapsedIcon = screen.getByRole("button", { name: "copy:widget.expand" })
      .querySelector("img");
    expect(collapsedIcon).toHaveAttribute("width", "27");
    expect(collapsedIcon).toHaveAttribute("height", "27");

    widget.value = { ...widget.value, prefs: { ...prefs, expanded: true } };
    rerender(<DesktopWidgetPage />);
    const expandedIcon = screen.getByRole("button", { name: "copy:widget.collapse" })
      .querySelector("img");
    expect(expandedIcon).toHaveAttribute("width", "27");
    expect(expandedIcon).toHaveAttribute("height", "27");
  });

  it("treats a missing limit selection as all plans and an empty selection as none", () => {
    widget.value = {
      ...widget.value,
      prefs: { ...prefs, mode: "limits", selectedLimitIds: null },
    };
    const { rerender } = render(<DesktopWidgetPage />);
    expect(screen.getByText(/Codex · Plus/u)).toBeInTheDocument();
    expect(screen.queryByText("5h")).not.toBeInTheDocument();

    widget.value = {
      ...widget.value,
      prefs: { ...prefs, mode: "limits", selectedLimitIds: [] },
    };
    rerender(<DesktopWidgetPage />);
    expect(screen.getByText("copy:widget.empty")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-limit-progress")).not.toBeInTheDocument();
  });

  it("hides inactive models from expanded model consumption", () => {
    widget.value = {
      ...widget.value,
      prefs: { ...prefs, expanded: true, mode: "models" },
    };
    render(<DesktopWidgetPage />);
    expect(screen.getByText("gpt-5-codex")).toBeInTheDocument();
    expect(screen.getByText("12,345 · 100%")).toBeInTheDocument();
    expect(screen.getByTestId("widget-model-tone")).toHaveAttribute("data-tone", "0");
    expect(screen.queryByText("inactive-model")).not.toBeInTheDocument();
  });

  it("uses one scroll region for expanded limit and model details", () => {
    widget.value = {
      ...widget.value,
      prefs: { ...prefs, expanded: true, mode: "limits" },
    };
    const { rerender } = render(<DesktopWidgetPage />);
    expect(screen.getAllByTestId("widget-limit-progress")).not.toHaveLength(0);
    expect(screen.getAllByText("42%")).not.toHaveLength(0);
    expect(document.querySelectorAll("[data-widget-scroll-region]")).toHaveLength(1);

    widget.value = {
      ...widget.value,
      prefs: { ...prefs, expanded: false, mode: "models" },
    };
    rerender(<DesktopWidgetPage />);
    const capsule = screen.getByTestId("widget-model-summary");
    expect(capsule).toHaveTextContent("1.2万");
    expect(capsule).toHaveTextContent("$1.25");
    expect(capsule).not.toHaveTextContent("gpt-5-codex");
  });

  it("keeps the collapsed model summary compact above the Pill Nav", () => {
    widget.value = {
      ...widget.value,
      prefs: { ...prefs, expanded: false, mode: "models" },
    };
    render(<DesktopWidgetPage />);

    const capsule = screen.getByTestId("widget-model-summary");
    expect(capsule).toHaveTextContent("copy:widget.models.tokens");
    expect(capsule).toHaveTextContent("1.2万");
    expect(capsule).toHaveTextContent("copy:widget.models.cost");
    expect(capsule).toHaveTextContent("$1.25");

    const rule = (selector: string) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = [
        ...widgetStyles.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g")),
      ];
      return matches.at(-1)?.[1] ?? "";
    };
    expect(rule(".widget-summary")).toContain("align-self: stretch");
    expect(widgetStyles).toMatch(
      /\.desktop-widget-card--reference-dock \.widget-model-summary\s*\{[^}]*max-height: 23px/u,
    );
    expect(widgetStyles).toMatch(
      /\.desktop-widget-card--reference-dock \.widget-model-summary small\s*\{[^}]*line-height: 9px/u,
    );
    expect(widgetStyles).toMatch(
      /\.desktop-widget-card--reference-dock \.widget-model-summary strong\s*\{[^}]*line-height: 14px/u,
    );
  });

  it("portals appearance controls outside the capsule and temporarily expands the native window", async () => {
    const user = userEvent.setup();
    render(<DesktopWidgetPage />);
    await user.click(screen.getByRole("button", { name: "copy:widget.appearance" }));
    const card = screen.getByTestId("desktop-widget-card");
    const dialog = screen.getByRole("dialog", { name: "copy:widget.appearance" });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveAttribute("data-text-contrast", "light");
    expect(within(card).queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("radio")).toHaveLength(4);
    expect(within(dialog).getByRole("slider", { name: "copy:widget.opacity" })).toBeInTheDocument();
    expect(screen.getAllByTestId("desktop-widget-card")).toHaveLength(1);
    expect(widget.setPopoverOpen).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole("button", { name: "copy:widget.appearance.close" }));
    expect(screen.queryByRole("dialog", { name: "copy:widget.appearance" })).not.toBeInTheDocument();
    expect(widget.setPopoverOpen).toHaveBeenCalledWith(false);
  });

  it("shows the reset-history selected effect over the stable widget instead of an acknowledgement button", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("token-eyes:reset-celebration-effect:v1", "fireworks");
    widget.value = {
      ...widget.value,
      viewModel: {
        ...viewModel,
        pendingReset: {
          id: "reset-1",
          agent: "codex",
          window: "rolling_5_hour",
          occurredAt: "2026-07-29T06:00:00.000Z",
          previousUsedPercent: 21,
          currentUsedPercent: 0,
        },
      },
    };
    try {
      render(<DesktopWidgetPage />);

      expect(screen.getByTestId("desktop-widget-card"))
        .toHaveClass("desktop-widget-card--reference-dock");
      expect(screen.getByTestId("widget-reset-celebration"))
        .toHaveAttribute("data-effect-id", "fireworks");
      act(() => {
        window.localStorage.setItem("token-eyes:reset-celebration-effect:v1", "meteors");
        window.dispatchEvent(new CustomEvent(
          "token-eyes:reset-celebration-effect-change",
          { detail: { effectId: "meteors" } },
        ));
      });
      expect(screen.getByTestId("widget-reset-celebration"))
        .toHaveAttribute("data-effect-id", "meteors");
      expect(readFileSync("src/pages/DesktopWidgetPage.tsx", "utf8")).toContain("fitToHost");
      expect(readFileSync("src/pages/DesktopWidgetPage.tsx", "utf8")).not.toContain("surroundMeteors");
      expect(screen.getByRole("button", { name: "copy:widget.reset.acknowledge" }))
        .toHaveClass("widget-reset-celebration__dismiss");
      expect(widgetStyles).toContain("top: calc(var(--widget-effect-halo, 140px) + 10px);");
      expect(widgetStyles).toContain("right: calc(var(--widget-effect-halo, 140px) + 15px);");
      expect(widgetStyles).toContain(".widget-reset-celebration__dismiss svg { width: 16px; height: 16px; }");
      expect(widget.acknowledgePendingReset).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(widget.acknowledgePendingReset).not.toHaveBeenCalled();
      expect(widget.setCelebrationOpen).toHaveBeenCalledWith(true);

      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByRole("button", { name: "copy:widget.reset.acknowledge" }),
      );
      expect(widget.setCelebrationOpen).toHaveBeenCalledWith(false);
      expect(widget.acknowledgePendingReset).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('preserves unknown widget cost while formatting genuine zero',()=>{
 expect(formatWidgetCompactCost(null)).toBe('—');
 expect(formatWidgetCompactCost(0)).toBe('$0');
});
