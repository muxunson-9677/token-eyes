// Pricing resolver — unit tests for the LiteLLM + curated-overrides hybrid.
//
// Network is mocked via a fetchImpl injection so these tests are deterministic
// and offline-safe.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const matcher = require("../src/lib/pricing/matcher");
const fetcher = require("../src/lib/pricing/litellm-fetcher");
const pricing = require("../src/lib/pricing");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function tmpCachePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-pricing-"));
  return path.join(dir, "pricing.json");
}

function makeFetchImpl(payload, { delayMs = 0, fail = false } = {}) {
  return async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (fail) throw new Error("simulated network failure");
    return payload;
  };
}

// Sample LiteLLM-shape data covering the cases tests will assert on.
const FIXTURE_LITELLM = {
  "claude-sonnet-4-6": {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 1.5e-5,
    cache_read_input_token_cost: 3e-7,
    cache_creation_input_token_cost: 3.75e-6,
  },
  "claude-opus-4-6": {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 2.5e-5,
    cache_read_input_token_cost: 5e-7,
    cache_creation_input_token_cost: 6.25e-6,
  },
  "claude-haiku-4-5-20251001": {
    input_cost_per_token: 1e-6,
    output_cost_per_token: 5e-6,
    cache_read_input_token_cost: 1e-7,
    cache_creation_input_token_cost: 1.25e-6,
  },
  "gpt-5.4": {
    input_cost_per_token: 2.5e-6,
    output_cost_per_token: 1.5e-5,
    cache_read_input_token_cost: 2.5e-7,
  },
  "gpt-5-codex": {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 1e-5,
    cache_read_input_token_cost: 1.25e-7,
  },
  "gpt-4o": {
    input_cost_per_token: 2.5e-6,
    output_cost_per_token: 1e-5,
  },
  "gemini-2.5-pro": {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 1e-5,
    cache_read_input_token_cost: 1.25e-7,
  },
  // Make sure the seed includes an entry CURATED also defines, so we can
  // assert CURATED wins.
  "kiro-cli-agent": {
    input_cost_per_token: 999e-6,
    output_cost_per_token: 999e-6,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// matcher.js — pure logic, no I/O

test("matcher: lookupPricing returns CURATED.exact match before LiteLLM", () => {
  const curated = {
    exact: { foo: { input: 1, output: 2 } },
    alias: {},
    fuzzy: [],
  };
  const litellm = { foo: { input: 999, output: 999 } };
  const r = matcher.lookupPricing("foo", { curated, litellm });
  assert.equal(r.hit, true);
  assert.equal(r.source, "curated:exact");
  assert.equal(r.value.input, 1);
});

test("matcher: lookupPricing falls back to LiteLLM exact when CURATED has no entry", () => {
  const curated = { exact: {}, alias: {}, fuzzy: [] };
  const litellm = { "gpt-5.4": { input: 2.5, output: 15 } };
  const r = matcher.lookupPricing("gpt-5.4", { curated, litellm });
  assert.equal(r.hit, true);
  assert.equal(r.source, "litellm:exact");
});

test("matcher: lookupPricing handles CURATED alias (literal mapping)", () => {
  const curated = {
    exact: { "composer-1": { input: 1.25, output: 10 } },
    alias: { auto: "composer-1" },
    fuzzy: [],
  };
  const r = matcher.lookupPricing("auto", { curated, litellm: {} });
  assert.equal(r.hit, true);
  assert.equal(r.source, "curated:alias");
  assert.equal(r.value.input, 1.25);
});

test("matcher: lookupPricing handles CURATED fuzzy substring (kiro-future-xyz → kiro-cli-agent)", () => {
  const curated = {
    exact: { "kiro-cli-agent": { input: 3, output: 15 } },
    alias: {},
    fuzzy: [{ match: "kiro", ref: "kiro-cli-agent" }],
  };
  const r = matcher.lookupPricing("kiro-future-xyz", { curated, litellm: {} });
  assert.equal(r.hit, true);
  assert.equal(r.source, "curated:fuzzy");
});

test("matcher: lookupPricing fuzzy match restores `digit-digit` to `digit.digit` (droid GLM parity)", () => {
  // Droid dash-normalizes upstream `GLM-5.1` to `glm-5-1`, but curated keys
  // are dot-delimited. The matcher must retry a dot-restored variant of the
  // input so dash-form inputs still resolve to the dot-form curated entry.
  const curated = {
    exact: { "glm-5.1": { input: 1.4, output: 4.4, cache_read: 0.26 } },
    alias: {},
    fuzzy: [{ match: "glm-5.1", ref: "glm-5.1" }],
  };
  const r = matcher.lookupPricing("glm-5-1-0", { curated, litellm: {} });
  assert.equal(r.hit, true, "expected dot-form fuzzy fallback to hit");
  assert.equal(r.source, "curated:exact-dot");
  assert.equal(r.value.input, 1.4);
});

test("matcher: lookupPricing strips a LiteLLM provider prefix for bare queue models", () => {
  // Queue rows store bare model names; LiteLLM keys are provider-qualified.
  const curated = { exact: {}, alias: {}, fuzzy: [] };
  const litellm = { "openrouter/xiaomi/mimo-v2.5-pro": { input: 1, output: 3, cache_read: 0.2 } };
  const r = matcher.lookupPricing("mimo-v2.5-pro", { curated, litellm });
  assert.equal(r.hit, true);
  assert.equal(r.source, "litellm:prefix-strip");
  assert.equal(r.value.input, 1);
});

test("matcher: prefix-strip is deterministic across providers (smallest key wins, order-independent)", () => {
  const curated = { exact: {}, alias: {}, fuzzy: [] };
  // Two providers expose the same model at different cache rates. JSON
  // insertion order must NOT decide the winner — the lexicographically
  // smallest key ("novita/..." < "openrouter/...") always wins.
  const a = { input: 0.1, output: 0.3, cache_read: 0.01 };
  const b = { input: 0.1, output: 0.3, cache_read: 0.02 };
  const r1 = matcher.lookupPricing("mimo-v2-flash", {
    curated,
    litellm: { "openrouter/xiaomi/mimo-v2-flash": a, "novita/xiaomimimo/mimo-v2-flash": b },
  });
  const r2 = matcher.lookupPricing("mimo-v2-flash", {
    curated,
    litellm: { "novita/xiaomimimo/mimo-v2-flash": b, "openrouter/xiaomi/mimo-v2-flash": a },
  });
  assert.equal(r1.source, "litellm:prefix-strip");
  assert.equal(r1.value.cache_read, 0.02, "novita key (smallest) wins");
  assert.equal(r2.value.cache_read, 0.02, "winner independent of insertion order");
});

test("matcher: CURATED alias beats a LiteLLM provider-prefixed bare collision (auto → composer-1)", () => {
  // Regression: a `*/auto` LiteLLM entry must NOT hijack Cursor's "auto".
  // Alias (step 3) runs before prefix-strip (step 5b), so "auto" stays composer-1.
  const curated = {
    exact: { "composer-1": { input: 1.25, output: 10 } },
    alias: { auto: "composer-1" },
    fuzzy: [],
  };
  const litellm = { "openrouter/openrouter/auto": { input: 0, output: 0 } };
  const r = matcher.lookupPricing("auto", { curated, litellm });
  assert.equal(r.source, "curated:alias");
  assert.equal(r.value.input, 1.25);
});

test("matcher: LiteLLM exact beats prefix-strip when a canonical bare key exists", () => {
  const curated = { exact: {}, alias: {}, fuzzy: [] };
  const litellm = {
    "gpt-4": { input: 30, output: 60 },
    "azure/gpt-4": { input: 10, output: 30 },
  };
  const r = matcher.lookupPricing("gpt-4", { curated, litellm });
  assert.equal(r.source, "litellm:exact");
  assert.equal(r.value.input, 30, "canonical bare key wins over a provider-prefixed one");
});

test("matcher: lookupPricing dot-form fallback covers exact-only Droid model ids", () => {
  const curated = {
    exact: { "MiniMax-M2.1": { input: 0.5, output: 3, cache_read: 0.05 } },
    alias: {},
    fuzzy: [],
  };
  const r = matcher.lookupPricing("minimax-m2-1-0", { curated, litellm: {} });
  assert.equal(r.hit, true, "expected dot-form exact fallback to hit");
  assert.equal(r.source, "curated:exact-dot");
  assert.equal(r.value.output, 3);
});

test("matcher: lookupPricing dot-form fallback covers LiteLLM exact ids", () => {
  const r = matcher.lookupPricing("vendor-model-2-1", {
    curated: { exact: {}, alias: {}, fuzzy: [] },
    litellm: { "vendor-model-2.1": { input: 0.2, output: 0.8 } },
  });
  assert.equal(r.hit, true);
  assert.equal(r.source, "litellm:exact-dot");
  assert.equal(r.value.input, 0.2);
});

test("matcher: lookupPricing dot-form fallback does NOT corrupt models without digit-digit pairs", () => {
  // Regression: ensure `claude-3-7-sonnet` doesn't accidentally land on a
  // hypothetical `claude-3.7-sonnet` fuzzy entry if one ever exists. The
  // regex is digit-dash-digit only; the original lookup must run first.
  const curated = {
    exact: { "claude-3-7-sonnet": { input: 3, output: 15 } },
    alias: {},
    fuzzy: [],
  };
  const r = matcher.lookupPricing("claude-3-7-sonnet", {
    curated,
    litellm: {},
  });
  assert.equal(r.hit, true);
  assert.equal(r.source, "curated:exact");
});

test("matcher: lookupPricing strips reasoning effort suffix to find LiteLLM base model", () => {
  const litellm = { "gpt-5-codex": { input: 1.25, output: 10 } };
  const r = matcher.lookupPricing("gpt-5-codex-high-fast", {
    curated: { exact: {}, alias: {}, fuzzy: [] },
    litellm,
  });
  assert.equal(r.hit, true);
  assert.equal(r.source, "litellm:strip");
  assert.equal(r.value.input, 1.25);
});

test("matcher: lookupPricing reverse-substring picks longest matching key", () => {
  const litellm = {
    "gpt-5": { input: 1, output: 1 },
    "gpt-5-codex": { input: 2, output: 2 },
  };
  const r = matcher.lookupPricing("gpt-5-codex-experimental", {
    curated: { exact: {}, alias: {}, fuzzy: [] },
    litellm,
  });
  assert.equal(r.hit, true);
  // Longest match wins — gpt-5-codex over gpt-5.
  assert.equal(r.source, "litellm:fuzzy");
  assert.equal(r.value.input, 2);
});

test("matcher: lookupPricing returns miss for completely unknown model", () => {
  const r = matcher.lookupPricing("totally-unknown-xyz-2099", {
    curated: { exact: {}, alias: {}, fuzzy: [] },
    litellm: { "gpt-5": { input: 1 } },
  });
  assert.equal(r.hit, false);
});

test("matcher: Antigravity model aliases only apply to Antigravity source", () => {
  const litellm = { "gpt-4o": { input: 999, output: 999 } };
  const curated = {
    exact: { "antigravity-gpt-oss-120b": { input: 2.5, output: 10 } },
    alias: {},
    fuzzy: [],
  };
  const generic = matcher.lookupPricing("gpt-oss-120b", {
    curated,
    litellm,
    source: "openrouter",
  });
  assert.equal(generic.hit, false);

  const antigravity = matcher.lookupPricing("gpt-oss-120b", {
    curated,
    litellm,
    source: "antigravity",
  });
  assert.equal(antigravity.hit, true);
  assert.equal(antigravity.source, "curated:exact");
  assert.equal(antigravity.value.input, 2.5);
});

test("matcher: Antigravity model normalization covers families without gpt-4o fallback", () => {
  assert.equal(matcher.normalizeAntigravityModel("Gemini 3.5 Pro"), "gemini-2.5-pro");
  assert.equal(matcher.normalizeAntigravityModel("Gemini 3.5 Flash"), "gemini-2.5-flash");
  assert.equal(matcher.normalizeAntigravityModel("Claude Haiku 4.6"), "claude-haiku-4-6");
  assert.equal(
    matcher.normalizeAntigravityModel("gpt-oss-120b"),
    "antigravity-gpt-oss-120b",
  );
  assert.notEqual(matcher.normalizeAntigravityModel("gpt-oss-20b"), "gpt-4o");
});

test("matcher: Zed model normalization maps display names + ids to pricing keys", () => {
  // Display names with "(Preview)" / spaces.
  assert.equal(matcher.normalizeZedModel("Claude Sonnet 4"), "claude-sonnet-4");
  assert.equal(matcher.normalizeZedModel("GPT-5 (Preview)"), "gpt-5");
  assert.equal(matcher.normalizeZedModel("Gemini 3 Pro (Preview)"), "gemini-3-pro");
  // "fast" must NOT be stripped (it is part of grok-code-fast-1).
  assert.equal(matcher.normalizeZedModel("Grok Code Fast 1 (Preview)"), "grok-code-fast-1");
  // Claude minors hyphenate; GPT minors keep the dot.
  assert.equal(matcher.normalizeZedModel("Claude Opus 4.5"), "claude-opus-4-5");
  assert.equal(matcher.normalizeZedModel("claude-opus-4.8"), "claude-opus-4-8");
  assert.equal(matcher.normalizeZedModel("GPT-5.2"), "gpt-5.2");
  assert.equal(matcher.normalizeZedModel("gpt-5.5"), "gpt-5.5");
  // Slash-style ids pass through.
  assert.equal(matcher.normalizeZedModel("openai/gpt-oss-20b"), "openai/gpt-oss-20b");
});

test("matcher: Claude normalization maps dotted display names to curated keys", () => {
  assert.equal(matcher.normalizeClaudeModel("Claude Opus 4.8"), "claude-opus-4-8");
  assert.equal(matcher.normalizeClaudeModel("claude-opus-4.8"), "claude-opus-4-8");
  assert.equal(matcher.normalizeClaudeModel("claude-opus-4.8-20260601"), "claude-opus-4-8-20260601");
  assert.equal(matcher.normalizeClaudeModel("opus-4-6"), "claude-opus-4-6");
  assert.equal(matcher.normalizeClaudeModel("opus-4.6"), "claude-opus-4-6");
  assert.equal(matcher.normalizeClaudeModel("opus8[1m]"), "opus8-1m");
  assert.equal(matcher.normalizeClaudeModel("4.6"), "4.6");
});

test("matcher: Zed normalization only applies to the zed source", () => {
  const litellm = { "claude-opus-4-8": { input: 5, output: 25 } };
  const curated = { exact: {}, alias: {}, fuzzy: [] };
  // Under source=zed the display/dotted name resolves via normalization.
  const zed = matcher.lookupPricing("Claude Opus 4.8 (Preview)", { curated, litellm, source: "zed" });
  assert.equal(zed.hit, true);
  assert.equal(zed.value.input, 5);
  // Other sources do not get the Zed normalization (dotted name won't match).
  const other = matcher.lookupPricing("Claude Opus 4.8 (Preview)", { curated, litellm, source: "openrouter" });
  assert.equal(other.hit, false);
});

test("matcher: convertLitellmEntry rounds away float drift (1e-7 * 1e6 must be 0.1)", () => {
  const out = matcher.convertLitellmEntry({
    input_cost_per_token: 1e-6,
    cache_read_input_token_cost: 1e-7,
  });
  assert.equal(out.input, 1);
  assert.equal(out.cache_read, 0.1, "0.09999... must round to 0.1");
});

test("matcher: buildLitellmPerMillionMap skips _meta and entries without cost fields", () => {
  const map = matcher.buildLitellmPerMillionMap({
    _meta: { source: "x", cached_at: "now" },
    "gpt-5": { input_cost_per_token: 1.25e-6, output_cost_per_token: 1e-5 },
    "info-only": { mode: "chat", max_tokens: 100 },
  });
  assert.deepEqual(Object.keys(map), ["gpt-5"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// litellm-fetcher.js — disk cache + seed fallback

test("fetcher: fresh disk cache is loaded without invoking fetch", async () => {
  const cachePath = tmpCachePath();
  await fsp.writeFile(
    cachePath,
    JSON.stringify({
      _meta: { source: "test", cached_at: new Date().toISOString() },
      "fake-model": { input_cost_per_token: 1e-6 },
    }),
  );
  let fetchCalls = 0;
  const result = await fetcher.loadLitellmData({
    cachePath,
    fetchImpl: async () => {
      fetchCalls++;
      return {};
    },
  });
  assert.equal(result.source, "disk-cache");
  assert.equal(fetchCalls, 0);
  assert.ok(result.data["fake-model"], "data round-trips through cache");
});

test("fetcher: stale disk cache triggers fetch, writes new cache", async () => {
  const cachePath = tmpCachePath();
  // Write a "stale" file (mtime 25h ago).
  await fsp.writeFile(cachePath, JSON.stringify({ _meta: {}, "old-model": {} }));
  const stale = Date.now() - 25 * 60 * 60 * 1000;
  await fsp.utimes(cachePath, new Date(stale), new Date(stale));

  const result = await fetcher.loadLitellmData({
    cachePath,
    fetchImpl: makeFetchImpl({
      "fresh-model": { input_cost_per_token: 2e-6 },
    }),
  });
  assert.equal(result.source, "upstream");
  assert.ok(result.data["fresh-model"]);
  // Cache file rewritten:
  const onDisk = JSON.parse(await fsp.readFile(cachePath, "utf8"));
  assert.ok(onDisk["fresh-model"]);
  assert.ok(!onDisk["old-model"], "stale entry replaced");
});

test("fetcher: fetch failure with no cache falls back to seed snapshot", async () => {
  const cachePath = tmpCachePath();
  // Don't pre-populate; ensure ENOENT path.
  const result = await fetcher.loadLitellmData({
    cachePath,
    fetchImpl: makeFetchImpl(null, { fail: true }),
  });
  assert.equal(result.source, "seed-snapshot");
  // Seed bundles ~2k models; spot-check a known one.
  assert.ok(result.data["gpt-5"], "seed must contain gpt-5");
});

test("fetcher: fetch failure with stale cache prefers stale cache over seed", async () => {
  const cachePath = tmpCachePath();
  await fsp.writeFile(
    cachePath,
    JSON.stringify({ _meta: {}, "stale-but-real": { input_cost_per_token: 5e-6 } }),
  );
  const stale = Date.now() - 25 * 60 * 60 * 1000;
  await fsp.utimes(cachePath, new Date(stale), new Date(stale));

  const result = await fetcher.loadLitellmData({
    cachePath,
    fetchImpl: makeFetchImpl(null, { fail: true }),
  });
  assert.equal(result.source, "stale-cache");
  assert.ok(result.data["stale-but-real"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// index.js — public API + negative cache + computeRowCost contract

test("index: ensurePricingLoaded + getModelPricing returns CURATED for kiro entries", async () => {
  pricing.resetPricingForTests();
  const cachePath = tmpCachePath();
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: makeFetchImpl(FIXTURE_LITELLM),
  });
  const kiro = pricing.getModelPricing("kiro-cli-agent");
  // CURATED says 3 / 15; LiteLLM fixture intentionally has 999/999 to verify
  // CURATED wins the race.
  assert.equal(kiro.input, 3);
  assert.equal(kiro.output, 15);
  assert.equal(kiro.cache_read, 0.3);
  assert.equal(kiro.cache_write, 3.75);
});

test("index: getModelPricing resolves claude-fable-5 from CURATED (not yet in LiteLLM)", async () => {
  pricing.resetPricingForTests();
  const cachePath = tmpCachePath();
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: makeFetchImpl(FIXTURE_LITELLM),
  });
  // Fable 5 is Anthropic's top tier ($10/$50) and absent from LiteLLM, so the
  // curated exact entry must win or the dashboard renders $0 cost.
  const fable = pricing.getModelPricing("claude-fable-5");
  assert.equal(fable.input, 10);
  assert.equal(fable.output, 50);
  assert.equal(fable.cache_read, 1);
  assert.equal(fable.cache_write, 12.5);
  // End-to-end: a row must produce non-zero cost.
  const cost = pricing.computeRowCost({
    source: "claude",
    model: "claude-fable-5",
    input_tokens: 1_000_000,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
  });
  assert.equal(cost, 10);
});

test("index: getModelPricing resolves Claude Opus 4.8 aliases from CURATED", async () => {
  pricing.resetPricingForTests();
  const cachePath = tmpCachePath();
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: makeFetchImpl(FIXTURE_LITELLM),
  });

  const dotted = pricing.getModelPricing("claude-opus-4.8", { source: "claude" });
  assert.equal(dotted.input, 5);
  assert.equal(dotted.output, 25);
  assert.equal(dotted.cache_read, 0.5);
  assert.equal(dotted.cache_write, 6.25);

  const typo = pricing.getModelPricing("opus8[1m]", { source: "claude" });
  assert.equal(typo.input, 0);
  assert.equal(typo.output, 0);

  const dated = pricing.getModelPricing("claude-opus-4.8-20260601", { source: "claude" });
  assert.equal(dated.input, 5);
  assert.equal(dated.output, 25);

  const familyOnlyDash = pricing.getModelPricing("opus-4-6", { source: "claude" });
  assert.equal(familyOnlyDash.input, 5);
  assert.equal(familyOnlyDash.output, 25);

  const familyOnlyDot = pricing.getModelPricing("opus-4.6", { source: "claude" });
  assert.equal(familyOnlyDot.input, 5);
  assert.equal(familyOnlyDot.output, 25);

  const bareVersion = pricing.getModelPricing("4.6", { source: "claude" });
  assert.equal(bareVersion.input, 0);
  assert.equal(bareVersion.output, 0);

  // Regression for GitHub #178: the reporter's latest-version row previously
  // rendered zero because the model id used a dotted minor (`4.8`).
  const issueRowCost = pricing.computeRowCost({
    source: "claude",
    model: "claude-opus-4.8",
    hour_start: "2026-06-12T00:30:00.000Z",
    input_tokens: 846_877,
    cached_input_tokens: 2_750_316,
    cache_creation_input_tokens: 568_789,
    output_tokens: 13_169,
    reasoning_output_tokens: 0,
    total_tokens: 4_179_151,
    billable_total_tokens: 4_179_151,
    conversation_count: 2,
  });
  assert.equal(issueRowCost, 9.493699);
});

test("index: getModelPricing finds LiteLLM mainstream models with correct unit conversion", async () => {
  pricing.resetPricingForTests();
  const cachePath = tmpCachePath();
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: makeFetchImpl(FIXTURE_LITELLM),
  });
  const sonnet = pricing.getModelPricing("claude-sonnet-4-6");
  assert.equal(sonnet.input, 3);
  assert.equal(sonnet.output, 15);
  assert.equal(sonnet.cache_read, 0.3);
  assert.equal(sonnet.cache_write, 3.75);
});

test("index: computeRowCost scopes Antigravity-only model aliases by source", async () => {
  pricing.resetPricingForTests();
  const cachePath = tmpCachePath();
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: makeFetchImpl(FIXTURE_LITELLM),
  });
  const row = {
    model: "gpt-oss-120b",
    input_tokens: 1_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 1_000,
    reasoning_output_tokens: 0,
  };
  assert.equal(pricing.computeRowCost({ ...row, source: "openrouter" }), 0);
  assert.equal(pricing.computeRowCost({ ...row, source: "antigravity" }), 0.0125);
  assert.equal(pricing.computeRowCost({ ...row, model: "gpt-oss-20b", source: "antigravity" }), 0);
});

