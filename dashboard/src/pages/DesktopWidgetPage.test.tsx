import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const widget = vi.hoisted(() => ({
  updatePrefs: vi.fn(),
  acknowledgePendingReset: vi.fn(),
  value: {} as any,
}));

vi.mock("../hooks/use-desktop-widget", () => ({
  useDesktopWidget: () => widget.value,
}));
vi.mock("../lib/copy", () => ({
  copy: (key: string) => `copy:${key}`,
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
    widget.acknowledgePendingReset.mockReset().mockResolvedValue(undefined);
    widget.value = {
      prefs,
      viewModel,
      loading: false,
      error: null,
      updatePrefs: widget.updatePrefs,
      acknowledgePendingReset: widget.acknowledgePendingReset,
    };
  });

  it("keeps one card, separates expand and agent controls, and portals menus", async () => {
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
    expect(within(agentMenu).getAllByRole("menuitemradio")).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: "copy:widget.mode_menu" }));
    const modeMenu = screen.getByRole("menu", { name: "copy:widget.mode_menu" });
    expect(modeMenu.parentElement).toBe(document.body);
    expect(within(modeMenu).getAllByRole("menuitemradio")).toHaveLength(3);
  });

  it("renders all three traffic lights and grays zero counts", () => {
    render(<DesktopWidgetPage />);
    const lights = screen.getAllByTestId("widget-traffic-light");
    expect(lights).toHaveLength(3);
    expect(lights[0]).toHaveAttribute("data-active", "false");
    expect(lights[1]).toHaveAttribute("data-active", "true");
    expect(lights[2]).toHaveAttribute("data-active", "false");
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

  it("keeps appearance controls inside the same card", async () => {
    const user = userEvent.setup();
    render(<DesktopWidgetPage />);
    await user.click(screen.getByRole("button", { name: "copy:widget.appearance" }));
    const card = screen.getByTestId("desktop-widget-card");
    expect(within(card).getAllByRole("radio")).toHaveLength(4);
    expect(within(card).getByRole("slider", { name: "copy:widget.opacity" })).toBeInTheDocument();
    expect(screen.getAllByTestId("desktop-widget-card")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "copy:widget.appearance.close" }));
    expect(screen.queryByRole("dialog", { name: "copy:widget.appearance" })).not.toBeInTheDocument();
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
