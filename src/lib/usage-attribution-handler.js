const { attributeUsage } = require("./usage-attribution");
const { mapQueueRowToUsageSnapshot } = require("./queue-usage-snapshot");

function buildUsageAttributionResponse({ rows, groupBy, filter } = {}) {
  const snapshots = Array.isArray(rows) ? rows.map(mapQueueRowToUsageSnapshot) : [];
  return {
    schema_version: "token-observability/v2",
    group_by: groupBy,
    filter: filter || {},
    snapshots_count: snapshots.length,
    snapshots: snapshots.map(toPublicSnapshot),
    attribution: attributeUsage(snapshots, { groupBy, filter }),
  };
}

function toPublicSnapshot(snapshot) {
  const { session_key: _sessionKey, ...dimensions } = snapshot.dimensions || {};
  return { ...snapshot, dimensions };
}

module.exports = { buildUsageAttributionResponse };
