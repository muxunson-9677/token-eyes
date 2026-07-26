"use strict";

/**
 * O3 dimension key helpers.
 *
 * Re-exports `buildHourlyBucketKey` from the O0 contract module so O3+
 * callers have a single canonical entry point for dimension math. Adds
 * grouping and filtering helpers that the attribution service and the
 * dashboard matrix consume.
 *
 * `session_key` is intentionally excluded from both the bucket key and the
 * group/filter API. The contract forbids session-level aggregation because
 * it would split hourly snapshots and break the dedup invariant.
 */

const {
  buildHourlyBucketKey,
} = require("./token-observability-v2");

const GROUP_BY_FIELDS = ["device", "environment", "agent", "project", "model"];

const GROUP_BY_TO_DIMENSION_FIELD = {
  device: "device_id",
  environment: "environment_id",
  agent: "agent_id",
  project: "project_key",
  model: "model_id",
};

const UNKNOWN_BUCKET = "__unknown__";

function assertSupportedGroupBy(groupBy) {
  if (!GROUP_BY_FIELDS.includes(groupBy)) {
    throw new TypeError(
      `Unsupported group-by: ${String(groupBy)}. Supported: ${GROUP_BY_FIELDS.join(", ")}.`,
    );
  }
}

/**
 * Returns a stable string key for grouping snapshots by the requested
 * dimension. Null / undefined dimension values collapse to the literal
 * `"__unknown__"` bucket so the unknown row always appears once (matching
 * the contract's legacy-data invariant).
 */
function buildDimensionGroupKey(dimensions, groupBy) {
  assertSupportedGroupBy(groupBy);
  const field = GROUP_BY_TO_DIMENSION_FIELD[groupBy];
  const value = dimensions?.[field];
  if (value === null || value === undefined || value === "") {
    return UNKNOWN_BUCKET;
  }
  return String(value);
}

/**
 * Returns the subset of snapshots matching every non-null filter dimension.
 *
 * `session_key` is deliberately ignored. The contract forbids filtering by
 * session at the snapshot layer; request-level filtering is owned by O5.
 */
function filterByDimensions(snapshots, filter = {}) {
  if (!Array.isArray(snapshots)) return [];
  const filters = [];
  for (const [field, value] of Object.entries(filter)) {
    if (value === null || value === undefined || value === "") continue;
    if (field === "session_key") continue;
    filters.push([field, String(value)]);
  }
  if (filters.length === 0) return [...snapshots];
  return snapshots.filter((snapshot) => {
    const dims = snapshot?.dimensions || {};
    return filters.every(([field, value]) => String(dims[field]) === value);
  });
}

module.exports = {
  GROUP_BY_FIELDS,
  UNKNOWN_BUCKET,
  buildHourlyBucketKey,
  buildDimensionGroupKey,
  filterByDimensions,
};
