"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_LINE_PREFIX_BYTES = 4096;
const MAX_ROLLOUT_FILES = 400;
const FILE_MTIME_LOOKBACK_MS = 36 * 60 * 60 * 1000;
const JSON_WHITESPACE = new Set([0x09, 0x0a, 0x0d, 0x20]);

function safeSessionId(value) {
  const text = String(value || "").trim();
  if (/^[a-z0-9][a-z0-9._-]{0,95}$/iu.test(text)) return text;
  if (!text) return null;
  return `session-${crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12)}`;
}

function skipWhitespace(buffer, start) {
  let index = start;
  while (index < buffer.length && JSON_WHITESPACE.has(buffer[index])) index += 1;
  return index;
}

function readStringToken(buffer, start) {
  if (buffer[start] !== 0x22) return null;
  let escaped = false;
  for (let index = start + 1; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (byte === 0x5c) {
      escaped = true;
      continue;
    }
    if (byte === 0x22) {
      return { start: start + 1, end: index, next: index + 1 };
    }
    if (byte < 0x20) return null;
  }
  return null;
}

function tokenEquals(buffer, token, expected) {
  if (!token || token.end - token.start !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (buffer[token.start + index] !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function decodeStringToken(buffer, token) {
  if (!token) return null;
  for (let index = token.start; index < token.end; index += 1) {
    if (buffer[index] === 0x5c) return null;
  }
  return buffer.subarray(token.start, token.end).toString("utf8");
}

function skipPrimitive(buffer, start) {
  let index = start;
  while (
    index < buffer.length
    && !JSON_WHITESPACE.has(buffer[index])
    && ![0x2c, 0x5d, 0x7d].includes(buffer[index])
  ) {
    index += 1;
  }
  if (index === start) return null;
  const value = buffer.subarray(start, index).toString("ascii");
  if (!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/u.test(value)) return null;
  return index;
}

function skipValue(buffer, start, depth = 0) {
  if (depth > 16) return null;
  let index = skipWhitespace(buffer, start);
  if (index >= buffer.length) return null;
  if (buffer[index] === 0x22) return readStringToken(buffer, index)?.next ?? null;
  if (buffer[index] === 0x7b) {
    index = skipWhitespace(buffer, index + 1);
    if (buffer[index] === 0x7d) return index + 1;
    while (index < buffer.length) {
      const key = readStringToken(buffer, index);
      if (!key) return null;
      index = skipWhitespace(buffer, key.next);
      if (buffer[index] !== 0x3a) return null;
      index = skipValue(buffer, index + 1, depth + 1);
      if (index === null) return null;
      index = skipWhitespace(buffer, index);
      if (buffer[index] === 0x7d) return index + 1;
      if (buffer[index] !== 0x2c) return null;
      index = skipWhitespace(buffer, index + 1);
    }
    return null;
  }
  if (buffer[index] === 0x5b) {
    index = skipWhitespace(buffer, index + 1);
    if (buffer[index] === 0x5d) return index + 1;
    while (index < buffer.length) {
      index = skipValue(buffer, index, depth + 1);
      if (index === null) return null;
      index = skipWhitespace(buffer, index);
      if (buffer[index] === 0x5d) return index + 1;
      if (buffer[index] !== 0x2c) return null;
      index = skipWhitespace(buffer, index + 1);
    }
    return null;
  }
  return skipPrimitive(buffer, index);
}

function normalizedTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(String(value || ""))) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function metadataCandidate(metadata) {
  if (metadata.topType === "session_meta" && metadata.payloadId) {
    const sessionId = safeSessionId(metadata.payloadId);
    return sessionId ? { kind: "session_meta", sessionId } : null;
  }
  if (metadata.topType === "event_msg" && metadata.payloadType === "user_message") {
    const timestamp = normalizedTimestamp(metadata.timestamp);
    return timestamp ? { kind: "user_message", timestamp } : null;
  }
  if (metadata.topType === "response_item" && metadata.payloadType === "message" && metadata.payloadRole === "user") {
    const timestamp = normalizedTimestamp(metadata.timestamp);
    return timestamp ? { kind: "user_message", timestamp } : null;
  }
  return null;
}

function parsePayloadPrefix(buffer, start, metadata) {
  let index = skipWhitespace(buffer, start);
  if (buffer[index] !== 0x7b) return null;
  index = skipWhitespace(buffer, index + 1);
  if (buffer[index] === 0x7d) return { next: index + 1 };
  while (index < buffer.length) {
    const key = readStringToken(buffer, index);
    if (!key) return null;
    index = skipWhitespace(buffer, key.next);
    if (buffer[index] !== 0x3a) return null;
    index = skipWhitespace(buffer, index + 1);

    if (tokenEquals(buffer, key, "type") || tokenEquals(buffer, key, "id") || tokenEquals(buffer, key, "role")) {
      const value = readStringToken(buffer, index);
      const decoded = decodeStringToken(buffer, value);
      if (!value || decoded === null) return null;
      if (tokenEquals(buffer, key, "type")) metadata.payloadType = decoded;
      else if (tokenEquals(buffer, key, "id")) metadata.payloadId = decoded;
      else metadata.payloadRole = decoded;
      index = value.next;
      const candidate = metadataCandidate(metadata);
      if (candidate) return { candidate };
    } else {
      index = skipValue(buffer, index);
      if (index === null) return null;
    }

    index = skipWhitespace(buffer, index);
    if (buffer[index] === 0x7d) return { next: index + 1 };
    if (buffer[index] !== 0x2c) return null;
    index = skipWhitespace(buffer, index + 1);
  }
  return null;
}

function parseMetadataPrefix(buffer) {
  const metadata = { topType: null, timestamp: null, payloadType: null, payloadId: null, payloadRole: null };
  let index = skipWhitespace(buffer, 0);
  if (buffer[index] !== 0x7b) return null;
  index = skipWhitespace(buffer, index + 1);
  while (index < buffer.length && buffer[index] !== 0x7d) {
    const key = readStringToken(buffer, index);
    if (!key) return null;
    index = skipWhitespace(buffer, key.next);
    if (buffer[index] !== 0x3a) return null;
    index = skipWhitespace(buffer, index + 1);

    if (tokenEquals(buffer, key, "type") || tokenEquals(buffer, key, "timestamp")) {
      const value = readStringToken(buffer, index);
      const decoded = decodeStringToken(buffer, value);
      if (!value || decoded === null) return null;
      if (tokenEquals(buffer, key, "type")) metadata.topType = decoded;
      else metadata.timestamp = decoded;
      index = value.next;
    } else if (tokenEquals(buffer, key, "payload")) {
      const payload = parsePayloadPrefix(buffer, index, metadata);
      if (!payload) return null;
      if (payload.candidate) return payload.candidate;
      index = payload.next;
    } else {
      index = skipValue(buffer, index);
      if (index === null) return null;
    }

    const candidate = metadataCandidate(metadata);
    if (candidate) return candidate;
    index = skipWhitespace(buffer, index);
    if (buffer[index] === 0x7d) break;
    if (buffer[index] !== 0x2c) return null;
    index = skipWhitespace(buffer, index + 1);
  }
  return metadataCandidate(metadata);
}

function createJsonValidationState() {
  return {
    stack: [],
    mode: "default",
    stringRole: null,
    inString: false,
    escaped: false,
    unicodeRemaining: 0,
    numberState: null,
    literal: null,
    literalIndex: 0,
    invalid: false,
    rootStarted: false,
    rootComplete: false,
  };
}

function currentJsonContext(state) {
  return state.stack[state.stack.length - 1] || null;
}

function canStartJsonValue(state) {
  const context = currentJsonContext(state);
  if (!context) return !state.rootStarted && !state.rootComplete;
  if (context.type === "object") return context.phase === "value";
  return context.phase === "value_or_end" || context.phase === "value";
}

function completeJsonValue(state) {
  const context = currentJsonContext(state);
  if (!context) {
    state.invalid = true;
    return;
  }
  if (
    (context.type === "object" && context.phase !== "value")
    || (context.type === "array" && !["value_or_end", "value"].includes(context.phase))
  ) {
    state.invalid = true;
    return;
  }
  context.phase = "comma_or_end";
}

function openJsonContainer(state, type) {
  if (!canStartJsonValue(state)) {
    state.invalid = true;
    return;
  }
  if (state.stack.length === 0) {
    if (type !== "object") {
      state.invalid = true;
      return;
    }
    state.rootStarted = true;
  }
  state.stack.push({
    type,
    phase: type === "object" ? "key_or_end" : "value_or_end",
  });
}

function closeJsonContainer(state, type) {
  const context = currentJsonContext(state);
  if (!context || context.type !== type) {
    state.invalid = true;
    return;
  }
  const canClose = type === "object"
    ? ["key_or_end", "comma_or_end"].includes(context.phase)
    : ["value_or_end", "comma_or_end"].includes(context.phase);
  if (!canClose) {
    state.invalid = true;
    return;
  }
  state.stack.pop();
  if (state.stack.length === 0) state.rootComplete = true;
  else completeJsonValue(state);
}

function startJsonString(state) {
  const context = currentJsonContext(state);
  if (context?.type === "object" && ["key_or_end", "key"].includes(context.phase)) {
    state.stringRole = "key";
  } else if (context && canStartJsonValue(state)) {
    state.stringRole = "value";
  } else {
    state.invalid = true;
    return;
  }
  state.mode = "string";
  state.inString = true;
}

function finishJsonString(state) {
  const context = currentJsonContext(state);
  if (state.stringRole === "key") {
    if (!context || context.type !== "object") state.invalid = true;
    else context.phase = "colon";
  } else {
    completeJsonValue(state);
  }
  state.mode = "default";
  state.stringRole = null;
  state.inString = false;
}

function isAcceptedNumberState(numberState) {
  return ["zero", "integer", "fraction", "exponent"].includes(numberState);
}

function isJsonTokenDelimiter(byte) {
  return JSON_WHITESPACE.has(byte) || [0x2c, 0x5d, 0x7d].includes(byte);
}

function consumeNumberByte(state, byte) {
  if (isJsonTokenDelimiter(byte)) {
    if (!isAcceptedNumberState(state.numberState)) state.invalid = true;
    else {
      state.mode = "default";
      state.numberState = null;
      completeJsonValue(state);
    }
    return false;
  }

  const isDigit = byte >= 0x30 && byte <= 0x39;
  const isNonZeroDigit = byte >= 0x31 && byte <= 0x39;
  if (state.numberState === "minus") {
    if (byte === 0x30) state.numberState = "zero";
    else if (isNonZeroDigit) state.numberState = "integer";
    else state.invalid = true;
  } else if (state.numberState === "zero") {
    if (byte === 0x2e) state.numberState = "fraction_start";
    else if (byte === 0x65 || byte === 0x45) state.numberState = "exponent_start";
    else state.invalid = true;
  } else if (state.numberState === "integer") {
    if (isDigit) return true;
    if (byte === 0x2e) state.numberState = "fraction_start";
    else if (byte === 0x65 || byte === 0x45) state.numberState = "exponent_start";
    else state.invalid = true;
  } else if (state.numberState === "fraction_start") {
    if (isDigit) state.numberState = "fraction";
    else state.invalid = true;
  } else if (state.numberState === "fraction") {
    if (isDigit) return true;
    if (byte === 0x65 || byte === 0x45) state.numberState = "exponent_start";
    else state.invalid = true;
  } else if (state.numberState === "exponent_start") {
    if (byte === 0x2b || byte === 0x2d) state.numberState = "exponent_sign";
    else if (isDigit) state.numberState = "exponent";
    else state.invalid = true;
  } else if (state.numberState === "exponent_sign") {
    if (isDigit) state.numberState = "exponent";
    else state.invalid = true;
  } else if (state.numberState === "exponent") {
    if (!isDigit) state.invalid = true;
  }
  return true;
}

function consumeJsonByte(state, byte) {
  if (state.invalid) return;
  if (state.mode === "string") {
    if (state.unicodeRemaining > 0) {
      const isHex = (byte >= 0x30 && byte <= 0x39)
        || (byte >= 0x41 && byte <= 0x46)
        || (byte >= 0x61 && byte <= 0x66);
      if (!isHex) state.invalid = true;
      else state.unicodeRemaining -= 1;
      return;
    }
    if (state.escaped) {
      state.escaped = false;
      if (byte === 0x75) state.unicodeRemaining = 4;
      else if (![0x22, 0x2f, 0x5c, 0x62, 0x66, 0x6e, 0x72, 0x74].includes(byte)) state.invalid = true;
      return;
    }
    if (byte === 0x5c) state.escaped = true;
    else if (byte === 0x22) finishJsonString(state);
    else if (byte < 0x20) state.invalid = true;
    return;
  }

  if (state.mode === "literal") {
    if (byte !== state.literal.charCodeAt(state.literalIndex)) {
      state.invalid = true;
      return;
    }
    state.literalIndex += 1;
    if (state.literalIndex === state.literal.length) {
      state.mode = "default";
      state.literal = null;
      state.literalIndex = 0;
      completeJsonValue(state);
    }
    return;
  }

  if (state.mode === "number" && consumeNumberByte(state, byte)) return;
  if (state.invalid) return;
  if (state.mode === "number") return;
  if (JSON_WHITESPACE.has(byte)) return;
  if (state.rootComplete) {
    state.invalid = true;
    return;
  }

  const context = currentJsonContext(state);
  if (byte === 0x7b) openJsonContainer(state, "object");
  else if (byte === 0x5b) openJsonContainer(state, "array");
  else if (byte === 0x7d) closeJsonContainer(state, "object");
  else if (byte === 0x5d) closeJsonContainer(state, "array");
  else if (byte === 0x22) startJsonString(state);
  else if (byte === 0x3a) {
    if (!context || context.type !== "object" || context.phase !== "colon") state.invalid = true;
    else context.phase = "value";
  } else if (byte === 0x2c) {
    if (!context || context.phase !== "comma_or_end") state.invalid = true;
    else context.phase = context.type === "object" ? "key" : "value";
  } else if ([0x74, 0x66, 0x6e].includes(byte)) {
    if (!context || !canStartJsonValue(state)) state.invalid = true;
    else {
      state.literal = byte === 0x74 ? "true" : byte === 0x66 ? "false" : "null";
      state.literalIndex = 1;
      state.mode = "literal";
    }
  } else if (byte === 0x2d || (byte >= 0x30 && byte <= 0x39)) {
    if (!context || !canStartJsonValue(state)) state.invalid = true;
    else {
      state.mode = "number";
      state.numberState = byte === 0x2d ? "minus" : byte === 0x30 ? "zero" : "integer";
    }
  } else {
    state.invalid = true;
  }
}

function isCompleteJsonLine(state) {
  if (state.mode === "number") {
    if (!isAcceptedNumberState(state.numberState)) return false;
    state.mode = "default";
    state.numberState = null;
    completeJsonValue(state);
  }
  return state.rootStarted
    && state.rootComplete
    && state.stack.length === 0
    && !state.inString
    && !state.escaped
    && state.unicodeRemaining === 0
    && state.mode === "default"
    && !state.invalid;
}

function createActivityDayResolver(timeZoneContext = {}) {
  const timeZone = typeof timeZoneContext?.timeZone === "string" ? timeZoneContext.timeZone.trim() : "";
  let formatter = null;
  if (timeZone) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      formatter = null;
    }
  }
  const offsetMinutes = Number.isFinite(timeZoneContext?.offsetMinutes)
    ? Math.trunc(timeZoneContext.offsetMinutes)
    : 0;
  return (timestamp) => {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return null;
    if (formatter) {
      const values = {};
      for (const part of formatter.formatToParts(date)) {
        if (["year", "month", "day"].includes(part.type)) values[part.type] = part.value;
      }
      if (values.year && values.month && values.day) return `${values.year}-${values.month}-${values.day}`;
    }
    return new Date(date.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
  };
}

function validDayKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

async function listRolloutFiles(root, cutoffMs) {
  const output = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && /^rollout-.*\.jsonl$/iu.test(entry.name)) {
        try {
          const stat = await fs.promises.stat(fullPath);
          if (stat.mtimeMs >= cutoffMs) output.push({ filePath: fullPath, mtimeMs: stat.mtimeMs });
        } catch {
          // A live rollout can move to the archive between discovery and stat.
        }
      }
    }
  }
  return output;
}

