"use strict";

const crypto = require("node:crypto");

const ACCESS_KEY_CREDENTIAL_VERSION = 1;
const ACCESS_KEY_CREDENTIAL_TYPE = "access_key_pair";
const EMPTY_SHA256 = crypto.createHash("sha256").update("").digest("hex");

function createAccessKeyCredential(accessKeyId, accessKeySecret) {
  const id = String(accessKeyId || "").trim();
  const secret = String(accessKeySecret || "").trim();
  if (!id || !secret) return "";
  return JSON.stringify({
    version: ACCESS_KEY_CREDENTIAL_VERSION,
    type: ACCESS_KEY_CREDENTIAL_TYPE,
    accessKeyId: id,
    accessKeySecret: secret,
  });
}

function parseAccessKeyCredential(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.version !== ACCESS_KEY_CREDENTIAL_VERSION) return null;
  if (parsed.type !== ACCESS_KEY_CREDENTIAL_TYPE) return null;
  const accessKeyId = typeof parsed.accessKeyId === "string" ? parsed.accessKeyId.trim() : "";
  const accessKeySecret = typeof parsed.accessKeySecret === "string"
    ? parsed.accessKeySecret.trim()
    : "";
  if (!accessKeyId || !accessKeySecret) return null;
  return { accessKeyId, accessKeySecret };
}

function getCredentialRedactions(raw) {
  const values = [];
  if (typeof raw === "string" && raw.length > 0) values.push(raw);
  const parsed = parseAccessKeyCredential(raw);
  if (parsed) values.push(parsed.accessKeyId, parsed.accessKeySecret);
  return values;
}

function rfc3986Encode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(parameters) {
  return Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [rfc3986Encode(key), rfc3986Encode(value)])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function createAliyunRpcSignature(parameters, accessKeySecret) {
  const query = canonicalQuery(parameters);
  const stringToSign = `GET&%2F&${rfc3986Encode(query)}`;
  return crypto
    .createHmac("sha1", `${String(accessKeySecret)}&`)
    .update(stringToSign)
    .digest("base64");
}

function formatIsoWithoutMilliseconds(now) {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function signAliyunRpcRequest(url, credentials, options = {}) {
  const parsed = new URL(url);
  const now = options.now instanceof Date ? options.now : new Date();
  const nonce = String(options.nonce || crypto.randomUUID());
  const parameters = Object.fromEntries(parsed.searchParams.entries());
  Object.assign(parameters, {
    Format: "JSON",
    AccessKeyId: credentials.accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    Timestamp: formatIsoWithoutMilliseconds(now),
    SignatureVersion: "1.0",
    SignatureNonce: nonce,
  });
  parameters.Signature = createAliyunRpcSignature(parameters, credentials.accessKeySecret);
  parsed.search = canonicalQuery(parameters);
  return { url: parsed.toString(), headers: {} };
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function formatVolcengineDate(now) {
  return now.toISOString().replace(/[-:]|\.\d{3}/g, "");
}

function signVolcengineRequest(url, credentials, options = {}) {
  const parsed = new URL(url);
  const now = options.now instanceof Date ? options.now : new Date();
  const region = String(options.region || "cn-north-1");
  const service = String(options.service || "billing");
  const xDate = formatVolcengineDate(now);
  const shortDate = xDate.slice(0, 8);
  const signedHeaders = "host;x-content-sha256;x-date";
  const query = canonicalQuery(Object.fromEntries(parsed.searchParams.entries()));
  const canonicalHeaders = [
    `host:${parsed.host}`,
    `x-content-sha256:${EMPTY_SHA256}`,
    `x-date:${xDate}`,
    "",
  ].join("\n");
  const canonicalRequest = [
    "GET",
    parsed.pathname || "/",
    query,
    canonicalHeaders,
    signedHeaders,
    EMPTY_SHA256,
  ].join("\n");
  const scope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const dateKey = hmacSha256(credentials.accessKeySecret, shortDate);
  const regionKey = hmacSha256(dateKey, region);
  const serviceKey = hmacSha256(regionKey, service);
  const signingKey = hmacSha256(serviceKey, "request");
  const signature = hmacSha256(signingKey, stringToSign, "hex");

  parsed.search = query;
  return {
    url: parsed.toString(),
    headers: {
      "X-Date": xDate,
      "X-Content-Sha256": EMPTY_SHA256,
      Authorization: `HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

module.exports = {
  createAccessKeyCredential,
  parseAccessKeyCredential,
  getCredentialRedactions,
  rfc3986Encode,
  createAliyunRpcSignature,
  signAliyunRpcRequest,
  signVolcengineRequest,
};
