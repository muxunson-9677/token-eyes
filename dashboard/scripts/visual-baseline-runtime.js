import path from "node:path";
import process from "node:process";

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
