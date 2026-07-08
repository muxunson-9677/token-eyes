import { describe, expect, it } from "vitest";
import { copy } from "./copy";

describe("copy registry", () => {
  it("uses non-misleading native dashboard empty-state copy", () => {
    expect(copy("dashboard.install.prompt")).not.toContain("Node.js");
    expect(copy("dashboard.daily.empty", { cmd: "npx --yes tokentracker-cli sync" })).toContain("刷新");
  });
});