test("index: Trae and CodeBuddy are token-only even when pricing is available", async () => {
  pricing.resetPricingForTests();
  const cachePath = tmpCachePath();
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: makeFetchImpl(FIXTURE_LITELLM),
  });
  const row = {
    model: "claude-sonnet-4-6",
    input_tokens: 1_000,
    cached_input_tokens: 200,
    cache_creation_input_tokens: 100,
    output_tokens: 300,
    reasoning_output_tokens: 0,
    total_tokens: 1_600,
  };
  const options = {
    pricingRules: [{
      id: "token-only-must-ignore-rules",
      source: "trae",
      modelPattern: "claude-sonnet-4-6",
      inputUsdPer1M: 100,
      outputUsdPer1M: 100,
      cacheReadUsdPer1M: 100,
      cacheWriteUsdPer1M: 100,
      currency: "USD",
      enabled: true,
    }],
    agentDefaultPricing: {
      trae: { inputUsdPer1M: 50, outputUsdPer1M: 50 },
      codebuddy: { inputUsdPer1M: 50, outputUsdPer1M: 50 },
    },
  };

  for (const source of ["trae", "codebuddy"]) {
    assert.equal(pricing.computeRowCost({ ...row, source }, options), 0);
    assert.deepEqual(pricing.computeRowCostDetailed({ ...row, source }, options), {
      cost_usd: 0,
      priced_tokens: 0,
      unpriced_tokens: 1_600,
      pricing_coverage: "unpriced",
    });
  }
});

