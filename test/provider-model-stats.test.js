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
  },
];

test("provider-stats returns providers sorted by tokens descending", async () => {
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
    assert.equal(result.providers.length, 2, "should have 2 providers (codex + claude)");

    // codex total_tokens = 350 + 35 = 385; claude total_tokens = 120 + 1500 = 1620
    // So claude should be first (more tokens)
    assert.equal(result.providers[0].source, "claude");
    assert.equal(result.providers[0].tokens, 1620);
    assert.equal(result.providers[0].request_count, null); // TICKET-06: non-codex has no request-level data
    assert.equal(result.providers[0].success_rate, null); // TICKET-06: non-codex has no request-level data
    assert.equal(result.providers[0].avg_latency_ms, null); // TICKET-06: non-codex has no request-level data
    assert.equal(result.providers[0].conversation_count, 4); // 1 + 3
    assert.equal(result.providers[0].metric_availability, "aggregate_only"); // TICKET-06
    assert.ok(result.providers[0].source_display_name, "should have display name");

    assert.equal(result.providers[1].source, "codex");
    assert.equal(result.providers[1].tokens, 385);
    assert.equal(result.providers[1].request_count, null); // TICKET-06: codex queue data has no request-level data

    // Verify tokens are sorted descending
    for (let i = 1; i < result.providers.length; i++) {
      assert.ok(
        result.providers[i - 1].tokens >= result.providers[i].tokens,
        "providers should be sorted by tokens descending",
      );
    }

    // totals should match sum of all providers' tokens
    assert.equal(result.totals.total_tokens, 2005); // 385 + 1620
    assert.equal(result.totals.conversation_count, 7); // 3 + 4
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-stats source_display_name is correct for edge-case sources", async () => {
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
      },
    ]);

    const result = await callEndpoint(
      queuePath,
      "/functions/tokentracker-provider-stats?from=2026-05-09&to=2026-05-09&tz=UTC",
    );

    // These exercise the getAgentAdapter id≠queueSource trap: kilocode has
    // id="kilo-code", omp has id="oh-my-pi". SOURCE_DISPLAY_NAME_MAP is built
    // from listAgentAdapters() keyed by queueSource, so these must resolve.
    const kilocode = result.providers.find((p) => p.source === "kilocode");
    assert.ok(kilocode, "kilocode provider should exist");
    assert.equal(kilocode.source_display_name, "Kilo Code");

    const omp = result.providers.find((p) => p.source === "omp");
    assert.ok(omp, "omp provider should exist");
    assert.equal(omp.source_display_name, "oh-my-pi");
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
    assert.equal(result.providers[0].source, "codex");
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
    assert.equal(result.providers[0].source, "codex");
    assert.equal(result.totals.total_tokens, 385);
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
