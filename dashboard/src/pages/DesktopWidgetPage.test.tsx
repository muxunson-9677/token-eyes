import React from "react";
// Vitest provides Node at runtime; this project intentionally omits Node type declarations.
// @ts-expect-error node:fs is available in the Vitest runtime
import { readFileSync } from "node:fs";
import { act, render, screen, within } from "@testing-library/react";
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
  formatWidgetCompactCost,
  formatWidgetCompactTokenCount,
} from "./DesktopWidgetPage";

const widgetStyles = readFileSync("src/pages/desktop-widget.css", "utf8");

const prefs = {
  version: 1,
  visible: true,
  width: 322,
  height: 160,
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
      agent: "codex",
      provider: "Codex",
      accountLabel: "Plus",
      window: "5h",
      usedPercent: 42,
      resetAt: null,
      error: null,
      notes: "主力开发账号",
    },
    {
      id: "codex:default:weekly",
      agent: "codex",
      provider: "Codex",
      accountLabel: "Plus",
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
    expect(within(agentMenu).getAllByRole("menuitemradio")).toHaveLength(5);
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
  });

  it("keeps the external mode rail beside the card in both widget states", () => {
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
    expect(widgetStyles).toContain(".widget-mode-rail--reference-dock {\n  align-self: start;\n  margin-top: 4px;");
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

  it("keeps project selection out of the desktop capsule", () => {
    render(<DesktopWidgetPage />);
    expect(
      screen.queryByRole("button", { name: "copy:widget.projects.filter" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menu", { name: "copy:widget.projects.filter" }),
    ).not.toBeInTheDocument();
  });

  it("keeps selected project folders visible with an empty state when no session is active", () => {
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

  it("shows only the first selected limit while collapsed and keeps the reference status lights above all expanded limits", () => {
    widget.value = {
      ...widget.value,
      prefs: {
        ...prefs,
        mode: "limits",
        selectedLimitIds: ["codex:default:weekly", "codex:default:5h"],
      },
    };
    const { rerender } = render(<DesktopWidgetPage />);
    expect(screen.getByText("1w")).toBeInTheDocument();
    expect(screen.getByText("备用周额度")).toBeInTheDocument();
    expect(screen.queryByText("主力开发账号")).not.toBeInTheDocument();
    expect(screen.queryByText("5h")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("widget-limit-progress")).toHaveLength(1);
    expect(screen.getByTestId("widget-limit-progress")).toHaveClass("widget-limit-progress-bar");

    widget.value = {
      ...widget.value,
      prefs: { ...widget.value.prefs, expanded: true },
    };
    rerender(<DesktopWidgetPage />);
    expect(screen.getAllByText("1w")).not.toHaveLength(0);
    expect(screen.getAllByText("5h")).not.toHaveLength(0);
    expect(screen.getAllByText("备用周额度")).not.toHaveLength(0);
    expect(screen.getAllByText("主力开发账号")).not.toHaveLength(0);
    expect(screen.getAllByTestId("widget-limit-progress")).toHaveLength(2);
    expect(screen.getAllByTestId("widget-traffic-light")).toHaveLength(3);
  });

  it("treats a missing limit selection as all plans and an empty selection as none", () => {
    widget.value = {
      ...widget.value,
      prefs: { ...prefs, mode: "limits", selectedLimitIds: null },
    };
    const { rerender } = render(<DesktopWidgetPage />);
    expect(screen.getByText("5h")).toBeInTheDocument();

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
      expect(screen.getByRole("button", { name: "copy:widget.reset.acknowledge" }))
        .toHaveClass("widget-reset-celebration__dismiss");
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