async function scanRolloutFile(filePath, resolveActivityDay, from, to, allowedSessionIds = null) {
  const prefix = Buffer.allocUnsafe(MAX_LINE_PREFIX_BYTES);
  let prefixLength = 0;
  let prefixParsed = false;
  let candidate = null;
  let jsonState = null;
  let sessionId = null;
  let excludedSession = false;
  const spans = new Map();

  function resetLine() {
    prefixLength = 0;
    prefixParsed = false;
    candidate = null;
    jsonState = null;
  }

  function parsePrefix() {
    if (prefixParsed) return;
    prefixParsed = true;
    candidate = parseMetadataPrefix(prefix.subarray(0, prefixLength));
    if (candidate) {
      jsonState = createJsonValidationState();
      for (let index = 0; index < prefixLength; index += 1) {
        consumeJsonByte(jsonState, prefix[index]);
      }
    }
  }

  function consumeSegment(segment) {
    let offset = 0;
    if (prefixLength < MAX_LINE_PREFIX_BYTES) {
      const copied = Math.min(MAX_LINE_PREFIX_BYTES - prefixLength, segment.length);
      segment.copy(prefix, prefixLength, 0, copied);
      prefixLength += copied;
      offset = copied;
      if (prefixLength === MAX_LINE_PREFIX_BYTES) parsePrefix();
    }
    if (!candidate || !jsonState) return;
    for (let index = offset; index < segment.length; index += 1) {
      consumeJsonByte(jsonState, segment[index]);
    }
  }

  function finishLine() {
    if (!prefixParsed) parsePrefix();
    if (candidate && jsonState && isCompleteJsonLine(jsonState)) {
      if (candidate.kind === "session_meta") {
        sessionId = candidate.sessionId;
        excludedSession = allowedSessionIds instanceof Set && !allowedSessionIds.has(sessionId);
      } else {
        const activityDay = resolveActivityDay(candidate.timestamp);
        if (activityDay && (!from || activityDay >= from) && (!to || activityDay <= to)) {
          const current = spans.get(activityDay) || {
            firstMessageAt: candidate.timestamp,
            lastMessageAt: candidate.timestamp,
            messageCount: 0,
            activityDay,
          };
          if (candidate.timestamp < current.firstMessageAt) current.firstMessageAt = candidate.timestamp;
          if (candidate.timestamp > current.lastMessageAt) current.lastMessageAt = candidate.timestamp;
          current.messageCount += 1;
          spans.set(activityDay, current);
        }
      }
    }
    resetLine();
  }

  try {
    const stream = fs.createReadStream(filePath);
    for await (const chunk of stream) {
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(0x0a, start);
        const end = newline === -1 ? chunk.length : newline;
        consumeSegment(chunk.subarray(start, end));
        if (newline === -1) break;
        finishLine();
        if (excludedSession) {
          stream.destroy();
          return [];
        }
        start = newline + 1;
      }
    }
    if (prefixLength > 0 || candidate) finishLine();
  } catch {
    return [];
  }
  if (!sessionId) return [];
  return [...spans.values()].map((span) => ({ sessionId, ...span }));
}

