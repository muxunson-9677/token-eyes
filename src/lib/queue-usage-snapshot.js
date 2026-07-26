const { mapLegacyQueueRowToV2 } = require("./token-observability-v2");

function mapQueueRowToUsageSnapshot(row) {
  const snapshot = mapLegacyQueueRowToV2(row);
  const dimensions = row?.dimensions;
  if (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions)) return snapshot;

  return {
    ...snapshot,
    dimensions: {
      device_id: stringOr(dimensions.device_id, "unknown"),
      environment_id: stringOr(dimensions.environment_id, "unknown"),
      environment_kind: stringOr(dimensions.environment_kind, "unknown"),
      agent_id: stringOr(dimensions.agent_id, snapshot.dimensions.agent_id).toLowerCase(),
      account_scope: optionalString(dimensions.account_scope),
      project_key: optionalString(dimensions.project_key),
      session_key: optionalString(dimensions.session_key),
      model_id: stringOr(dimensions.model_id, snapshot.dimensions.model_id),
    },
  };
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

module.exports = { mapQueueRowToUsageSnapshot };
