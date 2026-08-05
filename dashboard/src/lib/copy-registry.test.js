import { describe, expect, it } from "vitest";
import { copy } from "./copy";

describe("copy registry", () => {
  it("uses non-misleading native dashboard empty-state copy", () => {
    expect(copy("dashboard.install.prompt")).not.toContain("Node.js");
    expect(copy("dashboard.daily.empty")).toContain("刷新");
    expect(copy("dashboard.daily.empty")).not.toContain("tokentracker-cli");
  });
});