test("index: negative cache is scoped by source for Antigravity aliases", async () => {
  pricing.resetPricingForTests();
  const cachePath = tmpCachePath();
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: makeFetchImpl(FIXTURE_LITELLM),
  });
  assert.equal(pricing.getModelPricing("gpt-oss-120b", { source: "openrouter" }).input, 0);
  assert.equal(
    pricing.getModelPricing("gpt-oss-120b", { source: "antigravity" }).input,
    2.5,
  );
});

test("index: getModelPricing populates negativeCache and short-circuits second call", async () => {
  pricing.resetPricingForTests();
  const cachePath = tmpCachePath();
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: makeFetchImpl(FIXTURE_LITELLM),
  });
  const state = pricing.__getStateForTests();
  pricing.getModelPricing("nonexistent-model-xyz");
  assert.ok(state.negativeCache.has("nonexistent-model-xyz"));
  // Mutate map to ensure the second call uses the negative cache, not the
  // map.
  state.litellmPerMillionMap["nonexistent-model-xyz"] = { input: 999 };
  const second = pricing.getModelPricing("nonexistent-model-xyz");
  assert.equal(second.input, 0, "negative cache must short-circuit");
});

test("index: computeRowCost on Codex row does NOT double-count reasoning", async () => {
  pricing.resetPricingForTests();
  const cachePath = tmpCachePath();
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: makeFetchImpl(FIXTURE_LITELLM),
  });
  // Mirrors the contract assertion in test/model-breakdown.test.js:179.
  const row = {
    source: "codex",
    model: "gpt-5.4",
    input_tokens: 50_000,
    cached_input_tokens: 950_000,
    cache_creation_input_tokens: 0,
    output_tokens: 10_000,
    reasoning_output_tokens: 4_000,
  };
  const cost = pricing.computeRowCost(row);
  const expected = 0.125 + 0.2375 + 0.15;
  assert.ok(
    Math.abs(cost - expected) < 1e-9,
    `expected ${expected}, got ${cost}`,
  );
});

