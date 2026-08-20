"use strict";

// V2 Task 6 (W3): message-level request usage collector for Claude Code.
//
// Streams `~/.claude/projects/**/*.jsonl`, extracting ONLY the `message.usage`
// numbers (plus id/model/timestamp metadata) from assistant entries. The
// conversation body (`message.content`) is never read into any output —
// privacy red line per CLAUDE.md.
//
// Dedup MUST go through `claudeMessageDedupKey()` from rollout.js: a bare
// `msgId && reqId` guard fails open on sub-agent / DeepSeek-style entries
// that carry no requestId and overcounts 1.6–3.7x (issue #64).

const fssync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");

const {
  claudeMessageDedupKey,
  normalizeClaudeUsage,
  toUtcHalfHourStart,
  parseRequestUsageBoundary,
  normalizeModelInput,
} = require("./rollout");
const { summarizePricingProvenance } = require("./data-evidence");

const DEFAULT_MODEL = "unknown";

function isNonEmptyObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0);
}

function isAllZeroUsage(u) {
  if (!u || typeof u !== "object") return true;
  for (const k of [
    "input_tokens",
    "cached_input_tokens",
    "cache_creation_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
  ]) {
    if (Number(u[k] || 0) !== 0) return false;
  }
  return true;
}

function claudeSessionIdFromPath(filePath) {
  const base = path.basename(String(filePath || ""));
  return base.endsWith(".jsonl") ? base.slice(0, -".jsonl".length) : base;
}

function initTotals() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    priced_tokens: 0,
    unpriced_tokens: 0,
  };
}

// Mirrors collectRolloutRequestUsageRecords (Codex) in shape:
// { source, from, to, records, totals } with records sorted newest-first.
async function collectClaudeRequestUsageRecords(options) {
  const {
    claudeProjectFiles,
    from,
    to,
    timeZoneContext,
    limit = 500,
    pricingOptions = {},
  } = options || {};

  const files = Array.isArray(claudeProjectFiles) ? claudeProjectFiles : [];
  const maxLimit = Math.min(Math.max(1, Number(limit) || 500), 1000);

  const fromTs = parseRequestUsageBoundary(from, { timeZoneContext });
  const toTs = parseRequestUsageBoundary(to, { end: true, timeZoneContext });

  const records = [];
  const seenMessageHashes = new Set();
  const { computeRowCostDetailed } = require("./pricing");

  for (const filePath of files) {
    const st = await fs.stat(filePath).catch(() => null);
    if (!st || !st.isFile()) continue;
    // A session file's mtime is >= its newest event timestamp, so files last
    // written before the range start cannot contain in-range events.
    if (fromTs != null && st.mtimeMs < fromTs) continue;

    const sessionId = claudeSessionIdFromPath(filePath);

    const stream = fssync.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
      for await (const line of rl) {
        if (!line || !line.includes('"usage"')) continue;

        let obj;
        try {
          obj = JSON.parse(line);
        } catch (_e) {
          continue;
        }

        const usage = obj?.message?.usage || obj?.usage;
        if (!isNonEmptyObject(usage)) continue;

        const tokenTimestamp = typeof obj?.timestamp === "string" ? obj.timestamp : null;
        if (!tokenTimestamp) continue;
        const ts = new Date(tokenTimestamp).getTime();
        if (!Number.isFinite(ts)) continue;
        if (fromTs != null && ts < fromTs) continue;
        if (toTs != null && ts > toTs) continue;

        // Dedup before range-independent work; entries without a msgId return
        // null and are treated as unique (same semantics as the parser).
        const dedupHash = claudeMessageDedupKey(obj);
        if (dedupHash && seenMessageHashes.has(dedupHash)) continue;

        const normalized = normalizeClaudeUsage(usage);
        if (isAllZeroUsage(normalized)) continue;

        if (dedupHash) seenMessageHashes.add(dedupHash);

        const model = normalizeModelInput(obj?.message?.model || obj?.model) || DEFAULT_MODEL;
        const msgId = typeof obj?.message?.id === "string" ? obj.message.id : null;
        const hourStart = toUtcHalfHourStart(tokenTimestamp);

        const record = {
          id: `claude:${sessionId}:${tokenTimestamp}:${msgId || records.length}`,
          timestamp: tokenTimestamp,
          hour_start: hourStart || tokenTimestamp,
          source: "claude",
          agent: "Claude",
          model,
          message_id: msgId,
          input_tokens: normalized.input_tokens,
          cached_input_tokens: normalized.cached_input_tokens,
          cache_creation_input_tokens: normalized.cache_creation_input_tokens,
          output_tokens: normalized.output_tokens,
          reasoning_output_tokens: normalized.reasoning_output_tokens,
          total_tokens: normalized.total_tokens,
          cost_usd: 0,
          status: null,
          latency_ms: null,
          first_token_ms: null,
          origin: "claude_project_jsonl",
          request_source: "claude_session_log",
          record_kind: "request_event",
        };

        const costResult = computeRowCostDetailed(record, pricingOptions);
        Object.assign(record, costResult);

        records.push(record);
      }
    } finally {
      rl.close();
      stream.close?.();
    }
  }

  records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const limitedRecords = records.slice(0, maxLimit);

  const totals = initTotals();
  for (const record of limitedRecords) {
    totals.input_tokens += record.input_tokens;
    totals.cached_input_tokens += record.cached_input_tokens;
    totals.cache_creation_input_tokens += record.cache_creation_input_tokens;
    totals.output_tokens += record.output_tokens;
    totals.reasoning_output_tokens += record.reasoning_output_tokens;
    totals.total_tokens += record.total_tokens;
    if (record.cost_usd !== null && Number.isFinite(Number(record.cost_usd))) {
      totals.cost_usd += Number(record.cost_usd);
    }
    totals.priced_tokens += record.priced_tokens || 0;
    totals.unpriced_tokens += record.unpriced_tokens || 0;
  }

  const pricingSummary = summarizePricingProvenance(limitedRecords);
  if (pricingSummary.pricing_coverage === "unpriced") totals.cost_usd = null;

  return {
    source: "claude",
    from: from || null,
    to: to || null,
    records: limitedRecords,
    totals: { ...totals, ...pricingSummary },
  };
}

module.exports = { collectClaudeRequestUsageRecords };
