const TOKEN_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
  "conversation_count",
];

const GROUP_FIELDS = {
  device: "device_id",
  environment: "environment_id",
  agent: "agent_id",
  project: "project_key",
  model: "model_id",
};

function emptyTotals() {
  return Object.fromEntries(TOKEN_FIELDS.map((field) => [field, 0]));
}

function attributeUsage(snapshots, { groupBy, filter = {} } = {}) {
  const field = GROUP_FIELDS[groupBy];
  if (!field) throw new TypeError(`Unsupported groupBy: ${String(groupBy)}`);

  const totals = emptyTotals();
  const groups = new Map();
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const dimensions = snapshot?.dimensions || {};
    if (!matchesFilter(dimensions, filter)) continue;
    const key = dimensions[field] || "unknown";
    if (!groups.has(key)) groups.set(key, { key, tokens: emptyTotals() });
    const group = groups.get(key);
    for (const tokenField of TOKEN_FIELDS) {
      const value = toNonNegativeInt(snapshot?.tokens?.[tokenField]);
      totals[tokenField] += value;
      group.tokens[tokenField] += value;
    }
  }

  return {
    schema_version: "token-observability/v2",
    group_by: groupBy,
    filter,
    groups: [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)),
    total_tokens: totals.total_tokens,
    tokens: totals,
  };
}

function matchesFilter(dimensions, filter) {
  return Object.entries(filter).every(([field, value]) =>
    value == null || value === "" || dimensions[field] === value,
  );
}

function toNonNegativeInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

module.exports = { attributeUsage };
