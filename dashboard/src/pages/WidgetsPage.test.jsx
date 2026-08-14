import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copy, setCopyLocale } from "../lib/copy";
import { EN_LOCALE, ZH_CN_LOCALE } from "../lib/locale";
import { resetLocalApiOriginForTests } from "../lib/local-api-url";
import { WidgetsPage } from "./WidgetsPage.jsx";

function installNativeBridge(settings) {
  const messages = [];
  window.history.pushState({}, "", "/widgets?app=1");
  window.webkit = {
    messageHandlers: {
      nativeBridge: {
        postMessage(message) {
          messages.push(message);
        },
      },
    },
  };
  return {
    messages,
    pushSettings() {
      window.dispatchEvent(new CustomEvent("native:settings", { detail: settings }));
    },
  };
}

async function openWindowsWidgetSettings(user) {
  let dialog = screen.queryByRole("dialog", {
    name: copy("widgets.windows.projects.title"),
  });
  if (!dialog) {
    await user.click(screen.getByRole("button", {
      name: copy("widgets.reference.batch_actions"),
    }));
    await user.click(screen.getByRole("menuitem", {
      name: copy("widgets.reference.batch_manage"),
    }));
    dialog = await screen.findByRole("dialog", {
      name: copy("widgets.windows.projects.title"),
    });
  }
  return dialog;
}

async function expandWindowsWidgetSection(user, titleKey) {
  const title = copy(titleKey);
  const dialog = await openWindowsWidgetSettings(user);
  const trigger = await within(dialog).findByRole("button", {
    name: (accessibleName) => accessibleName.includes(title),
  });
  if (trigger.getAttribute("aria-expanded") === "false") {
    await user.click(trigger);
  }
  return trigger;
}

afterEach(() => {
  vi.restoreAllMocks();
  resetLocalApiOriginForTests();
  setCopyLocale(EN_LOCALE);
  window.history.pushState({}, "", "/");
  if (typeof window.localStorage?.removeItem === "function") {
    window.localStorage.removeItem("tokentracker_native_app");
  }
  delete window.webkit;
  delete window.__TAURI__;
});

describe("WidgetsPage menu bar configurator", () => {
  it("edits the two menu bar preview slots through NativeBridge", async () => {
    const user = userEvent.setup();
    const bridge = installNativeBridge({
      showStats: true,
      menuBarItems: ["todayTokens", "claude5h"],
      menuBarMaxItems: 2,
      menuBarAvailableItems: [
        { id: "todayTokens", label: "Today Tokens", shortLabel: "Tokens", category: "tokens" },
        { id: "todayCost", label: "Today Cost", shortLabel: "Cost", category: "cost" },
        { id: "claude5h", label: "Claude 5h Limit", shortLabel: "Cl 5h", category: "limits" },
      ],
    });

    render(<WidgetsPage />);
    act(() => bridge.pushSettings());

    const secondaryLabel = copy("menubar.slot.secondary");
    const primary = await screen.findByRole("combobox", { name: copy("menubar.slot.primary") });
    const secondary = screen.getByRole("combobox", { name: secondaryLabel });

    // The slots are now custom (base-ui) dropdowns: the trigger renders the
    // selected option's label as text rather than exposing a native value.
    expect(primary).toHaveTextContent(copy("menubar.metric.today_tokens"));
    expect(secondary).toHaveTextContent(copy("menubar.metric.claude_5h"));

    // Open the secondary dropdown and verify it dedupes the primary's metric.
    await act(async () => {
      await user.click(secondary);
    });
    // The popup mounts asynchronously (base-ui portal + floating-ui positioning),
    // so wait for the listbox rather than querying synchronously right after the
    // click — a sync getByRole races the mount and fails intermittently.
    const listbox = await screen.findByRole("listbox", { name: secondaryLabel });
    expect(
      within(listbox).queryByRole("option", { name: copy("menubar.metric.today_tokens") }),
    ).not.toBeInTheDocument();

    // Pick "Today Cost". A touch tap commits without first highlighting the
    // item — base-ui's mouse path requires a highlighted item, which jsdom's
    // lack of layout for floating-ui list navigation never sets.
    const todayCostOption = within(listbox).getByRole("option", {
      name: copy("menubar.metric.today_cost"),
    });
    await act(async () => {
      await user.pointer([
        { keys: "[TouchA>]", target: todayCostOption },
        { keys: "[/TouchA]", target: todayCostOption },
      ]);
    });

    await waitFor(() => {
      expect(bridge.messages).toContainEqual({
        type: "setSetting",
        key: "menuBarItems",
        value: ["todayTokens", "todayCost"],
      });
    });
  });

  it("localizes Codex Spark native menu item labels through copy", async () => {
    setCopyLocale(ZH_CN_LOCALE);
    const bridge = installNativeBridge({
      showStats: true,
      menuBarItems: ["codexSpark5h", "codexSpark7d"],
      menuBarMaxItems: 2,
      menuBarAvailableItems: [
        {
          id: "codexSpark5h",
          label: "Codex Spark 5h Limit",
          shortLabel: "Cx Spark 5h",
          category: "limits",
        },
        {
          id: "codexSpark7d",
          label: "Codex Spark 7d Limit",
          shortLabel: "Cx Spark 7d",
          category: "limits",
        },
      ],
    });

    render(<WidgetsPage />);
    act(() => bridge.pushSettings());

    const primary = await screen.findByRole("combobox", { name: copy("menubar.slot.primary") });
    const secondary = screen.getByRole("combobox", { name: copy("menubar.slot.secondary") });

    expect(primary).toHaveTextContent(copy("menubar.metric.codex_spark_5h"));
    expect(secondary).toHaveTextContent(copy("menubar.metric.codex_spark_7d"));
  });
});

