# Token Observability v2 Contract

Schema version: `token-observability/v2`.

This is the stable contract for O1–O8. Additive fields require a new schema version; existing names and meanings cannot be silently changed. All timestamps are UTC ISO-8601 strings. Percentages are `0–100`. Token quantities are safe integers or decimal strings, never lossy JavaScript floats.

## Evidence

`DataEvidenceV1` has `source_kind` (`official_api`, `session_log`, `sqlite`, `hook`, `otel`, `cache`, `estimated`, `user_override`), `accuracy` (`exact`, `normalized`, `estimated`, `unknown`), `coverage` (`complete`, `partial`, `unavailable`, `unpriced`), `observed_at`, `source_updated_at`, `stale_after_seconds`, `is_stale`, `pricing_source`, `pricing_version`, and `note_code`.

`null` means unknown or unavailable. It must not be converted to `0`. A cache-served value has `source_kind: "cache"`; `source_updated_at` remains the original source timestamp when known.

## Identity and privacy

Account identifiers use `base64url(HMAC-SHA-256(localSalt, providerId + ":" + rawAccountId))`. The 32-byte random `localSalt` is stored only in `~/.tokentracker/tracker/identity-salt` with owner-only permissions and is never returned by an API. A raw account ID, email, API key, Cookie, prompt, response body, or full sensitive path is never stored in this contract, fixture, queue row, or dashboard payload.

## Usage dimensions and hourly buckets

`UsageDimensionsV1` has `device_id`, `environment_id`, `environment_kind`, `agent_id`, `account_scope`, `project_key`, `session_key`, and `model_id`.

Legacy queue rows map to `device_id: "unknown"`, `environment_id: "unknown"`, `environment_kind: "unknown"`, `agent_id: source`, and nullable account/project/session values. Historical environment data is not inferred.

The v2 hourly aggregation key is the ordered tuple `[hour_start, device_id, environment_id, agent_id, account_scope, project_key, model_id]`. `session_key` is request-level only and is excluded so incremental sessions do not split or double-count hourly snapshots. Existing queues remain readable and are not rewritten by O0/O1.

## Limits and request diagnostics

`LimitWindowV2`, `LimitAccountV2`, and `RequestDiagnosticV2` use the fields and enums frozen in section 6 of `docs/reports/2026-07-26-Token用量项目优化多阶段开发文档.md`. Unknown request status, latency, first-token latency, and cost stay `null`; an unpriced value is never represented as `$0.00`.

The complete machine-readable definitions for `DataEvidenceV1`, `UsageDimensionsV1`, token fields, and `UsageSnapshotV2` are in `shared/schemas/token-observability-v2.schema.json`. O2–O7 must reuse those definitions rather than renaming fields or creating parallel freshness/confidence fields.

## O0 characterization fixtures

`test/fixtures/token-observability-v2/usage-limits-v1.json` records the existing limits response shape: a top-level `fetched_at` plus provider-specific fields such as `configured`, `error`, and provider windows. O1 only appends `evidence`; it does not remove or rename those legacy fields.

`test/fixtures/token-observability-v2/request-usage-records-v1.json` records the existing request response behavior: records can be aggregate-only and `status`, `latency_ms`, and `first_token_ms` stay `null` when not measured. O5/O6 own endpoint integration of the frozen `RequestDiagnosticV2` fields.
