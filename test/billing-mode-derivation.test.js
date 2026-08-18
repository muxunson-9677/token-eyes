const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

// Q02 unit-level coverage of the derivation helpers exported on the handler.
// These rules are documented in docs/dev-notes/billing-mode-display-spec.md
// and pinned here so refactors can't silently change the precedence order.
test("deriveModelBillingMode honors explicit row.billing_mode=api_key", () => {
  const handler = createLocalApiHandler({ queuePath: "/tmp/none.jsonl" });
  const result = handler.deriveModelBillingMode({
    row: { billing_mode: "api_key" },
    model: "gpt-4o",
    source: "codex",
    planRecords: [],
  });
  assert.equal(result.mode, "api_key");
  assert.equal(result.confidence, "explicit_runtime");
});

test("deriveModelBillingMode honors explicit row.billing_mode=token_plan", () => {
  const handler = createLocalApiHandler({ queuePath: "/tmp/none.jsonl" });
  const result = handler.deriveModelBillingMode({
    row: { billing_mode: "token_plan" },
    model: "gpt-4o",
    source: "codex",
    planRecords: [],
  });
  assert.equal(result.mode, "token_plan");
  assert.equal(result.confidence, "explicit_runtime");
});

test("deriveModelBillingMode normalizes 'pay-as-you-go' and 'subscription' to api_key/token_plan", () => {
  const handler = createLocalApiHandler({ queuePath: "/tmp/none.jsonl" });
  const payg = handler.deriveModelBillingMode({
    row: { billing_mode: "pay-as-you-go" },
    model: "gpt-4o",
    source: "codex",
    planRecords: [],
  });
  assert.equal(payg.mode, "api_key");
  assert.equal(payg.confidence, "explicit_runtime");
  const sub = handler.deriveModelBillingMode({
    row: { billing_mode: "subscription" },
    model: "gpt-4o",
    source: "codex",
    planRecords: [],
  });
  assert.equal(sub.mode, "token_plan");
  assert.equal(sub.confidence, "explicit_runtime");
});

test("deriveModelBillingMode does not infer api_key from a model keyword", () => {
  const handler = createLocalApiHandler({ queuePath: "/tmp/none.jsonl" });
  const result = handler.deriveModelBillingMode({
    row: {},
    model: "pay-as-you-go-model",
    source: "custom",
    planRecords: [],
  });
  assert.equal(result.mode, "unknown");
  assert.equal(result.confidence, "unavailable");
});

test("deriveModelBillingMode falls back to unknown when no rule matches", () => {
  const handler = createLocalApiHandler({ queuePath: "/tmp/none.jsonl" });
  const result = handler.deriveModelBillingMode({
    row: {},
    model: "totally-unrecognized-model",
    source: "codex",
    planRecords: [],
  });
  assert.equal(result.mode, "unknown");
  assert.equal(result.confidence, "unavailable");
});

test("Token plan label and model keywords alone do not change unknown", () => {
  const handler = createLocalApiHandler({ queuePath: "/tmp/none.jsonl" });
  const planRecords = [
    {
      id: "plan-1",
      source: "hermes",
      plan_label: "Xiaomi MiMo Token Plan",
      total_quota: 0,
      used_quota: 0,
      remaining_quota: 0,
      expires_at: "",
    },
  ];
  const result = handler.deriveModelBillingMode({
    row: {},
    model: "mimo-v2.5-pro",
    source: "hermes",
    planRecords,
  });
  assert.equal(result.mode, "unknown");
  assert.equal(result.confidence, "unavailable");
});

test("source plan record and API-looking model stay unknown without explicit evidence", () => {
  const handler = createLocalApiHandler({ queuePath: "/tmp/none.jsonl" });
  const planRecords = [
    {
      id: "plan-1",
      source: "hermes",
      plan_label: "Xiaomi MiMo Token Plan",
      total_quota: 0,
      used_quota: 0,
      remaining_quota: 0,
      expires_at: "",
    },
  ];
  const result = handler.deriveModelBillingMode({
    row: {},
    model: "deepseek-v4-pro",
    source: "hermes",
    planRecords,
  });
  assert.equal(result.mode, "unknown");
  assert.equal(result.confidence, "unavailable");
});

test("source plan record alone does not change unknown", () => {
  const handler = createLocalApiHandler({ queuePath: "/tmp/none.jsonl" });
  const planRecords = [
    {
      id: "plan-1",
      source: "codex",
      plan_label: "Codex Pro Plan",
      total_quota: 0,
      used_quota: 0,
      remaining_quota: 0,
      expires_at: "",
    },
  ];
  const result = handler.deriveModelBillingMode({
    row: {},
    model: "gpt-5.4",
    source: "codex",
    planRecords,
  });
  assert.equal(result.mode, "unknown");
  assert.equal(result.confidence, "unavailable");
});

test("summarizeSourceBillingMode collapses all-same to single mode, mixed to 'mixed'", () => {
  const handler = createLocalApiHandler({ queuePath: "/tmp/none.jsonl" });
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

  // Empty input → unknown.
  const empty = handler.summarizeSourceBillingMode([]);
  assert.deepEqual(empty, { mode: "unknown", billing_modes: [] });
});

test("normalizeBillingModeRaw maps common aliases", () => {
  const handler = createLocalApiHandler({ queuePath: "/tmp/none.jsonl" });
  assert.equal(handler.normalizeBillingModeRaw("api_key"), "api_key");
  assert.equal(handler.normalizeBillingModeRaw("API-Key"), "api_key");
  assert.equal(handler.normalizeBillingModeRaw("api key"), "api_key");
  assert.equal(handler.normalizeBillingModeRaw("PAYG"), "api_key");
  assert.equal(handler.normalizeBillingModeRaw("pay_as_you_go"), "api_key");
  assert.equal(handler.normalizeBillingModeRaw("pay-as-you-go"), "api_key");
  assert.equal(handler.normalizeBillingModeRaw("token-plan"), "token_plan");
  assert.equal(handler.normalizeBillingModeRaw("token plan"), "token_plan");
  assert.equal(handler.normalizeBillingModeRaw("subscription"), "token_plan");
  assert.equal(handler.normalizeBillingModeRaw("plan"), "token_plan");
  // unknown is valid for a record, mixed is summary-only.
  assert.equal(handler.normalizeBillingModeRaw("unknown"), "unknown");
  assert.equal(handler.normalizeBillingModeRaw("MIXED"), "unknown");
  // Bogus values collapse to null (caller treats as no match).
  assert.equal(handler.normalizeBillingModeRaw("definitely-not-a-mode"), null);
  assert.equal(handler.normalizeBillingModeRaw(""), null);
  assert.equal(handler.normalizeBillingModeRaw(null), null);
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
