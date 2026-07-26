// Public pricing API. Replaces the hard-coded MODEL_PRICING table that used
// to live in src/lib/local-api.js. Keeps the same synchronous shape so all
// existing callers (computeRowCost, /functions/* handlers, tests) work
// unchanged after `await ensurePricingLoaded()` is awaited once at startup.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const curatedOverrides = require("./curated-overrides.json");
const {
  lookupPricing,
  buildLitellmPerMillionMap,
} = require("./matcher");
const { loadLitellmData } = require("./litellm-fetcher");

const ZERO_PRICING = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
const TOKEN_ONLY_SOURCES = new Set(["trae", "codebuddy"]);
const AGENT_PRICING_SOURCES = ["claude", "codex", "hermes"];
const DEFAULT_AGENT_DEFAULT_PRICING = Object.freeze({
  claude: Object.freeze({ inputUsdPer1M: 0, outputUsdPer1M: 0 }),
  codex: Object.freeze({ inputUsdPer1M: 0, outputUsdPer1M: 0 }),
  hermes: Object.freeze({ inputUsdPer1M: 0, outputUsdPer1M: 0 }),
});

// D07 will make this configurable. D04 hard-codes the MVP constant so cost
// conversion for CNY-denominated pricingRules is correct today and D07 only
// has to swap the source of this number.
const DEFAULT_USD_TO_CNY = 7.2;
const PRICING_RULE_CURRENCIES = ["USD", "CNY"];

function normalizeUsdToCny(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_TO_CNY;
}

function normalizePriceValue(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function normalizeAgentDefaultPricing(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const source of AGENT_PRICING_SOURCES) {
    const entry = input[source] && typeof input[source] === "object" ? input[source] : {};
    out[source] = {
      inputUsdPer1M: normalizePriceValue(entry.inputUsdPer1M),
      outputUsdPer1M: normalizePriceValue(entry.outputUsdPer1M),
    };
  }
  return out;
}

function getAgentDefaultPriceForSource(source, agentDefaultPricing) {
  const key = typeof source === "string" ? source.trim().toLowerCase() : "";
  if (!AGENT_PRICING_SOURCES.includes(key)) return null;
  const normalized = normalizeAgentDefaultPricing(agentDefaultPricing);
  return normalized[key] || DEFAULT_AGENT_DEFAULT_PRICING[key];
}

// ── pricingRules (full plan D03/D04) ─────────────────────────────────────────
// Each rule is keyed by `${source}:${model}` and carries per-1M input/output
// prices plus a currency. Cost is computed in the rule's native currency then
// converted to USD (CNY rules divide by usdToCny). Codex/every-code reasoning
// tokens are folded into output per CLAUDE.md, so they are NOT separately
// billed even under a pricingRule.

function normalizePricingRule(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const source = String(input.source ?? "").trim().toLowerCase();
  const model = String(input.model ?? "").trim();
  const currency = String(input.currency ?? "USD").trim().toUpperCase();
  const inputPricePer1M = normalizePriceValue(input.inputPricePer1M);
  const outputPricePer1M = normalizePriceValue(input.outputPricePer1M);
  // id is ALWAYS derived from the normalized source:model. Never trust an
  // externally-supplied id — two rows with the same source+model but different
  // ids would silently both survive dedup and both match a queue row.
  const id = source && model ? `${source}:${model}` : "";
  return {
    id,
    source,
    model,
    inputPricePer1M,
    outputPricePer1M,
    currency: PRICING_RULE_CURRENCIES.includes(currency) ? currency : "USD",
    updated_at:
      typeof input.updated_at === "string" && input.updated_at.trim()
        ? input.updated_at.trim()
        : new Date().toISOString(),
  };
}

function normalizePricingRules(raw) {
  if (!Array.isArray(raw)) return [];
  // Dedup by the normalized source:model key (which is also the rule id), so
  // inputs that differ only in a stale/foreign id field collapse to one rule.
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const rule = normalizePricingRule(item);
    // Skip rules missing source/model — they can never match a queue row.
    if (!rule.source || !rule.model || !rule.id) continue;
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);
    out.push(rule);
  }
  return out;
}

// Build a lookup map keyed by `${source}:${model}` for O(1) row matching.
// Returns null when no rules are configured so callers can short-circuit.
function buildPricingRuleIndex(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const index = new Map();
  for (const rule of rules) {
    if (!rule || !rule.source || !rule.model) continue;
    index.set(`${rule.source}:${rule.model}`, rule);
  }
  return index.size ? index : null;
}

// Resolve a pricingRule for a queue row. Returns null when no exact match.
function getPricingRuleForRow(row, pricingRules) {
  if (!row || !Array.isArray(pricingRules) || pricingRules.length === 0) return null;
  const source = typeof row.source === "string" ? row.source.trim().toLowerCase() : "";
  const model = typeof row.model === "string" ? row.model.trim() : "";
  if (!source || !model) return null;
  for (const rule of pricingRules) {
    if (rule.source === source && rule.model === model) return rule;
  }
  return null;
}