test("index: computeRowCost on non-Codex source DOES bill reasoning tokens", async () => {
  pricing.resetPricingForTests();
  const cachePath = tmpCachePath();
  await pricing.ensurePricingLoaded({
    cachePath,
    fetchImpl: makeFetchImpl(FIXTURE_LITELLM),
  });
  const base = {
    source: "gemini",
    model: "gemini-2.5-pro",
    input_tokens: 1_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 1_000,
    reasoning_output_tokens: 0,
  };
  const w = pricing.computeRowCost({ ...base, reasoning_output_tokens: 5_000 });
  const wo = pricing.computeRowCost(base);
  assert.ok(w > wo, "reasoning must be billed for non-Codex sources");
});

test("index: getModelPricing returns ZERO for empty/null model", () => {
  pricing.resetPricingForTests();
  assert.equal(pricing.getModelPricing("").input, 0);
  assert.equal(pricing.getModelPricing(null).input, 0);
  assert.equal(pricing.getModelPricing(undefined).input, 0);
});

test("index: ensurePricingLoaded is idempotent (concurrent callers share one fetch)", async () => {
  pricing.resetPricingForTests();
  const cachePath = tmpCachePath();
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls++;
    return FIXTURE_LITELLM;
  };
  const [a, b, c] = await Promise.all([
    pricing.ensurePricingLoaded({ cachePath, fetchImpl }),
    pricing.ensurePricingLoaded({ cachePath, fetchImpl }),
    pricing.ensurePricingLoaded({ cachePath, fetchImpl }),
  ]);
  assert.equal(fetchCalls, 1, "concurrent callers must share one fetch");
  assert.equal(a.loaded, true);
  assert.equal(b.loaded, true);
  assert.equal(c.loaded, true);
});

