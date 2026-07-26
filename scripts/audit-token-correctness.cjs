#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { getSourceScope } = require("../src/lib/source-metadata");

const PART_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "reasoning_output_tokens",
];
const TOKEN_FIELDS = [...PART_FIELDS, "total_tokens"];
const SNAPSHOT_MONOTONIC_FIELDS = [...TOKEN_FIELDS, "conversation_count"];
const EVENT_ID_FIELDS = ["event_id", "request_id", "message_id", "record_id"];
const VALID_RECORD_KINDS = new Set(["event", "bucket_snapshot"]);
const VALID_SNAPSHOT_KINDS = new Set(["cumulative", "correction"]);

function readJsonlRows(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = [];
  let malformed = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  return { rows, malformed };
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeKeyPart(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function bucketSnapshotKey(row) {
  return [normalizeKeyPart(row?.source), normalizeKeyPart(row?.model), row?.hour_start || ""].join("|");
}

function stableEventKey(row) {
  const source = normalizeKeyPart(row?.source) || "unknown";
  for (const field of EVENT_ID_FIELDS) {
    const value = typeof row?.[field] === "string" ? row[field].trim() : "";
    if (value) return `${source}|${field}|${value}`;
  }
  return null;
}

function isEventRow(row) {
  return row?.record_kind === "event";
}

function tokenNumber(value) {
  return {
    value: typeof value === "number" && Number.isFinite(value) ? value : 0,
    valid: typeof value === "number" && Number.isSafeInteger(value),
  };
}

function numericValue(row, field) {
  return tokenNumber(row?.[field]).value;
}

function validateRow(row) {
  const errors = [];
  if (!isPlainObject(row)) return ["row must be a plain object"];
  for (const field of ["source", "model", "hour_start"]) {
    if (typeof row[field] !== "string" || !row[field].trim()) errors.push(`${field} must be a non-empty string`);
  }
  if (typeof row.hour_start === "string" && !Number.isFinite(Date.parse(row.hour_start))) {
    errors.push("hour_start must be a valid timestamp");
  }
  if (row.record_kind !== undefined && !VALID_RECORD_KINDS.has(row.record_kind)) {
    errors.push("record_kind must be event or bucket_snapshot");
  }
  if (row.snapshot_kind !== undefined && !VALID_SNAPSHOT_KINDS.has(row.snapshot_kind)) {
    errors.push("snapshot_kind must be cumulative or correction");
  }
  if (row.record_kind === "event" && row.snapshot_kind !== undefined) {
    errors.push("event rows cannot declare snapshot_kind");
  }
  for (const field of TOKEN_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(row, field) || !tokenNumber(row[field]).valid) {
      errors.push(`${field} must be a safe integer`);
    }
  }
  if (
    row.conversation_count !== undefined
    && (typeof row.conversation_count !== "number" || !Number.isSafeInteger(row.conversation_count))
  ) {
    errors.push("conversation_count must be a safe integer when present");
  }
  return errors;
}

function selectLatestSnapshots(inputRows) {
  const latestByKey = new Map();
  for (const row of Array.isArray(inputRows) ? inputRows : []) {
    if (isEventRow(row)) continue;
    latestByKey.set(bucketSnapshotKey(row), row);
  }
  return Array.from(latestByKey.values());
}

function isSnapshotRegression(previous, current) {
  return SNAPSHOT_MONOTONIC_FIELDS.some(
    (field) => numericValue(current, field) < numericValue(previous, field),
  );
}

function isIdenticalSnapshot(previous, current) {
  return SNAPSHOT_MONOTONIC_FIELDS.every(
    (field) => numericValue(current, field) === numericValue(previous, field),
  );
}

function classifySnapshotSequence(rows) {
  let duplicate = false;
  let regression = false;
  let correction = false;
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (isIdenticalSnapshot(previous, current)) {
      duplicate = true;
      continue;
    }
    if (isSnapshotRegression(previous, current)) {
      if (current.snapshot_kind === "correction") correction = true;
      else regression = true;
    } else if (current.snapshot_kind === "correction") {
      correction = true;
    }
  }
  return { duplicate, regression, correction };
}

