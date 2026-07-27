import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// 02-前端交互与订阅契约修复: REAL render reproduction of F3.
//
// The prior "pass" only copied the flatMap code and asserted on labels — it
// never rendered the CommandPalette component, never sent Ctrl+K, and never
// rendered item.Icon (the exact thing that crashed). This file renders the
// real component, opens the palette via Ctrl+K, and clicks the secondary-nav
// children that have NO icon of their own (spend/settings children inherit
// the parent group icon). Before the fix this throws React issue 130 ("Element
// type is invalid: ... got undefined") and the dialog never appears.

// Mock motion/react so jsdom (no matchMedia) doesn't break useReducedMotion
// and animations render synchronously. Motion-only props are stripped so they
// are not spread onto the DOM (which would trigger React warnings).
const MOTION_PROPS = new Set(["initial", "animate", "exit", "transition", "variants", "whileHover", "whileTap", "whileFocus", "layout", "layoutId"]);
vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }) => {
      const domProps = {};
      for (const k of Object.keys(props)) if (!MOTION_PROPS.has(k)) domProps[k] = props[k];
      return <div {...domProps}>{children}</div>;
    },
  },
  useReducedMotion: () => true,
}));

vi.mock("../../../../lib/copy", () => ({
  copy: (key) => key,
}));

// CommandPalette imports getInstalledSkills from skills-api and calls it when
// open on localhost. Mock it so no real fetch happens.
vi.mock("../../../../lib/skills-api", () => ({
  getInstalledSkills: vi.fn().mockResolvedValue({ skills: [] }),
}));

// Spy on useNavigate so we can assert which URL a clicked item navigates to.
const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigateSpy };
});

import { CommandPalette } from "../CommandPalette.jsx";
import { getNavGroups } from "../../../components/Sidebar.jsx";

function renderPalette() {
  return render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );
}

// Ctrl+K is a window-level keydown with the ctrl modifier.
function openWithCtrlK() {
  act(() => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
}

describe("CommandPalette + getNavGroups regression (data shape)", () => {
  it("getNavGroups returns groups with either items or children", () => {
    const groups = getNavGroups();
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      const entries = group.items || group.children;
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
    }
  });

  it("getNavGroups includes spend and settings children as navigable pages", () => {
    const groups = getNavGroups();
    const allEntries = groups.flatMap((g) => g.items || g.children || []);
    const ids = allEntries.map((e) => e.id);
    expect(ids).toContain("spend-usage");
    expect(ids).toContain("spend-cost");
    expect(ids).toContain("settings-basic");
    expect(ids).toContain("settings-cost");
  });
});

describe("CommandPalette real render (F3 reproduction)", () => {
  beforeEach(() => {
    navigateSpy.mockClear();
  });

  it("Ctrl+K opens the command palette dialog without crashing", async () => {
    renderPalette();
    // Dialog is absent before the shortcut.
    expect(screen.queryByRole("dialog")).toBeNull();
    openWithCtrlK();
    // The dialog must appear — before the fix, rendering the secondary-nav
    // children (which have no icon) threw React issue 130 and the dialog never
    // mounted.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("lists only the approved overview and secondary-nav pages", async () => {
    renderPalette();
    openWithCtrlK();
    const dialog = await screen.findByRole("dialog");
    // All seven navigable pages must render as option buttons.
    const expectedLabels = [
      "nav.usage",
      "nav.leaderboard",
      "nav.reset_history",
      "nav.spend.usage",
      "nav.spend.cost",
      "nav.settings.basic",
      "nav.settings.cost",
    ];
    for (const label of expectedLabels) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    // No React error boundary swallowed the list — there are 6 page options.
    const options = within(dialog).getAllByRole("option");
    expect(options.length).toBe(7);
  });

  it("clicking a secondary-nav child navigates to the correct URL", async () => {
    renderPalette();
    openWithCtrlK();
    const dialog = await screen.findByRole("dialog");
    // Click the "成本设置" child (settings-cost → /settings/cost).
    const costSettingsItem = within(dialog).getByText("nav.settings.cost");
    await act(async () => {
      fireEvent.click(costSettingsItem);
    });
    expect(navigateSpy).toHaveBeenCalledWith("/settings/cost");
  });

  it("clicking the cost-accumulation child navigates to /spend/cost", async () => {
    renderPalette();
    openWithCtrlK();
    const dialog = await screen.findByRole("dialog");
    const costItem = within(dialog).getByText("nav.spend.cost");
    await act(async () => {
      fireEvent.click(costItem);
    });
    expect(navigateSpy).toHaveBeenCalledWith("/spend/cost");
  });

  it("Escape closes the palette", async () => {
    renderPalette();
    openWithCtrlK();
    const dialog = await screen.findByRole("dialog");
    // Escape is handled on the search input's onKeyDown, not on window.
    const input = within(dialog).getByRole("combobox");
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("rapid Ctrl+K toggle does not crash (open → close → open)", async () => {
    renderPalette();
    openWithCtrlK();
    await screen.findByRole("dialog");
    // Close again with Ctrl+K.
    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Re-open — must still work without crashing.
    openWithCtrlK();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