test("index: agent default pricing overrides model pricing when provided", () => {
  pricing.resetPricingForTests();
  const cost = pricing.computeRowCost(
    {
      source: "claude",
      model: "claude-fable-5",
      input_tokens: 1_000_000,
      cached_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      reasoning_output_tokens: 1_000_000,
    },
    {
      agentDefaultPricing: {
        claude: { inputUsdPer1M: 2, outputUsdPer1M: 5 },
      },
    },
  );
  assert.equal(cost, 16);
});

test("index: missing MVP agent pricing falls back to model pricing", () => {
  pricing.resetPricingForTests();
  const cost = pricing.computeRowCost(
    {
      source: "codex",
      model: "gpt-5.4",
      input_tokens: 1_000_000,
      cached_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      reasoning_output_tokens: 1_000_000,
    },
    { agentDefaultPricing: {} },
  );
  assert.ok(cost > 0, "Should fall back to model pricing when agent pricing is empty");
});

test("index: non-MVP sources keep model pricing when agent pricing is enabled", () => {
  pricing.resetPricingForTests();
  const cost = pricing.computeRowCost(
    {
      source: "antigravity",
      model: "gpt-oss-120b",
      input_tokens: 1_000_000,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 1_000_000,
      reasoning_output_tokens: 0,
    },
    { agentDefaultPricing: {} },
  );
  assert.equal(cost, 12.5);
});

