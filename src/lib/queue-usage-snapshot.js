"use strict";

/**
 * O3 queue ↔ v2 usage snapshot bridge.
 *
 * New queue rows may carry an optional `dimensions` object (UsageDimensionsV1).
 * Legacy rows without dimensions map through O0 `mapLegacyQueueRowToV2` so
 * historical data lands in the unknown environment bucket without guessing.
 *
 * This module is pure aside from the optional machine-id / environment
 * resolution helpers used when *writing* new rows.
 */

const { mapLegacyQueueRowToV2 } = require("./token-observability-v2");
const { buildUsageDimensions } = require("./usage-dimensions");
const { detectCurrentEnvironment } = require("./environment-detector");

const ENVIRONMENT_KINDS = new Set([
  "native",
  "wsl",
  "ssh",
  "container",
  "unknown",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeExistingDimensions(dimensions, row) {
  if (!isPlainObject(dimensions)) return null;
  const kind = ENVIRONMENT_KINDS.has(dimensions.environment_kind)
    ? dimensions.environment_kind
    : "unknown";
  const agentId =
    typeof dimensions.agent_id === "string" && dimensions.agent_id.trim()
      ? dimensions.agent_id.trim().toLowerCase()
      : typeof row?.source === "string" && row.source.trim()
        ? row.source.trim().toLowerCase()
        : "unknown";
  const modelId =
    typeof dimensions.model_id === "string" && dimensions.model_id.trim()
      ? dimensions.model_id.trim()
      : typeof row?.model === "string" && row.model.trim()
        ? row.model.trim()
        : null;
  const projectKey =
    typeof dimensions.project_key === "string" && dimensions.project_key.trim()
      ? dimensions.project_key.trim()
      : typeof row?.project_key === "string" && row.project_key.trim()
        ? row.project_key.trim().toLowerCase()
        : null;

  return {
    device_id:
      typeof dimensions.device_id === "string" && dimensions.device_id.trim()
        ? dimensions.device_id.trim()
        : "unknown",
    environment_id:
      typeof dimensions.environment_id === "string" && dimensions.environment_id.trim()
        ? dimensions.environment_id.trim()
        : "unknown",
    environment_kind: kind,
    agent_id: agentId,
    account_scope:
      typeof dimensions.account_scope === "string" && dimensions.account_scope.trim()
        ? dimensions.account_scope.trim()
        : null,
    project_key: projectKey,
    session_key:
      typeof dimensions.session_key === "string" && dimensions.session_key.trim()
        ? dimensions.session_key.trim()
        : null,
    model_id: modelId,
  };
}

/**
 * Maps a queue.jsonl / project.queue.jsonl row to a v2 UsageSnapshotV2.
 * Prefer an attached `dimensions` object; otherwise use the O0 legacy mapper.
 */
function mapQueueRowToUsageSnapshot(row) {
  if (!isPlainObject(row)) {
    return mapLegacyQueueRowToV2({});
  }

  const existing = normalizeExistingDimensions(row.dimensions, row);
  if (existing) {
    const legacy = mapLegacyQueueRowToV2(row);
    return {
      ...legacy,
      dimensions: existing,
    };
  }

  const legacy = mapLegacyQueueRowToV2(row);
  if (typeof row.project_key === "string" && row.project_key.trim()) {
    return {
      ...legacy,
      dimensions: {
        ...legacy.dimensions,
        project_key: row.project_key.trim().toLowerCase(),
      },
    };
  }
  return legacy;
}

/**
 * Resolves the dimension context used when enriching newly written queue rows.
 * Accepts injected machineId/environment for tests; production callers pass
 * `queuePath` so machine-id stays sandboxed under the tracker directory.
 */
function resolveEnqueueDimensionsContext({
  queuePath,
  machineId,
  environment,
  getMachineId,
  detectEnvironment = detectCurrentEnvironment,
} = {}) {
  let resolvedMachineId = machineId;
  if (!resolvedMachineId || typeof resolvedMachineId !== "string") {
    if (typeof getMachineId === "function") {
      try {
        resolvedMachineId = getMachineId(queuePath) || "unknown";
      } catch {
        resolvedMachineId = "unknown";
      }
    } else {
      resolvedMachineId = "unknown";
    }
  }

  const resolvedEnvironment =
    environment && typeof environment === "object"
      ? environment
      : detectEnvironment();

  return {
    machineId: resolvedMachineId,
    environment: resolvedEnvironment,
  };
}

/**
 * Returns a shallow copy of `row` with an optional `dimensions` object attached.
 * Never mutates the input. Does not rewrite legacy fields.
 */
function attachDimensionsToQueueRow(row, context = {}, extras = {}) {
  if (!isPlainObject(row)) return row;
  const agentId =
    typeof extras.agentId === "string" && extras.agentId.trim()
      ? extras.agentId.trim()
      : typeof row.source === "string"
        ? row.source
        : "unknown";
  const dimensions = buildUsageDimensions(
    {
      agentId,
      modelId: typeof row.model === "string" ? row.model : null,
      projectKey: typeof row.project_key === "string" ? row.project_key : extras.projectKey,
      projectPath: extras.projectPath,
      projectRef: typeof row.project_ref === "string" ? row.project_ref : extras.projectRef,
      accountScope: extras.accountScope,
      sessionId: extras.sessionId,
    },
    {
      machineId: context.machineId,
      environment: context.environment,
    },
  );
  return {
    ...row,
    dimensions,
  };
}

module.exports = {
  mapQueueRowToUsageSnapshot,
  resolveEnqueueDimensionsContext,
  attachDimensionsToQueueRow,
};
