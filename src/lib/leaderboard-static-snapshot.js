"use strict";

const agentRegistry = require("../../shared/agent-registry.json");
const { createSignedStaticFeedEnvelope } = require("./signed-static-feed");

const PERIODS = new Set(["today", "week", "30d", "month", "total"]);
const METRICS = new Set(["tokens", "estimated_spend", "actual_cost"]);
const SOURCES = new Set([
  "all",
  ...agentRegistry.adapters.map((adapter) => adapter.queue_source),
]);

function listLeaderboardStaticDimensions() {
  const dimensions = [];
  for (const period of PERIODS) {
    for (const metric of ["tokens", "estimated_spend"]) {
      for (const source of SOURCES) dimensions.push({ period, metric, source });
    }
    dimensions.push({ period, metric: "actual_cost", source: "all" });
  }
  return dimensions;
}

function normalizeLeaderboardGeneratedAt(value) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  ) {
    throw new TypeError("generatedAt must be an exact ISO timestamp");
  }
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new TypeError("generatedAt must be an exact ISO timestamp");
  }
  return new Date(parsed).toISOString();
}

function finiteNonNegative(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function safeStaticAvatarUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const candidate = new URL(value);
    return candidate.protocol === "https:"
      && /^\/v1\/avatars\/[a-f0-9]{64}\.webp$/u.test(candidate.pathname)
      && !candidate.search
      && !candidate.hash
      ? candidate.toString()
      : null;
  } catch {
    return null;
  }
}

function safeGithubUrl(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/?$/iu);
  return match ? `https://github.com/${match[1]}` : null;
}

function safeSourceBreakdown(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 28).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = typeof item.source === "string" ? item.source.trim().toLowerCase() : "";
    if (!SOURCES.has(source)) return [];
    return [{
      source,
      total_tokens: String(Math.trunc(finiteNonNegative(item.total_tokens))),
      estimated_cost_usd: finiteNonNegative(item.estimated_cost_usd),
      unpriced_tokens: String(Math.trunc(finiteNonNegative(item.unpriced_tokens))),
    }];
  });
}

function publicEntry(row) {
  const publicEntryId = typeof row?.public_entry_id === "string"
    ? row.public_entry_id.trim()
    : "";
  if (!/^[a-zA-Z0-9_-]{3,128}$/u.test(publicEntryId)) {
    throw new TypeError("public entry id is required");
  }
  return {
    rank: Number(row.rank),
    public_entry_id: publicEntryId,
    display_name: typeof row.display_name === "string" && row.display_name.trim()
      ? row.display_name.trim().slice(0, 50)
      : "Anonymous",
    avatar_url: safeStaticAvatarUrl(row.avatar_url),
    github_url: safeGithubUrl(row.github_url),
    total_tokens: String(Math.trunc(finiteNonNegative(row.total_tokens))),
    estimated_cost_usd: finiteNonNegative(row.estimated_cost_usd),
    actual_cost_usd: row.actual_cost_usd == null
      ? null
      : finiteNonNegative(row.actual_cost_usd),
    source_breakdown: safeSourceBreakdown(row.source_breakdown),
    pricing_version: typeof row.pricing_version === "string" ? row.pricing_version : null,
  };
}

function buildSignedLeaderboardStaticSnapshot({
  period,
  metric,
  source,
  rows,
  privateKey,
  keyId,
  generatedAt,
} = {}) {
  if (!PERIODS.has(period) || !METRICS.has(metric) || !SOURCES.has(source)) {
    throw new TypeError("leaderboard dimension is not whitelisted");
  }
  if (metric === "actual_cost" && source !== "all") {
    throw new TypeError("leaderboard dimension is not whitelisted");
  }
  if (!Array.isArray(rows)) throw new TypeError("leaderboard rows are required");
  const sorted = [...rows].sort((left, right) => Number(left.rank) - Number(right.rank));
  const entries = sorted.slice(0, 50).map(publicEntry);
  const aggregateTotalTokens = entries.reduce(
    (sum, row) => sum + finiteNonNegative(row.total_tokens),
    0,
  );
  const aggregateTotalCostUsd = entries.reduce(
    (sum, row) => sum + finiteNonNegative(
      metric === "actual_cost" ? row.actual_cost_usd : row.estimated_cost_usd,
    ),
    0,
  );
  const payload = {
    schema_version: "token-eyes.leaderboard-snapshot/v1",
    snapshot_key: `${period}/${metric}/${source}`,
    generated_at: normalizeLeaderboardGeneratedAt(generatedAt),
    period,
    metric,
    source,
    entries,
    participant_count: Math.max(
      sorted.length,
      Number(sorted[0]?.participant_count) || 0,
    ),
    ranked_entry_count: entries.length,
    aggregate_total_tokens: aggregateTotalTokens,
    aggregate_total_cost_usd: aggregateTotalCostUsd,
    from: sorted[0]?.from_day || null,
    to: sorted[0]?.to_day || null,
  };
  return createSignedStaticFeedEnvelope(payload, privateKey, { keyId });
}

module.exports = {
  buildSignedLeaderboardStaticSnapshot,
  listLeaderboardStaticDimensions,
  normalizeLeaderboardGeneratedAt,
};
