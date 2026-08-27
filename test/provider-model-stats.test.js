const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

async function writeQueue(queuePath, rows) {
  await fs.promises.writeFile(
    queuePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

async function callEndpoint(queuePath, endpoint) {
  const configPath = path.join(path.dirname(queuePath), "config.json");
  if (!fs.existsSync(configPath)) {
    await fs.promises.writeFile(configPath, JSON.stringify({
      pricingRules: [
        ["codex", "gpt-5-codex"],
        ["claude", "claude-sonnet-4-6"],
        ["claude", "claude-opus-4"],
        ["kilocode", "claude-sonnet-4"],
        ["omp", "mimo"],
        ["kiro", "claude-sonnet-4"],
      ].map(([source, model]) => ({
        source,
        model,
        inputPricePer1M: 1,
        outputPricePer1M: 1,
        currency: "USD",
      })),
    }), "utf8");
  }
  const handler = createLocalApiHandler({
    queuePath,
    trackerDataDir: path.dirname(queuePath),
    tokenOnlyDirectoryStatesProvider: () => ({}),
  });
  const url = new URL(`http://localhost${endpoint}`);
  const req = {
    method: "GET",
    url: url.pathname + url.search,
    headers: { host: "localhost" },
  };
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead() {},
    write(chunk) {
      chunks.push(chunk);
    },
    end(body) {
      if (body) chunks.push(body);
    },
  };
  const handled = await handler(req, res, url);
  assert.ok(handled, `endpoint must be handled: ${endpoint}`);
  return JSON.parse(chunks.join(""));
}

const BASE_ROWS = [
  {
    source: "codex",
    model: "gpt-5-codex",
    hour_start: "2026-05-09T10:00:00.000Z",
    input_tokens: 100,
    cached_input_tokens: 200,
    cache_creation_input_tokens: 0,
    output_tokens: 50,
    reasoning_output_tokens: 0,
    total_tokens: 350,
    conversation_count: 2,
    billing_mode: "api_key",
    billing_mode_confidence: "provider_receipt",
    provider_id: "openai",
  },
  {
    source: "claude",
    model: "claude-sonnet-4-6",
    hour_start: "2026-05-09T10:00:00.000Z",
    input_tokens: 80,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 40,
    reasoning_output_tokens: 0,
    total_tokens: 120,
    conversation_count: 1,
    billing_mode: "api_key",
    billing_mode_confidence: "provider_receipt",
    provider_id: "anthropic",
  },
  {
    source: "codex",
    model: "gpt-5-codex",
    hour_start: "2026-05-09T10:30:00.000Z",
    input_tokens: 10,
    cached_input_tokens: 20,
    cache_creation_input_tokens: 0,
    output_tokens: 5,
    reasoning_output_tokens: 0,
    total_tokens: 35,
    conversation_count: 1,
    billing_mode: "api_key",
    billing_mode_confidence: "provider_receipt",
    provider_id: "openai",
  },
  {
    source: "claude",
    model: "claude-opus-4",
    hour_start: "2026-05-09T11:00:00.000Z",
    input_tokens: 1000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 500,
    reasoning_output_tokens: 0,
    total_tokens: 1500,
    conversation_count: 3,
    billing_mode: "api_key",
    billing_mode_confidence: "provider_receipt",
    provider_id: "anthropic",
  },
];

test("provider-stats returns true Providers while preserving Agent breakdowns", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-provider-stats-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, BASE_ROWS);

    const result = await callEndpoint(
      queuePath,
      "/functions/tokentracker-provider-stats?from=2026-05-09&to=2026-05-09&tz=UTC",
    );

    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.providers));
    assert.equal(result.providers.length, 2, "should have 2 true API Providers");

    const anthropic = result.providers.find((provider) => provider.provider_id === "anthropic");
    assert.ok(anthropic);
    assert.equal(anthropic.tokens, 1620);
    assert.equal(anthropic.request_count, null);
    assert.equal(anthropic.request_count_basis, "unavailable");
    assert.equal(anthropic.success_rate, null);
    assert.equal(anthropic.avg_latency_ms, null);
    assert.equal(anthropic.conversation_count, 4);
    assert.equal(anthropic.metric_availability, "unavailable");
    assert.deepEqual(anthropic.agents.map((agent) => agent.id), ["claude"]);

    const openai = result.providers.find((provider) => provider.provider_id === "openai");
    assert.ok(openai);
    assert.equal(openai.tokens, 385);
    assert.equal(openai.request_count, null);
    assert.deepEqual(openai.agents.map((agent) => agent.id), ["codex"]);

    // totals should match sum of all providers' tokens
    assert.equal(result.totals.total_tokens, 2005); // 385 + 1620
    assert.equal(result.totals.conversation_count, 7); // 3 + 4
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-stats honors the selected range and retains explicitly attributed zero-cost and token-plan usage", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-provider-range-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [
      {
        source: "claude",
        model: "claude-sonnet-4-6",
        hour_start: "2026-05-01T10:00:00.000Z",
        input_tokens: 80,
        output_tokens: 20,
        total_tokens: 100,
        conversation_count: 1,
        billing_mode: "token_plan",
        billing_mode_confidence: "configured_plan_provider_match",
        provider_id: "anthropic",
      },
      {
        source: "codex",
        model: "unpriced-model",
        hour_start: "2026-05-31T10:00:00.000Z",
        input_tokens: 40,
        output_tokens: 10,
        total_tokens: 50,
        conversation_count: 1,
        billing_mode: "api_key",
        billing_mode_confidence: "provider_receipt",
        provider_id: "openai",
      },
      {
        source: "codex",
        model: "gpt-5-codex",
        hour_start: "2026-06-01T00:00:00.000Z",
        input_tokens: 999,
        output_tokens: 1,
        total_tokens: 1000,
        conversation_count: 1,
        billing_mode: "api_key",
        billing_mode_confidence: "provider_receipt",
        provider_id: "openai",
      },
    ]);

    const result = await callEndpoint(
      queuePath,
      "/functions/tokentracker-provider-stats?from=2026-05-01&to=2026-05-31&tz=UTC",
    );

    assert.deepEqual(result.period, { from: "2026-05-01", to: "2026-05-31", days: 31, time_zone: "UTC" });
    assert.equal(result.totals_scope, "all_provider_attributed");
    assert.deepEqual(result.providers.map((provider) => provider.provider_id).sort(), ["anthropic", "openai"]);
    assert.equal(result.providers.find((provider) => provider.provider_id === "anthropic").tokens, 100);
    assert.equal(result.providers.find((provider) => provider.provider_id === "openai").tokens, 50);
    assert.equal(result.providers.find((provider) => provider.provider_id === "openai").cost_usd, 0);
    assert.equal(result.totals.total_tokens, 150);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-stats uses Provider names and keeps edge-case sources as Agents", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-provider-display-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [
      {
        source: "kilocode",
        model: "claude-sonnet-4",
        hour_start: "2026-05-09T10:00:00.000Z",
        input_tokens: 10,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 5,
        reasoning_output_tokens: 0,
        total_tokens: 15,
        conversation_count: 1,
        billing_mode: "api_key",
        billing_mode_confidence: "provider_receipt",
        provider_id: "deepseek",
      },
      {
        source: "omp",
        model: "mimo",
        hour_start: "2026-05-09T10:00:00.000Z",
        input_tokens: 20,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 10,
        reasoning_output_tokens: 0,
        total_tokens: 30,
        conversation_count: 1,
        billing_mode: "api_key",
        billing_mode_confidence: "provider_receipt",
        provider_id: "moonshot",
      },
    ]);

    const result = await callEndpoint(
      queuePath,
      "/functions/tokentracker-provider-stats?from=2026-05-09&to=2026-05-09&tz=UTC",
    );

    const deepseek = result.providers.find((provider) => provider.provider_id === "deepseek");
    assert.ok(deepseek);
    assert.equal(deepseek.display_name, "DeepSeek");
    assert.equal(deepseek.agents[0].id, "kilocode");
    assert.equal(deepseek.agents[0].display_name, "Kilo Code");

    const moonshot = result.providers.find((provider) => provider.provider_id === "moonshot");
    assert.ok(moonshot);
    assert.equal(moonshot.display_name, "Moonshot");
    assert.equal(moonshot.agents[0].id, "omp");
    assert.equal(moonshot.agents[0].display_name, "oh-my-pi");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-stats filters by sources param", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-provider-filter-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, BASE_ROWS);

    const result = await callEndpoint(
      queuePath,
      "/functions/tokentracker-provider-stats?from=2026-05-09&to=2026-05-09&tz=UTC&sources=codex",
    );

    assert.equal(result.providers.length, 1);
    assert.equal(result.providers[0].provider_id, "openai");
    assert.equal(result.providers[0].tokens, 385);
    // totals should also be filtered
    assert.equal(result.totals.total_tokens, 385);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-stats agent_ids is equivalent to sources filter", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-provider-agent-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, BASE_ROWS);

    const result = await callEndpoint(
      queuePath,
      "/functions/tokentracker-provider-stats?from=2026-05-09&to=2026-05-09&tz=UTC&agent_ids=codex",
    );

    assert.equal(result.providers.length, 1);
    assert.equal(result.providers[0].provider_id, "openai");
    assert.equal(result.totals.total_tokens, 385);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-stats maps simultaneous Kiro IDE and CLI agent ids to one kiro source filter", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-provider-kiro-agent-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [{
      source: "kiro",
      model: "claude-sonnet-4",
      hour_start: "2026-05-09T10:00:00.000Z",
      input_tokens: 40,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 10,
      reasoning_output_tokens: 0,
      total_tokens: 50,
      conversation_count: 1,
      billing_mode: "api_key",
      billing_mode_confidence: "provider_receipt",
      provider_id: "deepseek",
    }]);

    const result = await callEndpoint(
      queuePath,
      "/functions/tokentracker-provider-stats?from=2026-05-09&to=2026-05-09&tz=UTC&agent_ids=kiro,kiro-cli",
    );

    assert.deepEqual(result.providers.map((provider) => provider.provider_id), ["deepseek"]);
    assert.equal(result.providers[0].display_name, "DeepSeek");
    assert.deepEqual(result.providers[0].agents.map((agent) => agent.id), ["kiro"]);
    assert.equal(result.totals.total_tokens, 50);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("model-stats returns models sorted by tokens descending", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-model-stats-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, BASE_ROWS);

    const result = await callEndpoint(
      queuePath,
      "/functions/tokentracker-model-stats?from=2026-05-09&to=2026-05-09&tz=UTC",
    );

    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.models));
    // 3 distinct (source, model) pairs:
    //   codex|gpt-5-codex -> 385 tokens
    //   claude|claude-sonnet-4-6 -> 120 tokens
    //   claude|claude-opus-4 -> 1500 tokens
    assert.equal(result.models.length, 3);

    // Sorted descending: claude-opus-4 (1500) > codex gpt-5-codex (385) > claude-sonnet (120)
    assert.equal(result.models[0].model, "claude-opus-4");
    assert.equal(result.models[0].tokens, 1500);
    assert.equal(result.models[0].source, "claude");
    assert.ok(result.models[0].source_display_name, "should have display name");

    assert.equal(result.models[1].model, "gpt-5-codex");
    assert.equal(result.models[1].tokens, 385);
    assert.equal(result.models[1].source, "codex");

    assert.equal(result.models[2].model, "claude-sonnet-4-6");
    assert.equal(result.models[2].tokens, 120);

    // totals across all models
    assert.equal(result.totals.total_tokens, 2005);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("model-stats does not merge same model name across different sources", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-model-nomerge-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, [
      {
        source: "codex",
        model: "shared-model",
        hour_start: "2026-05-09T10:00:00.000Z",
        input_tokens: 100,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 50,
        reasoning_output_tokens: 0,
        total_tokens: 150,
        conversation_count: 1,
      },
      {
        source: "claude",
        model: "shared-model",
        hour_start: "2026-05-09T10:00:00.000Z",
        input_tokens: 200,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 100,
        reasoning_output_tokens: 0,
        total_tokens: 300,
        conversation_count: 1,
      },
    ]);

    const result = await callEndpoint(
      queuePath,
      "/functions/tokentracker-model-stats?from=2026-05-09&to=2026-05-09&tz=UTC",
    );

    // Two entries with the same model name but different sources
    assert.equal(result.models.length, 2);
    const codexEntry = result.models.find((m) => m.source === "codex");
    const claudeEntry = result.models.find((m) => m.source === "claude");
    assert.ok(codexEntry);
    assert.ok(claudeEntry);
    assert.equal(codexEntry.model, "shared-model");
    assert.equal(claudeEntry.model, "shared-model");
    assert.equal(codexEntry.tokens, 150);
    assert.equal(claudeEntry.tokens, 300);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("model-stats filters by sources and models", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-model-filter-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, BASE_ROWS);

    const result = await callEndpoint(
      queuePath,
      "/functions/tokentracker-model-stats?from=2026-05-09&to=2026-05-09&tz=UTC&sources=claude&models=claude-opus-4",
    );

    assert.equal(result.models.length, 1);
    assert.equal(result.models[0].model, "claude-opus-4");
    assert.equal(result.models[0].tokens, 1500);
    assert.equal(result.totals.total_tokens, 1500);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-stats and model-stats return empty arrays for empty queue", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-stats-empty-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    await writeQueue(queuePath, []);

    const ps = await callEndpoint(
      queuePath,
      "/functions/tokentracker-provider-stats?from=2026-05-09&to=2026-05-09&tz=UTC",
    );
    assert.equal(ps.ok, true);
    assert.deepEqual(ps.providers, []);
    assert.equal(ps.totals.total_tokens, 0);

    const ms = await callEndpoint(
      queuePath,
      "/functions/tokentracker-model-stats?from=2026-05-09&to=2026-05-09&tz=UTC",
    );
    assert.equal(ms.ok, true);
    assert.deepEqual(ms.models, []);
    assert.equal(ms.totals.total_tokens, 0);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
