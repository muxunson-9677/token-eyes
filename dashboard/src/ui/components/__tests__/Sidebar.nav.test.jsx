import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNavGroups, AppLayout } from "../Sidebar.jsx";

const { authContext, codexResetContext, nativeBridgeContext, setTheme } = vi.hoisted(() => ({
  authContext: {
    value: {
      enabled: true,
      loading: false,
      signedIn: false,
      user: null,
      displayName: "",
    },
  },
  codexResetContext: {
    value: {
      events: [],
      unreadCount: 0,
      acknowledge: vi.fn(),
    },
  },
  nativeBridgeContext: { windows: false },
  setTheme: vi.fn(),
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
    setTheme,
  }),
}));

vi.mock("../../../hooks/useLocale.js", () => ({
  useLocale: () => ({ resolvedLocale: "en" }),
}));

vi.mock("../../../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => authContext.value,
}));

vi.mock("../../../contexts/LoginModalContext.jsx", () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}));

vi.mock("../../../lib/native-bridge.js", () => ({
  isNativeApp: () => nativeBridgeContext.windows,
  isNativeEmbed: () => false,
  isTauriApp: () => nativeBridgeContext.windows,
  isNativeWindowsApp: () => nativeBridgeContext.windows,
}));

vi.mock("../NativeWindowBar.jsx", () => ({
  NativeWindowBar: () => <header data-testid="native-window-bar" />,
}));

vi.mock("../../../hooks/use-codex-reset-events", () => ({
  useCodexResetEvents: () => codexResetContext.value,
}));

