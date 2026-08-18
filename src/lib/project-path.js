"use strict";

const path = require("node:path");
const os = require("node:os");

const WSL_LOCALHOST_PREFIX = "\\\\wsl.localhost\\";
const WSL_DISTRO_PREFIX = /^\\\\wsl\$\\([^\\]+)\\/i;
const WSL_UNIX_PREFIX = /^\/mnt\/([a-z])\//i;

function detectPathKind(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) return "unknown";
  const p = inputPath.trim();

  // UNC WSL paths: \\wsl.localhost\... or \\wsl$\...
  if (p.startsWith(WSL_LOCALHOST_PREFIX) || WSL_DISTRO_PREFIX.test(p)) {
    return "wsl";
  }

  // Windows drive paths: C:\... or C:/...
  if (/^[a-zA-Z]:[\\\/]/.test(p)) {
    return "windows";
  }

  // WSL mount of Windows drive: /mnt/c/...
  if (WSL_UNIX_PREFIX.test(p)) {
    return "wsl";
  }

  // POSIX absolute paths: /Users/..., /home/..., /var/..., etc.
  // These are native macOS/Linux paths, NOT WSL paths.
  if (p.startsWith("/")) {
    return "posix";
  }

  return "unknown";
}

function resolvePathStatus(projectPath) {
  if (typeof projectPath !== "string" || !projectPath.trim()) return "not_detected";
  return "detected";
}

function normalizeToWinPath(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) return "";
  const p = inputPath.trim();

  if (/^[a-zA-Z]:[\\\/]/.test(p)) {
    return p.replace(/\//g, "\\").replace(/\\+/g, "\\");
  }

  const wslDistroMatch = p.match(WSL_DISTRO_PREFIX);
  if (wslDistroMatch) {
    const distro = wslDistroMatch[1];
    const rest = p.slice(wslDistroMatch[0].length).replace(/\//g, "\\");
    return `\\\\wsl.localhost\\${distro}\\${rest}`;
  }

  if (p.startsWith(WSL_LOCALHOST_PREFIX)) {
    const rest = p.slice(WSL_LOCALHOST_PREFIX.length).replace(/\//g, "\\");
    return `\\\\wsl.localhost\\${rest}`;
  }

  const mntMatch = p.match(WSL_UNIX_PREFIX);
  if (mntMatch) {
    const drive = mntMatch[1].toUpperCase();
    const rest = p.slice(mntMatch[0].length).replace(/\//g, "\\");
    return `${drive}:\\${rest}`;
  }

  return p.replace(/\//g, "\\");
}

function normalizeProjectKey(projectKey, projectRef) {
  if (typeof projectKey !== "string" || !projectKey.trim()) {
    return { key: "unknown", kind: "unknown" };
  }

  const key = projectKey.trim();

  if (key.startsWith("file://")) {
    const filePath = key.slice("file://".length);
    const kind = detectPathKind(filePath);
    const normalized = normalizeToWinPath(filePath).toLowerCase();
    return { key: normalized, kind };
  }

  if (typeof projectRef === "string" && projectRef.startsWith("file://")) {
    const filePath = projectRef.slice("file://".length);
    const kind = detectPathKind(filePath);
    const normalized = normalizeToWinPath(filePath).toLowerCase();
    return { key: normalized, kind };
  }

  const kind = detectPathKind(key);
  if (kind !== "unknown") {
    const normalized = normalizeToWinPath(key).toLowerCase();
    return { key: normalized, kind };
  }

  return { key: key.toLowerCase(), kind: "unknown" };
}

function extractProjectName(projectKey, projectRef) {
  if (typeof projectRef === "string" && projectRef.trim()) {
    const ref = projectRef.trim();
    if (ref.startsWith("https://github.com/")) {
      const parts = ref.replace("https://github.com/", "").split("/");
      if (parts.length >= 2) return parts[1].replace(/\.git$/, "");
    }
    if (ref.startsWith("file://")) {
      const filePath = ref.slice("file://".length);
      const normalized = normalizeToWinPath(filePath);
      const base = path.win32.basename(normalized);
      if (base && base !== "\\" && base !== "/") return base;
    }
  }

  if (typeof projectKey !== "string" || !projectKey.trim()) return "unknown";
  const key = projectKey.trim();

  if (key.includes("/") && !key.startsWith("/")) {
    const parts = key.split("/");
    return parts[parts.length - 1] || key;
  }

  if (detectPathKind(key) !== "unknown") {
    const normalized = normalizeToWinPath(key);
    const base = path.win32.basename(normalized);
    if (base && base !== "\\" && base !== "/") return base;
  }

  return key;
}

function resolveProjectPathDisplay(projectKey, projectRef, repoRoot) {
  if (typeof repoRoot === "string" && repoRoot.trim() && detectPathKind(repoRoot) !== "unknown") {
    return repoRoot.trim();
  }

  if (typeof projectRef === "string" && projectRef.trim() && projectRef.startsWith("file://")) {
    return projectRef.slice("file://".length);
  }

  if (typeof projectKey === "string" && projectKey.trim() && detectPathKind(projectKey) !== "unknown") {
    return projectKey;
  }

  return "";
}

module.exports = {
  detectPathKind,
  resolvePathStatus,
  normalizeToWinPath,
  normalizeProjectKey,
  extractProjectName,
  resolveProjectPathDisplay,
};