// Compute cost (in USD) for a row using a pricingRule. Honors the
// codex/every-code reasoning-fold: reasoning_output_tokens are already inside
// output_tokens for those sources, so they are not billed again.
function computeRowCostWithRule(row, rule, usdToCny = DEFAULT_USD_TO_CNY) {
  const rate = Number.isFinite(usdToCny) && usdToCny > 0 ? usdToCny : DEFAULT_USD_TO_CNY;
  // Normalize source before the reasoning-fold check so "CODEX" / " Codex "
  // queue rows still get the fold (matches the built-in-model path which uses
  // a lowercased source via getModelPricing).
  const source =
    typeof row.source === "string" ? row.source.trim().toLowerCase() : "";
  const reasoningIncludedInOutput =
    source === "codex" || source === "every-code";
  const inputLike =
    (row.input_tokens || 0) +
    (row.cached_input_tokens || 0) +
    (row.cache_creation_input_tokens || 0);
  const outputLike =
    (row.output_tokens || 0) +
    (reasoningIncludedInOutput ? 0 : (row.reasoning_output_tokens || 0));
  const nativeCost =
    (inputLike / 1_000_000) * rule.inputPricePer1M +
    (outputLike / 1_000_000) * rule.outputPricePer1M;
  return rule.currency === "CNY" ? nativeCost / rate : nativeCost;
}
const SEED_SNAPSHOT_PATH = path.resolve(__dirname, "seed-snapshot.json");

// Sync seed load. Done at require-time so callers that haven't awaited
// ensurePricingLoaded() (e.g. tests, vite mock startup, edge functions) still
// get LiteLLM-backed pricing instead of all-zero. ensurePricingLoaded() will
// later upgrade this to fresh disk cache or upstream data.
let seedSnapshotVersion = null;

