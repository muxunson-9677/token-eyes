"use strict";

const dns = require("node:dns");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

const SECRET_QUERY_PARAMS = new Set([
  "api_key", "apikey", "api-key",
  "key", "token", "secret",
  "access_token", "accesstoken",
  "refresh_token", "refreshtoken",
  "password", "passwd",
  "private_key", "privatekey",
  "accesskeyid", "signature",
  "authorization", "auth", "cookie",
  "client_secret", "clientsecret",
  "session_token", "sessiontoken",
  "api_token", "apitoken",
  "security_token", "securitytoken", "x-amz-security-token",
  "credential",
]);

class SafeOutboundError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SafeOutboundError";
    this.code = code;
  }
}

function normalizeHostname(value) {
  let hostname = String(value || "").trim().toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  return hostname;
}

function ipv4ToInteger(address) {
  if (net.isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  return (((octets[0] << 24) >>> 0) +
    (octets[1] << 16) +
    (octets[2] << 8) +
    octets[3]) >>> 0;
}

function ipv4InRange(value, base, prefixLength) {
  const address = ipv4ToInteger(value);
  const network = ipv4ToInteger(base);
  if (address === null || network === null) return false;
  const mask = prefixLength === 0
    ? 0
    : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (address & mask) === (network & mask);
}

const NON_PUBLIC_IPV4_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv6ToBigInt(address) {
  let input = normalizeHostname(address);
  if (!input || input.includes("%")) return null;

  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = input.slice(lastColon + 1);
    const ipv4Value = ipv4ToInteger(ipv4);
    if (ipv4Value === null) return null;
    input = `${input.slice(0, lastColon)}:${(ipv4Value >>> 16).toString(16)}:${(ipv4Value & 0xffff).toString(16)}`;
  }

  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const groups = halves.length === 2
    ? [...left, ...Array(missing).fill("0"), ...right]
    : left;
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) {
    return null;
  }
  let value = 0n;
  for (const part of groups) value = (value << 16n) | BigInt(`0x${part}`);
  return value;
}

function ipv6InRange(value, base, prefixLength) {
  const address = ipv6ToBigInt(value);
  const network = ipv6ToBigInt(base);
  if (address === null || network === null) return false;
  if (prefixLength === 0) return true;
  const shift = 128n - BigInt(prefixLength);
  return (address >> shift) === (network >> shift);
}

function isPublicIpAddress(value) {
  const address = normalizeHostname(value);
  const family = net.isIP(address);
  if (family === 4) {
    return !NON_PUBLIC_IPV4_RANGES.some(([base, prefix]) => ipv4InRange(address, base, prefix));
  }
  if (family !== 6) return false;

  const numeric = ipv6ToBigInt(address);
  if (numeric === null) return false;
  if ((numeric >> 32n) === 0xffffn) {
    const ipv4 = Number(numeric & 0xffffffffn);
    const dotted = [ipv4 >>> 24, (ipv4 >>> 16) & 255, (ipv4 >>> 8) & 255, ipv4 & 255].join(".");
    return isPublicIpAddress(dotted);
  }

  if (!ipv6InRange(address, "2000::", 3)) return false;
  if (ipv6InRange(address, "2001::", 23)) return false;
  if (ipv6InRange(address, "2001:db8::", 32)) return false;
  if (ipv6InRange(address, "2002::", 16)) return false;
  if (ipv6InRange(address, "3ffe::", 16)) return false;
  if (ipv6InRange(address, "3fff::", 20)) return false;
  return true;
}

function isSyntheticProxyIpv4Address(value) {
  return ipv4InRange(normalizeHostname(value), "198.18.0.0", 15);
}

function validateOutboundUrl(value, options = {}) {
  const testMode = Boolean(options.testMode);
  const rejectSecretQuery = options.rejectSecretQuery !== false;
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch (error) {
    throw new SafeOutboundError("unsafe_outbound_url", "出站请求地址格式无效");
  }

  const protocolAllowed = parsed.protocol === "https:" || (testMode && parsed.protocol === "http:");
  if (!protocolAllowed) {
    throw new SafeOutboundError("unsafe_outbound_url", "生产出站请求只允许 HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new SafeOutboundError("unsafe_outbound_url", "出站请求地址不允许包含 URL credentials");
  }
  if (rejectSecretQuery) {
    for (const key of parsed.searchParams.keys()) {
      if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) {
        throw new SafeOutboundError("unsafe_outbound_url", "出站请求地址不允许包含密钥查询参数");
      }
    }
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    throw new SafeOutboundError("unsafe_outbound_url", "出站请求地址缺少主机名");
  }
  if (!testMode && net.isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new SafeOutboundError("unsafe_outbound_address", "出站请求目标不是公网地址");
  }
  return parsed;
}