// ─────────────────────────────────────────────────────────────────────────────
// pricingRules (full plan D04) — normalize, lookup, computeRowCost priority

test("pricingRules: normalizePricingRules dedups by id and drops invalid entries", () => {
  const rules = pricing.normalizePricingRules([
    { source: "codex", model: "gpt-5.2-codex", inputPricePer1M: 1.75, outputPricePer1M: 14, currency: "USD" },
    // duplicate id → dropped
    { source: "codex", model: "gpt-5.2-codex", inputPricePer1M: 999, outputPricePer1M: 999, currency: "USD" },
    // missing model → dropped
    { source: "claude", model: "", inputPricePer1M: 3, outputPricePer1M: 15 },
    // missing source → dropped
    { source: "", model: "foo", inputPricePer1M: 1, outputPricePer1M: 2 },
    // negative price → normalized to 0 but kept
    { source: "hermes", model: "mimo-v2.5-pro", inputPricePer1M: -5, outputPricePer1M: 3, currency: "CNY" },
    // invalid currency → defaults to USD
    { source: "hermes", model: "qwen3.7-max", inputPricePer1M: 1, outputPricePer1M: 4, currency: "EUR" },
  ]);
  assert.equal(rules.length, 3);
  assert.equal(rules[0].id, "codex:gpt-5.2-codex");
  assert.equal(rules[1].inputPricePer1M, 0, "negative price clamped to 0");
  assert.equal(rules[1].currency, "CNY");
  assert.equal(rules[2].currency, "USD", "invalid currency defaults to USD");
  // updated_at is auto-filled when missing.
  assert.ok(rules[0].updated_at);
});

