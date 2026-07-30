import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { createDashboardDevServerCommand } from "../../scripts/visual-baseline-runtime.js";

describe("visual baseline dev server command", () => {
  it("starts Vite directly through Node on Windows", () => {
    const repoRoot = path.resolve("D:/repo");
    const command = createDashboardDevServerCommand({
      repoRoot,
      hostname: "127.0.0.1",
      port: 5193,
      execPath: process.execPath,
    });

    expect(command).toEqual({
      executable: process.execPath,
      cwd: path.resolve(repoRoot, "dashboard"),
      args: [
        path.resolve(repoRoot, "dashboard/node_modules/vite/bin/vite.js"),
        "--host",
        "127.0.0.1",
        "--port",
        "5193",
        "--strictPort",
      ],
    });
  });
});