function createSourceAggregate(source) {
  return {
    source,
    source_scope: getSourceScope(source),
    rows: 0,
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    sum_parts: 0,
    total_minus_parts: 0,
    invariant_failures: 0,
    allowed_snapshot_bucket_keys: 0,
    duplicate_snapshot_bucket_keys: 0,
    correction_snapshot_bucket_keys: 0,
    snapshot_regression_bucket_keys: 0,
    unknown_model_rows: 0,
    cache_read_ratio: 0,
    first_day: null,
    last_day: null,
  };
}

function auditRows(inputRows) {
  const rows = Array.isArray(inputRows) ? inputRows : [];
  const rowsByBucket = new Map();
  const eventCounts = new Map();
  const effectiveEvents = new Map();
  const eventsWithoutStableId = [];
  const schemaSamples = [];
  let invalidSchemaRows = 0;
  let invalidNegativeRows = 0;
  let invalidTokenValueRows = 0;
  let eventRowsMissingStableId = 0;
  let eventRows = 0;
  let snapshotRows = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const tokenValues = TOKEN_FIELDS.map((field) => tokenNumber(row?.[field]));
    if (tokenValues.some((entry) => !entry.valid)) invalidTokenValueRows += 1;
    if (tokenValues.some((entry) => entry.valid && entry.value < 0)) invalidNegativeRows += 1;

    const schemaErrors = validateRow(row);
    if (schemaErrors.length > 0) {
      invalidSchemaRows += 1;
      if (schemaSamples.length < 20) schemaSamples.push({ row_index: index, errors: schemaErrors });
      continue;
    }

    if (isEventRow(row)) {
      eventRows += 1;
      const eventKey = stableEventKey(row);
      if (!eventKey) {
        eventRowsMissingStableId += 1;
        eventsWithoutStableId.push(row);
      } else {
        eventCounts.set(eventKey, (eventCounts.get(eventKey) || 0) + 1);
        effectiveEvents.set(eventKey, row);
      }
      continue;
    }

    snapshotRows += 1;
    const bucketKey = bucketSnapshotKey(row);
    if (!rowsByBucket.has(bucketKey)) rowsByBucket.set(bucketKey, []);
    rowsByBucket.get(bucketKey).push(row);
  }

  let allowedSnapshotBucketKeys = 0;
  let duplicateSnapshotBucketKeys = 0;
  let correctionSnapshotBucketKeys = 0;
  let snapshotRegressionBucketKeys = 0;
  const snapshotClassifications = new Map();
  for (const [key, bucketRows] of rowsByBucket.entries()) {
    if (bucketRows.length <= 1) continue;
    const classification = classifySnapshotSequence(bucketRows);
    snapshotClassifications.set(key, classification);
    if (classification.duplicate) duplicateSnapshotBucketKeys += 1;
    if (classification.regression) snapshotRegressionBucketKeys += 1;
    if (classification.correction) correctionSnapshotBucketKeys += 1;
    if (!classification.duplicate && !classification.regression && !classification.correction) {
      allowedSnapshotBucketKeys += 1;
    }
  }

  let realDuplicateEventKeys = 0;
  const duplicateEventSamples = [];
  for (const [key, count] of eventCounts.entries()) {
    if (count <= 1) continue;
    realDuplicateEventKeys += 1;
    if (duplicateEventSamples.length < 20) duplicateEventSamples.push({ key, count });
  }

  const latestSnapshots = Array.from(rowsByBucket.values(), (bucketRows) => bucketRows[bucketRows.length - 1]);
  const effectiveRows = [...effectiveEvents.values(), ...eventsWithoutStableId, ...latestSnapshots];
  const sources = Object.create(null);
  const invariantSamples = [];
  let invariantFailures = 0;

  for (const row of effectiveRows) {
    const source = normalizeKeyPart(row.source) || "unknown";
    if (!Object.prototype.hasOwnProperty.call(sources, source)) {
      sources[source] = createSourceAggregate(source);
    }

    const aggregate = sources[source];
    const parts = Object.fromEntries(PART_FIELDS.map((field) => [field, numericValue(row, field)]));
    const total = numericValue(row, "total_tokens");
    const sumParts = PART_FIELDS.reduce((sum, field) => sum + parts[field], 0);
    const difference = total - sumParts;
    const day = row.hour_start.slice(0, 10);

    aggregate.rows += 1;
    aggregate.total_tokens += total;
    for (const field of PART_FIELDS) aggregate[field] += parts[field];
    aggregate.sum_parts += sumParts;
    aggregate.total_minus_parts += difference;
    if (row.model === "unknown") aggregate.unknown_model_rows += 1;
    if (day) {
      if (!aggregate.first_day || day < aggregate.first_day) aggregate.first_day = day;
      if (!aggregate.last_day || day > aggregate.last_day) aggregate.last_day = day;
    }
    if (difference !== 0) {
      invariantFailures += 1;
      aggregate.invariant_failures += 1;
      if (invariantSamples.length < 20) {
        invariantSamples.push({
          source,
          model: row.model,
          hour_start: row.hour_start,
          total_tokens: total,
          sum_parts: sumParts,
          total_minus_parts: difference,
        });
      }
    }
  }

  for (const [key, classification] of snapshotClassifications.entries()) {
    const source = normalizeKeyPart(key.split("|")[0]) || "unknown";
    const aggregate = sources[source];
    if (!aggregate) continue;
    if (classification.duplicate) aggregate.duplicate_snapshot_bucket_keys += 1;
    if (classification.regression) aggregate.snapshot_regression_bucket_keys += 1;
    if (classification.correction) aggregate.correction_snapshot_bucket_keys += 1;
    if (!classification.duplicate && !classification.regression && !classification.correction) {
      aggregate.allowed_snapshot_bucket_keys += 1;
    }
  }

  for (const source of Object.values(sources)) {
    source.cache_read_ratio = source.total_tokens > 0
      ? Number((source.cached_input_tokens / source.total_tokens).toFixed(4))
      : 0;
  }

  return {
    generated_at: new Date().toISOString(),
    raw: {
      rows: rows.length,
      event_rows: eventRows,
      snapshot_rows: snapshotRows,
      effective_rows: effectiveRows.length,
      unique_bucket_keys: rowsByBucket.size,
      allowed_snapshot_bucket_keys: allowedSnapshotBucketKeys,
      duplicate_snapshot_bucket_keys: duplicateSnapshotBucketKeys,
      correction_snapshot_bucket_keys: correctionSnapshotBucketKeys,
      snapshot_regression_bucket_keys: snapshotRegressionBucketKeys,
      real_duplicate_event_keys: realDuplicateEventKeys,
      event_rows_missing_stable_id: eventRowsMissingStableId,
      invalid_schema_rows: invalidSchemaRows,
      invalid_negative_rows: invalidNegativeRows,
      invalid_token_value_rows: invalidTokenValueRows,
      invariant_failures: invariantFailures,
    },
    sources,
    invariant_samples: invariantSamples,
    duplicate_event_samples: duplicateEventSamples,
    schema_samples: schemaSamples,
  };
}