test("pricingRules: pricingRule beats agentDefaultPricing and built-in model pricing", () => {
  pricing.resetPricingForTests();
  const row = {
    source: "codex",
    model: "gpt-5.2-codex",
    input_tokens: 1_000_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 1_000_000,
    reasoning_output_tokens: 0,
  };
  // With only agentDefaultPricing → uses agent default (2 + 8 = 10).
  const costAgent = pricing.computeRowCost(row, {
    agentDefaultPricing: { codex: { inputUsdPer1M: 2, outputUsdPer1M: 8 } },
  });
  assert.equal(costAgent, 10);
  // With a pricingRule → rule wins (1.75 + 14 = 15.75).
  const costRule = pricing.computeRowCost(row, {
    agentDefaultPricing: { codex: { inputUsdPer1M: 2, outputUsdPer1M: 8 } },
    pricingRules: [
      { id: "codex:gpt-5.2-codex", source: "codex", model: "gpt-5.2-codex", inputPricePer1M: 1.75, outputPricePer1M: 14, currency: "USD" },
    ],
  });
  assert.equal(costRule, 15.75);
});

test("pricingRules: CNY rule converts to USD via fixed 7.2 rate", () => {
  pricing.resetPricingForTests();
  const row = {
    source: "hermes",
    model: "mimo-v2.5-pro",
    input_tokens: 1_000_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 1_000_000,
    reasoning_output_tokens: 0,
  };
  // 7.2 CNY input + 36 CNY output = 43.2 CNY → /7.2 = 6 USD.
  const cost = pricing.computeRowCost(row, {
    pricingRules: [
      { id: "hermes:mimo-v2.5-pro", source: "hermes", model: "mimo-v2.5-pro", inputPricePer1M: 7.2, outputPricePer1M: 36, currency: "CNY" },
    ],
  });
  assert.ok(Math.abs(cost - 6) < 1e-9, `expected 6, got ${cost}`);
});

test("pricingRules: codex/every-code reasoning tokens are NOT double-billed", () => {
  pricing.resetPricingForTests();
  const row = {
    source: "codex",
    model: "gpt-5.2-codex",
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 1_000_000,
    reasoning_output_tokens: 500_000,
  };
  const cost = pricing.computeRowCost(row, {
    pricingRules: [
      { id: "codex:gpt-5.2-codex", source: "codex", model: "gpt-5.2-codex", inputPricePer1M: 1, outputPricePer1M: 10, currency: "USD" },
    ],
  });
  // reasoning folded into output → only output_tokens billed = 10.
  assert.equal(cost, 10);
});

test("pricingRules: non-codex source DOES bill reasoning tokens", () => {
  pricing.resetPricingForTests();
  const row = {
    source: "claude",
    model: "claude-opus-4-8",
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 1_000_000,
    reasoning_output_tokens: 500_000,
  };
  const cost = pricing.computeRowCost(row, {
    pricingRules: [
      { id: "claude:claude-opus-4-8", source: "claude", model: "claude-opus-4-8", inputPricePer1M: 1, outputPricePer1M: 10, currency: "USD" },
    ],
  });
  // output 1M * 10 + reasoning 0.5M * 10 = 15.
  assert.equal(cost, 15);
});

test("pricingRules: no match falls through to agentDefaultPricing", () => {
  pricing.resetPricingForTests();
  const row = {
    source: "claude",
    model: "claude-opus-4-8",
    input_tokens: 1_000_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 1_000_000,
    reasoning_output_tokens: 0,
  };
  // Rule for a different model → falls through to agent default.
  const cost = pricing.computeRowCost(row, {
    agentDefaultPricing: { claude: { inputUsdPer1M: 3, outputUsdPer1M: 15 } },
    pricingRules: [
      { id: "claude:other-model", source: "claude", model: "other-model", inputPricePer1M: 1, outputPricePer1M: 1, currency: "USD" },
    ],
  });
  assert.equal(cost, 18);
});

test("pricingRules: getPricingRuleForRow does exact source+model match only", () => {
  pricing.resetPricingForTests();
  const rules = pricing.normalizePricingRules([
    { source: "codex", model: "gpt-5.2-codex", inputPricePer1M: 1, outputPricePer1M: 2, currency: "USD" },
  ]);
  assert.ok(pricing.getPricingRuleForRow({ source: "codex", model: "gpt-5.2-codex" }, rules));
  // Case-insensitive source.
  assert.ok(pricing.getPricingRuleForRow({ source: "CODEX", model: "gpt-5.2-codex" }, rules));
  // Different model → no match.
  assert.equal(pricing.getPricingRuleForRow({ source: "codex", model: "gpt-5.4" }, rules), null);
  // Different source → no match.
  assert.equal(pricing.getPricingRuleForRow({ source: "claude", model: "gpt-5.2-codex" }, rules), null);
});

test("pricingRules: empty rules array does not activate the rule path", () => {
  pricing.resetPricingForTests();
  const row = {
    source: "claude",
    model: "claude-opus-4-8",
    input_tokens: 1_000_000,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
  };
  // Empty pricingRules + no agentDefaultPricing → built-in model pricing.
  const cost = pricing.computeRowCost(row, { pricingRules: [] });
  assert.ok(cost > 0, "built-in model pricing should still apply");
});

// ─────────────────────────────────────────────────────────────────────────────
// pricingRules rework (D04 return-fix) — id forced from source:model, source
// normalization for the reasoning fold.

test("pricingRules: normalizePricingRule forces id from source:model, ignoring external id", () => {
  const rule = pricing.normalizePricingRule({
    id: "stale-foreign-id",
    source: "CODEX",
    model: "gpt-5.2-codex",
    inputPricePer1M: 1.75,
    outputPricePer1M: 14,
    currency: "USD",
  });
  // id is ALWAYS derived; the external id is discarded.
  assert.equal(rule.id, "codex:gpt-5.2-codex", "external id must be ignored");
  assert.equal(rule.source, "codex");
});

