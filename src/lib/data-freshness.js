function parseIsoTimestamp(value, fieldName) {
  if (typeof value !== "string" || !value) {
    throw new TypeError(`${fieldName} must be a non-empty ISO-8601 timestamp.`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new TypeError(`${fieldName} must be a valid ISO-8601 timestamp.`);
  }
  return new Date(ms).toISOString();
}

function isEvidenceStale(evidence, nowMs = Date.now()) {
  const observedAtMs = Date.parse(evidence?.observed_at);
  const staleAfterSeconds = Number(evidence?.stale_after_seconds);
  if (!Number.isFinite(observedAtMs) || !Number.isInteger(staleAfterSeconds) || staleAfterSeconds < 0) {
    return true;
  }
  return nowMs >= observedAtMs + staleAfterSeconds * 1000;
}

module.exports = {
  parseIsoTimestamp,
  isEvidenceStale,
};