function loadSeedSync() {
  try {
    const raw = fs.readFileSync(SEED_SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    seedSnapshotVersion = typeof parsed?._meta?.generated_at === "string"
      ? parsed._meta.generated_at
      : null;
    delete parsed._meta;
    return parsed;
  } catch (e) {
    return {};
  }
}

const seedRaw = loadSeedSync();

const state = {
  loaded: false,
  loadingPromise: null,
  litellmRawMap: seedRaw, // raw per-token; field shape from LiteLLM JSON
  litellmPerMillionMap: buildLitellmPerMillionMap(seedRaw), // USD/MTok
  source: Object.keys(seedRaw).length ? "seed-snapshot:sync" : null,
  // negativeCache prevents re-walking the LiteLLM map for models we've already
  // determined are unknown. Cleared on every reload.
  negativeCache: new Set(),
};

function defaultCachePath() {
  return path.join(os.homedir(), ".tokentracker", "cache", "pricing.json");
}

async function ensurePricingLoaded(opts = {}) {
  if (state.loaded) return state;
  if (state.loadingPromise) return state.loadingPromise;

  state.loadingPromise = (async () => {
    try {
      const cachePath = opts.cachePath || defaultCachePath();
      const { data, source } = await loadLitellmData({ ...opts, cachePath });
      state.litellmRawMap = data || {};
      state.litellmPerMillionMap = buildLitellmPerMillionMap(state.litellmRawMap);
      state.source = source;
      state.loaded = true;
      state.negativeCache.clear();
      return state;
    } finally {
      state.loadingPromise = null;
    }
  })();

  return state.loadingPromise;
}

// For tests: drop loaded state so a fresh call can re-load. Seeds with the
// bundled snapshot so getModelPricing() still works without ensurePricingLoaded.
function resetPricingForTests() {
  state.loaded = false;
  state.loadingPromise = null;
  state.litellmRawMap = seedRaw;
  state.litellmPerMillionMap = buildLitellmPerMillionMap(seedRaw);
  state.source = Object.keys(seedRaw).length ? "seed-snapshot:sync" : null;
  state.negativeCache.clear();
}

function getModelPricing(model, opts = {}) {
  if (!model) return ZERO_PRICING;
  let lookupSource = null;
  if (typeof opts === "string") {
    lookupSource = opts.toLowerCase();
  } else if (typeof opts.source === "string") {
    lookupSource = opts.source.toLowerCase();
  }
  const cacheKey = lookupSource ? `${lookupSource}\0${model}` : model;
  if (state.negativeCache.has(cacheKey)) return ZERO_PRICING;

  const result = lookupPricing(model, {
    curated: curatedOverrides,
    litellm: state.litellmPerMillionMap,
    source: lookupSource,
  });
  if (result.hit) return result.value;

  state.negativeCache.add(cacheKey);
  return ZERO_PRICING;
}

function getPricingMetadata(model, opts = {}) {
  if (!model) return { pricing_source: null, pricing_version: null };
  let lookupSource = null;
  if (typeof opts === "string") {
    lookupSource = opts.toLowerCase();
  } else if (typeof opts.source === "string") {
    lookupSource = opts.source.toLowerCase();
  }
  const result = lookupPricing(model, {
    curated: curatedOverrides,
    litellm: state.litellmPerMillionMap,
    source: lookupSource,
  });
  if (!result.hit) return { pricing_source: null, pricing_version: null };
  return {
    pricing_source: result.source,
    pricing_version: seedSnapshotVersion || state.source || "unknown",
  };
}

// Same formula and Codex/every-code reasoning-folding rule as the previous
// computeRowCost in src/lib/local-api.js. Moved here so vite mock + local
// server share one source of truth.
//
// Full plan D04 priority:
//   1. pricingRules[source:model] exact match (CNY rules converted to USD)
//   2. MVP agentDefaultPricing[source]
//   3. TokenTracker built-in model pricing (LiteLLM + curated)
//   4. 0
function computeRowCost(row, options = {}) {
  return computeRowCostDetailed(row, options).cost_usd;
}

function computeRowCostDetailed(row, options = {}) {
  let costUsd = 0;
  let pricedTokens = 0;
  let unpricedTokens = 0;
  let hasPricing = false;

  const totalTokens = Number(row.total_tokens || 0);
  const inputTokens = Number(row.input_tokens || 0);
  const outputTokens = Number(row.output_tokens || 0);
  const cachedInputTokens = Number(row.cached_input_tokens || 0);
  const cacheCreationTokens = Number(row.cache_creation_input_tokens || 0);
  const reasoningTokens = Number(row.reasoning_output_tokens || 0);
  const source = String(row.source || "").trim().toLowerCase();

  if (TOKEN_ONLY_SOURCES.has(source)) {
    return {
      cost_usd: 0,
      priced_tokens: 0,
      unpriced_tokens: totalTokens,
      pricing_coverage: totalTokens > 0 ? "unpriced" : "complete",
    };
  }

  if (Array.isArray(options.pricingRules) && options.pricingRules.length > 0) {
    const rule = getPricingRuleForRow(row, options.pricingRules);
    if (rule) {
      costUsd = computeRowCostWithRule(row, rule, options.usdToCny);
      pricedTokens = totalTokens;
      hasPricing = true;
    }
  }

  if (!hasPricing && Object.prototype.hasOwnProperty.call(options, "agentDefaultPricing")) {
    const agentPricing = getAgentDefaultPriceForSource(row.source, options.agentDefaultPricing);
    if (agentPricing && (agentPricing.inputUsdPer1M !== 0 || agentPricing.outputUsdPer1M !== 0)) {
      costUsd = (
        ((inputTokens + cachedInputTokens + cacheCreationTokens) *
          agentPricing.inputUsdPer1M +
          (outputTokens + reasoningTokens) *
            agentPricing.outputUsdPer1M) /
        1_000_000
      );
      pricedTokens = totalTokens;
      hasPricing = true;
    }
  }

  if (!hasPricing) {
    const pricing = getModelPricing(row.model, { source: row.source });
    if (pricing.input !== 0 || pricing.output !== 0 || pricing.cache_read !== 0 || pricing.cache_write !== 0) {
      const reasoningIncludedInOutput = row.source === "codex" || row.source === "every-code";
      const reasoningCost = reasoningIncludedInOutput
        ? 0
        : reasoningTokens * (pricing.output || 0);
      costUsd = (
        inputTokens * (pricing.input || 0) +
        outputTokens * (pricing.output || 0) +
        cachedInputTokens * (pricing.cache_read || 0) +
        cacheCreationTokens * (pricing.cache_write || 0) +
        reasoningCost
      ) / 1_000_000;
      pricedTokens = totalTokens;
      hasPricing = true;
    }
  }

  if (!hasPricing) {
    unpricedTokens = totalTokens;
  }

  let pricingCoverage = "complete";
  if (totalTokens > 0) {
    if (unpricedTokens === 0) pricingCoverage = "complete";
    else if (pricedTokens === 0) pricingCoverage = "unpriced";
    else pricingCoverage = "partial";
  }

  return {
    cost_usd: Number(costUsd.toFixed(6)),
    priced_tokens: pricedTokens,
    unpriced_tokens: unpricedTokens,
    pricing_coverage: pricingCoverage,
  };
}

// Backwards-compatible MODEL_PRICING export. Test at
// test/model-breakdown.test.js:236 reads `localApi.MODEL_PRICING["kiro-agent"]`
// and expects { input, output, cache_read, cache_write } shape. We expose the
// CURATED.exact map (which contains the kiro entries by design); LiteLLM
// entries are NOT included here because they're keyed dynamically and the old
// table was authoritative for what is now CURATED.
const MODEL_PRICING = curatedOverrides.exact;

module.exports = {
  ensurePricingLoaded,
  getModelPricing,
  getPricingMetadata,
  computeRowCost,
  computeRowCostDetailed,
  resetPricingForTests,
  MODEL_PRICING,
  ZERO_PRICING,
  AGENT_PRICING_SOURCES,
  DEFAULT_AGENT_DEFAULT_PRICING,
  normalizeAgentDefaultPricing,
  DEFAULT_USD_TO_CNY,
  PRICING_RULE_CURRENCIES,
  normalizePricingRule,
  normalizePricingRules,
  buildPricingRuleIndex,
  getPricingRuleForRow,
  computeRowCostWithRule,
  normalizeUsdToCny,
  __getStateForTests: () => state,
};
