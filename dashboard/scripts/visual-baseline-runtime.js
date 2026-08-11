import net from "node:net";
import path from "node:path";
import process from "node:process";
import { createBaselineJobs } from "./visual-baseline-config.js";

export function createDashboardDevServerCommand({
  repoRoot,
  hostname,
  port,
  execPath = process.execPath,
}) {
  return {
    executable: execPath,
    cwd: path.resolve(repoRoot, "dashboard"),
    args: [
      path.resolve(repoRoot, "dashboard/node_modules/vite/bin/vite.js"),
      "--host",
      hostname,
      "--port",
      String(port),
      "--strictPort",
    ],
  };
}

export function createStandaloneScreenshotTarget(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
  const job = createBaselineJobs(normalizedBaseUrl).find(
    (candidate) => candidate.name === "dashboard-desktop",
  );
  return {
    url: job.url,
    readySelector: job.readySelector,
  };
}

export function getEphemeralPort(hostname = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const reservation = net.createServer();
    reservation.once("error", reject);
    reservation.listen({ host: hostname, port: 0, exclusive: true }, () => {
      const address = reservation.address();
      if (!address || typeof address === "string") {
        reservation.close();
        reject(new Error("Could not reserve an ephemeral TCP port."));
        return;
      }
      reservation.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

export function createTemporaryDashboardServerConfig({
  dashboardRoot,
  hostname,
  port,
}) {
  return {
    root: dashboardRoot,
    configFile: path.resolve(dashboardRoot, "vite.config.js"),
    logLevel: "warn",
    server: {
      host: hostname,
      port,
      strictPort: true,
    },
  };
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    const finish = (didExit) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      child.removeListener("exit", onExit);
      child.removeListener("close", onExit);
      resolve(didExit);
    };
    const onExit = () => finish(true);
    child.once("exit", onExit);
    child.once("close", onExit);
    timeout = setTimeout(() => finish(false), timeoutMs);
  });
}

function signalDashboardDevServer(child, signal, { platform, processKill }) {
  if (platform !== "win32" && child.pid) {
    try {
      processKill(-child.pid, signal);
      return;
    } catch {
      // Fall back to signaling the exact child.
    }
  }
  child.kill(signal);
}

export async function stopDashboardDevServer(
  child,
  {
    platform = process.platform,
    timeoutMs = 5_000,
    processKill = process.kill,
  } = {},
) {
  if (!child || childHasExited(child)) return;

  const gracefulExit = waitForChildExit(child, timeoutMs);
  signalDashboardDevServer(child, "SIGTERM", { platform, processKill });
  if (await gracefulExit) return;

  const forcedExit = waitForChildExit(child, timeoutMs);
  signalDashboardDevServer(child, "SIGKILL", { platform, processKill });
  if (!(await forcedExit)) {
    throw new Error(`Timed out stopping dashboard dev server process ${child.pid ?? "unknown"}.`);
  }
}
