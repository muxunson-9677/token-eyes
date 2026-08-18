const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");
const {
  accumulateBillingModeAttribution,
  normalizeBillingMode,
  normalizeUsageAttribution,
} = require("../src/lib/usage-attribution");

function deriveRowBillingMode(row) {
  const attribution = normalizeUsageAttribution(row);
  return { mode: attribution.billing_mode, confidence: attribution.billing_mode_confidence };
}

test("billing attribution exposes a reusable pure accumulator", () => {
  assert.equal(typeof accumulateBillingModeAttribution, "function");
});

// Q02 unit-level coverage of the derivation helpers exported on the handler.
// These rules are documented in docs/dev-notes/billing-mode-display-spec.md
// and pinned here so refactors can't silently change the precedence order.
test("deriveModelBillingMode honors explicit row.billing_mode=api_key", () => {
  const result = deriveRowBillingMode({ billing_mode: "api_key" });
  assert.equal(result.mode, "api_key");
  assert.equal(result.confidence, "explicit_runtime");
});

test("deriveModelBillingMode honors explicit row.billing_mode=token_plan", () => {
  const result = deriveRowBillingMode({ billing_mode: "token_plan" });
  assert.equal(result.mode, "token_plan");
  assert.equal(result.confidence, "explicit_runtime");
});

test("deriveModelBillingMode rejects non-canonical aliases as trusted evidence", () => {
  for (const billingMode of ["pay-as-you-go", "payg", "subscription", "plan"]) {
    const result = deriveRowBillingMode({ billing_mode: billingMode });
    assert.equal(result.mode, "unknown");
    assert.equal(result.confidence, "unavailable");
  }
});

test("deriveModelBillingMode does not infer api_key from a model keyword", () => {
  const result = deriveRowBillingMode({ model: "pay-as-you-go-model" });
  assert.equal(result.mode, "unknown");
  assert.equal(result.confidence, "unavailable");
});

test("deriveModelBillingMode falls back to unknown when no rule matches", () => {
  const result = deriveRowBillingMode({});
  assert.equal(result.mode, "unknown");
  assert.equal(result.confidence, "unavailable");
});

test("Token plan label and model keywords alone do not change unknown", () => {
  const result = deriveRowBillingMode({ model: "mimo-v2.5-pro" });
  assert.equal(result.mode, "unknown");
  assert.equal(result.confidence, "unavailable");
});

test("source plan record and API-looking model stay unknown without explicit evidence", () => {
  const result = deriveRowBillingMode({ model: "deepseek-v4-pro" });
  assert.equal(result.mode, "unknown");
  assert.equal(result.confidence, "unavailable");
});

test("source plan record alone does not change unknown", () => {
  const result = deriveRowBillingMode({});
  assert.equal(result.mode, "unknown");
  assert.equal(result.confidence, "unavailable");
});

test("summarizeSourceBillingMode collapses all-same to single mode, mixed to 'mixed'", async () => {
  const trackerDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-billing-summary-"));
  try {
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDataDir, "queue.jsonl"),
      trackerDataDir,
    });
    const allApiKey = handler.summarizeSourceBillingMode([
      { mode: "api_key" },
      { mode: "api_key" },
    ]);
    assert.deepEqual(allApiKey, { mode: "api_key", billing_modes: ["api_key"] });

    const allTokenPlan = handler.summarizeSourceBillingMode([
      { mode: "token_plan" },
    ]);
    assert.deepEqual(allTokenPlan, { mode: "token_plan", billing_modes: ["token_plan"] });

    const mixed = handler.summarizeSourceBillingMode([
      { mode: "api_key" },
      { mode: "token_plan" },
    ]);
    assert.deepEqual(mixed, { mode: "mixed", billing_modes: ["api_key", "token_plan"] });

    const allUnknown = handler.summarizeSourceBillingMode([{ mode: "unknown" }]);
    assert.deepEqual(allUnknown, { mode: "unknown", billing_modes: ["unknown"] });
    assert.deepEqual(handler.summarizeSourceBillingMode([]), { mode: "unknown", billing_modes: [] });
  } finally {
    await fs.rm(trackerDataDir, { recursive: true, force: true });
  }
});

