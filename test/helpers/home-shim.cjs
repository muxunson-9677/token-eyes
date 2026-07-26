"use strict";

/**
 * Unified Node test preload.
 *
 * It keeps HOME and temporary files inside the repository on every platform,
 * removes ambient credential/data-directory overrides, and denies external
 * fetch calls unless a test injects its own fake fetch implementation.
 */

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const STATE_KEY = Symbol.for("tokentracker.test-environment");

if (!globalThis[STATE_KEY]) {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const testTempParent = path.join(repoRoot, ".tmp");
  const inheritedOwnerPid = Number.parseInt(
    process.env.TOKENTRACKER_TEST_TEMP_OWNER_PID || "",
    10,
  );
  const ownerPid = Number.isFinite(inheritedOwnerPid) && inheritedOwnerPid > 0
    ? inheritedOwnerPid
    : process.pid;
  const testTempRoot = process.env.TOKENTRACKER_TEST_TEMP_ROOT
    ? path.resolve(process.env.TOKENTRACKER_TEST_TEMP_ROOT)
    : path.join(testTempParent, `node-test-${ownerPid}`);
  const relativeTempRoot = path.relative(testTempParent, testTempRoot);
  if (
    !relativeTempRoot ||
    relativeTempRoot.startsWith("..") ||
    path.isAbsolute(relativeTempRoot)
  ) {
    throw new Error("Test temp root must stay inside the repository .tmp directory");
  }

  fs.mkdirSync(testTempRoot, { recursive: true });
  const testHome = path.join(testTempRoot, "home");
  fs.mkdirSync(testHome, { recursive: true });

  process.env.TOKENTRACKER_TEST_TEMP_OWNER_PID = String(ownerPid);
  process.env.TOKENTRACKER_TEST_TEMP_ROOT = testTempRoot;
  process.env.TOKENTRACKER_TEST_DISABLE_SYSTEM_KEYCHAIN = "1";
  process.env.TOKENTRACKER_TEST_DISABLE_WINDOWS_DRIVE_SCAN = "1";
  process.env.HOME = testHome;
  process.env.USERPROFILE = testHome;
  process.env.TEMP = testTempRoot;
  process.env.TMP = testTempRoot;
  process.env.TMPDIR = testTempRoot;
  process.env.APPDATA = path.join(testHome, "AppData", "Roaming");
  process.env.LOCALAPPDATA = path.join(testHome, "AppData", "Local");
  process.env.XDG_CONFIG_HOME = path.join(testHome, ".config");
  process.env.XDG_DATA_HOME = path.join(testHome, ".local", "share");

  for (const key of [
    "AGENTDATA",
    "CLAUDE_HOME",
    "CODE_HOME",
    "CODEBUDDY_HOME",
    "CODEX_HOME",
    "COPILOT_OTEL_ENABLED",
    "COPILOT_OTEL_EXPORTER_TYPE",
    "COPILOT_OTEL_FILE_EXPORTER_PATH",
    "CRAFT_CONFIG_DIR",
    "CURSOR_HOME",
    "DROID_SESSIONS_DIR",
    "FACTORY_DIR",
    "GEMINI_HOME",
    "GOOSE_PATH_ROOT",
    "GROK_HOME",
    "GROK_WORKSPACE_ROOT",
    "KIMI_CODE_HOME",
    "KIMI_HOME",
    "KILO_HOME",
    "KIRO_CLI_DB_PATH",
    "KIRO_HOME",
    "OMP_HOME",
    "OPENCLAW_CONFIG_PATH",
    "OPENCLAW_HOME",
    "OPENCLAW_STATE_DIR",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_HOME",
    "PI_CODING_AGENT_DIR",
    "PI_CONFIG_DIR",
    "TOKENTRACKER_AGENTDATA_ROOTS",
    "TOKENTRACKER_ANTIGRAVITY_HOME",
    "TOKENTRACKER_DEVICE_TOKEN",
    "TOKENTRACKER_GOOSE_DB",
    "TOKENTRACKER_GROK_BILLING_BASE_URL",
    "TOKENTRACKER_GROK_HOME",
    "TOKENTRACKER_HERMES_HOME",
    "TOKENTRACKER_INSFORGE_ANON_KEY",
    "TOKENTRACKER_INSFORGE_BASE_URL",
    "TOKENTRACKER_KILOCODE_ROOTS",
    "TOKENTRACKER_OMP_AGENT_DIR",
    "TOKENTRACKER_OPENCLAW_HOME",
    "TOKENTRACKER_PI_AGENT_DIR",
    "TOKENTRACKER_TRAE_DECRYPTED_DB",
    "TOKENTRACKER_TRAE_ROOTS",
    "TOKENTRACKER_ZED_DB",
    "TRAE_HOME",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GITHUB_TOKEN",
    "GOOGLE_API_KEY",
    "OPENAI_API_KEY",
  ]) {
    delete process.env[key];
  }

  os.homedir = function isolatedTestHomedir() {
    return process.env.HOME || testHome;
  };
  os.tmpdir = function isolatedTestTmpdir() {
    return testTempRoot;
  };

  const realFetch = globalThis.fetch;
  const deniedFetch = async function deniedExternalTestFetch(input, init) {
    let parsed;
    try {
      parsed = new URL(
        typeof input === "string" || input instanceof URL ? input : input?.url,
      );
    } catch {
      parsed = null;
    }
    const hostname = parsed?.hostname?.toLowerCase() || "";
    const isLoopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";
    if (isLoopback && typeof realFetch === "function") {
      return realFetch(input, init);
    }

    const error = new Error(
      "External network is disabled in tests; inject a fake fetch implementation.",
    );
    error.code = "ERR_TEST_NETWORK_DISABLED";
    throw error;
  };
  Object.defineProperty(deniedFetch, "__tokentrackerTestNetworkDeny", {
    value: true,
    enumerable: false,
  });
  globalThis.fetch = deniedFetch;

  function requestHostname(input, options) {
    if (options?.socketPath || (input && typeof input === "object" && input.socketPath)) {
      return "";
    }
    let url = null;
    if (typeof input === "string" || input instanceof URL) {
      try {
        url = new URL(input);
      } catch {
        url = null;
      }
    }
    const candidate =
      options?.hostname ||
      (input && typeof input === "object" && !(input instanceof URL) ? input.hostname : "") ||
      options?.host ||
      (input && typeof input === "object" && !(input instanceof URL) ? input.host : "") ||
      url?.hostname ||
      "localhost";
    const normalized = String(candidate).trim().toLowerCase();
    if (normalized === "::1" || normalized === "[::1]") return "::1";
    try {
      return new URL(`http://${normalized}`).hostname.toLowerCase();
    } catch {
      return normalized.replace(/:\d+$/, "");
    }
  }

  function isLocalRequest(input, options) {
    if (options?.socketPath || (input && typeof input === "object" && input.socketPath)) {
      return true;
    }
    const hostname = requestHostname(input, options);
    return (
      hostname === "" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  }

  function deniedClientRequest() {
    const request = new EventEmitter();
    let emitted = false;
    const emitDenied = () => {
      if (emitted) return;
      emitted = true;
      request.destroyed = true;
      const error = new Error(
        "External network is disabled in tests; use loopback or inject a transport.",
      );
      error.code = "ERR_TEST_NETWORK_DISABLED";
      request.emit("error", error);
    };
    request.destroyed = false;
    request.aborted = false;
    request.write = () => true;
    request.end = () => request;
    request.abort = () => {
      request.aborted = true;
      return request;
    };
    request.destroy = () => {
      request.destroyed = true;
      return request;
    };
    request.setTimeout = () => request;
    request.setNoDelay = () => request;
    request.setSocketKeepAlive = () => request;
    request.setHeader = () => request;
    request.getHeader = () => undefined;
    request.getHeaders = () => ({});
    request.hasHeader = () => false;
    request.removeHeader = () => {};
    process.nextTick(emitDenied);
    return request;
  }

  function installRequestDeny(module) {
    const realRequest = module.request;
    module.request = function isolatedTestRequest(input, options, callback) {
      const resolvedOptions =
        options && typeof options === "object" && typeof options !== "function"
          ? options
          : undefined;
      if (isLocalRequest(input, resolvedOptions)) {
        return realRequest.apply(this, arguments);
      }
      return deniedClientRequest();
    };
    module.get = function isolatedTestGet() {
      const request = module.request.apply(this, arguments);
      request.end();
      return request;
    };
  }

  installRequestDeny(http);
  installRequestDeny(https);

  globalThis[STATE_KEY] = {
    repoRoot,
    testTempRoot,
  };

  if (process.pid === ownerPid) {
    process.once("exit", () => {
      const resolved = path.resolve(testTempRoot);
      const relative = path.relative(testTempParent, resolved);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    });
  }
}

module.exports = globalThis[STATE_KEY];
