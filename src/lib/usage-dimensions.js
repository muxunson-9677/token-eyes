"use strict";

/**
 * O3 usage dimensions builder.
 *
 * Returns a v2 `UsageDimensionsV1` object ready to be embedded in a queue row
 * or request diagnostic. Reuses:
 *   - `machine-id.js` for the stable `device_id`
 *   - `environment-detector.js` for `environment_id` / `environment_kind`
 *   - `project-path.js` for `project_key` normalization
 *
 * Privacy: this module never stores raw sensitive paths in `project_key`. The
 * key is normalized (lowercased, slash-collapsed). The display name is left
 * to the dashboard layer (O3 hook + matrix component) via `extractProjectName`.
 */

const {
  detectCurrentEnvironment,
  ENVIRONMENT_KINDS,
  mapLegacyEnvironmentKind,
} = require("./environment-detector");
const {
  normalizeProjectKey: normalizeProjectKeyPath,
} = require("./project-path");

const ENVIRONMENT_UNKNOWN = "unknown";

/**
 * Normalizes an agent identifier. Empty / non-string input becomes "unknown"
 * so legacy rows without an agent still aggregate instead of being dropped.
 */
function normalizeAgentId(agentId) {
  if (typeof agentId !== "string") return ENVIRONMENT_UNKNOWN;
  const trimmed = agentId.trim().toLowerCase();
  return trimmed || ENVIRONMENT_UNKNOWN;
}

function normalizeStringOrEmpty(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

/**
 * Returns a stable, normalized `project_key` string, or `null` when no project
 * can be identified. The key is lowercase and slash-collapsed so the same
 * path entered via different env vars collapses into one bucket.
 *
 * Privacy: never returns the original mixed-case path.
 */
function normalizeProjectKey({ projectPath, projectName, projectKey, projectRef } = {}) {
  const pathStr = normalizeStringOrEmpty(projectPath);
  const keyStr = normalizeStringOrEmpty(projectKey);
  const refStr = normalizeStringOrEmpty(projectRef);

  if (pathStr || refStr) {
    const source = pathStr || refStr;
    const normalized = normalizeProjectKeyPath(source, refStr || null);
    return normalized.key || null;
  }

  if (keyStr) {
    return keyStr.toLowerCase();
  }

  if (projectName && typeof projectName === "string" && projectName.trim()) {
    return projectName.trim().toLowerCase();
  }

  return null;
}

function resolveEnvironment(environment) {
  if (!environment || typeof environment !== "object") {
    return { kind: ENVIRONMENT_UNKNOWN, id: ENVIRONMENT_UNKNOWN };
  }
  const kind = environment.kind;
  if (!ENVIRONMENT_KINDS.has(kind)) {
    throw new TypeError(`environment_kind must be one of the v2 enum values.`);
  }
  const id = typeof environment.id === "string" && environment.id.trim()
    ? environment.id.trim()
    : ENVIRONMENT_UNKNOWN;
  return { kind, id };
}

/**
 * Builds a v2 `UsageDimensionsV1` object.
 *
 * `options.machineId` and `options.environment` exist so tests can inject
 * deterministic values without touching the real filesystem or hostname.
 * In production, callers should pass `machineId` from `getOrCreateMachineId()`
 * and let the environment fall back to `detectCurrentEnvironment()`.
 */
function buildUsageDimensions(input = {}, options = {}) {
  const agentId = normalizeAgentId(input.agentId);

  let deviceId = options.machineId;
  if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
    deviceId = ENVIRONMENT_UNKNOWN;
  }

  const environment = options.environment
    ? resolveEnvironment(options.environment)
    : detectCurrentEnvironment();

  const projectKey = normalizeProjectKey({
    projectPath: input.projectPath,
    projectName: input.projectName,
    projectKey: input.projectKey,
    projectRef: input.projectRef,
  });

  const sessionKey =
    typeof input.sessionId === "string" && input.sessionId.trim()
      ? input.sessionId
      : null;

  const modelId =
    typeof input.modelId === "string" && input.modelId.trim()
      ? input.modelId.trim()
      : null;

  const accountScope =
    typeof input.accountScope === "string" && input.accountScope.trim()
      ? input.accountScope.trim()
      : null;

  return {
    device_id: deviceId,
    environment_id: environment.id,
    environment_kind: environment.kind,
    agent_id: agentId,
    account_scope: accountScope,
    project_key: projectKey,
    session_key: sessionKey,
    model_id: modelId,
  };
}

module.exports = {
  ENVIRONMENT_UNKNOWN,
  buildUsageDimensions,
  normalizeAgentId,
  normalizeProjectKey,
  mapLegacyEnvironmentKind,
};
