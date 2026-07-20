#!/usr/bin/env node
"use strict";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const ASSUMPTIONS = Object.freeze({
  participants: 6_000,
  days_per_month: 30,
  changed_uploads_per_active_user_per_day: 1,
  first_login_uploads_per_participant: 1,
  upload_payload_bytes: 8_192,
  global_refresh_minutes: 15,
  worker_requests_per_day: 30_000,
  periods_retained: 4,
  average_active_sources_per_participant: 2.5,
  actual_cost_share_ratio: 0.4,
  snapshot_row_bytes_including_indexes: 880,
  device_state_row_bytes_including_indexes: 9_216,
  supporting_database_megabytes: 18,
  average_avatar_bytes: 10 * 1024,
});

const LIMITS = Object.freeze({
  uploads_per_month: 186_000,
  upload_payload_bytes: 8_192,
  upload_bandwidth_gib: 1.5,
  global_refresh_calls_per_month: 2_880,
  worker_requests_per_day: 30_000,
  estimated_database_megabytes: 300,
  avatar_megabytes: 100,
});

const WARNING_LINES = Object.freeze({
  insforge_database_megabytes: 350,
  insforge_bandwidth_gib: 3.5,
  insforge_edge_calls_per_month: 70_000,
  cloudflare_worker_requests_per_day: 70_000,
});

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function buildCapacityModel() {
  const a = ASSUMPTIONS;
  const dailyUploads =
    a.participants * a.changed_uploads_per_active_user_per_day;
  const firstLoginAllowance =
    a.participants * a.first_login_uploads_per_participant;
  const uploadsPerMonth =
    dailyUploads * a.days_per_month + firstLoginAllowance;
  const uploadBandwidthGiB =
    uploadsPerMonth * a.upload_payload_bytes / GIB;
  const globalRefreshCalls =
    a.days_per_month * 24 * 60 / a.global_refresh_minutes;

  // Each active source creates token + estimated-spend rows. Each participant
  // also has two all-source rows, plus an all-source actual-cost row only when
  // consented. Four current snapshots are retained; old runs are deleted.
  const snapshotRows = Math.ceil(
    a.participants
      * a.periods_retained
      * (
        a.average_active_sources_per_participant * 2
        + 2
        + a.actual_cost_share_ratio
      ),
  );
  const snapshotMegabytes =
    snapshotRows * a.snapshot_row_bytes_including_indexes / MIB;
  const deviceStateMegabytes =
    a.participants * a.device_state_row_bytes_including_indexes / MIB;
  const estimatedDatabaseMegabytes =
    snapshotMegabytes
    + deviceStateMegabytes
    + a.supporting_database_megabytes;
  const avatarMegabytes =
    a.participants * a.average_avatar_bytes / MIB;

  const capacity = {
    uploads_per_month: uploadsPerMonth,
    first_login_allowance: firstLoginAllowance,
    upload_payload_bytes: a.upload_payload_bytes,
    upload_bandwidth_gib: round(uploadBandwidthGiB),
    global_refresh_calls_per_month: globalRefreshCalls,
    worker_requests_per_day: a.worker_requests_per_day,
    estimated_snapshot_rows: snapshotRows,
    estimated_database_megabytes: round(estimatedDatabaseMegabytes),
    avatar_megabytes: round(avatarMegabytes),
  };

  const checks = {
    uploads_per_month:
      capacity.uploads_per_month <= LIMITS.uploads_per_month,
    upload_payload_bytes:
      capacity.upload_payload_bytes <= LIMITS.upload_payload_bytes,
    upload_bandwidth_gib:
      capacity.upload_bandwidth_gib <= LIMITS.upload_bandwidth_gib,
    global_refresh_calls_per_month:
      capacity.global_refresh_calls_per_month
      <= LIMITS.global_refresh_calls_per_month,
    worker_requests_per_day:
      capacity.worker_requests_per_day <= LIMITS.worker_requests_per_day,
    estimated_database_megabytes:
      capacity.estimated_database_megabytes
      <= LIMITS.estimated_database_megabytes,
    avatar_megabytes:
      capacity.avatar_megabytes <= LIMITS.avatar_megabytes,
  };

  return {
    assumptions: { ...a },
    limits: { ...LIMITS },
    warning_lines: { ...WARNING_LINES },
    warning_utilization: {
      insforge_database: round(
        capacity.estimated_database_megabytes
          / WARNING_LINES.insforge_database_megabytes,
      ),
      insforge_bandwidth: round(
        capacity.upload_bandwidth_gib
          / WARNING_LINES.insforge_bandwidth_gib,
      ),
      insforge_edge: round(
        capacity.global_refresh_calls_per_month
          / WARNING_LINES.insforge_edge_calls_per_month,
      ),
      cloudflare_worker: round(
        capacity.worker_requests_per_day
          / WARNING_LINES.cloudflare_worker_requests_per_day,
      ),
    },
    capacity,
    checks,
    within_envelope: Object.values(checks).every(Boolean),
    actions: {
      warning_threshold_ratio: 0.7,
      public_ttl_minutes: [15, 30, 60],
      month_refresh_hours: [1, 4],
      total_refresh_days: [1, 2],
      keep_today_week_at_15_minutes: true,
      today_week_exception: "Increase only if Edge calls cross the 70% warning line",
      auto_enable_billing: false,
      disable_local_features: false,
    },
  };
}

function printModel(model) {
  const rows = Object.entries(model.capacity).map(([metric, value]) => ({
    metric,
    value,
    status: metric === "first_login_allowance"
      || metric === "estimated_snapshot_rows"
      ? "info"
      : model.checks[metric] === false ? "over" : "ok",
  }));
  process.stdout.write("Leaderboard free-tier capacity\n");
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n\n`);
  process.stdout.write(`${JSON.stringify(model, null, 2)}\n`);
}

if (require.main === module) {
  const model = buildCapacityModel();
  printModel(model);
  if (!model.within_envelope) process.exitCode = 1;
}

module.exports = {
  ASSUMPTIONS,
  LIMITS,
  WARNING_LINES,
  buildCapacityModel,
};
