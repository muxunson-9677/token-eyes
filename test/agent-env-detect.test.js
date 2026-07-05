"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  detectEnvironmentForPath,
  detectAgentEnvironment,
  getWslDistributions,
} = require("../src/lib/agent-env-detect");

test("detectEnvironmentForPath returns not-detected for empty path", () => {
  const result = detectEnvironmentForPath("");
  assert.equal(result.environment, "not-detected");
  assert.equal(result.status, "not-detected");
});

test("detectEnvironmentForPath returns not-detected for null/undefined", () => {
  const result1 = detectEnvironmentForPath(null);
  assert.equal(result1.environment, "not-detected");
  assert.equal(result1.status, "not-detected");

  const result2 = detectEnvironmentForPath(undefined);
  assert.equal(result2.environment, "not-detected");
  assert.equal(result2.status, "not-detected");
});

test("detectEnvironmentForPath identifies Windows path kind", () => {
  const result = detectEnvironmentForPath("C:\\Users\\admin\\.claude");
  assert.equal(result.environment, "win");
});

test("detectEnvironmentForPath identifies WSL path kind", () => {
  const result = detectEnvironmentForPath("\\\\wsl.localhost\\Ubuntu\\home\\user\\.claude");
  assert.equal(result.environment, "wsl-ubuntu");
});

test("detectEnvironmentForPath returns executablePath for win paths", () => {
  const result = detectEnvironmentForPath("C:\\Users\\admin\\.claude");
  assert.ok("executablePath" in result);
});

test("detectEnvironmentForPath result has expected shape", () => {
  const result = detectEnvironmentForPath("C:\\test");
  assert.ok("environment" in result);
  assert.ok("status" in result);
  assert.ok(["win", "wsl-ubuntu", "not-detected"].includes(result.environment));
  assert.ok(["detected", "not-detected"].includes(result.status));
});

test("detectEnvironmentForPath returns not-detected when directory exists but no executable found", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-agent-env-no-exec-"));
  try {
    const result = detectEnvironmentForPath(tmp, "claude");
    assert.equal(result.environment, "win");
    assert.equal(result.status, "not-detected");
    assert.equal(result.executablePath, undefined);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("detectEnvironmentForPath returns detected when executable exists in directory", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-agent-env-has-exec-"));
  try {
    await fs.promises.writeFile(path.join(tmp, "claude.exe"), "", "utf8");
    const result = detectEnvironmentForPath(tmp, "claude");
    assert.equal(result.environment, "win");
    assert.equal(result.status, "detected");
    assert.ok(result.executablePath);
    assert.ok(result.executablePath.includes("claude.exe"));
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("detectAgentEnvironment returns not-detected for unknown agent", () => {
  const result = detectAgentEnvironment("nonexistent-agent");
  assert.equal(result.agent, "nonexistent-agent");
  assert.equal(result.environment, "not-detected");
  assert.equal(result.status, "not-detected");
  assert.equal(result.currentVersion, null);
  assert.equal(result.latestVersion, null);
});

test("detectAgentEnvironment returns detected status when only directory exists (no executable)", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-agent-env-test-"));
  try {
    const originalHomedir = os.homedir;
    os.homedir = () => tmp;

    try {
      const result = detectAgentEnvironment("claude");
      assert.equal(result.agent, "claude");
      assert.equal(result.status, "not-detected");
      assert.equal(result.currentVersion, null);
    } finally {
      os.homedir = originalHomedir;
    }
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("getWslDistributions returns empty array on non-Windows", () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "darwin" });
  try {
    const result = getWslDistributions();
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
});

test("detectAgentEnvironment returns null currentVersion when not ready", () => {
  const result = detectAgentEnvironment("nonexistent-agent");
  assert.equal(result.currentVersion, null);
});

test("detectAgentEnvironment returns null latestVersion", () => {
  const result = detectAgentEnvironment("claude");
  assert.equal(result.latestVersion, null);
});

test("detectAgentEnvironment marks a configured path ready when its parser has token evidence", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-agent-env-token-ready-"));
  try {
    await fs.promises.mkdir(path.join(tmp, "projects"), { recursive: true });
    await fs.promises.writeFile(path.join(tmp, "projects", "session.jsonl"), "{}\n", "utf8");

    const result = detectAgentEnvironment(
      "claude",
      { dataDirectories: { claude: tmp } },
      { detectInstallation: () => ({ installed: true, executablePath: "claude", currentVersion: "1.0.0" }) },
    );

    assert.equal(result.status, "ready");
    assert.equal(result.trackingReady, true);
    assert.equal(result.evidence, "token_logs");
    assert.equal(result.currentVersion, "1.0.0");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("detectAgentEnvironment does not call an empty residual directory ready", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-agent-env-token-empty-"));
  try {
    const result = detectAgentEnvironment(
      "openclaw",
      { dataDirectories: { openclaw: tmp } },
      { detectInstallation: () => ({ installed: false }) },
    );

    assert.equal(result.status, "not-detected");
    assert.equal(result.trackingReady, false);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
