"use strict";

const crypto = require("node:crypto");

const MAX_FEED_BYTES = 128 * 1024;
const MAX_ANNOUNCEMENTS = 20;
const ALLOWED_OPENAI_HOSTS = new Set([
  "help.openai.com",
  "openai.com",
  "chatgpt.com",
  "status.openai.com",
]);
const X_AUTHORS = new Map([
  ["openai", "OpenAI"],
  ["thsottiaux", "thsottiaux"],
]);
const CONFIRMED_RESET_CONCEPT = /\b(?:i(?:'ve| have)\s+reset|we(?:'ve| have)\s+reset|usage\s+limits?\s+(?:have\s+been|were)\s+reset|banked\s+reset\s+has\s+landed|reset\s+has\s+been\s+propagated|reset\s+is\s+(?:live|complete))\b/iu;

function requireIso(value, label) {
  if (typeof value !== "string" || !value) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  return time;
}

function parseHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || url.hash
  ) {
    throw new TypeError(`${label} must be a safe HTTPS URL`);
  }
  return url;
}

function assertOfficialOpenAiUrl(value, label) {
  const url = parseHttpsUrl(value, label);
  if (!ALLOWED_OPENAI_HOSTS.has(url.hostname.toLowerCase())) {
    throw new TypeError(`${label} is outside the official URL allowlist`);
  }
  return url;
}

function parseExactXSourceUrl(value) {
  const url = parseHttpsUrl(value, "source_url");
  if (
    url.hostname.toLowerCase() !== "x.com"
    || url.search
  ) {
    return null;
  }
  const match = url.pathname.match(/^\/([^/]+)\/status\/([0-9]+)\/?$/u);
  if (!match) return null;
  const author = X_AUTHORS.get(match[1].toLowerCase());
  if (!author) return null;
  return { author, postId: match[2] };
}

function assertBoundedText(value, label, maximum) {
  if (
    typeof value !== "string"
    || value.length === 0
    || Array.from(value).length > maximum
  ) {
    throw new TypeError(`${label} length is invalid`);
  }
}

function validateAnnouncement(item, { nowMs }) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new TypeError("announcement must be an object");
  }
  if (
    typeof item.id !== "string"
    || !/^[a-z0-9][a-z0-9._:-]{0,79}$/u.test(item.id)
  ) {
    throw new TypeError("announcement id is invalid");
  }
  if (item.type !== "official_reset_announcement") {
    throw new TypeError("announcement type is unsupported");
  }
  if (item.announcement_state !== undefined && item.announcement_state !== "confirmed") {
    throw new TypeError("announcement state is unsupported");
  }
  assertBoundedText(item.title, "announcement title", 80);
  assertBoundedText(item.summary, "announcement summary", 240);
  if (item.body !== undefined) {
    assertBoundedText(item.body, "announcement body", 4_000);
  }
  if (
    item.reset_kind !== undefined
    && !["hard", "banked", "mixed", "unknown"].includes(item.reset_kind)
  ) {
    throw new TypeError("announcement reset kind is unsupported");
  }
  if (
    item.reset_scope !== undefined
    && !["all_paid_users", "all_codex_work_users", "unknown"].includes(item.reset_scope)
  ) {
    throw new TypeError("announcement reset scope is unsupported");
  }
  assertOfficialOpenAiUrl(item.official_url, "official_url");

  const sourceUrl = parseHttpsUrl(item.source_url, "source_url");
  if (sourceUrl.hostname.toLowerCase() === "x.com") {
    const source = parseExactXSourceUrl(item.source_url);
    if (!source) throw new TypeError("source_url is not an allowlisted X status URL");
    if (item.source_author !== source.author) {
      throw new TypeError("source author does not match source_url");
    }
    if (item.source_post_id !== source.postId) {
      throw new TypeError("source post ID does not match source_url");
    }
  } else {
    assertOfficialOpenAiUrl(item.source_url, "source_url");
    if (item.source_author !== undefined || item.source_post_id !== undefined) {
      throw new TypeError("OpenAI page source must not include X source metadata");
    }
  }

  const publishedAt = requireIso(item.published_at, "announcement published_at");
  const expiresAt = requireIso(item.expires_at, "announcement expires_at");
  if (expiresAt <= publishedAt) {
    throw new TypeError("announcement expiry must follow publication");
  }
  if (expiresAt <= nowMs) throw new TypeError("announcement is expired");
}

function isConfirmedResetAnnouncement(item) {
  if (!item || typeof item !== "object") return false;
  if (item.announcement_state === "confirmed") return true;
  if (item.source_author !== "thsottiaux") return true;
  return CONFIRMED_RESET_CONCEPT.test(String(item.body || item.summary || ""));
}

function validateCodexResetFeedPayload(payload, { nowMs = Date.now() } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("feed payload must be an object");
  }
  const generatedAt = requireIso(payload.generated_at, "feed generated_at");
  if (generatedAt > nowMs + 5 * 60 * 1000) {
    throw new TypeError("feed generated_at is in the future");
  }
  if (!Array.isArray(payload.announcements)) {
    throw new TypeError("feed announcements must be an array");
  }
  if (payload.announcements.length > MAX_ANNOUNCEMENTS) {
    throw new TypeError("feed announcement count exceeds the limit");
  }
  const ids = new Set();
  const sourcePosts = new Set();
  for (const item of payload.announcements) {
    validateAnnouncement(item, { nowMs });
    if (ids.has(item.id)) throw new TypeError("duplicate announcement id");
    ids.add(item.id);
    if (item.source_author && item.source_post_id) {
      const sourceKey = `${item.source_author}:${item.source_post_id}`;
      if (sourcePosts.has(sourceKey)) {
        throw new TypeError("duplicate announcement source post");
      }
      sourcePosts.add(sourceKey);
    }
  }
  return payload;
}

function decodeBase64Url(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new TypeError(`${label} must be canonical Base64URL`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) {
    throw new TypeError(`${label} must be canonical Base64URL`);
  }
  return bytes;
}

function verifyCodexResetFeed(envelope, {
  publicKey,
  nowMs = Date.now(),
} = {}) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new TypeError("feed envelope must be an object");
  }
  if (envelope.version !== 1) throw new TypeError("unsupported feed version");
  const payloadBytes = decodeBase64Url(envelope.payload_b64, "payload_b64");
  const signature = decodeBase64Url(envelope.signature_b64, "signature_b64");
  if (payloadBytes.length > MAX_FEED_BYTES || signature.length !== 64) {
    throw new TypeError("feed envelope length is invalid");
  }
  if (!crypto.verify(null, payloadBytes, publicKey, signature)) {
    throw new Error("feed signature verification failed");
  }

  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new TypeError("signed feed payload is not valid JSON");
  }
  return validateCodexResetFeedPayload(payload, { nowMs });
}

function createSignedCodexResetFeedEnvelope(payload, privateKey) {
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  if (payloadBytes.length > MAX_FEED_BYTES) {
    throw new TypeError("feed payload exceeds the size limit");
  }
  return {
    version: 1,
    payload_b64: payloadBytes.toString("base64url"),
    signature_b64: crypto.sign(null, payloadBytes, privateKey).toString("base64url"),
  };
}

module.exports = {
  ALLOWED_OPENAI_HOSTS,
  createSignedCodexResetFeedEnvelope,
  isConfirmedResetAnnouncement,
  validateCodexResetFeedPayload,
  verifyCodexResetFeed,
};
