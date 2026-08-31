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
  delete window.__TAURI_INTERNALS__;
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

  it("loads and refreshes the project model with the saved active-session window", async () => {
    const user = userEvent.setup();
    const widgetUrls = [];
    const invoke = vi.fn(async (command) => {
      if (command === "local_server_status") {
        return { running: true, url: "http://127.0.0.1:7681" };
      }
      if (command === "get_desktop_widget_prefs") {
        return {
          visible: false,
          activeSessionWindow: "3d",
          selectedProjectIds: [],
          selectedProjects: [],
          selectedLimitIds: [],
        };
      }
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      const body = href.includes("/api/local-auth")
        ? { token: "local-test-token" }
        : { projectStatus: { projects: [], recentProjects: [] }, limits: [] };
      if (href.includes("/functions/tokentracker-desktop-widget")) widgetUrls.push(href);
      return {
        ok: true,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Headers({ "content-type": "application/json" }),
      };
    });

    render(<WidgetsPage />);

    await waitFor(() => expect(widgetUrls).toHaveLength(1));
    expect(widgetUrls[0]).toContain("active_window=3d");

    await user.click(screen.getByRole("button", {
      name: copy("widgets.reference.refresh_data"),
    }));
    await waitFor(() => expect(widgetUrls).toHaveLength(2));
    expect(widgetUrls[1]).toContain("active_window=3d");
  });

  it("uses the one-hour product default when legacy preferences have no active-session window", async () => {
    const user = userEvent.setup();
    const widgetUrls = [];
    const invoke = vi.fn(async (command) => {
      if (command === "local_server_status") {
        return { running: true, url: "http://127.0.0.1:7681" };
      }
      if (command === "get_desktop_widget_prefs") {
        return {
          visible: false,
          selectedProjectIds: [],
          selectedProjects: [],
          selectedLimitIds: [],
        };
      }
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      const body = href.includes("/api/local-auth")
        ? { token: "local-test-token" }
        : { projectStatus: { projects: [], recentProjects: [] }, limits: [] };
      if (href.includes("/functions/tokentracker-desktop-widget")) widgetUrls.push(href);
      return {
        ok: true,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Headers({ "content-type": "application/json" }),
      };
    });

    render(<WidgetsPage />);

    await waitFor(() => expect(widgetUrls).toHaveLength(1));
    expect(widgetUrls[0]).toContain("active_window=1h");

    await user.click(screen.getByRole("button", {
      name: copy("widgets.reference.refresh_data"),
    }));
    await waitFor(() => expect(widgetUrls).toHaveLength(2));
    expect(widgetUrls[1]).toContain("active_window=1h");
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
    expect(screen.getByTestId("widget-projects")).toHaveClass("tt-pressable-group");
    expect(screen.getByTestId("widget-limits")).toHaveClass("tt-pressable-group");
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

  it("groups same-project rows under one project name and keeps every session nested", async () => {
    const user = userEvent.setup();
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
          projects: [
            {
              id: "project-a", label: "Token Eyes", red: 0, yellow: 1, green: 1, unknown: 0,
              sessions: [
                { id: "session-a1", taskLabel: "修复桌面小组件", status: "yellow", state: "running", updatedAt: hoursAgo(2) },
                { id: "session-a2", label: "复核会话分组", status: "green", state: "completed", updatedAt: hoursAgo(3) },
              ],
            },
            {
              id: "project-b", label: "Token Eyes", red: 0, yellow: 1, green: 0, unknown: 0,
              sessions: [{ id: "session-b1", label: "另一项目", status: "yellow", state: "running", updatedAt: hoursAgo(26) }],
            },
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
      expect(activeSummary).toHaveTextContent("1");
      expect(activeSummary).toHaveTextContent(copy("widgets.reference.active_rate", { rate: 100 }));
      expect(document.querySelectorAll(".tt-widget-project-row")).toHaveLength(1);
    });
    await user.click(screen.getByTestId("widget-project-expand"));
    expect(screen.getAllByTestId("widget-project-session")).toHaveLength(3);
    expect(screen.getByTestId("widget-project-sessions")).toHaveTextContent("修复桌面小组件");
    expect(screen.getByTestId("widget-project-sessions")).toHaveTextContent("复核会话分组");
    expect(screen.getByTestId("widget-project-sessions")).toHaveTextContent("另一项目");
  });

  it("expands two producer-shaped sessions under their real project without fabricated facts", async () => {
    const user = userEvent.setup();
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    const hoursAgo = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        projectStatus: {
          projects: [
            {
              id: "project-a", label: "Token Eyes", red: 0, yellow: 1, green: 1, unknown: 0,
              sessions: [
                { id: "session-a1", taskLabel: "修复桌面小组件", status: "yellow", state: "running", updatedAt: hoursAgo(2) },
                { id: "session-a2", label: "复核会话分组", status: "green", state: "completed", updatedAt: hoursAgo(3) },
              ],
            },
            {
              id: "project-b", label: "Website", red: 0, yellow: 0, green: 0, unknown: 0, sessions: [],
            },
          ],
        },
        limits: [],
      }),
      headers: new Headers({ "content-type": "application/json" }),
    });

    render(<WidgetsPage />);

    const expand = await screen.findByTestId("widget-project-expand");
    await user.click(expand);

    expect(screen.getAllByTestId("widget-project-session")).toHaveLength(2);
    expect(expand).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("widget-project-sessions")).toHaveTextContent("修复桌面小组件");
    expect(screen.getByTestId("widget-project-sessions")).toHaveTextContent("复核会话分组");
    expect(screen.getByTestId("widget-project-sessions")).toHaveTextContent(copy("widget.session_state.running"));
    expect(screen.getByTestId("widget-project-sessions")).toHaveTextContent(copy("widget.session_state.completed"));
    expect(screen.getByTestId("widget-project-sessions")).not.toHaveTextContent("会话 1");
    expect(screen.queryByText(copy("widgets.reference.tag_core"))).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: copy("widgets.reference.recent_seven_days") })).not.toBeInTheDocument();
    expect(screen.getAllByText(copy("widget.session.time_unknown")).length).toBeGreaterThan(0);
  });

  it("migrates legacy selected session ids to the owning project and keeps a saved empty project", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    const invoke = vi.fn(async (command, payload) => {
      if (command === "local_server_status") {
        return { running: true, url: "http://127.0.0.1:7681" };
      }
      if (command === "get_desktop_widget_prefs") {
        return {
          visible: true,
          selectedProjectIds: ["session-a1", "saved-empty"],
          selectedProjects: [
            { id: "session-a1", label: "Legacy selected session" },
            { id: "saved-empty", label: "Archived workspace", path: "D:\\Work\\Archived workspace" },
          ],
          selectedLimitIds: [],
        };
      }
      if (command === "set_desktop_widget_prefs") return payload?.prefs;
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        projectStatus: {
          projects: [{
            id: "project-a", label: "Token Eyes", red: 0, yellow: 1, green: 0, unknown: 0,
            sessions: [{ id: "session-a1", label: "修复桌面小组件", status: "yellow", state: "running", updatedAt: new Date().toISOString() }],
          }],
          recentProjects: [],
        },
        limits: [],
      }),
      headers: new Headers({ "content-type": "application/json" }),
    });

    render(<WidgetsPage />);

    await screen.findByText("Archived workspace");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_desktop_widget_prefs", {
        prefs: expect.objectContaining({
          selectedProjectIds: ["project-a", "saved-empty"],
          selectedProjects: expect.arrayContaining([
            expect.objectContaining({ id: "project-a", label: "Token Eyes" }),
            expect.objectContaining({ id: "saved-empty", label: "Archived workspace" }),
          ]),
        }),
      });
    });
    expect(document.querySelectorAll(".tt-widget-project-row")).toHaveLength(2);
  });

  it("migrates a legacy selected session through recent-project metadata after it leaves the active window", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    const invoke = vi.fn(async (command, payload) => {
      if (command === "local_server_status") {
        return { running: true, url: "http://127.0.0.1:7681" };
      }
      if (command === "get_desktop_widget_prefs") {
        return {
          visible: true,
          activeSessionWindow: "1h",
          selectedProjectIds: ["session-old"],
          selectedProjects: [{ id: "session-old", label: "Legacy selected session" }],
          selectedLimitIds: [],
        };
      }
      if (command === "set_desktop_widget_prefs") return payload?.prefs;
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        projectStatus: {
          projects: [],
          recentProjects: [{
            id: "project-a",
            label: "Token Eyes",
            updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            sessionIds: ["session-old"],
          }],
        },
        limits: [],
      }),
      headers: new Headers({ "content-type": "application/json" }),
    });

    render(<WidgetsPage />);

    await screen.findByText("Token Eyes");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_desktop_widget_prefs", {
        prefs: expect.objectContaining({
          selectedProjectIds: ["project-a"],
          selectedProjects: [expect.objectContaining({ id: "project-a", label: "Token Eyes" })],
        }),
      });
    });
    expect(document.querySelectorAll(".tt-widget-project-row")).toHaveLength(1);
  });

  it("persists corrected selected-project metadata even when the project id array is already current", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    const invoke = vi.fn(async (command, payload) => {
      if (command === "local_server_status") {
        return { running: true, url: "http://127.0.0.1:7681" };
      }
      if (command === "get_desktop_widget_prefs") {
        return {
          visible: true,
          selectedProjectIds: ["project-a"],
          selectedProjects: [{ id: "session-a1", label: "Legacy selected session" }],
          selectedLimitIds: [],
        };
      }
      if (command === "set_desktop_widget_prefs") return payload?.prefs;
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        projectStatus: {
          projects: [{
            id: "project-a", label: "Token Eyes", red: 0, yellow: 1, green: 0, unknown: 0,
            sessions: [{ id: "session-a1", label: "修复桌面小组件", status: "yellow", state: "running", updatedAt: new Date().toISOString() }],
          }],
          recentProjects: [],
        },
        limits: [],
      }),
      headers: new Headers({ "content-type": "application/json" }),
    });

    render(<WidgetsPage />);

    await screen.findByText("Token Eyes");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_desktop_widget_prefs", {
        prefs: expect.objectContaining({
          selectedProjectIds: ["project-a"],
          selectedProjects: [expect.objectContaining({ id: "project-a", label: "Token Eyes" })],
        }),
      });
    });
    expect(document.querySelectorAll(".tt-widget-project-row")).toHaveLength(1);
  });

  it("places the desktop-widget visibility action in the page header", async () => {
    const invoke = vi.fn(async (command) => {
      if (command === "get_desktop_widget_prefs") return { visible: false };
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };

    render(<WidgetsPage />);
    await act(async () => {
      await Promise.resolve();
    });

    const heading = screen.getByTestId("widgets-heading");
    const toggle = await within(heading).findByRole("button", {
      name: copy("widgets.windows.show"),
    });
    expect(toggle).toBeEnabled();
  });

  it("shows an explicit disabled desktop-app explanation in a Windows browser preview", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );

    render(<WidgetsPage />);

    const heading = screen.getByTestId("widgets-heading");
    expect(await within(heading).findByRole("button", {
      name: copy("widgets.windows.unavailable"),
    })).toBeDisabled();
    expect(within(heading).queryByRole("button", {
      name: copy("widgets.windows.show"),
    })).not.toBeInTheDocument();
  });

  it("uses the Tauri internals bridge when that is the available native capability", async () => {
    const invoke = vi.fn(async (command) => (
      command === "get_desktop_widget_prefs" ? { visible: true } : undefined
    ));
    window.__TAURI_INTERNALS__ = { invoke };

    render(<WidgetsPage />);

    expect(await within(screen.getByTestId("widgets-heading")).findByRole("button", {
      name: copy("widgets.windows.hide"),
    })).toBeEnabled();
    expect(invoke).toHaveBeenCalledWith("get_desktop_widget_prefs");
  });

  it("uses the native command result instead of assuming visibility changed", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn(async (command) => {
      if (command === "get_desktop_widget_prefs") return { visible: false };
      if (command === "show_desktop_widget") return { visible: false };
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };

    render(<WidgetsPage />);

    const heading = screen.getByTestId("widgets-heading");
    await user.click(await within(heading).findByRole("button", {
      name: copy("widgets.windows.show"),
    }));
    expect(invoke).toHaveBeenCalledWith("show_desktop_widget");
    expect(within(heading).getByRole("button", { name: copy("widgets.windows.show") }))
      .toBeEnabled();
  });

  it("re-reads native visibility when the main window regains focus", async () => {
    let visible = false;
    const invoke = vi.fn(async (command) => (
      command === "get_desktop_widget_prefs" ? { visible } : undefined
    ));
    window.__TAURI__ = { core: { invoke } };

    render(<WidgetsPage />);

    const heading = screen.getByTestId("widgets-heading");
    const initialToggle = await within(heading).findByRole("button", {
      name: copy("widgets.windows.show"),
    });
    await waitFor(() => expect(initialToggle).toBeEnabled());
    visible = true;
    act(() => window.dispatchEvent(new Event("focus")));
    expect(await within(heading).findByRole("button", {
      name: copy("widgets.windows.hide"),
    })).toBeEnabled();
  });

  it("does not let an older visibility reload overwrite a newer show command", async () => {
    const user = userEvent.setup();
    const pendingReads = [];
    let deferVisibilityReads = false;
    const invoke = vi.fn(async (command) => {
      if (command === "get_desktop_widget_prefs") {
        if (!deferVisibilityReads) return { visible: false };
        return new Promise((resolve) => pendingReads.push(resolve));
      }
      if (command === "show_desktop_widget") return { visible: true };
      return undefined;
    });
    window.__TAURI__ = { core: { invoke } };

    render(<WidgetsPage />);
    await act(async () => {
      await Promise.resolve();
    });

    const heading = screen.getByTestId("widgets-heading");
    const show = await within(heading).findByRole("button", {
      name: copy("widgets.windows.show"),
    });
    await waitFor(() => expect(show).toBeEnabled());
    deferVisibilityReads = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(pendingReads).toHaveLength(1));

    await act(async () => {
      await user.click(show);
    });
    expect(within(heading).getByRole("button", {
      name: copy("widgets.windows.hide"),
    })).toBeEnabled();

    await act(async () => {
      pendingReads.splice(0).forEach((resolve) => resolve({ visible: false }));
      await Promise.resolve();
    });
    expect(within(heading).getByRole("button", {
      name: copy("widgets.windows.hide"),
    })).toBeEnabled();
  });

  it("migrates two legacy quota-window selections into two configured widget plans", async () => {
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
            { id: "codex:main:5h", planId: "codex:main", provider: "Codex", accountLabel: "Pro 20x", window: "5h", usedPercent: 2 },
            { id: "cursor:pro:7d", planId: "cursor:pro", provider: "Cursor", accountLabel: "Pro", window: "7d", usedPercent: 100 },
            { id: "cursor:pro:monthly", planId: "cursor:pro", provider: "Cursor", accountLabel: "Pro", window: "monthly", usedPercent: 100 },
            { id: "cursor:pro:auto_composer", planId: "cursor:pro", provider: "Cursor", accountLabel: "Pro", window: "自动与 Composer", usedPercent: 61 },
            { id: "cursor:pro:api", planId: "cursor:pro", provider: "Cursor", accountLabel: "Pro", window: "API", usedPercent: 100 },
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
      expect(screen.getAllByTestId("widget-limit-plan-card")).toHaveLength(2);
      expect(document.querySelector(".tt-widget-summary article[data-tone='violet']"))
        .toHaveTextContent("2 / 2");
    });
    const cursorPlan = screen.getAllByTestId("widget-limit-plan-card")
      .find((card) => card.getAttribute("data-plan-id") === "cursor:pro");
    expect(cursorPlan).toBeDefined();
    expect(within(cursorPlan).getAllByTestId("widget-limit-quota-window")).toHaveLength(4);
    expect(within(cursorPlan).getAllByText("Cursor")).toHaveLength(1);
    expect(window.__TAURI__.core.invoke).toHaveBeenCalledWith(
      "set_desktop_widget_prefs",
      expect.objectContaining({
        prefs: expect.objectContaining({
          selectedLimitIds: [
            "codex:main:5h",
            "cursor:pro:7d",
            "cursor:pro:monthly",
            "cursor:pro:auto_composer",
            "cursor:pro:api",
          ],
        }),
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
            planId: "codex:plus",
            agent: "codex",
            provider: "Codex",
            planLabel: "Plus",
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
      name: "Codex - Plus",
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
    let visible = false;
    const invoke = vi.fn(async (command) => {
      if (command === "get_desktop_widget_prefs") return { visible };
      if (command === "show_desktop_widget") {
        visible = true;
        return { visible };
      }
      if (command === "hide_desktop_widget") {
        visible = false;
        return { visible };
      }
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
            planId: "codex:plus",
            provider: "Codex",
            planLabel: "Plus",
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
    expect(screen.queryByRole("checkbox", { name: "Codex - Plus" })).not.toBeInTheDocument();

    await user.click(projects);
    expect(projects).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("searchbox", {
      name: copy("widgets.windows.projects.search"),
    })).toBeInTheDocument();
    expect(limits).toHaveAttribute("aria-expanded", "false");

    await user.click(limits);
    expect(limits).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("checkbox", { name: "Codex - Plus" })).toBeInTheDocument();
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
          selectedProjects: [{ id: "project-a", label: "Token Eyes", path: "" }],
          selectedLimitIds: [],
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

    expect(await screen.findByRole("checkbox", { name: "012-EDU-lite" })).toBeChecked();
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
  it("treats one plan's quota windows as one selectable widget plan", async () => {
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
              planId: "codex:plus",
              kind: "rolling_weekly",
              provider: "Codex",
              planLabel: "Pro 20x",
              accountLabel: "muxunson@gmail.com",
              subscriptionAmount: 20,
              subscriptionCurrency: "USD",
              window: "7 天",
              usedPercent: 42,
              resetAt: "2026-08-20T03:33:19.000Z",
              notes: "主力开发账号",
              expiresAt: "2100-08-30T14:24:24.000Z",
            },
            {
              id: "codex:plus:weekly",
              planId: "codex:plus",
              kind: "gpt_5_3_codex_spark_weekly",
              provider: "Codex",
              planLabel: "Pro 20x",
              accountLabel: "muxunson@gmail.com",
              subscriptionAmount: 20,
              subscriptionCurrency: "USD",
              window: "GPT 5.3 Codex Spark",
              usedPercent: 56,
              resetAt: "2026-08-20T04:03:32.000Z",
            },
            {
              id: "cursor:pro:total",
              planId: "cursor:pro",
              kind: "total",
              provider: "Cursor",
              planLabel: "Pro",
              accountLabel: "ezequielhuelsxw@outlook.com",
              subscriptionAmount: 20,
              subscriptionCurrency: "USD",
              window: "Total Usage",
              usedPercent: 100,
              resetAt: "2026-08-22T04:17:12.000Z",
              expiresAt: "2100-08-22T04:17:12.000Z",
            },
            {
              id: "cursor:pro:auto_composer",
              planId: "cursor:pro",
              kind: "auto_composer",
              provider: "Cursor",
              planLabel: "Pro",
              accountLabel: "ezequielhuelsxw@outlook.com",
              subscriptionAmount: 20,
              subscriptionCurrency: "USD",
              window: "Auto + Composer Usage",
              usedPercent: 62,
              resetAt: "2026-08-22T04:17:12.000Z",
            },
            {
              id: "cursor:pro:api",
              planId: "cursor:pro",
              kind: "api",
              provider: "Cursor",
              planLabel: "Pro",
              accountLabel: "ezequielhuelsxw@outlook.com",
              subscriptionAmount: 20,
              subscriptionCurrency: "USD",
              window: "API Usage",
              usedPercent: 100,
              resetAt: "2026-08-22T04:17:12.000Z",
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
    const plan = await screen.findByRole("checkbox", { name: "Codex - Pro 20x" });
    const planCards = screen.getAllByTestId("widget-limit-plan-card");
    expect(planCards).toHaveLength(2);
    const [planCard] = planCards;
    expect(planCard).toHaveAttribute("data-plan-id", "codex:plus");
    expect(planCard).toHaveAttribute("data-card-layout", "cost-settings-token-plan");
    expect(planCard).toHaveClass(
      "tt-token-plan-card",
      "tt-token-plan-card--reference",
    );
    expect(planCard).not.toHaveClass("tt-surface-nested");
    expect(planCard).not.toHaveClass("tt-token-service-card");
    expect(planCard.closest(".tt-token-plan-grid")).not.toBeNull();
    const planHeader = planCard.querySelector(".tt-widget-plan-card__top");
    const planCheck = planCard.querySelector(".tt-widget-plan-card__check");
    expect(planHeader).not.toBeNull();
    expect(planCheck).not.toBeNull();
    expect(planHeader.lastElementChild).toBe(planCheck);
    expect(planCheck).toHaveAttribute("aria-pressed", "true");
    expect(planCard.querySelector(".tt-token-plan-status")).toBeNull();
    expect(planCard.querySelector(".tt-token-plan-card-detail")).not.toBeNull();
    expect(within(planCard).getAllByTestId("widget-limit-quota-window")).toHaveLength(2);
    expect(within(planCard).getByText("7 天")).toBeInTheDocument();
    expect(within(planCard).getByText("GPT 5.3 Codex Spark")).toBeInTheDocument();
    expect(within(planCard).getByText("mux***@gmail.com")).toBeInTheDocument();
    expect(planCard.querySelector(".tt-token-plan-card-cost")).toBeNull();
    expect(planCard).toHaveAttribute("draggable", "true");
    expect(planCard).toHaveAttribute("data-layout-density", "content");
    expect(within(planCard).getAllByText(/重置时间:/u)).toHaveLength(2);
    expect(planCard.querySelectorAll('[data-align="end"]')).toHaveLength(2);
    expect(within(planCard).getByText(/2100\/08\/30/u)).toBeInTheDocument();
    expect(within(planCard).queryByText("2100-08-30T14:24:24.000Z")).not.toBeInTheDocument();
    expect(within(planCard).queryByText("主力开发账号")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("主力开发账号")).not.toBeInTheDocument();
    expect(plan).toBeChecked();
    expect(screen.getAllByRole("checkbox", { name: "Codex - Pro 20x" })).toHaveLength(1);

    const cursorCard = planCards[1];
    expect(within(cursorCard).getAllByTestId("widget-limit-quota-window")).toHaveLength(3);
    expect(within(cursorCard).getByText("Total Usage")).toBeInTheDocument();
    expect(within(cursorCard).getByText("Auto + Composer Usage")).toBeInTheDocument();
    expect(within(cursorCard).getByText("API Usage")).toBeInTheDocument();
    expect(within(cursorCard).queryByText("7d")).not.toBeInTheDocument();
    expect(within(cursorCard).queryByText("monthly")).not.toBeInTheDocument();
    expect(within(cursorCard).getByText("eze***@outlook.com")).toBeInTheDocument();
    expect(within(cursorCard).getAllByText(/重置时间:/u)).toHaveLength(3);
    expect(cursorCard.querySelector('[data-kind="total"] strong svg')).toBeNull();
    expect(cursorCard.querySelectorAll('[data-kind="auto_composer"] strong svg')).toHaveLength(1);
    expect(cursorCard.querySelectorAll('[data-kind="api"] strong svg')).toHaveLength(1);

    fireEvent.dragStart(planCard);
    fireEvent.dragEnter(cursorCard);
    expect(screen.getAllByTestId("widget-limit-plan-card").map((card) => card.dataset.planId))
      .toEqual(["cursor:pro", "codex:plus"]);
    fireEvent.dragEnd(planCard);

    await user.click(plan);
    expect(plan).not.toBeChecked();
    await user.click(plan);
    expect(plan).toBeChecked();

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

  it("shows active plans directly and keeps expired and scheduled counts independently collapsible", async () => {
    const user = userEvent.setup();
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        projectStatus: { projects: [] },
        limits: [
          { id: "active:total", planId: "active", provider: "Codex", planLabel: "", accountLabel: "Active account", window: "Total Usage", expiresAt: "2100-01-01" },
          { id: "expired-1:total", planId: "expired-1", provider: "Cursor", planLabel: "Expired one", accountLabel: "", window: "Total Usage", expiresAt: "2020-01-01" },
          { id: "expired-2:total", planId: "expired-2", provider: "Codex", planLabel: "", accountLabel: "Expired account", window: "Total Usage", expiresAt: "2020-01-01T00:00:00.000Z" },
          { id: "scheduled:total", planId: "scheduled", provider: "Claude", planLabel: "", accountLabel: "", window: "Total Usage", startsAt: "2100-01-01" },
        ],
      }),
      headers: new Headers({ "content-type": "application/json" }),
    });

    render(<WidgetsPage />);

    const activePlanButton = await screen.findByRole("button", { name: "Codex - Active account" });
    expect(activePlanButton).toBeInTheDocument();
    expect(activePlanButton.closest("article")).toHaveTextContent("2100/01/01 23:59");
    expect(screen.getAllByTestId("widget-limit-plan-card")).toHaveLength(1);
    const expiredToggle = screen.getByRole("button", {
      name: copy("settings.token_plan.expired_group", { count: 2 }),
    });
    const scheduledToggle = screen.getByRole("button", {
      name: copy("settings.token_plan.scheduled_group", { count: 1 }),
    });
    expect(expiredToggle).toHaveAttribute("aria-expanded", "false");
    expect(expiredToggle).toHaveAttribute("aria-controls", "widget-expired-limit-plan-panel");
    expect(scheduledToggle).toHaveAttribute("aria-expanded", "false");
    expect(scheduledToggle).toHaveAttribute("aria-controls", "widget-scheduled-limit-plan-panel");
    expect(screen.queryByTestId("widget-expired-limit-plan-list")).not.toBeInTheDocument();

    await user.click(expiredToggle);
    const expiredList = screen.getByTestId("widget-expired-limit-plan-list");
    expect(expiredToggle).toHaveAttribute("aria-expanded", "true");
    expect(expiredList).toHaveAttribute("id", "widget-expired-limit-plan-panel");
    expect(expiredList).toHaveClass("tt-widget-limit-plan-grid");
    expect(within(expiredList).getByRole("button", { name: "Cursor - Expired one" }))
      .toBeInTheDocument();
    expect(within(expiredList).getByRole("button", { name: "Codex - Expired account" }))
      .toBeInTheDocument();
    expect(within(expiredList).getAllByText((content) => (
      content.startsWith(`${copy("settings.token_plan.expired_at")}:`)
    ))).toHaveLength(2);
    expect(expiredList).toHaveTextContent("2020-01-01 23:59");
    expect(expiredList).not.toHaveTextContent(
      copy("settings.token_plan.validity_minutes", { minutes: 0 }),
    );

    await user.click(expiredToggle);
    expect(expiredToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("widget-expired-limit-plan-list")).not.toBeInTheDocument();

    await user.click(scheduledToggle);
    expect(scheduledToggle).toHaveAttribute("aria-expanded", "true");
    const scheduledList = screen.getByTestId("widget-scheduled-limit-plan-list");
    expect(scheduledList).toHaveAttribute("id", "widget-scheduled-limit-plan-panel");
    expect(scheduledList).toHaveClass("tt-widget-limit-plan-grid");
    expect(within(scheduledList).getByText("Claude"))
      .toBeInTheDocument();
    expect(scheduledList).toHaveTextContent(`${copy("settings.token_plan.starts_at")}:`);
    expect(scheduledList).toHaveTextContent("2100-01-01 00:00");
  });
});
