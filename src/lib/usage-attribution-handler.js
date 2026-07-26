"use strict";

/**
 * O3 attribution service handler.
 *
 * Pure request → response helper for the future `/api/v2/usage` (or local
 * function) wiring owned by O6/O8. This file must not import or modify
 * `local-api.js`.
 */

const { attributeUsage, computeUnattributedDelta } = require("./usage-attribution");
const { mapQueueRowToUsageSnapshot } = require("./queue-usage-snapshot");

/**
 * Builds an attribution response from raw queue rows.
 *
 * @param {object} input
 * @param {Array<object>} input.rows queue / project.queue JSONL rows
 * @param {"device"|"environment"|"agent"|"project"|"model"} input.groupBy
 * @param {object} [input.filter]
 * @param {number|null} [input.officialDeltaTokens]
 */
function buildUsageAttributionResponse({
  rows,
  groupBy,
  filter,
  officialDeltaTokens = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const snapshots = Array.isArray(rows)
    ? rows.map((row) => mapQueueRowToUsageSnapshot(row))
    : [];
  const attribution = attributeUsage(snapshots, { groupBy, filter });
  const unattributed =
    officialDeltaTokens === null || officialDeltaTokens === undefined
      ? null
      : computeUnattributedDelta({
          officialDeltaTokens,
          attributedTotalTokens: attribution.total_tokens,
        });

  return {
    schema_version: "token-observability/v2",
    generated_at: generatedAt,
    filter: filter || {},
    group_by: groupBy,
    snapshots_count: snapshots.length,
    attribution,
    unattributed,
  };
}

module.exports = {
  buildUsageAttributionResponse,
};