function parseCliArgs(argv) {
  const args = { strict: false, input: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--strict") {
      args.strict = true;
    } else if (value === "--input") {
      args.input = argv[index + 1] || null;
      index += 1;
    } else if (!value.startsWith("--") && !args.input) {
      args.input = value;
    } else {
      throw new Error(`Unknown or incomplete argument: ${value}`);
    }
  }
  return args;
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.strict && !args.input) {
    throw new Error("--input is required in strict mode; use a sanitized fixture, never a real HOME queue");
  }
  const queuePath = args.input || path.join(os.homedir(), ".tokentracker", "tracker", "queue.jsonl");
  const { rows, malformed } = readJsonlRows(queuePath);
  const result = auditRows(rows);
  result.queue_path = queuePath;
  result.malformed_rows = malformed;

  if (args.strict) {
    result.strict_failures = {
      malformed_rows: malformed,
      real_duplicate_event_keys: result.raw.real_duplicate_event_keys,
      duplicate_snapshot_bucket_keys: result.raw.duplicate_snapshot_bucket_keys,
      event_rows_missing_stable_id: result.raw.event_rows_missing_stable_id,
      invalid_schema_rows: result.raw.invalid_schema_rows,
      invalid_negative_rows: result.raw.invalid_negative_rows,
      invalid_token_value_rows: result.raw.invalid_token_value_rows,
      snapshot_regression_bucket_keys: result.raw.snapshot_regression_bucket_keys,
      invariant_failures: result.raw.invariant_failures,
    };
    if (Object.values(result.strict_failures).some((count) => count > 0)) process.exitCode = 1;
  }

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Token audit failed: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

module.exports = {
  auditRows,
  readJsonlRows,
  parseCliArgs,
  selectLatestSnapshots,
  bucketSnapshotKey,
  stableEventKey,
};