describe("getNavGroups structure (v2.0 IA)", () => {
  it("keeps core routes primary and moves optional features into More", () => {
    const groups = getNavGroups();
    expect(groups).toHaveLength(3);

    const overview = groups.find((g) => g.id === "overview");
    expect(overview).toBeDefined();
    expect(overview.items.map((item) => item.id)).toEqual([
      "usage",
      "leaderboard",
      "reset-history",
      "widgets",
    ]);
    expect(overview.items[1]).toMatchObject({ id: "leaderboard", to: "/leaderboard" });
    expect(overview.items[2]).toMatchObject({
      id: "reset-history",
      to: "/reset-history",
      label: "copy:nav.reset_history",
      codexResetAttention: true,
    });
    expect(overview.items[3]).toMatchObject({
      id: "widgets",
      to: "/widgets",
      label: "copy:nav.widgets",
    });
    expect(groups.flatMap((group) => group.items ?? []).some((item) => item.to === "/data-sources"))
      .toBe(false);

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
    expect(settingsChildTos).toEqual(["/settings/basic", "/settings/cost", "/settings/data"]);
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
    authContext.value = {
      enabled: true,
      loading: false,
      signedIn: false,
      user: null,
      displayName: "",
    };
    codexResetContext.value.unreadCount = 0;
    nativeBridgeContext.windows = false;
    setTheme.mockClear();
    window.localStorage.clear();
    document.documentElement.classList.remove("native-windows-app");
    // jsdom doesn't implement layout, so the desktop <aside> is always in
    // the DOM (lg:hidden only affects CSS, not presence). These tests rely
    // on that so we can assert nav structure without a real viewport.
  });

  it("shows Codex reset attention only on the reset-history item", () => {
    codexResetContext.value.unreadCount = 1;
    renderSidebar("/reset-history");
    expect(screen.getAllByLabelText("copy:codex_reset.nav.unread")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /copy:nav\.reset_history/ }))
      .toHaveLength(1);
  });

  it("keeps only the user-approved pending widgets route in the overview navigation", () => {
    renderSidebar("/dashboard");
    expect(screen.getByText("copy:nav.usage")).toBeInTheDocument();
    expect(screen.getByText("copy:nav.leaderboard")).toBeInTheDocument();
    expect(screen.getByText("copy:nav.reset_history")).toBeInTheDocument();
    expect(screen.queryByText("copy:nav.limits")).not.toBeInTheDocument();
    expect(screen.queryByText("copy:nav.skills")).not.toBeInTheDocument();
    expect(screen.getByText("copy:nav.widgets")).toBeInTheDocument();
    expect(screen.queryByText("copy:nav.ip_check")).not.toBeInTheDocument();
    expect(screen.getByText("copy:nav.group.spend")).toBeInTheDocument();
    expect(screen.getByText("copy:nav.group.settings")).toBeInTheDocument();
  });

  it("keeps the overview navigation free of the removed group heading and sidebar login", () => {
    renderSidebar("/dashboard");

    expect(screen.queryByText("copy:nav.group.overview")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "copy:header.auth.sign_in_aria" })).not.toBeInTheDocument();
  });

  it("keeps both reference sidebar groups expanded on the overview by default", () => {
    renderSidebar("/dashboard");
    expect(screen.getByRole("button", { name: "copy:nav.group.spend" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "copy:nav.group.settings" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "copy:nav.spend.usage" })).toBeVisible();
    expect(screen.getByRole("link", { name: "copy:nav.settings.data" })).toBeVisible();
  });

  it("renders spend children labels (使用统计 / 成本累积)", () => {
    renderSidebar("/spend/usage");
    expect(screen.getByText("copy:nav.spend.usage")).toBeInTheDocument();
    expect(screen.getByText("copy:nav.spend.cost")).toBeInTheDocument();
  });

  it("renders settings children labels (基础设置 / 成本设置 / 数据与诊断)", () => {
    renderSidebar("/settings/basic");
    expect(screen.getByText("copy:nav.settings.basic")).toBeInTheDocument();
    expect(screen.getByText("copy:nav.settings.cost")).toBeInTheDocument();
    expect(screen.getByText("copy:nav.settings.data")).toBeInTheDocument();
  });

  it("marks the current child page and expands its parent", () => {
    renderSidebar("/spend/usage");
    const spendParent = screen.getByRole("button", { name: /copy:nav\.group\.spend/ });
    expect(spendParent).toHaveAttribute("aria-current", "page");
    expect(spendParent).toHaveAttribute("aria-expanded", "true");
    expect(spendParent).toHaveClass("tt-pressable");
    const usageChild = screen.getByRole("link", { name: "copy:nav.spend.usage" });
    expect(usageChild).toHaveAttribute("aria-current", "page");
    expect(usageChild).toHaveClass("tt-pressable");
  });

  it("marks /spend/cost as the current page", () => {
    renderSidebar("/spend/cost");
    const spendParent = screen.getByRole("button", { name: /copy:nav\.group\.spend/ });
    expect(spendParent).toHaveAttribute("aria-expanded", "true");
    const costChild = screen.getByRole("link", { name: "copy:nav.spend.cost" });
    expect(costChild).toHaveAttribute("aria-current", "page");
  });

  it("expands settings and marks /settings/basic as the current page", () => {
    renderSidebar("/settings/basic");
    const settingsParent = screen.getByRole("button", { name: /copy:nav\.group\.settings/ });
    expect(settingsParent).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "copy:nav.settings.basic" })).toHaveAttribute("aria-current", "page");
  });

  it("expands settings and marks /settings/cost as the current page", () => {
    renderSidebar("/settings/cost");
    const settingsParent = screen.getByRole("button", { name: /copy:nav\.group\.settings/ });
    expect(settingsParent).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "copy:nav.settings.cost" })).toHaveAttribute("aria-current", "page");
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

  it("applies the shared focus hook to single, parent, and child nav items", () => {
    renderSidebar("/spend/usage");

    expect(screen.getByRole("link", { name: "copy:nav.usage" })).toHaveClass("tt-sidebar-focusable");
    expect(screen.getByRole("button", { name: "copy:nav.group.spend" })).toHaveClass("tt-sidebar-focusable");
    expect(screen.getByRole("link", { name: "copy:nav.spend.usage" })).toHaveClass("tt-sidebar-focusable");
  });

  it("reaches a focus-hooked sidebar item by keyboard tabbing", async () => {
    const user = userEvent.setup();
    renderSidebar("/dashboard");
    const overviewLink = screen.getByRole("link", { name: "copy:nav.usage" });

    await user.tab();
    expect(overviewLink).toHaveFocus();
    expect(overviewLink).toHaveClass("tt-sidebar-focusable");
  });

  it("applies the shared focus hook to the theme trigger and choices", async () => {
    const user = userEvent.setup();
    renderSidebar("/dashboard");
    const themeTrigger = screen.getByRole("button", { name: "copy:settings.appearance.theme.label" });

    expect(themeTrigger).toHaveClass("tt-sidebar-focusable");
    await act(async () => {
      await user.click(themeTrigger);
    });

    const menu = screen.getByRole("menu");
    for (const menuItem of within(menu).getAllByRole("menuitem")) {
      expect(menuItem).toHaveClass("tt-sidebar-focusable");
    }
  });

  it("shows the resolved light or dark theme as visible text in the expanded sidebar", () => {
    renderSidebar("/dashboard");
    const themeTrigger = screen.getByRole("button", {
      name: "copy:settings.appearance.theme.label",
    });

    expect(themeTrigger).toHaveClass("tt-theme-trigger");
    expect(themeTrigger).toHaveTextContent("copy:settings.appearance.theme.light");
  });

  it("keeps account and login controls out of both desktop and mobile sidebars", async () => {
    const user = userEvent.setup();
    renderSidebar("/dashboard");

    expect(screen.getByRole("button", { name: "copy:nav.menu" })).toHaveClass("tt-sidebar-focusable");
    expect(screen.getByRole("link", { name: "copy:shared.app_name" })).toHaveClass("tt-sidebar-focusable");
    expect(screen.queryByRole("button", { name: "copy:header.auth.sign_in_aria" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "copy:header.auth.open_settings" })).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "copy:nav.menu" }));
    });

    expect(screen.getByRole("button", { name: "copy:nav.close_menu" })).toHaveClass("tt-sidebar-focusable");
    expect(screen.queryByRole("button", { name: "copy:header.auth.sign_in_aria" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "copy:header.auth.open_settings" })).not.toBeInTheDocument();
  });

  it("does not duplicate the signed-in account control in the left sidebar", () => {
    authContext.value = {
      enabled: true,
      loading: false,
      signedIn: true,
      user: null,
      displayName: "Ada",
    };

    renderSidebar("/dashboard");

    expect(screen.queryByRole("button", { name: "copy:header.auth.open_settings" }))
      .not.toBeInTheDocument();
  });

  it("does not put an account control in the sidebar for signed-in users", () => {
    authContext.value = {
      enabled: true,
      loading: false,
      signedIn: true,
      user: null,
      displayName: "Ada",
    };

    renderSidebar("/dashboard");

    expect(screen.queryByRole("button", { name: "copy:header.auth.open_settings" })).not.toBeInTheDocument();
  });

  it("keeps light, dark, and system choices wired to the existing theme setter", async () => {
    const user = userEvent.setup();
    renderSidebar("/dashboard");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "copy:settings.appearance.theme.label" }));
    });

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "copy:settings.appearance.theme.light" })).toBeInTheDocument();
    const darkItem = within(menu).getByRole("menuitem", { name: "copy:settings.appearance.theme.dark" });
    expect(within(menu).getByRole("menuitem", { name: "copy:settings.appearance.theme.system" })).toBeInTheDocument();

    await act(async () => {
      await user.click(darkItem);
    });
    expect(setTheme).toHaveBeenCalledTimes(1);
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("renders desktop and mobile navigation from the same hierarchy", async () => {
    const user = userEvent.setup();
    renderSidebar("/spend/usage");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "copy:nav.menu" }));
    });

    const navRegions = screen.getAllByRole("navigation", { name: "copy:nav.nav_label" });
    expect(navRegions).toHaveLength(2);
    const sidebars = screen.getAllByRole("complementary", { name: "copy:nav.aside_label" });
    expect(sidebars[1]).toHaveClass("w-[260px]", "max-w-[80vw]");

    const getNavLabels = (nav) => ({
      links: within(nav).getAllByRole("link").map((link) => link.textContent),
      parents: within(nav).getAllByRole("button").map((button) => button.getAttribute("aria-label")),
    });
    expect(getNavLabels(navRegions[1])).toEqual(getNavLabels(navRegions[0]));
  });

  it("switches to the desktop shell at the native 900px minimum width", async () => {
    const user = userEvent.setup();
    renderSidebar("/dashboard");

    const desktopSidebar = screen.getByRole("complementary", { name: "copy:nav.aside_label" });
    expect(desktopSidebar).toHaveClass("hidden", "min-[900px]:flex");

    const menuButton = screen.getByRole("button", { name: "copy:nav.menu" });
    expect(menuButton.parentElement).toHaveClass("min-[900px]:hidden");

    await act(async () => {
      await user.click(menuButton);
    });
    const sidebars = screen.getAllByRole("complementary", { name: "copy:nav.aside_label" });
    expect(sidebars[1].parentElement).toHaveClass("min-[900px]:hidden");
  });

  it("uses the same locked overview route identity for / and /dashboard", () => {
    nativeBridgeContext.windows = true;

    const rootView = renderSidebar("/");

    expect(screen.getByTestId("native-window-bar")).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("native-windows-app");
    expect(document.querySelector(".tt-app-shell")).toHaveAttribute(
      "data-reference-route",
      "default",
    );
    expect(document.querySelector(".tt-app-shell")).toHaveClass(
      "tt-reference-route-default",
    );

    rootView.unmount();
    const dashboardView = renderSidebar("/dashboard");
    expect(document.querySelector(".tt-app-shell")).toHaveAttribute(
      "data-reference-route",
      "default",
    );
    expect(document.querySelector(".tt-app-shell")).toHaveClass(
      "tt-reference-route-default",
    );
    expect(document.querySelector(".tt-app-shell")).not.toHaveClass(
      "tt-reference-route-dashboard",
    );

    dashboardView.unmount();
    expect(document.documentElement).not.toHaveClass("native-windows-app");
  });

});

