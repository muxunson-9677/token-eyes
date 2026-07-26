"use strict";

/**
 * O3 usage attribution service.
 *
 * Aggregates v2 `UsageSnapshotV2` rows by device / environment / agent /
 * project / model, optionally filtered by any combination of those
 * dimensions. Also computes the "unattributed" delta between an official
 * quota change and the locally observable contribution. The delta is always
 * tagged as `source_kind: "estimated"` per the contract — it must never be
 * presented as an official value.
 *
 * Invariants (verified by tests):
 *   1. Σ(group totals) == total_tokens (no rounding tolerance)
 *   2. Σ(agents) within env filter == env total
 *   3. Σ(environments) within device filter == device total
 *
 * This module is intentionally pure: it does not touch the network, the
 * filesystem, or `local-api.js`. O6/O8 wire it into the API and dashboard
 * entry points.
 */

const {
  GROUP_BY_FIELDS,
  UNKNOWN_BUCKET,
  buildDimensionGroupKey,
  filterByDimensions,
} = require("./usage-dimension-key");
const { normalizeDataEvidence } = require("./data-evidence");

const TOKEN_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
  "conversation_count",
];

function zeroTotals() {
  return Object.fromEntries(TOKEN_FIELDS.map((field) => [field, 0]));
}

function sumTokenTotals(snapshots) {
  const totals = zeroTotals();
  if (!Array.isArray(snapshots)) return totals;
  for (const snapshot of snapshots) {
    const tokens = snapshot?.tokens || {};
    for (const field of TOKEN_FIELDS) {
      const value = Number(tokens[field]);
      if (Number.isInteger(value) && value > 0) {
        totals[field] += value;
      } else if (typeof tokens[field] === "string" && tokens[field]) {
        const parsed = Number(tokens[field]);
        if (Number.isFinite(parsed) && parsed > 0) {
          totals[field] += Math.floor(parsed);
        }
      }
    }
  }
  return totals;
}

function buildGroupKey(groupBy, dimensions) {
  return buildDimensionGroupKey(dimensions, groupBy);
}

/**
 * Returns a representative `UsageDimensionsV1` for a group. Aggregating
 * devices/environments/etc. into one row means we keep only the field the
 * group is keyed by; everything else is set to the contract's "unknown"
 * value (`null` for optional fields, "unknown" for required identifier
 * fields) so the result still validates against the v2 schema.
 */
function buildGroupDimensions(groupBy, dimensions) {
  const dims = dimensions || {};
  const field = {
    device: "device_id",
    environment: "environment_id",
    agent: "agent_id",
    project: "project_key",
    model: "model_id",
  }[groupBy];

  const groupValue = dims[field] || (field === "project_key" || field === "model_id" ? null : "unknown");
  const envKind = groupBy === "environment" ? dims.environment_kind : "unknown";

  return {
    device_id: groupBy === "device" ? groupValue : "unknown",
    environment_id: groupBy === "environment" ? groupValue : "unknown",
    environment_kind: envKind,
    agent_id: groupBy === "agent" ? groupValue : "unknown",
    account_scope: null,
    project_key: groupBy === "project" ? groupValue : null,
    session_key: null,
    model_id: groupBy === "model" ? groupValue : null,
  };
}

/**
 * Aggregates snapshots by the requested dimension, optionally after applying
 * a filter. Returns `{ groups, total_tokens, filter }`.
 *
 * `groups` is sorted by stable group key (ascending) so consumers can render
 * deterministic UIs without re-sorting.
 */
function attributeUsage(snapshots, { groupBy, filter } = {}) {
  if (!GROUP_BY_FIELDS.includes(groupBy)) {
    throw new TypeError(
      `Unsupported groupBy: ${String(groupBy)}. Supported: ${GROUP_BY_FIELDS.join(", ")}.`,
    );
  }
  const filtered = filterByDimensions(snapshots, filter || {});
  const totals = zeroTotals();
  const groups = new Map();

  for (const snapshot of filtered) {
    const dims = snapshot?.dimensions || {};
    const key = buildGroupKey(groupBy, dims);
    const tokens = snapshot?.tokens || {};

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        dimensions: buildGroupDimensions(groupBy, dims),
        tokens: zeroTotals(),
      });
    }

    const group = groups.get(key);
    for (const field of TOKEN_FIELDS) {
      const value = Number(tokens[field]);
      if (Number.isInteger(value) && value > 0) {
        group.tokens[field] += value;
        totals[field] += value;
      } else if (typeof tokens[field] === "string" && tokens[field]) {
        const parsed = Number(tokens[field]);
        if (Number.isFinite(parsed) && parsed > 0) {
          const floored = Math.floor(parsed);
          group.tokens[field] += floored;
          totals[field] += floored;
        }
      }
    }
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );

  return {
    schema_version: "token-observability/v2",
    group_by: groupBy,
    filter: filter || {},
    groups: sortedGroups,
    total_tokens: totals.total_tokens,
    tokens: totals,
  };
}

function assertNonNegativeInteger(value, fieldName) {
  if (value === null || value === undefined) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer or null.`);
  }
}

/**
 * Returns the unattributed token delta between an official quota change and
 * the locally observable contribution. The result is always labeled as
 * `estimated` per the v2 contract — it must never be presented as an
 * official value.
 *
 * Behavior:
 *   - officialDelta null → coverage "unavailable", note "official_unavailable"
 *   - local >= official → 0 delta, note "local_exceeds_official"
 *   - local == 0        → full delta, note "no_local_attribution"
 *   - otherwise         → delta, note "official_minus_local"
 */
function computeUnattributedDelta({ officialDeltaTokens, attributedTotalTokens } = {}) {
  assertNonNegativeInteger(officialDeltaTokens, "officialDeltaTokens");
  assertNonNegativeInteger(attributedTotalTokens, "attributedTotalTokens");

  const official = Number.isInteger(officialDeltaTokens) ? officialDeltaTokens : null;
  const local = Number.isInteger(attributedTotalTokens) ? attributedTotalTokens : 0;

  if (official === null) {
    return {
      unattributed_tokens: 0,
      evidence: normalizeDataEvidence({
        source_kind: "estimated",
        accuracy: "estimated",
        coverage: "unavailable",
        observed_at: new Date().toISOString(),
        source_updated_at: null,
        stale_after_seconds: 0,
        pricing_source: null,
        pricing_version: null,
        note_code: "official_unavailable",
      }),
    };
  }

  let delta = official - local;
  let noteCode = "official_minus_local";
  if (delta < 0) {
    delta = 0;
    noteCode = "local_exceeds_official";
  } else if (local === 0) {
    noteCode = "no_local_attribution";
  }

  const coverage = delta > 0 ? "partial" : "complete";

  return {
    unattributed_tokens: delta,
    evidence: normalizeDataEvidence({
      source_kind: "estimated",
      accuracy: "estimated",
      coverage,
      observed_at: new Date().toISOString(),
      source_updated_at: null,
      stale_after_seconds: 0,
      pricing_source: null,
      pricing_version: null,
      note_code: noteCode,
    }),
  };
}

module.exports = {
  GROUP_BY_FIELDS,
  UNKNOWN_BUCKET,
  TOKEN_FIELDS,
  attributeUsage,
  computeUnattributedDelta,
  sumTokenTotals,
};
