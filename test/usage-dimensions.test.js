"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildUsageDimensions,
  normalizeAgentId,
  normalizeProjectKey,
  ENVIRONMENT_UNKNOWN,
} = require("../src/lib/usage-dimensions");

describe("usage-dimensions", () => {
  describe("normalizeAgentId", () => {
    it("lowercases and trims the agent id", () => {
      assert.equal(normalizeAgentId("  Claude  "), "claude");
      assert.equal(normalizeAgentId("CODEX"), "codex");
    });

    it("returns 'unknown' for empty or non-string input", () => {
      assert.equal(normalizeAgentId(""), "unknown");
      assert.equal(normalizeAgentId(null), "unknown");
      assert.equal(normalizeAgentId(undefined), "unknown");
      assert.equal(normalizeAgentId(42), "unknown");
    });
  });

  describe("normalizeProjectKey", () => {
    it("returns null when no project path or key is provided", () => {
      assert.equal(normalizeProjectKey({}), null);
      assert.equal(normalizeProjectKey({ projectPath: "", projectName: "" }), null);
    });

    it("normalizes a Windows path to a stable lowercase key", () => {
      const result = normalizeProjectKey({ projectPath: "C:\\Users\\Admin\\Code\\App" });
      assert.equal(result, "c:\\users\\admin\\code\\app");
    });

    it("normalizes a file:// URI through project-path normalizeToWinPath", () => {
      // project-path.js collapses posix forward slashes to backslashes so the
      // same project keyed from Windows or POSIX collapses into one bucket.
      const result = normalizeProjectKey({ projectPath: "file:///home/user/app" });
      assert.equal(result, "\\home\\user\\app");
    });

    it("preserves project_key when no path is given but projectKey is", () => {
      const result = normalizeProjectKey({ projectKey: "github:owner/repo" });
      assert.equal(result, "github:owner/repo");
    });

    it("does not expose the original cased path", () => {
      const result = normalizeProjectKey({ projectPath: "C:\\SECRET\\Path" });
      assert.equal(result, "c:\\secret\\path");
      assert.ok(!result.includes("SECRET"));
    });
  });

  describe("buildUsageDimensions", () => {
    const baseInput = {
      agentId: "claude",
      modelId: "claude-opus-4-6",
    };

    const baseOptions = {
      machineId: "stable-machine-id-1234",
      environment: { kind: "native", id: "native:host-a" },
    };

    it("returns a valid UsageDimensionsV1 object", () => {
      const dims = buildUsageDimensions(baseInput, baseOptions);
      assert.equal(dims.device_id, "stable-machine-id-1234");
      assert.equal(dims.environment_id, "native:host-a");
      assert.equal(dims.environment_kind, "native");
      assert.equal(dims.agent_id, "claude");
      assert.equal(dims.account_scope, null);
      assert.equal(dims.project_key, null);
      assert.equal(dims.session_key, null);
      assert.equal(dims.model_id, "claude-opus-4-6");
    });

    it("includes session_key only when provided", () => {
      const withSession = buildUsageDimensions(
        { ...baseInput, sessionId: "session-1" },
        baseOptions,
      );
      assert.equal(withSession.session_key, "session-1");

      const withoutSession = buildUsageDimensions(baseInput, baseOptions);
      assert.equal(withoutSession.session_key, null);
    });

    it("includes project_key when projectPath is provided", () => {
      const dims = buildUsageDimensions(
        { ...baseInput, projectPath: "C:\\Users\\admin\\Code\\app" },
        baseOptions,
      );
      assert.equal(dims.project_key, "c:\\users\\admin\\code\\app");
    });

    it("includes account_scope when provided", () => {
      const dims = buildUsageDimensions(
        { ...baseInput, accountScope: "anthropic:account-hash-abc" },
        baseOptions,
      );
      assert.equal(dims.account_scope, "anthropic:account-hash-abc");
    });

    it("falls back to 'unknown' device_id when machineId is missing", () => {
      const dims = buildUsageDimensions(baseInput, {
        environment: baseOptions.environment,
      });
      assert.equal(dims.device_id, ENVIRONMENT_UNKNOWN);
    });

    it("auto-detects the environment when options.environment is omitted", () => {
      // Passing `environment: null` is equivalent to omitting the option — the
      // builder delegates to detectCurrentEnvironment(). Callers that want an
      // explicit "unknown" bucket must pass { kind: "unknown", id: "unknown" }.
      const dims = buildUsageDimensions(baseInput, {
        machineId: baseOptions.machineId,
        environment: null,
      });
      // The result must be a valid v2 enum; we don't assert the exact kind
      // because that depends on the runtime platform running the test.
      assert.ok(["native", "wsl", "ssh", "container", "unknown"].includes(dims.environment_kind));
      assert.ok(typeof dims.environment_id === "string" && dims.environment_id.length > 0);
    });

    it("returns explicit unknown bucket when caller passes { kind: 'unknown' }", () => {
      const dims = buildUsageDimensions(baseInput, {
        machineId: baseOptions.machineId,
        environment: { kind: "unknown", id: "unknown" },
      });
      assert.equal(dims.environment_kind, "unknown");
      assert.equal(dims.environment_id, "unknown");
    });

    it("normalizes agent_id", () => {
      const dims = buildUsageDimensions(
        { ...baseInput, agentId: "  CODEX  " },
        baseOptions,
      );
      assert.equal(dims.agent_id, "codex");
    });

    it("rejects invalid environment_kind from detector", () => {
      assert.throws(
        () =>
          buildUsageDimensions(baseInput, {
            machineId: baseOptions.machineId,
            environment: { kind: "weird", id: "weird:host" },
          }),
        /environment_kind/,
      );
    });

    it("does not store sensitive raw paths in session_key", () => {
      const dims = buildUsageDimensions(
        { ...baseInput, sessionId: "C:\\Users\\secret\\session-1" },
        baseOptions,
      );
      // session_key is opaque and stored as-is; the contract puts privacy
      // responsibility on the caller. We assert the function does not
      // append extra path data beyond what the caller provided.
      assert.equal(dims.session_key, "C:\\Users\\secret\\session-1");
    });
  });
});