describe("Sidebar visual identity hooks", () => {
  it("exposes stable function identifiers for global navigation colors", () => {
    renderSidebar("/leaderboard");

    expect(screen.getByRole("link", { name: "copy:nav.usage" })).toHaveAttribute("data-nav-id", "usage");
    expect(screen.getByRole("link", { name: "copy:nav.leaderboard" })).toHaveAttribute("data-nav-id", "leaderboard");
    expect(screen.getByRole("button", { name: "copy:nav.group.spend" })).toHaveAttribute("data-nav-id", "spend");
    expect(screen.getByRole("link", { name: "copy:nav.spend.usage" })).toHaveAttribute("data-nav-id", "spend-usage");
  });

  it("limits module color styling to the currently selected destination", () => {
    const css = readFileSync(resolve("src/ui/foundation/apple-glass.css"), "utf8");

    expect(css).toContain('.tt-sidebar-item[data-nav-id="leaderboard"][aria-current="page"]');
    expect(css).not.toContain('.tt-sidebar-item[data-nav-id="leaderboard"] { color:');
  });
});

describe("Sidebar keyboard focus styles", () => {
  it("uses an inset visible outline without relying on global focus suppression", () => {
    const stylesheet = postcss.parse(readFileSync(resolve("src/styles.css"), "utf8"));
    const rules = stylesheet.nodes.filter((node) => node.type === "rule");
    const suppressionIndex = rules.findIndex((rule) =>
      rule.selector.split(",").map((selector) => selector.trim()).includes("*:focus-visible"),
    );
    const focusIndex = rules.findIndex(
      (rule) => rule.selector === ".tt-sidebar-focusable:focus-visible",
    );

    expect(suppressionIndex).toBe(-1);
    expect(focusIndex).toBeGreaterThanOrEqual(0);

    const focusRule = rules[focusIndex];
    const outline = focusRule.nodes.find((node) => node.prop === "outline");
    const outlineOffset = focusRule.nodes.find((node) => node.prop === "outline-offset");

    expect(outline?.value).toBe("2px solid var(--oai-black)");
    expect(outline?.important).toBe(true);
    expect(Number.parseFloat(outlineOffset?.value)).toBeLessThan(0);
    expect(outlineOffset?.important).toBe(true);
  });
});
