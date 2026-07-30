import { act, render, screen, waitFor, within } from "@testing-library/react";
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
});