test("normalizeBillingMode accepts only canonical trusted values", () => {
  assert.equal(normalizeBillingMode("api_key"), "api_key");
  assert.equal(normalizeBillingMode("token_plan"), "token_plan");
  assert.equal(normalizeBillingMode("unknown"), "unknown");
  for (const value of ["API-Key", "api key", "PAYG", "subscription", "plan", "MIXED", ""]) {
    assert.equal(normalizeBillingMode(value), null);
  }
  assert.equal(normalizeBillingMode(null), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end coverage of /functions/tokentracker-usage-model-breakdown. We
// don't trust the per-row helper in isolation — verify the grouped response
// carries billing_mode / billing_modes / billing_mode_confidence for both
// source and model rows in the canonical scenarios.
// ─────────────────────────────────────────────────────────────────────────────

function createRequest({ method = "GET", headers = {}, body = "" } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.headers = headers;
  return req;
}

function createResponse() {
  const chunks = [];
  let statusCode = 200;
  return {
    statusCode,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(code, headers) {
      statusCode = code;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

async function call(handler, pathName) {
  const req = createRequest();
  const res = createResponse();
  const url = new URL(`http://127.0.0.1:7680${pathName}`);
  const handled = await handler(req, res, url);
  assert.equal(handled, true, "handler must claim the request");
  return JSON.parse(res.body.toString("utf8") || "{}");
}

test("usage-model-breakdown: explicit billing_mode=api_key flows through to model and source", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-billing-explicit-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: trackerDir });
    const row = {
      hour_start: "2026-06-20T00:00:00.000Z",
      source: "codex",
      model: "gpt-4o",
      billing_mode: "api_key",
      input_tokens: 1000,
      output_tokens: 200,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 1200,
      conversation_count: 1,
    };
    await fs.writeFile(queuePath, JSON.stringify(row) + "\n");
    const body = await call(
      handler,
      "/functions/tokentracker-usage-model-breakdown?from=2026-06-20&to=2026-06-20&tz=UTC",
    );
    const src = body.sources.find((s) => s.source === "codex");
    assert.ok(src, "codex source must exist");
    assert.equal(src.billing_mode, "api_key");
    assert.deepEqual(src.billing_modes, ["api_key"]);
    const model = src.models.find((m) => m.model === "gpt-4o");
    assert.equal(model.billing_mode, "api_key");
    assert.equal(model.billing_mode_confidence, "explicit_runtime");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("usage-model-breakdown: an explicit row remains authoritative across model aggregation", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-billing-aggregate-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: trackerDir });
    const base = {
      source: "codex",
      model: "mimo-coding-plan",
      input_tokens: 500,
      output_tokens: 100,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 600,
      conversation_count: 1,
    };
    await fs.writeFile(
      queuePath,
      [
        { ...base, hour_start: "2026-06-20T00:00:00.000Z" },
        {
          ...base,
          hour_start: "2026-06-20T00:00:00.000Z",
          billing_mode: "api_key",
        },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    );

    const body = await call(
      handler,
      "/functions/tokentracker-usage-model-breakdown?from=2026-06-20&to=2026-06-20&tz=UTC",
    );
    const src = body.sources.find((entry) => entry.source === "codex");
    const model = src.models.find((entry) => entry.model === "mimo-coding-plan");
    assert.equal(model.billing_mode, "mixed");
    assert.deepEqual(model.billing_mode_token_totals, {
      api_key: 600,
      token_plan: 0,
      unknown: 600,
    });
    assert.equal(model.totals.total_tokens, 1200);
    assert.equal(
      Object.values(model.billing_mode_token_totals).reduce((sum, value) => sum + value, 0),
      model.totals.total_tokens,
    );
    assert.deepEqual(src.billing_mode_token_totals, {
      api_key: 600,
      token_plan: 0,
      unknown: 600,
    });
    assert.equal(src.billing_mode, "mixed");
    assert.deepEqual(src.billing_modes, ["api_key", "unknown"]);
    assert.equal(src.totals.total_tokens, 1200);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("usage-model-breakdown: plan records and model keywords remain unknown and preserve totals", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-billing-hermes-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    // Pre-seed the tracker config with a MiMo plan record.
    const configPath = path.join(trackerDir, "config.json");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          tokenPlans: [
            {
              id: "plan-1",
              source: "hermes",
              plan_label: "Xiaomi MiMo Token Plan",
              total_quota: 1000,
              used_quota: 0,
              remaining_quota: 1000,
              expires_at: "",
              refresh_enabled: false,
            },
          ],
        },
        null,
        2,
      ),
    );

    const handler = createLocalApiHandler({ queuePath, trackerDataDir: trackerDir });
    const rows = [
      {
        hour_start: "2026-06-20T00:00:00.000Z",
        source: "hermes",
        model: "mimo-v2.5-pro",
        input_tokens: 1000,
        output_tokens: 200,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 1200,
        conversation_count: 1,
      },
      {
        hour_start: "2026-06-20T00:00:00.000Z",
        source: "hermes",
        model: "deepseek-v4-pro",
        input_tokens: 500,
        output_tokens: 100,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 600,
        conversation_count: 1,
      },
    ];
    await fs.writeFile(queuePath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const body = await call(
      handler,
      "/functions/tokentracker-usage-model-breakdown?from=2026-06-20&to=2026-06-20&tz=UTC",
    );
    const src = body.sources.find((s) => s.source === "hermes");
    assert.ok(src, "hermes source must exist");
    assert.equal(src.billing_mode, "unknown");
    assert.deepEqual(src.billing_modes, ["unknown"]);
    assert.equal(src.totals.total_tokens, 1800);

    const mimo = src.models.find((m) => m.model === "mimo-v2.5-pro");
    assert.equal(mimo.billing_mode, "unknown");
    assert.equal(mimo.billing_mode_confidence, "unavailable");
    assert.equal(mimo.totals.total_tokens, 1200);

    const deepseek = src.models.find((m) => m.model === "deepseek-v4-pro");
    assert.equal(deepseek.billing_mode, "unknown");
    assert.equal(deepseek.billing_mode_confidence, "unavailable");
    assert.equal(deepseek.totals.total_tokens, 600);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("usage-model-breakdown: no plan, no explicit, no keyword → source=unknown / model=unknown", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-billing-unknown-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    const handler = createLocalApiHandler({ queuePath, trackerDataDir: trackerDir });
    const row = {
      hour_start: "2026-06-20T00:00:00.000Z",
      source: "codex",
      model: "totally-unrecognized-model",
      input_tokens: 1000,
      output_tokens: 200,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 1200,
      conversation_count: 1,
    };
    await fs.writeFile(queuePath, JSON.stringify(row) + "\n");

    const body = await call(
      handler,
      "/functions/tokentracker-usage-model-breakdown?from=2026-06-20&to=2026-06-20&tz=UTC",
    );
    const src = body.sources.find((s) => s.source === "codex");
    assert.ok(src, "codex source must exist");
    assert.equal(src.billing_mode, "unknown");
    assert.deepEqual(src.billing_modes, ["unknown"]);
    const model = src.models.find((m) => m.model === "totally-unrecognized-model");
    assert.equal(model.billing_mode, "unknown");
    assert.equal(model.billing_mode_confidence, "unavailable");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("billing attribution evaluates each row once while conserving per-mode totals", () => {
  const source = {
    tokenTotals: { api_key: 0, token_plan: 0, unknown: 0 },
    confidences: {},
  };
  const model = {
    tokenTotals: { api_key: 0, token_plan: 0, unknown: 0 },
    confidences: {},
  };
  const rows = [
    { billing_mode: "unknown", total_tokens: 10 },
    { billing_mode: "api_key", total_tokens: 20 },
    { billing_mode: "token_plan", total_tokens: 5 },
  ];
  let evaluations = 0;
  for (const row of rows) {
    accumulateBillingModeAttribution([source, model], row, (input) => {
      evaluations += 1;
      return normalizeUsageAttribution(input);
    });
  }

  assert.equal(evaluations, rows.length);
  assert.deepEqual(source.tokenTotals, { api_key: 20, token_plan: 5, unknown: 10 });
  assert.deepEqual(model.tokenTotals, source.tokenTotals);
  assert.equal(Object.values(source.tokenTotals).reduce((sum, value) => sum + value, 0), 35);
});
