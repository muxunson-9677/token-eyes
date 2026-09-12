"use strict";

const fs = require("node:fs");

// Only skip an unambiguous standard Codex envelope. Unusual key ordering
// falls back to the existing full JSON parser rather than losing usage.
function unusedEnvelope(prefix) {
  const match = /^\s*\{\s*"timestamp"\s*:\s*"[^"\\]*"\s*,\s*(?:"ordinal"\s*:\s*\d+\s*,\s*)?"type"\s*:\s*"([^"\\]*)"\s*,\s*"payload"\s*:\s*\{/u.exec(prefix);
  if (!match) return false;
  // Keep every event_msg: older clients nest token_count under payload.msg.
  return match[1] === "response_item" || match[1] === "compacted";
}

async function* readCodexUsageLines(filePath) {
  let parts = [];
  let length = 0;
  let decided = false;
  let skip = false;
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(0x0a, start);
      const end = newline < 0 ? chunk.length : newline;
      if (!skip) {
        parts.push(chunk.subarray(start, end));
        length += end - start;
        if (!decided && (length >= 4096 || newline >= 0)) {
          decided = true;
          skip = unusedEnvelope(Buffer.concat(parts, length).subarray(0, 4096).toString("utf8"));
          if (skip) parts = [];
        }
      }
      if (newline < 0) break;
      if (!skip && length) yield Buffer.concat(parts, length).toString("utf8");
      parts = [];
      length = 0;
      decided = false;
      skip = false;
      start = newline + 1;
    }
  }
  if (!skip && length) yield Buffer.concat(parts, length).toString("utf8");
}

module.exports = { readCodexUsageLines };
