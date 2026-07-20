import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNavGroups, AppLayout } from "../Sidebar.jsx";

const codexResetContext = vi.hoisted(() => ({
  value: {
    events: [],
    unreadCount: 0,
    acknowledge: vi.fn(),
  },
}));

// Sidebar two-level navigation tests for the v2.0 IA refactor (work order 01).
// Verifies parent/child structure, activation, expansion, and that the
// mobile drawer shares the same nav data and behavior.

// Mock paths resolve from the test file's directory
// (dashboard/src/ui/components/__tests__/), so they need three `..` segments
// to reach dashboard/src/. Vitest matches mocks by the resolved absolute
// module path, so these intercept the same modules Sidebar.jsx imports via
// two `..` segments from its own directory.
vi.mock("../../../lib/copy", () => ({
  copy: (key) => `copy:${key}`,
}));

vi.mock("../../../lib/cn", () => ({
  cn: (...args) => args.filter(Boolean).join(" "),
}));

vi.mock("../../../hooks/useTheme.js", () => ({
  useTheme: () => ({
    theme: "system",
    resolvedTheme: "light",
    setTheme: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useLocale.js", () => ({
  useLocale: () => ({ resolvedLocale: "en" }),
}));

vi.mock("../../../components/InsforgeUserHeaderControls.jsx", () => ({
  InsforgeUserHeaderControls: () => <div data-testid="user-controls" />,
}));

vi.mock("../../../lib/native-bridge.js", () => ({
  isNativeApp: () => false,
  isNativeEmbed: () => false,
  isNativeWindowsApp: () => false,
}));

vi.mock("../../../hooks/use-codex-reset-events", () => ({
  useCodexResetEvents: () => codexResetContext.value,
}));

describe("getNavGroups structure (v2.0 IA)", () => {
  it("returns overview and leaderboard items + spend and settings parents with children", () => {
    const groups = getNavGroups();
    // Three top-level groups: overview, spend, settings
    expect(groups).toHaveLength(3);

    const overview = groups.find((g) => g.id === "overview");
    expect(overview).toBeDefined();
    expect(overview.items).toHaveLength(2);
    expect(overview.items[0].to).toBe("/dashboard");
    expect(overview.items[1]).toMatchObject({
      id: "leaderboard",
      to: "/leaderboard",
      label: "copy:nav.leaderboard",
    });

    const spend = groups.find((g) => g.id === "spend");
    expect(spend).toBeDefined();
    expect(spend.children).toBeDefined();
    const spendChildTos = spend.children.map((c) => c.to);
    expect(spendChildTos).toEqual(["/spend/usage", "/spend/cost"]);
    expect(spend.defaultChildTo).toBe("/spend/usage");

    const settings = groups.find((g) => g.id === "settings");
    expect(settings).toBeDefined();
    expect(settings.children).toBeDefined();
    const settingsChildTos = settings.children.map((c) => c.to);
    expect(settingsChildTos).toEqual(["/settings/basic", "/settings/cost"]);
    expect(settings.defaultChildTo).toBe("/settings/basic");
  });

  it("parents carry an icon and label; children carry a label and to", () => {
    const groups = getNavGroups();
    const spend = groups.find((g) => g.id === "spend");
    expect(spend.icon).toBeDefined();
    expect(typeof spend.label).toBe("string");
    spend.children.forEach((child) => {
      expect(typeof child.label).toBe("string");
      expect(typeof child.to).toBe("string");
    });
  });
});

function renderSidebar(path = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout>
        <div data-testid="page-content">page</div>
      </AppLayout>
    </MemoryRouter>,
  );
}

describe("Sidebar two-level nav rendering (desktop)", () => {
  beforeEach(() => {
    codexResetContext.value.unreadCount = 0;
    // jsdom doesn't implement layout, so the desktop <aside> is always in
    // the DOM (lg:hidden only affects CSS, not presence). These tests rely
    // on that so we can assert nav structure without a real viewport.
  });

  it("shows Codex reset attention on settings and the cost child", () => {
    codexResetContext.value.unreadCount = 1;
    renderSidebar("/settings/cost");
    expect(
      screen.getAllByLabelText("copy:codex_reset.nav.unread").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("renders overview, leaderboard, spend parent, and settings parent labels", () => {
    renderSidebar("/dashboard");
    expect(screen.getByText("copy:nav.usage")).toBeInTheDocument();
    expect(screen.getByText("copy:nav.leaderboard")).toBeInTheDocument();
    expect(screen.getByText("copy:nav.group.spend")).toBeInTheDocument();
    expect(screen.getByText("copy:nav.group.settings")).toBeInTheDocument();
  });

  it("renders spend children labels (使用统计 / 成本累积)", () => {
    renderSidebar("/spend/usage");
    expect(screen.getByText("copy:nav.spend.usage")).toBeInTheDocument();
    expect(screen.getByText("copy:nav.spend.cost")).toBeInTheDocument();
  });

  it("renders settings children labels (基础设置 / 成本设置)", () => {
    renderSidebar("/settings/basic");
    expect(screen.getByText("copy:nav.settings.basic")).toBeInTheDocument();
    expect(screen.getByText("copy:nav.settings.cost")).toBeInTheDocument();
  });

  it("spend parent is active when on /spend/usage and child is highlighted", () => {
    renderSidebar("/spend/usage");
    const spendParent = screen.getByRole("button", { name: /copy:nav\.group\.spend/ });
    expect(spendParent).toHaveAttribute("aria-current", "page");
    const usageChild = screen.getByRole("link", { name: "copy:nav.spend.usage" });
    expect(usageChild).toHaveAttribute("aria-current", "page");
  });

  it("spend parent is active when on /spend/cost", () => {
    renderSidebar("/spend/cost");
    const spendParent = screen.getByRole("button", { name: /copy:nav\.group\.spend/ });
    expect(spendParent).toHaveAttribute("aria-current", "page");
    const costChild = screen.getByRole("link", { name: "copy:nav.spend.cost" });
    expect(costChild).toHaveAttribute("aria-current", "page");
  });

  it("settings parent is active when on /settings/basic", () => {
    renderSidebar("/settings/basic");
    const settingsParent = screen.getByRole("button", { name: /copy:nav\.group\.settings/ });
    expect(settingsParent).toHaveAttribute("aria-current", "page");
  });

  it("settings parent is active when on /settings/cost", () => {
    renderSidebar("/settings/cost");
    const settingsParent = screen.getByRole("button", { name: /copy:nav\.group\.settings/ });
    expect(settingsParent).toHaveAttribute("aria-current", "page");
  });

  it("overview is NOT active when on a spend sub-route", () => {
    renderSidebar("/spend/usage");
    const overviewLink = screen.getByRole("link", { name: "copy:nav.usage" });
    expect(overviewLink).not.toHaveAttribute("aria-current", "page");
  });

  it("leaderboard is active on the leaderboard route", () => {
    renderSidebar("/leaderboard");
    expect(screen.getByRole("link", { name: "copy:nav.leaderboard" }))
      .toHaveAttribute("aria-current", "page");
  });

  it("parent button has aria-expanded reflecting children visibility", () => {
    renderSidebar("/dashboard");
    const spendParent = screen.getByRole("button", { name: /copy:nav\.group\.spend/ });
    // aria-expanded must be present (true or false) per a11y requirement.
    expect(spendParent).toHaveAttribute("aria-expanded");
  });

  it("clicking spend parent navigates to /spend/usage (default child)", async () => {
    const user = userEvent.setup();
    renderSidebar("/dashboard");
    const spendParent = screen.getByRole("button", { name: /copy:nav\.group\.spend/ });
    await act(async () => {
      await user.click(spendParent);
    });
    // After click, the default child link is active.
    const usageChild = screen.getByRole("link", { name: "copy:nav.spend.usage" });
    expect(usageChild).toHaveAttribute("aria-current", "page");
  });

  it("clicking an active parent collapses its children and keeps the current route active", async () => {
    const user = userEvent.setup();
    renderSidebar("/spend/usage");
    const spendParent = screen.getByRole("button", { name: /copy:nav\.group\.spend/ });
    expect(screen.getByRole("link", { name: "copy:nav.spend.usage" })).toBeInTheDocument();
    await act(async () => {
      await user.click(spendParent);
    });
    expect(screen.queryByRole("link", { name: "copy:nav.spend.usage" })).not.toBeInTheDocument();
    expect(spendParent).toHaveAttribute("aria-expanded", "false");
    expect(spendParent).toHaveAttribute("aria-current", "page");
  });

  it("keeps an explicitly collapsed active parent closed after route effects run", async () => {
    const user = userEvent.setup();
    renderSidebar("/settings/cost");
    const settingsParent = screen.getByRole("button", { name: /copy:nav\.group\.settings/ });
    await act(async () => {
      await user.click(settingsParent);
    });
    expect(settingsParent).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "copy:nav.settings.cost" })).not.toBeInTheDocument();
  });

  it("children sub-navigation has an accessible label", () => {
    renderSidebar("/spend/usage");
    // The children container exposes an aria-label so screen readers can
    // identify the sub-navigation group.
    const labelled = screen.getAllByLabelText(/copy:nav\.group\.spend/);
    expect(labelled.length).toBeGreaterThan(0);
  });

  it("parent button is keyboard focusable (renders as <button>)", () => {
    renderSidebar("/dashboard");
    const spendParent = screen.getByRole("button", { name: /copy:nav\.group\.spend/ });
    expect(spendParent.tagName).toBe("BUTTON");
  });
});