function resolveAll(hostname, dnsLookup) {
  return new Promise((resolve, reject) => {
    let completed = false;
    const callback = (error, addresses) => {
      if (completed) return;
      completed = true;
      if (error) {
        reject(new SafeOutboundError("dns_resolution_failed", "出站请求 DNS 解析失败"));
        return;
      }
      resolve(addresses);
    };
    try {
      dnsLookup(hostname, { all: true, verbatim: true }, callback);
    } catch (error) {
      callback(error);
    }
  });
}

function createLookupError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createPinnedLookup(hostname, addresses) {
  const expectedHostname = normalizeHostname(hostname);
  const selected = Array.isArray(addresses) ? addresses[0] : null;
  if (!selected || (selected.family !== 4 && selected.family !== 6)) {
    throw new SafeOutboundError("dns_resolution_failed", "没有可固定的 DNS 地址");
  }

  return function pinnedLookup(requestedHostname, options, callback) {
    let lookupOptions = options;
    let done = callback;
    if (typeof options === "function") {
      done = options;
      lookupOptions = {};
    } else if (typeof options === "number") {
      lookupOptions = { family: options };
    }
    lookupOptions = lookupOptions || {};
    if (typeof done !== "function") {
      throw new TypeError("lookup callback is required");
    }
    if (normalizeHostname(requestedHostname) !== expectedHostname) {
      queueMicrotask(() => done(createLookupError("EAI_NONAME", "固定 DNS 主机名不匹配")));
      return;
    }
    const requestedFamily = Number(lookupOptions.family || 0);
    if (requestedFamily && requestedFamily !== selected.family) {
      queueMicrotask(() => done(createLookupError("EAI_ADDRFAMILY", "固定 DNS 地址族不匹配")));
      return;
    }
    queueMicrotask(() => {
      if (lookupOptions.all === true) {
        done(null, [{ address: selected.address, family: selected.family }]);
      } else {
        done(null, selected.address, selected.family);
      }
    });
  };
}

async function resolveSafeOutboundTarget(value, options = {}) {
  const url = validateOutboundUrl(value, options);
  const hostname = normalizeHostname(url.hostname);
  const dnsLookup = typeof options.dnsLookup === "function" ? options.dnsLookup : dns.lookup;
  const rawAddresses = await resolveAll(hostname, dnsLookup);
  if (!Array.isArray(rawAddresses) || rawAddresses.length === 0) {
    throw new SafeOutboundError("dns_resolution_empty", "出站请求 DNS 没有返回地址");
  }

  const addresses = rawAddresses.map((record) => {
    const address = normalizeHostname(record?.address);
    const actualFamily = net.isIP(address);
    const declaredFamily = Number(record?.family);
    if (!address || (declaredFamily !== 4 && declaredFamily !== 6) || actualFamily !== declaredFamily) {
      throw new SafeOutboundError("dns_resolution_failed", "出站请求 DNS 返回了非法地址记录");
    }
    if (!options.testMode && !isPublicIpAddress(address)) {
      const allowSyntheticDnsAddress = typeof options.allowSyntheticDnsAddress === "function"
        ? options.allowSyntheticDnsAddress
        : null;
      const approvedSyntheticAddress = isSyntheticProxyIpv4Address(address)
        && allowSyntheticDnsAddress?.({ hostname, address, family: declaredFamily }) === true;
      if (!approvedSyntheticAddress) {
        throw new SafeOutboundError("unsafe_outbound_address", "出站请求 DNS 包含非公网地址");
      }
    }
    return { address, family: declaredFamily };
  });

  return {
    url,
    hostname,
    addresses,
    selectedAddress: addresses[0],
    lookup: createPinnedLookup(hostname, addresses),
  };
}

function redactSecrets(value, secrets = []) {
  let result = String(value);
  const ordered = Array.from(new Set(
    (Array.isArray(secrets) ? secrets : [secrets])
      .filter((secret) => typeof secret === "string" && secret.length > 0)
  )).sort((a, b) => b.length - a.length);
  for (const secret of ordered) result = result.split(secret).join("***");
  return result;
}

