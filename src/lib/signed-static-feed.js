"use strict";

const crypto = require("node:crypto");

const DEFAULT_MAX_PAYLOAD_BYTES = 512 * 1024;
const PRIVATE_ENTRY_FIELDS = new Set([
  "account_id",
  "device_id",
  "email",
  "user_id",
]);

function containsPrivateField(value) {
  if (Array.isArray(value)) return value.some(containsPrivateField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([field, child]) => (
    PRIVATE_ENTRY_FIELDS.has(field.toLowerCase()) || containsPrivateField(child)
  ));
}

function decodeCanonicalBase64Url(value, label) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError(`${label} must be canonical Base64URL`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) {
    throw new TypeError(`${label} must be canonical Base64URL`);
  }
  return bytes;
}

function requireExactIso(value, label) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  return parsed;
}

function validatePublicEntries(entries, maximum) {
  if (!Array.isArray(entries) || entries.length > maximum) {
    throw new TypeError("signed feed entry count exceeds the limit");
  }
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("signed feed entry must be an object");
    }
    if (containsPrivateField(entry)) {
      throw new TypeError("signed feed entry contains a private identifier");
    }
  }
}

function verifySignedStaticFeed(envelope, {
  publicKey,
  expectedSchema,
  expectedSnapshotKey,
  nowMs = Date.now(),
  minimumGeneratedAt,
  maxEntries,
  maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
} = {}) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new TypeError("signed feed envelope must be an object");
  }
  if (envelope.version !== 1 || envelope.algorithm !== "Ed25519") {
    throw new TypeError("unsupported signed feed envelope");
  }
  if (
    typeof envelope.key_id !== "string"
    || !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(envelope.key_id)
  ) {
    throw new TypeError("signed feed key id is invalid");
  }
  const payloadBytes = decodeCanonicalBase64Url(envelope.payload_b64, "payload_b64");
  const signature = decodeCanonicalBase64Url(envelope.signature_b64, "signature_b64");
  if (payloadBytes.length > maxPayloadBytes || signature.length !== 64) {
    throw new TypeError("signed feed envelope length is invalid");
  }
  if (!crypto.verify(null, payloadBytes, publicKey, signature)) {
    throw new Error("signed feed signature verification failed");
  }

  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new TypeError("signed feed payload is not valid JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("signed feed payload must be an object");
  }
  if (expectedSchema && payload.schema_version !== expectedSchema) {
    throw new TypeError("signed feed schema does not match");
  }
  if (expectedSnapshotKey && payload.snapshot_key !== expectedSnapshotKey) {
    throw new TypeError("signed feed snapshot key does not match");
  }
  const generatedAt = requireExactIso(payload.generated_at, "signed feed generated_at");
  if (generatedAt > nowMs + 5 * 60_000) {
    throw new TypeError("signed feed generated_at is in the future");
  }
  if (minimumGeneratedAt) {
    const minimum = requireExactIso(minimumGeneratedAt, "minimum generated_at");
    if (generatedAt < minimum) {
      throw new TypeError("signed feed is older than the last-known-good snapshot");
    }
  }
  if (maxEntries !== undefined) validatePublicEntries(payload.entries, maxEntries);
  return payload;
}

function createSignedStaticFeedEnvelope(payload, privateKey, {
  keyId,
  maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
} = {}) {
  if (typeof keyId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(keyId)) {
    throw new TypeError("signed feed key id is invalid");
  }
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  if (payloadBytes.length > maxPayloadBytes) {
    throw new TypeError("signed feed payload exceeds the size limit");
  }
  return {
    version: 1,
    algorithm: "Ed25519",
    key_id: keyId,
    payload_b64: payloadBytes.toString("base64url"),
    signature_b64: crypto.sign(null, payloadBytes, privateKey).toString("base64url"),
  };
}

module.exports = {
  DEFAULT_MAX_PAYLOAD_BYTES,
  createSignedStaticFeedEnvelope,
  verifySignedStaticFeed,
};
