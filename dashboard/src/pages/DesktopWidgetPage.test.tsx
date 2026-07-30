import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const widget = vi.hoisted(() => ({
  updatePrefs: vi.fn(),
  setPopoverOpen: vi.fn(),
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

import { DesktopWidgetPage } from "./DesktopWidgetPage";

const prefs = {
  version: 1,
  visible: true,
  width: 322,
  height: 160,
  scaleFactor: 1,
  selectedAgent: "codex",
  mode: "projects",
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
    },
  ],
  totals: {
    tokens: 12_345,
    costUsd: 1.25,
    models: [{ name: "gpt-5-codex", tokens: 12_345, share: 100, costUsd: 1.25 }],
  },
  pendingReset: null,
};

describe("DesktopWidgetPage", () => {
  beforeEach(() => {
    widget.updatePrefs.mockReset().mockResolvedValue(undefined);
    widget.setPopoverOpen.mockReset().mockResolvedValue(undefined);
    widget.acknowledgePendingReset.mockReset().mockResolvedValue(undefined);
    startDragging.mockReset().mockResolvedValue(undefined);
    widget.value = {
      prefs,
      viewModel,
      loading: false,
      error: null,
      updatePrefs: widget.updatePrefs,
      setPopoverOpen: widget.setPopoverOpen,
      acknowledgePendingReset: widget.acknowledgePendingReset,
    };
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

  it("renders all three traffic lights and grays zero counts", () => {
    render(<DesktopWidgetPage />);
    const lights = screen.getAllByTestId("widget-traffic-light");
    expect(lights).toHaveLength(3);
    expect(lights[0]).toHaveAttribute("data-active", "false");
    expect(lights[1]).toHaveAttribute("data-active", "true");
    expect(lights[2]).toHaveAttribute("data-active", "false");
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

    const taskTitle = screen.getByText(officialTitle);
    const taskRow = taskTitle.closest(".widget-session");
    expect(taskRow).toHaveTextContent("copy:widget.session_state.stopped");
    expect(taskRow).toHaveAttribute("title", expect.stringContaining("5a8f6b4a6892".slice(-8)));
    expect(screen.queryByText("019f9c26-1e55-7100-bc08-5a8f6b4a6892")).not.toBeInTheDocument();
    expect(screen.queryByText("019-untitled-session")).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp("\u7684\u4f1a\u8bdd$", "u"))).toBeInTheDocument();
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
    expect(capsule).toHaveTextContent("12,345");
    expect(capsule).toHaveTextContent("$1.25");
    expect(capsule).not.toHaveTextContent("gpt-5-codex");
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

  it("keeps a reset alert until the user acknowledges it without navigation", async () => {
    const user = userEvent.setup();
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
    render(<DesktopWidgetPage />);

    const alert = screen.getByRole("button", { name: "copy:widget.reset.acknowledge" });
    expect(alert).toHaveTextContent("copy:widget.reset.title");
    expect(alert).toHaveTextContent("21% → 0%");
    expect(document.querySelector("a")).toBeNull();
    await user.click(alert);
    expect(widget.acknowledgePendingReset).toHaveBeenCalledTimes(1);
  });
});
