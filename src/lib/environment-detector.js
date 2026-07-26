"use strict";

/**
 * O3 environment detector.
 *
 * Reuses the contract frozen in O0 (`environment_kind` enum) and the existing
 * `agent-env-detect.js` capability, but exposes a single canonical entry point
 * that returns the v2 `{ kind, id }` shape. Legacy callers can convert via
 * `mapLegacyEnvironmentKind()`.
 *
 * Detection priority (highest first):
 *   1. container        — /.dockerenv, /run/.containerenv, env.container,
 *                          or /proc/1/cgroup mentions docker/containerd/
 *                          kubepods/lxc.
 *   2. wsl              — WSL_DISTRO_NAME set, or platform is linux but the
 *                          process is running under Microsoft's WSL.
 *   3. ssh              — SSH_CONNECTION or SSH_CLIENT set.
 *   4. native           — win32, darwin, or linux without any of the above.
 *   5. unknown          — hostname cannot be determined.
 *
 * `environment_id` is `<kind>:<host>` so that distinct hosts never collapse
 * onto the same bucket; the only exception is `unknown`, which uses the
 * single literal `"unknown"` to match O0's legacy mapping.
 */

const fs = require("node:fs");
const os = require("node:os");

const ENVIRONMENT_KINDS = new Set([
  "native",
  "wsl",
  "ssh",
  "container",
  "unknown",
]);

const CONTAINER_CGROUP_PATTERN = /docker|containerd|kubepods|lxc/i;

function safeReadFile(readFile, filePath) {
  if (typeof readFile !== "function") return "";
  try {
    return String(readFile(filePath, "utf8") || "");
  } catch {
    return "";
  }
}

function safePathExists(pathExists, filePath) {
  if (typeof pathExists !== "function") {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }
  try {
    return Boolean(pathExists(filePath));
  } catch {
    return false;
  }
}

function isLinuxContainer({ env, pathExists, readFile }) {
  if (env && env.container) return true;
  if (safePathExists(pathExists, "/.dockerenv")) return true;
  if (safePathExists(pathExists, "/run/.containerenv")) return true;
  const cgroup = safeReadFile(readFile, "/proc/1/cgroup");
  if (CONTAINER_CGROUP_PATTERN.test(cgroup)) return true;
  return false;
}

function normalizeHostname(hostname) {
  if (typeof hostname !== "string") return "";
  const trimmed = hostname.trim().toLowerCase();
  return trimmed;
}

function buildId(kind, hostname) {
  const host = normalizeHostname(hostname);
  if (!host) {
    return kind === "unknown" ? "unknown" : `unknown:${kind}`;
  }
  return `${kind}:${host}`;
}

/**
 * Returns the current runtime environment as `{ kind, id }`.
 *
 * Accepts an options bag for test injection. When called with no arguments
 * it reads `process.platform`, `process.env`, and `os.hostname()` directly.
 */
function detectCurrentEnvironment(input = {}) {
  const platform = input.platform || process.platform;
  const env = input.env || process.env;
  const hostname = input.hostname != null ? input.hostname : os.hostname();
  const pathExists = input.pathExists;
  const readFile = input.readFile;

  // The container check is the most reliable signal across all platforms
  // (Docker Desktop on macOS/Windows still surfaces /.dockerenv inside the
  // container), so it wins over WSL and SSH.
  if (platform === "linux" && isLinuxContainer({ env, pathExists, readFile })) {
    return { kind: "container", id: buildId("container", hostname) };
  }

  if (env && typeof env.WSL_DISTRO_NAME === "string" && env.WSL_DISTRO_NAME.trim()) {
    const distro = env.WSL_DISTRO_NAME.trim().toLowerCase();
    return { kind: "wsl", id: `wsl:${distro}` };
  }

  const hasSshSignal =
    (env && typeof env.SSH_CONNECTION === "string" && env.SSH_CONNECTION.trim()) ||
    (env && typeof env.SSH_CLIENT === "string" && env.SSH_CLIENT.trim());
  if (hasSshSignal) {
    return { kind: "ssh", id: buildId("ssh", hostname) };
  }

  if (platform === "win32" || platform === "darwin" || platform === "linux") {
    const host = normalizeHostname(hostname);
    if (!host) {
      return { kind: "unknown", id: "unknown" };
    }
    return { kind: "native", id: `native:${host}` };
  }

  return { kind: "unknown", id: "unknown" };
}

/**
 * Maps a legacy `agent-env-detect.js` environment string to the v2 enum.
 *
 * Legacy values seen in the wild:
 *   - "win"             → "native"
 *   - "wsl-ubuntu"      → "wsl"
 *   - "wsl-<distro>"    → "wsl"
 *   - "wsl"             → "wsl"
 *   - "native"          → "native"
 *   - "not-detected"    → "unknown"
 *   - null/undefined    → "unknown"
 *
 * Anything else maps to "unknown" so historical data lands in the unknown
 * bucket rather than being guessed at.
 */
function mapLegacyEnvironmentKind(legacy) {
  if (typeof legacy !== "string") return "unknown";
  const value = legacy.trim().toLowerCase();
  if (!value) return "unknown";
  if (value === "native") return "native";
  if (value === "win" || value === "windows") return "native";
  if (value === "wsl" || value.startsWith("wsl-")) return "wsl";
  if (value === "ssh") return "ssh";
  if (value === "container") return "container";
  if (value === "not-detected") return "unknown";
  return "unknown";
}

module.exports = {
  ENVIRONMENT_KINDS,
  detectCurrentEnvironment,
  mapLegacyEnvironmentKind,
};
