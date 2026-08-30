#!/usr/bin/env node
"use strict";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const ASSUMPTIONS = Object.freeze({
  install_scenarios: [10_000, 50_000, 100_000], participation_ratio: 0.05,
  public_views_per_install_per_day: 0.2, aggregate_uploads_per_participant_per_day: 1,
  participant_rank_reads_per_participant_per_day: 0.2, first_login_calls_per_participant: 1,
  days_per_month: 30, aggregate_upload_bytes: 8_192, fixed_static_objects: 285,
  average_static_object_bytes: 64 * 1024, average_active_sources_per_participant: 2.5,
  actual_cost_participant_ratio: 0.4, cache_miss_ratio: 0.05, refresh_windows_per_day: 24 * 60,
  daily_reconciliation_objects: 285, compact_state_row_bytes_including_indexes: 9_216,
  snapshot_row_bytes_including_indexes: 880, fixed_snapshot_rows: 285 * 50,
  supporting_database_megabytes: 18,
});

const CLOUDFLARE_FREE_LIMITS = Object.freeze({
  workers_requests_per_day: 100_000, workers_cpu_ms_per_request: 10,
  durable_object_requests_per_day: 100_000, durable_object_rows_read_per_day: 5_000_000,
  durable_object_rows_written_per_day: 100_000, durable_object_storage_gib: 5,
  excess_behavior: "operations fail; no usage billing on Workers Free",
  workers_source: "https://developers.cloudflare.com/workers/platform/pricing/",
  workers_limits_source: "https://developers.cloudflare.com/workers/platform/limits/",
  durable_objects_source: "https://developers.cloudflare.com/durable-objects/platform/pricing/",
});

const HARD_GATE = Object.freeze({
  durable_daily_request_warn_at: 70_000, durable_daily_request_stop_at: 90_000,
  durable_daily_write_warn_at: 70_000, durable_daily_write_stop_at: 90_000,
});

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function expectedRefreshObjectWritesPerDay(participants) {
  const windows = ASSUMPTIONS.refresh_windows_per_day;
  const uploadsPerWindow = participants / windows;
  const activeWindowRatio = 1 - Math.exp(-uploadsPerWindow);
  const activeWindows = windows * activeWindowRatio;
  const uniqueSources = 27 * (1 - Math.exp(
    -uploadsPerWindow * ASSUMPTIONS.average_active_sources_per_participant / 27,
  ));
  const sourcesPerActiveWindow = activeWindowRatio > 0 ? uniqueSources / activeWindowRatio : 0;
  return activeWindows * (12 + 10 * sourcesPerActiveWindow);
}

function buildScenario(installUsers) {
  const a = ASSUMPTIONS;
  const participants = Math.round(installUsers * a.participation_ratio);
  const publicReadsPerDay = Math.round(installUsers * a.public_views_per_install_per_day);
  const publicCacheMissesPerDay = Math.ceil(publicReadsPerDay * a.cache_miss_ratio);
  const uploadsPerWindow = participants / a.refresh_windows_per_day;
  const activeRefreshWindows = Math.ceil(a.refresh_windows_per_day * (1 - Math.exp(-uploadsPerWindow)));
  const refreshWrites = Math.ceil(expectedRefreshObjectWritesPerDay(participants) + a.daily_reconciliation_objects);
  const dirtyTriggers = participants * a.aggregate_uploads_per_participant_per_day;
  const rawRequests = Math.ceil(publicCacheMissesPerDay + dirtyTriggers + activeRefreshWindows + refreshWrites + 1);
  const rawRowsRead = Math.ceil(publicCacheMissesPerDay * 2 + dirtyTriggers * 3 + activeRefreshWindows * 2 + refreshWrites * 2 + 4);
  const rawRowsWritten = Math.ceil(publicCacheMissesPerDay + dirtyTriggers * 3 + activeRefreshWindows * 3 + refreshWrites * 2 + 4);
  const requiresDegradation = rawRequests >= HARD_GATE.durable_daily_request_warn_at
    || rawRowsWritten >= HARD_GATE.durable_daily_write_warn_at;
  const aggregateUploads = participants * a.aggregate_uploads_per_participant_per_day * a.days_per_month
    + participants * a.first_login_calls_per_participant;
  const rankReads = Math.round(participants * a.participant_rank_reads_per_participant_per_day * a.days_per_month);
  const databaseMegabytes = (participants * a.compact_state_row_bytes_including_indexes
    + a.fixed_snapshot_rows * a.snapshot_row_bytes_including_indexes) / MIB
    + a.supporting_database_megabytes;

  return {
    install_users: installUsers, estimated_participants: participants,
    public_static_reads_per_month: publicReadsPerDay * a.days_per_month,
    public_cache_misses_per_day: publicCacheMissesPerDay,
    public_reads_use_insforge: false, public_reads_require_auth: false,
    aggregate_uploads_per_month: aggregateUploads,
    aggregate_upload_bandwidth_gib: round(aggregateUploads * a.aggregate_upload_bytes / GIB),
    participant_rank_reads_per_month: rankReads,
    estimated_insforge_optional_calls_per_month: aggregateUploads + rankReads,
    estimated_database_megabytes: round(databaseMegabytes), static_object_count: a.fixed_static_objects,
    durable_object_public_storage_gib: round(a.fixed_static_objects * a.average_static_object_bytes / GIB, 6),
    raw_public_object_writes_per_day: refreshWrites, worker_dirty_trigger_requests_per_day: dirtyTriggers,
    raw_durable_object_requests_per_day: rawRequests, raw_durable_object_rows_read_per_day: rawRowsRead,
    raw_durable_object_rows_written_per_day: rawRowsWritten,
    gated_durable_object_requests_per_day: Math.min(rawRequests, HARD_GATE.durable_daily_request_stop_at),
    gated_durable_object_rows_written_per_day: Math.min(rawRowsWritten, HARD_GATE.durable_daily_write_stop_at),
    raw_durable_object_within_free_tier: rawRequests <= CLOUDFLARE_FREE_LIMITS.durable_object_requests_per_day
      && rawRowsRead <= CLOUDFLARE_FREE_LIMITS.durable_object_rows_read_per_day
      && rawRowsWritten <= CLOUDFLARE_FREE_LIMITS.durable_object_rows_written_per_day,
    requires_zero_dollar_degradation: requiresDegradation,
    guaranteed_60_second_public_refresh_at_this_scale: !requiresDegradation,
    auto_enable_billing: false, unbounded_usage_billing: false, local_core_available: true,
    degradation_order: ["stop-optional-public-object-writes", "stop-new-dirty-refresh-work", "serve-edge-cache-or-client-lkg"],
  };
}

function buildCapacityModel() {
  return {
    model_version: "token-eyes-leaderboard-zero-dollar/v5",
    assumptions: { ...ASSUMPTIONS }, cloudflare_free_limits: { ...CLOUDFLARE_FREE_LIMITS },
    hard_gate: { ...HARD_GATE }, cloudflare_account_verified_free: true,
    cloudflare_account_probe: "CPU limit 11ms rejected with API 100328: Free plan",
    insforge_limits_verified: false,
    insforge_gate: "isolated staging optional auth/write sync must fail closed before any paid resource",
    scenarios: ASSUMPTIONS.install_scenarios.map(buildScenario),
  };
}

if (require.main === module) {
  process.stdout.write("Leaderboard zero-dollar capacity\n");
  process.stdout.write(`${JSON.stringify(buildCapacityModel(), null, 2)}\n`);
}

module.exports = { ASSUMPTIONS, CLOUDFLARE_FREE_LIMITS, HARD_GATE, buildCapacityModel };