async function collectCodexMessageSpans({
  homes = [],
  from = "",
  to = "",
  timeZoneContext = null,
  sessionIds = null,
  filePaths = null,
} = {}) {
  const normalizedFrom = from ? validDayKey(from) : "";
  const normalizedTo = to ? validDayKey(to) : "";
  if ((from && !normalizedFrom) || (to && !normalizedTo) || (normalizedFrom && normalizedTo && normalizedFrom > normalizedTo)) {
    return [];
  }
  const resolveActivityDay = createActivityDayResolver(timeZoneContext || {});
  const allowedSessionIds = Array.isArray(sessionIds)
    ? new Set(sessionIds.map(safeSessionId).filter(Boolean))
    : null;
  if (allowedSessionIds && allowedSessionIds.size === 0) return [];
  const cutoffMs = normalizedFrom
    ? Date.parse(`${normalizedFrom}T00:00:00.000Z`) - FILE_MTIME_LOOKBACK_MS
    : Date.now() - 31 * 24 * 60 * 60 * 1000;
  const files = [];
  const seen = new Set();
  const resolvedHomes = [];
  for (const home of Array.isArray(homes) ? homes : [homes]) {
    const resolvedHome = path.resolve(String(home || ""));
    if (!home || seen.has(resolvedHome)) continue;
    seen.add(resolvedHome);
    resolvedHomes.push(resolvedHome);
  }
  const directPaths = Array.isArray(filePaths)
    ? [...new Set(filePaths.map((item) => path.resolve(String(item || ""))).filter((item) => (
        resolvedHomes.some((home) => item === home || item.startsWith(`${home}${path.sep}`))
        && /^rollout-.*\.jsonl$/iu.test(path.basename(item))
      )))]
    : [];
  if (directPaths.length > 0) {
    for (const filePath of directPaths) files.push({ filePath, mtimeMs: 0 });
  } else for (const resolvedHome of resolvedHomes) {
    for (const folder of ["sessions", "archived_sessions"]) {
      files.push(...await listRolloutFiles(path.join(resolvedHome, folder), cutoffMs));
    }
  }
  files.sort((left, right) => right.mtimeMs - left.mtimeMs || left.filePath.localeCompare(right.filePath));

  const combined = new Map();
  for (const { filePath } of files.slice(0, MAX_ROLLOUT_FILES)) {
    const spans = await scanRolloutFile(filePath, resolveActivityDay, normalizedFrom, normalizedTo, allowedSessionIds);
    for (const span of spans) {
      const key = `${span.sessionId}\u0000${span.activityDay}`;
      const current = combined.get(key) || { ...span };
      if (span.firstMessageAt < current.firstMessageAt) current.firstMessageAt = span.firstMessageAt;
      if (span.lastMessageAt > current.lastMessageAt) current.lastMessageAt = span.lastMessageAt;
      if (combined.has(key)) current.messageCount += span.messageCount;
      combined.set(key, current);
    }
  }
  return [...combined.values()].sort((left, right) => (
    left.activityDay.localeCompare(right.activityDay)
    || left.sessionId.localeCompare(right.sessionId)
  ));
}

module.exports = {
  collectCodexMessageSpans,
};