describe("WidgetsPage Windows desktop widget", () => {
  it("reuses the basic-settings raised control surface for widget toolbar actions", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );

    render(<WidgetsPage />);

    await screen.findByTestId("widget-manager");
    const chooseFolder = screen.getByRole("button", {
      name: copy("widgets.reference.add_project_folder"),
    });
    const status = screen.getByRole("combobox", {
      name: copy("widgets.reference.status_all"),
    });
    const refresh = screen.getByRole("button", {
      name: copy("widgets.reference.refresh_data"),
    });

    expect(chooseFolder).toHaveClass("tt-raised-control");
    expect(status).toHaveClass("tt-raised-control");
    expect(refresh).toHaveClass("tt-raised-control");
    expect(document.querySelector(".tt-widget-project-toolbar select")).toBeNull();
    expect(screen.getByTestId("widget-manager").closest(".tt-reference-route-widgets"))
      .not.toBeNull();
  });

  it("plays a complete press-and-rebound animation on the visible widget toolbar controls", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    window.__TAURI__ = {
      core: {
        invoke: vi.fn(async (command) => (
          command === "get_desktop_widget_prefs" ? { visible: false } : undefined
        )),
      },
    };

    render(<WidgetsPage />);

    await screen.findByTestId("widget-manager");
    const chooseFolder = screen.getByRole("button", {
      name: copy("widgets.reference.add_project_folder"),
    });
    fireEvent.pointerDown(chooseFolder, { button: 0 });
    expect(chooseFolder).toHaveClass("tt-widget-click-bounce");

    fireEvent.animationEnd(chooseFolder, { animationName: "tt-widget-press-rebound" });
    expect(chooseFolder).not.toHaveClass("tt-widget-click-bounce");

    const statusSelect = screen.getByRole("combobox", {
      name: copy("widgets.reference.status_all"),
    });
    fireEvent.pointerDown(statusSelect, { button: 0 });
    expect(statusSelect).toHaveClass("tt-widget-click-bounce");

    fireEvent.animationEnd(statusSelect, { animationName: "tt-widget-press-rebound" });
    expect(statusSelect).not.toHaveClass("tt-widget-click-bounce");

    const refresh = document.querySelector(".tt-widget-limits > header > button");
    expect(refresh).not.toBeNull();
    fireEvent.pointerDown(refresh, { button: 0 });
    expect(refresh).toHaveClass("tt-widget-click-bounce");
  });

  it("keeps aligned work-surface gutters in a Windows browser preview", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );

    render(<WidgetsPage />);

    expect(await screen.findByTestId("widget-manager")).toBeInTheDocument();
    expect(screen.getByTestId("widgets-heading")).toHaveTextContent(
      copy("widgets.reference.subtitle"),
    );
    expect(screen.getByTestId("widget-manager").closest(".mx-auto"))
      .toHaveClass("max-w-none");
    expect(screen.getByTestId("widget-manager").closest(".mx-auto"))
      .toHaveClass("px-4", "sm:px-6", "lg:px-8");
  });

  it("groups multiple sessions from the same project folder in the widget summary", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    // Relative timestamps: the "active" bucket is a rolling 3-day window, so
    // fixed dates rot as the calendar moves on.
    const hoursAgo = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        projectStatus: {
          green: 8,
          yellow: 2,
          recentProjects: [
            { id: "project-a", label: "Token Eyes", updatedAt: hoursAgo(2) },
            { id: "project-b", label: "Website", updatedAt: hoursAgo(3) },
            { id: "project-c", label: "Token Eyes", updatedAt: hoursAgo(26) },
            { id: "project-d", label: "Token Eyes", updatedAt: hoursAgo(50) },
          ],
        },
        limits: [],
      }),
      headers: new Headers({ "content-type": "application/json" }),
    });

    render(<WidgetsPage />);

    await screen.findByTestId("widget-summary");
    const activeSummary = document.querySelector(".tt-widget-summary article[data-tone='green']");
    await waitFor(() => {
      expect(activeSummary).toHaveTextContent("2");
      expect(activeSummary).toHaveTextContent(copy("widgets.reference.active_rate", { rate: 100 }));
      expect(document.querySelectorAll(".tt-widget-project-row")).toHaveLength(2);
    });
  });

  it("expands only the selected project folder's child sessions", async () => {
    const user = userEvent.setup();
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    const hoursAgo = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        projectStatus: {
          recentProjects: [
            { id: "project-a", label: "Token Eyes", updatedAt: hoursAgo(2) },
            { id: "project-b", label: "Website", updatedAt: hoursAgo(3) },
            { id: "project-c", label: "Token Eyes", updatedAt: hoursAgo(26) },
            { id: "project-d", label: "Token Eyes", updatedAt: hoursAgo(50) },
          ],
        },
        limits: [],
      }),
      headers: new Headers({ "content-type": "application/json" }),
    });

    render(<WidgetsPage />);

    const expand = await screen.findByTestId("widget-project-expand");
    await user.click(expand);

    expect(screen.getAllByTestId("widget-project-session")).toHaveLength(3);
    expect(expand).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("widget-project-sessions")).toHaveTextContent("会话 1");
    expect(screen.getByTestId("widget-project-sessions")).toHaveTextContent("活跃");
  });

  it("places the desktop-widget visibility action in the page header", async () => {
    const invoke = vi.fn(async (command) => {
      if (command === "get_desktop_widget_prefs") return { visible: false };
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };

    render(<WidgetsPage />);

    const heading = screen.getByTestId("widgets-heading");
    const toggle = await within(heading).findByRole("button", {
      name: copy("widgets.windows.show"),
    });
    expect(toggle).toBeEnabled();
  });

  it("migrates five legacy quota-window selections into two configured widget plans", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    window.__TAURI__ = {
      core: {
        invoke: vi.fn(async (command) => {
          if (command === "local_server_status") {
            return { running: true, url: "http://127.0.0.1:7681" };
          }
          if (command === "get_desktop_widget_prefs") {
            return {
              visible: true,
              selectedLimitIds: [
                "codex:main:5h",
                "cursor:pro:7d",
                "cursor:pro:monthly",
                "cursor:pro:auto_composer",
                "cursor:pro:api",
              ],
            };
          }
          return undefined;
        }),
      },
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const body = String(url).includes("/api/local-auth")
        ? { token: "local-test-token" }
        : {
          projectStatus: { recentProjects: [] },
          limits: [
            { id: "codex:main", provider: "Codex", accountLabel: "Pro 20x", window: "5h", usedPercent: 2 },
            { id: "cursor:pro", provider: "Cursor", accountLabel: "Pro", window: "7d", usedPercent: 100 },
          ],
        };
      return {
        ok: true,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Headers({ "content-type": "application/json" }),
      };
    });

    render(<WidgetsPage />);

    await screen.findByTestId("widget-manager");
    await waitFor(() => {
      expect(document.querySelectorAll(".tt-widget-limit-row")).toHaveLength(2);
      expect(document.querySelector(".tt-widget-summary article[data-tone='violet']"))
        .toHaveTextContent("2 / 2");
    });
    expect(window.__TAURI__.core.invoke).toHaveBeenCalledWith(
      "set_desktop_widget_prefs",
      expect.objectContaining({
        prefs: expect.objectContaining({ selectedLimitIds: ["codex:main", "cursor:pro"] }),
      }),
    );
  });

  it("keeps real project and plan settings available in the final manager", async () => {
    const user = userEvent.setup();
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    const invoke = vi.fn(async (command) => {
      if (command === "local_server_status") {
        return { running: true, url: "http://127.0.0.1:7681" };
      }
      if (command === "get_desktop_widget_prefs") {
        return {
          visible: true,
          selectedProjectIds: ["project-a"],
          selectedProjects: [],
          selectedLimitIds: ["codex:plus:5h"],
        };
      }
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const body = String(url).includes("/api/local-auth")
        ? { token: "local-test-token" }
        : {
          projectStatus: {
            projects: [{ id: "project-a", label: "Token Eyes" }],
            recentProjects: [{ id: "project-a", label: "Token Eyes" }],
          },
          limits: [{
            id: "codex:plus:5h",
            agent: "codex",
            provider: "Codex",
            accountLabel: "Plus",
            window: "5h",
            usedPercent: 42,
          }],
        };
      return {
        ok: true,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Headers({ "content-type": "application/json" }),
      };
    });

    render(<WidgetsPage />);

    await expandWindowsWidgetSection(user, "widgets.windows.projects.title");

    expect(await screen.findByRole("searchbox", {
      name: copy("widgets.windows.projects.search"),
    })).toBeInTheDocument();
    expect(screen.getByRole("combobox", {
      name: copy("widgets.windows.projects.active_window"),
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: copy("widgets.windows.projects.add_folder"),
    })).toBeInTheDocument();
    await expandWindowsWidgetSection(user, "widgets.windows.limits.title");
    expect(await screen.findByRole("checkbox", {
      name: "Codex - Plus - 5h",
    })).toBeChecked();
    expect(document.querySelector(".tt-widget-agent-logo.is-codex")).toBeInTheDocument();
    expect(document.querySelector(".tt-widget-advanced-settings")).not.toBeInTheDocument();
  });

  it("does not offer the removed usage overview or heatmap cards", () => {
    const { container } = render(<WidgetsPage />);
    expect(screen.getByRole("heading", { name: copy("widgets.page.title") })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: copy("widgets.gallery.section.title") }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("article.tt-surface")).toHaveLength(3);
    expect(container.querySelectorAll(".tt-surface-nested")).not.toHaveLength(0);
    expect(screen.queryByText(copy("widgets.summary.name"))).not.toBeInTheDocument();
    expect(screen.queryByText(copy("widgets.heatmap.name"))).not.toBeInTheDocument();
  });

  it("shows and hides the independent widget without macOS-only settings", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn(async (command) => {
      if (command === "get_desktop_widget_prefs") return { visible: false };
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };

    render(<WidgetsPage />);

    const toggle = await screen.findByRole("button", {
      name: copy("widgets.windows.show"),
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(screen.queryByText(copy("settings.menubar.animatedIcon"))).not.toBeInTheDocument();
    expect(screen.queryByText(copy("settings.menubar.confettiOnReset"))).not.toBeInTheDocument();

    await user.click(toggle);
    expect(invoke).toHaveBeenCalledWith("show_desktop_widget");
    expect(
      screen.getByRole("button", { name: copy("widgets.windows.hide") }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: copy("widgets.windows.hide") }));
    expect(invoke).toHaveBeenCalledWith("hide_desktop_widget");
  });

  it("keeps project and usage-plan settings collapsed by default and expands them independently", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn(async (command) => {
      if (command === "local_server_status") {
        return { running: true, url: "http://127.0.0.1:7681" };
      }
      if (command === "get_desktop_widget_prefs") {
        return {
          visible: true,
          selectedProjectIds: [],
          selectedProjects: [],
          selectedLimitIds: [],
        };
      }
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const body = String(url).includes("/api/local-auth")
        ? { token: "local-test-token" }
        : {
          projectStatus: { projects: [{ id: "project-a", label: "Token Eyes" }] },
          limits: [{
            id: "codex:plus:5h",
            provider: "Codex",
            accountLabel: "Plus",
            window: "5h",
            usedPercent: 42,
          }],
        };
      return {
        ok: true,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Headers({ "content-type": "application/json" }),
      };
    });

    render(<WidgetsPage />);

    const dialog = await openWindowsWidgetSettings(user);

    const projects = await within(dialog).findByRole("button", {
      name: (accessibleName) => accessibleName.includes(copy("widgets.windows.projects.title")),
    });
    const limits = within(dialog).getByRole("button", {
      name: (accessibleName) => accessibleName.includes(copy("widgets.windows.limits.title")),
    });
    expect(projects).toHaveAttribute("aria-expanded", "false");
    expect(limits).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("searchbox", {
      name: copy("widgets.windows.projects.search"),
    })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Codex - Plus - 5h" })).not.toBeInTheDocument();

    await user.click(projects);
    expect(projects).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("searchbox", {
      name: copy("widgets.windows.projects.search"),
    })).toBeInTheDocument();
    expect(limits).toHaveAttribute("aria-expanded", "false");

    await user.click(limits);
    expect(limits).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("checkbox", { name: "Codex - Plus - 5h" })).toBeInTheDocument();
  });

  it("configures visible projects on the Widgets page instead of inside the capsule", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn(async (command, payload) => {
      if (command === "local_server_status") {
        return { running: true, url: "http://127.0.0.1:7681" };
      }
      if (command === "get_desktop_widget_prefs") {
        return {
          visible: true,
          selectedProjectIds: ["project-a"],
        };
      }
      if (command === "set_desktop_widget_prefs") return payload?.prefs;
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/local-auth")) {
        return {
          ok: true,
          json: async () => ({ token: "local-test-token" }),
          text: async () => JSON.stringify({ token: "local-test-token" }),
          headers: new Headers({ "content-type": "application/json" }),
        };
      }
      const body = {
        projectStatus: {
          projects: [
            { id: "project-a", label: "Token Eyes" },
            { id: "project-b", label: "Website" },
          ],
        },
      };
      return {
        ok: true,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Headers({ "content-type": "application/json" }),
      };
    });

    render(<WidgetsPage />);

    await expandWindowsWidgetSection(user, "widgets.windows.projects.title");

    const search = await screen.findByRole("searchbox", {
      name: copy("widgets.windows.projects.search"),
    });
    expect(await screen.findByRole("checkbox", { name: "Token Eyes" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Website" })).not.toBeChecked();

    await user.type(search, "web");
    expect(screen.queryByRole("checkbox", { name: "Token Eyes" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Website" }));

    expect(invoke).not.toHaveBeenCalledWith(
      "set_desktop_widget_prefs",
      expect.anything(),
    );
    await user.click(screen.getByRole("button", {
      name: copy("widgets.windows.projects.save"),
    }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_desktop_widget_prefs", {
        prefs: expect.objectContaining({
          selectedProjectIds: ["project-a", "project-b"],
        }),
      });
    });
  });

  it("defaults legacy preferences to one hour and saves the selected active-session window", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn(async (command, payload) => {
      if (command === "local_server_status") {
        return { running: true, url: "http://127.0.0.1:7681" };
      }
      if (command === "get_desktop_widget_prefs") {
        return {
          visible: true,
          selectedProjectIds: [],
          selectedProjects: [],
        };
      }
      if (command === "set_desktop_widget_prefs") return payload?.prefs;
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const body = String(url).includes("/api/local-auth")
        ? { token: "local-test-token" }
        : { projectStatus: { projects: [], recentProjects: [] } };
      return {
        ok: true,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Headers({ "content-type": "application/json" }),
      };
    });

    render(<WidgetsPage />);

    await expandWindowsWidgetSection(user, "widgets.windows.projects.title");

    const range = await screen.findByRole("combobox", {
      name: copy("widgets.windows.projects.active_window"),
    });
    expect(range).toHaveValue("1h");
    expect(screen.queryByRole("option", { name: "30m" })).not.toBeInTheDocument();

    await user.selectOptions(range, "3d");
    expect(invoke).not.toHaveBeenCalledWith(
      "set_desktop_widget_prefs",
      expect.anything(),
    );

    await user.click(screen.getByRole("button", {
      name: copy("widgets.windows.projects.save"),
    }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_desktop_widget_prefs", {
        prefs: expect.objectContaining({
          activeSessionWindow: "3d",
        }),
      });
    });
  });

  it("stages an arbitrary project folder until the user explicitly saves", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn(async (command, payload) => {
      if (command === "local_server_status") {
        return { running: true, url: "http://127.0.0.1:7681" };
      }
      if (command === "get_desktop_widget_prefs") {
        return { visible: true, selectedProjectIds: [], selectedProjects: [] };
      }
      if (command === "pick_directory") return "D:\\Work\\012-EDU-lite";
      if (command === "set_desktop_widget_prefs") return payload?.prefs;
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const body = String(url).includes("/api/local-auth")
        ? { token: "local-test-token" }
        : { projectStatus: { projects: [] } };
      return {
        ok: true,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Headers({ "content-type": "application/json" }),
      };
    });

    render(<WidgetsPage />);
    await expandWindowsWidgetSection(user, "widgets.windows.projects.title");
    await user.click(await screen.findByRole("button", {
      name: copy("widgets.windows.projects.add_folder"),
    }));

    expect(screen.getByRole("checkbox", { name: "012-EDU-lite" })).toBeChecked();
    expect(invoke).not.toHaveBeenCalledWith(
      "set_desktop_widget_prefs",
      expect.anything(),
    );

    await user.click(screen.getByRole("button", {
      name: copy("widgets.windows.projects.save"),
    }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_desktop_widget_prefs", {
        prefs: expect.objectContaining({
          selectedProjectIds: [expect.stringMatching(/^project-[a-f0-9]{12}$/)],
          selectedProjects: [{
            id: expect.stringMatching(/^project-[a-f0-9]{12}$/),
            label: "012-EDU-lite",
            path: "D:\\Work\\012-EDU-lite",
          }],
        }),
      });
    });
  });

  it("offers at most ten recent active projects while retaining saved inactive folders", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn(async (command, payload) => {
      if (command === "local_server_status") {
        return { running: true, url: "http://127.0.0.1:7681" };
      }
      if (command === "get_desktop_widget_prefs") {
        return {
          visible: true,
          selectedProjectIds: ["saved-inactive"],
          selectedProjects: [{
            id: "saved-inactive",
            label: "Archived workspace",
            path: "D:\\Work\\Archived workspace",
          }],
        };
      }
      if (command === "set_desktop_widget_prefs") return payload?.prefs;
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const body = String(url).includes("/api/local-auth")
        ? { token: "local-test-token" }
        : {
          projectStatus: {
            projects: [],
            recentProjects: Array.from({ length: 12 }, (_, index) => ({
              id: `recent-${index + 1}`,
              label: `Recent ${index + 1}`,
            })),
          },
        };
      return {
        ok: true,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Headers({ "content-type": "application/json" }),
      };
    });

    render(<WidgetsPage />);
    await expandWindowsWidgetSection(user, "widgets.windows.projects.title");
    expect(await screen.findByRole("checkbox", { name: "Recent 1" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Recent 10" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Recent 11" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Recent 12" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Archived workspace" })).toBeChecked();

    await user.click(screen.getByRole("button", {
      name: copy("widgets.windows.projects.use_recent"),
    }));
    expect(invoke).not.toHaveBeenCalledWith(
      "set_desktop_widget_prefs",
      expect.anything(),
    );
    await user.click(screen.getByRole("button", {
      name: copy("widgets.windows.projects.save"),
    }));
    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "set_desktop_widget_prefs");
      expect(saves).toHaveLength(1);
      expect(saves[0][1].prefs.selectedProjectIds).toEqual(
        Array.from({ length: 10 }, (_, index) => `recent-${index + 1}`),
      );
    });
  });
  it("selects and drag-orders usage plans before saving the widget preferences", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn(async (command, payload) => {
      if (command === "local_server_status") {
        return { running: true, url: "http://127.0.0.1:7681" };
      }
      if (command === "get_desktop_widget_prefs") {
        return {
          visible: true,
          selectedProjectIds: [],
          selectedProjects: [],
          selectedLimitIds: ["codex:plus:weekly"],
        };
      }
      if (command === "set_desktop_widget_prefs") return payload?.prefs;
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const body = String(url).includes("/api/local-auth")
        ? { token: "local-test-token" }
        : {
          projectStatus: { projects: [] },
          limits: [
            {
              id: "codex:plus:5h",
              provider: "Codex",
              accountLabel: "Plus",
              window: "5h",
              usedPercent: 42,
              notes: "主力开发账号",
            },
            {
              id: "codex:plus:weekly",
              provider: "Codex",
              accountLabel: "Plus",
              window: "weekly",
              usedPercent: 68,
            },
          ],
        };
      return {
        ok: true,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Headers({ "content-type": "application/json" }),
      };
    });

    render(<WidgetsPage />);
    await expandWindowsWidgetSection(user, "widgets.windows.limits.title");
    const weekly = await screen.findByRole("checkbox", { name: "Codex - Plus - weekly" });
    const fiveHour = screen.getByRole("checkbox", { name: "Codex - Plus - 5h" });
    expect(screen.getAllByText("主力开发账号")).not.toHaveLength(0);
    expect(screen.queryByDisplayValue("主力开发账号")).not.toBeInTheDocument();
    expect(weekly).toBeChecked();
    expect(fiveHour).not.toBeChecked();
    expect(weekly.closest("[draggable='true']")).toBeInTheDocument();

    await user.click(fiveHour);
    const weeklyRow = weekly.closest("[draggable='true']");
    const fiveHourRow = fiveHour.closest("[draggable='true']");
    fireEvent.dragStart(weeklyRow);
    fireEvent.dragOver(fiveHourRow);
    fireEvent.drop(fiveHourRow);

    await user.click(screen.getByRole("button", {
      name: copy("widgets.windows.projects.save"),
    }));
    await waitFor(() => {
      const saves = invoke.mock.calls.filter(([command]) => command === "set_desktop_widget_prefs");
      expect(saves.at(-1)[1].prefs.selectedLimitIds).toEqual([
        "codex:plus:5h",
        "codex:plus:weekly",
      ]);
    });
  });
});
