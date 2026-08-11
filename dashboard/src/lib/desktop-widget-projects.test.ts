import { describe, expect, it } from "vitest";
import {
  mergeWidgetProjectOptions,
  widgetProjectFromPath,
} from "./desktop-widget-projects";

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
});