async function safeOutboundRequest(value, options = {}) {
  const target = await resolveSafeOutboundTarget(value, options);
  const requestImpl = options.requestImpl || (target.url.protocol === "https:" ? https.request : http.request);
  const timeoutMs = Number(options.timeoutMs);
  const headers = {};
  for (const [name, headerValue] of Object.entries(options.headers || {})) {
    const lower = name.toLowerCase();
    if (lower === "host" || lower === ":authority") continue;
    headers[name] = headerValue;
  }
  const requestOptions = {
    hostname: target.hostname,
    port: target.url.port || (target.url.protocol === "https:" ? 443 : 80),
    path: target.url.pathname + target.url.search,
    method: String(options.method || "GET").toUpperCase(),
    headers,
    lookup: target.lookup,
    agent: false,
  };
  if (target.url.protocol === "https:" && net.isIP(target.hostname) === 0) {
    requestOptions.servername = target.hostname;
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) requestOptions.timeout = timeoutMs;
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      const message = redactSecrets(error?.message || String(error), options.secrets || []);
      const code = error?.code === "request_timeout" ? "request_timeout" : "outbound_request_failed";
      reject(new SafeOutboundError(code, message));
    };
    try {
      request = requestImpl(requestOptions, (response) => {
        if (settled) {
          response.destroy?.();
          return;
        }
        settled = true;
        resolve({ request, response, target });
      });
      request.on("error", fail);
      request.on("timeout", () => {
        request.destroy();
        fail(new SafeOutboundError("request_timeout", "出站请求超时"));
      });
      request.end(options.body);
    } catch (error) {
      fail(error);
    }
  });
}

function readContentLength(response) {
  const raw = response?.headers?.["content-length"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function responseTooLargeError() {
  return new SafeOutboundError("response_too_large", "响应体超过大小限制");
}

function destroyLimitedStreams(response, request) {
  try { request?.destroy?.(); } catch { /* best effort */ }
  try { response?.destroy?.(); } catch { /* best effort */ }
}

function readLimitedResponseBody(response, options = {}) {
  const maxBytes = Number(options.maxBytes);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    return Promise.reject(new TypeError("maxBytes must be a non-negative safe integer"));
  }
  const contentLength = readContentLength(response);
  if (contentLength !== null && contentLength > maxBytes) {
    destroyLimitedStreams(response, options.request);
    return Promise.reject(new SafeOutboundError("response_too_large", "响应体超过大小限制"));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      handler(value);
    };
    response.on("data", (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        destroyLimitedStreams(response, options.request);
        finish(reject, new SafeOutboundError("response_too_large", "响应体超过大小限制"));
        return;
      }
      chunks.push(buffer);
    });
    response.on("end", () => finish(resolve, Buffer.concat(chunks)));
    response.on("error", (error) => {
      const message = redactSecrets(error?.message || String(error), options.secrets || []);
      finish(reject, new SafeOutboundError("outbound_response_failed", message));
    });
  });
}

async function readLimitedFetchResponse(response, options = {}) {
  const maxBytes = Number(options.maxBytes);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer");
  }
  const reader = response?.body?.getReader?.();
  const contentLengthValue = response?.headers?.get?.("content-length");
  const contentLength = contentLengthValue && /^\d+$/.test(String(contentLengthValue).trim())
    ? Number(contentLengthValue)
    : null;
  if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength > maxBytes)) {
    try {
      if (reader) await reader.cancel();
      else await response?.body?.cancel?.();
    } catch { /* best effort */ }
    throw new SafeOutboundError("response_too_large", "响应体超过大小限制");
  }

  if (!reader) {
    throw new SafeOutboundError("response_stream_unavailable", "响应体不支持受限流式读取");
  }

  const chunks = [];
  let totalBytes = 0;
  while (true) {
    let item;
    try {
      item = await reader.read();
    } catch (error) {
      try { await reader.cancel(); } catch { /* best effort */ }
      const message = redactSecrets(error?.message || String(error), options.secrets || []);
      throw new SafeOutboundError("outbound_response_failed", message);
    }
    const { done, value } = item;
    if (done) break;
    const chunk = Buffer.from(value);
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      try { await reader.cancel(); } catch { /* best effort */ }
      throw new SafeOutboundError("response_too_large", "响应体超过大小限制");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = {
  SafeOutboundError,
  SECRET_QUERY_PARAMS,
  validateOutboundUrl,
  isPublicIpAddress,
  isSyntheticProxyIpv4Address,
  createPinnedLookup,
  resolveSafeOutboundTarget,
  safeOutboundRequest,
  readLimitedResponseBody,
  readLimitedFetchResponse,
  redactSecrets,
};
