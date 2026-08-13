"use strict";

// W7: sliding-window burn rate + limit-exhaustion ETA for the usage-limits
// endpoint. Rates come from local queue.jsonl increments (token counts only),
// so everything here is a LOCAL ESTIMATE layered on top of the official
// used_percent each provider reports.

// Providers that may carry a burn_rate. Token-only sources (trae, codebuddy,
// opencode, ...) are deliberately absent so their legacy response shape stays
// byte-identical.
const PROVIDER_SOURCES = Object.freeze({
  claude: "claude",
  codex: "codex",
  cursor: "cursor",
  gemini: "gemini",
  kimi: "kimi",
  kiro: "kiro",
  antigravity: "antigravity",
  copilot: "copilot",
  grok: "grok",
  zed: "zed",
});

function parseResetMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value * 1000;
  if (typeof value === "string" && value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : NaN;
  }
  return NaN;
}

// Only session windows we can anchor in time produce a percent-per-minute
// estimate. Field names mirror usage-limits-provider-specs.js on the
// dashboard side. Everything else still reports token rates but leaves
// percent/ETA null, which the UI renders as "—".
const ANCHORED_WINDOWS = Object.freeze({
  claude(provider) {
    const window = provider?.five_hour;
    if (!window || typeof window !== "object") return null;
    return {
      usedPercent: Number(window.utilization),
      resetMs: parseResetMs(window.resets_at),
      windowSeconds: 5 * 3600,
    };
  },
  codex(provider) {
    const window = provider?.primary_window;
    if (!window || typeof window !== "object") return null;
    const seconds = Number(window.limit_window_seconds);
    return {
      usedPercent: Number(window.used_percent),
      resetMs: parseResetMs(window.reset_at),
      windowSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 5 * 3600,
    };
  },
});

function rowTokens(row) {
  const n = Number(row?.total_tokens);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function rowStartMs(row) {
  const ms = Date.parse(row?.hour_start);
  return Number.isFinite(ms) ? ms : NaN;
}

function sumTokensSince(rows, source, sinceMs) {
  let total = 0;
  for (const row of rows || []) {
    if (row?.source !== source) continue;
    const startMs = rowStartMs(row);
    if (!Number.isFinite(startMs) || startMs < sinceMs) continue;
    total += rowTokens(row);
  }
  return total;
}

/**
 * Per-source token increments over the last 60/120 minutes. Queue buckets are
 * half-hour aligned; a bucket counts when its start falls inside the window,
 * so the current partial bucket is included (recent-activity estimate, not an
 * exact integral).
 */
function computeSlidingBurnRates(rows, { nowMs = Date.now() } = {}) {
  const out = {};
  for (const row of rows || []) {
    const source = row?.source;
    if (typeof source !== "string" || !source) continue;
    const startMs = rowStartMs(row);
    if (!Number.isFinite(startMs)) continue;
    const tokens = rowTokens(row);
    if (!tokens) continue;
    if (startMs < nowMs - 120 * 60_000) continue;
    if (!out[source]) out[source] = { tokens_last_60m: 0, tokens_last_120m: 0 };
    out[source].tokens_last_120m += tokens;
    if (startMs >= nowMs - 60 * 60_000) out[source].tokens_last_60m += tokens;
  }
  return out;
}

function buildBurnRate({ source, provider, rows, rates, nowMs }) {
  const tokens60 = rates?.tokens_last_60m || 0;
  const tokens120 = rates?.tokens_last_120m || 0;
  const anchored = ANCHORED_WINDOWS[source] ? ANCHORED_WINDOWS[source](provider) : null;
  const burn = {
    basis: "local_estimate",
    tokens_last_60m: tokens60,
    tokens_last_120m: tokens120,
    tokens_per_min_60m: tokens60 / 60,
    tokens_per_min_120m: tokens120 / 120,
    window_seconds: anchored?.windowSeconds || null,
    percent_per_min: null,
    eta_exhaust_at: null,
  };

  if (!anchored) return burn;
  const { usedPercent, resetMs, windowSeconds } = anchored;
  if (!Number.isFinite(usedPercent) || !Number.isFinite(resetMs) || !(windowSeconds > 0)) return burn;

  // Anchor the window: percent-per-token = used_percent / tokens consumed
  // since the window opened. Recent token rate then converts to percent/min.
  const windowStartMs = resetMs - windowSeconds * 1000;
  const tokensSinceStart = sumTokensSince(rows, source, windowStartMs);
  const recentTokensPerMin = tokens60 > 0 ? tokens60 / 60 : tokens120 / 120;
  if (!(tokensSinceStart > 0) || !(recentTokensPerMin > 0) || !(usedPercent > 0)) return burn;

  const percentPerMin = (usedPercent / tokensSinceStart) * recentTokensPerMin;
  if (!(percentPerMin > 0)) return burn;
  burn.percent_per_min = percentPerMin;
  const remaining = Math.max(0, 100 - Math.min(usedPercent, 100));
  if (remaining > 0) {
    burn.eta_exhaust_at = new Date(nowMs + (remaining / percentPerMin) * 60_000).toISOString();
  }
  return burn;
}

/**
 * Attach a `burn_rate` block to every known limits provider in a usage-limits
 * response. Returns a new object; the input is not mutated.
 */
function attachBurnRates(data, rows, { nowMs = Date.now() } = {}) {
  if (!data || typeof data !== "object") return data;
  const rates = computeSlidingBurnRates(rows, { nowMs });
  const out = { ...data };
  for (const [key, source] of Object.entries(PROVIDER_SOURCES)) {
    const provider = out[key];
    if (!provider || typeof provider !== "object") continue;
    out[key] = {
      ...provider,
      burn_rate: buildBurnRate({ source, provider, rows, rates: rates[source], nowMs }),
    };
  }
  return out;
}

module.exports = {
  PROVIDER_SOURCES,
  computeSlidingBurnRates,
  attachBurnRates,
};
