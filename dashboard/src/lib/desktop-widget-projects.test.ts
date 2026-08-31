import { describe, expect, it } from "vitest";
import {
  mergeWidgetProjectOptions,
  widgetProjectFromPath,
} from "./desktop-widget-projects";
import * as widgetProjects from "./desktop-widget-projects";

describe("desktop widget project folders", () => {
  it("uses the same normalized path identity as the lifecycle collector", async () => {
    await expect(widgetProjectFromPath("D:\\Work\\012-EDU-lite\\")).resolves.toEqual({
      id: "project-75d9d2753cd4",
      label: "012-EDU-lite",
      path: "D:\\Work\\012-EDU-lite",
    });
  });

  it("keeps selected folders visible when the live lifecycle feed is empty", () => {
    expect(mergeWidgetProjectOptions([], [{
      id: "project-folder",
      label: "012-EDU-lite",
      path: "D:\\Work\\012-EDU-lite",
    }])).toEqual([{
      id: "project-folder",
      label: "012-EDU-lite",
      path: "D:\\Work\\012-EDU-lite",
    }]);
  });

  it("keeps lifecycle sessions nested under their real project ids and retains saved empty projects", () => {
    const merge = (widgetProjects as Record<string, unknown>).mergeWidgetStatusProjects;
    expect(merge).toBeTypeOf("function");
    if (typeof merge !== "function") return;

    expect(merge([
      {
        id: "project-a",
        label: "Token Eyes",
        red: 0,
        yellow: 1,
        green: 1,
        unknown: 0,
        sessions: [
          { id: "session-a1", taskLabel: "修复桌面小组件", status: "yellow", state: "running", updatedAt: "2026-08-30T08:00:00.000Z" },
          { id: "session-a2", label: "复核会话分组", status: "green", state: "completed", updatedAt: "2026-08-30T07:00:00.000Z" },
        ],
      },
      {
        id: "project-b",
        label: "Token Eyes",
        red: 0,
        yellow: 0,
        green: 0,
        unknown: 0,
        sessions: [],
      },
    ], [], [{
      id: "saved-empty",
      label: "Archived workspace",
      path: "D:\\Work\\Archived workspace",
    }])).toEqual([
      expect.objectContaining({
        id: "project-a",
        label: "Token Eyes",
        updatedAt: "2026-08-30T08:00:00.000Z",
        sessions: [
          expect.objectContaining({ id: "session-a1", label: "修复桌面小组件" }),
          expect.objectContaining({ id: "session-a2", label: "复核会话分组" }),
        ],
      }),
      expect.objectContaining({ id: "project-b", label: "Token Eyes", sessions: [] }),
      expect.objectContaining({ id: "saved-empty", label: "Archived workspace", sessions: [] }),
    ]);
  });

  it("migrates legacy selected session ids to one owning project id", () => {
    const migrate = (widgetProjects as Record<string, unknown>).migrateWidgetProjectSelectionIds;
    expect(migrate).toBeTypeOf("function");
    if (typeof migrate !== "function") return;

    expect(migrate([{
      id: "project-a",
      sessions: [{ id: "session-a1" }, { id: "session-a2" }],
    }, {
      id: "saved-empty",
      sessions: [],
    }], ["session-a1", "session-a2", "saved-empty"])).toEqual([
      "project-a",
      "saved-empty",
    ]);
  });

  it("does not materialize a legacy selected session as a fake project", () => {
    const merge = (widgetProjects as Record<string, unknown>).mergeWidgetStatusProjects;
    const migrate = (widgetProjects as Record<string, unknown>).migrateWidgetProjectSelectionIds;
    expect(merge).toBeTypeOf("function");
    expect(migrate).toBeTypeOf("function");
    if (typeof merge !== "function" || typeof migrate !== "function") return;

    const projects = merge([{
      id: "project-a",
      label: "Token Eyes",
      sessions: [{ id: "session-a1", label: "Legacy selected session" }],
    }], [], [{
      id: "session-a1",
      label: "Legacy selected session",
    }]);

    expect(projects.map((project: { id: string }) => project.id)).toEqual(["project-a"]);
    expect(migrate(projects, ["session-a1"])).toEqual(["project-a"]);
  });

  it("maps a legacy selected session through its recent project after it leaves the active window", () => {
    const merge = (widgetProjects as Record<string, unknown>).mergeWidgetStatusProjects;
    const migrate = (widgetProjects as Record<string, unknown>).migrateWidgetProjectSelectionIds;
    expect(merge).toBeTypeOf("function");
    expect(migrate).toBeTypeOf("function");
    if (typeof merge !== "function" || typeof migrate !== "function") return;

    const projects = merge([], [{
      id: "project-a",
      label: "Token Eyes",
      sessionIds: ["session-old"],
    }], [{
      id: "session-old",
      label: "Legacy selected session",
    }]);

    expect(projects.map((project: { id: string }) => project.id)).toEqual(["project-a"]);
    expect(migrate(projects, ["session-old"])).toEqual(["project-a"]);
  });
});
