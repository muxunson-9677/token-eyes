const TOKEN_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
  "conversation_count",
];

function readLegacyTokenField(row, field) {
  const value = row?.[field];
  return value === undefined || value === null ? 0 : value;
}

function mapLegacyQueueRowToV2(row) {
  const source = typeof row?.source === "string" && row.source.trim()
    ? row.source.trim().toLowerCase()
    : "unknown";
  const model = typeof row?.model === "string" && row.model.trim()
    ? row.model.trim()
    : null;
  const hourStart = typeof row?.hour_start === "string" && row.hour_start
    ? row.hour_start
    : null;
  const tokens = Object.fromEntries(TOKEN_FIELDS.map((field) => [field, readLegacyTokenField(row, field)]));

  return {
    schema_version: "token-observability/v2",
    hour_start: hourStart,
    dimensions: {
      device_id: "unknown",
      environment_id: "unknown",
      environment_kind: "unknown",
      agent_id: source,
      account_scope: null,
      project_key: null,
      session_key: null,
      model_id: model,
    },
    tokens,
  };
}

function buildHourlyBucketKey(snapshot) {
  const dimensions = snapshot?.dimensions || {};
  return JSON.stringify([
    snapshot?.hour_start || null,
    dimensions.device_id || "unknown",
    dimensions.environment_id || "unknown",
    dimensions.agent_id || "unknown",
    dimensions.account_scope || null,
    dimensions.project_key || null,
    dimensions.model_id || null,
  ]);
}

module.exports = {
  TOKEN_FIELDS,
  mapLegacyQueueRowToV2,
  buildHourlyBucketKey,
};