test("pricingRules: same source+model with different external ids collapses to one rule", () => {
  // Two inputs claim different ids but resolve to the same source:model key.
  // Only the first survives; the second is a duplicate and must be dropped so
  // getPricingRuleForRow never sees two matches for the same row. (model is
  // matched exactly per spec, so both inputs use the identical model string.)
  const rules = pricing.normalizePricingRules([
    { id: "anything-1", source: "codex", model: "gpt-5.2-codex", inputPricePer1M: 1.75, outputPricePer1M: 14, currency: "USD" },
    { id: "anything-2", source: "Codex", model: "gpt-5.2-codex", inputPricePer1M: 999, outputPricePer1M: 999, currency: "USD" },
  ]);
  assert.equal(rules.length, 1, "same source+model must dedup to one rule");
  assert.equal(rules[0].id, "codex:gpt-5.2-codex");
  // First entry wins (1.75/14), not the 999/999 duplicate.
  assert.equal(rules[0].inputPricePer1M, 1.75);
  assert.equal(rules[0].outputPricePer1M, 14);
});

test("pricingRules: uppercase CODEX source still folds reasoning (no double billing)", () => {
  pricing.resetPricingForTests();
  const row = {
    source: "CODEX",
    model: "gpt-5.2-codex",
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 1_000_000,
    reasoning_output_tokens: 500_000,
  };
  const cost = pricing.computeRowCost(row, {
    pricingRules: [
      { id: "codex:gpt-5.2-codex", source: "codex", model: "gpt-5.2-codex", inputPricePer1M: 1, outputPricePer1M: 10, currency: "USD" },
    ],
  });
  // reasoning folded into output → only output_tokens billed = 10. If the
  // uppercase source bypassed the fold, cost would be 15 (1M*10 + 0.5M*10).
  assert.equal(cost, 10, "uppercase CODEX must still fold reasoning");
});

// ─────────────────────────────────────────────────────────────────────────────
// D07: Configurable USD/CNY rate
// ─────────────────────────────────────────────────────────────────────────────

test("D07: normalizeUsdToCny returns valid value or falls back to 7.2", () => {
  assert.equal(pricing.normalizeUsdToCny(6), 6);
  assert.equal(pricing.normalizeUsdToCny(8.5), 8.5);
  assert.equal(pricing.normalizeUsdToCny(0), 7.2);
  assert.equal(pricing.normalizeUsdToCny(-1), 7.2);
  assert.equal(pricing.normalizeUsdToCny(NaN), 7.2);
  assert.equal(pricing.normalizeUsdToCny(undefined), 7.2);
  assert.equal(pricing.normalizeUsdToCny(null), 7.2);
});

test("D07: CNY pricingRule with custom usdToCny=6 differs from default 7.2", () => {
  pricing.resetPricingForTests();
  const row = {
    source: "hermes",
    model: "mimo-v2.5-pro",
    input_tokens: 1_000_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 1_000_000,
    reasoning_output_tokens: 0,
  };
  // 7.2 CNY input + 36 CNY output = 43.2 CNY → /7.2 = 6 USD (default)
  const cost72 = pricing.computeRowCost(row, {
    pricingRules: [
      { id: "hermes:mimo-v2.5-pro", source: "hermes", model: "mimo-v2.5-pro", inputPricePer1M: 7.2, outputPricePer1M: 36, currency: "CNY" },
    ],
    usdToCny: 7.2,
  });
  // 43.2 CNY / 6 = 7.2 USD (custom rate)
  const cost6 = pricing.computeRowCost(row, {
    pricingRules: [
      { id: "hermes:mimo-v2.5-pro", source: "hermes", model: "mimo-v2.5-pro", inputPricePer1M: 7.2, outputPricePer1M: 36, currency: "CNY" },
    ],
    usdToCny: 6,
  });
  assert.ok(Math.abs(cost72 - 6) < 1e-9, `expected 6, got ${cost72}`);
  assert.ok(Math.abs(cost6 - 7.2) < 1e-9, `expected 7.2, got ${cost6}`);
  assert.notEqual(cost72, cost6, "custom rate 6 must differ from default 7.2");
});

test("D07: computeRowCostWithRule CNY falls back to 7.2 for invalid usdToCny", () => {
  const row = {
    input_tokens: 1_000_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
  const rule = { id: "test:model", source: "test", model: "model", inputPricePer1M: 7.2, outputPricePer1M: 0, currency: "CNY" };
  // 7.2 CNY / 7.2 = 1 USD for all invalid rates
  assert.equal(pricing.computeRowCostWithRule(row, rule, 0), 1);
  assert.equal(pricing.computeRowCostWithRule(row, rule, -5), 1);
  assert.equal(pricing.computeRowCostWithRule(row, rule, NaN), 1);
});

test("D07: computeRowCostWithRule USD rule ignores usdToCny", () => {
  const row = {
    input_tokens: 1_000_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
  const rule = { id: "test:model", source: "test", model: "model", inputPricePer1M: 3, outputPricePer1M: 0, currency: "USD" };
  assert.equal(pricing.computeRowCostWithRule(row, rule, 6), 3);
  assert.equal(pricing.computeRowCostWithRule(row, rule, 100), 3);
});
