"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  detectPathKind,
  resolvePathStatus,
  normalizeToWinPath,
  normalizeProjectKey,
  extractProjectName,
  resolveProjectPathDisplay,
} = require("../src/lib/project-path");

test("detectPathKind identifies Windows paths", () => {
  assert.equal(detectPathKind("C:\\Users\\admin\\.claude"), "windows");
  assert.equal(detectPathKind("D:\\Projects\\my-app"), "windows");
  assert.equal(detectPathKind("c:/users/admin/.codex"), "windows");
});

test("detectPathKind identifies WSL paths", () => {
  assert.equal(detectPathKind("\\\\wsl.localhost\\Ubuntu\\home\\user\\.claude"), "wsl");
  assert.equal(detectPathKind("\\\\wsl$\\Ubuntu\\home\\user"), "wsl");
  assert.equal(detectPathKind("/mnt/c/Users/admin"), "wsl");
});

test("detectPathKind identifies POSIX paths (not WSL)", () => {
  assert.equal(detectPathKind("/home/user/.codex"), "posix");
  assert.equal(detectPathKind("/Users/user/code/my-project"), "posix");
  assert.equal(detectPathKind("/var/log/app"), "posix");
  assert.equal(detectPathKind("/tmp/build-output"), "posix");
});

test("detectPathKind returns unknown for empty or invalid paths", () => {
  assert.equal(detectPathKind(""), "unknown");
  assert.equal(detectPathKind(null), "unknown");
  assert.equal(detectPathKind(undefined), "unknown");
  assert.equal(detectPathKind("just-a-name"), "unknown");
});

test("resolvePathStatus returns detected for non-empty paths", () => {
  assert.equal(resolvePathStatus("C:\\Users\\admin"), "detected");
  assert.equal(resolvePathStatus("/home/user/.codex"), "detected");
  assert.equal(resolvePathStatus("some/path"), "detected");
});

test("resolvePathStatus returns not_detected for empty or missing paths", () => {
  assert.equal(resolvePathStatus(""), "not_detected");
  assert.equal(resolvePathStatus(null), "not_detected");
  assert.equal(resolvePathStatus(undefined), "not_detected");
  assert.equal(resolvePathStatus("   "), "not_detected");
});

test("normalizeToWinPath normalizes Windows paths", () => {
  assert.equal(normalizeToWinPath("C:/Users/admin/.claude"), "C:\\Users\\admin\\.claude");
  assert.equal(normalizeToWinPath("C:\\Users\\admin\\.claude"), "C:\\Users\\admin\\.claude");
});

test("normalizeToWinPath preserves WSL localhost paths", () => {
  assert.equal(
    normalizeToWinPath("\\\\wsl.localhost\\Ubuntu\\home\\user\\.claude"),
    "\\\\wsl.localhost\\Ubuntu\\home\\user\\.claude",
  );
});

test("normalizeToWinPath converts /mnt/c/ style to Windows drive path", () => {
  assert.equal(
    normalizeToWinPath("/mnt/c/Users/admin/.claude"),
    "C:\\Users\\admin\\.claude",
  );
});

test("normalizeProjectKey normalizes file:// paths", () => {
  const result = normalizeProjectKey(
    "file://C:/Users/admin/project",
    "file://C:/Users/admin/project",
  );
  assert.equal(result.kind, "windows");
  assert.ok(result.key.includes(":"));
});

test("normalizeProjectKey normalizes WSL paths", () => {
  const result = normalizeProjectKey(
    "\\\\wsl.localhost\\Ubuntu\\home\\user\\project",
    "",
  );
  assert.equal(result.kind, "wsl");
});

test("extractProjectName extracts name from GitHub URLs", () => {
  assert.equal(
    extractProjectName("owner/repo", "https://github.com/owner/repo"),
    "repo",
  );
});

test("extractProjectName extracts name from file paths", () => {
  assert.equal(
    extractProjectName("C:\\Projects\\my-app", "file://C:/Projects/my-app"),
    "my-app",
  );
});

test("extractProjectName extracts basename from path-like keys", () => {
  assert.equal(
    extractProjectName("C:\\Users\\admin\\work\\token-eye", ""),
    "token-eye",
  );
});

test("resolveProjectPathDisplay returns path from file:// ref", () => {
  assert.equal(
    resolveProjectPathDisplay("", "file://C:/Users/admin/.claude"),
    "C:/Users/admin/.claude",
  );
});

test("resolveProjectPathDisplay returns path from key if it looks like a path", () => {
  assert.equal(
    resolveProjectPathDisplay("C:\\Users\\admin\\.codex", ""),
    "C:\\Users\\admin\\.codex",
  );
});

test("resolveProjectPathDisplay returns empty for non-path keys", () => {
  assert.equal(resolveProjectPathDisplay("claude", ""), "");
  assert.equal(resolveProjectPathDisplay("owner/repo", "https://github.com/owner/repo"), "");
});

test("normalizeProjectKey normalizes same project from different path representations", () => {
  const winResult = normalizeProjectKey(
    "C:\\Users\\admin\\project",
    "file://C:/Users/admin/project",
  );
  const slashResult = normalizeProjectKey(
    "C:/Users/admin/project",
    "",
  );
  assert.equal(winResult.key.toLowerCase(), slashResult.key.toLowerCase());
});

test("normalizeProjectKey normalizes wsl.localhost and wsl$ to same key", () => {
  const localhostResult = normalizeProjectKey(
    "\\\\wsl.localhost\\Ubuntu\\home\\user\\project",
    "",
  );
  const dollarResult = normalizeProjectKey(
    "\\\\wsl$\\Ubuntu\\home\\user\\project",
    "",
  );
  assert.equal(localhostResult.kind, "wsl");
  assert.equal(dollarResult.kind, "wsl");
  assert.equal(localhostResult.key, dollarResult.key);
});

test("normalizeToWinPath converts wsl$ format to wsl.localhost format", () => {
  const result = normalizeToWinPath("\\\\wsl$\\Ubuntu\\home\\user\\.claude");
  assert.equal(result, "\\\\wsl.localhost\\Ubuntu\\home\\user\\.claude");
});
