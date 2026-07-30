import { EventEmitter } from "node:events";
import path from "node:path";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import {
  createDashboardDevServerCommand,
  createStandaloneScreenshotTarget,
  createTemporaryDashboardServerConfig,
  getEphemeralPort,
  stopDashboardDevServer,
} from "../../scripts/visual-baseline-runtime.js";

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

describe("standalone screenshot target", () => {
  it("uses the deterministic dashboard baseline URL and readiness contract", () => {
    expect(createStandaloneScreenshotTarget("http://127.0.0.1:54321")).toEqual({
      url: "http://127.0.0.1:54321/?screenshot=1&mock=1&mock_seed=baseline&mock_today=2025-12-31&mock_now=2025-12-31T12:00:00Z",
      readySelector: '[data-testid="dashboard-primary-workspace"]',
    });
  });

  it("passes an OS-assigned nonzero port into the temporary Vite server", async () => {
    const dashboardRoot = path.resolve("D:/repo/dashboard");
    const port = await getEphemeralPort("127.0.0.1");
    const config = createTemporaryDashboardServerConfig({
      dashboardRoot,
      hostname: "127.0.0.1",
      port,
    });

    expect(port).toBeGreaterThan(0);
    expect(config).toEqual({
      root: dashboardRoot,
      configFile: path.resolve(dashboardRoot, "vite.config.js"),
      logLevel: "warn",
      server: {
        host: "127.0.0.1",
        port,
        strictPort: true,
      },
    });
  });
});

describe("visual baseline dev server shutdown", () => {
  it("waits for the child to close after graceful termination", async () => {
    const child = new EventEmitter();
    let closed = false;
    child.pid = 1234;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn((signal) => {
      setTimeout(() => {
        closed = true;
        child.signalCode = signal;
        child.emit("close", null, signal);
      }, 10);
      return true;
    });

    await stopDashboardDevServer(child, {
      platform: "win32",
      timeoutMs: 50,
    });

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(closed).toBe(true);
  });

  it("force-kills only the same child after the graceful timeout", async () => {
    const child = new EventEmitter();
    let closed = false;
    child.pid = 5678;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn((signal) => {
      if (signal === "SIGKILL") {
        queueMicrotask(() => {
          closed = true;
          child.signalCode = signal;
          child.emit("close", null, signal);
        });
      }
      return true;
    });

    await stopDashboardDevServer(child, {
      platform: "win32",
      timeoutMs: 5,
    });

    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(closed).toBe(true);
  });
});
